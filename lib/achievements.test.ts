import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  applyAchievements,
  dailyGoalClears,
  ownedCardRarity,
  satisfiedAchievements,
  streakDaysFromAnswers,
} from './achievements';
import { DEFAULT_PROFILE } from './storage';
import type { AnswerLog, SessionRecord, TrainerProfile } from './types';

const day = (offset: number, hour = 12) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.getTime();
};

const answer = (timestamp: number, partial: Partial<AnswerLog> = {}): AnswerLog => ({
  id: `a-${timestamp}-${Math.random()}`,
  timestamp,
  alphabetType: 'international',
  correctSymbol: 'A',
  inputSymbol: 'A',
  characterSpeed: 20,
  effectiveSpeed: 12,
  queueTarget: 0,
  actualQueueDepth: 0,
  stimulusTime: timestamp,
  inputTime: timestamp,
  responseLatency: 0,
  mode: 'sound',
  isCorrect: true,
  isEarly: false,
  sessionId: 's1',
  ...partial,
});

describe('ownedCardRarity', () => {
  it('treats mastered without rarityOwned as R', () => {
    expect(ownedCardRarity({ attempts: 10, correct: 10, streak: 5, mastered: true, reviewed: true })).toBe('R');
  });
  it('prefers rarityOwned', () => {
    expect(ownedCardRarity({
      attempts: 10, correct: 10, streak: 5, mastered: true, reviewed: true, rarityOwned: 'SSR',
    })).toBe('SSR');
  });
});

describe('streakDaysFromAnswers', () => {
  it('counts consecutive days ending today', () => {
    const answers = [answer(day(0)), answer(day(-1)), answer(day(-2))];
    expect(streakDaysFromAnswers(answers, day(0))).toBe(3);
  });
});

describe('dailyGoalClears', () => {
  it('counts days with at least 40 answers', () => {
    const answers = Array.from({ length: 40 }, (_, index) => answer(day(0) + index));
    expect(dailyGoalClears(answers)).toBe(1);
  });
});

describe('applyAchievements', () => {
  it('unlocks latin-starter after 10 mastered latin letters', () => {
    const cards: TrainerProfile['cards'] = {};
    for (const symbol of 'ABCDEFGHIJ') {
      cards[`international:${symbol}`] = {
        attempts: 10, correct: 10, streak: 5, mastered: true, reviewed: true, masteredAt: 1,
      };
    }
    const profile = { ...DEFAULT_PROFILE, cards };
    const { unlocked, profile: next } = applyAchievements(profile, [], [], 1000);
    expect(unlocked).toContain('latin-starter');
    expect(next.achievements?.['latin-starter']?.unlockedAt).toBe(1000);
  });

  it('is idempotent once unlocked', () => {
    const cards: TrainerProfile['cards'] = {};
    for (const symbol of 'ABCDEFGHIJ') {
      cards[`international:${symbol}`] = {
        attempts: 10, correct: 10, streak: 5, mastered: true, reviewed: true,
      };
    }
    const profile = {
      ...DEFAULT_PROFILE,
      cards,
      achievements: { 'latin-starter': { unlockedAt: 1 } },
    };
    const { unlocked, profile: next } = applyAchievements(profile, [], []);
    expect(unlocked).toEqual([]);
    expect(next).toBe(profile);
  });

  it('unlocks queue and exam debuts from sessions', () => {
    const sessions: SessionRecord[] = [
      {
        id: 'q1', startedAt: 1, endedAt: 2, mode: 'queue', alphabetType: 'international',
        answers: 10, accuracy: 1, queue: {
          target: 3, answered: 10, correct: 10, earlyCopies: 0, queueDrops: 0, burstOutputs: 0,
          meanDepth: 3, medianDepth: 3, stableDepth: 3, stableRate: 1, longestStableRun: 5,
          cadenceStability: 1, scoreMultiplier: 1,
        },
      },
      {
        id: 'e1', startedAt: 3, endedAt: 4, mode: 'exam', alphabetType: 'international',
        answers: 5, accuracy: 0.8,
      },
    ];
    const ids = satisfiedAchievements({ profile: DEFAULT_PROFILE, answers: [], sessions });
    expect(ids).toEqual(expect.arrayContaining(['queue-debut', 'queue-depth-3', 'exam-debut']));
  });

  it('lists every catalog entry with artwork path', () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(14);
    for (const item of ACHIEVEMENTS) {
      expect(item.artwork).toBe(`/cards/achievements/${item.rarity.toLowerCase()}/${item.id}.webp`);
    }
  });
});
