import { EXAM_SUBJECTS, type ExamSubjectId } from './training';

const PREFS_KEY = 'cwot:exam-prefs';

export interface ExamUiPrefs {
  subjectId: ExamSubjectId;
  telegram: boolean;
  includeWiWe: boolean;
  listenMode: boolean;
  /** 視聴: 1セット終わったら次の出題を自動再生（BGM用） */
  autoContinueListen: boolean;
  /** 和文額表の本文をランダムにする（練習専用・本試験には無い形式） */
  randomWabunBody: boolean;
}

export const DEFAULT_EXAM_PREFS: ExamUiPrefs = {
  subjectId: 'plain',
  telegram: true,
  includeWiWe: false,
  listenMode: false,
  autoContinueListen: false,
  randomWabunBody: false,
};

const isSubjectId = (value: unknown): value is ExamSubjectId =>
  typeof value === 'string' && value in EXAM_SUBJECTS;

export function loadExamPrefs(): ExamUiPrefs {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_EXAM_PREFS };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ExamUiPrefs>;
    return {
      subjectId: isSubjectId(raw.subjectId) ? raw.subjectId : DEFAULT_EXAM_PREFS.subjectId,
      telegram: typeof raw.telegram === 'boolean' ? raw.telegram : DEFAULT_EXAM_PREFS.telegram,
      includeWiWe: typeof raw.includeWiWe === 'boolean' ? raw.includeWiWe : DEFAULT_EXAM_PREFS.includeWiWe,
      listenMode: typeof raw.listenMode === 'boolean' ? raw.listenMode : DEFAULT_EXAM_PREFS.listenMode,
      autoContinueListen:
        typeof raw.autoContinueListen === 'boolean'
          ? raw.autoContinueListen
          : DEFAULT_EXAM_PREFS.autoContinueListen,
      randomWabunBody:
        typeof raw.randomWabunBody === 'boolean' ? raw.randomWabunBody : DEFAULT_EXAM_PREFS.randomWabunBody,
    };
  } catch {
    return { ...DEFAULT_EXAM_PREFS };
  }
}

export function saveExamPrefs(prefs: ExamUiPrefs) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}
