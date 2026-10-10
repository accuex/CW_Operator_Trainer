import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  applyAchievements,
  completedQsoContacts,
  dailyGoalClears,
  longestCorrectRun,
  ownedCardRarity,
  passedExamSubjects,
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
    expect(new Set(ACHIEVEMENTS.map((item) => item.id)).size).toBe(ACHIEVEMENTS.length);
    for (const item of ACHIEVEMENTS) {
      if (!item.game) expect(item.artwork).toBe(`/cards/achievements/${item.rarity.toLowerCase()}/${item.id}.webp`);
      else expect(item.artwork).toMatch(/^\/cards\/achievments\/(r|sr|ssr|sssr)\/cwdef_/);
    }
  });

  it('grants nothing to a fresh profile', () => {
    expect(satisfiedAchievements({ profile: DEFAULT_PROFILE, answers: [], sessions: [] })).toEqual([]);
  });
});

const examSession = (subject: 'wabun' | 'codes' | 'plain', accuracy: number, wpm: number, officialWpm: number): SessionRecord => ({
  id: `e-${subject}-${wpm}-${accuracy}`, startedAt: 1, endedAt: 2, mode: 'exam',
  alphabetType: subject === 'wabun' ? 'wabun' : 'international', answers: 100, accuracy,
  exam: { subject, wpm, officialWpm },
});

describe('exam pass achievements', () => {
  it('requires the pass line and the real exam speed', () => {
    expect(passedExamSubjects([examSession('plain', 0.95, 20, 23)]).size).toBe(0);
    expect(passedExamSubjects([examSession('plain', 0.85, 23, 23)]).size).toBe(0);
    expect([...passedExamSubjects([examSession('plain', 0.9, 23, 23)])]).toEqual(['plain']);
  });

  it('unlocks latin, wabun and the triple crown', () => {
    const sessions = [examSession('plain', 0.92, 23, 23), examSession('codes', 0.91, 21, 21), examSession('wabun', 0.93, 22, 22)];
    const ids = satisfiedAchievements({ profile: DEFAULT_PROFILE, answers: [], sessions });
    expect(ids).toEqual(expect.arrayContaining(['exam-pass-latin', 'exam-pass-wabun', 'exam-triple-crown', 'exam-debut']));
  });
});

describe('card rarity achievements', () => {
  it('unlocks first-sr / first-ssr from promoted cards', () => {
    const profile = {
      ...DEFAULT_PROFILE,
      cards: { 'international:K': { attempts: 0, correct: 0, streak: 0, mastered: true, reviewed: false, rarityOwned: 'SSR' as const } },
    };
    const ids = satisfiedAchievements({ profile, answers: [], sessions: [] });
    expect(ids).toEqual(expect.arrayContaining(['first-sr', 'first-ssr']));
    expect(ids).not.toContain('latin-speed-star');
  });
});

describe('koch achievements', () => {
  it('tracks the wabun ladder separately', () => {
    const profile = { ...DEFAULT_PROFILE, kochWabun: { level: 5, best: {}, clearedAt: {} } };
    const ids = satisfiedAchievements({ profile, answers: [], sessions: [] });
    expect(ids).toContain('wabun-koch-awakening');
    expect(ids).not.toContain('koch-awakening');
  });
});

describe('qso achievements', () => {
  const qsoSession = (partial: Partial<NonNullable<SessionRecord['qso']>>): SessionRecord => ({
    id: `q-${Math.random()}`, startedAt: 1, endedAt: 2, mode: 'qso', alphabetType: 'international', answers: 10, accuracy: 1,
    qso: {
      modeId: 'ragchew', presetId: 'basic', call: 'JA1AAA', outcome: 'complete', fields: 4, fieldsCorrect: 4,
      cleanAccuracy: 1, causes: { copy: 0, environment: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 },
      difficulty: {}, adjusted: {}, ...partial,
    },
  });

  it('counts complete contacts from runs and rag-chews', () => {
    const run = qsoSession({
      contacts: [
        { call: 'A', fields: 2, fieldsCorrect: 2, outcome: 'complete', at: 1 },
        { call: 'B', fields: 2, fieldsCorrect: 1, outcome: 'bust', at: 2 },
      ],
    });
    expect(completedQsoContacts([run, qsoSession({}), qsoSession({ outcome: 'partial' })])).toBe(2);
  });

  it('unlocks qso-debut', () => {
    expect(satisfiedAchievements({ profile: DEFAULT_PROFILE, answers: [], sessions: [qsoSession({})] })).toContain('qso-debut');
  });
});

describe('answer log achievements', () => {
  it('finds the longest correct run inside one session', () => {
    const answers = [
      ...Array.from({ length: 30 }, (_, index) => answer(index, { sessionId: 'a' })),
      answer(31, { sessionId: 'b' }),
      ...Array.from({ length: 20 }, (_, index) => answer(40 + index, { sessionId: 'a' })),
      answer(70, { sessionId: 'a', isCorrect: false }),
    ];
    expect(longestCorrectRun(answers)).toBe(50);
  });

  it('counts fast answers by the slower of character and effective speed', () => {
    const fast = Array.from({ length: 500 }, (_, index) => answer(index, { characterSpeed: 25, effectiveSpeed: 25 }));
    const farnsworth = Array.from({ length: 500 }, (_, index) => answer(index, { characterSpeed: 30, effectiveSpeed: 10 }));
    expect(satisfiedAchievements({ profile: DEFAULT_PROFILE, answers: fast, sessions: [] })).toContain('speed-25');
    expect(satisfiedAchievements({ profile: DEFAULT_PROFILE, answers: farnsworth, sessions: [] })).not.toContain('speed-25');
  });
});
