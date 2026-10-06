import { WABUN_MORSE } from '../../morse';
import { normalizeWabunCopy } from '../../wabunInput';
import { judgeChar, type ClockNow, type CopyMonitor, type RxRecord } from '../conditions';
import { isLogFact, reachOf, scoreWabunLog, type FactReach, type FactTelling, type Reception, type WabunLog } from './copy';
import type { WabunRepeat } from './dialogue';
import { ANTENNAS, CONDX, KEYS, POWERS, RIGS, SKIES, TOPIC_DETAILS, TOPIC_SUBJECTS, WABUN_NAMES, WABUN_QTH, type WabunFact, type WabunLevel, type WabunTruth } from './scenario';
import type { SegmentSpan } from './segments';

/**
 * Two skills, measured apart (docs/wabun-qso-design.md §4):
 *
 *   copy.wabun    character by character: of the kana that actually reached us, how much
 *                 did we write down right? Measured on the optional copy memo only; a
 *                 character we could not hear (muted under our TX, cut off) is not ours
 *                 to have missed.
 *   follow.wabun  the QSO's content: did we take the facts this QSO told (CALL / RST /
 *                 NAME / QTH, at Level 3 / 4 the theme and the news too)? From the log,
 *                 and for a fact not in the log (left blank, or never a log field) a
 *                 three-way check afterwards (recognising it counts: we followed it
 *                 without spelling it). A fact we only got by asking for it again is
 *                 followed all the same; the review shows it came from the repeat.
 *
 * "Not every character, but the QSO followed" is a success: follow passes whatever
 * copy says. Nothing here touches the profile; `evidence` is shaped for a later
 * skills.copy.wabun / skills.follow.wabun update (total / correct like updateSkills').
 */

export interface WabunCopyMeasure {
  /** Kana units the station keyed in its bodies (each distinct over once). */
  keyed: number;
  /** … that reached us, sent while we transmitted (muted), cut off or never sent (unheard). */
  reached: number;
  muted: number;
  unheard: number;
  /** Units written in the memo, and how many of them match what reached us, in order. */
  written: number;
  matched: number | null;
  /** matched / reached; null: no memo (copy not measured, not failed). */
  accuracy: number | null;
  /** The same over clean characters only (the copy.wabun skill); null: no memo. */
  clean: { total: number; correct: number } | null;
}

/** Where a fact ended: in the log, picked in the check after the QSO, not taken, or never reached us. */
export type FollowState = 'logged' | 'postcheck' | 'missed' | 'not-reached';

/**
 * How it was got, the path kept: a fact we followed only after asking for it again
 * is 'repeat-recovered' (a success, but not the same as taking it the first time).
 */
export type FollowPath = 'logged' | 'postcheck' | 'repeat-recovered' | 'missed' | 'not-reached';
export const FOLLOW_PATHS: FollowPath[] = ['logged', 'postcheck', 'repeat-recovered', 'missed', 'not-reached'];

export interface WabunFollowFact {
  fact: WabunFact;
  expected: string;
  logged: string;
  /** Some full instance of it reached us. */
  reached: boolean;
  /** … in the over that told it, or only in a repeat we asked for. */
  via: FactReach;
  /** The answer picked in the check (kana facts left blank only). */
  checked: string | null;
  state: FollowState;
  path: FollowPath;
  /** Its first telling, and any telling again (null: none). */
  first: Reception | null;
  again: Reception | null;
  /** We asked for it by name (WX AGN?), or for the content / the whole over (AGN, サラオネ), or not at all. */
  asked: 'specific' | 'general' | null;
  /** Written in the copy memo (null: no memo, or a fact the memo can't hold: Latin, digits). */
  memo: boolean | null;
  /** Its first telling reached us through a band condition (おまかせ's RF axis, not the ear's). */
  degraded: boolean;
}

export interface WabunFollowMeasure {
  facts: WabunFollowFact[];
  /** Facts that reached us (the ones we could be asked to follow). */
  required: number;
  followed: number;
  /** … of them only after asking again. */
  recovered: number;
  ok: boolean;
}

export type WabunVerdict = 'copied' | 'followed' | 'missed' | 'incomplete';

