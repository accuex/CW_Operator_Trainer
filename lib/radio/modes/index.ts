import { cqRunMode } from './cqRunMode';
import { pileupMode } from './pileupMode';
import { ragchew } from './ragchew';
import type { PileupQsoMode, QsoMode, QsoSession, QsoStep, RunContext, RunQsoMode, SessionContext, SingleQsoMode } from './types';

export type { PileupQsoMode, QsoMode, QsoSession, QsoStep, RunContext, RunQsoMode, SessionContext, SingleQsoMode };

/** Placeholder for modes that are designed but not built yet. */
const soon = (id: string, label: string, description: string, alphabet: QsoMode['alphabet'] = 'international'): QsoMode => ({
  kind: 'single', id, label, description, alphabet, available: false, presets: [], axes: [], steps: [],
  createSession: () => { throw new Error(`${id} is not available yet`); },
});

export const QSO_MODES: QsoMode[] = [
  ragchew,
  cqRunMode,
  soon('contest', 'コンテスト', '短い交換を素早く正確に。独自形式から始め、実在ルールはプリセットで追加'),
  pileupMode,
  soon('wabun-ragchew', '和文 QSO', 'ホレ〜ラタで始まる和文の交信', 'wabun'),
];

export const qsoMode = (id: string): QsoMode => QSO_MODES.find((mode) => mode.id === id && mode.available) ?? ragchew;
