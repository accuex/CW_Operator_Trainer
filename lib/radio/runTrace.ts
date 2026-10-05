import type { QsoEvidence } from './difficulty';
import type { RunIssue, RunParams, RunResult } from './modes/cqRun';
import type { PileupParams } from './modes/pileupLevels';
import type { PileupResult } from './modes/pileupRun';
import type { RunBooks } from './modes/runCore';
import type { PileupAnalysis } from './pileup/analysis';
import type { DeskStep } from './pileup/review';
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

export interface RunTrace<R extends RunBooks = RunResult, P = RunParams> {
  kind: 'run';
  version: number;
  id: string;
  startedAt: number;
  endedAt: number;
  modeId: string;
  presetId: string;
  difficulty: Record<string, number>;
  /** The run's parameters as they stood at QRT (tempo, arrivals, crowd …). */
  params: P;
  result: R;
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
  /** A pileup's own record: what the review redraws its timeline from. */
  pileup?: PileupTraceDetail;
}

/** Any stored run, whatever its mode (narrow by modeId). */
export type AnyRunTrace = RunTrace<RunBooks, unknown>;

export interface PileupTraceDetail {
  level: string;
  /** Our keying speed. */
  wpm: number;
  /** Our messages with the frequency around each (who was calling, who answered, who keyed over it). */
  steps: DeskStep[];
  /** The causes as judged at QRT. */
  analysis: Pick<PileupAnalysis, 'summary' | 'copy' | 'logging' | 'mistakes'>;
}

export type PileupTrace = RunTrace<PileupResult, PileupParams> & { pileup: PileupTraceDetail };
export const isPileupTrace = (trace: AnyRunTrace): trace is PileupTrace => Boolean(trace.pileup);

/** A short line for the list of stored runs. */
export function runTraceLine(trace: AnyRunTrace) {
  const { stats } = trace.result;
  return { at: trace.startedAt, contacts: stats.contacts, rate: Math.round(stats.rate), seconds: Math.round(stats.seconds), modeId: trace.modeId };
}
