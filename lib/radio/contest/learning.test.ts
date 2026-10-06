import { describe, expect, it } from 'vitest';
import { nowId } from '../../ids';
import type { QsoProfile } from '../../types';
import { badgeTier, badgeById, recordRunOutcome } from '../badges';
import { AXES, DEFAULT_DIFFICULTY, adjustDifficulty, normalizeDifficulty, type AdjustState, type Axis, type AxisVotes } from '../difficulty';
import { isContestTrace, type AnyRunTrace } from '../runTrace';
import { runContestSim } from '../sim/contestSim';
import { emptyQsoProfile, updateSkills } from '../skills';
import type { ContestAnalysis } from './analysis';
import { analyse, type Spec } from './fixtures.testkit';
import { CONTEST_ADAPT_AXES, analysisSummary, contestOutcome, updateContestSkills, voteContestAxes, type ContestOutcome } from './learning';
import { contestLevel, contestParamsOf } from './levels';
import { contestSave, reanalyse } from './save';

/**
 * Stage 4: the learning system's side of a contest. おまかせ moves only the axis a cause
 * speaks for; skills take only their own numbers; badges count only what the log check
 * passed; a stored run gives the same answer again.
 */

const CALLS = ['JA1AAA', 'JA2BBB', 'JA3CCC', 'JA4DDD', 'JA5EEE'];
/** The same call one character off, nowhere near the others. */
const off = (call: string) => `${call.slice(0, -1)}${call.endsWith('Q') ? 'X' : 'Q'}`;
const five = (spec: (call: string) => Spec) => CALLS.map(spec);

/** One kind of run per cause: five contacts that went wrong the same way. */
const RUNS: Record<string, Spec[]> = {
  // First calls wrong in the clear, put right before the line.
  reception: five((call) => ({ call, sent: [off(call), call] })),
  // Calls lost while the stations were weak.
  weak: five((call) => ({ call, sent: [`${call.slice(0, 3)}XYZ`], firstSituation: 'weak', line: { call: `${call.slice(0, 3)}XYZ`, verdict: 'bust-call', callSituation: 'weak' } })),
  // Calls in the clear fine; with another caller keying at once, wrong.
  overlap: [
    ...five((call) => ({ call })),
    ...five((call) => ({ call: call.replace('JA', 'JH'), sent: [off(call.replace('JA', 'JH')), call.replace('JA', 'JH')], firstSituation: 'overlap', air: [{ call: 'W5XYZ', at: -1 }] })),
  ],
  // Look-alikes on the frequency taken for the station.
  similar: five((call) => ({ call, sent: [off(call)], line: { call: off(call), verdict: 'bust-call' }, air: [{ call: off(call), at: -1 }] })),
  // Calls fine, serials wrong in the clear.
  serial: five((call) => ({ call, line: { nr: '128', verdict: 'bust-nr' } })),
  // The band: QSB on every call.
  environment: five((call) => ({ call, sent: [off(call)], firstSituation: 'qsb', line: { call: off(call), verdict: 'bust-call', callSituation: 'qsb' } })),
  // Not the ear at all.
  procedure: five((call) => ({ call, line: { nr: '', verdict: 'bust-nr' } })),
  logging: five((call) => ({ call, line: { call: off(call), verdict: 'bust-call' } })),
  dupe: five((call) => ({ call, line: { verdict: 'dupe' } })),
  dropped: five((call) => ({ call, line: null, theirOnly: 'dropped', serialHeard: 'weak' })),
  doubling: five((call) => ({ call, line: null, exchanged: false, firstSituation: 'doubled', doublings: 2 })),
  interference: five((call) => ({
    call, keyed: '123', line: { nr: '456', verdict: 'bust-nr' },
    desk: [{ at: 3, end: 5, kind: 'exchange', subject: call }], air: [{ call: 'W5XYZ', at: 4, text: 'W5XYZ 456' }],
  })),
};

/** The axis a cause may make easier (none: it isn't the ear's). */
const EASIER: Record<string, Axis[]> = {
  reception: ['speed'], weak: ['weak'], overlap: ['density'], similar: ['similar'], serial: ['serial'],
  environment: [], procedure: [], logging: [], dupe: [], dropped: [], doubling: [], interference: [],
};

