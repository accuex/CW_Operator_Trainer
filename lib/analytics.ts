import type { AnswerLog, CopySituation } from './types';

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
 * (QRM / QSB / QRN / weak), tuning or timing — only clean-condition copy counts.
 * Set `includeEnvironment` to see everything. The records themselves are kept.
 */
export const isCleanCopy = (log: AnswerLog) => !log.qso || log.qso.condition === 'clean';
export const forWeakAnalysis = (logs: AnswerLog[], includeEnvironment = false) => (includeEnvironment ? logs : logs.filter(isCleanCopy));

export interface ConditionRow { condition: string; answers: number; accuracy: number }

/** What a QSO character went through; older records have only the condition (muted = we keyed over it). */
export const situationOfLog = (log: AnswerLog): CopySituation | null => {
  if (!log.qso) return null;
  return log.qso.situation ?? (log.qso.condition === 'muted' ? 'doubled' : log.qso.condition);
};

/**
 * QSO copy accuracy per situation (clean vs QRM vs QSB vs doubled …), optionally for
 * one log field (`call` → how calls hold up under each).
 */
export function qsoConditionBreakdown(logs: AnswerLog[], field?: string): ConditionRow[] {
  const buckets = new Map<string, { total: number; correct: number }>();
  for (const log of logs) {
    const situation = situationOfLog(log);
    if (!situation || (field && log.qso?.field !== field)) continue;
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
    if (!situation || situation === 'unheard') continue;
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
