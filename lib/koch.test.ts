import { describe, expect, it } from 'vitest';
import {
  KOCH_MAX_LESSON, KOCH_ORDER, applyKochResult, buildKochText, kochChars, kochNewChars, normalizeKoch, scoreKochCopy,
} from './koch';
import { buildMorseTimeline } from './timing';
import { DEFAULT_SETTINGS } from './storage';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe('koch order', () => {
  it('matches the LCWO 40-lesson order', () => {
    expect(KOCH_ORDER.length).toBe(41);
    expect(KOCH_MAX_LESSON).toBe(40);
    expect(kochChars(1)).toEqual(['K', 'M']);
    expect(kochNewChars(1)).toEqual(['K', 'M']);
    expect(kochNewChars(2)).toEqual(['U']);
    expect(kochNewChars(40)).toEqual(['X']);
    expect(kochChars(99)).toHaveLength(41);
  });
});

describe('buildKochText', () => {
  it('uses only lesson characters in 5-character groups', () => {
    const text = buildKochText(3, 1, DEFAULT_SETTINGS, seeded(1));
    const groups = text.split(' ');
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => group.length === 5)).toBe(true);
    expect(new Set(text.replace(/ /g, '')).size).toBeLessThanOrEqual(4);
    expect([...text.replace(/ /g, '')].every((symbol) => ['K', 'M', 'U', 'R'].includes(symbol))).toBe(true);
  });

  it('fits within the requested duration', () => {
    const settings = { ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 10 };
    const text = buildKochText(10, 2, settings, seeded(7));
    expect(buildMorseTimeline(text, 'international', settings).duration).toBeLessThanOrEqual(120);
    expect(buildMorseTimeline(`${text} KMURE`, 'international', settings).duration).toBeGreaterThan(110);
  });
});

describe('scoreKochCopy', () => {
  it('ignores spacing and case', () => {
    const score = scoreKochCopy('KMKMK MMKKM', 'kmkmkmmkkm');
    expect(score.accuracy).toBe(1);
    expect(score.passed).toBe(true);
  });

  it('counts substitutions, deletions and insertions against the expected length', () => {
    const score = scoreKochCopy('KMKMKMKMKM', 'KMKMKMKMK');
    expect(score.deletions).toBe(1);
    expect(score.accuracy).toBeCloseTo(0.9);
    expect(score.passed).toBe(true);
    const worse = scoreKochCopy('KMKMKMKMKM', 'KKKMKMKMK');
    expect(worse.passed).toBe(false);
    expect(worse.perChar.M.miss).toBeGreaterThan(0);
  });

  it('scores an empty copy as zero', () => {
    expect(scoreKochCopy('KMKMK', '').accuracy).toBe(0);
  });
});

describe('applyKochResult', () => {
  it('levels up only on a passing test at the current level', () => {
    const start = normalizeKoch(undefined);
    expect(applyKochResult(start, { lesson: 1, accuracy: 0.95, isTest: false }).leveledUp).toBe(false);
    expect(applyKochResult(start, { lesson: 1, accuracy: 0.85, isTest: true }).leveledUp).toBe(false);
    const passed = applyKochResult(start, { lesson: 1, accuracy: 0.92, isTest: true }, 1000);
    expect(passed.leveledUp).toBe(true);
    expect(passed.progress.level).toBe(2);
    expect(passed.progress.clearedAt['1']).toBe(1000);
  });

  it('keeps the best score from practice and tests', () => {
    const first = applyKochResult(undefined, { lesson: 1, accuracy: 0.7, isTest: false }).progress;
    const second = applyKochResult(first, { lesson: 1, accuracy: 0.6, isTest: true }).progress;
    expect(second.best['1']).toBe(0.7);
  });

  it('does not advance past the final lesson', () => {
    const final = applyKochResult({ level: 40, best: {}, clearedAt: {} }, { lesson: 40, accuracy: 1, isTest: true });
    expect(final.progress.level).toBe(40);
    expect(final.leveledUp).toBe(false);
    expect(final.cleared).toBe(true);
  });
});
