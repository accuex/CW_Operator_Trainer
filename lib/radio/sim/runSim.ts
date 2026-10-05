import { enqueue, schedulePending, type Station, type Transmission } from '../band';
import type { AirEvent } from '../air/ether';
import { keyText } from '../keying';
import { DEFAULT_RUN_PARAMS, RunSession, type RadioPort, type RunParams, type RunResult } from '../modes/cqRun';
import type { AgentMe } from '../agents/types';
import { seeded, type Random } from '../random';

/**
 * Headless CQ run: the same RunSession and agents as the app, driven by a virtual
 * clock and a scripted operator ("bot") instead of Web Audio and a human. Used to
 * check that runs always settle and that the books match what happened on the air.
 */

const LOOKAHEAD = 1.5;

/** Stands in for RigEngine: schedules station messages on a virtual clock. */
export class HeadlessRadio implements RadioPort {
  t = 0;
  stations: Station[] = [];
  onTransmission: ((station: Station, tx: Transmission) => void) | null = null;

  constructor(private random: Random) {}

  now() { return this.t; }
  send(station: Station, text: string, delay: number) { enqueue(station, text, this.t, delay); }
  stationsChanged(stations: Station[]) { this.stations = stations; }

  /** Move the clock to `t`, scheduling whatever falls inside the lookahead. */
  advance(t: number) {
    this.t = t;
    for (const station of this.stations) {
      for (const tx of schedulePending(station, t, t + LOOKAHEAD, this.random)) this.onTransmission?.(station, tx);
    }
  }
}

export interface BotOptions {
  /** Chance the first call we send to a station has one wrong letter. */
  callErrorRate: number;
  /** Chance we ask with a partial call ("ABC?") before picking. */
  partialRate: number;
  /** Keep sending our wrong call despite corrections. */
  ignoreCorrections: boolean;
  /** Chance of logging a call never worked (NIL) after each contact. */
  phantomRate: number;
  wpm: number;
  /** Seconds we listen after a CQ before calling again. */
  cqListen: number;
  /** Receive passband, Hz. */
  filter: number;
}

export const PERFECT_BOT: BotOptions = { callErrorRate: 0, partialRate: 0, ignoreCorrections: false, phantomRate: 0, wpm: 20, cqListen: 4, filter: 500 };

export interface SimOptions {
  seed: number;
  params?: Partial<RunParams>;
  me?: AgentMe;
  bot?: Partial<BotOptions>;
  /** Run length before the bot goes QRT, seconds. */
  duration?: number;
  /** Longest wait after QRT for the last contact and every caller to settle, seconds. */
  drain?: number;
  step?: number;
}

export interface SimReport {
  result: RunResult;
  run: RunSession;
  /** Our transmissions. */
  tx: number;
  cqs: number;
  /** Clock when the bot went QRT. */
  qrtAt: number;
}

const ME: AgentMe = { call: 'JA1ZZZ', name: 'MASA', qth: 'TOKYO' };
const VFO = 7_012_000;

interface Partner { stationId: number; sent: string; closing: boolean; since: number; agn: number }

