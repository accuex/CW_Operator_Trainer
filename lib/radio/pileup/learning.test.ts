import { describe, expect, it } from 'vitest';
import type { AnswerLog, PileupCause, SessionRecord } from '../../types';
import { forWeakAnalysis, isCleanCopy, pileupBreakdown } from '../../analytics';
import { emptyPileupStats, recordRunOutcome } from '../badges';
import { adjustDifficulty, AXES, DEFAULT_DIFFICULTY, type Axis, type AxisVotes } from '../difficulty';
import { emptyQsoProfile } from '../skills';
import type { PileupAnalysis } from './analysis';
import { PILEUP_ADAPT_AXES, updatePileupSkills, votePileupAxes, type PileupOutcome } from './learning';

/** A judged run with nothing in it but what a test sets. */
function analysis(change: { summary?: Partial<PileupAnalysis['summary']>; copy?: PileupAnalysis['copy']; weak?: { total: number; correct: number } } = {}): PileupAnalysis {
  return {
    summary: {
      picks: 10, doubledPicks: 0, partials: 0, emptyPartials: 0, crowdedPartials: 0, narrowings: 0, narrowed: 0,
      firstCall: {}, similarMet: 0, similarRight: 0, hijacks: 0, eager: 0, lid: 0, causes: {}, cleanRate: 0,
      ...change.summary,
    },
    copy: change.copy ?? { total: 0, correct: 0 },
    logging: { total: 10, correct: 10 },
    mistakes: [],
    blamed: {},
    evidence: {
      clean: { total: 0, correct: 0 }, env: change.weak ? { weak: change.weak } : {}, overlap: { total: 0, correct: 0 }, doubled: { total: 0, correct: 0 },
      causes: { copy: 0, environment: 0, overlap: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 }, tx: { total: 0, onFrequency: 0 }, calls: { log: {}, first: {} },
    },
  };
}
const causes = (counts: Partial<Record<PileupCause, number>>) => ({ causes: counts });

describe('pileup おまかせ: each cause moves only its own axis', () => {
  it('pure copy → speed', () => {
    expect(votePileupAxes(analysis({ copy: { total: 10, correct: 10 } }))).toEqual({ speed: 1 });
    expect(votePileupAxes(analysis({ copy: { total: 10, correct: 5 } }))).toEqual({ speed: -1 });
    expect(votePileupAxes(analysis({ copy: { total: 3, correct: 0 } }))).toEqual({});
  });

  it('first calls lost out of a crowd while copy holds → pile, not speed', () => {
    const run = analysis({ copy: { total: 10, correct: 8 }, summary: { firstCall: { '1': { total: 8, correct: 8 }, '3+': { total: 6, correct: 2 } } } });
    expect(votePileupAxes(run)).toEqual({ pile: -1 });
    // Poor copy as well: the crowd isn't to blame.
    expect(votePileupAxes(analysis({ copy: { total: 10, correct: 5 }, summary: { firstCall: { '3+': { total: 6, correct: 2 } } } }))).toEqual({ speed: -1 });
  });

  it('look-alikes mixed up → similar', () => {
    expect(votePileupAxes(analysis({ summary: { ...causes({ similar: 2 }), similarMet: 4, similarRight: 2 } }))).toEqual({ similar: -1 });
    expect(votePileupAxes(analysis({ summary: { similarMet: 3, similarRight: 3 } }))).toEqual({ similar: 1 });
  });

  it('weak signals lost while copy in the clear holds → weak', () => {
    const run = analysis({ copy: { total: 10, correct: 8 }, weak: { total: 20, correct: 8 } });
    expect(votePileupAxes(run)).toEqual({ weak: -1 });
    expect(votePileupAxes(analysis({ summary: causes({ weak: 2 }) }))).toEqual({ weak: -1 });
  });

  it('partials that fit several, or narrowing that misses → stack (how close they call)', () => {
    expect(votePileupAxes(analysis({ summary: { partials: 6, crowdedPartials: 4 } }))).toEqual({ stack: -1 });
    expect(votePileupAxes(analysis({ summary: { partials: 6, narrowings: 4, narrowed: 1 } }))).toEqual({ stack: -1 });
    expect(votePileupAxes(analysis({ summary: { partials: 6, narrowings: 4, narrowed: 4 } }))).toEqual({ stack: 1 });
  });

  it('doublings, procedure, the log and eager / lid interference vote nothing', () => {
    expect(votePileupAxes(analysis({ summary: { doubledPicks: 8, ...causes({ doubling: 8 }) } }))).toEqual({});
    expect(votePileupAxes(analysis({ summary: { eager: 12, lid: 30, ...causes({ interference: 6 }) } }))).toEqual({});
    expect(votePileupAxes(analysis({ summary: causes({ procedure: 5, logging: 5 }) }))).toEqual({});
  });

  it('only the pileup axes ever move, whatever is voted', () => {
    const everything = Object.fromEntries(AXES.map((axis) => [axis, -1])) as AxisVotes;
    const pinned = AXES.filter((axis) => !(PILEUP_ADAPT_AXES as readonly Axis[]).includes(axis));
    let state = { difficulty: { ...DEFAULT_DIFFICULTY }, votes: {} as Record<string, number> };
    for (let run = 0; run < 6; run += 1) {
      const next = adjustDifficulty(state, analysis().evidence, pinned, everything);
      for (const axis of Object.keys(next.moved)) expect(PILEUP_ADAPT_AXES).toContain(axis);
      state = next;
    }
    for (const axis of pinned) expect(state.difficulty[axis]).toBe(DEFAULT_DIFFICULTY[axis]);
  });
});

