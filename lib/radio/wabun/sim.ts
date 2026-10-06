import { cutStation, enqueue, isKeyed, makeStation, schedulePending, type Station } from '../band';
import { CopyMonitor, markCut, sampleBand, type RxRecord } from '../conditions';
import { normalizeWabunCopy } from '../../wabunInput';
import { seeded } from '../random';
import type { WabunPhase, WabunTxResult } from './dialogue';
import { factTimeline, heardOver, heardOvers, isLogFact, NOT_HEARD, reachOf, scoreWabunLog, type FactReach, type FactTelling, type HeardOver, type WabunFieldResult, type WabunLog } from './copy';
import { checkChoices, factsToCheck, measureCopy, measureFollow, reviewRepeats, reviewWabun, type WabunRepeatReview, type WabunReview } from './review';
import { reviewProcedure, stationKeying, type WabunProcedure } from './procedure';
import { keySegments } from './segments';
import { WabunSession } from './session';
import { scenarioFacts, type FistOptions, type WabunFact, type WabunLevel, type WabunLoad } from './scenario';
import { traceTransmission, type WabunTxTrace } from './trace';

/**
 * A whole wabun QSO without audio: the rig's scheduler and copy capture on a 100 ms
 * clock, a bot at the key. The bot only acts on what reached it (heard text), never
 * on the station's truth, so a passing run means the station really said it.
 */

const TICK = 0.1;
const LOOKAHEAD = 1.5;
const VFO = 7_012_000;

export interface WabunSimOptions {
  seed: number;
  me?: string;
  myName?: string;
  wpm?: number;
  /** Our keying speed. */
  myWpm?: number;
  crowd?: number;
  noise?: number;
  hour?: number;
  /** Call while its CQ is still going (it is keyed under us: on the scope, not heard). */
  callEarly?: boolean;
  level?: WabunLevel;
  /** The bot's copy memo: every kana it heard, every other word of it, or none. */
  memo?: 'full' | 'partial' | 'none';
  /** Leave the kana facts out of the log (the check then asks; the bot answers from what it heard). */
  blankLog?: boolean;
  /** Our overs; default: the rubber stamp. */
  overs?: Partial<Record<Exclude<WabunPhase, 'done'>, (ctx: OverContext) => string>>;
  /** Give up after this many seconds. */
  limit?: number;
  /** How much the talk carries (Level 3 on). */
  load?: WabunLoad;
  /** Level 5: the station's fist (kind / strength / fatigue). */
  fist?: FistOptions;
  /** The station's level (0.025–1; default 0.6, comfortable). */
  strength?: number;
  /** QSB depth 0–1 (the station fades slowly up and down). */
  qsb?: number;
  /** QRN 0–1 (static crashes now and then). */
  qrn?: number;
  /** A Latin station calling CQ 120 Hz away, inside the passband. */
  qrm?: boolean;
  /** Break in once: key `text` over the station's first over in `phase`, starting just before it keys the word of `beforeFact` (that word and the rest are muted for us). */
  interrupt?: { phase: WabunPhase; beforeFact: WabunFact; text: (ctx: OverContext) => string };
}

/** What the bot knows when it keys an over: `turn` counts its overs in this phase (0: the first), `heard` the station's last over as heard. */
export interface OverContext { npc: string; me: string; heardRst: string; myName: string; turn: number; heard: string }

export interface SimLine { t: number; who: 'npc' | 'me'; text: string; heard?: string }

export interface WabunSimResult {
  session: WabunSession;
  phase: WabunPhase;
  lines: SimLine[];
  replies: WabunTxResult[];
  records: RxRecord[];
  monitor: CopyMonitor;
  heard: HeardOver[];
  log: WabunLog;
  fields: WabunFieldResult[];
  facts: Record<WabunFact, boolean>;
  /** How each fact reached the bot (first time or only in a repeat). */
  reach: Record<WabunFact, FactReach>;
  /** Each fact's first telling and tellings again, as received. */
  timeline: Record<WabunFact, FactTelling>;
  /** How we ran it (apart from copy / follow). */
  procedure: WabunProcedure;
  /** The facts this QSO told (what follow counts). */
  told: WabunFact[];
  /** Each fact word the bot heard whole, as heard (the theme and the news included). */
  heardValues: Partial<Record<WabunFact, string>>;
  repeats: WabunRepeatReview[];
  /** Our transmissions, input / keyed / intent / understood apart. */
  traces: WabunTxTrace[];
  memo: string;
  checks: Partial<Record<WabunFact, string>>;
  review: WabunReview;
  /** Our transmissions on the clock. */
  tx: { start: number; end: number; text: string }[];
  /** Ticks during our TX with some station keyed (drawn on the scope). */
  keyedDuringTx: number;
  /** Characters of the station keyed wholly inside our TX, and how many of them were judged heard (should be none). */
  underTx: { chars: number; heard: number };
  /** After QRT: stations left on the band, transmissions scheduled after it. */
  afterQrt: { stations: number; scheduled: number };
}

