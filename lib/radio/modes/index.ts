import { ragchew } from './ragchew';
import type { QsoMode, QsoSession, QsoStep, SessionContext } from './types';

export type { QsoMode, QsoSession, QsoStep, SessionContext };

/** Placeholder for modes that are designed but not built yet. */
const soon = (id: string, label: string, description: string, alphabet: QsoMode['alphabet'] = 'international'): QsoMode => ({
  id, label, description, alphabet, available: false, presets: [], steps: [],
  createSession: () => { throw new Error(`${id} is not available yet`); },
});

export const QSO_MODES: QsoMode[] = [
  ragchew,
  soon('cq-run', 'CQ を出す', '自分で CQ を出し、呼んできた局と交信する'),
  soon('contest', 'コンテスト', '短い交換を素早く正確に。独自形式から始め、実在ルールはプリセットで追加'),
  soon('pileup', 'パイルアップ', '一斉に呼んでくる局の中からコールを拾う／珍局を呼んで取る'),
  soon('wabun-ragchew', '和文 QSO', 'ホレ〜ラタで始まる和文の交信', 'wabun'),
];

export const qsoMode = (id: string) => QSO_MODES.find((mode) => mode.id === id && mode.available) ?? ragchew;