describe('pileup skills', () => {
  it('a doubling lowers timing only; a look-alike lowers similar only', () => {
    const base = updatePileupSkills(emptyQsoProfile(), analysis({ copy: { total: 6, correct: 6 }, summary: { similarMet: 4, similarRight: 4 } }));
    const doubled = updatePileupSkills(base, analysis({ summary: { picks: 10, doubledPicks: 6 } }));
    expect(doubled.skills.pileup!.timing!.value).toBeLessThan(base.skills.pileup!.timing!.value);
    expect(doubled.skills.pileup!.copy).toEqual(base.skills.pileup!.copy);
    expect(doubled.skills.pileup!.similar).toEqual(base.skills.pileup!.similar);
    const mixed = updatePileupSkills(base, analysis({ summary: { similarMet: 4, similarRight: 1 } }));
    expect(mixed.skills.pileup!.similar!.value).toBeLessThan(base.skills.pileup!.similar!.value);
    expect(mixed.skills.pileup!.copy).toEqual(base.skills.pileup!.copy);
    expect(mixed.skills.pileup!.timing!.value).toBe(base.skills.pileup!.timing!.value);
  });
});

describe('pileup badges', () => {
  const outcome = (change: Partial<PileupOutcome> = {}): PileupOutcome => ({ contacts: 8, narrowed: 3, similar: 1, seconds: 420, picks: 9, doubledPicks: 0, cleanRate: 70, ...change });
  const run = (pileup: PileupOutcome) => ({ contacts: [], alphabet: 'international' as const, at: 1, seconds: pileup.seconds, frequencyChecks: 0, busyAvoided: 0, cleanContacts: 0, cleanRate: pileup.cleanRate, pileup });

  it("count on their own counters and leave the CQ run's rate and frequency checks alone", () => {
    const { qso, earned } = recordRunOutcome(emptyQsoProfile(), run(outcome()));
    expect(qso.stats!.bestRate ?? 0).toBe(0);
    expect(qso.stats!.frequencyChecks ?? 0).toBe(0);
    expect(qso.stats!.pileup).toEqual({ ...emptyPileupStats(), contacts: 8, narrowed: 3, similar: 1, calmRuns: 1, bestRate: 70 });
    expect(earned.map((badge) => badge.id)).toEqual(expect.arrayContaining(['pileup', 'pileup-partial', 'pileup-calm', 'pileup-rate']));
  });

  it('short runs and doubled runs earn no calm run and no rate', () => {
    expect(recordRunOutcome(emptyQsoProfile(), run(outcome({ seconds: 200 }))).qso.stats!.pileup).toMatchObject({ calmRuns: 0, bestRate: 0, contacts: 8 });
    expect(recordRunOutcome(emptyQsoProfile(), run(outcome({ doubledPicks: 3 }))).qso.stats!.pileup).toMatchObject({ calmRuns: 0, bestRate: 70 });
  });
});

