/** Small random helpers shared by the simulator. Every function takes the PRNG so runs replay from a seed. */

export type Random = () => number;

/** Deterministic PRNG (mulberry32). */
export function seeded(seed: number): Random {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(list: readonly T[], random: Random) => list[Math.floor(random() * list.length)];
export const uniform = (random: Random, [low, high]: readonly [number, number]) => low + random() * (high - low);

/** Standard normal (Box–Muller). */
export function gaussian(random: Random) {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Poisson-distributed count with mean `lambda` (Knuth; fine for the small means used here). */
export function poisson(random: Random, lambda: number) {
  if (lambda <= 0) return 0;
  const limit = Math.exp(-lambda);
  let count = 0;
  let product = random();
  while (product > limit) {
    count += 1;
    product *= random();
  }
  return count;
}