type Overs = Required<NonNullable<WabunSimOptions['overs']>>;

/** Level 2: the short rubber stamp back, then TU 73 E E. */
export const DEFAULT_OVERS: Overs = {
  cq: ({ npc, me }) => `${npc ? `${npc} ` : ''}DE ${me} ${me} K`,
  exchange: ({ npc, me, myName }) =>
    `${npc} DE ${me} [ホレ] コンニチハ 」 レポート 599 599 ナマエハ ${myName} ${myName} ヨロシク [ラタ] KN`,
  // Level 3 / 4: an あいづち to the talk over.
  talk: ({ npc, me }) => `${npc} DE ${me} [ホレ] ナルホド イイデスネ アリガトウ [ラタ] KN`,
  // Level 5: a response to the detail.
  chat: ({ npc, me }) => `${npc} DE ${me} [ホレ] ソレハ タノシソウデスネ [ラタ] KN`,
  closing: ({ npc, me }) => `${npc} DE ${me} TU 73 E E`,
};

/** Level 1: the call, then the 打ち逃げ (JF0RRH): one kana phrase, ラタ, Latin to the end. */
export const LEVEL1_OVERS: Overs = {
  cq: DEFAULT_OVERS.cq,
  exchange: ({ npc, me }) => `${npc} DE ${me} UR 599 [ホレ] アリガトウゴザイマシタ [ラタ] 73 TU E E`,
  talk: DEFAULT_OVERS.talk,
  chat: DEFAULT_OVERS.chat,
  closing: DEFAULT_OVERS.closing,
};