const easier = (votes: AxisVotes) => (Object.entries(votes) as [Axis, number][]).filter(([, vote]) => vote < 0).map(([axis]) => axis).sort();
/** As the desk does it: the user's pins, and every axis outside the contest's おまかせ. */
const PINNED = AXES.filter((axis) => !(CONTEST_ADAPT_AXES as readonly Axis[]).includes(axis));
const START = normalizeDifficulty({ ...contestLevel('intermediate').axes });

function series(runs: readonly ContestAnalysis[], state: AdjustState = { difficulty: START, votes: {} }) {
  const moves: Partial<Record<Axis, number>>[] = [];
  for (const analysis of runs) {
    const next = adjustDifficulty(state, analysis.evidence, PINNED, voteContestAxes(analysis));
    moves.push(next.moved);
    state = next;
  }
  return { state, moves };
}

describe('contest おまかせ: each cause moves only its own axis', () => {
  it.each(Object.keys(RUNS))('%s', (cause) => {
    const analysis = analyse(RUNS[cause]);
    // The fixture is the cause it says (doubling also counts the doublings themselves).
    const primary = Object.entries(analysis.causes).sort((a, b) => b[1] - a[1])[0][0];
    expect(primary).toBe(cause === 'reception' || cause === 'serial' ? 'reception' : cause);
    const votes = voteContestAxes(analysis);
    expect(easier(votes)).toEqual(EASIER[cause]);
    expect(Object.keys(votes).every((axis) => (CONTEST_ADAPT_AXES as readonly string[]).includes(axis))).toBe(true);

    // One run moves nothing; the same again moves the related axis only, one step.
    const { state, moves } = series([analysis, analysis]);
    expect(moves[0]).toEqual({});
    const eased = (Object.entries(moves[1]) as [Axis, number][]).filter(([axis]) => votes[axis] === -1).map(([axis]) => axis).sort();
    expect(eased).toEqual(EASIER[cause]);
    for (const axis of Object.keys(moves[1]) as Axis[]) expect(votes[axis], axis).toBeDefined();
    for (const axis of PINNED) expect(state.difficulty[axis], axis).toBe(START[axis]);
  });

  it('procedure, logging, DUPE, dropped, doubling and lids never make anything easier, together or apart', () => {
    const mixed = analyse([...RUNS.procedure, ...RUNS.logging.map((spec) => ({ ...spec, call: spec.call.replace('JA', 'JE') })), ...RUNS.dupe.map((spec) => ({ ...spec, call: spec.call.replace('JA', 'JF') }))]);
    expect(easier(voteContestAxes(mixed))).toEqual([]);
    const { state } = series([mixed, mixed, mixed, mixed]);
    for (const axis of AXES) expect(state.difficulty[axis] >= START[axis] || axis === 'weak', axis).toBe(true);
  });

  it('a single bad run is not enough; a good one in between wipes its vote', () => {
    const bad = analyse(RUNS.reception);
    const good = analyse(five((call) => ({ call })));
    expect(voteContestAxes(bad).speed).toBe(-1);
    expect(voteContestAxes(good).speed).toBe(1);
    const { moves, state } = series([bad, good, bad, good]);
    expect(moves.every((moved) => moved.speed === undefined)).toBe(true);
    expect(state.difficulty.speed).toBe(START.speed);
  });

  it('runs going well raise the level step by step, one step per two runs', () => {
    const good = analyse([...five((call) => ({ call })), ...five((call) => ({ call: call.replace('JA', 'JH'), air: [{ call: 'W5XYZ', at: -1 }] }))]);
    const votes = voteContestAxes(good);
    expect(votes).toMatchObject({ speed: 1, density: 1, serial: 1 });
    const { state, moves } = series([good, good, good, good]);
    expect(moves[0]).toEqual({});
    // At most two axes a run, and no axis twice in a row: each step takes two runs of its own.
    for (const moved of moves) expect(Object.keys(moved).length).toBeLessThanOrEqual(2);
    for (let index = 1; index < moves.length; index += 1) {
      for (const axis of Object.keys(moves[index])) expect(moves[index - 1][axis as Axis], axis).toBeUndefined();
    }
    expect(state.difficulty.speed).toBeGreaterThan(START.speed);
    for (const axis of PINNED) expect(state.difficulty[axis], axis).toBe(START[axis]);
  });

  it('a pinned axis stays put whatever the votes', () => {
    const analysis = analyse(RUNS.reception);
    const { state } = (() => {
      let current: AdjustState = { difficulty: START, votes: {} };
      for (let index = 0; index < 4; index += 1) current = adjustDifficulty(current, analysis.evidence, [...PINNED, 'speed'], voteContestAxes(analysis));
      return { state: current };
    })();
    expect(state.difficulty.speed).toBe(START.speed);
  });
});

