/**
 * How a station's hand sounds (Level 5): the keying fingerprint, fixed per station.
 *
 * It acts between the truth and the air: what the station means (the over's text, the
 * facts on its words) is decided first and never changes; the fist only stretches and
 * squeezes the timing of the marks and gaps it is keyed with. Nothing judges copy by
 * decoding the timing: a character is received or not by the band conditions while it
 * was keyed (conditions.ts), the same for every fist. Whether a fist still reads well
 * by ear is for a person to judge (human auditory QA), not a machine decoder.
 *
 *   keyer     an electronic keyer / paddle: clean elements, a slight preference in spacing
 *   bug       a semi-automatic key: clean dots, hand-made dashes (a little long), spacing by hand
 *   straight  a straight key: heavier dots, longer dashes, looser spacing, a slow tempo drift
 *
 * The traits are drawn once for the station and kept: the same station keys the same
 * way every over. A few hand-key stations tire in the second half of a long over
 * (dashes stretch, gaps loosen, the tempo sags a little) and are back to themselves on
 * the next one. Levels 1–4 have no fist (null): their keying is exactly Stage 4's.
 */

export type FistKind = 'keyer' | 'bug' | 'straight';

export interface WabunFist {
  kind: FistKind;
  /** Dash length in dot units (3: by the book). */
  dash: number;
  /** Dot length (1: by the book; a heavy straight key keys them longer). */
  dot: number;
  /** Gap between the elements of a character (1: one dot). */
  element: number;
  /** Gap between characters, as a share of the book's three dots. */
  char: number;
  /** Gap between words, as a share of the book's seven dots. */
  word: number;
  /** Tempo at the end of an over against its start (0.96: 4 % slower by the end). */
  drift: number;
  /** Tired in the second half of a long over: from that share of its words on, dashes and gaps stretch by up to these shares. */
  fatigue: { from: number; dash: number; gap: number } | null;
  /** Hand wobble per element (the station's jitter). */
  wobble: number;
  /** 0–1: how much of the traits shows (おまかせ's fist axis). 1: all of them. */
  strength: number;
}

/** An over shorter than this (words) is over before anyone tires. */
export const FATIGUE_WORDS = 18;

/** The key the station tells us it uses, as its fist (キーハ ストレート デス keys like one). */
export const fistKindOf = (key: string): FistKind => (key === 'ストレート' ? 'straight' : key === 'バグ' ? 'bug' : 'keyer');
export const KEY_OF_FIST: Record<FistKind, string> = { straight: 'ストレート', bug: 'バグ', keyer: 'エレキー' };

const between = (random: () => number, low: number, high: number) => Math.round((low + random() * (high - low)) * 100) / 100;

/**
 * A station's fist, drawn once. `fatigue`: force it on or off (presets); otherwise a
 * hand key tires now and then (about one station in three), a keyer never.
 */
export function makeFist(random: () => number, kind: FistKind, { strength = 1, fatigue }: { strength?: number; fatigue?: boolean } = {}): WabunFist {
  const tires = kind !== 'keyer' && random() < 0.35;
  const fist: WabunFist = kind === 'keyer'
    ? { kind, dash: 3, dot: 1, element: 1, char: between(random, 1, 1.15), word: between(random, 1, 1.2), drift: 1, fatigue: null, wobble: 0.02, strength }
    : kind === 'bug'
      ? { kind, dash: between(random, 3.3, 3.8), dot: 1, element: 1, char: between(random, 1.05, 1.35), word: between(random, 1, 1.3), drift: between(random, 0.96, 1), fatigue: null, wobble: 0.06, strength }
      : { kind, dash: between(random, 3.2, 3.6), dot: between(random, 1, 1.15), element: between(random, 0.9, 1.2), char: between(random, 1.1, 1.5), word: between(random, 1, 1.4), drift: between(random, 0.94, 0.99), fatigue: null, wobble: 0.1, strength };
  const tired = fatigue ?? tires;
  if (tired && kind !== 'keyer') fist.fatigue = { from: between(random, 0.5, 0.65), dash: between(random, 0.08, 0.15), gap: between(random, 0.1, 0.25) };
  return fist;
}

/** A trait as much as `strength` lets it show (1 + (trait − 1) · strength). */
const shown = (trait: number, strength: number) => 1 + (trait - 1) * strength;

/**
 * The factors for one element at `progress` (0–1, the share of the over's words gone):
 * dot / dash / gap stretches over the book's timing. `long`: the over is long enough to tire in.
 */
export function fistAt(fist: WabunFist, progress: number, long: boolean) {
  const s = fist.strength;
  const tempo = 1 + (1 - shown(fist.drift, s)) * progress;
  const tire = long && fist.fatigue && progress > fist.fatigue.from ? (progress - fist.fatigue.from) / (1 - fist.fatigue.from) : 0;
  const dashTire = 1 + (fist.fatigue?.dash ?? 0) * tire * s;
  const gapTire = 1 + (fist.fatigue?.gap ?? 0) * tire * s;
  return {
    dot: shown(fist.dot, s) * tempo,
    dash: (shown(fist.dash / 3, s) * 3) * tempo * dashTire,
    element: shown(fist.element, s) * tempo * gapTire,
    char: shown(fist.char, s) * tempo * gapTire,
    word: shown(fist.word, s) * tempo * gapTire,
  };
}

/** For people: a few words, no numbers (the numbers stay in the trace). */
export function describeFist(fist: WabunFist): string[] {
  const words: string[] = [fist.kind === 'keyer' ? 'エレキー（きれいな符号）' : fist.kind === 'bug' ? 'バグキー' : '縦振れ（ストレートキー）'];
  if (fist.kind === 'keyer') {
    if (fist.char >= 1.08 || fist.word >= 1.1) words.push('字間・語間やや広め');
    return words;
  }
  if (fist.dash >= 3.4) words.push('ダッシュやや長め');
  if (fist.dot >= 1.08) words.push('短点やや重め');
  if (fist.char >= 1.25) words.push('字間やや広め');
  if (fist.drift <= 0.97) words.push('だんだんゆっくり');
  if (fist.fatigue) words.push('長い電文の後半で間隔が崩れ気味');
  return words;
}
