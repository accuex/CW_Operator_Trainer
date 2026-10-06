import { describe, expect, it } from 'vitest';
import { emptyQsoProfile } from '../skills';
import { operatorCall } from './intent';
import { keySegments } from './segments';
import { updateFollow, updateWabunSkills } from './learning';
import { factDisplay, measureFollow } from './review';
import { runWabunSim } from './sim';
import { TALK_SPLIT_SECONDS } from './dialogue';

const blank = { call: '', rst: '', name: '', qth: '' };

describe('wabun Stage 4: copy.wabun / follow.wabun apart', () => {
  it('copy.wabun only with a memo: no memo is not measured, not failed', () => {
    const none = runWabunSim({ seed: 1, level: 3 });
    expect(none.review.copy.accuracy).toBeNull();
    expect(none.review.copy.clean).toBeNull();
    expect(none.review.evidence['copy.wabun']).toBeNull();
    expect(none.review.follow.facts.every((fact) => fact.memo === null)).toBe(true);

    const full = runWabunSim({ seed: 1, level: 3, memo: 'full' });
    const copy = full.review.evidence['copy.wabun']!;
    expect(copy.total).toBe(full.review.copy.reached);
    expect(copy.correct).toBe(full.review.copy.matched);
    expect(copy.clean.total).toBeLessThanOrEqual(copy.total);
    expect(copy.clean.correct).toBeLessThanOrEqual(copy.clean.total);
    // A kana fact written down is marked in the memo; Latin / log facts aren't held against it.
    expect(full.review.follow.facts.find((fact) => fact.fact === 'name')?.memo).toBe(true);
    expect(full.review.follow.facts.find((fact) => fact.fact === 'call')?.memo).toBeNull();
    // Follow is the same with or without the memo.
    expect(full.review.evidence['follow.wabun']).toEqual(none.review.evidence['follow.wabun']);
  });

  it('kana keyed under our TX (muted) is out of the copy denominator and out of follow', () => {
    const result = runWabunSim({ seed: 1, level: 4, memo: 'full', interrupt: { phase: 'talk', beforeFact: 'wx', text: ({ npc, me }) => `${npc} DE ${me} WX AGN?` } });
    const copy = result.review.copy;
    expect(copy.muted).toBeGreaterThan(0);
    expect(copy.reached + copy.muted + copy.unheard).toBe(copy.keyed);
    expect(result.review.evidence['copy.wabun']!.total).toBe(copy.reached);
    expect(result.underTx.heard).toBe(0);
    const temp = result.review.follow.facts.find((fact) => fact.fact === 'temp')!;
    expect(temp).toMatchObject({ state: 'not-reached', path: 'not-reached', first: 'muted', again: null });
    expect(result.review.evidence['follow.wabun'].paths['not-reached']).toBe(2);
    expect(result.review.evidence['follow.wabun'].total).toBe(result.review.follow.required);
  });

  it('keeps every path: logged / postcheck / repeat-recovered / missed / not-reached', () => {
    const asked = runWabunSim({ seed: 1, level: 4, interrupt: { phase: 'talk', beforeFact: 'wx', text: ({ npc, me }) => `${npc} DE ${me} WX AGN?` } });
    const wx = asked.review.follow.facts.find((fact) => fact.fact === 'wx')!;
    expect(wx).toMatchObject({ path: 'repeat-recovered', asked: 'specific', first: 'muted', again: 'reached' });
    const evidence = asked.review.evidence['follow.wabun'];
    expect(evidence.paths).toMatchObject({ logged: 4, 'repeat-recovered': 1, 'not-reached': 2, missed: 0 });
    // Recovered is a success, but not a first-time one.
    expect(evidence.correct).toBe(5);
    expect(evidence.first).toBe(4);
    expect(asked.review.follow.recovered).toBe(1);

    const truth = asked.session.truth;
    const measure = measureFollow(['name', 'qth', 'wx', 'temp'], truth, { ...blank, name: truth.name }, { name: 'first', qth: 'first', wx: 'first', temp: null } as never,
      { qth: 'ザザザ', wx: 'ザザブリ' });
    expect(measure.facts.map((fact) => fact.path)).toEqual(['logged', 'missed', 'missed', 'not-reached']);
    const postcheck = measureFollow(['qth'], truth, blank, { qth: 'first' } as never, { qth: factDisplay(truth, 'qth') });
    expect(postcheck.facts[0].path).toBe('postcheck');
  });
});

