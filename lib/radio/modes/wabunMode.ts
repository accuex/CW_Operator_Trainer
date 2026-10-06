import type { WabunQsoMode } from './types';

/** Call a station sending CQ ホレ and run a short wabun QSO (Level 1 打ち逃げ, Level 2 the rubber stamp, Level 3 / 4 a practical QSO: weather or shack, and a piece of news). */
export const wabunMode: WabunQsoMode = {
  kind: 'wabun',
  id: 'wabun-ragchew',
  label: '和文 QSO',
  description: 'CQ ホレ の局を欧文で呼び、ホレ〜ラタの短い和文で交信する（Lv1 打ち逃げ・Lv2 ラバースタンプ・Lv3 天気・設備・Lv4 近況ひとこと・Lv5 実用ラグチュー）',
  alphabet: 'wabun',
  available: true,
  presets: [],
  // Speed is chosen on the wabun desk; no shared difficulty axes yet.
  axes: [],
};
