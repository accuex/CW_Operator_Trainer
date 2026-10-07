import manifest from './illustration-manifest.json';

export function revealedIllustration(learningEntityId: string, meaningRevealed: boolean) {
  if (!meaningRevealed) return;
  const item = manifest.items[learningEntityId as keyof typeof manifest.items];
  if (!item) return;
  const asset = manifest.assets[item.assetId as keyof typeof manifest.assets];
  // Candidates are provisionally visible; rejected assets must never enter a card.
  if (!asset || !['human_visual_review_pending', 'approved'].includes(asset.status)) return;
  return { ...item, ...asset };
}
