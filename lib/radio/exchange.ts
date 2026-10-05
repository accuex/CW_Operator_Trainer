import type { AlphabetType } from '../types';

/**
 * What gets exchanged and logged. Built-in presets are our own formats; real
 * contest rules (JARL, JCC …) are added later as kind 'real' with a source.
 */

export interface ExchangeField {
  key: string;
  label: string;
  /** Normalise a logged value for comparison (and for character alignment). */
  normalize: (value: string) => string;
}

export interface ExchangePreset {
  id: string;
  kind: 'builtin' | 'real';
  label: string;
  alphabet: AlphabetType;
  /** For real contests: rule name and URL. */
  source?: { name: string; url?: string };
  fields: ExchangeField[];
}

/** Contest cut numbers: 5NN → 599, T → 0, A → 1, O → 0. */
export const normalizeRst = (rst: string) => rst.toUpperCase().replace(/\s/g, '').replace(/N/g, '9').replace(/[TO]/g, '0').replace(/A/g, '1');
export const normalizeWord = (word: string) => word.toUpperCase().replace(/[^A-Z0-9/]/g, '');

export const BASIC_RST_NAME_QTH: ExchangePreset = {
  id: 'basic-rst-name-qth',
  kind: 'builtin',
  label: 'RST・名前・QTH',
  alphabet: 'international',
  fields: [
    { key: 'call', label: 'CALL', normalize: normalizeWord },
    { key: 'rst', label: 'RST', normalize: normalizeRst },
    { key: 'name', label: 'NAME', normalize: normalizeWord },
    { key: 'qth', label: 'QTH', normalize: normalizeWord },
  ],
};

export const PRESETS: Record<string, ExchangePreset> = { [BASIC_RST_NAME_QTH.id]: BASIC_RST_NAME_QTH };
