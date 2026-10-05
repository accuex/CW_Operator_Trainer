import { describe, expect, it } from 'vitest';
import {
  WABUN_KOCH_MAX_LESSON, WABUN_KOCH_ORDER, applyKochResult, buildKochText, kochChars, kochNewChars, kochProgressOf, scoreKochCopy,
} from './koch';
import { WABUN_MORSE } from './morse';
import { DEFAULT_SETTINGS } from './storage';
import { normalizeWabunCopy, romajiToWabun } from './wabunInput';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const levenshtein = (a: string, b: string) => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
};

describe('wabun koch order', () => {
  it('covers every kana plus ゛ ゜ 、 」 ー exactly once', () => {
    expect(new Set(WABUN_KOCH_ORDER).size).toBe(WABUN_KOCH_ORDER.length);
    expect(WABUN_KOCH_ORDER.length).toBe(53);
    expect(WABUN_KOCH_MAX_LESSON).toBe(52);
    expect(WABUN_KOCH_ORDER.every((symbol) => WABUN_MORSE[symbol])).toBe(true);
    expect(kochChars(1, 'wabun')).toEqual(['カ', 'タ']);
    expect(kochNewChars(2, 'wabun')).toEqual(['゛']);
    expect(kochChars(99, 'wabun')).toHaveLength(53);
  });

  it('keeps one-element-apart codes out of the previous three introductions (main body)', () => {
    // 末尾の低頻度字（ヱ ヰ フ ー）は残り物どうしなので除外。゛/タ は 2 要素どうしで許容。
    const allowed = new Set(['゛/タ']);
    const body = WABUN_KOCH_ORDER.slice(0, 48);
    for (let index = 1; index < body.length; index += 1) {
      for (const previous of body.slice(Math.max(0, index - 3), index)) {
        const pair = `${body[index]}/${previous}`;
        if (allowed.has(pair)) continue;
        expect(levenshtein(WABUN_MORSE[body[index]], WABUN_MORSE[previous]), pair).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('wabun koch text', () => {
  it('builds 5-unit groups from the lesson pool and never sends a bare ゛', () => {
    for (let seed = 1; seed < 20; seed += 1) {
      const text = buildKochText(6, 2, DEFAULT_SETTINGS, seeded(seed), 'wabun');
      const pool = new Set(kochChars(6, 'wabun'));
      for (const group of text.split(' ')) {
        const units = [...group];
        expect(units).toHaveLength(5);
        expect(units.every((unit) => pool.has(unit))).toBe(true);
        units.forEach((unit, index) => {
          if (unit === '゛') expect('カシハツテタ').toContain(units[index - 1]);
        });
      }
    }
  });
});

describe('wabun input', () => {
  it('converts romaji to telegraph-style katakana', () => {
    expect(romajiToWabun('katakana')).toBe('カタカナ');
    expect(romajiToWabun('kanna')).toBe('カンナ');
    expect(romajiToWabun('konnichiha')).toBe('コンニチハ');
    expect(romajiToWabun('kitte')).toBe('キツテ');
    expect(romajiToWabun('kyou')).toBe('キヨウ');
    expect(romajiToWabun('shinbunsha')).toBe('シンブンシヤ');
    expect(romajiToWabun('wo we wi')).toBe('ヲ ヱ ヰ');
    expect(romajiToWabun('ka@,]-[')).toBe('カ゛、」ー゜');
  });

  it('leaves unfinished romaji pending for live typing', () => {
    expect(romajiToWabun('kak')).toBe('カk');
    expect(romajiToWabun('kash')).toBe('カsh');
    expect(romajiToWabun('kan')).toBe('カn');
    expect(romajiToWabun('kann')).toBe('カnn');
  });

  it('normalizes hiragana, voiced kana and romaji to the same units', () => {
    expect(normalizeWabunCopy('ガタ')).toBe('カ゛タ');
    expect(normalizeWabunCopy('がた')).toBe('カ゛タ');
    expect(normalizeWabunCopy('gata')).toBe('カ゛タ');
    expect(normalizeWabunCopy('カ@タ')).toBe('カ゛タ');
    expect(normalizeWabunCopy('ほん')).toBe('ホン');
    expect(normalizeWabunCopy('hon')).toBe('ホン');
    expect(normalizeWabunCopy('しゃ')).toBe('シヤ');
  });
});

describe('wabun koch scoring and progress', () => {
  it('scores voiced kana typed in any form', () => {
    expect(scoreKochCopy('カ゛タシ、 ハイツテニ', 'ガタシ、ハイツテニ', 'wabun').accuracy).toBe(1);
    expect(scoreKochCopy('カ゛タシ、 ハイツテニ', 'gatashi,haitsuteni', 'wabun').accuracy).toBe(1);
    expect(scoreKochCopy('カ゛タシ、', 'カタシ、', 'wabun').deletions).toBe(1);
  });

  it('keeps wabun progress separate and allows 52 lessons', () => {
    const profile = { koch: { level: 7, best: {}, clearedAt: {} }, kochWabun: { level: 51, best: {}, clearedAt: {} } };
    expect(kochProgressOf(profile, 'international').level).toBe(7);
    expect(kochProgressOf(profile, 'wabun').level).toBe(51);
    const up = applyKochResult(profile.kochWabun, { lesson: 51, accuracy: 0.95, isTest: true }, 1, 'wabun');
    expect(up.progress.level).toBe(52);
    const final = applyKochResult(up.progress, { lesson: 52, accuracy: 0.95, isTest: true }, 2, 'wabun');
    expect(final.progress.level).toBe(52);
    expect(final.cleared).toBe(true);
  });
});
