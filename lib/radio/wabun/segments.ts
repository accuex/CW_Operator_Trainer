import { INTERNATIONAL_MORSE, WABUN_MORSE, expandWabunVoicing } from '../../morse';
import { toKatakana } from '../../wabunInput';
import type { CharSpan, Keyed, KeyingOptions, Mark } from '../keying';
import { FATIGUE_WORDS, fistAt, type WabunFist } from './fist';

/**
 * A wabun transmission is a run of segments, never one string keyed in one alphabet.
 * Calls, DE, K / KN / BK, TU, 73 and E E are Latin (roman); the body between ホレ and
 * ラタ is kana (wabun). ホレ / ラタ are signs that switch the alphabet, so the switch is
 * on the record (when, which way), not just a character on the screen.
 *
 * As a string (a station's queue, the TX field, a trace) a transmission is written in a
 * small notation:
 *   [ホレ]  ホレ, from here wabun        [ラタ]  ラタ, from here roman
 *   <ホレ>  ホレ said as a word, no switch ("CQ ホレ": a wabun QSO, please)
 *   {ラタ}  ラタ as the correction sign: no switch, what follows is retyped from a little
 *           before the slip (docs §1.6). On the air it is the same ラタ.
 *   （ … ）  inside a wabun body, roman between the parentheses (rig, antenna)
 * Everything else is text in the alphabet in force. Sources: docs/wabun-qso-design.md §1.
 */

export type Script = 'roman' | 'wabun';
export type ControlSign = 'ホレ' | 'ラタ' | '（' | '）';

export type Segment =
  | { kind: 'roman'; text: string }
  | { kind: 'wabun'; text: string }
  /**
   * `to`: the alphabet from here on (null: the sign is a word, the alphabet stays).
   * `correction`: ラタ used to correct a slip, not to end the body (to is then null).
   */
  | { kind: 'control'; sign: ControlSign; to: Script | null; correction?: true };

/** One keyed unit, which alphabet it went out in, and the segment it belongs to. */
export interface SegmentSpan extends CharSpan { script: Script | 'control'; segment: number }

/** An alphabet switch as it went out. */
export interface SwitchEvent { sign: ControlSign; to: Script; segment: number; start: number; end: number }
/** A correction ラタ as it went out (no switch: the body goes on). */
export interface CorrectionEvent { segment: number; start: number; end: number }

export interface SegmentKeyed extends Keyed {
  chars: SegmentSpan[];
  segments: Segment[];
  switches: SwitchEvent[];
  corrections: CorrectionEvent[];
}

const CONTROL_TOKEN = /\[ホレ\]|\[ラタ\]|<ホレ>|\{ラタ\}|（|）/g;
const ROMAN_TOKEN = /\[[A-Z]{2}\]|\S/g;
/** Symbols with no wabun code that a wabun body still sends in Latin code ("オオタ? オオタ"). */
const WABUN_BORROWED = new Set(['?']);

/** Notation → segments. Text starts roman; adjacent words of one alphabet join into one segment. */
export function parseSegments(notation: string): Segment[] {
  const out: Segment[] = [];
  let script: Script = 'roman';
  const pushText = (text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    const last = out.at(-1);
    if (last && last.kind === script) last.text = `${last.text} ${words.join(' ')}`;
    else out.push({ kind: script, text: words.join(' ') });
  };
  let index = 0;
  for (const match of notation.matchAll(CONTROL_TOKEN)) {
    pushText(notation.slice(index, match.index));
    index = (match.index ?? 0) + match[0].length;
    const token = match[0];
    if (token === '[ホレ]') { out.push({ kind: 'control', sign: 'ホレ', to: 'wabun' }); script = 'wabun'; }
    else if (token === '[ラタ]') { out.push({ kind: 'control', sign: 'ラタ', to: 'roman' }); script = 'roman'; }
    else if (token === '<ホレ>') out.push({ kind: 'control', sign: 'ホレ', to: null });
    // A correction switches nothing: the text goes on in the alphabet in force.
    else if (token === '{ラタ}') out.push({ kind: 'control', sign: 'ラタ', to: null, correction: true });
    // Parentheses switch only inside a wabun body; in roman text they are kept as text.
    else if (token === '（' && script === 'wabun') { out.push({ kind: 'control', sign: '（', to: 'roman' }); script = 'roman'; }
    else if (token === '）' && script === 'roman' && openParen(out)) {
      out.push({ kind: 'control', sign: '）', to: 'wabun' });
      script = 'wabun';
    } else pushText(token);
  }
  pushText(notation.slice(index));
  return out;
}

