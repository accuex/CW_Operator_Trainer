import type { QsoAssist } from '../types';
import type { QsoEvidence } from './difficulty';
import type { AirLine } from './contest/analysis';
import type { ContestReview, DeskSent, ReviewSource } from './contest/review';
import type { ContestScoredContact } from './contest/score';
import type { ContestParams } from './contest/levels';
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
  /** DECODE's use during the run (absent: never on). */
  assist?: QsoAssist;
  /** A pileup's own record: what the review redraws its timeline from. */
  pileup?: PileupTraceDetail;
  /** A contest's own record: the review as built at QRT and what the desk sent. */
  contest?: ContestTraceDetail;
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
/** A contest's result as stored: its rules by id (the rules hold functions, which IndexedDB can't keep). */
export type StoredContestResult = ReviewSource;

export interface ContestTraceDetail {
  level: string;
  /** Our keying speed at QRT. */
  wpm: number;
  /** Planned length, minutes (0 = open-ended). */
  minutes: number;
  /** What the desk sent, seconds from the start. */
  sent: DeskSent[];
  /** The review as built at QRT: what the stored record shows again. */
  review: ContestReview;
  /** Each contact judged character by character (Stage 4; absent on older records). */
  scored?: ContestScoredContact[];
  /** The callers' messages as we received them, seconds from the start (device only). */
  air?: AirLine[];
  /** The analysis version the run was judged with (the causes are derived again from the above). */
  analysisVersion?: number;
}

export type ContestTrace = RunTrace<StoredContestResult, ContestParams> & { contest: ContestTraceDetail };
export const isContestTrace = (trace: AnyRunTrace): trace is ContestTrace => Boolean((trace as { contest?: unknown }).contest);

export const isPileupTrace = (trace: AnyRunTrace): trace is PileupTrace => Boolean(trace.pileup);

/** A short line for the list of stored runs. */
export function runTraceLine(trace: AnyRunTrace) {
  const { stats } = trace.result;
  return { at: trace.startedAt, contacts: stats.contacts, rate: Math.round(stats.rate), seconds: Math.round(stats.seconds), modeId: trace.modeId };
}
