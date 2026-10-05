import { scoreExamCopy, type ExamAlignCell } from './examScore';
import { buildMorseTimeline } from './timing';
import type { AlphabetType, AudioSettings, KochProgress, TrainerProfile } from './types';
import { normalizeWabunCopy } from './wabunInput';

/** LCWO の Koch 順。レッスン n は先頭 n + 1 文字（レッスン 1 = K, M）。 */
export const KOCH_ORDER = [
  'K', 'M', 'U', 'R', 'E', 'S', 'N', 'A', 'P', 'T', 'L', 'W', 'I', '.', 'J', 'Z', '=', 'F', 'O', 'Y', ',',
  'V', 'G', '5', '/', 'Q', '9', '2', 'H', '3', '8', 'B', '?', '4', '7', 'C', '1', 'D', '6', '0', 'X',
] as const;

/**
 * 和文コッホ順（53 字・52 レッスン）。イロハ順ではなく次の基準で決めた（docs/wabun_koch_method.md）。
 * 1. 出現頻度順（一総通 和文普通語 1,000 セットの実測。゛ が 9.5% で最多）
 * 再計算・検証は `node scripts/wabunKochOrder.mjs`。
 * 2. 直前 3 字と符号の編集距離が 1 の字（イ/ロ、ハ/ニ/ホ など）は後回し
 * 3. 先頭はリズムの対照がはっきりした カ・タ、すぐ ゛ を入れて濁音を作れるようにする
 */
export const WABUN_KOCH_ORDER = [
  'カ', 'タ', '゛', 'シ', '、', 'ハ', 'イ', 'ツ', 'テ', 'ニ', 'ウ', 'ト', 'コ', 'ン', 'ル', 'ク', 'ナ', 'ヨ', 'キ', 'ノ',
  'ラ', 'マ', 'ス', 'ア', 'オ', 'セ', 'チ', 'サ', '」', 'レ', 'モ', 'ミ', 'エ', 'ヤ', 'ヒ', 'ム', 'ユ', 'ヲ', 'ワ', 'ヘ',
  'リ', 'メ', 'ケ', 'ロ', 'ソ', 'ホ', '゜', 'ネ', 'ヌ', 'ヱ', 'ヰ', 'フ', 'ー',
] as const;

export const kochOrder = (alphabet: AlphabetType = 'international'): readonly string[] =>
  alphabet === 'wabun' ? WABUN_KOCH_ORDER : KOCH_ORDER;
export const kochMaxLesson = (alphabet: AlphabetType = 'international') => kochOrder(alphabet).length - 1;

export const KOCH_MAX_LESSON = KOCH_ORDER.length - 1;
export const WABUN_KOCH_MAX_LESSON = WABUN_KOCH_ORDER.length - 1;
export const KOCH_PASS_ACCURACY = 0.9;
export const KOCH_GROUP_SIZE = 5;
export const KOCH_DURATIONS = [1, 2, 3, 5] as const;
export type KochDuration = (typeof KOCH_DURATIONS)[number];

export const EMPTY_KOCH: KochProgress = { level: 1, best: {}, clearedAt: {} };

export const clampLesson = (lesson: number, alphabet: AlphabetType = 'international') =>
  Math.min(kochMaxLesson(alphabet), Math.max(1, Math.round(lesson) || 1));

export const kochChars = (lesson: number, alphabet: AlphabetType = 'international'): string[] =>
  kochOrder(alphabet).slice(0, clampLesson(lesson, alphabet) + 1);

/** そのレッスンで新しく加わる文字。レッスン 1 は 2 文字（欧文 K・M、和文 カ・タ）。 */
export const kochNewChars = (lesson: number, alphabet: AlphabetType = 'international'): string[] => {
  const order = kochOrder(alphabet);
  const value = clampLesson(lesson, alphabet);
  return value === 1 ? [order[0], order[1]] : [order[value]];
};

/** 欧文は profile.koch、和文は profile.kochWabun。 */
export const kochProgressKey = (alphabet: AlphabetType): 'koch' | 'kochWabun' => (alphabet === 'wabun' ? 'kochWabun' : 'koch');
export const kochProgressOf = (profile: Pick<TrainerProfile, 'koch' | 'kochWabun'>, alphabet: AlphabetType) =>
  normalizeKoch(profile[kochProgressKey(alphabet)], alphabet);

export const normalizeKoch = (progress?: KochProgress | null, alphabet: AlphabetType = 'international'): KochProgress => ({
  level: clampLesson(progress?.level ?? 1, alphabet),
  best: { ...(progress?.best ?? {}) },
  clearedAt: { ...(progress?.clearedAt ?? {}) },
});

