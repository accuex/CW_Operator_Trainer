import { INTERNATIONAL_MORSE } from '../morse';

/** Key-down interval [start, end] in seconds from the start of a transmission. */
export type Mark = readonly [number, number];
/** One sent character: its token, word position and key-down extent. */
export interface CharSpan { char: string; word: number; index: number; start: number; end: number }
export interface Keyed { marks: Mark[]; length: number; chars: CharSpan[] }

export interface KeyingOptions {
  wpm: number;
  /** Farnsworth: spacing stretched like lib/timing.ts (characterSpeed / effectiveSpeed). */
  effectiveWpm?: number;
  /** Hand-keying wobble. 0 = machine perfect, 0.25 = shaky straight key. */
  jitter?: number;
  random?: () => number;
}

const TOKEN = /\[[A-Z]{2}\]|\S/g;

/** Text → key-down intervals. Unknown characters are skipped. */
export function keyText(text: string, { wpm, effectiveWpm = wpm, jitter = 0, random = Math.random }: KeyingOptions): Keyed {
  const unit = 1.2 / Math.max(5, wpm);
  const spacing = Math.max(1, wpm / Math.max(3, Math.min(wpm, effectiveWpm)));
  const wobble = () => 1 + (random() - 0.5) * jitter;
  const marks: Mark[] = [];
  const chars: CharSpan[] = [];
  let t = 0;
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  words.forEach((word, wordIndex) => {
    const tokens = (word.match(TOKEN) ?? []).filter((token) => INTERNATIONAL_MORSE[token]);
    const codes = tokens.map((token) => INTERNATIONAL_MORSE[token]);
    codes.forEach((code, charIndex) => {
      const start = t;
      [...code].forEach((element, elementIndex) => {
        const length = (element === '.' ? 1 : 3) * unit * wobble();
        marks.push([t, t + length]);
        t += length;
        if (elementIndex < code.length - 1) t += unit * wobble();
      });
      chars.push({ char: tokens[charIndex], word: wordIndex, index: charIndex, start, end: t });
      if (charIndex < codes.length - 1) t += 3 * unit * spacing * wobble();
    });
    if (wordIndex < words.length - 1) t += 7 * unit * spacing * wobble();
  });
  return { marks, length: t, chars };
}
