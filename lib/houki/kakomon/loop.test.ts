import { describe, expect, it } from 'vitest';
import { fictionalExam } from './fixtures.mjs';
import { answerHistory, commitAnswer, discardRun, emptyProgress, finishDrill, hasAnswers, KAKOMON_PROGRESS_KEY, lapsOf, rankOf, readProgress, saveProgress, startDrill, updateRank } from './loop';
import type { ExamSet, Question } from './types';

const exam = fictionalExam() as ExamSet;
const now = '2026-10-09T11:00:00+09:00';

function shortExam(count: number) {
  return { ...exam, questions: exam.questions.slice(0, count) };
}

function answerOf(question: Question) {
  if (question.format === 'single' || question.format === 'combination') return question.answer;
  return Object.fromEntries(question.items.map((item) => [item.label, item.answer]));
}

describe('kakomon drill loop', () => {
  it('shows the last seven answers, oldest first, and skips answers that do not move rank', () => {
    const sitting = shortExam(1);
    const question = sitting.questions[0];
    const correct = answerOf(question);
    const wrong = correct === 1 ? 2 : 1;
    let progress = emptyProgress();
    for (const ok of [true, true, true, false, true, false, false, false]) {
      progress = startDrill(progress, sitting, false, now).progress;
      progress = commitAnswer(progress, question, ok ? correct : wrong, 'digest', now).progress;
      progress = finishDrill(progress, now).progress;
    }
    expect(answerHistory(progress, question.id, sitting.questions)).toEqual([true, true, false, true, false, false, false]);
    expect(rankOf(progress, question.id)).toBe(0);
    expect(hasAnswers(progress, question.id)).toBe(true);
    const skipped = progress.attempts[0];
    progress = {
      ...progress,
      attempts: [...progress.attempts, { ...skipped, id: 'redo', seq: progress.nextSeq, rankEligible: false, correct: false }],
    };
    expect(answerHistory(progress, question.id, sitting.questions)).toEqual([true, true, false, true, false, false, false]);
    expect(answerHistory(progress, 'missing')).toEqual([]);
    expect(hasAnswers(progress, 'missing')).toBe(false);
  });

  it('climbs one rank per correct answer and treats only the top rank as mastered', () => {
    expect(updateRank(0, false)).toBe(0);
    expect(updateRank(0, true)).toBe(1);
    expect(updateRank(3, true)).toBe(4);
    expect(updateRank(7, true)).toBe(7);
    expect(updateRank(7, false)).toBe(6);
    const one = shortExam(1);
    let progress = emptyProgress();
    for (let lap = 0; lap < 3; lap += 1) {
      progress = startDrill(progress, one, false, now).progress;
      progress = commitAnswer(progress, one.questions[0], answerOf(one.questions[0]), 'digest', now).progress;
      progress = finishDrill(progress, now).progress;
    }
    expect(rankOf(progress, one.questions[0].id)).toBe(3);
    expect(progress.mastery[one.questions[0].id].everMastered).toBe(false);
    for (let lap = 0; lap < 4; lap += 1) {
      progress = startDrill(progress, one, false, now).progress;
      progress = commitAnswer(progress, one.questions[0], answerOf(one.questions[0]), 'digest', now).progress;
      progress = finishDrill(progress, now).progress;
    }
    expect(rankOf(progress, one.questions[0].id)).toBe(7);
    expect(progress.mastery[one.questions[0].id].everMastered).toBe(true);
    progress = startDrill(progress, one, false, now).progress;
    progress = commitAnswer(progress, one.questions[0], answerOf(one.questions[0]) === 1 ? 2 : 1, 'digest', now).progress;
    expect(rankOf(progress, one.questions[0].id)).toBe(6);
    expect(progress.mastery[one.questions[0].id].everMastered).toBe(true);
  });

  it('counts a B question wrong unless every sub-item matches', () => {
    const judge = exam.questions.find((question) => question.format === 'judge');
    if (!judge || judge.format !== 'judge') throw new Error('judge missing');
    const sitting = { ...exam, questions: [judge] };
    let progress = startDrill(emptyProgress(), sitting, false, now).progress;
    const miss = { ...answerOf(judge), ア: judge.items[0].answer === 1 ? 2 : 1 };
    progress = commitAnswer(progress, judge, miss, 'digest', now).progress;
    expect(rankOf(progress, judge.id)).toBe(0);
    expect(answerHistory(progress, judge.id, sitting.questions)).toEqual([false]);
    progress = finishDrill(progress, now).progress;
    progress = startDrill(progress, sitting, false, now).progress;
    progress = commitAnswer(progress, judge, answerOf(judge), 'digest', now).progress;
    expect(rankOf(progress, judge.id)).toBe(1);
    expect(answerHistory(progress, judge.id, sitting.questions)).toEqual([false, true]);
  });

  it('counts a lap only after every question in the run is answered', () => {
    const sitting = shortExam(2);
    let progress = startDrill(emptyProgress(), sitting, false, now).progress;
    progress = commitAnswer(progress, sitting.questions[0], answerOf(sitting.questions[0]), 'digest', now).progress;
    expect(finishDrill(progress, now).finished).toBe(false);
    expect(lapsOf(progress, sitting.id)).toBe(0);
    progress = { ...progress, active: progress.active ? { ...progress.active, cursor: 1 } : null };
    progress = commitAnswer(progress, sitting.questions[1], answerOf(sitting.questions[1]), 'digest', now).progress;
    const done = finishDrill(progress, now);
    expect(done.finished).toBe(true);
    expect(lapsOf(done.progress, sitting.id)).toBe(1);
    const replaced = startDrill(done.progress, sitting, false, now).progress;
    expect(lapsOf(discardRun(replaced), sitting.id)).toBe(1);
  });

  it('skips only the highest rank when the next lap leaves mastered questions out', () => {
    const sitting = shortExam(2);
    let progress = emptyProgress();
    for (let lap = 0; lap < 3; lap += 1) {
      progress = startDrill(progress, { ...sitting, questions: [sitting.questions[0]] }, false, now).progress;
      progress = commitAnswer(progress, sitting.questions[0], answerOf(sitting.questions[0]), 'digest', now).progress;
      progress = finishDrill(progress, now).progress;
    }
    const stillIncluded = startDrill(progress, sitting, true, now);
    expect(stillIncluded.progress.active?.questions.map((item) => item.id)).toEqual(sitting.questions.map((item) => item.id));
    progress = discardRun(stillIncluded.progress);
    for (let lap = 0; lap < 4; lap += 1) {
      progress = startDrill(progress, { ...sitting, questions: [sitting.questions[0]] }, false, now).progress;
      progress = commitAnswer(progress, sitting.questions[0], answerOf(sitting.questions[0]), 'digest', now).progress;
      progress = finishDrill(progress, now).progress;
    }
    const next = startDrill(progress, sitting, true, now);
    expect(next.empty).toBe(false);
    expect(next.progress.active?.questions.map((item) => item.id)).toEqual([sitting.questions[1].id]);
  });

  it('orders a lap by the chosen years, sections, and weakness', () => {
    const sitting = shortExam(2);
    const paper = startDrill(emptyProgress(), sitting, { order: 'seq', sections: ['A', 'B'], excludeMastered: false }, now);
    expect(paper.progress.active?.questions.map((item) => item.id)).toEqual(sitting.questions.map((item) => item.id));
    expect(paper.progress.active?.setKey).toBe(`exam:${sitting.id}`);
    const onlyB = startDrill(emptyProgress(), exam, { order: 'seq', sections: ['B'], excludeMastered: false }, now);
    expect(onlyB.progress.active?.questions).toHaveLength(5);
    expect(onlyB.progress.active?.questions.every((item) => item.id.includes('-B'))).toBe(true);
    expect(onlyB.progress.active?.setKey).toBe(`pool:${exam.id}:B`);
    let progress = emptyProgress();
    for (let lap = 0; lap < 3; lap += 1) {
      progress = startDrill(progress, { ...sitting, questions: [sitting.questions[0]] }, false, now).progress;
      progress = commitAnswer(progress, sitting.questions[0], answerOf(sitting.questions[0]), 'digest', now).progress;
      progress = finishDrill(progress, now).progress;
    }
    const weak = startDrill(progress, sitting, { order: 'weak', sections: ['A', 'B'], excludeMastered: false }, now);
    expect(weak.progress.active?.questions.map((item) => item.id)).toEqual([sitting.questions[1].id, sitting.questions[0].id]);
    const random = startDrill(emptyProgress(), exam, { order: 'random', sections: ['A', 'B'], excludeMastered: false, seed: 7 }, now);
    const again = startDrill(emptyProgress(), exam, { order: 'random', sections: ['A', 'B'], excludeMastered: false, seed: 7 }, now);
    expect(random.progress.active?.questions.map((item) => item.id)).toEqual(again.progress.active?.questions.map((item) => item.id));
    expect(random.progress.active?.questions.map((item) => item.id)).not.toEqual(exam.questions.map((item) => item.id));
    const later = {
      ...shortExam(1),
      id: 'fx-houki-2099-09',
      questions: shortExam(1).questions.map((question) => ({ ...question, id: question.id.replace('2099-03', '2099-09') })),
    };
    const both = startDrill(emptyProgress(), [shortExam(1), later], { order: 'seq', sections: ['A', 'B'], excludeMastered: false }, now);
    expect(both.progress.active?.setKey).toBe('pool:fx-houki-2099-03+fx-houki-2099-09:AB');
    expect(both.progress.active?.questions.map((item) => item.id)).toEqual([shortExam(1).questions[0].id, later.questions[0].id]);
  });

  it('does not write when the stored record cannot be read', () => {
    const storage = {
      raw: '{',
      getItem() { return this.raw; },
      setItem() { throw new Error('must not write'); },
    };
    const loaded = readProgress(storage);
    expect(loaded.writable).toBe(false);
    expect(loaded.progress.attempts).toEqual([]);
    const memory = { raw: '', getItem() { return this.raw || null; }, setItem(_key: string, value: string) { this.raw = value; } };
    expect(saveProgress(emptyProgress(), memory)).toBe(true);
    expect(memory.raw).toContain('"schemaVersion":1');
    expect(readProgress(memory).writable).toBe(true);
    const again = commitAnswer(startDrill(readProgress(memory).progress, shortExam(1), false, now).progress, shortExam(1).questions[0], 1, 'digest', now).progress;
    saveProgress(again, memory);
    expect(readProgress(memory).progress.mastery[shortExam(1).questions[0].id].rank).toBe(1);
  });
});