describe('contest おまかせ: headless run series', () => {
  // Ten-minute runs through the desk's ESM, chained as the desk chains them.
  const reports = [1, 2, 3, 4].map((seed) => runContestSim({ seed, level: 'intermediate', bot: 'novice', duration: 600, esm: true }));

  it('only the contest axes ever move, each with its own runs\' votes behind it', () => {
    let state: AdjustState = { difficulty: START, votes: {} };
    for (const report of reports) {
      const { analysis } = report.judged;
      const votes = voteContestAxes(analysis);
      const next = adjustDifficulty(state, analysis.evidence, PINNED, votes);
      for (const [axis, delta] of Object.entries(next.moved) as [Axis, number][]) {
        expect((CONTEST_ADAPT_AXES as readonly Axis[]).includes(axis), axis).toBe(true);
        // It moved the way this run and the one before voted (votes carry in one direction only).
        expect(votes[axis], axis).toBeDefined();
        expect(Math.sign(state.votes[axis] ?? 0), axis).toBe(votes[axis]);
        expect(delta).not.toBe(0);
      }
      state = next;
    }
    for (const axis of PINNED) expect(state.difficulty[axis], axis).toBe(START[axis]);
  });

  it('look-alikes everywhere: the similar axis eases, nothing else does', () => {
    // The bot's ear is strong in poor RF (known, see /dev): look-alikes are what trips it.
    const runs = [1, 2, 4].map((seed) => runContestSim({ seed, level: 'intermediate', axes: { similar: 1 }, bot: 'novice', duration: 600, esm: true }).judged.analysis);
    for (const analysis of runs) {
      expect(voteContestAxes(analysis).similar).toBe(-1);
      expect(easier(voteContestAxes(analysis))).toEqual(['similar']);
    }
    const start = normalizeDifficulty({ ...contestLevel('intermediate').axes, similar: 1 });
    const { state, moves } = series(runs, { difficulty: start, votes: {} });
    expect(moves[0]).toEqual({});
    expect(moves[1].similar).toBeLessThan(0);
    expect(state.difficulty.similar).toBeLessThan(start.similar);
    for (const axis of ['weak', 'density', 'serial', 'speed'] as const) expect(state.difficulty[axis], axis).toBeGreaterThanOrEqual(start[axis]);
    for (const axis of PINNED) expect(state.difficulty[axis], axis).toBe(start[axis]);
  });

  it('every failure has one cause, and dropped / unmatched are never reception', () => {
    for (const report of reports) {
      const { analysis, review } = report.judged;
      expect(Object.values(analysis.causes).reduce((a, b) => a + (b ?? 0), 0)).toBe(analysis.mistakes.length);
      for (const mistake of analysis.mistakes) {
        if (mistake.failure === 'dropped') expect(mistake.cause).toBe('dropped');
        if (mistake.failure === 'unmatched') expect(mistake.cause).toBe('procedure');
        expect(mistake.aux).not.toContain(mistake.cause);
      }
      expect(analysis.failures.dropped ?? 0).toBe(review.theirOnly.filter((line) => line.kind === 'dropped').length);
      // Blamed fields are out of the copy evidence: what is left is the ear's.
      for (const [id, blame] of Object.entries(analysis.blamed)) {
        for (const cause of Object.values(blame)) expect(['similar', 'interference', 'procedure', 'logging', 'dupe', 'dropped'], id).toContain(cause);
      }
      expect(analysis.evidence.tx).toEqual({ total: 0, onFrequency: 0 });
    }
  });
});

