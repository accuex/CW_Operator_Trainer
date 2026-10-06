import type { AnswerLog, CopySituation, PileupCause, PileupCrowd, SessionRecord } from './types';

export interface ConfusionCell { correct: string; input: string; count: number; rate: number }
export interface WeakPair { a: string; b: string; count: number; reverse: number; total: number }

export function confusionMatrix(logs: AnswerLog[]): ConfusionCell[] {
  const attempts = new Map<string, number>();
  const errors = new Map<string, number>();
  logs.forEach((log) => {
    attempts.set(log.correctSymbol, (attempts.get(log.correctSymbol) ?? 0) + 1);
    if (!log.isCorrect) {
      const key = `${log.correctSymbol}\u0000${log.inputSymbol || '∅'}`;
      errors.set(key, (errors.get(key) ?? 0) + 1);
    }
  });
  return [...errors.entries()].map(([key, count]) => {
    const [correct, input] = key.split('\u0000');
    return { correct, input, count, rate: count / (attempts.get(correct) ?? count) };
  }).sort((a, b) => b.count - a.count);
}

export function weakPairs(logs: AnswerLog[]): WeakPair[] {
  const directed = new Map<string, number>();
  confusionMatrix(logs).forEach((cell) => directed.set(`${cell.correct}\u0000${cell.input}`, cell.count));
  const visited = new Set<string>();
  const pairs: WeakPair[] = [];
  directed.forEach((count, key) => {
    const [a, b] = key.split('\u0000');
    const canonical = [a, b].sort().join('\u0000');
    if (visited.has(canonical)) return;
    visited.add(canonical);
    const reverse = directed.get(`${b}\u0000${a}`) ?? 0;
    pairs.push({ a, b, count, reverse, total: count + reverse });
  });
  return pairs.sort((a, b) => b.total - a.total);
}

export function summary(logs: AnswerLog[]) {
  const correct = logs.filter((log) => log.isCorrect).length;
  const latencies = logs.map((log) => log.responseLatency).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    answers: logs.length,
    accuracy: logs.length ? correct / logs.length : 0,
    medianLatency: latencies.length ? latencies[Math.floor(latencies.length / 2)] : 0,
    early: logs.filter((log) => log.isEarly).length,
  };
}

/**
 * Weak-character analysis ignores QSO characters missed because of the band
 * (QRM / QSB / QRN / weak), tuning or timing — only clean-condition copy counts. A
 * character another caller keyed over (even below the QRM line), or one whose miss was
 * blamed on something else (a pileup look-alike, a lid, a log slip), isn't clean copy either.
 * Set `includeEnvironment` to see everything. The records themselves are kept.
 */
export const isCleanCopy = (log: AnswerLog) => !log.qso || (log.qso.condition === 'clean' && !log.qso.blame && !log.qso.env?.overlap);
/** Weak-pair input: clean copy only, or every condition — never a miss that was a look-alike's, a lid's or a slip's (blame). */
export const forWeakAnalysis = (logs: AnswerLog[], includeEnvironment = false) => logs.filter(includeEnvironment ? (log) => !log.qso?.blame : isCleanCopy);
/** Characters the "include bad conditions" switch would add (a blamed miss never is). */
export const hiddenByCondition = (logs: AnswerLog[]) => forWeakAnalysis(logs, true).length - forWeakAnalysis(logs).length;

export interface ConditionRow { condition: string; answers: number; accuracy: number }

/** What a QSO character went through; older records have only the condition (muted = we keyed over it). */
export const situationOfLog = (log: AnswerLog): CopySituation | null => {
  if (!log.qso) return null;
  return log.qso.situation ?? (log.qso.condition === 'muted' ? 'doubled' : log.qso.condition);
};

/** A QSO character from a session where DECODE printed (the screen may have copied it). */
const isDecodeAssisted = (log: AnswerLog) => log.qso?.blame === 'decode';

/**
 * QSO copy accuracy per situation (clean vs QRM vs QSB vs doubled …), optionally for
 * one log field (`call` → how calls hold up under each).
 */
export function qsoConditionBreakdown(logs: AnswerLog[], field?: string): ConditionRow[] {
  const buckets = new Map<string, { total: number; correct: number }>();
  for (const log of logs) {
    const situation = situationOfLog(log);
    if (!situation || (field && log.qso?.field !== field) || isDecodeAssisted(log)) continue;
    const bucket = buckets.get(situation) ?? { total: 0, correct: 0 };
    bucket.total += 1;
    if (log.isCorrect) bucket.correct += 1;
    buckets.set(situation, bucket);
  }
  return [...buckets.entries()].map(([condition, { total, correct }]) => ({ condition, answers: total, accuracy: correct / total }));
}

