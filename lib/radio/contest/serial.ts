import { isCallsign } from '../air/intent';

/**
 * Contest serial numbers as they go out on the air and come back into a log.
 *
 * Contesters shorten digits into letters ("cut numbers"): T (or O) for 0 and N for 9 are
 * everywhere; A 1, E 5 and the rarer U 2, V 3, B 7, D 8 come from keyboards that cut
 * everything. Leading zeros are a habit too: "023", "23" or "T23".
 */

/** How far a station cuts its digits. */
export type CutStyle = 'none' | 'tn' | 'tnae' | 'all';
/** Pads to three digits ("023") or not ("23"). */
export interface SerialFormat { cut: CutStyle; pad: boolean }

export const PLAIN_SERIAL: SerialFormat = { cut: 'none', pad: true };

const CUT: Record<Exclude<CutStyle, 'none'>, Record<string, string>> = {
  tn: { 0: 'T', 9: 'N' },
  tnae: { 0: 'T', 9: 'N', 1: 'A', 5: 'E' },
  all: { 0: 'T', 9: 'N', 1: 'A', 5: 'E', 2: 'U', 3: 'V', 7: 'B', 8: 'D' },
};

/** The letters a cut digit may be sent as, and the digit. */
const UNCUT: Record<string, string> = { T: '0', O: '0', N: '9', A: '1', E: '5', U: '2', V: '3', B: '7', D: '8' };

/** Words (procedure and plain English) made only of cut letters: never a serial. */
const WORDS = new Set(['TU', 'NO', 'TO', 'ON', 'AT', 'AN', 'UN', 'BT', 'NE', 'TE', 'ET', 'TNE', 'ONE', 'TEN', 'NET', 'NOT', 'TON', 'DOT', 'NOTE', 'DONE', 'TONE', 'NODE', 'BEAT', 'BENT', 'DENT', 'TEND', 'ANT', 'AUNT', 'TUNE', 'TUBE', 'TOTE']);

/** "23" → "023" / "T23" / "23", as the station keys it. */
export function formatSerial(serial: number, { cut, pad }: SerialFormat) {
  const digits = pad ? String(serial).padStart(3, '0') : String(serial);
  if (cut === 'none') return digits;
  const table = CUT[cut];
  const text = [...digits].map((digit) => table[digit] ?? digit).join('');
  // A cut that would read as a word ("N" alone, "NE") goes out in digits.
  return parseSerial(text) === serial ? text : digits;
}

/**
 * What a word on the air (or typed in the NR box) says as a serial: digits and cut
 * letters only. A word of letters alone counts only if it is mostly T / N (TTN, NT5…),
 * so procedure words ("TU", "EE", "DE") and calls are never read as numbers.
 */
export function parseSerial(word: string): number | null {
  const text = word.toUpperCase().replace(/\?+$/, '');
  if (!text || text.length > 5 || !/^[0-9TONAEUVBD]+$/.test(text)) return null;
  const digits = (text.match(/[0-9]/g) ?? []).length;
  // All letters: only with a T or N in it (the cuts everyone uses), and never a word.
  if (!digits && (text.length < 2 || !/[TN]/.test(text) || WORDS.has(text))) return null;
  const value = Number([...text].map((char) => UNCUT[char] ?? char).join(''));
  return Number.isFinite(value) ? value : null;
}

/** What was typed in the NR box, as a serial (null: nothing usable). */
export const serialOf = (typed: string) => parseSerial(typed.trim().replace(/\s+/g, ''));

/**
 * A call on a contest frequency: call-shaped and not a serial. Cut serials like "24T" or
 * "10N" are call-shaped (digit, digit, letter); no real call is made only of digits and
 * cut letters.
 */
export const isContestCall = (word: string) => isCallsign(word) && parseSerial(word) === null;