export function runWabunSim(options: WabunSimOptions): WabunSimResult {
  const { seed, me = 'JA1ZZZ', myName = 'イトウ', wpm = 13, myWpm = 13, crowd = 3, noise = 0.2, hour = 14, callEarly = false, limit = 900, level = 2, memo: memoKind = 'none', blankLog = false } = options;
  const overs = { ...(level === 1 ? LEVEL1_OVERS : DEFAULT_OVERS), ...options.overs };
  const random = seeded(seed);
  const { load, fist, strength, qsb = 0, qrn = 0, qrm = false } = options;
  const session = new WabunSession({ random, me, vfo: VFO, wpm, hour, crowd, level, offset: 800, load, fist, ...(strength !== undefined ? { strength } : {}) });
  const { target } = session;
  // QRM: a Latin CQ inside the passband (drawn only when asked, so other runs keep their seeds).
  if (qrm) {
    session.stations.push(makeStation(random, { role: 'qrm', call: 'JA9QRM', rf: target.rf + 120, wpm: 18, strength: (strength ?? 0.6) * 0.7, jitter: 0.05, drift: 0, chirp: 0, gap: [1, 3], loop: () => 'CQ CQ DE JA9QRM JA9QRM K' }));
  }
  // The bot tunes straight onto it.
  const vfo = target.rf;
  let stations: Station[] = session.stations;
  const monitor = new CopyMonitor();
  const records: RxRecord[] = [];
  const lines: SimLine[] = [];
  const replies: WabunTxResult[] = [];
  const tx: WabunSimResult['tx'] = [];
  const traces: WabunTxTrace[] = [];
  let txUntil = 0;
  let pending: string | null = null;
  let keyedDuringTx = 0;
  let qrtAt: number | null = null;
  let scheduledAfterQrt = 0;
  const log: WabunLog = { call: '', rst: '', name: '', qth: '' };
  const heardValues: Partial<Record<WabunFact, string>> = {};
  const turns: Partial<Record<WabunPhase, number>> = {};
  const turn = (phase: WabunPhase) => { const count = turns[phase] ?? 0; turns[phase] = count + 1; return count; };
  const now = (t: number) => ({ t, epoch: 0 });

  const finished = (t: number) => records.filter((record) => record.station === target.id && Math.min(record.tx.start + record.tx.length, record.cutAt ?? Infinity) <= t);
  /** The latest over of the station that went out whole and has ended. */
  const lastOver = (t: number) => finished(t).filter((record) => record.cutAt === null).at(-1) ?? null;
  const breakIns: boolean[] = [];
  const send = (t: number, text: string) => {
    const keyed = keySegments(text, { wpm: myWpm });
    const start = Math.max(t, txUntil) + 0.05;
    breakIns.push(stationKeying(records, target.id, start));
    txUntil = start + keyed.length;
    session.onKeying({ start, end: txUntil }, vfo - target.rf);
    tx.push({ start, end: txUntil, text });
    lines.push({ t: start, who: 'me', text });
    pending = text;
  };
  let acted: RxRecord | null = null;
  let interrupted = false;

  for (let t = 0; t < limit; t += TICK) {
    for (const station of stations) {
      for (const transmission of schedulePending(station, t, t + LOOKAHEAD, random)) {
        if (qrtAt !== null) scheduledAfterQrt += 1;
        if (station !== target) continue;
        records.push({ tx: transmission, station: station.id, epoch: 0, cutAt: null });
      }
    }
    const listening = t >= txUntil;
    if (!listening && stations.some((station) => isKeyed(station, t))) keyedDuringTx += 1;
    if (qsb) target.fade = 1 - qsb * (0.5 + 0.5 * Math.sin((t / 9) * 2 * Math.PI));
    const crash = qrn && random() < qrn * 0.08 ? qrn : 0;
    if (stations.includes(target)) {
      monitor.push(sampleBand({ t, epoch: 0, listening, vfo, filter: 500, noise, target, stations, crash }));
    }
    if (qrtAt !== null) continue;

    // Our over ended: the station answers.
    if (pending !== null && listening) {
      const phaseBefore = session.phase;
      const result = session.onTransmit(pending, { offsetHz: vfo - target.rf });
      replies.push(result);
      traces.push(traceTransmission(pending, pending, result, { phase: phaseBefore, breakIn: breakIns[traces.length] }));
      pending = null;
      if (result.reply) {
        cutStation(target, t);
        markCut(records, 0, t, target.id);
        enqueue(target, result.reply.text, t, 0.6 + random() * 0.9);
      }
      continue;
    }
    if (!listening || pending !== null) continue;

    const phase = session.phase;
    if (phase === 'cq') {
      // Early: a CQ has started and we key over its tail. Otherwise wait for a whole CQ.
      const current = records.filter((record) => record.station === target.id).at(-1);
      if (callEarly && current && current !== acted && t > current.tx.start + 1) {
        acted = current;
        send(t, overs.cq({ npc: callOf(heardOf(current, t)) ?? '', me, heardRst: '', myName, turn: turn('cq'), heard: heardOf(current, t) }));
        continue;
      }
      const over = lastOver(t);
      if (!callEarly && over && over !== acted && t > over.tx.start + over.tx.length + 0.3) {
        acted = over;
        const npc = callOf(heardOf(over, t));
        if (npc) send(t, overs.cq({ npc, me, heardRst: '', myName, turn: turn('cq'), heard: heardOf(over, t) }));
      }
      continue;
    }
    if (options.interrupt && !interrupted && phase === options.interrupt.phase) {
      const current = records.filter((record) => record.station === target.id && record.cutAt === null).at(-1);
      const utterance = current && session.dialogue.overs.find((item) => item.text === current.tx.text);
      const word = utterance?.facts.find((fact) => fact.fact === options.interrupt!.beforeFact)?.word;
      const span = word === undefined ? undefined : current!.tx.chars.find((item) => item.word === word);
      if (current && span && t >= span.start - 0.3) {
        interrupted = true;
        acted = current;
        lines.push({ t: current.tx.start, who: 'npc', text: current.tx.text, heard: heardOf(current, t) });
        readInto(log, heardValues, heardOf(current, t), utterance);
        send(t, options.interrupt.text({ npc: log.call, me, heardRst: log.rst, myName, turn: 0, heard: heardOf(current, t) }));
        continue;
      }
    }
    const over = lastOver(t);
    // Never an over older than the one we last answered (one we broke into is cut, not finished).
    if (!over || over === acted || (acted && over.tx.start <= acted.tx.start) || t < over.tx.start + over.tx.length + 0.4 || target.queue.length) continue;
    acted = over;
    const heard = heardOf(over, t);
    lines.push({ t: over.tx.start, who: 'npc', text: over.tx.text, heard });
    readInto(log, heardValues, heard, session.dialogue.overs.find((utterance) => utterance.text === over.tx.text));
    const npc = log.call || callOf(heard) || '';
    const ctx = { npc, me, heardRst: log.rst || '599', myName, heard };
    if (phase === 'exchange') send(t, overs.exchange({ ...ctx, turn: turn(phase) }));
    else if (phase === 'talk') send(t, overs.talk({ ...ctx, turn: turn(phase) }));
    else if (phase === 'chat') send(t, overs.chat({ ...ctx, turn: turn(phase) }));
    else if (phase === 'closing') send(t, overs.closing({ ...ctx, heardRst: '', turn: turn(phase) }));
    else {
      // done: E E heard. QRT.
      qrtAt = t;
      for (const station of stations) cutStation(station, t);
      markCut(records, 0, t);
      session.stop();
      stations = session.stations;
    }
  }

  const end = now(limit);
  const targetRecords = records.filter((record) => record.station === target.id);
  // The memo: kana the bot heard (whole words only), every word or every other one.
  const heardKana = heardOvers(monitor, targetRecords, end).flatMap((over) => over.words
    .filter((word) => word.length && word.every((char) => char.script === 'wabun' && char.condition !== 'muted' && char.condition !== 'unheard'))
    .map((word) => word.map((char) => char.char).join('')));
  const memo = memoKind === 'none' ? '' : heardKana.filter((_, index) => memoKind === 'full' || index % 2 === 0).join(' ');
  const timeline = factTimeline(monitor, records, session.dialogue.overs, session.truth.call, end);
  const reach = Object.fromEntries(Object.entries(timeline).map(([fact, telling]) => [fact, reachOf(telling)])) as Record<WabunFact, FactReach>;
  const facts = Object.fromEntries(Object.entries(reach).map(([fact, how]) => [fact, how !== null])) as Record<WabunFact, boolean>;
  const told = scenarioFacts(session.scenario);
  const checks: Partial<Record<WabunFact, string>> = {};
  if (blankLog) {
    log.name = '';
    log.qth = '';
  }
  // The check: facts not in the log that reached the bot; it picks the choice it heard ("わからない" if none fits).
  for (const fact of factsToCheck(told, log).filter((item) => reach[item])) {
    checks[fact] = pickHeard(checkChoices(session.truth, fact, random), heardValues[fact]) ?? 'わからない';
  }
  const review = reviewWabun({
    level,
    complete: session.phase === 'done',
    copy: measureCopy(monitor, targetRecords, end, memo),
    follow: measureFollow(told, session.truth, log, reach, checks, { timeline, repeats: session.dialogue.repeats, memo }),
    wpm,
  });
  const heard = records.map((record) => heardOver(monitor, record, end));
  // Station characters keyed while we were keying.
  let chars = 0;
  let heardChars = 0;
  for (const record of records) {
    const over = heardOver(monitor, record, end);
    const flat = over.words.flat();
    record.tx.chars.forEach((span, index) => {
      if (!tx.some((window) => span.start >= window.start && span.end <= window.end)) return;
      chars += 1;
      if (flat[index] && flat[index].condition !== 'muted' && flat[index].condition !== 'unheard') heardChars += 1;
    });
  }
  return {
    session,
    phase: session.phase,
    lines,
    replies,
    records,
    monitor,
    heard,
    log,
    fields: scoreWabunLog(session.truth, log).filter((field) => review.follow.facts.some((fact) => fact.fact === field.key)),
    facts,
    reach,
    timeline,
    procedure: reviewProcedure(traces),
    told,
    heardValues,
    repeats: reviewRepeats(session.dialogue.repeats, review.follow),
    traces,
    memo,
    checks,
    review,
    tx,
    keyedDuringTx,
    underTx: { chars, heard: heardChars },
    afterQrt: { stations: session.stations.length, scheduled: scheduledAfterQrt },
  };

  function heardOf(record: RxRecord, t: number) { return heardOver(monitor, record, now(t)).heard; }
}

