import type { QsoEvidence } from './difficulty';
import type { RunIssue, RunParams, RunResult } from './modes/cqRun';
import type { ScoredContact } from './runReview';
import type { TracedRx } from './trace';

/**
 * Detailed record of one run, for the review and later analysis. Device-only
 * (IndexedDB, newest RUN_TRACE_LIMIT); the cloud gets QsoSessionSummary as before.
 *
 * Shaped for every run-style mode — cq-run now, pileup-run / contest-run / free-play
 * later: the books (RunResult), each contact as judged, and both sides of the air.
 */

export const RUN_TRACE_LIMIT = 50;
export const RUN_TRACE_VERSION = 1;

/** One of our transmissions, on the run's clock. */
export interface RunTxTrace { at: number; text: string; rf: number; issues: RunIssue[] }

export interface RunTrace {
  kind: 'run';
  version: number;
  id: string;
  startedAt: number;
  endedAt: number;
  modeId: string;
  presetId: string;
  difficulty: Record<string, number>;
  /** The run's parameters as they stood at QRT (tempo, arrivals, crowd …). */
  params: RunParams;
  result: RunResult;
  /** Each contact as judged: fields character by character, the first call we sent, its evidence. */
  scored: ScoredContact[];
  evidence: QsoEvidence;
  /** What every caller sent, per station, with each character's condition and situation. */
  rx: Record<number, TracedRx[]>;
  tx: RunTxTrace[];
  /** Receive filter at QRT, Hz, and each caller's speed — what the review needs to redraw. */
  filter: number;
  wpmOf: Record<number, number>;
  /** Axis moves applied after the run, and badges it lifted. */
  adjusted: Record<string, number>;
  earned: { id: string; tier: number }[];
}

/** A short line for the list of stored runs. */
export function runTraceLine(trace: RunTrace) {
  const { stats } = trace.result;
  return { at: trace.startedAt, contacts: stats.contacts, rate: Math.round(stats.rate), seconds: Math.round(stats.seconds), modeId: trace.modeId };
}
