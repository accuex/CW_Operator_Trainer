import { CARDS } from './morse';
import type { AlphabetType, CardProgress, CardRarityOwned } from './types';

/**
 * Card rarity promotion (docs/card_collection_rarity_plan.md).
 * A passed Koch level test promotes every character in that lesson's pool:
 * R always, SR from SR_EFFECTIVE_WPM, SSR from SSR_EFFECTIVE_WPM (effective speed).
 * Never demotes.
 */
export const SR_EFFECTIVE_WPM = 18;
export const SSR_EFFECTIVE_WPM = 22;

/** Effective owned rarity: explicit rarityOwned, else mastered → R. */
export function ownedCardRarity(progress?: CardProgress): CardRarityOwned | null {
  if (progress?.rarityOwned) return progress.rarityOwned;
  if (progress?.mastered) return 'R';
  return null;
}

export const rarityRank = (rarity: CardRarityOwned | null | undefined) => {
  if (rarity === 'SSR') return 3;
  if (rarity === 'SR') return 2;
  if (rarity === 'R') return 1;
  return 0;
};

export const kochPassRarity = (effectiveWpm: number): CardRarityOwned => {
  if (effectiveWpm >= SSR_EFFECTIVE_WPM) return 'SSR';
  if (effectiveWpm >= SR_EFFECTIVE_WPM) return 'SR';
  return 'R';
};

export interface CardPromotion {
  key: string;
  symbol: string;
  from: CardRarityOwned | null;
  to: CardRarityOwned;
}

const CARD_KEYS = new Set(CARDS.map((card) => `${card.alphabet}:${card.symbol}`));

const blankProgress = (): CardProgress => ({
  attempts: 0, correct: 0, streak: 0, mastered: false, reviewed: false, exposures: 0, confirmCorrect: 0, progressMeter: 0,
});

/**
 * Promote the cards for `symbols` after a passed Koch level test.
 * Returns the same `cards` reference when nothing changed.
 */
export function promoteCardsForKochPass(
  cards: Record<string, CardProgress>,
  symbols: readonly string[],
  alphabet: AlphabetType,
  effectiveWpm: number,
  now = Date.now(),
): { cards: Record<string, CardProgress>; promoted: CardPromotion[] } {
  const to = kochPassRarity(effectiveWpm);
  const promoted: CardPromotion[] = [];
  let next: Record<string, CardProgress> | null = null;

  for (const symbol of new Set(symbols)) {
    const key = `${alphabet}:${symbol}`;
    if (!CARD_KEYS.has(key)) continue;
    const progress = cards[key];
    const from = ownedCardRarity(progress);
    if (rarityRank(from) >= rarityRank(to)) continue;
    if (!next) next = { ...cards };
    const base = progress ?? blankProgress();
    next[key] = { ...base, mastered: true, masteredAt: base.masteredAt ?? now, rarityOwned: to };
    promoted.push({ key, symbol, from, to });
  }

  return { cards: next ?? cards, promoted };
}