describe('wabun Stage 4: procedure apart from copy / follow', () => {
  const myName = 'イトウ';
  it('notes ホレ / ラタ left out and an over not handed back, without touching follow', () => {
    const base = runWabunSim({ seed: 3, level: 3 });
    const slips = runWabunSim({
      seed: 3, level: 3,
      overs: {
        exchange: ({ npc, me }) => `${npc} DE ${me} [ホレ] コンニチハ 」 レポート 599 599 ナマエハ ${myName} ヨロシク KN`,
        talk: ({ npc, me }) => `${npc} DE ${me} ナルホド イイデスネ`,
      },
    });
    expect(slips.phase).toBe('done');
    const kinds = slips.procedure.items.map((item) => item.kind);
    expect(kinds).toContain('no-rata');
    expect(kinds).toContain('no-hore');
    expect(kinds).toContain('no-over-end');
    expect(slips.procedure.slips).toBe(2);
    expect(base.procedure).toMatchObject({ slips: 0, items: [], corrections: 0 });
    expect(slips.review.evidence['follow.wabun']).toEqual(base.review.evidence['follow.wabun']);
  });

  it('the station asking for our report is procedure (npc-asked), not a copy miss', () => {
    const result = runWabunSim({
      seed: 5, level: 3,
      overs: { exchange: ({ npc, me, turn }) => (turn === 0 ? `${npc} DE ${me} [ホレ] コンニチハ ヨロシク [ラタ] KN` : `${npc} DE ${me} [ホレ] 599 599 デス ナマエハ ${myName} [ラタ] KN`) },
    });
    expect(result.procedure.items).toContainEqual(expect.objectContaining({ kind: 'npc-asked', facts: ['rst'] }));
    expect(result.review.follow.ok).toBe(true);
  });

  it('keying over the station is a break-in; a ラタ correction is counted, not a slip', () => {
    const early = runWabunSim({ seed: 2, level: 3, interrupt: { phase: 'talk', beforeFact: 'wx', text: ({ npc, me }) => `${npc} DE ${me} AGN?` } });
    // Keying over the talk is the slip; asking AGN? in Latin is not a reply left in Latin.
    expect(early.procedure.items.map((item) => item.kind)).toEqual(['break-in']);

    const corrected = runWabunSim({ seed: 6, level: 4, overs: { talk: ({ npc, me }) => `${npc} DE ${me} [ホレ] ナルホド コチラハ ハレ デス キオンハ 15ド {ラタ} 18ド デス [ラタ] KN` } });
    expect(corrected.procedure.corrections).toBe(1);
    expect(corrected.procedure.slips).toBe(0);
    const trace = corrected.traces.find((item) => item.corrections.length)!;
    expect(trace.corrections[0]).toMatchObject({ erased: '15ド', retyped: '18ド デス' });
    expect(trace.understood?.body).toContain('キオンハ 18ド');
  });
});