/**
 * What the QSO adds to the skills, each from its own evidence:
 *   copy.wabun    memo characters, clean ones apart (null: no memo, not measured)
 *   follow.wabun  facts that reached us; `first` followed without asking again; every path counted
 * Procedure is kept apart (procedure.ts): it never lowers copy or follow.
 */
export interface WabunEvidence {
  'copy.wabun': { total: number; correct: number; clean: { total: number; correct: number }; wpm: number } | null;
  'follow.wabun': {
    total: number; correct: number; first: number; paths: Record<FollowPath, number>;
    /** The same counts for facts first told in the clear and through a band condition (おまかせ only). */
    conditions?: Record<'clean' | 'degraded', { total: number; correct: number; first: number }>;
  };
}

export interface WabunReview {
  level: WabunLevel;
  complete: boolean;
  copy: WabunCopyMeasure;
  follow: WabunFollowMeasure;
  verdict: WabunVerdict;
  evidence: WabunEvidence;
}

/** Copy accuracy that counts as having copied it, not just followed it. */
export const COPY_GOOD = 0.9;

const lost = (condition: string) => condition === 'muted' || condition === 'unheard';
/** Units compared for copy: kana and marks with a wabun code, no digits (RST is Latin-identical) and no 」. */
const copyUnit = (char: string) => Boolean(WABUN_MORSE[char]) && !/^[0-9]$/.test(char) && char !== '」';

export function measureCopy(monitor: CopyMonitor, records: RxRecord[], now: ClockNow, memo: string): WabunCopyMeasure {
  // Each distinct over once, the instance that reached us best (a repeat may have).
  const best = new Map<string, { reached: string[]; clean: boolean[]; keyed: number; muted: number; unheard: number }>();
  for (const record of records) {
    const tally = { reached: [] as string[], clean: [] as boolean[], keyed: 0, muted: 0, unheard: 0 };
    for (const span of record.tx.chars as SegmentSpan[]) {
      if (span.script !== 'wabun' || !copyUnit(span.char)) continue;
      tally.keyed += 1;
      const { condition } = judgeChar(monitor, record, span, now);
      if (condition === 'muted') tally.muted += 1;
      else if (condition === 'unheard') tally.unheard += 1;
      if (!lost(condition)) {
        tally.reached.push(span.char);
        tally.clean.push(condition === 'clean');
      }
    }
    if (!tally.keyed) continue;
    const prior = best.get(record.tx.text);
    if (!prior || tally.reached.length > prior.reached.length) best.set(record.tx.text, tally);
  }
  const overs = [...best.values()];
  const reference = overs.flatMap((over) => over.reached);
  const clean = overs.flatMap((over) => over.clean);
  const written = [...normalizeWabunCopy(memo)].filter(copyUnit);
  const hits = written.length ? lcsHits(written, reference) : null;
  const matched = hits ? hits.filter(Boolean).length : null;
  return {
    keyed: overs.reduce((sum, over) => sum + over.keyed, 0),
    reached: reference.length,
    muted: overs.reduce((sum, over) => sum + over.muted, 0),
    unheard: overs.reduce((sum, over) => sum + over.unheard, 0),
    written: written.length,
    matched,
    accuracy: matched === null || !reference.length ? null : Math.round((matched / reference.length) * 1000) / 1000,
    clean: hits ? { total: clean.filter(Boolean).length, correct: hits.filter((hit, index) => hit && clean[index]).length } : null,
  };
}

/** Which characters of `b` a longest common subsequence with `a` matches. */
function lcsHits(a: string[], b: string[]): boolean[] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const hits = new Array<boolean>(b.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { hits[j] = true; i += 1; j += 1; } else if (table[i + 1][j] >= table[i][j + 1]) i += 1; else j += 1;
  }
  return hits;
}

