import { fadeAt, isKeyed, type Station } from '../band';
import { CopyMonitor, sampleBand, type RxRecord } from '../conditions';
import { keyText } from '../keying';
import { isDisciplined } from '../agents/manners';
import type { AgentMe } from '../agents/types';
import { ContestBot, type ContestBotOptions } from '../contest/bot';
import { contestLevel, contestParamsOf, type ContestAxes, type ContestLevelId, type ContestParams } from '../contest/levels';
import {
  contestPartial, EMPTY_INPUT, ESM_START, esmAfter, esmEnter, esmExchange, esmKey, esmLogTu, type EsmAction, type EsmInput, type EsmLog, type EsmState,
} from '../contest/esm';
import { judgeContest, type ContestJudged } from '../contest/judge';
import type { DeskSent } from '../contest/review';
import { parseSerial } from '../contest/serial';
import { ContestRunSession, type ContestResult } from '../modes/contestRun';
import { BOT_PROFILES, type BotAction, type BotProfileId } from '../pileup/bot';
import { PileupEar, SampledProbe } from '../pileup/ear';
import { seeded } from '../random';
import { BOT_SEED, checkNotes, checkReactions, EAR_SEED, PILEUP_BAND, type InvariantBreach } from './pileupSim';
import { HeadlessRadio, type SimAirEvent, type SimBand } from './runSim';

/**
 * Headless contest run: ContestRunSession and the field's callers, the band sampled as
 * the rig does, the pileup ear copying each caller, and a ContestBot running the
 * frequency from what it copied. The simulator alone knows the truth: it checks the
 * run's invariants (every station's serial only climbs, a station logs us only once it
 * has our exchange, everyone settles) and the log check scores the bot's log against
 * the stations' own.
 */

export interface ContestSimOptions {
  seed: number;
  level?: ContestLevelId;
  axes?: Partial<ContestAxes>;
  params?: Partial<ContestParams>;
  bot?: BotProfileId;
  dupes?: ContestBotOptions['dupes'];
  band?: SimBand;
  duration?: number;
  drain?: number;
  onAir?: (event: SimAirEvent) => void;
  /**
   * Send through the desk's ESM: each of the bot's moves becomes what an operator would
   * type (the call it copied, the serial it copied) and the key it would press, and the
   * ESM decides what goes out and what is logged — as on the contest desk.
   */
  esm?: boolean;
}

export interface ContestSimReport {
  result: ContestResult;
  run: ContestRunSession;
  bot: ContestBot;
  qrtAt: number;
  settled: boolean;
  breaches: InvariantBreach[];
  tx: number;
  moves: Record<string, number>;
  /** Callers who came before QRT. */
  arrived: number;
  /** Callers who left unworked before QRT (gave up or moved on). */
  departures: number;
  reactions: Record<string, number>;
  /** Our serials sent, in order of the transmissions that carried them. */
  sentSerials: number[];
  /** With `esm`: what the desk sent, in order. */
  esmActions: EsmAction[];
  /** Our messages as the desk records them (seconds from the start). */
  sent: DeskSent[];
  /** What reached our receiver from the callers (one epoch). */
  records: RxRecord[];
  monitor: CopyMonitor;
  /** The run judged as the desk judges it at QRT: review, scored, air, causes. */
  judged: ContestJudged;
}

const ME: AgentMe = { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };
const VFO = 7_012_000;
const FILTER = 500;
const BOT_WPM = 26;

