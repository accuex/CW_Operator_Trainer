import { callDistance } from '../air/intent';
import type { GoneReason } from '../agents/types';
import type { ContestResult } from '../modes/contestRun';
import type { EsmKind } from './esm';
import type { CheckVerdict, ContestScore } from './log';
import type { ContestRules } from './rules';

/**
 * The contest review: our log checked against every station's, read after QRT.
 *
 * Two kinds of knowledge are kept apart on purpose:
 *
 *   on the desk (live)  — what the operator can know while running: our own log, our
 *                         serial, the claimed score and mults, DUPE against our own log
 *                         (contest/desk.ts). Nothing here is shown before QRT.
 *   after QRT (here)    — the log check, which needs every station's own log: ok, BUST
 *                         CALL, BUST NR, NIL, DUPE, lines only they have, who was really
 *                         calling, doublings, callers that left.
 *
 * Verdicts (one per line of our log, as contest log checkers give them — see log.ts):
 *   ok        the station has us at that time and our serial for it is the one it sent;
 *   bust-nr   the station has us, our serial for it is wrong (removed, no penalty here);
 *   bust-call nobody of that call has us, but a station a letter or two off does (removed, penalty);
 *   nil       nobody has us then (removed, penalty);
 *   dupe      the call is in our log already (no points, no penalty).
 *
 * Lines only the other station has (相手ログのみ) are not one of our verdicts: they cost us
 * the contact, never a penalty. Each is classified:
 *   dropped   we sent it our exchange and it sent its own, then we went on without
 *             logging (交換後に破棄). Its log has us; ours has nothing — for the station it is
 *             a NIL, for us a contact lost. The one Stage 2 met in play.
 *   unmatched it has us but no exchange of ours went to it (or none within the match
 *             window): e.g. our line for it was taken by another, or a busted call we
 *             dropped that it took for its own.
 */

export const CONTEST_REVIEW_VERSION = 1;

/** One line of our log as checked. Times are seconds from the start of the run. */
export interface ReviewLine {
  id: string;
  at: number;
  call: string;
  rst: string;
  /** The serial as typed. */
  nr: string;
  sentNr: number;
  verdict: CheckVerdict;
  /** The station's own line matched to ours: who it is, when it logged, our serial as it copied it, the serial it sent. */
  their: { station: string; at: number; copied: number | null; sent: number } | null;
  /** It copied our serial wrong (its problem: our line stands). */
  theyBustedUs: boolean;
}

export type TheirOnlyKind = 'dropped' | 'unmatched';

export interface TheirOnlyLine {
  station: string;
  at: number;
  copied: number | null;
  sent: number;
  kind: TheirOnlyKind;
  /** Our exchange as it went to it (dropped), from the desk's own record. */
  exchange: string | null;
}

/** Callers that came and went without a contact, and contacts started but never exchanged. */
export interface LeftLine {
  call: string;
  /** Times it called (missed), or calls we sent it (abandoned). */
  calls: number;
  reason: Exclude<GoneReason, 'b4'> | 'incomplete';
}

/** Our message as the desk sent it (seconds from the start; `end` when it finished keying). */
export interface DeskSent { at: number; end?: number; kind: EsmKind; text: string; subject?: string; nr?: number }

export interface ContestReview {
  version: number;
  /** The rules it was scored by, without the multiplier function. */
  rules: StoredRules;
  seconds: number;
  claimed: ContestScore;
  checked: ContestScore;
  counts: Record<CheckVerdict, number>;
  lines: ReviewLine[];
  theirOnly: TheirOnlyLine[];
  missed: LeftLine[];
  abandoned: LeftLine[];
  doublings: { total: number; contacts: { call: string; count: number }[] };
  rates: {
    /** Logged contacts an hour over the whole run. */
    average: number;
    /** Highest ten-minute rate (logged). */
    best: number;
    /** Block size for `blocks`, seconds. */
    block: number;
    blocks: { from: number; to: number; logged: number; good: number }[];
    /** Contacts logged / checked good in each minute from the start: the series later analysis reads. */
    perMinute: { logged: number[]; good: number[] };
  };
}

const exchangeKinds: readonly EsmKind[] = ['exchange', 'correct'];

/** Rules as stored: everything but `multOf` (a function; the multipliers are in the check already). */
export type StoredRules = Omit<ContestRules, 'multOf'>;

