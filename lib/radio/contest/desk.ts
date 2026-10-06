import { isCallsign, normalizeCall } from '../air/intent';
import type { EsmLog } from './esm';
import { bestRate, currentRate, liveScore, type ContestLogLine, type ContestScore } from './log';
import type { ContestRules } from './rules';

/**
 * What the contest desk shows while we run, computed from our own log and the wall clock
 * only: next serial, DUPE, NEW MULT, the claimed score, RATE and BEST.
 *
 * Kept apart from the run on purpose: this module reads no station, no field log and no
 * check (it imports nothing from agents/, modes/, field.ts or review.ts), so nothing of
 * what is really on the air or what the log check will say can reach the live desk.
 * BUST / NIL / lines only they have are known after QRT only (review.ts).
 */

/** Our log as the desk holds it: the lines as typed, with the serial we sent each. */
export type DeskLine = Pick<ContestLogLine, 'id' | 'call' | 'rst' | 'nr' | 'sentNr'>;

/** The ESM's view of our log: next serial and DUPE. */
export function deskLog(lines: readonly DeskLine[], me: string): EsmLog {
  return {
    me,
    nextNr: lines.length + 1,
    isDupe: (call) => isDupeIn(lines, call),
  };
}

/** `call` is in our log already. */
export function isDupeIn(lines: readonly DeskLine[], call: string) {
  const wanted = normalizeCall(call);
  return isCallsign(wanted) && lines.some((line) => normalizeCall(line.call) === wanted);
}

/** `call` would be a new multiplier (our own log only). */
export function isNewMult(lines: readonly DeskLine[], call: string, rules: Pick<ContestRules, 'multOf'>) {
  const wanted = normalizeCall(call);
  return isCallsign(wanted) && !lines.some((line) => rules.multOf(normalizeCall(line.call)) === rules.multOf(wanted));
}

/** Lines whose call came earlier in our log (the desk marks them DUPE). */
export function dupeLineIds(lines: readonly DeskLine[]) {
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const line of lines) {
    const call = normalizeCall(line.call);
    if (seen.has(call)) ids.add(line.id);
    seen.add(call);
  }
  return ids;
}

export interface DeskNumbers {
  score: ContestScore;
  /** Contacts an hour, last ten minutes. */
  rate: number;
  best: number;
  elapsed: number;
}

/** The HUD: the claimed score from our log, rates from when we logged (wall seconds). */
export function deskNumbers(lines: readonly DeskLine[], loggedAt: readonly number[], start: number | null, now: number, rules: ContestRules): DeskNumbers {
  const score = liveScore(lines, rules);
  if (start === null || !now) return { score, rate: 0, best: 0, elapsed: 0 };
  return {
    score,
    rate: currentRate(loggedAt, start, now),
    best: loggedAt.length ? bestRate(loggedAt, start, now) : 0,
    elapsed: Math.max(0, now - start),
  };
}
