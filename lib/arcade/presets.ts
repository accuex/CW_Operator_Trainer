import { INTERNATIONAL_MORSE, WABUN_MORSE } from '../morse';
import type { AlphabetType } from '../types';
export const PRESETS = {
  letters: { label: '欧文', alphabet: 'international', symbols: Object.keys(INTERNATIONAL_MORSE).filter(s=>/^[A-Z]$/.test(s)) },
  alphanumeric: { label: '欧文＋数字', alphabet: 'international', symbols: Object.keys(INTERNATIONAL_MORSE).filter(s=>/^[A-Z0-9]$/.test(s)) },
  symbols: { label: '欧文＋数字＋記号', alphabet: 'international', symbols: Object.keys(INTERNATIONAL_MORSE).filter(s=>s.length===1) },
  wabun: { label: '和文', alphabet: 'wabun', symbols: Object.keys(WABUN_MORSE).filter(s=>s.length===1 && !/^[0-9]$/.test(s) && s!=='┘') },
} satisfies Record<string,{label:string;alphabet:AlphabetType;symbols:string[]}>;
export type Preset = keyof typeof PRESETS;
export interface GameOptions { wpm?: number; preset?: Preset; enemiesPerSquad?: number }
export const stageInterval = (stage:number) => [1.8,.7,.18][Math.min(2,Math.max(0,stage-1))];
