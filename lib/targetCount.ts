/** Short cipher-style Target Count round: 5×2 groups, target hits 2–5. */

export interface TargetCountRound {
  /** Flat symbol list (length = groupSize × groupCount). */
  symbols: string[];
  /** Cipher groups (each length groupSize). */
  groups: string[][];
  /** Playback / display text with a word gap between groups. */
  text: string;
  /** How many times `target` appears. */
  count: number;
  target: string;
}

export interface TargetCountOptions {
  target: string;
  distractors: string[];
  groupSize?: number;
  groupCount?: number;
  minHits?: number;
  maxHits?: number;
  rng?: () => number;
}

function randInt(min: number, max: number, rng: () => number) {
  return min + Math.floor(rng() * (max - min + 1));
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

/** Single-slot symbols only — multi-char prosign tokens cannot ride `normalizeText`. */
export const isTargetCountSymbol = (symbol: string) => Array.from(symbol).length === 1;

/** Seed noise when no learned distractors yet (未習でも可). */
export const CONFIRM_SEED_DISTRACTORS: Record<'international' | 'wabun', string[]> = {
  international: ['A', 'N', 'D', 'G'],
  wabun: ['イ', 'ロ', 'ハ', 'ニ'],
};

/**
 * Prefer learned distractors. If none, fall back to A/N/D/G (or イロハニ) even if 未習.
 * Last resort: any other available course symbols.
 */
export function resolveConfirmDistractors(options: {
  target: string;
  alphabet: 'international' | 'wabun';
  learnedSymbols: string[];
  availableSymbols: string[];
}): string[] {
  const { target, alphabet } = options;
  const learned = [...new Set(options.learnedSymbols)].filter(
    (symbol) => symbol !== target && isTargetCountSymbol(symbol),
  );
  if (learned.length) return learned;

  const seed = CONFIRM_SEED_DISTRACTORS[alphabet].filter(
    (symbol) => symbol !== target && isTargetCountSymbol(symbol),
  );
  if (seed.length) return seed;

  return [...new Set(options.availableSymbols)].filter(
    (symbol) => symbol !== target && isTargetCountSymbol(symbol),
  );
}

export function buildTargetCountRound(options: TargetCountOptions): TargetCountRound | null {
  const {
    target,
    groupSize = 5,
    groupCount = 2,
    minHits = 2,
    maxHits = 5,
    rng = Math.random,
  } = options;
  if (!isTargetCountSymbol(target)) return null;

  const distractors = [...new Set(options.distractors)].filter(
    (symbol) => symbol !== target && isTargetCountSymbol(symbol),
  );
  if (!distractors.length) return null;

  const total = groupSize * groupCount;
  const cappedMax = Math.min(maxHits, total - 1);
  const cappedMin = Math.min(minHits, cappedMax);
  if (cappedMax < 1 || cappedMin < 1) return null;

  const count = randInt(cappedMin, cappedMax, rng);
  const slots: string[] = Array.from({ length: count }, () => target);
  while (slots.length < total) {
    slots.push(distractors[Math.floor(rng() * distractors.length)]);
  }

  const symbols = shuffle(slots, rng);
  const groups: string[][] = [];
  for (let group = 0; group < groupCount; group += 1) {
    groups.push(symbols.slice(group * groupSize, (group + 1) * groupSize));
  }

  return {
    target,
    symbols,
    groups,
    text: groups.map((group) => group.join('')).join(' '),
    count,
  };
}
