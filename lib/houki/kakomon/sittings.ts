import type { DrillOrder } from './loop';
import type { ExamSet } from './types';

/** Reiwa began on 2019-05-01, so the March 2019 sitting is still Heisei 31. */
export function eraOf(year: number, month: number): { era: '平成' | '令和'; eraYear: number } {
  if (year > 2019 || (year === 2019 && month >= 5)) return { era: '令和', eraYear: year - 2018 };
  return { era: '平成', eraYear: year - 1988 };
}

/** Labels built from year and month, so the mixed full/half-width digits in the source labels never reach the screen. */
export function sittingLabel(exam: Pick<ExamSet['exam'], 'year' | 'month'>) {
  const { era, eraYear } = eraOf(exam.year, exam.month);
  return `${era}${eraYear === 1 ? '元' : eraYear}年${exam.month}月期`;
}

export function sittingShort(exam: Pick<ExamSet['exam'], 'year' | 'month'>) {
  const { era, eraYear } = eraOf(exam.year, exam.month);
  return `${era === '令和' ? 'R' : 'H'}${eraYear}.${exam.month}`;
}

/** 2019 holds both eras: March is Heisei 31, September is Reiwa 1. */
function eraYearLabel(year: number) {
  const spring = eraOf(year, 3);
  const autumn = eraOf(year, 9);
  const text = ({ era, eraYear }: { era: string; eraYear: number }) => `${era}${eraYear === 1 ? '元' : eraYear}`;
  return spring.era === autumn.era ? `${text(spring)}年` : `${text(spring)}・${text(autumn)}年`;
}

export interface SittingYear {
  year: number;
  eraLabel: string;
  march: ExamSet | null;
  september: ExamSet | null;
}

/** Newest year first. A year with no shipped sitting is left out; a missing month stays null. */
export function groupSittings(exams: ExamSet[]): SittingYear[] {
  const years = new Map<number, SittingYear>();
  for (const exam of exams) {
    const { year, month } = exam.exam;
    const entry = years.get(year) ?? { year, eraLabel: eraYearLabel(year), march: null, september: null };
    if (month === 3) entry.march = exam;
    else entry.september = exam;
    years.set(year, entry);
  }
  return [...years.values()].sort((left, right) => right.year - left.year);
}

/** Reads back the exam ids and sections a run was started with (the inverse of scopeKey). */
export function parseScopeKey(key: string): { examIds: string[]; sections: Array<'A' | 'B'> } | null {
  if (key.startsWith('exam:')) return { examIds: [key.slice(5)], sections: ['A', 'B'] };
  const match = key.match(/^pool:(.+):([AB]+)$/);
  if (!match) return null;
  const sections = [...new Set(match[2].split(''))] as Array<'A' | 'B'>;
  return { examIds: match[1].split('+'), sections };
}

export function orderOfRun(setDefinitionDigest: string): DrillOrder {
  const order = setDefinitionDigest.split('@')[0];
  return order === 'random' || order === 'weak' ? order : 'seq';
}
