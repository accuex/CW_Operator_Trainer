import type { ContestQsoMode } from './types';

/** We run a frequency in a (fictional) contest: report and serial, as fast as it stays right. */
export const contestMode: ContestQsoMode = {
  kind: 'contest',
  id: 'contest',
  label: 'コンテスト',
  description: 'CQ TEST で呼ばれ、RST とシリアル番号を素早く正確に交換してログを流す',
  alphabet: 'international',
  available: true,
  // The exchange is the contest's (rules in lib/radio/contest); levels are chosen on the contest desk.
  presets: [],
  axes: [],
};
