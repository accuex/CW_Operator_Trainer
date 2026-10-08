import type { AnswerLog, QsoAssist } from '../../types';
import type { WabunEvidence } from '../wabun/review';
import type { QsoEvidence } from '../difficulty';
import type { FieldResult } from '../attribution';
import type { Transmission } from '../band';
import { DECODE_REASONS, decodedText, type DecodedChar, type DecodeReason } from './decoder';
import { voice } from './tables';

/**
 * DECODE as an aid, kept apart from the ear. A session records how DECODE was used —
 * never that something was "read" from it:
 *
 *   off      DECODE never on while the receiver listened
 *   on       on, nothing printed
 *   shown    on and it printed; `loggedShown` counts logged values it had also printed
 *            (the log may or may not have come from it)
 *
 * When it printed, the copy evidence of the session (clean / band characters, calls)
 * does not go into the copy skills or おまかせ's speed and band axes: the screen may have
 * done the copying. Tuning and procedure count as always.
 */

export interface DecodeUsage {
  /** Seconds DECODE was on while the receiver listened. */
  onSeconds: number;
  /** Characters it printed. */
  shown: number;
  /** What it printed (bounded, for the dev trace and `loggedShown`). */
  chars: DecodedChar[];
  /** Highest `seq` taken from the decoder. */
  seq: number;
}

const KEEP = 3000;

export const newDecodeUsage = (): DecodeUsage => ({ onSeconds: 0, shown: 0, chars: [], seq: 0 });

/** Take the decoder's new characters (and a rewrite of the last one by a voiced mark). */
export function followDecoder(usage: DecodeUsage, chars: readonly DecodedChar[]) {
  for (let index = chars.length - 1; index >= 0; index -= 1) {
    if (chars[index].seq < usage.seq) {
      collect(usage, chars.slice(index + 1));
      return;
    }
  }
  collect(usage, chars);
}

function collect(usage: DecodeUsage, fresh: readonly DecodedChar[]) {
  for (const char of fresh) {
    const last = usage.chars.at(-1);
    if (last && last.seq === char.seq) {
      if (last.text !== char.text) usage.chars[usage.chars.length - 1] = char;
      continue;
    }
    usage.chars.push(char);
    if (char.mark !== 'space') usage.shown += 1;
    usage.seq = char.seq;
  }
  if (usage.chars.length > KEEP) usage.chars.splice(0, usage.chars.length - KEEP);
}

const normal = (value: string) => value.toUpperCase().normalize('NFKC').replace(/[ァィゥェォッャュョヮ]/g, (small) => String.fromCharCode(small.charCodeAt(0) + 1));

/** The session's DECODE use (undefined: never on). `logged`: the values put in the log. */
export function decodeAssist(usage: DecodeUsage | undefined, logged: readonly string[] = []): QsoAssist | undefined {
  if (!usage || usage.onSeconds <= 0) return undefined;
  const words = new Set(decodedText(usage.chars.filter((char) => char.mark !== 'unknown')).split(' ').filter(Boolean).map(normal));
  const loggedShown = logged
    .map((value) => normal(value.trim()))
    .filter((value) => value.length >= 2 && value.split(/\s+/).every((word) => words.has(word))).length;
  return {
    decode: usage.shown > 0 ? 'shown' : 'on',
    decodeUsed: true,
    decodeSeconds: Math.round(usage.onSeconds),
    decodeShown: usage.shown,
    loggedShown,
  };
}

/** The session's copy put aside (DECODE printed: the ear's share can't be told apart). */
export const isAssisted = (assist: QsoAssist | undefined | null) => assist?.decode === 'shown';

export function withoutCopy(evidence: QsoEvidence): QsoEvidence {
  const rest = { ...evidence };
  delete rest.overlap;
  delete rest.calls;
  return { ...rest, clean: { total: 0, correct: 0 }, env: {}, causes: { ...evidence.causes, copy: 0, environment: 0 } };
}

/**
 * A QSO (or a run's contact) for the badges when DECODE printed: no copy in it (実戦マーク,
 * the call, the speed and band badges); zero-in and hand keying count as always.
 */
