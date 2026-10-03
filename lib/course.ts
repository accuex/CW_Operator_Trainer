/** Three feature-set courses for Learn / Collection filtering. */
export type LearnCourse = 'amateur-latin' | 'amateur-wabun' | 'general';

export type CharacterKind = 'latinLetter' | 'digit' | 'wabun' | 'punctuation' | 'prosign';

export interface CourseMeta {
  id: LearnCourse;
  label: string;
  short: string;
  description: string;
}

export const COURSES: CourseMeta[] = [
  {
    id: 'amateur-latin',
    label: 'アマチュア欧文',
    short: 'AMATEUR LATIN',
    description: 'JARL早見表の欧文範囲。まずは A–Z。数字・記号はあとから追加できます。',
  },
  {
    id: 'amateur-wabun',
    label: 'アマチュア和文',
    short: 'AMATEUR WABUN',
    description: 'アマチュア向け和文CW。イロハ〜ンを学習します。',
  },
  {
    id: 'general',
    label: '第一級総合無線通信士',
    short: '1ST GENERAL',
    description: '電気通信術を見据えた拡張セット。欧文から段階的に広げます。',
  },
];

/** Full catalog each course may eventually include. */
export const COURSE_CATALOG: Record<LearnCourse, CharacterKind[]> = {
  'amateur-latin': ['latinLetter', 'digit', 'punctuation', 'prosign'],
  'amateur-wabun': ['wabun', 'digit', 'punctuation', 'prosign'],
  general: ['latinLetter', 'digit', 'wabun', 'punctuation', 'prosign'],
};

/** Phase 1 default unlock — start narrow, expand on request. */
export const COURSE_DEFAULT_UNLOCK: Record<LearnCourse, CharacterKind[]> = {
  'amateur-latin': ['latinLetter'],
  'amateur-wabun': ['wabun'],
  general: ['latinLetter'],
};

export const KIND_LABEL: Record<CharacterKind, string> = {
  latinLetter: '欧文 A–Z',
  digit: '数字 0–9',
  wabun: '和文',
  punctuation: '記号',
  prosign: '手続符号',
};

export function courseMeta(course: LearnCourse | null | undefined) {
  return COURSES.find((item) => item.id === course) ?? null;
}

export function cardsForCourse<T extends { kind: CharacterKind; alphabet?: 'international' | 'wabun' }>(
  cards: T[],
  course: LearnCourse | null | undefined,
  unlockedKinds: CharacterKind[] | undefined,
): T[] {
  if (!course) return [];
  const catalog = new Set(COURSE_CATALOG[course]);
  const unlocked = new Set(unlockedKinds?.length ? unlockedKinds : COURSE_DEFAULT_UNLOCK[course]);
  return cards.filter((card) => {
    if (!catalog.has(card.kind) || !unlocked.has(card.kind)) return false;
    if (course === 'amateur-latin') return card.alphabet !== 'wabun';
    if (course === 'amateur-wabun') return card.alphabet !== 'international';
    return true;
  });
}

export function unlockableKinds(course: LearnCourse, unlockedKinds: CharacterKind[]): CharacterKind[] {
  const unlocked = new Set(unlockedKinds);
  return COURSE_CATALOG[course].filter((kind) => !unlocked.has(kind));
}

export function selectCourseDefaults(course: LearnCourse): { learnCourse: LearnCourse; unlockedKinds: CharacterKind[] } {
  return { learnCourse: course, unlockedKinds: [...COURSE_DEFAULT_UNLOCK[course]] };
}
