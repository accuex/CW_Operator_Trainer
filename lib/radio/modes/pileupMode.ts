import type { PileupQsoMode } from './types';

/** Everyone calls us at once: pull one call at a time out of the pile with partials. */
export const pileupMode: PileupQsoMode = {
  kind: 'pileup',
  id: 'pileup',
  label: 'パイルアップ',
  description: '一斉に呼んでくる局の中から、聞こえた文字を手掛かりに 1 局ずつ拾う',
  alphabet: 'international',
  available: true,
  presets: ['pileup-rst'],
  // Levels are chosen on the pileup desk (PILEUP_LEVELS) and おまかせ moves its own axes
  // (PILEUP_ADAPT_AXES); the shared difficulty panel has nothing to move.
  axes: [],
};