/** The last parenthesis opened is still open. */
function openParen(segments: Segment[]) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment.kind !== 'control' || segment.correction) continue;
    if (segment.sign === '（') return true;
    if (segment.sign === '）' || segment.sign === 'ラタ' || segment.sign === 'ホレ') return false;
  }
  return false;
}

/** Segments → notation (parseSegments(renderSegments(x)) gives x back). */
export function renderSegments(segments: Segment[]): string {
  return segments.map((segment) => {
    if (segment.kind !== 'control') return segment.text;
    if (segment.sign === 'ホレ') return segment.to ? '[ホレ]' : '<ホレ>';
    if (segment.sign === 'ラタ') return segment.correction ? '{ラタ}' : '[ラタ]';
    return segment.sign;
  }).join(' ');
}

/** For people: switches as plain ホレ / ラタ (the segments keep which way they went). */
export const displayNotation = (notation: string) => notation.replace(/\[ホレ\]|<ホレ>/g, 'ホレ').replace(/\[ラタ\]|\{ラタ\}/g, 'ラタ');

/** One word's keyed units: [unit, code] in the segment's alphabet (unknown units dropped). */
function unitsOf(word: string, script: Script): [string, string][] {
  if (script === 'roman') {
    return (word.toUpperCase().match(ROMAN_TOKEN) ?? []).filter((token) => INTERNATIONAL_MORSE[token]).map((token) => [token, INTERNATIONAL_MORSE[token]]);
  }
  return [...toKatakana(word)].flatMap((char) => expandWabunVoicing(char)).flatMap((unit): [string, string][] => {
    if (WABUN_MORSE[unit]) return [[unit, WABUN_MORSE[unit]]];
    if (WABUN_BORROWED.has(unit)) return [[unit, INTERNATIONAL_MORSE[unit]]];
    return [];
  });
}

const CONTROL_CODE: Record<ControlSign, string> = {
  ホレ: WABUN_MORSE['[ホレ]'], ラタ: WABUN_MORSE['[ラタ]'], '（': WABUN_MORSE['（'], '）': WABUN_MORSE['）'],
};

const BOOK = { dot: 1, dash: 3, element: 1, char: 1, word: 1 };

/**
 * Segments (or their notation) → key-down intervals, the timing of lib/radio/keying.ts
 * (Latin keyText is untouched). Each control sign is a word of its own; a word never
 * spans two segments, so the gap at a switch is a word gap.
 *
 * `fist` (Level 5): the station's hand stretches the marks and gaps (fist.ts) by where
 * in the over each word is; the characters, words and segments stay the same. Without
 * one the timing is the book's, exactly as before.
 */