/** The call after DE, as heard (none when any of it was lost). */
function callOf(heard: string) {
  const words = heard.split(' ');
  const index = words.lastIndexOf('DE');
  const call = index >= 0 ? words[index + 1] : undefined;
  return call && !call.includes(NOT_HEARD) ? call : null;
}

/** The bot copies the facts from where it heard them (the over's word positions), only whole words. */
function readInto(log: WabunLog, values: Partial<Record<WabunFact, string>>, heard: string, over: { facts: { fact: WabunFact; word: number }[] } | undefined) {
  const words = heard.split(' ');
  log.call ||= callOf(heard) ?? '';
  for (const { fact, word } of over?.facts ?? []) {
    const value = words[word];
    if (!value || value.includes(NOT_HEARD) || fact === 'call') continue;
    values[fact] ||= value.replace(/\?$/, '');
    if (isLogFact(fact)) log[fact] ||= value.replace(/\?$/, '');
  }
}

/** The choice that fits a word heard: numbers by their digits, kana by the start of the word (クツヲ → クツ), the longest fit. */
function pickHeard(choices: string[], heard: string | undefined) {
  if (!heard) return null;
  const digits = (text: string) => text.replace(/[^0-9]/g, '');
  const word = normalizeWabunCopy(heard);
  return choices
    .filter((choice) => (digits(choice) ? digits(choice) === digits(heard) : word.startsWith(normalizeWabunCopy(choice)) || heard === choice))
    .sort((a, b) => b.length - a.length)[0] ?? null;
}
