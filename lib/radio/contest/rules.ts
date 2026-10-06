/**
 * The rules of a contest: what is exchanged, what a contact is worth, what counts as a
 * multiplier and what a bad log line costs. v1 has one made-up contest; a real one
 * later is another ContestRules, never a change to the run or the log check.
 */

export interface ContestRules {
  id: string;
  label: string;
  /** What each side sends after the call. */
  exchange: readonly ('RST' | 'NR')[];
  /** Points for a good contact. */
  points: number;
  /** The multiplier a call counts for. */
  multOf(call: string): string;
  /** Points taken off for a line the other station has no record of (NIL). */
  nilPenalty: number;
  /** Points taken off for a busted call (and the line is removed). */
  bustCallPenalty: number;
  /** Points taken off for a busted serial (the line is removed). */
  bustNrPenalty: number;
}

/**
 * WPX-style prefix: the call up to and including its last digit before the suffix
 * (JA1ABC → JA1, 7K1XYZ → 7K1, JH3AB → JH3). Portable designators are left aside.
 */
export function wpxPrefix(call: string) {
  const base = call.toUpperCase().split('/')[0];
  const match = /^(.*[0-9])[A-Z]+$/.exec(base);
  return match ? match[1] : base;
}

/** A fictional sprint: RST + serial, 1 point a contact, prefixes as multipliers. */
export const SPRINT_RULES: ContestRules = {
  id: 'cwt-sprint',
  label: 'CW スプリント（架空）',
  exchange: ['RST', 'NR'],
  points: 1,
  multOf: wpxPrefix,
  nilPenalty: 1,
  bustCallPenalty: 1,
  bustNrPenalty: 0,
};
