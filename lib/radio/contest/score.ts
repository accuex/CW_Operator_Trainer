import type { CopySituation } from '../../types';
import { align, causeOf, hardestSituation, judgeValue, scoreFields, type CharCell, type FieldResult } from '../attribution';
import { situationOf, type ClockNow, type CopyMonitor, type RxRecord } from '../conditions';
import { normalizeWord, type ExchangePreset } from '../exchange';
import type { JudgedContact, RunBooks } from '../modes/runCore';
import { judgeFirstCall, type FirstCall } from '../runReview';
import { parseSerial, serialOf } from './serial';

/**
 * A contest run judged character by character: for each contact, the call and the serial
 * we logged against what the station really was and really keyed, each character with
 * the easiest conditions it was ever sent under (as a CQ run or a pileup is judged).
 *
 * Serials are compared as numbers, the way a log checker does, and as the station keyed
 * them: a cut number is the contest's way of writing a digit, never a copy error.
 *
 *   keyed "T23", typed "023" / "23" / "T23"  → right (T is 0; leading zeros are padding)
 *   keyed "1N5", typed "195"                 → right
 *   keyed "1N5", typed "155"                 → the N missed: N → E (the typed 5 as the
 *                                              station would have keyed it), so the
 *                                              confusion kept is N/E — what was heard —
 *                                              not 9/5
 *   keyed "1T5", typed "15"                  → the T dropped (a digit lost, heard as nothing)
 *
 * Leading zeros (and leading T / O) are padding: neither side's count is scored.
 */

/** Digit each cut letter stands for. */
const UNCUT: Record<string, string> = { T: '0', O: '0', N: '9', A: '1', E: '5', U: '2', V: '3', B: '7', D: '8' };
/** The letter each digit is cut to (the full table: the one a station cutting everything uses). */
const CUT: Record<string, string> = { 0: 'T', 9: 'N', 1: 'A', 5: 'E', 2: 'U', 3: 'V', 7: 'B', 8: 'D' };

const isCut = (char: string) => char in UNCUT;
const digitOf = (char: string) => UNCUT[char] ?? char;

/** The contest's log line as judged: the call and the serial. */
export const CONTEST_CALL: ExchangePreset = {
  id: 'contest-call',
  kind: 'builtin',
  label: 'コール',
  alphabet: 'international',
  fields: [{ key: 'call', label: 'CALL', normalize: normalizeWord }],
};

/** One contact as judged. */
export interface ContestScoredContact {
  contactId: string;
  /** Our line for it (the first tied to it), if any. */
  logId: string | null;
  /** The call and the serial as logged, character by character; null with no line. */
  fields: FieldResult[] | null;
  /** The first call we sent it, judged on what we could have heard by then. */
  firstCall: FirstCall | null;
  /** The serial as the station keyed it ("T23"), and the hardest situation any of its characters met (null: never keyed to us). */
  keyed: string;
  serialHeard: CopySituation | null;
}

/** Where padding ends: leading zeros (as digits or cut letters), keeping the last digit. */
const padOf = (digits: string) => {
  let index = 0;
  while (index < digits.length - 1 && digits[index] === '0') index += 1;
  return index;
};

/**
 * The serial field: `keyed` as the station sent it, `typed` as we logged it, `judged` the
 * conditions of each keyed character. Expected symbols are the keyed ones (N, T, 5 …); a
 * typed character is shown in the station's form (a cut letter where it keyed one).
 */
