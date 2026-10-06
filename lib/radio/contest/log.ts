import { callDistance, normalizeCall } from '../air/intent';
import type { ContestRules } from './rules';
import { serialOf } from './serial';

/**
 * Our contest log and how it is checked: each line against the log of the station it
 * claims, as a contest's log checkers do.
 *
 *   ok        — the station has us, at about that time, and the serial is the one it sent;
 *   bust-nr   — the station has us, but we logged another serial (the line is removed);
 *   bust-call — no station of that call has us then, but one a letter or two off does
 *               (we logged its call wrong: removed, and a penalty);
 *   nil       — nobody has us then (not in log: removed, and a penalty);
 *   dupe      — that call is in our log already (no points, no penalty).
 */

export interface ContestLogLine {
  id: string;
  at: number;
  call: string;
  rst: string;
  /** The serial as typed. */
  nr: string;
  /** Our serial sent to it. */
  sentNr: number;
}

/** One line of one station's log of us (from the field). */
export interface TheirLine {
  station: string;
  at: number;
  /** Our serial as it copied it. */
  nr: number | null;
  /** The serial it sent us. */
  sent: number;
}

export type CheckVerdict = 'ok' | 'bust-nr' | 'bust-call' | 'nil' | 'dupe';

export interface CheckedLine extends ContestLogLine {
  verdict: CheckVerdict;
  /** The station's own record, when one was matched: who it really was and the serial it sent. */
  their: TheirLine | null;
  /** The station did not copy our serial as we sent it (its problem, not ours). */
  theyBustedUs: boolean;
}

export interface ContestScore {
  qsos: number;
  points: number;
  mults: number;
  total: number;
}

export interface CrossCheck {
  lines: CheckedLine[];
  /** Contacts a station has in its log that we never logged (missed points). */
  theirOnly: TheirLine[];
  claimed: ContestScore;
  checked: ContestScore;
  counts: Record<CheckVerdict, number>;
}

/**
 * A station's log line and ours are one contact if this close in time, seconds (it logs
 * when it sends its exchange, we when we send TU — a contact with repeats can take minutes).
 */
export const MATCH_WINDOW = 300;

export function crossCheck(ours: readonly ContestLogLine[], theirs: readonly TheirLine[], rules: ContestRules): CrossCheck {
  const unmatched = [...theirs].sort((a, b) => a.at - b.at);
  const take = (line: TheirLine) => unmatched.splice(unmatched.indexOf(line), 1);
  const nearest = (candidates: TheirLine[], at: number) =>
    candidates.filter((line) => Math.abs(line.at - at) <= MATCH_WINDOW).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0] ?? null;
  const seen = new Set<string>();
  const lines: CheckedLine[] = [...ours].sort((a, b) => a.at - b.at).map((line) => {
    const call = normalizeCall(line.call);
    const dupe = seen.has(call);
    seen.add(call);
    const exact = nearest(unmatched.filter((their) => their.station === call), line.at);
    if (exact) take(exact);
    const theyBustedUs = Boolean(exact && exact.nr !== line.sentNr);
    if (dupe) return { ...line, verdict: 'dupe', their: exact, theyBustedUs };
    if (exact) return { ...line, verdict: serialOf(line.nr) === exact.sent ? 'ok' : 'bust-nr', their: exact, theyBustedUs };
    const near = nearest(unmatched.filter((their) => callDistance(their.station, call) <= 2), line.at);
    if (near) {
      take(near);
      return { ...line, verdict: 'bust-call', their: near, theyBustedUs: false };
    }
    return { ...line, verdict: 'nil', their: null, theyBustedUs: false };
  });
  const counts = { ok: 0, 'bust-nr': 0, 'bust-call': 0, nil: 0, dupe: 0 } as Record<CheckVerdict, number>;
  for (const line of lines) counts[line.verdict] += 1;
  const claimedLines = lines.filter((line) => line.verdict !== 'dupe');
  const okLines = lines.filter((line) => line.verdict === 'ok');
  const claimed = score(claimedLines.length * rules.points, claimedLines, rules);
  const penalty = counts.nil * rules.nilPenalty + counts['bust-call'] * rules.bustCallPenalty + counts['bust-nr'] * rules.bustNrPenalty;
  const checked = score(okLines.length * rules.points - penalty, okLines, rules);
  return { lines, theirOnly: unmatched, claimed: { ...claimed, qsos: claimedLines.length }, checked: { ...checked, qsos: okLines.length }, counts };
}

function score(points: number, lines: readonly ContestLogLine[], rules: ContestRules): ContestScore {
  const mults = new Set(lines.map((line) => rules.multOf(normalizeCall(line.call)))).size;
  return { qsos: lines.length, points, mults, total: Math.max(0, points) * mults };
}

/** Our log as it stands (no checking): what the desk can show live. */
export function liveScore(ours: readonly Pick<ContestLogLine, 'call'>[], rules: ContestRules): ContestScore {
  const calls = [...new Set(ours.map((line) => normalizeCall(line.call)))];
  const mults = new Set(calls.map((call) => rules.multOf(call))).size;
  return { qsos: calls.length, points: calls.length * rules.points, mults, total: calls.length * rules.points * mults };
}

export interface RateBlock {
  /** Seconds from the start of the run. */
  from: number;
  to: number;
  qsos: number;
  /** Contacts an hour over the block. */
  rate: number;
}

/** Contacts by time block (`block` seconds) from `start` to `end`. */
export function rateBlocks(times: readonly number[], start: number, end: number, block: number): RateBlock[] {
  const blocks: RateBlock[] = [];
  for (let from = start; from < end; from += block) {
    const to = Math.min(end, from + block);
    const qsos = times.filter((at) => at >= from && (at < to || (to === end && at <= end))).length;
    blocks.push({ from: from - start, to: to - start, qsos, rate: to > from ? (qsos * 3600) / (to - from) : 0 });
  }
  return blocks;
}

/** A sensible block for a run of `seconds`: a minute for short runs, five for longer. */
export const blockFor = (seconds: number) => (seconds <= 600 ? 60 : 300);

/** Highest contacts-an-hour over any ten minutes (the whole run if shorter). */
export function bestRate(times: readonly number[], start: number, end: number) {
  const span = Math.min(600, Math.max(60, end - start));
  let best = 0;
  for (const from of [start, ...times]) {
    const count = times.filter((at) => at >= from && at < from + span).length;
    best = Math.max(best, (count * 3600) / span);
  }
  return Math.round(best);
}

/** Contacts an hour over the last ten minutes (the run so far if shorter, a minute at least). */
export function currentRate(times: readonly number[], start: number, now: number) {
  const span = Math.min(600, Math.max(60, now - start));
  return Math.round((times.filter((at) => at > now - span && at <= now).length * 3600) / span);
}
