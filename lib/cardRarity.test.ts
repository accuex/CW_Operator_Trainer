import { describe, expect, it } from 'vitest';
import { kochPassRarity, promoteCardsForKochPass } from './cardRarity';
import type { CardProgress } from './types';

const progress = (partial: Partial<CardProgress> = {}): CardProgress => ({
  attempts: 0, correct: 0, streak: 0, mastered: false, reviewed: false, ...partial,
});

describe('kochPassRarity', () => {
  it('maps effective speed to R / SR / SSR', () => {
    expect(kochPassRarity(12)).toBe('R');
    expect(kochPassRarity(18)).toBe('SR');
    expect(kochPassRarity(21)).toBe('SR');
    expect(kochPassRarity(22)).toBe('SSR');
  });
});

describe('promoteCardsForKochPass', () => {
  it('grants R to unseen cards in the pool and marks them mastered', () => {
    const { cards, promoted } = promoteCardsForKochPass({}, ['K', 'M'], 'international', 15, 100);
    expect(promoted.map((item) => [item.symbol, item.from, item.to])).toEqual([['K', null, 'R'], ['M', null, 'R']]);
    expect(cards['international:K']).toMatchObject({ mastered: true, masteredAt: 100, rarityOwned: 'R' });
  });

  it('upgrades but never demotes', () => {
    const before = {
      'international:K': progress({ mastered: true, masteredAt: 1, rarityOwned: 'SSR' }),
      'international:M': progress({ mastered: true, masteredAt: 1 }),
    };
    const { cards, promoted } = promoteCardsForKochPass(before, ['K', 'M'], 'international', 18, 100);
    expect(promoted).toEqual([{ key: 'international:M', symbol: 'M', from: 'R', to: 'SR' }]);
    expect(cards['international:K'].rarityOwned).toBe('SSR');
    expect(cards['international:M']).toMatchObject({ rarityOwned: 'SR', masteredAt: 1 });
  });

  it('returns the same reference when nothing changes', () => {
    const before = { 'wabun:イ': progress({ mastered: true, rarityOwned: 'SR' }) };
    const result = promoteCardsForKochPass(before, ['イ'], 'wabun', 18);
    expect(result.cards).toBe(before);
    expect(result.promoted).toEqual([]);
  });

  it('skips Koch symbols without a card', () => {
    const { promoted } = promoteCardsForKochPass({}, [',', '?'], 'international', 25);
    expect(promoted).toEqual([]);
  });
});