export const outcomeWithoutCopy = <T extends { fields: FieldResult[]; evidence: QsoEvidence }>(outcome: T): T =>
  ({ ...outcome, fields: [], evidence: withoutCopy(outcome.evidence) });

/** A session's answers when DECODE printed: kept, but out of weak-character analysis. */
export const assistedAnswers = (answers: AnswerLog[], assist: QsoAssist | undefined | null): AnswerLog[] =>
  isAssisted(assist) ? answers.map((answer) => (answer.qso ? { ...answer, qso: { ...answer.qso, blame: 'decode' } } : answer)) : answers;

/** Wabun: no memo copy, and the facts' paths kept but not their estimates (nothing for speed / load / rf / fist). */
export function wabunWithoutCopy(evidence: WabunEvidence): WabunEvidence {
  const follow = evidence['follow.wabun'];
  return { 'copy.wabun': null, 'follow.wabun': { total: 0, correct: 0, first: 0, paths: follow.paths } };
}

/** One review line: DECODE's use, never that anything was read from it. */
export function decodeNote(assist: QsoAssist | undefined | null) {
  if (!assist) return null;
  if (assist.decode === 'on') return `DECODE: オン（${assist.decodeSeconds} 秒・表示なし）。受信の評価はいつも通りです。`;
  return `DECODE: オン（${assist.decodeSeconds} 秒・${assist.decodeShown} 字表示）。画面の補助があったので、この回の受信はスキル・苦手分析・自動調整の速さには入れていません。`;
}

/** One over of a station: what it keyed, what DECODE printed, how sure and why not. */
export interface DecodeOverTrace {
  station: number;
  start: number;
  truth: string;
  decoded: string;
  /** Mean confidence of its characters. */
  conf: number;
  unknown: number;
  unsure: number;
  reasons: Partial<Record<DecodeReason, number>>;
  /** Speed estimate at its end. */
  wpm: number | null;
  /** Tuning offset (largest) and filter. */
  offset: number | null;
  filter: number | null;
}

/** What a station keyed, as text (switches as [ホレ] / [ラタ], voiced marks joined). */
export function keyedTruth(tx: Pick<Transmission, 'chars'>) {
  let out = '';
  let word = -1;
  for (const span of tx.chars) {
    if (span.word !== word && word !== -1) out += ' ';
    word = span.word;
    const joined = (span.char === '゛' || span.char === '゜') && out ? voice(out.at(-1)!, span.char) : null;
    out = joined ? out.slice(0, -1) + joined : out + span.char;
  }
  return out;
}

/** Each over (of the copied stations) against what DECODE printed while it was keyed. */
export function compareDecode(records: readonly { tx: Transmission; station: number; epoch: number }[], chars: readonly DecodedChar[]): DecodeOverTrace[] {
  return records.map(({ tx, station, epoch }) => {
    const end = tx.start + tx.length;
    const inside = chars.filter((char) => char.epoch === epoch && char.start >= tx.start - 0.1 && char.start <= end + 0.1 && (char.mark === 'space' || char.source === station));
    const printed = inside.filter((char) => char.mark !== 'space');
    const reasons: Partial<Record<DecodeReason, number>> = {};
    for (const char of printed) for (const reason of char.reasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
    const offsets = printed.map((char) => char.env?.offset ?? 0);
    return {
      station,
      start: tx.start,
      truth: keyedTruth(tx),
      decoded: decodedText(inside),
      conf: printed.length ? Math.round((printed.reduce((sum, char) => sum + char.conf, 0) / printed.length) * 100) / 100 : 0,
      unknown: printed.filter((char) => char.mark === 'unknown').length,
      unsure: printed.filter((char) => char.mark === 'unsure').length,
      reasons: Object.fromEntries(DECODE_REASONS.filter((reason) => reasons[reason]).map((reason) => [reason, reasons[reason]])),
      wpm: printed.at(-1)?.wpm ?? null,
      offset: offsets.length ? offsets.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0) : null,
      filter: printed.at(-1)?.env?.filter ?? null,
    };
  });
}