export function runContestSim({ seed, level = 'intermediate', axes, params, bot: botId = 'average', dupes = 'b4', band = PILEUP_BAND, duration = 300, drain = 1500, onAir, esm = false }: ContestSimOptions): ContestSimReport {
  const random = seeded(seed);
  const radio = new HeadlessRadio(random);
  const run = new ContestRunSession({ random, me: ME, params: { ...contestParamsOf({ ...contestLevel(level).axes, ...axes }), ...params } }, radio);
  const monitor = new CopyMonitor();
  const profile = BOT_PROFILES[botId];
  const probe = new SampledProbe(monitor);
  const ear = new PileupEar(probe, profile.ear, seeded(seed + EAR_SEED));
  const bot = new ContestBot(profile, ME.call, seeded(seed + BOT_SEED), () => run.nextNr, { dupes });

  radio.stationsChanged([]);
  let receiving: { record: RxRecord; station: Station; end: number }[] = [];
  const records: RxRecord[] = [];
  radio.onTransmission = (station, tx) => {
    onAir?.({ from: station.id, text: tx.text, rf: station.rf, start: tx.start, end: tx.start + tx.length, wpm: station.wpm });
    run.onStationTransmission(station, tx);
    if (station.role !== 'caller' || Math.abs(station.rf - VFO) > FILTER / 2) return;
    const record: RxRecord = { tx, station: station.id, epoch: 0, cutAt: null };
    records.push(record);
    receiving.push({ record, station, end: tx.start + tx.length });
  };

  const breaches: InvariantBreach[] = [];
  const breach = (t: number, kind: string, detail: string) => { if (breaches.length < 50) breaches.push({ t, kind, detail }); };
  const send = radio.send.bind(radio);
  radio.send = (station, text, delay) => {
    const agent = run.agents.find((item) => item.id === station.id);
    if (agent && isDisciplined(agent.manners) && run.ether.hearsKeying(agent, 'me', radio.t)) breach(radio.t, 'keyed-over-us', `${agent.call}: ${text}`);
    send(station, text, delay);
  };

  let busyUntil = 0;
  let tx = 0;
  const moves: Record<string, number> = {};
  const sentSerials: number[] = [];
  const esmActions: EsmAction[] = [];
  const deskSent: (DeskSent & { end: number })[] = [];
  let lastEsm: EsmAction | null = null;
  let desk: EsmState = ESM_START;
  const deskLog = (): EsmLog => ({ me: ME.call, nextNr: run.nextNr, isDupe: (call) => run.isDupe(call) });
  /** The bot's move as the operator's keys on the desk: the ESM decides the text and the log. */
  const throughEsm = (action: BotAction, t: number): BotAction | null => {
    const logged = bot.contestLogs.at(-1);
    const input = (call: string, nr = ''): EsmInput => ({ ...EMPTY_INPUT, call, nr });
    const log = deskLog();
    let sent: EsmAction;
    if (action.move === 'cq') sent = esmEnter(desk, EMPTY_INPUT, log);
    else if (action.move === 'partial') sent = contestPartial(action.piece ?? '');
    else if (action.move === 'tu' && action.call && logged?.call === action.call) {
      const typed = input(action.call, logged.nr);
      sent = esmEnter(desk, typed, log);
      // Logged on what it had (no serial): "\" logs the fields as they are.
      if (sent.kind !== 'tu') sent = esmLogTu(desk, typed, log);
    } else if (action.call && action.text.includes('QSO B4')) sent = esmEnter(desk, input(action.call), log);
    else if (action.call && (action.move === 'call' || action.move === 'recall' || action.move === 'correct')) {
      // A fresh call goes by Enter (DUPE: QSO B4 unless the bot works dupes, then ";"); a call sent again is ";".
      sent = action.move === 'call' && !run.isDupe(action.call) ? esmEnter(desk, input(action.call), log) : esmExchange(desk, input(action.call), log);
    } else if (action.text === 'NR?') sent = esmKey(8, desk, EMPTY_INPUT, log);
    else if (action.text === 'AGN?') sent = esmKey(7, desk, EMPTY_INPUT, log);
    else sent = { kind: 'raw', text: action.text };
    if (sent.kind === 'none') return null;
    desk = esmAfter(desk, sent);
    if (sent.log) run.logQso(sent.log, t);
    esmActions.push(sent);
    lastEsm = sent;
    return { ...action, text: sent.text };
  };
  const transmit = (action: BotAction, t: number) => {
    const start = t + 0.05;
    const end = start + keyText(action.text, { wpm: BOT_WPM }).length;
    busyUntil = end;
    tx += 1;
    moves[action.move] = (moves[action.move] ?? 0) + 1;
    onAir?.({ from: 'me', text: action.text, rf: VFO, start, end });
    const kind = lastEsm?.kind ?? KIND_OF_MOVE[action.move] ?? 'raw';
    const subject = lastEsm ? lastEsm.subject : action.call ?? action.piece;
    const nr = lastEsm?.nr;
    deskSent.push({ at: start, end, kind, text: action.text, ...(subject ? { subject } : {}), ...(nr !== undefined ? { nr } : {}) });
    lastEsm = null;
    const { intent } = run.transmit(action.text, { start, end, rf: VFO });
    if (intent.serial !== undefined) sentSerials.push(intent.serial);
    bot.keyed(end);
  };

  const qrtAt = duration;
  const end = duration + drain;
  let pickHeardBy = new Set<number>();
  let t = 0;
  const step = 0.05;
  for (; t <= end; t = Math.round((t + step) * 1000) / 1000) {
    radio.advance(t);
    const sending = t < busyUntil;
    if (Math.abs(t * 10 - Math.round(t * 10)) < 1e-6) {
      for (const station of radio.stations) station.fade = fadeAt(station, t, band.qsb);
      for (const target of radio.stations) {
        if (target.role !== 'caller' || Math.abs(target.rf - VFO) > FILTER / 2) continue;
        monitor.push(sampleBand({ t, epoch: 0, listening: !sending, vfo: VFO, filter: FILTER, noise: band.noise, target, stations: radio.stations, crash: 0 }));
      }
    }
    const due = receiving.filter((item) => item.end + 0.1 <= t);
    if (due.length) {
      receiving = receiving.filter((item) => item.end + 0.1 > t);
      for (const item of due) bot.hear(ear.hear(item.record, { rf: item.station.rf, level: item.station.strength }, VFO, { t, epoch: 0 }));
    }
    const before = new Map(run.agents.map((agent) => [agent.id, agent.state === 'holding' ? agent.standBy : null]));
    const delivered = run.tick(t);
    for (const event of delivered) {
      if (event.from === 'me' && event.intent?.calls.length) pickHeardBy = new Set(run.agents.filter((agent) => run.ether.hears(agent, event)).map((agent) => agent.id));
      if (event.from === 'me' && event.intent && (event.intent.qrz || event.intent.cq || event.intent.partial)) pickHeardBy = new Set();
    }
    checkNotes(run.drainNotes(), delivered, run, t, pickHeardBy, before, breach);
    if (t >= qrtAt && t >= busyUntil && !bot.working && run.agents.every((agent) => agent.gone)) break;

    const keyed = radio.stations.filter((station) => Math.abs(station.rf - VFO) <= FILTER / 2 && isKeyed(station, t));
    const logsBefore = bot.contestLogs.length;
    const action = bot.act({ t, carrier: keyed.length > 0, tones: keyed.map((station) => Math.round(station.rf - VFO)), sending, qrt: t >= qrtAt });
    if (esm) {
      const sent = action && throughEsm(action, t);
      if (sent) transmit(sent, t);
    } else {
      for (const entry of bot.contestLogs.slice(logsBefore)) run.logQso({ call: entry.call, rst: entry.rst, nr: entry.nr }, t);
      if (action) transmit(action, t);
    }
  }

  for (const agent of run.agents) checkReactions(agent, breach);
  checkContest(run, breach, t);
  if (esm) checkEsmSerials(run, esmActions, breach, t);
  const settled = run.agents.every((agent) => agent.gone);
  if (!settled) breach(t, 'unsettled', run.agents.filter((agent) => !agent.gone).map((agent) => `${agent.call}:${agent.state}`).join(' '));
  const result = run.finish(t);
  const rel = (at: number) => Math.round((at - result.clock.start) * 10) / 10;
  const sent = deskSent.map((item) => ({ ...item, at: rel(item.at), end: rel(item.end) }));
  const judged = judgeContest({
    result, sent, records,
    callOf: (id) => result.roster?.[id]?.call ?? null,
    keyedOf: (id) => result.roster?.[id]?.nr || null,
    monitor, now: { t, epoch: 0 },
  });
  const reactions: Record<string, number> = {};
  for (const agent of run.agents) for (const reaction of agent.reactions) reactions[reaction.kind] = (reactions[reaction.kind] ?? 0) + 1;
  const worked = new Set(result.contacts.filter((contact) => contact.outcome !== 'incomplete').map((contact) => contact.stationId));
  return {
    result,
    run,
    bot,
    qrtAt,
    settled,
    breaches,
    tx,
    moves,
    arrived: run.agents.filter((agent) => agent.arrivedAt <= qrtAt).length,
    departures: run.agents.filter((agent) => agent.goneReason && !['never-called', 'b4'].includes(agent.goneReason) && agent.goneAt !== null && agent.goneAt <= qrtAt && !worked.has(agent.id)).length,
    reactions,
    sentSerials,
    esmActions,
    sent,
    records,
    monitor,
    judged,
  };
}