describe('contest skills', () => {
  const learn = (cause: string, profile: QsoProfile = emptyQsoProfile()) => {
    const analysis = analyse(RUNS[cause]);
    const shared = updateSkills(profile, { modeId: 'contest', alphabet: 'international', wpm: 26, evidence: analysis.evidence });
    return updateContestSkills(shared, analysis);
  };

  it('procedure slips lower procedure only, never copy, a character or the callsign skill', () => {
    const profile = learn('procedure');
    expect(profile.skills.contest!.procedure!.value).toBeLessThan(0.5);
    expect(profile.skills.procedure.contest.value).toBeLessThan(0.5);
    expect(profile.skills.contest!.call!.value).toBe(1);
    expect(profile.skills.copy.international!.value).toBe(1);
    expect(profile.skills.tuning).toBeUndefined();
  });

  it('logging slips lower logging only', () => {
    const profile = learn('logging');
    expect(profile.skills.contest!.logging!.value).toBeLessThan(0.5);
    expect(profile.skills.contest!.call!.value).toBe(1);
    expect(profile.skills.copy.international!.value).toBe(1);
    expect(profile.skills.callsign?.log.clean).toBeUndefined();
  });

  it('weak signals go to robustness, not to copy in the clear or the callsign skill', () => {
    const profile = learn('weak');
    expect(profile.skills.robustness.weak!.value).toBeLessThan(0.7);
    // The serials were copied in the clear: copy holds.
    expect(profile.skills.copy.international!.value).toBe(1);
    expect(profile.skills.callsign?.log.situations.weak).toBeUndefined();
    expect(profile.skills.contest!.call).toBeUndefined();
  });

  it('look-alikes go to the similar skill; the call is not a copy miss', () => {
    const profile = learn('similar');
    expect(profile.skills.contest!.similar).toEqual({ value: expect.any(Number), n: 1 });
    expect(profile.skills.contest!.similar!.value).toBeLessThan(0.5);
    expect(profile.skills.contest!.call).toBeUndefined();
    expect(profile.skills.callsign?.first.clean).toBeUndefined();
  });

  it('the crowd and the serial each have their own skill', () => {
    const overlap = learn('overlap');
    expect(overlap.skills.contest!.overlap!.value).toBeLessThan(0.5);
    expect(overlap.skills.contest!.call!.value).toBe(1);
    const serial = learn('serial');
    expect(serial.skills.contest!.serial!.value).toBeLessThan(0.5);
    expect(serial.skills.contest!.call!.value).toBe(1);
  });

  it('doublings go to timing', () => {
    expect(learn('doubling').skills.contest!.timing!.value).toBeLessThan(0.5);
  });
});

