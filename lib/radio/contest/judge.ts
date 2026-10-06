import type { ClockNow, CopyMonitor, RxRecord } from '../conditions';
import { analyseContest, type AirLine, type ContestAnalysis } from './analysis';
import { buildContestReview, type ContestReview, type DeskSent, type ReviewSource } from './review';
import { scoreContest, type ContestScoredContact } from './score';

/**
 * A contest run judged at QRT, the same on the desk and headless: the log check
 * (review), each contact character by character (scored, from what reached our receiver),
 * the callers' messages as we received them (air) and the causes (analysis).
 */

export interface ContestJudgeInput {
  result: ReviewSource;
  /** Our messages, seconds from the start. */
  sent: readonly DeskSent[];
  /** What we received this run (callers only; one epoch). */
  records: readonly RxRecord[];
  /** The call of the station behind a record, if it was a caller. */
  callOf(stationId: number): string | null;
  /** The serial as a station keyed it. */
  keyedOf(stationId: number): string | null;
  monitor: CopyMonitor;
  now: ClockNow;
}

export interface ContestJudged {
  review: ContestReview;
  scored: ContestScoredContact[];
  air: AirLine[];
  analysis: ContestAnalysis;
}

/** The callers' messages as received, seconds from the start. */
export function airOf(records: readonly RxRecord[], callOf: (stationId: number) => string | null, start: number): AirLine[] {
  const rel = (at: number) => Math.round((at - start) * 100) / 100;
  return records.flatMap((record): AirLine[] => {
    const call = callOf(record.station);
    if (!call) return [];
    const end = Math.min(record.tx.start + record.tx.length, record.cutAt ?? Number.POSITIVE_INFINITY);
    return [{ station: record.station, call, at: rel(record.tx.start), end: rel(end), text: record.tx.text }];
  }).sort((a, b) => a.at - b.at);
}

export function judgeContest({ result, sent, records, callOf, keyedOf, monitor, now }: ContestJudgeInput): ContestJudged {
  const review = buildContestReview(result, sent);
  const scored = scoreContest({ result, recordsOf: (id) => records.filter((record) => record.station === id), keyedOf, monitor, now });
  // Times before a rig restart (another epoch) aren't on the run's clock: they are scored, not placed.
  const air = airOf(records.filter((record) => record.epoch === now.epoch), callOf, result.clock.start);
  return { review, scored, air, analysis: analyseContest({ result, review, sent, scored, air }) };
}