/** What a bot move would be on the desk (without the ESM). */
const KIND_OF_MOVE: Partial<Record<BotAction['move'], DeskSent['kind']>> = {
  cq: 'cq', partial: 'partial', call: 'exchange', recall: 'exchange', correct: 'correct', tu: 'tu',
};

/**
 * The desk's serials: every line logged carries the serial of the last exchange the desk
 * sent before it (to whichever call — a dropped contact's number goes to the next), and
 * the serial shown for the next contact is always the log's next line.
 */
function checkEsmSerials(run: ContestRunSession, actions: readonly EsmAction[], breach: (t: number, kind: string, detail: string) => void, t: number) {
  let lines = 0;
  let lastNr: number | null = null;
  for (const action of actions) {
    if (action.nr !== undefined) {
      if (action.nr !== lines + 1) breach(t, 'esm-serial-ahead', `${action.text}: ${action.nr} with ${lines} logged`);
      lastNr = action.nr;
    }
    if (action.log) {
      const line = run.qsos[lines];
      if (!line) { breach(t, 'esm-log-missing', action.text); continue; }
      if (lastNr !== null && line.sentNr !== lastNr) breach(t, 'esm-serial-logged', `${line.call}: sent ${lastNr}, logged ${line.sentNr}`);
      lines += 1;
      lastNr = null;
    }
  }
  if (lines !== run.qsos.length) breach(t, 'esm-log-count', `${lines} vs ${run.qsos.length}`);
}

