import type { CopySituation } from '../../types';
import { enqueue, fadeAt, makeQrm, schedulePending, type Station, type Transmission } from '../band';
import type { AirEvent } from '../air/ether';
import { judgeValue } from '../attribution';
import { CopyMonitor, sampleBand, situationOf, type RxRecord } from '../conditions';
import { BASIC_RST_NAME_QTH } from '../exchange';
import { keyText } from '../keying';
import { BUSY_HZ, DEFAULT_RUN_PARAMS, RunSession, type Placement, type RadioPort, type RunParams, type RunResult } from '../modes/cqRun';
import type { AgentMe } from '../agents/types';
import { scoreRun, type RunScore } from '../runReview';
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
  /** Background stations that are always there (QRM), like the desk's. */
  background: Station[] = [];
  onTransmission: ((station: Station, tx: Transmission) => void) | null = null;

  constructor(private random: Random) {}

  now() { return this.t; }
  send(station: Station, text: string, delay: number) { enqueue(station, text, this.t, delay); }
  stationsChanged(stations: Station[]) { this.stations = [...this.background, ...stations]; }

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
  /**
   * With a band: chance of miscopying a character by what it went through (clean, QRM,
   * doubled …). The bot's log and calls then carry those errors, judged like a human's.
   */
  copyErrors: Partial<Record<CopySituation, number>>;
  /** Send QRL? and listen before the first CQ on each frequency, and QSY when it is in use. */
  qrl: boolean;
  /** Seconds we listen after QRL? for an answer. */
  qrlListen: number;
  /** Move this far on a busy frequency or a QSY request, Hz. */
  qsyStep: number;
  /** Key the first CQ 5 s in, without listening to the frequency. */
  blindStart: boolean;
  /** Answer callers at all (false: CQ after CQ and never pick anyone — CQ repeat left running). */
  pick: boolean;
  /**
   * The desk's CQ repeat: with no partner, CQ again this many seconds after our last
   * transmission and the last caller's (null: CQ only once the frequency has gone quiet).
   */
  cqRepeat: number | null;
}

export const PERFECT_BOT: BotOptions = {
  callErrorRate: 0, partialRate: 0, ignoreCorrections: false, phantomRate: 0, wpm: 20, cqListen: 4, filter: 500, copyErrors: {},
  qrl: true, qrlListen: 4, qsyStep: 1000, blindStart: false, pick: true, cqRepeat: null,
};

/** A plausible operator: rarely wrong in the clear, much more under QRM, an overlap or a doubling. */
export const HUMAN_COPY: Partial<Record<CopySituation, number>> = {
  clean: 0.01, weak: 0.07, qsb: 0.06, qrn: 0.06, qrm: 0.12, overlap: 0.35, detuned: 0.3, doubled: 0.35, unheard: 1,
};

/** Band conditions for a headless run: the rig's levels and background stations. */
export interface SimBand { noise: number; qsb: number; qrn: number; qrm: number }

export interface SimOptions {
  seed: number;
  params?: Partial<RunParams>;
  me?: AgentMe;
  bot?: Partial<BotOptions>;
  /** Residents placed around the start frequency; none unless given. */
  placement?: Placement;
  /** Sample the band and judge copy like the app (and let the bot miscopy by condition). */
  band?: SimBand;
  /** Run length before the bot goes QRT, seconds. */
  duration?: number;
  /** Longest wait after QRT for the last contact and every caller to settle, seconds. */
  drain?: number;
  step?: number;
  /** Every transmission on the air, ours ('me') and every station's, as it is keyed (golden tests). */
  onAir?: (event: SimAirEvent) => void;
}

/** One transmission as the sim saw it go out. */
export interface SimAirEvent { from: 'me' | number; text: string; rf: number; start: number; end: number; wpm?: number }

