import type { AppView } from './appPaths';
export type ExamMaterial = 'exam' | 'geography' | 'english' | 'houki';
export const EXAM_MATERIAL_KEY = 'cwot:last-exam-material';
export function readExamMaterial(fallback: ExamMaterial = 'exam', storage?: Pick<Storage, 'getItem'>): ExamMaterial {
  try {
    const value = (storage ?? window.localStorage).getItem(EXAM_MATERIAL_KEY);
    return value === 'exam' || value === 'geography' || value === 'english' || value === 'houki' ? value : fallback;
  } catch { return fallback; }
}
export function rememberExamMaterial(view: AppView, storage?: Pick<Storage, 'setItem'>) {
  // Keep the legacy 'exam' value for communication progress preferences. The menu never replaces the last material.
  if (view !== 'communication' && view !== 'geography' && view !== 'english' && view !== 'houki') return;
  try { (storage ?? window.localStorage).setItem(EXAM_MATERIAL_KEY, view === 'communication' ? 'exam' : view); } catch { /* Navigation also keeps an in-memory fallback. */ }
}
