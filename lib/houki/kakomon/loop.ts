import type { ExamSet, Question } from './types';

export type Rank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Response = number | Record<string, number>;
export const RANK_LABEL = ['未習得', '銅', '銀', '金', 'ミスリル', 'オリハルコン', 'アダマンタイト', 'ヒヒイロカネ'] as const;
export const RANK_MAX: Rank = 7;
export const ANSWER_HISTORY_LIMIT = 7;
export const KAKOMON_PROGRESS_KEY = 'cwot:houki-kakomon:v1';

const MODES = ['mock', 'drill', 'topic', 'review', 'variant', 'random'] as const;
type Mode = (typeof MODES)[number];

export interface KakomonAttempt {
  id: string;
  seq: number;
  at: string;
  runId: string;
  mode: Mode;
  questionId: string;
  questionRevision: number;
  answerDigest: string;
  response: Response | null;
  subResults?: Record<string, boolean>;
  correct: boolean;
  rankEligible: boolean;
  doubtful: boolean;
  elapsedMs: number;
}

export interface QuestionMastery {
  questionId: string;
  rank: Rank;
  correctCount: number;
  wrongCount: number;
  lastAnsweredAt: string | null;
  everMastered: boolean;
  basisRevision: number;
  throughSeq: number;
}

export interface KakomonRun {
  id: string;
  mode: Mode;
  setKey: string;
  setDefinitionDigest: string;
  seed: number;
  questions: { id: string; revision: number }[];
  cursor: number;
  answers: Record<string, Response>;
  startedAt: string;
  elapsedMs: number;
  status: 'active' | 'suspended';
  servedFromSnapshot: string[];
}

export interface RunSummary {
  runId: string;
  mode: Mode;
  setKey: string;
  setDefinitionDigest: string;
  questions: { id: string; revision: number }[];
  completedAt: string;
}

export interface KakomonProgress {
  schemaVersion: 1;
  nextSeq: number;
  attempts: KakomonAttempt[];
  mastery: Record<string, QuestionMastery>;
  flags: Record<string, { doubtful?: true }>;
  runs: RunSummary[];
  active: KakomonRun | null;
  settings: { excludeMastered: Partial<Record<Mode, boolean>>; noticeAcknowledged: number };
}

export interface Grade {
  ok: boolean;
  detail: string;
  subResults?: Record<string, boolean>;
}

export function updateRank(current: Rank, correct: boolean): Rank {
  return Math.max(0, Math.min(RANK_MAX, current + (correct ? 1 : -1))) as Rank;
}

export function setKeyOf(examId: string) {
  return `exam:${examId}`;
}

export function emptyProgress(): KakomonProgress {
  return {
    schemaVersion: 1,
    nextSeq: 1,
    attempts: [],
    mastery: {},
    flags: {},
    runs: [],
    active: null,
    settings: { excludeMastered: {}, noticeAcknowledged: 0 },
  };
}

export function answerReady(question: Question, pick: Response | undefined): boolean {
  if (question.format === 'single' || question.format === 'combination') return typeof pick === 'number' && pick >= 1;
  if (!pick || typeof pick !== 'object') return false;
  return question.items.every((item) => Number.isInteger(pick[item.label]) && pick[item.label] >= 1);
}

export function gradeQuestion(question: Question, pick: Response | undefined): Grade {
  if (question.format === 'single' || question.format === 'combination') {
    return { ok: pick === question.answer, detail: `正答は ${question.answer}。` };
  }
  const selected = pick && typeof pick === 'object' ? pick : {};
  const subResults: Record<string, boolean> = {};
  const misses: string[] = [];
  for (const item of question.items) {
    const ok = selected[item.label] === item.answer;
    subResults[item.label] = ok;
    if (!ok) misses.push(item.label);
  }
  const detail = misses.length
    ? `誤っている小設問は ${misses.join('、')}。正答は ${question.items.map((item) => `${item.label} ${item.answer}`).join('、')}。`
    : '小設問はすべて正答です。';
  return { ok: misses.length === 0, detail, subResults };
}

export function rankOf(progress: KakomonProgress, questionId: string): Rank {
  return progress.mastery[questionId]?.rank ?? 0;
}

export function hasAnswers(progress: KakomonProgress, questionId: string) {
  const mastery = progress.mastery[questionId];
  return Boolean(mastery && mastery.correctCount + mastery.wrongCount > 0);
}