export interface ConditionContrast { symbol: string; clean: number; cleanAnswers: number; situation: CopySituation; accuracy: number; answers: number }

/**
 * Characters copied well normally that fall apart under one situation: "R is fine,
 * but not under QRM". Needs enough of both; the worst situation per character.
 */
export function conditionContrast(logs: AnswerLog[], { minClean = 5, minHard = 3, cleanAbove = 0.85, gap = 0.25 } = {}): ConditionContrast[] {
  const bySymbol = new Map<string, Map<CopySituation, { total: number; correct: number }>>();
  for (const log of logs) {
    const situation = situationOfLog(log);
    if (!situation || situation === 'unheard' || isDecodeAssisted(log)) continue;
    const map = bySymbol.get(log.correctSymbol) ?? new Map();
    const bucket = map.get(situation) ?? { total: 0, correct: 0 };
    bucket.total += 1;
    if (log.isCorrect) bucket.correct += 1;
    map.set(situation, bucket);
    bySymbol.set(log.correctSymbol, map);
  }
  const out: ConditionContrast[] = [];
  for (const [symbol, map] of bySymbol) {
    const clean = map.get('clean');
    if (!clean || clean.total < minClean || clean.correct / clean.total < cleanAbove) continue;
    let worst: ConditionContrast | null = null;
    for (const [situation, bucket] of map) {
      if (situation === 'clean' || bucket.total < minHard) continue;
      const accuracy = bucket.correct / bucket.total;
      if (clean.correct / clean.total - accuracy < gap) continue;
      if (!worst || accuracy < worst.accuracy) worst = { symbol, clean: clean.correct / clean.total, cleanAnswers: clean.total, situation, accuracy, answers: bucket.total };
    }
    if (worst) out.push(worst);
  }
  return out.sort((a, b) => a.accuracy - b.accuracy);
}

export interface PileupBreakdown {
  runs: number;
  picks: number;
  doubledPicks: number;
  /** First calls right, by how many stations answered at once. */
  firstCall: Record<PileupCrowd, { total: number; correct: number }>;
  similarMet: number;
  similarRight: number;
  narrowings: number;
  narrowed: number;
  causes: Partial<Record<PileupCause, number>>;
  /** What stands out, from the numbers alone. */
  findings: PileupFinding[];
}
export type PileupFinding = 'crowd-weak' | 'similar-mixups' | 'doubling-often' | 'narrowing-weak';

const FINDING_MIN = 6;

/** Every stored pileup summary added up (cloud summaries are enough: counts only). */
export function pileupBreakdown(sessions: Pick<SessionRecord, 'qso'>[]): PileupBreakdown | null {
  // A run where DECODE printed: its call copy may have been the screen's.
  const runs = sessions.flatMap((session) => (session.qso?.pileup && session.qso.assist?.decode !== 'shown' ? [session.qso.pileup] : []));
  if (!runs.length) return null;
  const firstCall = { '1': { total: 0, correct: 0 }, '2': { total: 0, correct: 0 }, '3+': { total: 0, correct: 0 } };
  const out: PileupBreakdown = { runs: runs.length, picks: 0, doubledPicks: 0, firstCall, similarMet: 0, similarRight: 0, narrowings: 0, narrowed: 0, causes: {}, findings: [] };
  for (const run of runs) {
    out.picks += run.picks;
    out.doubledPicks += run.doubledPicks;
    out.similarMet += run.similarMet;
    out.similarRight += run.similarRight;
    out.narrowings += run.narrowings;
    out.narrowed += run.narrowed;
    for (const crowd of ['1', '2', '3+'] as const) {
      firstCall[crowd].total += run.firstCall[crowd]?.total ?? 0;
      firstCall[crowd].correct += run.firstCall[crowd]?.correct ?? 0;
    }
    for (const [cause, count] of Object.entries(run.causes) as [PileupCause, number][]) out.causes[cause] = (out.causes[cause] ?? 0) + count;
  }
  const rate = (tally: { total: number; correct: number }) => tally.correct / tally.total;
  const alone = firstCall['1'];
  const crowded = firstCall['3+'];
  if (crowded.total >= FINDING_MIN && alone.total >= FINDING_MIN && rate(alone) - rate(crowded) >= 0.2) out.findings.push('crowd-weak');
  if ((out.causes.similar ?? 0) >= 3 && out.similarMet && out.similarRight / out.similarMet < 0.8) out.findings.push('similar-mixups');
  if (out.picks >= FINDING_MIN * 2 && out.doubledPicks / out.picks >= 0.15) out.findings.push('doubling-often');
  if (out.narrowings >= FINDING_MIN && out.narrowed / out.narrowings < 0.5) out.findings.push('narrowing-weak');
  return out;
}
