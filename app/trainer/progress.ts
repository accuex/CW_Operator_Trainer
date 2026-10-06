import { KOCH_PASS_ACCURACY, isKochComplete, kochBest, kochChars, kochMaxLesson, kochNewChars, kochProgressOf } from '@/lib/koch';
import { readProgressMeter } from '@/lib/progressMeter';
import type { AlphabetType, AnswerLog, TrainerProfile } from '@/lib/types';

/** 表示の主になるコッホ。和文セットだけで欧文がオフなら和文、ほかは欧文。 */
export const primaryKochAlphabet = (profile: Pick<TrainerProfile, 'unlockedKinds' | 'learnCourse'>): AlphabetType => {
  const kinds = profile.unlockedKinds ?? [];
  const latin = kinds.includes('latinLetter');
  const wabun = kinds.includes('wabun');
  if (wabun && !latin) return 'wabun';
  if (!kinds.length && profile.learnCourse === 'amateur-wabun') return 'wabun';
  return 'international';
};

/**
 * Level = Koch レベル試験の進捗（欧文 profile.koch / 和文 profile.kochWabun）。
 * XP・連続日数・今日の目標はログからの表示用集計で、保存しない。
 */
export const DAILY_GOAL = 40;

export interface PlayerStats {
  xp: number;
  /** Level を表すコッホ（欧文 / 和文）。 */
  kochAlphabet: AlphabetType;
  /** Koch レッスン（欧文 1–40 / 和文 1–52）。 */
  level: number;
  maxLevel: number;
  /** 現レベルのベスト正解率 / 合格ライン（0–1）。 */
  levelProgress: number;
  levelBest: number;
  /** 現レベルで聴き取る文字数。 */
  levelChars: number;
  /** 昇級すると加わる文字。全クリア後は null。 */
  nextChar: string | null;
  kochComplete: boolean;
  streakDays: number;
  todayAnswers: number;
  todayCorrect: number;
  dailyProgress: number;
  mastered: number;
}

const dayKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function playerStats(profile: TrainerProfile, answers: AnswerLog[], now = Date.now()): PlayerStats {
  const cards = Object.values(profile.cards);
  const mastered = cards.filter((card) => card.mastered).length;
  const meterXp = cards.reduce((sum, card) => sum + readProgressMeter(card), 0);
  const correct = answers.filter((answer) => answer.isCorrect).length;
  const xp = Math.round(meterXp + correct * 2 + answers.length + mastered * 50);

  const kochAlphabet = primaryKochAlphabet(profile);
  const koch = kochProgressOf(profile, kochAlphabet);
  const maxLevel = kochMaxLesson(kochAlphabet);
  const kochComplete = isKochComplete(koch, kochAlphabet);
  const levelBest = kochBest(koch, koch.level);
  const nextLesson = koch.level + 1;

  const today = dayKey(now);
  const todayLogs = answers.filter((answer) => dayKey(answer.timestamp) === today);
  const days = new Set(answers.map((answer) => dayKey(answer.timestamp)));
  let streakDays = 0;
  const cursor = new Date(now);
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.getTime()))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return {
    xp,
    kochAlphabet,
    level: koch.level,
    maxLevel,
    levelProgress: kochComplete ? 1 : Math.min(1, levelBest / KOCH_PASS_ACCURACY),
    levelBest,
    levelChars: kochChars(koch.level, kochAlphabet).length,
    nextChar: kochComplete || nextLesson > maxLevel ? null : kochNewChars(nextLesson, kochAlphabet)[0],
    kochComplete,
    streakDays,
    todayAnswers: todayLogs.length,
    todayCorrect: todayLogs.filter((answer) => answer.isCorrect).length,
    dailyProgress: Math.min(1, todayLogs.length / DAILY_GOAL),
    mastered,
  };
}