describe('weak-pair analysis leaves out what was not our copy', () => {
  const answer = (qso: Partial<NonNullable<AnswerLog['qso']>>): AnswerLog => ({
    id: String(Math.random()), timestamp: 0, alphabetType: 'international', correctSymbol: 'B', inputSymbol: 'D', characterSpeed: 20, effectiveSpeed: 20,
    queueTarget: 0, actualQueueDepth: 0, stimulusTime: 0, inputTime: 0, responseLatency: Number.NaN, mode: 'qso', isCorrect: false, isEarly: false, sessionId: 's',
    qso: { modeId: 'pileup', presetId: 'pileup-rst', field: 'call', condition: 'clean', situation: 'clean', cause: 'copy', env: { snr: 20, qrm: 0, qsb: 0, qrn: 0, offset: 0 }, ...qso },
  });

  it('a look-alike, a lid or an overlap is never a clean miss', () => {
    expect(isCleanCopy(answer({}))).toBe(true);
    expect(isCleanCopy(answer({ blame: 'similar' }))).toBe(false);
    expect(isCleanCopy(answer({ blame: 'interference' }))).toBe(false);
    expect(isCleanCopy(answer({ env: { snr: 20, qrm: 0, qsb: 0, qrn: 0, offset: 0, overlap: 1 } as never }))).toBe(false);
    expect(isCleanCopy(answer({ condition: 'muted', situation: 'doubled', cause: 'doubling' }))).toBe(false);
  });

  it('including bad conditions still keeps blamed misses out', () => {
    const logs = [answer({}), answer({ condition: 'weak', situation: 'weak' }), answer({ blame: 'similar' })];
    expect(forWeakAnalysis(logs)).toHaveLength(1);
    expect(forWeakAnalysis(logs, true)).toHaveLength(2);
  });
});

describe('pileup analysis across runs (synced summaries only)', () => {
  const session = (pileup: Partial<NonNullable<NonNullable<SessionRecord['qso']>['pileup']>>): Pick<SessionRecord, 'qso'> => ({
    qso: { pileup: { level: 'intermediate', ...analysis().summary, ...pileup } } as SessionRecord['qso'],
  });

  it('finds "weak with 3+ answering", look-alike mix-ups and frequent doublings', () => {
    const runs = [1, 2, 3].map(() => session({
      picks: 6, doubledPicks: 2, similarMet: 3, similarRight: 1, causes: { similar: 2, doubling: 2 },
      firstCall: { '1': { total: 4, correct: 4 }, '3+': { total: 4, correct: 1 } },
    }));
    const found = pileupBreakdown(runs)!;
    expect(found.firstCall['3+']).toEqual({ total: 12, correct: 3 });
    expect(found.findings).toEqual(expect.arrayContaining(['crowd-weak', 'similar-mixups', 'doubling-often']));
    expect(pileupBreakdown([session({ firstCall: { '1': { total: 10, correct: 9 }, '3+': { total: 10, correct: 8 } } })])!.findings).toEqual([]);
    expect(pileupBreakdown([{ qso: undefined }])).toBeNull();
  });
});
