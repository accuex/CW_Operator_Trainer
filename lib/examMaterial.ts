import type { AppView } from './appPaths';
export type ExamMaterial = 'exam' | 'geography';
export const EXAM_MATERIAL_KEY = 'cwot:last-exam-material';
export function readExamMaterial(fallback: ExamMaterial = 'exam', storage?: Pick<Storage, 'getItem'>): ExamMaterial {
  try {
    const value = (storage ?? window.localStorage).getItem(EXAM_MATERIAL_KEY);
    return value === 'exam' || value === 'geography' ? value : fallback;
  } catch { return fallback; }
}
export function rememberExamMaterial(view: AppView, storage?: Pick<Storage, 'setItem'>) {
  if (view !== 'exam' && view !== 'geography') return;
  try { (storage ?? window.localStorage).setItem(EXAM_MATERIAL_KEY, view); } catch { /* Navigation also keeps an in-memory fallback. */ }
}