/** The rules as stored: their numbers, without `multOf`. */
export const storedRules = (rules: StoredRules): StoredRules => ({
  id: rules.id, label: rules.label, exchange: [...rules.exchange], points: rules.points,
  nilPenalty: rules.nilPenalty, bustCallPenalty: rules.bustCallPenalty, bustNrPenalty: rules.bustNrPenalty,
});

/** What the review reads from the run's books: the result with its rules as stored. */
export type ReviewSource = Omit<ContestResult, 'rules'> & { rules: StoredRules };

/** Build the review from the run's books (and the desk's own record of what it sent, times from the start). */
export function buildContestReview(result: ReviewSource, sent: readonly DeskSent[] = []): ContestReview {
  const seconds = result.stats.seconds;
  const start = result.clock.start;
  const rel = (at: number) => Math.round((at - start) * 10) / 10;
  const lines: ReviewLine[] = result.check.lines.map((line) => ({
    id: line.id, at: rel(line.at), call: line.call, rst: line.rst, nr: line.nr, sentNr: line.sentNr, verdict: line.verdict,
    their: line.their ? { station: line.their.station, at: rel(line.their.at), copied: line.their.nr, sent: line.their.sent } : null,
    theyBustedUs: line.theyBustedUs,
  }));
  const theirOnly: TheirOnlyLine[] = result.check.theirOnly.map((line) => {
    // The contact behind it: that station, exchanged, never logged, nearest in time.
    const dropped = result.contacts
      .filter((item) => item.truth.call === line.station && item.exchangedAt !== undefined && !item.logIds.length)
      .sort((a, b) => Math.abs((a.exchangedAt ?? 0) - line.at) - Math.abs((b.exchangedAt ?? 0) - line.at))[0];
    const ours = sent.filter((item) => exchangeKinds.includes(item.kind) && item.subject && callDistance(item.subject, line.station) <= 2 && item.at <= rel(line.at) + 1).at(-1);
    return {
      station: line.station, at: rel(line.at), copied: line.nr, sent: line.sent,
      kind: dropped ? 'dropped' : 'unmatched',
      exchange: ours?.text ?? null,
    };
  });
  // Callers told QSO B4 had worked us already: they are dupe callers (stats.b4), not missed ones.
  const missed = result.missed.flatMap((caller): LeftLine[] => (caller.reason === 'b4' ? [] : [{ call: caller.call, calls: caller.calls, reason: caller.reason }]));
  const abandoned = result.contacts
    .filter((contact) => contact.outcome === 'incomplete' && !contact.logIds.length)
    .map((contact): LeftLine => ({ call: contact.truth.call, calls: contact.sentCalls.length, reason: 'incomplete' }));
  const doubled = result.contacts.filter((contact) => contact.doublings > 0).map((contact) => ({ call: contact.truth.call, count: contact.doublings }));
  const loggedAt = lines.map((line) => line.at);
  const goodAt = lines.filter((line) => line.verdict === 'ok').map((line) => line.at);
  return {
    version: CONTEST_REVIEW_VERSION,
    rules: storedRules(result.rules),
    seconds: Math.round(seconds),
    claimed: result.check.claimed,
    checked: result.check.checked,
    counts: result.check.counts,
    lines,
    theirOnly,
    missed,
    abandoned,
    doublings: { total: result.stats.doublings, contacts: doubled },
    rates: {
      average: seconds > 0 ? Math.round((lines.length * 3600) / seconds) : 0,
      best: result.stats.bestRate,
      block: result.blocks.size,
      blocks: result.blocks.logged.map((block, index) => ({
        from: block.from, to: block.to, logged: block.qsos, good: result.blocks.good[index]?.qsos ?? 0,
      })),
      perMinute: { logged: perMinute(loggedAt, seconds), good: perMinute(goodAt, seconds) },
    },
  };
}

/** Counts per minute from the start, `seconds` long. */
export function perMinute(times: readonly number[], seconds: number): number[] {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const out = Array.from({ length: minutes }, () => 0);
  for (const at of times) out[Math.min(minutes - 1, Math.max(0, Math.floor(at / 60)))] += 1;
  return out;
}

/** Contacts an hour over minutes [from, to) of a per-minute series (e.g. the first five minutes against the rest). */
export function rateOver(perMinuteCounts: readonly number[], fromMinute: number, toMinute: number) {
  const slice = perMinuteCounts.slice(fromMinute, toMinute);
  return slice.length ? Math.round((slice.reduce((sum, count) => sum + count, 0) * 60) / slice.length) : 0;
}