/** A fact as a person reads it (city without シ / ト, 18ド, 50W, the rig's model). */
export function factDisplay(truth: WabunTruth, fact: WabunFact): string {
  const { weather, shack } = truth;
  switch (fact) {
    case 'call': return truth.call;
    case 'rst': return truth.rst;
    case 'name': return truth.name;
    case 'qth': return truth.qth;
    case 'wx': return weather.sky;
    case 'temp': return `${weather.temp}ド`;
    case 'condx': return weather.condx;
    case 'rig': return shack.rig;
    case 'ant': return shack.ant;
    case 'pwr': return `${shack.pwr}W`;
    case 'key': return shack.key;
    case 'topic': return truth.topic.subject;
    case 'detail': return truth.topic.detail ?? '';
  }
}

/** Facts the check asks about: kana log fields left blank, and every fact the log has no field for. */
export function factsToCheck(facts: WabunFact[], log: WabunLog): WabunFact[] {
  return facts.filter((fact) => (fact === 'name' || fact === 'qth' ? !log[fact].trim() : !isLogFact(fact)));
}

/** Other answers a check can offer for a fact (same kind as the right one). */
function poolOf(truth: WabunTruth, fact: WabunFact): string[] {
  switch (fact) {
    case 'name': return WABUN_NAMES;
    case 'qth': return WABUN_QTH.map(([city]) => city);
    case 'wx': return [...SKIES];
    case 'temp': {
      const { temp } = truth.weather;
      return [temp - 6, temp - 3, temp + 3, temp + 6].filter((value) => value >= 0).map((value) => `${value}ド`);
    }
    case 'condx': return [...CONDX];
    case 'rig': return [...RIGS];
    case 'ant': return [...ANTENNAS];
    case 'pwr': return POWERS.map((value) => `${value}W`);
    case 'key': return [...KEYS];
    case 'topic': return TOPIC_SUBJECTS[truth.topic.kind];
    case 'detail': return TOPIC_DETAILS[truth.topic.kind];
    default: return [];
  }
}

/** Same answer: kana as copied (voicing, small kana), and the same digits (18ド, 50W: the copy normalisation drops digits). */
const digitsOf = (text: string) => text.replace(/[^0-9]/g, '');
const same = (a: string, b: string) => normalizeWabunCopy(a) === normalizeWabunCopy(b) && digitsOf(a) === digitsOf(b);

/** Three answers for a check, the right one among them (shown only after the QSO). */
export function checkChoices(truth: WabunTruth, fact: WabunFact, random: () => number): string[] {
  const right = factDisplay(truth, fact);
  const pool = poolOf(truth, fact).filter((value) => !same(value, right));
  const others: string[] = [];
  while (others.length < 2 && pool.length) others.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  const choices = [right, ...others];
  for (let index = choices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [choices[index], choices[swap]] = [choices[swap], choices[index]];
  }
  return choices;
}

/** Facts a memo can hold: kana (a temperature with its digits); not the Latin call, report, rig or power. */
const MEMO_FACTS: WabunFact[] = ['name', 'qth', 'wx', 'temp', 'condx', 'ant', 'key', 'topic', 'detail'];
const inMemo = (memo: string, value: string) => {
  const kana = normalizeWabunCopy(value);
  return Boolean(kana) && normalizeWabunCopy(memo).includes(kana) && (!digitsOf(value) || memo.includes(digitsOf(value)));
};

export interface FollowContext {
  /** Each fact's tellings (factTimeline); without it, `reached` alone decides. */
  timeline?: Record<WabunFact, FactTelling>;
  /** Our asks for a repeat and what each brought back. */
  repeats?: Pick<WabunRepeat, 'asked' | 'resent'>[];
  memo?: string;
}

/**
 * Follow over the facts the QSO told (`facts`, in order). `reached`: how each reached us
 * (factsReached); a fact that never did is shown but not counted. A fact followed
 * after we asked for it again (it reached us only in the repeat, or we asked for it
 * and the repeat reached us) is 'repeat-recovered': followed, the path kept.
 */
