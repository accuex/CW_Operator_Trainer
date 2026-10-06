import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  hasStoredSettings,
  hasTrainerStarted,
  isLandingReturning,
  isReturningProfile,
  isReturningUser,
  markTrainerStarted,
  normalizeProfile,
} from './storage';
import type { CardProgress } from './types';

const SETTINGS_KEY = 'cwot:settings';
const STARTED_KEY = 'cwot:started';

const card: CardProgress = {
  attempts: 1, correct: 1, streak: 1, mastered: false, reviewed: true,
};

beforeAll(() => {
  if (typeof localStorage !== 'undefined') return;
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    },
  });
});

describe('isReturningProfile', () => {
  it('treats a blank profile as new', () => {
    expect(isReturningProfile(null)).toBe(false);
    expect(isReturningProfile(DEFAULT_PROFILE)).toBe(false);
  });

  it('treats a chosen course or any cards as returning', () => {
    expect(isReturningProfile({ ...DEFAULT_PROFILE, goal: 'sound' })).toBe(true);
    expect(isReturningProfile({ ...DEFAULT_PROFILE, totalTrainingMs: 12 })).toBe(true);
    expect(isReturningProfile({ ...DEFAULT_PROFILE, cards: { A: card } })).toBe(true);
  });

  it('ignores a leftover learnCourse with no goal', () => {
    expect(isReturningProfile({ ...DEFAULT_PROFILE, learnCourse: 'amateur-latin' })).toBe(false);
  });

  it('ignores a blank profile even after default unlocks are filled in', () => {
    expect(isReturningProfile(normalizeProfile(null))).toBe(false);
  });
});

describe('isLandingReturning', () => {
  afterEach(() => {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(STARTED_KEY);
  });

  it('is new until the start flag is written', () => {
    expect(isLandingReturning({ ...DEFAULT_PROFILE, goal: 'fun' })).toBe(false);
    expect(hasTrainerStarted()).toBe(false);
  });

  it('does not treat audio settings alone as returning', () => {
    localStorage.setItem(SETTINGS_KEY, '{}');
    expect(isLandingReturning(DEFAULT_PROFILE)).toBe(false);
  });

  it('migrates an existing course plus audio prefs onto the start flag', () => {
    localStorage.setItem(SETTINGS_KEY, '{}');
    expect(isLandingReturning({ ...DEFAULT_PROFILE, goal: 'fun' })).toBe(true);
    expect(hasTrainerStarted()).toBe(true);
  });

  it('follows the start flag even after IndexedDB still has a profile', () => {
    markTrainerStarted();
    expect(isLandingReturning(DEFAULT_PROFILE)).toBe(true);
    localStorage.removeItem(STARTED_KEY);
    expect(isLandingReturning({ ...DEFAULT_PROFILE, goal: 'fun' })).toBe(false);
  });
});

describe('isReturningUser', () => {
  afterEach(() => {
    localStorage.removeItem(SETTINGS_KEY);
  });

  it('does not treat default audio settings as a returning user', async () => {
    localStorage.setItem(SETTINGS_KEY, '{}');
    expect(await isReturningUser(DEFAULT_PROFILE)).toBe(false);
  });
});

describe('hasStoredSettings', () => {
  afterEach(() => {
    localStorage.removeItem(SETTINGS_KEY);
  });

  it('is false until settings have been written', () => {
    expect(hasStoredSettings()).toBe(false);
    localStorage.setItem(SETTINGS_KEY, '{}');
    expect(hasStoredSettings()).toBe(true);
  });
});
