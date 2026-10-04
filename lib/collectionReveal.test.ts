import { describe, expect, it } from 'vitest';
import { effectiveDisplayRarity } from './collectionReveal';
import { normalizeProfile } from './storage';
import type { CardProgress } from './types';

const masteredR = (): CardProgress => ({
  attempts: 10,
  correct: 10,
  streak: 5,
  mastered: true,
  reviewed: true,
  rarityOwned: 'R',
});

describe('effectiveDisplayRarity', () => {
  it('uses the chosen preview rarity when revealAll is on', () => {
    expect(effectiveDisplayRarity(undefined, true)).toBe('SSR');
    expect(effectiveDisplayRarity(undefined, true, 'R')).toBe('R');
    expect(effectiveDisplayRarity(masteredR(), true, 'SR')).toBe('SR');
  });

  it('uses real owned rarity when revealAll is off', () => {
    expect(effectiveDisplayRarity(undefined, false)).toBeNull();
    expect(effectiveDisplayRarity(masteredR(), false)).toBe('R');
    expect(effectiveDisplayRarity({ ...masteredR(), rarityOwned: 'SR' }, false)).toBe('SR');
  });
});

describe('normalizeProfile revealAll', () => {
  it('normalizes revealAll to a boolean', () => {
    expect(normalizeProfile(null).revealAll).toBe(false);
    expect(normalizeProfile({ ...normalizeProfile(null), revealAll: true }).revealAll).toBe(true);
    expect(normalizeProfile({ ...normalizeProfile(null), revealAll: undefined }).revealAll).toBe(false);
  });
});
