import type { HoukiItem } from './data';

function mix(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(list: readonly T[], seed: number): T[] {
  const next = [...list];
  const random = mix(seed);
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
}

function seedOf(text: string) {
  return [...text].reduce((sum, char) => (sum * 33 + char.charCodeAt(0)) >>> 0, 7);
}

/** Choice labels are the phrases. Judge stays 適合 / 不適合. */
export function optionOrder(item: HoukiItem): string[] {
  if (item.kind === 'judge') return item.options;
  return shuffle(item.options, seedOf(item.id));
}

/** Five judgments + four cloze questions. Reserve held review and balance categories.
 * Recent items are postponed within each category; remaining draws use a seeded shuffle.
 */
export function buildBlock(items: readonly HoukiItem[], held: Readonly<Record<string, string>>, seed: number, recent: readonly string[] = []): HoukiItem[] {
  const choose = (kind: HoukiItem['kind'], count: number) => {
    const pool = shuffle(items.filter(i => i.kind === kind && i.verification.status === 'verified'), seed + (kind === 'pick' ? 91 : 0));
    const chosen: HoukiItem[] = [];
    const counts: Record<string, number> = {};
    const heldQuota = pool.some(i => held[i.id]) ? Math.max(1, Math.round(count * 0.25)) : 0;
    for (let n = 0; n < count; n++) {
      const wantsHeld = n < heldQuota;
      const available = pool.filter(i => !chosen.includes(i));
      const preferred = available.filter(i => !!held[i.id] === wantsHeld);
      const candidates = preferred.length ? preferred : available;
      candidates.sort((a, b) => (counts[a.bundle] ?? 0) - (counts[b.bundle] ?? 0) || Number(recent.includes(a.id)) - Number(recent.includes(b.id)));
      const item = candidates[0];
      if (!item) throw Error('25点セットを構成できません');
      chosen.push(item); counts[item.bundle] = (counts[item.bundle] ?? 0) + 1;
    }
    return chosen;
  };
  return [...choose('judge', 5), ...choose('pick', 4)];
}

export function scoreBlock(items: readonly HoukiItem[], answers: Readonly<Record<string, string>>) {
  const misses: string[] = [];
  let points = 0;
  for (const item of items) {
    if (answers[item.id] === item.answer) points += item.points;
    else misses.push(item.id);
  }
  const total = items.reduce((sum, item) => sum + item.points, 0);
  return { points, total, misses, line: Math.round(total * 0.6) };
}
