import { INTERNATIONAL_MORSE, WABUN_MORSE } from '../../morse';

/**
 * Code → character for the decoder. Latin: letters, figures, punctuation, prosigns.
 * Wabun: kana, figures, marks and the switches; the abbreviated figures ([1]…[0]) and
 * [特] / [局] share codes with kana and are left out (a decoder can't tell them apart).
 */

const reverse = (table: Record<string, string>, skip: (symbol: string) => boolean = () => false) => {
  const out = new Map<string, string>();
  for (const [symbol, code] of Object.entries(table)) if (!skip(symbol) && !out.has(code)) out.set(code, symbol);
  return out;
};

export const ROMAN_CODES = reverse(INTERNATIONAL_MORSE);
export const WABUN_CODES = reverse(WABUN_MORSE, (symbol) => /^\[(\d|特|局)\]$/.test(symbol) || symbol === '┘');
// A Latin question mark keyed inside wabun (segments.ts WABUN_BORROWED).
WABUN_CODES.set(INTERNATIONAL_MORSE['?'], '?');

export const HORE = WABUN_MORSE['[ホレ]'];
export const RATA = WABUN_MORSE['[ラタ]'];
export const PAREN_OPEN = WABUN_MORSE['（'];
export const PAREN_CLOSE = WABUN_MORSE['）'];

/** Kana + ゛ / ゜ → the voiced kana (カ゛ → ガ); null when there is none. */
export function voice(kana: string, mark: '゛' | '゜'): string | null {
  const combined = (kana + (mark === '゛' ? '゙' : '゚')).normalize('NFC');
  return combined.length === 1 ? combined : null;
}
