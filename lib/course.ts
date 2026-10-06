/** Practice sets for Learn / Collection. No amateur vs exam course split. */

export type LearnCourse = 'amateur-latin' | 'amateur-wabun' | 'general';

export type CharacterKind = 'latinLetter' | 'digit' | 'wabun' | 'punctuation' | 'prosign';

export type PracticeSetId = 'latin' | 'digit' | 'kigo' | 'wabun';

export interface PracticeSet {
  id: PracticeSetId;
  label: string;
  kinds: CharacterKind[];
}

export const PRACTICE_SETS: PracticeSet[] = [
  { id: 'latin', label: '欧文', kinds: ['latinLetter'] },
  { id: 'digit', label: '数字', kinds: ['digit'] },
  { id: 'kigo', label: '記号', kinds: ['punctuation', 'prosign'] },
  { id: 'wabun', label: '和文', kinds: ['wabun'] },
];

export const DEFAULT_UNLOCK: CharacterKind[] = ['latinLetter'];

export const KIND_LABEL: Record<CharacterKind, string> = {
  latinLetter: '欧文 A–Z',
  digit: '数字 0–9',
  wabun: '和文',
  punctuation: '記号',
  prosign: '手続符号',
};

/** @deprecated Saved profiles only. New progress uses unlockedKinds. */
export const COURSE_DEFAULT_UNLOCK: Record<LearnCourse, CharacterKind[]> = {
  'amateur-latin': ['latinLetter'],
  'amateur-wabun': ['wabun'],
  general: ['latinLetter'],
};

export function normalizeKinds(kinds?: CharacterKind[] | null): CharacterKind[] {
  if (kinds?.length) return [...new Set(kinds)];
  return [...DEFAULT_UNLOCK];
}

export function practiceSetOn(kinds: CharacterKind[], set: PracticeSet): boolean {
  return set.kinds.every((kind) => kinds.includes(kind));
}

export function togglePracticeSet(kinds: CharacterKind[] | undefined, setId: PracticeSetId): CharacterKind[] | null {
  const set = PRACTICE_SETS.find((item) => item.id === setId);
  if (!set) return null;
  const current = normalizeKinds(kinds);
  const on = practiceSetOn(current, set);
  if (on) {
    const next = current.filter((kind) => !set.kinds.includes(kind));
    return next.length ? next : null;
  }
  return [...current, ...set.kinds.filter((kind) => !current.includes(kind))];
}

export function cardsForPractice<T extends { kind: CharacterKind; alphabet?: 'international' | 'wabun' }>(
  cards: T[],
  unlockedKinds?: CharacterKind[] | null,
): T[] {
  const unlocked = new Set(normalizeKinds(unlockedKinds));
  const latin = unlocked.has('latinLetter');
  const wabunOn = unlocked.has('wabun');
  const allowAlphabet = (alphabet?: 'international' | 'wabun') => {
    if (latin && wabunOn) return true;
    if (latin) return alphabet !== 'wabun';
    if (wabunOn) return alphabet !== 'international';
    return true;
  };
  return cards.filter((card) => {
    if (!unlocked.has(card.kind)) return false;
    if (card.kind === 'latinLetter' || card.kind === 'wabun') return true;
    return allowAlphabet(card.alphabet);
  });
}

export function scopeSetLabel(kinds?: CharacterKind[] | null): string {
  const normalized = normalizeKinds(kinds);
  return PRACTICE_SETS.filter((set) => practiceSetOn(normalized, set)).map((set) => set.label).join(' · ');
}

export const ALL_KINDS: CharacterKind[] = ['latinLetter', 'digit', 'punctuation', 'prosign', 'wabun'];