export function measureFollow(
  facts: WabunFact[], truth: WabunTruth, log: WabunLog, reached: Record<WabunFact, FactReach | boolean>,
  checks: Partial<Record<WabunFact, string>> = {}, context: FollowContext = {},
): WabunFollowMeasure {
  const scored = scoreWabunLog(truth, log);
  const list = facts.map((fact): WabunFollowFact => {
    const field = isLogFact(fact) ? scored.find((item) => item.key === fact)! : null;
    const checked = checks[fact] ?? null;
    const telling = context.timeline?.[fact];
    const how = telling ? reachOf(telling) : reached[fact];
    const via: FactReach = how === true ? 'first' : how === false ? null : how;
    const expected = field?.expected ?? factDisplay(truth, fact);
    const state: FollowState = field?.correct ? 'logged'
      : checked !== null && same(checked, factDisplay(truth, fact)) ? 'postcheck'
        : via ? 'missed' : 'not-reached';
    const specific = context.repeats?.some((repeat) => repeat.asked?.includes(fact) && repeat.resent.includes(fact));
    const again = telling?.again ?? (via === 'repeat' ? 'reached' : null);
    // The call heads every over in Latin: a repeat's header is no ask for it.
    const asked = specific ? 'specific' : again !== null && (fact !== 'call' || via === 'repeat') ? 'general' : null;
    const followed = state === 'logged' || state === 'postcheck';
    const recovered = followed && (via === 'repeat' || (asked !== null && again === 'reached'));
    return {
      fact, expected, logged: field ? log[field.key] : '', reached: via !== null, via, checked, state,
      path: recovered ? 'repeat-recovered' : state,
      first: telling?.first ?? (via === 'first' ? 'reached' : null),
      again,
      asked,
      memo: context.memo?.trim() && MEMO_FACTS.includes(fact) ? inMemo(context.memo, factDisplay(truth, fact)) : null,
      degraded: Boolean(telling?.degraded),
    };
  });
  const counted = list.filter((fact) => fact.state !== 'not-reached');
  const followed = counted.filter((fact) => fact.state === 'logged' || fact.state === 'postcheck').length;
  const recovered = counted.filter((fact) => fact.path === 'repeat-recovered').length;
  return { facts: list, required: counted.length, followed, recovered, ok: counted.length > 0 && followed === counted.length };
}

/** Each repeat we asked for, and whether what it re-sent then reached us and was followed. */
export interface WabunRepeatReview {
  asked: WabunFact[] | null;
  resent: WabunFact[];
  /** Re-sent facts we then followed only thanks to a repeat (repeat-recovered). */
  gained: WabunFact[];
}

export function reviewRepeats(repeats: WabunRepeat[], follow: WabunFollowMeasure): WabunRepeatReview[] {
  return repeats.map((repeat) => ({
    asked: repeat.asked,
    resent: repeat.resent,
    gained: repeat.resent.filter((fact) => follow.facts.some((item) => item.fact === fact && item.path === 'repeat-recovered')),
  }));
}

/** Counted facts (reached us), followed, followed the first time. */
function tallyFollow(facts: WabunFollowFact[]) {
  const counted = facts.filter((fact) => fact.state !== 'not-reached');
  const correct = counted.filter((fact) => fact.state === 'logged' || fact.state === 'postcheck');
  return { total: counted.length, correct: correct.length, first: correct.filter((fact) => fact.path !== 'repeat-recovered').length };
}

export function reviewWabun({ level, complete, copy, follow, wpm }: { level: WabunLevel; complete: boolean; copy: WabunCopyMeasure; follow: WabunFollowMeasure; wpm: number }): WabunReview {
  const verdict: WabunVerdict = !complete ? 'incomplete'
    : !follow.ok ? 'missed'
      : copy.accuracy !== null && copy.accuracy >= COPY_GOOD ? 'copied' : 'followed';
  return {
    level,
    complete,
    copy,
    follow,
    verdict,
    evidence: {
      'copy.wabun': copy.matched === null || !copy.reached || !copy.clean ? null : { total: copy.reached, correct: copy.matched, clean: copy.clean, wpm },
      'follow.wabun': {
        total: follow.required,
        correct: follow.followed,
        first: follow.followed - follow.recovered,
        paths: Object.fromEntries(FOLLOW_PATHS.map((path) => [path, follow.facts.filter((fact) => fact.path === path).length])) as Record<FollowPath, number>,
        conditions: { clean: tallyFollow(follow.facts.filter((fact) => !fact.degraded)), degraded: tallyFollow(follow.facts.filter((fact) => fact.degraded)) },
      },
    },
  };
}
