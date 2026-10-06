import type { CopyCondition } from '../../types';
import { judgeChar, type ClockNow, type CopyMonitor, type RxRecord } from '../conditions';
import { normalizeCall, normalizeRst } from '../qso';
import { normalizeWabunCopy } from '../../wabunInput';
import { LEVEL_FACTS, type WabunFact, type WabunLevel, type WabunTruth } from './scenario';
import type { SegmentSpan } from './segments';
import type { Utterance } from './utterance';

/**
 * What of a wabun station actually reached us, and what we logged from it.
 *
 * A character counts as received only when the receiver was listening while it was
 * keyed: sent while we transmitted it is 'muted' (on the waterfall, never heard), cut
 * off or still to come it is 'unheard'. Those show as ・ in the heard text.
 */

export const NOT_HEARD = '・';
const lost = (condition: CopyCondition) => condition === 'muted' || condition === 'unheard';

export interface HeardChar { char: string; script: SegmentSpan['script'] | 'roman'; condition: CopyCondition }
export interface HeardOver {
  /** The notation it went out as. */
  text: string;
  /** Word by word as it reached us (・ for every character not heard). */
  heard: string;
  words: HeardChar[][];
  /** Nothing of it reached us. */
  silent: boolean;
}

const shown = (char: string) => (char === '[ホレ]' ? 'ホレ' : char === '[ラタ]' ? 'ラタ' : char);

/** One record, judged character by character. */
export function heardOver(monitor: CopyMonitor, record: RxRecord, now: ClockNow): HeardOver {
  const words: HeardChar[][] = [];
  for (const span of record.tx.chars) {
    const { condition } = judgeChar(monitor, record, span, now);
    const script = 'script' in span ? (span as SegmentSpan).script : 'roman';
    (words[span.word] ??= []).push({ char: span.char, script, condition });
  }
  const list = words.filter(Boolean);
  return {
    text: record.tx.text,
    heard: list.map((word) => word.map((char) => (lost(char.condition) ? NOT_HEARD : shown(char.char))).join('')).join(' '),
    words: list,
    silent: list.every((word) => word.every((char) => lost(char.condition))),
  };
}

/** A station's overs for the review: nothing that never reached us, and a looped CQ once. */
export const heardOvers = (monitor: CopyMonitor, records: RxRecord[], now: ClockNow) =>
  records.map((record) => heardOver(monitor, record, now))
    .filter((over) => !over.silent)
    .filter((over, index, list) => over.text !== list[index - 1]?.text);

/** How a fact first reached us whole: in the over that told it, or only in a repeat we asked for. */
export type FactReach = 'first' | 'repeat' | null;

/**
 * How one telling of a fact came to us: its word heard whole, keyed while we were
 * transmitting (muted: on the waterfall, never heard), or cut off / not yet sent.
 */
export type Reception = 'reached' | 'muted' | 'unheard';

/**
 * A fact through the QSO: its first telling (the first time each over that carries it
 * went out) and any telling again (a fill we asked for, or the same over re-sent), each
 * the best instance. null: never told that way.
 */
export interface FactTelling {
  first: Reception | null;
  again: Reception | null;
  /** Its first telling reached us under a band condition (weak, QSB, QRN, QRM, detuned) on some character. */
  degraded?: boolean;
}

const RECEPTION_RANK: Record<Reception, number> = { reached: 0, muted: 1, unheard: 2 };
const better = (a: Reception | null, b: Reception) => (a === null || RECEPTION_RANK[b] < RECEPTION_RANK[a] ? b : a);

const FACTS: WabunFact[] = ['call', 'rst', 'name', 'qth', 'wx', 'temp', 'condx', 'rig', 'ant', 'pwr', 'key', 'topic', 'detail'];

/**
 * Every fact's first telling and its tellings again. Only what we listened to reaches
 * us: a word keyed under our own TX is muted, whatever the waterfall showed.
 */
