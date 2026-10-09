import { ownedCardRarity } from './cardRarity';
import type { CardProgress, CardRarityOwned } from './types';

/** Display rarity in the archive. revealAll uses the chosen preview rarity (no progress write). */
export function effectiveDisplayRarity(
  progress: CardProgress | undefined,
  revealAll: boolean,
  previewRarity: CardRarityOwned = 'SSR',
): CardRarityOwned | null {
  if (revealAll) return previewRarity;
  return ownedCardRarity(progress);
}