/**
 * The field's own invariants: each station's serials only climb and it keys the one it
 * was given; a station has us in its log only from a caller that got our exchange
 * (and didn't take it back); our serial goes up one a logged contact.
 */
function checkContest(run: ContestRunSession, breach: (t: number, kind: string, detail: string) => void, t: number) {
  for (const station of run.field.all) {
    const { given, log, persona } = station;
    if (given.some((serial, index) => index > 0 && serial <= given[index - 1])) breach(t, 'serial-not-rising', `${persona.call}: ${given.join(',')}`);
    for (const line of log) {
      const agent = run.agents.find((item) => item.id === line.agentId);
      if (!agent || !(agent.state === 'exchanged' || agent.state === 'done' || (agent.state === 'gone' && agent.goneReason !== 'b4'))) breach(t, 'logged-without-exchange', `${persona.call} (${agent?.state})`);
      if (agent && agent.contest?.serial !== line.sent) breach(t, 'logged-wrong-serial', `${persona.call}: ${line.sent} vs ${agent.contest?.serial}`);
      if (agent && agent.goneReason === 'b4') breach(t, 'kept-after-b4', persona.call);
    }
  }
  for (const agent of run.agents) {
    if (!agent.contest) breach(t, 'no-serial', agent.call);
    else if (parseSerial(agent.contest.nr) !== agent.contest.serial) breach(t, 'serial-text', `${agent.call}: ${agent.contest.nr} ≠ ${agent.contest.serial}`);
  }
  run.qsos.forEach((line, index) => { if (line.sentNr !== index + 1) breach(t, 'our-serial', `${line.call}: ${line.sentNr} at line ${index + 1}`); });
}