export function runSim({ seed, params, me = ME, bot: botOptions, duration = 300, drain = 300, step = 0.05 }: SimOptions): SimReport {
  const random = seeded(seed);
  const bot = { ...PERFECT_BOT, ...botOptions };
  const radio = new HeadlessRadio(random);
  const run = new RunSession({ random, me, params: { ...DEFAULT_RUN_PARAMS, ...params } }, radio);
  radio.onTransmission = (station, tx) => run.onStationTransmission(station, tx);

  const myTx: [number, number][] = [];
  let busyUntil = 0;
  let lastTxEnd = -Infinity;
  let lastAirAt = -Infinity;
  let txCount = 0;
  let cqs = 0;
  let partner: Partner | null = null;
  let heard: { stationId: number; call: string; at: number }[] = [];
  const partialAsked = new Set<number>();
  const inbox: AirEvent[] = [];

  const agentOf = (id: number) => run.agents.find((agent) => agent.id === id);
  const send = (text: string) => {
    const start = radio.t + 0.05;
    const end = start + keyText(text, { wpm: bot.wpm }).length;
    myTx.push([start, end]);
    busyUntil = end;
    txCount += 1;
    // Reported as keying starts, like the app does once the rig has the length.
    run.transmit(text, { start, end, rf: VFO });
  };
  const exchange = (call: string) => `${call} UR 599 NAME ${me.name} QTH ${me.qth} BK`;
  const heardByBot = (event: AirEvent) =>
    event.from !== 'me' && Math.abs(event.rf - VFO) <= bot.filter / 2 && !myTx.some(([start, end]) => start < event.end && event.start < end);
  const mutate = (call: string) => {
    const index = call.length - 1 - Math.floor(random() * 3);
    const letter = String.fromCharCode(65 + ((call.charCodeAt(index) - 65 + 1 + Math.floor(random() * 24)) % 26));
    return `${call.slice(0, index)}${letter}${call.slice(index + 1)}`;
  };

  const qrtAt = duration;
  const end = duration + drain;
  let t = 0;
  for (; t <= end; t = Math.round((t + step) * 1000) / 1000) {
    radio.advance(t);
    const settled = run.agents.every((agent) => agent.gone) && !run.stations.length;
    if (t >= qrtAt && !partner && t >= busyUntil && settled) break;
    inbox.push(...run.tick(t).filter(heardByBot));
    if (t < busyUntil) continue;
    lastTxEnd = Math.max(lastTxEnd, busyUntil);

    // Listen.
    const events = inbox.splice(0);
    for (const event of events) {
      const agent = agentOf(event.from as number);
      if (!agent) continue;
      const text = event.text;
      if (partner && event.from === partner.stationId) {
        if (/\bEE\b/.test(text) && partner.closing) {
          partner = null;
          continue;
        }
        if (/NAME [A-Z]/.test(text) && !partner.closing) {
          run.logEntry({ call: partner.sent, rst: agent.persona.rst, name: agent.persona.name, qth: agent.persona.qth }, t);
          if (random() < bot.phantomRate) run.logEntry({ call: 'JQ9QQQ', rst: '599', name: 'X', qth: 'X' }, t);
          partner.closing = true;
          partner.since = t;
          send(`R TNX ${agent.persona.name} 73 TU EE`);
          break;
        }
        if (/(NAME|QTH|RST)\?/.test(text)) {
          send(`NAME ${me.name} QTH ${me.qth} BK`);
          break;
        }
        if (text.includes(agent.call) && partner.sent !== agent.call && !bot.ignoreCorrections) partner.sent = agent.call;
        if (!partner.closing) {
          send(exchange(partner.sent));
          partner.since = t;
          break;
        }
        continue;
      }
      if (!partner && text.includes(agent.call) && !heard.some((item) => item.stationId === agent.id)) heard.push({ stationId: agent.id, call: agent.call, at: t });
    }
    if (t < busyUntil) continue;

    // Act — but not over a signal in the passband. Our partner always gets to finish;
    // a pileup that never pauses gets answered 1.5 s after we copied a call.
    const keyingNow = (station: Station) => station.busyUntil > t || station.queue.length > 0;
    const inPassband = run.stations.filter((station) => Math.abs(station.rf - VFO) <= bot.filter / 2);
    const keying = inPassband.some(keyingNow);
    if (keying) lastAirAt = t;
    const partnerKeying = partner !== null && inPassband.some((station) => station.id === partner!.stationId && keyingNow(station));
    if (partnerKeying || (keying && !(heard[0] && !partner && t - heard[0].at > 1.5))) continue;
    if (partner) {
      const agent = agentOf(partner.stationId);
      const quiet = t - Math.max(lastTxEnd, lastAirAt, partner.since);
      if (!agent || agent.gone || (partner.closing && quiet > 4)) {
        partner = null;
        if (t < qrtAt) send(`QRZ? DE ${me.call} K`);
      } else if (quiet > 8) {
        if (partner.agn >= 3) partner = null;
        else {
          partner.agn += 1;
          send('AGN?');
        }
      }
    } else if (t < qrtAt) {
      heard = heard.filter((item) => !agentOf(item.stationId)?.gone);
      const candidate = heard[0];
      if (candidate) {
        heard = [];
        if (random() < bot.partialRate && !partialAsked.has(candidate.stationId)) {
          partialAsked.add(candidate.stationId);
          send(`${candidate.call.slice(-3)}?`);
        } else {
          const sent = random() < bot.callErrorRate ? mutate(candidate.call) : candidate.call;
          partner = { stationId: candidate.stationId, sent, closing: false, since: t, agn: 0 };
          send(exchange(sent));
        }
      } else if (!candidate && t - Math.max(lastTxEnd, lastAirAt) >= bot.cqListen) {
        cqs += 1;
        send(`CQ DE ${me.call} ${me.call} K`);
      }
    }
  }
  return { result: run.finish(t), run, tx: txCount, cqs, qrtAt };
}