export function keySegments(input: string | Segment[], { wpm, effectiveWpm = wpm, jitter = 0, random = Math.random }: KeyingOptions, fist: WabunFist | null = null): SegmentKeyed {
  const segments = typeof input === 'string' ? parseSegments(input) : input;
  const unit = 1.2 / Math.max(5, wpm);
  const spacing = Math.max(1, wpm / Math.max(3, Math.min(wpm, effectiveWpm)));
  const wobble = () => 1 + (random() - 0.5) * jitter;
  const marks: Mark[] = [];
  const chars: SegmentSpan[] = [];
  const switches: SwitchEvent[] = [];
  const corrections: CorrectionEvent[] = [];
  // Words in sending order, each with its segment and alphabet.
  const words: { units: [string, string][]; segment: number; script: Script | 'control'; sign?: ControlSign; to?: Script | null; correction?: true }[] = [];
  segments.forEach((segment, index) => {
    if (segment.kind === 'control') {
      // On the air a correction is the same ラタ; the segment remembers what it was for.
      words.push({ units: [[segment.sign === 'ホレ' || segment.sign === 'ラタ' ? `[${segment.sign}]` : segment.sign, CONTROL_CODE[segment.sign]]], segment: index, script: 'control', sign: segment.sign, to: segment.to, correction: segment.correction });
      return;
    }
    for (const word of segment.text.split(/\s+/).filter(Boolean)) {
      const units = unitsOf(word, segment.kind);
      if (units.length) words.push({ units, segment: index, script: segment.kind });
    }
  });
  let t = 0;
  const long = words.length >= FATIGUE_WORDS;
  words.forEach((word, wordIndex) => {
    const wordStart = t;
    const hand = fist ? fistAt(fist, words.length > 1 ? wordIndex / (words.length - 1) : 0, long) : BOOK;
    word.units.forEach(([char, code], charIndex) => {
      const start = t;
      [...code].forEach((element, elementIndex) => {
        const length = (element === '.' ? hand.dot : hand.dash) * unit * wobble();
        marks.push([t, t + length]);
        t += length;
        if (elementIndex < code.length - 1) t += hand.element * unit * wobble();
      });
      chars.push({ char, word: wordIndex, index: charIndex, start, end: t, script: word.script, segment: word.segment });
      if (charIndex < word.units.length - 1) t += 3 * hand.char * unit * spacing * wobble();
    });
    if (word.sign && word.to) switches.push({ sign: word.sign, to: word.to, segment: word.segment, start: wordStart, end: t });
    if (word.correction) corrections.push({ segment: word.segment, start: wordStart, end: t });
    if (wordIndex < words.length - 1) t += 7 * hand.word * unit * spacing * wobble();
  });
  return { marks, length: t, chars, segments, switches, corrections };
}

/** A station's / our keyer for wabun transmissions (Station.keyer, rig transmit). */
export const wabunKeyer = (text: string, options: KeyingOptions): Keyed => keySegments(text, options);

/** A Level 5 station's keyer: its fist on every over, its hand's wobble as the jitter. */
export const fistKeyer = (fist: WabunFist) => (text: string, options: KeyingOptions): Keyed => keySegments(text, { ...options, jitter: fist.wobble }, fist);

/** Words of the given alphabet only (roman words of an over: calls, RST, K / BK …). */
export const textOf = (segments: Segment[], script: Script) =>
  segments.filter((segment): segment is Extract<Segment, { kind: Script }> => segment.kind === script).map((segment) => segment.text).join(' ');

/**
 * What actually went out, word by word: only the units that have a code (an unknown
 * letter typed is dropped by the keyer, so it is not here), voiced kana as base + ゛.
 * Switches show as ホレ / ラタ.
 */
export function keyedText(keyed: Pick<SegmentKeyed, 'chars'>): string {
  const words: string[] = [];
  for (const span of keyed.chars) words[span.word] = (words[span.word] ?? '') + (span.char === '[ホレ]' ? 'ホレ' : span.char === '[ラタ]' ? 'ラタ' : span.char);
  return composeVoicing(words.filter(Boolean).join(' '));
}

/** Telegraph kana back to print: base + ゛ / ゜ → one voiced kana where there is one (カ゛ → ガ). */
export const composeVoicing = (text: string) => text.replace(/(.)([゛゜])/gu, (pair, base: string, mark: string) => {
  const composed = `${base}${mark === '゛' ? '\u3099' : '\u309A'}`.normalize('NFC');
  return composed.length === 1 ? composed : pair;
});
