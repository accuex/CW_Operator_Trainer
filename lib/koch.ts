import { scoreExamCopy, type ExamAlignCell } from './examScore';
import { buildMorseTimeline } from './timing';
import type { AudioSettings, KochProgress } from './types';

/** LCWO の Koch 順。レッスン n は先頭 n + 1 文字（レッスン 1 = K, M）。 */
export const KOCH_ORDER = [
  'K', 'M', 'U', 'R', 'E', 'S', 'N', 'A', 'P', 'T', 'L', 'W', 'I', '.', 'J', 'Z', '=', 'F', 'O', 'Y', ',',
  'V', 'G', '5', '/', 'Q', '9', '2', 'H', '3', '8', 'B', '?', '4', '7', 'C', '1', 'D', '6', '0', 'X',
] as const;

export const KOCH_MAX_LESSON = KOCH_ORDER.length - 1;
export const KOCH_PASS_ACCURACY = 0.9;
export const KOCH_GROUP_SIZE = 5;
export const KOCH_DURATIONS = [1, 2, 3, 5] as const;
export type KochDuration = (typeof KOCH_DURATIONS)[number];

export const EMPTY_KOCH: KochProgress = { level: 1, best: {}, clearedAt: {} };

export const clampLesson = (lesson: number) => Math.min(KOCH_MAX_LESSON, Math.max(1, Math.round(lesson) || 1));

export const kochChars = (lesson: number): string[] => KOCH_ORDER.slice(0, clampLesson(lesson) + 1);

/** そのレッスンで新しく加わる文字。レッスン 1 は K と M の 2 文字。 */
export const kochNewChars = (lesson: number): string[] => {
  const value = clampLesson(lesson);
  return value === 1 ? [KOCH_ORDER[0], KOCH_ORDER[1]] : [KOCH_ORDER[value]];
};

export const normalizeKoch = (progress?: KochProgress | null): KochProgress => ({
  level: clampLesson(progress?.level ?? 1),
  best: { ...(progress?.best ?? {}) },
  clearedAt: { ...(progress?.clearedAt ?? {}) },
});

export const kochBest = (progress: KochProgress | undefined, lesson: number) => progress?.best[String(lesson)] ?? 0;
export const isKochCleared = (progress: KochProgress | undefined, lesson: number) => Boolean(progress?.clearedAt[String(lesson)]);
/** 全 40 レッスンの昇級試験に合格済み。 */
export const isKochComplete = (progress?: KochProgress) => isKochCleared(progress, KOCH_MAX_LESSON);

/**
 * 5 字群のランダム練習文。新しい文字は 2 倍の重みで出す。
 * 指定分数ちょうどに収まる字群数まで切り詰める（最低 1 群）。
 */
export function buildKochText(
  lesson: number,
  minutes: number,
  settings: AudioSettings,
  random: () => number = Math.random,
): string {
  const pool = kochChars(lesson);
  const fresh = new Set(kochNewChars(lesson));
  const weighted = pool.flatMap((symbol) => (fresh.has(symbol) && pool.length > 2 ? [symbol, symbol] : [symbol]));
  const target = Math.max(0.25, minutes) * 60;
  const estimate = Math.ceil(Math.max(0.25, minutes) * Math.max(5, settings.effectiveSpeed) * 1.6) + 2;
  const groups = Array.from({ length: estimate }, () =>
    Array.from({ length: KOCH_GROUP_SIZE }, () => weighted[Math.floor(random() * weighted.length)]).join(''),
  );
  const timeline = buildMorseTimeline(groups.join(' '), 'international', settings);
  const fitting = timeline.characters.filter((character) => character.end <= target).length;
  const count = Math.max(1, Math.floor(fitting / KOCH_GROUP_SIZE));
  return groups.slice(0, count).join(' ');
}

export type KochScore = {
  accuracy: number;
  passed: boolean;
  total: number;
  matches: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  cells: ExamAlignCell[];
  /** 出題文字ごとの出題数とミス数（誤字・脱字）。 */
  perChar: Record<string, { total: number; miss: number }>;
};

/** LCWO 相当の正解率: 1 −（誤字＋脱字＋冗字）/ 出題字数。空白は無視。 */
export function scoreKochCopy(expected: string, input: string): KochScore {
  const aligned = scoreExamCopy(expected, input, 'international');
  const total = aligned.expected.length;
  const errors = aligned.substitutions + aligned.deletions + aligned.insertions;
  const accuracy = total ? Math.max(0, 1 - errors / total) : 0;
  const perChar: KochScore['perChar'] = {};
  for (const cell of aligned.cells) {
    if (cell.op === 'ins') continue;
    const entry = perChar[cell.expected] ?? { total: 0, miss: 0 };
    entry.total += 1;
    if (cell.op !== 'match') entry.miss += 1;
    perChar[cell.expected] = entry;
  }
  return {
    accuracy,
    passed: accuracy >= KOCH_PASS_ACCURACY,
    total,
    matches: aligned.matches,
    substitutions: aligned.substitutions,
    deletions: aligned.deletions,
    insertions: aligned.insertions,
    cells: aligned.cells,
    perChar,
  };
}

/**
 * 結果を進捗に反映する。ベストは練習でも試験でも更新。
 * 昇級は「現在レベルの昇級試験で合格」したときだけ。
 */
export function applyKochResult(
  progress: KochProgress | undefined,
  result: { lesson: number; accuracy: number; isTest: boolean },
  now = Date.now(),
): { progress: KochProgress; leveledUp: boolean; cleared: boolean } {
  const current = normalizeKoch(progress);
  const lesson = clampLesson(result.lesson);
  const key = String(lesson);
  const best = { ...current.best, [key]: Math.max(current.best[key] ?? 0, result.accuracy) };
  const passedTest = result.isTest && lesson === current.level && result.accuracy >= KOCH_PASS_ACCURACY;
  if (!passedTest) return { progress: { ...current, best }, leveledUp: false, cleared: false };
  const clearedAt = { ...current.clearedAt, [key]: current.clearedAt[key] ?? now };
  const level = Math.min(KOCH_MAX_LESSON, current.level + 1);
  return { progress: { level, best, clearedAt }, leveledUp: level > current.level, cleared: true };
}
