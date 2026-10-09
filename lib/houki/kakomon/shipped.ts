import type { ExamSet } from './types';

const modules = (import.meta as ImportMeta & {
  glob: (pattern: string, options: { eager: true; import: 'default' }) => Record<string, ExamSet>;
}).glob('../../../private/houki-kakomon/sets/1sou-houki-*.json', { eager: true, import: 'default' });

/** The sittings present when the app was built. Dev and production both read this, not the dev-only file route. */
export const shippedExams: ExamSet[] = Object.values(modules).sort((left, right) => left.exam.year - right.exam.year || left.exam.month - right.exam.month);
