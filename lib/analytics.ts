import type { AnswerLog } from './types';

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