export const kochBest = (progress: KochProgress | undefined, lesson: number) => progress?.best[String(lesson)] ?? 0;
export const isKochCleared = (progress: KochProgress | undefined, lesson: number) => Boolean(progress?.clearedAt[String(lesson)]);
/** 最終レッスンの昇級試験に合格済み。 */
export const isKochComplete = (progress?: KochProgress, alphabet: AlphabetType = 'international') =>
  isKochCleared(progress, kochMaxLesson(alphabet));

/** ゛ が付けられる字（カ・サ・タ・ハ行とウ）。 */
const VOICEABLE = new Set([...'カキクケコサシスセソタチツテトハヒフヘホウ']);
const SEMI_VOICEABLE = new Set([...'ハヒフヘホ']);

/**
 * 和文の字群に置けるか。゛／゜ は単独では送らないので、付けられる字の直後だけに置く。
 * 群の先頭や、別の ゛／゜ の後ろには置かない。
 */
const fitsWabunGroup = (symbol: string, previous: string | undefined) => {
  if (symbol === '゛') return Boolean(previous && VOICEABLE.has(previous));
  if (symbol === '゜') return Boolean(previous && SEMI_VOICEABLE.has(previous));
  return true;
};

function drawGroup(weighted: string[], alphabet: AlphabetType, random: () => number): string {
  const group: string[] = [];
  while (group.length < KOCH_GROUP_SIZE) {
    let symbol = weighted[Math.floor(random() * weighted.length)];
    if (alphabet === 'wabun') {
      for (let tries = 0; tries < 8 && !fitsWabunGroup(symbol, group.at(-1)); tries += 1) {
        symbol = weighted[Math.floor(random() * weighted.length)];
      }
      if (!fitsWabunGroup(symbol, group.at(-1))) continue;
    }
    group.push(symbol);
  }
  return group.join('');
}

/**
 * 5 字群のランダム練習文。新しい文字は 2 倍の重みで出す。
 * 指定分数ちょうどに収まる字群数まで切り詰める（最低 1 群）。
 * 和文の ゛／゜ は 1 字として数え、付けられる字の直後にだけ置く。
 */
export function buildKochText(
  lesson: number,
  minutes: number,
  settings: AudioSettings,
  random: () => number = Math.random,
  alphabet: AlphabetType = 'international',
): string {
  const pool = kochChars(lesson, alphabet);
  const fresh = new Set(kochNewChars(lesson, alphabet));
  const weighted = pool.flatMap((symbol) => (fresh.has(symbol) && pool.length > 2 ? [symbol, symbol] : [symbol]));
  const target = Math.max(0.25, minutes) * 60;
  const estimate = Math.ceil(Math.max(0.25, minutes) * Math.max(5, settings.effectiveSpeed) * 1.6) + 2;
  const groups = Array.from({ length: estimate }, () => drawGroup(weighted, alphabet, random));
  const timeline = buildMorseTimeline(groups.join(' '), alphabet, settings);
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

/**
 * LCWO 相当の正解率: 1 −（誤字＋脱字＋冗字）/ 出題字数。空白は無視。
 * 和文はローマ字・ひらがな・濁音の合成字を電信表記（カ゛ など）にそろえてから比べる。
 */
export function scoreKochCopy(expected: string, input: string, alphabet: AlphabetType = 'international'): KochScore {
  const aligned = alphabet === 'wabun'
    ? scoreExamCopy(normalizeWabunCopy(expected), normalizeWabunCopy(input), 'wabun')
    : scoreExamCopy(expected, input, 'international');
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
  alphabet: AlphabetType = 'international',
): { progress: KochProgress; leveledUp: boolean; cleared: boolean } {
  const current = normalizeKoch(progress, alphabet);
  const lesson = clampLesson(result.lesson, alphabet);
  const key = String(lesson);
  const best = { ...current.best, [key]: Math.max(current.best[key] ?? 0, result.accuracy) };
  const passedTest = result.isTest && lesson === current.level && result.accuracy >= KOCH_PASS_ACCURACY;
  if (!passedTest) return { progress: { ...current, best }, leveledUp: false, cleared: false };
  const clearedAt = { ...current.clearedAt, [key]: current.clearedAt[key] ?? now };
  const level = Math.min(kochMaxLesson(alphabet), current.level + 1);
  return { progress: { level, best, clearedAt }, leveledUp: level > current.level, cleared: true };
}
