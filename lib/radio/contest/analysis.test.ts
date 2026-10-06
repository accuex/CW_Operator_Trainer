import { describe, expect, it } from 'vitest';
import { forWeakAnalysis, weakPairs } from '../../analytics';
import { analyseContest, bestStreak, type ContestAnalysis } from './analysis';
import { analyse, fixture, type Fixture, type Spec } from './fixtures.testkit';
import { contestAnswers, contestContacts, CUT_BLAME } from './learning';
import type { ReviewLine } from './review';

/**
 * Stage 4: one fixture per cause. Each run is built by hand — the books, our log as
 * checked, what we sent, what reached our receiver and each contact scored — so the
 * cause a failure gets is the one the situation calls for, and nothing else.
 */

const only = (analysis: ContestAnalysis) => {
  const failing = analysis.mistakes.filter((mistake) => mistake.failure !== 'doubled');
  expect(failing).toHaveLength(1);
  return failing[0];
};

const answersOf = (fx: Fixture, analysis: ContestAnalysis) =>
  contestAnswers(fx.result, fx.scored, analysis, { sessionId: 's', timestamp: 1, modeId: 'contest', presetId: 'p', wpmOf: () => 26 });

describe('contest causes: one fixture per cause', () => {
  it('reception: a call missed in the clear, nothing else on the frequency', () => {
    const analysis = analyse([{ call: 'JA1ABC', sent: ['JA1ABD'], line: { call: 'JA1ABD', verdict: 'bust-call' } }]);
    const mistake = only(analysis);
    expect(mistake).toMatchObject({ failure: 'bust-call', cause: 'reception', aux: [], got: 'JA1ABD', expected: 'JA1ABC' });
    expect(mistake.slips).toEqual([{ field: 'call', expected: 'C', input: 'D', situation: 'clean' }]);
    expect(analysis.blamed).toEqual({});
    expect(analysis.copy).toEqual({ total: 1, correct: 0 });
  });

  it('bust call vs first call: a wrong call put right before the line is a first-call slip, not a BUST', () => {
    const analysis = analyse([{ call: 'JA1ABC', sent: ['JA1ABD', 'JA1ABC'] }]);
    expect(only(analysis)).toMatchObject({ failure: 'first-call', cause: 'reception', got: 'JA1ABD' });
    expect(analysis.failures['bust-call']).toBeUndefined();
    expect(analysis.calls).toEqual({ total: 1, correct: 1 });
  });

  it('bust serial: the digit taken for another, in the clear', () => {
    const analysis = analyse([{ call: 'JA1ABC', keyed: '138', line: { nr: '838', verdict: 'bust-nr' } }]);
    expect(only(analysis)).toMatchObject({ failure: 'bust-nr', cause: 'reception', field: 'nr', got: '838', expected: '138' });
    expect(only(analysis).slips).toEqual([{ field: 'nr', expected: '1', input: '8', situation: 'clean' }]);
    expect(analysis.serial).toEqual({ total: 1, correct: 0 });
  });

  it('weak: a call and a serial missed while the station was weak', () => {
    const call = analyse([{ call: 'JA1ABC', sent: ['JA1ABD'], firstSituation: 'weak', line: { call: 'JA1ABD', verdict: 'bust-call', callSituation: 'weak' } }]);
    expect(only(call)).toMatchObject({ failure: 'bust-call', cause: 'weak' });
    expect(call.evidence.env.weak).toEqual({ total: 6, correct: 5 });
    // Weak copy is no copy in the clear: neither tally holds it.
    expect(call.copy.total + call.calls.total).toBe(0);
    const nr = analyse([{ call: 'JA1ABC', line: { nr: '128', verdict: 'bust-nr', nrSituation: 'weak' } }]);
    expect(only(nr)).toMatchObject({ failure: 'bust-nr', cause: 'weak' });
  });

  it.each(['qsb', 'qrn', 'qrm'] as const)('environment (%s): the band, with which condition', (env) => {
    const analysis = analyse([{ call: 'JA1ABC', sent: ['JA1ABD'], firstSituation: env, line: { call: 'JA1ABD', verdict: 'bust-call', callSituation: env } }]);
    expect(only(analysis)).toMatchObject({ cause: 'environment', env });
    expect(analysis.blamed).toEqual({});
    expect(analysis.evidence.env[env]).toEqual({ total: 6, correct: 5 });
  });

  it('overlap: another caller keyed over the station, or we took its serial', () => {
    const chars = analyse([{ call: 'JA1ABC', sent: ['JA1ABD'], firstSituation: 'overlap', line: { call: 'JA1ABD', verdict: 'bust-call', callSituation: 'overlap' }, air: [{ call: 'W5XYZ', at: -1 }] }]);
    expect(only(chars)).toMatchObject({ cause: 'overlap' });
    const serial = analyse([{ call: 'JA1ABC', keyed: '123', line: { nr: '456', verdict: 'bust-nr' }, air: [{ call: 'JA2QRP', at: 1, text: 'JA2QRP 5NN 456' }] }]);
    expect(only(serial)).toMatchObject({ failure: 'bust-nr', cause: 'overlap', with: 'JA2QRP' });
  });

  it('doubling: we keyed over the station and the contact never got going', () => {
    const analysis = analyse([{ call: 'JA1ABC', line: null, exchanged: false, firstSituation: 'doubled', doublings: 2 }]);
    const failures = analysis.mistakes.map((mistake) => [mistake.failure, mistake.cause]);
    expect(failures).toEqual([['abandoned', 'doubling'], ['doubled', 'doubling']]);
    expect(analysis.mistakes.find((mistake) => mistake.failure === 'doubled')!.count).toBe(2);
    expect(analysis.timing).toEqual({ total: 1, correct: 0 });
    // Our doubling is no miss of the ear.
    expect(analysis.copy.total).toBe(0);
  });

  it('similar call: a look-alike on the frequency, nearer our call than the station', () => {
    const fx = fixture([{ call: 'JA1ABC', sent: ['JA1ABD'], line: { call: 'JA1ABD', verdict: 'bust-call' }, air: [{ call: 'JA1ABD', at: -1 }] }]);
    const analysis = analyseContest(fx);
    expect(only(analysis)).toMatchObject({ failure: 'bust-call', cause: 'similar', with: 'JA1ABD' });
    expect(analysis.blamed.c1).toEqual({ call: 'similar' });
    expect([analysis.similarMet, analysis.similarRight]).toEqual([1, 0]);
    // Not a copy failure: out of the copy tally and of the evidence.
    expect(analysis.copy.total).toBe(0);
    expect(analysis.evidence.clean).toEqual({ total: 3, correct: 3 });
  });

  it('eager: a near call answering out of turn takes the contact', () => {
    const analysis = analyse([{
      call: 'JA1ABC', sent: ['JA1ABD'], line: { call: 'JA1ABD', verdict: 'bust-call' },
      // AB? went out, JA1ABD answered it (not JA1ABC's turn alone) and we took it.
      desk: [{ at: 0, end: 1, kind: 'partial', subject: 'ABC' }],
      air: [{ call: 'JA1ABD', at: -0.5 }],
    }]);
    expect(only(analysis)).toMatchObject({ cause: 'interference', interferer: 'eager', with: 'JA1ABD' });
    expect(analysis.eager).toBe(1);
    expect(analysis.blamed.c1).toEqual({ call: 'interference' });
  });

  it('lid: a far call keying over our exchange, its serial taken', () => {
    const analysis = analyse([{
      call: 'JA1ABC', keyed: '123', line: { nr: '456', verdict: 'bust-nr' },
      desk: [{ at: 3, end: 5, kind: 'exchange', subject: 'JA1ABC' }],
      air: [{ call: 'W5XYZ', at: 4, text: 'W5XYZ 456' }],
    }]);
    expect(only(analysis)).toMatchObject({ failure: 'bust-nr', cause: 'interference', interferer: 'lid', with: 'W5XYZ' });
    expect(analysis.lid).toBe(1);
    expect(analysis.blamed.c1).toEqual({ nr: 'interference' });
  });

  it('procedure: no serial, a contact left part-way, a line only they have — never reception', () => {
    const analysis = analyse([
      { call: 'JA1ABC', line: { nr: '', verdict: 'bust-nr' } },
      { call: 'JA2DEF', line: null, exchanged: false },
      { call: 'JA3GHI', line: null, exchanged: false, theirOnly: 'unmatched', heard: false },
    ]);
    expect(analysis.mistakes.map((mistake) => [mistake.failure, mistake.cause])).toEqual([
      ['bust-nr', 'procedure'], ['abandoned', 'procedure'], ['abandoned', 'procedure'], ['unmatched', 'procedure'],
    ]);
    expect(analysis.causes.reception).toBeUndefined();
    expect(analysis.blamed.c1).toEqual({ nr: 'procedure' });
    expect(analysis.procedure.correct).toBeLessThan(analysis.procedure.total);
  });

  it('logging: the call right on the air and typed wrong, a serial that is no serial, a line for nobody', () => {
    const lineFor = (call: string, at: number): ReviewLine => ({ id: `x${at}`, at, call, rst: '599', nr: '1', sentNr: 9, verdict: 'nil', their: null, theyBustedUs: false });
    const analysis = analyse([
      { call: 'JA1ABC', sent: ['JA1ABC'], line: { call: 'JA1ABX', verdict: 'bust-call' } },
      { call: 'JA2DEF', line: { nr: '1Q3', verdict: 'bust-nr' } },
      { call: 'JA3GHI', desk: [{ at: 1, kind: 'exchange', subject: 'JA9ZZZ' }] },
    ], { lines: [lineFor('JA8NOB', 200), lineFor('JA9ZZZ', 210)] });
    expect(analysis.mistakes.map((mistake) => [mistake.failure, mistake.cause, mistake.call])).toEqual([
      ['bust-call', 'logging', 'JA1ABC'], ['bust-nr', 'logging', 'JA2DEF'], ['nil', 'logging', 'JA8NOB'], ['nil', 'procedure', 'JA9ZZZ'],
    ]);
    expect(analysis.blamed).toEqual({ c1: { call: 'logging' }, c2: { nr: 'logging' } });
    expect(analysis.logging).toEqual({ total: 5, correct: 2 });
  });

  it('DUPE: a call already in the log worked and written again', () => {
    const analysis = analyse([{ call: 'JA1ABC' }, { call: 'JA1ABC', line: { verdict: 'dupe' } }]);
    expect(only(analysis)).toMatchObject({ failure: 'dupe', cause: 'dupe' });
    expect(analysis.blamed.c2).toEqual({ call: 'dupe', nr: 'dupe' });
    // The DUPE line neither counts for the log's copy nor breaks a streak.
    expect(analysis.calls.total).toBe(1);
    expect(analysis.streak).toBe(1);
  });

  it('dropped after the exchange: its own cause, what the serial went through only as aux', () => {
    const analysis = analyse([{ call: 'JA1ABC', line: null, theirOnly: 'dropped', serialHeard: 'weak', doublings: 1 }]);
    expect(only(analysis)).toMatchObject({ failure: 'dropped', cause: 'dropped', aux: ['weak', 'doubling'] });
    expect(analysis.causes).toEqual({ dropped: 1, doubling: 1 });
    expect(analysis.causes.weak).toBeUndefined();
    expect(analysis.causes.reception).toBeUndefined();
    expect(analysis.procedure.correct).toBeLessThan(analysis.procedure.total);
  });

  it('a look-alike that took the exchange we sent a call we logged right: interference, not our dropped contact', () => {
    const analysis = analyse([{ call: 'JA8US' }, { call: 'JG8UN', sent: ['JA8US'], line: null, theirOnly: 'dropped', air: [{ call: 'JA8US', at: -1 }] }]);
    const dropped = analysis.mistakes.filter((mistake) => mistake.failure === 'dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ cause: 'interference', with: 'JA8US', interferer: 'eager', call: 'JG8UN' });
    // The call we sent it was the look-alike's: never copy.
    expect(analysis.causes.reception).toBeUndefined();
    expect(analysis.causes.dropped).toBeUndefined();
    expect(analysis.procedure.correct).toBe(analysis.procedure.total);
    // Sent its own call and left it: still ours.
    expect(only(analyse([{ call: 'JA8US' }, { call: 'JG8UN', line: null, theirOnly: 'dropped' }])).cause).toBe('dropped');
  });

  it('one failure, several things going on: one primary cause, the rest aux', () => {
    const analysis = analyse([{
      call: 'JA1ABC', sent: ['JA1ABD'], doublings: 1, line: { call: 'JA1ABD', verdict: 'bust-call', callSituation: 'weak' }, air: [{ call: 'JA1ABD', at: -1 }],
    }]);
    const mistake = only(analysis);
    expect(mistake.cause).toBe('similar');
    expect(mistake.aux).toEqual(expect.arrayContaining(['doubling', 'weak']));
    // Only the primary cause is counted.
    expect(analysis.causes).toEqual({ similar: 1, doubling: 1 });
  });

  it('streak: lines checked right in a row, DUPE skipped, a BUST or NIL ends it', () => {
    const verdicts = ['ok', 'ok', 'dupe', 'ok', 'bust-call', 'ok', 'ok'] as const;
    expect(bestStreak(verdicts.map((verdict, at) => ({ at, verdict })))).toBe(3);
  });
});

describe('contest characters: what goes to the confusion stats', () => {
  it('a slip in the clear is a character confusion; the field\'s answers keep it', () => {
    const fx = fixture([{ call: 'JA1ABC', sent: ['JA1ABD'], line: { call: 'JA1ABD', verdict: 'bust-call' } }]);
    const answers = answersOf(fx, analyseContest(fx));
    const pairs = weakPairs(forWeakAnalysis(answers));
    expect(answers.filter((answer) => !answer.isCorrect).map((answer) => [answer.correctSymbol, answer.inputSymbol])).toEqual([['C', 'D']]);
    expect(pairs.some((pair) => [pair.a, pair.b].sort().join('') === 'CD')).toBe(true);
  });

  it.each([
    ['similar', { call: 'JA1ABC', sent: ['JA1ABD'], line: { call: 'JA1ABD', verdict: 'bust-call' as const }, air: [{ call: 'JA1ABD', at: -1 }] }],
    ['logging', { call: 'JA1ABC', line: { call: 'JA1ABD', verdict: 'bust-call' as const } }],
    ['procedure', { call: 'JA1ABC', line: { nr: '', verdict: 'bust-nr' as const } }],
    ['interference', { call: 'JA1ABC', line: { nr: '456', verdict: 'bust-nr' as const }, desk: [{ at: 3, end: 5, kind: 'exchange' as const, subject: 'JA1ABC' }], air: [{ call: 'W5XYZ', at: 4, text: 'W5XYZ 456' }] }],
  ] as [string, Spec][])('%s: the missed field is blamed and never a weak pair, even with every condition', (cause, spec) => {
    const fx = fixture([spec]);
    const answers = answersOf(fx, analyseContest(fx));
    const wrong = answers.filter((answer) => !answer.isCorrect);
    expect(wrong.length).toBeGreaterThan(0);
    expect(wrong.every((answer) => answer.qso?.blame === cause)).toBe(true);
    expect(forWeakAnalysis(answers, true).some((answer) => !answer.isCorrect)).toBe(false);
  });

  it.each(['weak', 'qsb', 'qrn', 'qrm'] as const)('RF (%s): kept as the band\'s, out of clean-copy weak pairs', (situation) => {
    const fx = fixture([{ call: 'JA1ABC', sent: ['JA1ABD'], firstSituation: situation, line: { call: 'JA1ABD', verdict: 'bust-call', callSituation: situation } }]);
    const answers = answersOf(fx, analyseContest(fx));
    expect(answers.find((answer) => !answer.isCorrect)?.qso?.condition).toBe(situation);
    expect(weakPairs(forWeakAnalysis(answers))).toEqual([]);
  });

  it('cut numbers: a serial keyed with T / N is the contest\'s notation, never a letter confusion', () => {
    // 1T9 is 109; typed 189: the slip is in the cut letter's place.
    const fx = fixture([{ call: 'JA1ABC', keyed: '1T9', line: { nr: '189', verdict: 'bust-nr' } }]);
    const analysis = analyseContest(fx);
    expect(only(analysis)).toMatchObject({ failure: 'bust-nr', cause: 'reception', expected: '1T9', got: '189' });
    const answers = answersOf(fx, analysis);
    const cut = answers.filter((answer) => answer.qso?.field === 'nr' && answer.correctSymbol === 'T');
    expect(cut).toHaveLength(1);
    expect(cut[0].qso?.blame).toBe(CUT_BLAME);
    expect(forWeakAnalysis(answers, true).some((answer) => answer.correctSymbol === 'T')).toBe(false);
    // Digits keyed as digits still count.
    expect(forWeakAnalysis(answers).filter((answer) => answer.qso?.field === 'nr').map((answer) => answer.correctSymbol)).toEqual(['1', '9']);
    // The shared counters see no serial with a cut letter in it.
    const [seen] = contestContacts(fx.result, fx.scored, analysis, () => 26) ?? [];
    expect(seen.fields.map((field) => field.key)).toEqual(['call']);
  });

  it('padding cut away: T23 is 23, typed 23 is right', () => {
    const fx = fixture([{ call: 'JA1ABC', keyed: 'TT23', line: { nr: '23' } }]);
    const analysis = analyseContest(fx);
    expect(analysis.mistakes).toEqual([]);
    expect(analysis.serial).toEqual({ total: 1, correct: 1 });
  });
});
