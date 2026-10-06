import type { DemoQsoMode } from './types';

/** Guided rag-chew tutorial: tune to a prepared CQ and send the lit lines. */
export const demoMode: DemoQsoMode = {
  kind: 'demo',
  id: 'demo',
  label: 'チュートリアル',
  description: '同調→呼ぶ→レポートの手順を、案内つきで手を動かして覚える',
  alphabet: 'international',
  available: true,
  presets: [],
  axes: [],
};