export function answerHistory(progress: KakomonProgress, questionId: string, questions?: Question[], limit = ANSWER_HISTORY_LIMIT): boolean[] {
  const rescore = questions ? rescoreFrom(questions) : undefined;
  const marks: boolean[] = [];
  for (const attempt of progress.attempts.filter((item) => item.questionId === questionId).sort((left, right) => left.seq - right.seq)) {
    if (!attempt.rankEligible || attempt.questionRevision < 1) continue;
    const rescored = rescore?.(attempt);
    marks.push(rescored === null || rescored === undefined ? attempt.correct : rescored);
  }
  return marks.slice(-limit);
}

export type DrillOrder = 'seq' | 'random' | 'weak';

export interface DrillPick {
  order: DrillOrder;
  sections: Array<'A' | 'B'>;
  excludeMastered: boolean;
  seed?: number;
}

export function scopeKey(examIds: string[], sections: Array<'A' | 'B'>) {
  const ids = [...new Set(examIds)].sort();
  const parts = [...new Set(sections)].sort();
  if (ids.length === 1 && parts.length === 2) return setKeyOf(ids[0]);
  return `pool:${ids.join('+')}:${parts.join('')}`;
}

export function lapsOf(progress: KakomonProgress, examIdOrKey: string) {
  const key = examIdOrKey.startsWith('exam:') || examIdOrKey.startsWith('pool:') ? examIdOrKey : setKeyOf(examIdOrKey);
  return progress.runs.filter((run) => run.setKey === key && run.mode === 'drill').length;
}

