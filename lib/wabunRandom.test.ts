import { describe, expect, it } from 'vitest';
import { WABUN_MORSE, tokenizeMorseInput } from './morse';
import { buildExamSession, measureExamAudioSec } from './training';
import { buildRandomWabunBodies, wabunWeakness } from './wabunRandom';
import type { AnswerLog } from './types';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

const log = (symbol: string, isCorrect: boolean): AnswerLog => ({
  id: `${symbol}-${Math.random()}`, timestamp: 0, alphabetType: 'wabun', correctSymbol: symbol, inputSymbol: isCorrect ? symbol : 'イ',
  characterSpeed: 20, effectiveSpeed: 20, queueTarget: 0, actualQueueDepth: 0, stimulusTime: 0, inputTime: 0,
  responseLatency: 0, mode: 'exam', isCorrect, isEarly: false, sessionId: 's',
});

const KANA = [...'イロハニホヘトチリヌルヲワカヨタレソツネナラムウノオクヤマケフコエテアサキユメミシヒモセスン'];

describe('wabun random body', () => {
  it('hits the exact length and covers every plain kana and mark across a set', () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      const bodies = buildRandomWabunBodies([87, 138], { weakness: new Map(), includeWiWe: false, random: seeded(seed) });
      expect(bodies.map((body) => body.length)).toEqual([87, 138]);
      const joined = bodies.join('');
      for (const symbol of [...KANA, 'ー', '、', '」', '（', '）']) expect(joined, `seed ${seed} ${symbol}`).toContain(symbol);
      expect(joined).not.toMatch(/[ヰヱ]/);
    }
  });

  it('keeps marks off the edges, never side by side, and brackets paired with 2–4 kana', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      for (const body of buildRandomWabunBodies([100, 140], { weakness: new Map(), includeWiWe: true, random: seeded(seed) })) {
        expect(body, body).not.toMatch(/^[ー、」）]|[、」（]$/);
        expect(body, body).not.toMatch(/[ー、」][ー、」]/);
        expect(body.replace(/（[ァ-ヶ]{2,4}）/g, ''), body).not.toMatch(/[（）]/);
        expect(body, body).not.toMatch(/(^|[^ァ-ヶ])ー/);
        const unknown = tokenizeMorseInput(body, 'wabun').filter((token) => !(token in WABUN_MORSE));
        expect(unknown, body).toEqual([]);
      }
    }
  });

  it('serves characters with many misses more often than ones copied cleanly', () => {
    const logs = [
      ...Array.from({ length: 40 }, (_, index) => log('ヌ', index % 2 === 0)),
      ...Array.from({ length: 40 }, () => log('ハ', true)),
    ];
    const weakness = wabunWeakness(logs);
    let weak = 0;
    let strong = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const text = buildRandomWabunBodies([120, 120], { weakness, includeWiWe: false, random: seeded(seed) }).join('');
      weak += [...text].filter((ch) => ch === 'ヌ').length;
      strong += [...text].filter((ch) => ch === 'ハ').length;
    }
    expect(weak).toBeGreaterThan(strong * 2.5);
  });

  it('builds a five-sheet practice session that stays within five minutes', () => {
    for (let round = 0; round < 15; round += 1) {
      const session = buildExamSession({ subjectId: 'wabun', telegram: true, randomWabun: { weakness: new Map() } });
      expect(session.practiceRandom).toBe(true);
      expect(session.sheets).toHaveLength(5);
      expect(measureExamAudioSec(session.sheets, 'wabun', 22)).toBeLessThanOrEqual(290);
    }
  });
});
