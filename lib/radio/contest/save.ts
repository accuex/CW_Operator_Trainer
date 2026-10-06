import type { AnswerLog, QsoContestSummary, QsoSessionSummary } from '../../types';
import { emptyCauses } from '../attribution';
import type { ContestResult } from '../modes/contestRun';
import { RUN_TRACE_VERSION, type ContestTrace, type StoredContestResult } from '../runTrace';
import { analyseContest, type ContestAnalysis } from './analysis';
import type { ContestJudged } from './judge';
import { analysisSummary, contestAnswers } from './learning';
import type { ContestAxes, ContestParams } from './levels';
import { buildContestReview, storedRules, type ContestReview, type DeskSent } from './review';

/**
 * Saving a contest run, as CQ and pileup runs are saved:
 *
 *   device (IndexedDB runTraces, newest RUN_TRACE_LIMIT of all run modes together) — the
 *     books, our log, the stations' logs, what the desk sent, the review as built, each
 *     contact scored character by character, the callers' messages as received (air)
 *     and the causes;
 *   cloud (SessionRecord.qso) — QsoContestSummary: counts and score, and of the analysis
 *     counts only (causes, failures, copy tallies). No lines, no times, no RF, no stations.
 *   answers (AnswerLog, synced like every mode's) — one per character of the calls and
 *     serials we logged, as pileup answers are (character, its conditions, blame). A
 *     serial's cut letters carry blame `cut-number`, misses that weren't copy their cause.
 *
 * Saved once, at QRT (or when the contest's time runs out). A run left before QRT is not
 * saved and can't be resumed in v1: the run's agents, field logs and clock live only in
 * memory, and resuming them part-way would need all of that kept as well.
 */

export const CONTEST_MODE_ID = 'contest';
export const CONTEST_PRESET_ID = 'contest-rst-nr';

export interface ContestSaveInput {
  id: string;
  /** Wall clock, ms. */
  startedAt: number;
  endedAt: number;
  level: string;
  wpm: number;
  minutes: number;
  axes: ContestAxes;
  params: ContestParams;
  result: ContestResult;
  sent: DeskSent[];
  /** The run judged at QRT (contest/judge.ts). */
  judged: Omit<ContestJudged, 'review'>;
  /** Each caller's keying speed (answers carry it). */
  wpmOf: Record<number, number>;
}

/** The result as IndexedDB can hold it: the rules by id and label. */
export function storedResult(result: ContestResult): StoredContestResult {
  const { rules, ...rest } = result;
  return structuredCloneSafe({ ...rest, rules: storedRules(rules) });
}

/** The synced numbers. */
export function contestNumbers(review: ContestReview, result: Pick<ContestResult, 'stats'>, level: string, analysis?: ContestAnalysis): QsoContestSummary {
  return {
    level,
    rulesId: review.rules.id,
    seconds: review.seconds,
    logged: review.lines.length,
    rate: review.rates.average,
    bestRate: review.rates.best,
    claimed: { qsos: review.claimed.qsos, mults: review.claimed.mults, total: review.claimed.total },
    checked: { qsos: review.checked.qsos, points: review.checked.points, mults: review.checked.mults, total: review.checked.total },
    ok: review.counts.ok,
    bustCall: review.counts['bust-call'],
    bustNr: review.counts['bust-nr'],
    nil: review.counts.nil,
    dupe: review.counts.dupe,
    theirOnly: review.theirOnly.length,
    dropped: review.theirOnly.filter((line) => line.kind === 'dropped').length,
    missed: review.missed.length,
    abandoned: review.abandoned.length,
    doublings: review.doublings.total,
    dupeCallers: result.stats.dupeCallers,
    b4: result.stats.b4,
    ...(analysis ? { analysis: analysisSummary(analysis) } : {}),
  };
}

/**
 * The session summary for the cloud. No `run` (a CQ run's numbers) and no contacts list
 * (the contest log stays on the device): the fields judged and the copy evidence in
 * counts, the analysis in counts.
 */
export function contestSummary(review: ContestReview, result: Pick<ContestResult, 'stats'>, level: string, axes: ContestAxes, analysis?: ContestAnalysis, fields?: { total: number; correct: number }): QsoSessionSummary {
  const contest = contestNumbers(review, result, level, analysis);
  const clean = analysis?.evidence.clean;
  return {
    modeId: CONTEST_MODE_ID,
    presetId: CONTEST_PRESET_ID,
    call: '',
    outcome: contest.logged > 0 ? 'complete' : 'partial',
    fields: fields?.total ?? 0,
    fieldsCorrect: fields?.correct ?? 0,
    cleanAccuracy: clean?.total ? clean.correct / clean.total : null,
    causes: analysis ? { ...analysis.evidence.causes } : emptyCauses(),
    difficulty: { ...axes },
    adjusted: {},
    contacts: [],
    contest,
  };
}

export interface ContestSaved {
  trace: ContestTrace;
  summary: QsoSessionSummary;
  review: ContestReview;
  analysis: ContestAnalysis;
  answers: AnswerLog[];
}

/** Everything saved at QRT: the trace for the device, the summary and answers for the session record. */
export function contestSave(input: ContestSaveInput): ContestSaved {
  const result = storedResult(input.result);
  const review = buildContestReview(result, input.sent);
  const { scored, air } = input.judged;
  // Analysed again from what is stored, so the device's record gives back the same answer.
  const analysis = analyseContest({ result, review, sent: input.sent, scored, air });
  const answers = contestAnswers(result, scored, analysis, {
    sessionId: input.id, timestamp: input.endedAt, modeId: CONTEST_MODE_ID, presetId: CONTEST_PRESET_ID,
    wpmOf: (id) => input.wpmOf[id] ?? input.axes.speed,
  });
  const fields = scored.flatMap((item) => item.fields ?? []);
  const trace: ContestTrace = {
    kind: 'run',
    version: RUN_TRACE_VERSION,
    id: input.id,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    modeId: CONTEST_MODE_ID,
    presetId: CONTEST_PRESET_ID,
    difficulty: { ...input.axes },
    params: { ...input.params },
    result,
    // Contacts are scored in the contest's own shape (contest.scored); the shared slot stays empty.
    scored: [],
    evidence: analysis.evidence,
    rx: {},
    tx: input.sent.map((item) => ({ at: item.at, text: item.text, rf: 0, issues: [] })),
    filter: 0,
    wpmOf: { ...input.wpmOf },
    adjusted: {},
    earned: [],
    contest: {
      level: input.level, wpm: input.wpm, minutes: input.minutes, sent: input.sent.map((item) => ({ ...item })), review,
      scored: structuredCloneSafe(scored), air: air.map((line) => ({ ...line })), analysisVersion: analysis.version,
    },
  };
  const summary = contestSummary(review, input.result, input.level, input.axes, analysis, { total: fields.length, correct: fields.filter((field) => field.correct).length });
  return { trace, summary, review, analysis, answers };
}

/** The review a stored record shows: built again from its books, as at QRT. */
export function reviewOf(trace: ContestTrace): ContestReview {
  return buildContestReview(trace.result, trace.contest.sent);
}

/** The causes again from a stored run alone (null for a run saved before Stage 4, which kept no scoring). */
export function reanalyse(trace: ContestTrace): ContestAnalysis | null {
  const { scored, air, sent } = trace.contest;
  if (!scored || !air) return null;
  return analyseContest({ result: trace.result, review: reviewOf(trace), sent, scored, air });
}

/** Plain data only (drops undefined, functions would throw): what IndexedDB will store. */
function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