describe('wabun Stage 4: skills', () => {
  it('saves follow.wabun with its paths, copy.wabun only with a memo, procedure under the mode', () => {
    const run = runWabunSim({ seed: 1, level: 4, interrupt: { phase: 'talk', beforeFact: 'wx', text: ({ npc, me }) => `${npc} DE ${me} WX AGN?` } });
    const profile = updateWabunSkills(emptyQsoProfile(), { modeId: 'wabun-ragchew', evidence: run.review.evidence, procedure: run.procedure });
    expect(profile.skills.copy.wabun).toBeUndefined();
    expect(profile.skills.follow?.wabun).toMatchObject({ value: 1, n: 1, qsos: 1, paths: { logged: 4, 'repeat-recovered': 1, 'not-reached': 2 } });
    expect(profile.skills.follow!.wabun!.first!.value).toBeCloseTo(0.8, 3);
    expect(profile.skills.procedure['wabun-ragchew']).toBeDefined();

    const memo = runWabunSim({ seed: 1, level: 3, memo: 'full' });
    const again = updateWabunSkills(profile, { modeId: 'wabun-ragchew', evidence: memo.review.evidence, procedure: memo.procedure });
    expect(again.skills.copy.wabun?.n).toBeGreaterThan(0);
    expect(again.skills.follow!.wabun!.qsos).toBe(2);
    expect(again.skills.follow!.wabun!.paths.logged).toBe(4 + memo.review.evidence['follow.wabun'].paths.logged);
  });

  it('a QSO where nothing reached us adds to the paths but leaves the estimates', () => {
    const prior = updateFollow(undefined, { total: 4, correct: 3, first: 3, paths: { logged: 3, postcheck: 0, 'repeat-recovered': 0, missed: 1, 'not-reached': 0 } });
    const next = updateFollow(prior, { total: 0, correct: 0, first: 0, paths: { logged: 0, postcheck: 0, 'repeat-recovered': 0, missed: 0, 'not-reached': 3 } });
    expect(next).toMatchObject({ value: prior.value, n: prior.n, qsos: 2, paths: { 'not-reached': 3, missed: 1 } });
  });
});

describe('wabun Stage 4: the Lv4 long over', () => {
  it('splits the news into the closing only when the talk would run long, and the QSO still ends', () => {
    let split = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const result = runWabunSim({ seed, level: 4 });
      expect(result.phase).toBe('done');
      const dialogue = result.session.dialogue;
      const talk = dialogue.overs.find((over) => over.plan.kind === 'talk')!;
      const closing = dialogue.overs.find((over) => over.plan.kind === 'closing')!;
      expect(keySegments(talk.text, { wpm: result.session.scenario.persona.wpm }).length).toBeLessThanOrEqual(TALK_SPLIT_SECONDS + 12);
      const topicIn = dialogue.newsInClosing ? closing : talk;
      expect(topicIn.facts.map((fact) => fact.fact)).toContain('topic');
      expect(result.review.follow.facts.find((fact) => fact.fact === 'topic')?.state).not.toBe('not-reached');
      if (dialogue.newsInClosing) split += 1;
    }
    expect(split).toBeGreaterThan(0);
    expect(split).toBeLessThan(8);
  });
});

describe('wabun Stage 4: the call in our macros', () => {
  it('comes from what we logged or sent, never from the truth', () => {
    expect(operatorCall('ja7lbt', [])).toBe('JA7LBT');
    expect(operatorCall('', ['JA7LBT DE JA1ZZZ K', 'CQ'])).toBe('JA7LBT');
    expect(operatorCall('', ['JA7LBT DE JA1ZZZ K', 'JH1ABC DE JA1ZZZ AGN?'])).toBe('JH1ABC');
    expect(operatorCall('', ['QRL? DE JA1ZZZ'])).toBe('');
    expect(operatorCall('', [])).toBe('');
  });
});

describe('wabun Stage 5: the CQ station listens while we call', () => {
  const starts = (result: ReturnType<typeof runWabunSim>) => result.records.filter((record) => record.station === result.session.target.id).map((record) => record.tx.start);
  it('does not start another CQ over our call (its loop waits until we stand by)', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      // A slow call (8 WPM: longer than the 3–6 s between CQs).
      const result = runWabunSim({ seed, myWpm: 8 });
      expect(result.phase).toBe('done');
      const call = result.tx[0];
      expect(starts(result).filter((start) => start > call.start && start < call.end), `seed ${seed}`).toEqual([]);
    }
  });

  it('a CQ already on the air goes on under an early call (that doubling stays)', () => {
    const result = runWabunSim({ seed: 2, callEarly: true });
    const call = result.tx[0];
    const cq = result.records.find((record) => record.tx.start < call.start && record.tx.start + record.tx.length > call.start)!;
    expect(cq).toBeDefined();
    expect(result.procedure.items.map((item) => item.kind)).toContain('break-in');
  });
});