describe('contest badges', () => {
  const outcome = (change: Partial<ContestOutcome>): ContestOutcome => ({ qsos: 12, streak: 12, rate: 72, seconds: 600, lines: 12, faults: 0, ...change });
  const fold = (profile: QsoProfile, change: Partial<ContestOutcome>) =>
    recordRunOutcome(profile, { contacts: [], alphabet: 'international', at: 1, seconds: change.seconds ?? 600, frequencyChecks: 0, busyAvoided: 0, cleanContacts: 0, cleanRate: 0, contest: outcome(change) });

  it('a clean ten-minute run: first QSO, streak, rate and clean run', () => {
    const { qso, earned } = fold(emptyQsoProfile(), {});
    expect(earned.map((item) => item.id).sort()).toEqual(['contest', 'contest-clean', 'contest-rate', 'contest-streak']);
    expect(badgeTier(badgeById('contest-rate')!, qso)).toBe(2);
    expect(qso.stats!.contest).toEqual({ qsos: 12, bestStreak: 12, bestRate: 72, cleanRuns: 1 });
  });

  it('a short run counts its QSOs and streak, but neither rate nor a clean run (no sprinting for badges)', () => {
    const { qso } = fold(emptyQsoProfile(), { seconds: 120, lines: 12, rate: 360 });
    expect(qso.stats!.contest).toEqual({ qsos: 12, bestStreak: 12, bestRate: 0, cleanRuns: 0 });
    const few = fold(emptyQsoProfile(), { lines: 3, qsos: 3, streak: 3, rate: 18 }).qso;
    expect(few.stats!.contest!.cleanRuns).toBe(0);
  });

  it('a BUST, NIL or dropped contact means no clean run; QSOs count only lines that passed', () => {
    const { qso } = fold(emptyQsoProfile(), { faults: 1, qsos: 11, streak: 6 });
    expect(qso.stats!.contest).toMatchObject({ qsos: 11, bestStreak: 6, cleanRuns: 0 });
  });

  it('the outcome comes from the review: faults are BUSTs, NILs and dropped contacts', () => {
    const report = runContestSim({ seed: 2, level: 'intermediate', bot: 'average', duration: 600, esm: true });
    const { review, analysis } = report.judged;
    const result = contestOutcome(review, analysis);
    const dropped = review.theirOnly.filter((line) => line.kind === 'dropped').length;
    expect(result).toMatchObject({ qsos: review.counts.ok, lines: review.lines.length, streak: analysis.streak });
    expect(result.faults).toBe(review.counts['bust-call'] + review.counts['bust-nr'] + review.counts.nil + dropped);
    expect(result.streak).toBeLessThanOrEqual(result.qsos);
  });
});

describe('contest save: the learning results after a reload', () => {
  const report = runContestSim({ seed: 5, level: 'intermediate', bot: 'novice', duration: 600, esm: true });
  const axes = contestLevel('intermediate').axes;
  const saved = contestSave({
    id: nowId(), startedAt: 1_700_000_000_000, endedAt: 1_700_000_600_000, level: 'intermediate', wpm: 26, minutes: 10,
    axes, params: contestParamsOf(axes), result: report.result, sent: report.sent,
    judged: { scored: report.judged.scored, air: report.judged.air, analysis: report.judged.analysis }, wpmOf: {},
  });

  it('the stored run gives the same causes, votes and summary as at QRT', () => {
    expect(saved.analysis).toEqual(report.judged.analysis);
    const reloaded = JSON.parse(JSON.stringify(saved.trace)) as AnyRunTrace;
    expect(isContestTrace(reloaded)).toBe(true);
    if (!isContestTrace(reloaded)) return;
    const again = reanalyse(reloaded);
    expect(again).toEqual(saved.analysis);
    expect(voteContestAxes(again!)).toEqual(voteContestAxes(saved.analysis));
    expect(saved.summary.contest!.analysis).toEqual(analysisSummary(saved.analysis));
    expect(reloaded.evidence).toEqual(saved.analysis.evidence);
  });

  it('answers: blamed fields carry their blame, nothing else does', () => {
    for (const answer of saved.answers) {
      const contactId = Object.keys(saved.analysis.blamed).find((id) => answer.id.includes(`-${id}-`));
      const blame = contactId ? saved.analysis.blamed[contactId][answer.qso!.field as 'call' | 'nr'] : undefined;
      if (blame) expect(answer.qso!.blame).toBe(blame);
      else if (answer.qso!.blame) expect(answer.qso!.blame).toBe('cut-number');
    }
  });

  it('a run stored before Stage 4 shows its review and no causes', () => {
    const old = JSON.parse(JSON.stringify(saved.trace)) as AnyRunTrace;
    if (!isContestTrace(old)) throw new Error('not a contest');
    delete old.contest.scored;
    delete old.contest.air;
    delete old.contest.analysisVersion;
    expect(reanalyse(old)).toBeNull();
  });

  it('DEFAULT_DIFFICULTY is untouched by Stage 4 (the levels\' numbers wait for Stage 5)', () => {
    expect(DEFAULT_DIFFICULTY.density).toBe(4);
    expect(DEFAULT_DIFFICULTY.serial).toBe(0.5);
  });
});