export function scoreSerial(keyed: string, typed: string, judged: { situation: CopySituation; condition: CharCell['condition']; env: CharCell['env'] }[]): FieldResult {
  const shown = keyed.toUpperCase();
  const input = typed.toUpperCase().replace(/\s+/g, '');
  const keyedDigits = [...shown].map(digitOf).join('');
  const parsed = serialOf(input) !== null;
  // A typed serial that reads as one is compared in digits; one that doesn't, as typed.
  const inputDigits = parsed ? [...input].map(digitOf).join('') : input;
  const keyedPad = padOf(keyedDigits);
  const inputPad = parsed ? padOf(inputDigits) : 0;
  const expected = keyedDigits.slice(keyedPad);
  const got = inputDigits.slice(inputPad);
  const typedChars = input.slice(inputPad);
  let index = 0;
  let typedIndex = 0;
  const cells = align(expected, got).map((cell): CharCell => {
    if (cell.op === 'ins') {
      const raw = typedChars[typedIndex] ?? cell.input;
      typedIndex += 1;
      return { op: 'ins', expected: '', input: raw, condition: 'clean', situation: 'clean', cause: 'copy', env: null };
    }
    const at = keyedPad + index;
    index += 1;
    const keyedChar = shown[at] ?? cell.expected;
    const judgement = judged[at] ?? { condition: 'unheard' as const, situation: 'unheard' as const, env: null };
    if (cell.op === 'del') return { op: 'del', expected: keyedChar, input: '', condition: judgement.condition, situation: judgement.situation, cause: causeOf(judgement.situation), env: judgement.env };
    const typedChar = typedChars[typedIndex] ?? cell.input;
    typedIndex += 1;
    if (cell.op === 'match') return { op: 'match', expected: keyedChar, input: keyedChar, condition: judgement.condition, situation: judgement.situation, cause: 'ok', env: judgement.env };
    // Heard as: the typed digit in the station's form (a cut letter where it keyed a letter).
    const heard = isCut(keyedChar) ? (CUT[digitOf(typedChar)] ?? typedChar) : digitOf(typedChar);
    return { op: 'sub', expected: keyedChar, input: heard, condition: judgement.condition, situation: judgement.situation, cause: causeOf(judgement.situation), env: judgement.env };
  });
  const correct = parsed && parseSerial(shown) === serialOf(input);
  return { key: 'nr', label: 'NR', expected: shown.slice(keyedPad), input: typedChars, correct, cells };
}

export interface ContestScoreInput {
  result: Pick<RunBooks, 'contacts' | 'log'>;
  /** What we received from one station. */
  recordsOf(stationId: number): RxRecord[];
  /** The serial as station `stationId` keyed it (its agent's own text). */
  keyedOf(stationId: number): string | null;
  monitor: CopyMonitor;
  now: ClockNow;
}

/** The keyed serial's characters, each with the easiest conditions it was sent under. */
function judgeSerial(keyed: string, records: RxRecord[], monitor: CopyMonitor, now: ClockNow) {
  return judgeValue(keyed, records, monitor, now).map((item) => ({ condition: item.condition, env: item.env, situation: situationOf(item.condition, item.env) }));
}

export function scoreContest({ result, recordsOf, keyedOf, monitor, now }: ContestScoreInput): ContestScoredContact[] {
  return result.contacts.map((contact: JudgedContact): ContestScoredContact => {
    const records = recordsOf(contact.stationId);
    const keyed = keyedOf(contact.stationId) ?? contact.truth.nr ?? '';
    const judged = keyed ? judgeSerial(keyed, records, monitor, now) : [];
    const heardAny = judged.some((item) => item.situation !== 'unheard');
    const firstCall = judgeFirstCall(contact.truth.call, contact.sentCalls[0], contact.sentAt[0], records, monitor, now);
    const line = result.log.find((entry) => entry.contactId === contact.id);
    const fields = line
      ? [
        ...scoreFields(CONTEST_CALL, { call: contact.truth.call }, { call: line.fields.call }, records, monitor, now),
        scoreSerial(keyed, line.fields.nr ?? '', judged),
      ]
      : null;
    return {
      contactId: contact.id,
      logId: line?.id ?? null,
      fields,
      firstCall,
      keyed,
      serialHeard: heardAny ? hardestSituation(judged.slice(padOf([...keyed].map(digitOf).join(''))).map((item) => item.situation)) : null,
    };
  });
}