export interface SimReport {
  result: RunResult;
  run: RunSession;
  /** Our transmissions. */
  tx: number;
  cqs: number;
  /** Clock when the bot went QRT. */
  qrtAt: number;
  /** QRL? sent, and frequency moves made. */
  qrls: number;
  qsys: number;
  /** Procedure issues the run flagged on our transmissions. */
  issues: string[];
  /** Callers waiting or holding, sampled each second until QRT. */
  waiting: { max: number; mean: number; samples: number[] };
  /** Every caller gone and the frequency quiet before the drain ran out. */
  settled: boolean;
  /** With a band: the run scored as the desk scores it. */
  score: RunScore | null;
  rx: RxRecord[];
  monitor: CopyMonitor | null;
}

// The developer's own call stands in for the operator.
const ME: AgentMe = { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };
const START_VFO = 7_012_000;

interface Partner { stationId: number; sent: string; closing: boolean; since: number; agn: number }

export function runSim({ seed, params, me = ME, bot: botOptions, placement, band, duration = 300, drain = 300, step = 0.05, onAir }: SimOptions): SimReport {
  const random = seeded(seed);
  const bot = { ...PERFECT_BOT, ...botOptions };
  const radio = new HeadlessRadio(random);
  const run = new RunSession({ random, me, params: { ...DEFAULT_RUN_PARAMS, ...params } }, radio);
  const monitor = band ? new CopyMonitor() : null;
  const rx: RxRecord[] = [];
  const recordOf = new Map<string, RxRecord>();
  // A separate stream for the band, so the same seed runs the same callers with or without it.
  const bandRandom = seeded(seed + 7919);
  const crashes: { t: number; dur: number; level: number }[] = [];
  if (band) radio.background = makeQrm(bandRandom, band.qrm, START_VFO, [START_VFO], 400);
  radio.stationsChanged([]);
  radio.onTransmission = (station, tx) => {
    onAir?.({ from: station.id, text: tx.text, rf: station.rf, start: tx.start, end: tx.start + tx.length, wpm: station.wpm });
    run.onStationTransmission(station, tx);
    if (!monitor || station.role !== 'caller') return;
    const record: RxRecord = { tx, station: station.id, epoch: 0, cutAt: null };
    rx.push(record);
    recordOf.set(`${station.id}@${tx.start}`, record);
  };
  if (placement) run.populate(START_VFO, 0, placement);
  let vfo = START_VFO;
  /** Frequency check before CQ: unchecked → (QRL?) checking → clear. */
  let check: { state: 'unchecked' | 'checking' | 'clear'; at: number } = { state: bot.qrl ? 'unchecked' : 'clear', at: 0 };
  let qrls = 0;
  let qsys = 0;
  const issues: string[] = [];
  let procedureTx = 0;
  const residentIds = () => new Set(run.residents.map((agent) => agent.id));

  const myTx: [number, number][] = [];
  let busyUntil = 0;
  let lastTxEnd = -Infinity;
  let lastAirAt = -Infinity;
  let txCount = 0;
  let cqs = 0;
  let partner: Partner | null = null;
  /** The frequency we last worked a station on. */
  let workedAt: number | null = null;
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
    onAir?.({ from: 'me', text, rf: vfo, start, end });
    // Reported as keying starts, like the app does once the rig has the length.
    const flagged = run.transmit(text, { start, end, rf: vfo }).issues;
    issues.push(...flagged);
    if (flagged.length) procedureTx += 1;
  };
  const exchange = (call: string) => `${call} UR 599 NAME ${me.name} QTH ${me.qth} BK`;
  const heardByBot = (event: AirEvent) =>
    event.from !== 'me' && Math.abs(event.rf - vfo) <= bot.filter / 2 && !myTx.some(([start, end]) => start < event.end && event.start < end);
  const transmittingAt = (at: number) => myTx.some(([start, stop]) => at >= start && at <= stop);
  /** What the bot writes down for `value` as sent in `event`: each character miscopied by what it went through. */
  const copyOf = (value: string, event: AirEvent) => {
    const record = monitor ? recordOf.get(`${event.from}@${event.start}`) : undefined;
    if (!monitor || !record) return value;
    const judged = judgeValue(value, [record], monitor, { t: radio.t, epoch: 0 });
    return [...value].map((char, index) => {
      const judgement = judged[index];
      const rate = bot.copyErrors[situationOf(judgement.condition, judgement.env)] ?? 0;
      if (random() >= rate) return char;
      const pool = /[0-9]/.test(char) ? '0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return pool[(pool.indexOf(char) + 1 + Math.floor(random() * (pool.length - 1))) % pool.length];
    }).join('');
  };
  const wordAfter = (text: string, key: string) => new RegExp(`\\b${key} (\\S+)`).exec(text)?.[1] ?? '';
  const mutate = (call: string) => {
    const index = call.length - 1 - Math.floor(random() * 3);
    const letter = String.fromCharCode(65 + ((call.charCodeAt(index) - 65 + 1 + Math.floor(random() * 24)) % 26));
    return `${call.slice(0, index)}${letter}${call.slice(index + 1)}`;
  };

  const qrtAt = duration;
  const end = duration + drain;
  const samples: number[] = [];
  let t = 0;
  for (; t <= end; t = Math.round((t + step) * 1000) / 1000) {
    radio.advance(t);
    if (band && monitor && Math.abs(t * 10 - Math.round(t * 10)) < 1e-6) {
      for (const station of radio.stations) station.fade = fadeAt(station, t, band.qsb);
      if (bandRandom() < band.qrn * 0.08) crashes.push({ t, dur: 0.05 + bandRandom() * 0.25, level: 0.3 + bandRandom() * 0.7 * band.qrn });
      const crash = crashes.reduce((level, item) => (t >= item.t && t <= item.t + item.dur ? Math.max(level, item.level) : level), 0);
      for (const target of radio.stations) {
        if (target.role !== 'caller') continue;
        monitor.push(sampleBand({ t, epoch: 0, listening: !transmittingAt(t), vfo, filter: bot.filter, noise: band.noise, target, stations: radio.stations, crash }));
      }
    }
    if (t < qrtAt && Math.abs(t - Math.round(t)) < step / 2) {
      samples.push(run.agents.filter((agent) => agent.state === 'waiting' || agent.state === 'holding').length);
    }
    // Residents stay on the band; a run has settled once every caller has gone.
    if (t >= qrtAt && !partner && t >= busyUntil && run.agents.every((agent) => agent.gone)) break;
    inbox.push(...run.tick(t).filter(heardByBot));
    if (t < busyUntil) continue;
    lastTxEnd = Math.max(lastTxEnd, busyUntil);

    // Listen.
    const events = inbox.splice(0);
    const residents = residentIds();
    for (const event of events) {
      // Someone using this frequency: heard while checking it, an answer to our QRL?, or a request to move.
      if (residents.has(event.from as number)) {
        if (check.state !== 'clear' || /\bQSY\b/.test(event.text)) {
          vfo += bot.qsyStep;
          qsys += 1;
          check = { state: bot.qrl ? 'unchecked' : 'clear', at: t };
          partner = null;
          heard = [];
        }
        continue;
      }
      const agent = agentOf(event.from as number);
      if (!agent) continue;
      const text = event.text;
      if (partner && event.from === partner.stationId) {
        if (/\bEE\b/.test(text) && partner.closing) {
          partner = null;
          continue;
        }
        if (/NAME [A-Z]/.test(text) && !partner.closing) {
          const rst = wordAfter(text, 'UR') || agent.persona.rst;
          run.logEntry({ call: partner.sent, rst: copyOf(rst, event), name: copyOf(wordAfter(text, 'NAME') || agent.persona.name, event), qth: copyOf(wordAfter(text, 'QTH') || agent.persona.qth, event) }, t);
          if (random() < bot.phantomRate) run.logEntry({ call: 'JQ9QQQ', rst: '599', name: 'X', qth: 'X' }, t);
          partner.closing = true;
          partner.since = t;
          workedAt = vfo;
          send(`R TNX ${agent.persona.name} 73 TU DE ${me.call} QRZ?`);
          break;
        }
        if (/(NAME|QTH|RST)\?/.test(text)) {
          send(`NAME ${me.name} QTH ${me.qth} BK`);
          break;
        }
        if (text.includes(agent.call) && partner.sent !== agent.call && !bot.ignoreCorrections) partner.sent = copyOf(agent.call, event);
        if (!partner.closing) {
          send(exchange(partner.sent));
          partner.since = t;
          break;
        }
        continue;
      }
      if (!partner && text.includes(agent.call) && !heard.some((item) => item.stationId === agent.id)) heard.push({ stationId: agent.id, call: copyOf(agent.call, event), at: t });
    }
    if (t < busyUntil) continue;
    if (bot.cqRepeat !== null && !partner && !(bot.pick && heard.length) && check.state === 'clear' && t < qrtAt && cqs > 0 && t - Math.max(lastTxEnd, run.callersQuietFrom(vfo, t)) >= bot.cqRepeat) {
      cqs += 1;
      send(`CQ DE ${me.call} ${me.call} K`);
      continue;
    }
    if (bot.blindStart && txCount === 0 && t >= 5) {
      cqs += 1;
      send(`CQ DE ${me.call} ${me.call} K`);
      continue;
    }

    // Act — but not over a signal in the passband. Our partner always gets to finish;
    // a pileup that never pauses gets answered 1.5 s after we copied a call.
    const keyingNow = (station: Station) => station.busyUntil > t || station.queue.length > 0;
    const inPassband = run.stations.filter((station) => Math.abs(station.rf - vfo) <= bot.filter / 2);
    const keying = inPassband.some(keyingNow);
    if (keying) lastAirAt = t;
    // Someone else (not a caller) keying in the passband while we check, or before a run has
    // got going here: in use, move on. Once we work stations here it's QRM on our run.
    const resident = radio.stations.some((station) => station.role !== 'caller' && Math.abs(station.rf - vfo) <= Math.min(bot.filter / 2, BUSY_HZ) && keyingNow(station));
    if (bot.qrl && resident && !partner && !heard.length && (check.state === 'checking' || workedAt !== vfo)) {
      vfo += bot.qsyStep;
      qsys += 1;
      check = { state: 'unchecked', at: t };
      heard = [];
      continue;
    }
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
      const candidate = bot.pick ? heard[0] : undefined;
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
      } else if (!candidate && check.state === 'unchecked' && t - Math.max(lastTxEnd, lastAirAt) >= 1) {
        check = { state: 'checking', at: t };
        qrls += 1;
        send(`QRL? DE ${me.call}`);
      } else if (!candidate && check.state === 'checking') {
        if (t - Math.max(lastTxEnd, lastAirAt) >= bot.qrlListen) check = { state: 'clear', at: t };
      } else if (!candidate && t - Math.max(lastTxEnd, lastAirAt) >= bot.cqListen) {
        cqs += 1;
        send(`CQ DE ${me.call} ${me.call} K`);
      }
    }
  }
  const waiting = { max: Math.max(0, ...samples), mean: samples.length ? samples.reduce((sum, value) => sum + value, 0) / samples.length : 0, samples };
  const settled = run.agents.every((agent) => agent.gone) && !partner;
  const result = run.finish(t);
  const score = monitor ? scoreRun({
    result, preset: BASIC_RST_NAME_QTH, recordsOf: (id) => rx.filter((record) => record.station === id), monitor, now: { t, epoch: 0 }, tx: { total: txCount, procedure: procedureTx },
  }) : null;
  return { result, run, tx: txCount, cqs, qrtAt, qrls, qsys, issues, waiting, settled, score, rx, monitor };
}