function shuffleQuestions(questions: Question[], seed: number) {
  const copy = [...questions];
  let state = seed >>> 0 || 1;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function weakness(progress: KakomonProgress, question: Question, questions: Question[]) {
  const misses = answerHistory(progress, question.id, questions).filter((ok) => !ok).length;
  return rankOf(progress, question.id) * 10 - misses;
}

export function questionsForDrill(exams: ExamSet[], progress: KakomonProgress, pick: DrillPick) {
  const sections = new Set(pick.sections);
  const listed = exams.flatMap((exam) => exam.questions.filter((question) => sections.has(question.section)));
  const pool = listed.filter((question) => !pick.excludeMastered || rankOf(progress, question.id) < RANK_MAX);
  if (pick.order === 'random') return shuffleQuestions(pool, pick.seed ?? 1);
  if (pick.order !== 'weak') return pool;
  const all = exams.flatMap((exam) => exam.questions);
  return pool.map((question, index) => ({ question, index })).sort((left, right) => weakness(progress, left.question, all) - weakness(progress, right.question, all) || left.index - right.index).map((item) => item.question);
}

export function recomputeMastery(attempts: KakomonAttempt[], rescore?: (attempt: KakomonAttempt) => boolean | null): Record<string, QuestionMastery> {
  const grouped = new Map<string, KakomonAttempt[]>();
  for (const attempt of [...attempts].sort((left, right) => left.seq - right.seq)) {
    const list = grouped.get(attempt.questionId) ?? [];
    list.push(attempt);
    grouped.set(attempt.questionId, list);
  }
  const mastery: Record<string, QuestionMastery> = {};
  for (const [questionId, list] of grouped) {
    let rank: Rank = 0;
    let everMastered = false;
    let correctCount = 0;
    let wrongCount = 0;
    let lastAnsweredAt: string | null = null;
    let throughSeq = 0;
    for (const attempt of list) {
      if (!attempt.rankEligible || attempt.questionRevision < 1) continue;
      const rescored = rescore?.(attempt);
      const correct = rescored === null || rescored === undefined ? attempt.correct : rescored;
      rank = updateRank(rank, correct);
      if (rank === RANK_MAX) everMastered = true;
      if (correct) correctCount += 1;
      else wrongCount += 1;
      lastAnsweredAt = attempt.at;
      throughSeq = attempt.seq;
    }
    mastery[questionId] = { questionId, rank, correctCount, wrongCount, lastAnsweredAt, everMastered, basisRevision: 1, throughSeq };
  }
  return mastery;
}

function rescoreFrom(questions: Question[]) {
  const map = new Map(questions.map((question) => [question.id, question]));
  return (attempt: KakomonAttempt) => {
    const question = map.get(attempt.questionId);
    if (!question) return null;
    if (attempt.response === null) return false;
    return gradeQuestion(question, attempt.response).ok;
  };
}

export function applyMastery(progress: KakomonProgress, questions: Question[]): KakomonProgress {
  return { ...progress, mastery: recomputeMastery(progress.attempts, rescoreFrom(questions)) };
}

export function firstOpen(run: KakomonRun) {
  const index = run.questions.findIndex((item) => !(item.id in run.answers));
  return index < 0 ? run.questions.length : index;
}

export function assessRun(run: KakomonRun, exams: ExamSet[]): 'ok' | 'missing' | 'revision' {
  if (run.cursor < 0 || run.cursor >= run.questions.length || !run.questions.length) return 'missing';
  const questions = new Map(exams.flatMap((exam) => exam.questions.map((question) => [question.id, question])));
  for (const item of run.questions) {
    const question = questions.get(item.id);
    if (!question) return 'missing';
    if (question.revision !== item.revision) return 'revision';
  }
  return 'ok';
}

export function startDrill(progress: KakomonProgress, examOrExams: ExamSet | ExamSet[], excludeOrPick: boolean | DrillPick, now = new Date().toISOString()): { progress: KakomonProgress; empty: boolean } {
  const exams = Array.isArray(examOrExams) ? examOrExams : [examOrExams];
  const pick: DrillPick = typeof excludeOrPick === 'boolean' ? { order: 'seq', sections: ['A', 'B'], excludeMastered: excludeOrPick } : excludeOrPick;
  const current = applyMastery(progress, exams.flatMap((exam) => exam.questions));
  const questions = questionsForDrill(exams, current, pick);
  if (!questions.length) return { progress: current, empty: true };
  const seed = pick.order === 'random' ? pick.seed ?? 1 : 0;
  const run: KakomonRun = {
    id: `drill-${now}-${questions[0].id}`,
    mode: 'drill',
    setKey: scopeKey(exams.map((exam) => exam.id), pick.sections),
    setDefinitionDigest: `${pick.order}@${seed}:${questions.map((question) => `${question.id}@${question.revision}`).join(',')}`,
    seed,
    questions: questions.map((question) => ({ id: question.id, revision: question.revision })),
    cursor: 0,
    answers: {},
    startedAt: now,
    elapsedMs: 0,
    status: 'active',
    servedFromSnapshot: [],
  };
  return {
    progress: { ...current, active: run, settings: { ...current.settings, excludeMastered: { ...current.settings.excludeMastered, drill: pick.excludeMastered } } },
    empty: false,
  };
}

export function discardRun(progress: KakomonProgress): KakomonProgress {
  return { ...progress, active: null };
}

export function moveCursor(progress: KakomonProgress, cursor: number): KakomonProgress {
  const run = progress.active;
  if (!run || run.status !== 'active') return progress;
  const limit = Math.min(firstOpen(run), run.questions.length - 1);
  if (cursor < 0 || cursor > limit) return progress;
  return { ...progress, active: { ...run, cursor } };
}

export function commitAnswer(progress: KakomonProgress, question: Question, response: Response, answerDigest: string, now = new Date().toISOString()): { progress: KakomonProgress; before: Rank; after: Rank } {
  const run = progress.active;
  const before = rankOf(progress, question.id);
  if (!run || run.status !== 'active' || run.questions[run.cursor]?.id !== question.id || run.answers[question.id]) {
    return { progress, before, after: before };
  }
  const grade = gradeQuestion(question, response);
  const attempt: KakomonAttempt = {
    id: `a-${progress.nextSeq}`,
    seq: progress.nextSeq,
    at: now,
    runId: run.id,
    mode: 'drill',
    questionId: question.id,
    questionRevision: question.revision,
    answerDigest,
    response,
    subResults: grade.subResults,
    correct: grade.ok,
    rankEligible: true,
    doubtful: false,
    elapsedMs: 0,
  };
  const next = applyMastery({
    ...progress,
    nextSeq: progress.nextSeq + 1,
    attempts: [...progress.attempts, attempt],
    active: { ...run, answers: { ...run.answers, [question.id]: response } },
  }, [question]);
  return { progress: next, before, after: rankOf(next, question.id) };
}

export function finishDrill(progress: KakomonProgress, now = new Date().toISOString()): { progress: KakomonProgress; finished: boolean } {
  const run = progress.active;
  if (!run || run.status !== 'active' || run.questions.some((item) => !(item.id in run.answers))) return { progress, finished: false };
  const summary: RunSummary = {
    runId: run.id,
    mode: run.mode,
    setKey: run.setKey,
    setDefinitionDigest: run.setDefinitionDigest,
    questions: run.questions,
    completedAt: now,
  };
  return { progress: { ...progress, active: null, runs: [...progress.runs, summary] }, finished: true };
}

export function showNext(progress: KakomonProgress): KakomonProgress {
  const run = progress.active;
  if (!run || run.status !== 'active') return progress;
  const open = Math.min(firstOpen(run), run.questions.length - 1);
  if (run.cursor >= open) return progress;
  return { ...progress, active: { ...run, cursor: run.cursor + 1 } };
}

function dateValid(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isResponse(value: unknown): value is Response {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 1);
}

function parseProgress(raw: string | null): KakomonProgress {
  if (!raw) return emptyProgress();
  const value = JSON.parse(raw) as KakomonProgress;
  const fail = () => { throw new Error('過去問の周回記録を確認できません'); };
  if (value?.schemaVersion !== 1 || !Array.isArray(value.attempts) || !Array.isArray(value.runs) || !value.settings) fail();
  if (!Number.isInteger(value.nextSeq) || value.nextSeq < 1) fail();
  if (value.active !== null && !value.active) fail();
  const seqs = new Set<number>();
  for (const attempt of value.attempts) {
    if (!attempt || typeof attempt.id !== 'string' || !attempt.id || !Number.isInteger(attempt.seq) || attempt.seq < 1 || seqs.has(attempt.seq)) fail();
    if (!dateValid(attempt.at) || typeof attempt.runId !== 'string' || !MODES.includes(attempt.mode)) fail();
    if (typeof attempt.questionId !== 'string' || !Number.isInteger(attempt.questionRevision) || attempt.questionRevision < 1) fail();
    if (typeof attempt.answerDigest !== 'string' || (attempt.response !== null && !isResponse(attempt.response))) fail();
    if (typeof attempt.correct !== 'boolean' || typeof attempt.rankEligible !== 'boolean' || typeof attempt.doubtful !== 'boolean') fail();
    if (typeof attempt.elapsedMs !== 'number' || attempt.elapsedMs < 0) fail();
    seqs.add(attempt.seq);
  }
  const maxSeq = value.attempts.reduce((max, attempt) => Math.max(max, attempt.seq), 0);
  if (value.nextSeq !== maxSeq + 1) fail();
  const runIds = new Set<string>();
  for (const run of value.runs) {
    if (!run || typeof run.runId !== 'string' || !run.runId || runIds.has(run.runId) || !MODES.includes(run.mode)) fail();
    if (typeof run.setKey !== 'string' || typeof run.setDefinitionDigest !== 'string' || !dateValid(run.completedAt)) fail();
    if (!Array.isArray(run.questions) || !run.questions.length) fail();
    runIds.add(run.runId);
  }
  if (value.active) {
    const run = value.active;
    if (typeof run.id !== 'string' || !run.id || !MODES.includes(run.mode) || typeof run.setKey !== 'string') fail();
    if (!Array.isArray(run.questions) || !run.questions.length || !Number.isInteger(run.cursor)) fail();
    if (run.cursor < 0 || run.cursor >= run.questions.length) fail();
    if (!run.answers || typeof run.answers !== 'object' || Array.isArray(run.answers)) fail();
    if (!dateValid(run.startedAt) || (run.status !== 'active' && run.status !== 'suspended')) fail();
  }
  return {
    ...value,
    mastery: recomputeMastery(value.attempts),
    flags: value.flags ?? {},
    settings: { excludeMastered: value.settings.excludeMastered ?? {}, noticeAcknowledged: value.settings.noticeAcknowledged ?? 0 },
  };
}

export function readProgress(storage: Pick<Storage, 'getItem'>) {
  try {
    return { progress: parseProgress(storage.getItem(KAKOMON_PROGRESS_KEY)), writable: true, notice: '' };
  } catch {
    return { progress: emptyProgress(), writable: false, notice: '周回の記録を読み込めません。この画面の間だけ記録し、元の保存内容は変更しません。' };
  }
}

export function saveProgress(progress: KakomonProgress, storage: Pick<Storage, 'setItem'>) {
  try {
    storage.setItem(KAKOMON_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}
