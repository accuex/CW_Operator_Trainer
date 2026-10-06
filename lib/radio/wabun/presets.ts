import type { WabunAxes } from './adapt';
import type { FistOptions, WabunLevel } from './scenario';

/**
 * Stations for human auditory QA (Level 5): the same station every time from a seed, so
 * a person can listen to one fist, one band, and report on it. Development only: the
 * desk takes one from the address (`?wabunPreset=fatigue`, `&seed=` to pick another
 * station of the kind); the headless sim runs the same ones (sim.test / stage5.test).
 */
export interface WabunPreset {
  label: string;
  level: WabunLevel;
  /** The station's WPM. */
  wpm: number;
  seed: number;
  /** Axes beside the defaults (rf: the band, load: the talk). */
  axes: Partial<WabunAxes>;
  fist: FistOptions;
  /** What to listen for. */
  listen: string;
}

export const WABUN_PRESETS = {
  'lv5-clean': { label: 'Lv5 エレキー・きれいな電波', level: 5, wpm: 13, seed: 501, axes: { rf: 0 }, fist: { kind: 'keyer', strength: 1, fatigue: false }, listen: '符号がきれいか・字間語間の好みが自然か' },
  straight: { label: 'Lv5 縦振れ（軽め）', level: 5, wpm: 13, seed: 502, axes: { rf: 0 }, fist: { kind: 'straight', strength: 0.6, fatigue: false }, listen: '縦振れらしいか・読めるか（崩れすぎていないか）' },
  fatigue: { label: 'Lv5 縦振れ・長い電文の後半で疲れ', level: 5, wpm: 13, seed: 503, axes: { rf: 0, load: 2 }, fist: { kind: 'straight', strength: 1, fatigue: true }, listen: '長い電文の後半で間隔が少し崩れ、次の電文で戻るか' },
  'qrm-qsb': { label: 'Lv5 QRM・QSB あり', level: 5, wpm: 13, seed: 504, axes: { rf: 0.75 }, fist: { kind: 'keyer', strength: 1, fatigue: false }, listen: '混信・フェージングの中で追えるか（つらすぎないか）' },
  long: { label: 'Lv5 話の量 多め（バグキー）', level: 5, wpm: 13, seed: 505, axes: { rf: 0.25, load: 2 }, fist: { kind: 'bug', strength: 1, fatigue: false }, listen: 'QSO 全体の長さ・話題の追いやすさ' },
  repeat: { label: 'Lv5 聞き返し練習（QSB 強め）', level: 5, wpm: 13, seed: 506, axes: { rf: 0.5 }, fist: { kind: 'bug', strength: 0.8, fatigue: false }, listen: 'ナス サラオネ / サラオネ で話題・詳細だけが短く再送されるか' },
} satisfies Record<string, WabunPreset>;
export type WabunPresetId = keyof typeof WABUN_PRESETS;

/** The preset in the address, development only (null in production or without one). */
export function devWabunPreset(): (WabunPreset & { id: WabunPresetId }) | null {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const id = params.get('wabunPreset') as WabunPresetId | null;
  if (!id || !(id in WABUN_PRESETS)) return null;
  const seed = Number(params.get('seed'));
  return { ...WABUN_PRESETS[id], id, ...(Number.isInteger(seed) && seed > 0 ? { seed } : {}) };
}