export function factTimeline(monitor: CopyMonitor, records: RxRecord[], overs: Utterance[], call: string, now: ClockNow): Record<WabunFact, FactTelling> {
  const timeline = Object.fromEntries(FACTS.map((fact) => [fact, { first: null, again: null }])) as Record<WabunFact, FactTelling>;
  const seen = new Set<string>();
  for (const record of records) {
    const over = overs.find((utterance) => utterance.text === record.tx.text);
    // A fill, or an over keyed again (AGN at Level 1 / 2), tells it again.
    const slot: keyof FactTelling = over?.plan.kind === 'fill' || seen.has(record.tx.text) ? 'again' : 'first';
    seen.add(record.tx.text);
    const { words } = heardOver(monitor, record, now);
    const reception = (index: number): Reception | null => {
      const word = words[index];
      if (!word?.length) return null;
      if (word.every((char) => !lost(char.condition))) return 'reached';
      return word.some((char) => char.condition === 'muted') ? 'muted' : 'unheard';
    };
    const note = (fact: WabunFact, got: Reception | null) => { if (got) timeline[fact][slot] = better(timeline[fact][slot], got); };
    const rough = (index: number) => (words[index] ?? []).some((char) => !lost(char.condition) && char.condition !== 'clean');
    if (over) {
      for (const fact of over.facts) {
        note(fact.fact, reception(fact.word));
        if (slot === 'first' && rough(fact.word)) timeline[fact.fact].degraded = true;
      }
    }
    // The call goes out in Latin in every over ("DE <call>"), not as a planned fact.
    record.tx.text.split(' ').forEach((word, index) => { if (word === call) note('call', reception(index)); });
  }
  return timeline;
}

/** First / repeat / never, from the timeline. */
export const reachOf = (telling: FactTelling): FactReach => (telling.first === 'reached' ? 'first' : telling.again === 'reached' ? 'repeat' : null);

/**
 * Facts that reached us whole at least once: every character of a word carrying the
 * fact was heard (any band condition; whether it was copied is the log's business).
 * Only what we listened to: a fact keyed under our own TX never reached us.
 */
export function factsHeard(monitor: CopyMonitor, records: RxRecord[], overs: Utterance[], call: string, now: ClockNow): Record<WabunFact, boolean> {
  const reach = factsReached(monitor, records, overs, call, now);
  return Object.fromEntries(Object.entries(reach).map(([fact, how]) => [fact, how !== null])) as Record<WabunFact, boolean>;
}

/** factsHeard, telling apart a fact we only got from a repeat (a fill over we asked for, or the over again). */
export function factsReached(monitor: CopyMonitor, records: RxRecord[], overs: Utterance[], call: string, now: ClockNow): Record<WabunFact, FactReach> {
  const timeline = factTimeline(monitor, records, overs, call, now);
  return Object.fromEntries(FACTS.map((fact) => [fact, reachOf(timeline[fact])])) as Record<WabunFact, FactReach>;
}

export interface WabunLog { call: string; rst: string; name: string; qth: string }
export const WABUN_LOG_FIELDS: { key: keyof WabunLog; label: string; wabun: boolean }[] = [
  { key: 'call', label: 'コール', wabun: false },
  { key: 'rst', label: 'RST', wabun: false },
  { key: 'name', label: '名前', wabun: true },
  { key: 'qth', label: 'QTH', wabun: true },
];

/** The log fields a level asks for (Level 1: call and RST only; the theme and the news are not logged). */
export const logFieldsFor = (level: WabunLevel) => WABUN_LOG_FIELDS.filter((field) => LEVEL_FACTS[level].includes(field.key));
export const isLogFact = (fact: WabunFact): fact is keyof WabunLog => fact === 'call' || fact === 'rst' || fact === 'name' || fact === 'qth';

export interface WabunFieldResult { key: keyof WabunLog; label: string; logged: string; expected: string; correct: boolean }

/** The log against the truth. Name and QTH compare as telegraph kana (ガ = カ゛, small kana full-size); QTH with or without シ / ト. */
export function scoreWabunLog(truth: WabunTruth, log: WabunLog): WabunFieldResult[] {
  const kana = (value: string) => normalizeWabunCopy(value);
  const qth = kana(log.qth);
  const checks: Record<keyof WabunLog, [string, boolean]> = {
    call: [truth.call, normalizeCall(log.call) === truth.call],
    rst: [truth.rst, normalizeRst(log.rst) === truth.rst],
    name: [truth.name, kana(log.name) !== '' && kana(log.name) === kana(truth.name)],
    qth: [`${truth.qth}${truth.qthSuffix}`, qth !== '' && (qth === kana(truth.qth) || qth === kana(`${truth.qth}${truth.qthSuffix}`))],
  };
  return WABUN_LOG_FIELDS.map(({ key, label }) => ({ key, label, logged: log[key], expected: checks[key][0], correct: checks[key][1] }));
}
