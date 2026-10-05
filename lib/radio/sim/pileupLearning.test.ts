import { describe, expect, it } from 'vitest';
import { forWeakAnalysis, isCleanCopy } from '../../analytics';
import { BADGES, emptyPileupStats, recordRunOutcome } from '../badges';
import { adjustDifficulty, AXES, normalizeDifficulty, type Axis } from '../difficulty';
import { pileupLevel } from '../modes/pileupLevels';
import { PILEUP_ADAPT_AXES, pileupContacts, pileupOutcome, pileupSummary, updatePileupSkills, votePileupAxes } from '../pileup/learning';
import { pickGroups, reviewStats } from '../pileup/review';
import { pileupAnswers, pileupTraceDetail, PILEUP_MODE_ID, reanalyse } from '../pileup/save';
import { PILEUP_RST } from '../exchange';
import { RUN_TRACE_VERSION, isPileupTrace, type AnyRunTrace, type PileupTrace } from '../runTrace';
import { emptyQsoProfile, updateSkills } from '../skills';
import { PILEUP_BAND, runPileupSim, type PileupSimOptions, type PileupSimReport } from './pileupSim';

/**
 * A pileup run through the learning system, headless, under six kinds of pile: what
 * gets stored and synced, how each miss is classed, and what おまかせ does with it.
 */

const CONDITIONS: Record<string, Omit<PileupSimOptions, 'seed'>> = {
  normal: { level: 'intermediate', bot: 'average' },
  crowded: { level: 'intermediate', bot: 'average', axes: { pile: 14, timing: 1, stack: 30 } },
  'poor RF': { level: 'intermediate', bot: 'average', axes: { weak: 0.75 }, band: { ...PILEUP_BAND, noise: 0.7 } },
  'similar-heavy': { level: 'intermediate', bot: 'average', axes: { similar: 0.4 } },
  'timing-poor': { level: 'intermediate', bot: 'timing-poor' },
  'lid / eager-heavy': { level: 'intermediate', bot: 'average', axes: { manners: 1 } },
};
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const DURATION = 600;

const cache = new Map<string, PileupSimReport[]>();
const runs = (name: string) => {
  if (!cache.has(name)) cache.set(name, SEEDS.map((seed) => runPileupSim({ ...CONDITIONS[name], seed, duration: DURATION })));
  return cache.get(name)!;
};
const all = () => Object.keys(CONDITIONS).flatMap((name) => runs(name).map((report) => ({ name, report })));

const wpmOf = (report: PileupSimReport) => (id: number) => report.run.agents.find((agent) => agent.id === id)?.station.wpm ?? 20;
const answersOf = (report: PileupSimReport, sessionId = 's') => pileupAnswers(report.result, report.score, report.analysis, { sessionId, timestamp: 1, wpmOf: wpmOf(report) });

/** What the desk stores on this device at QRT. */
function traceOf(report: PileupSimReport, level = 'intermediate'): PileupTrace {
  const { result, steps, score, analysis } = report;
  return {
    kind: 'run', version: RUN_TRACE_VERSION, id: 't', startedAt: 0, endedAt: 1, modeId: PILEUP_MODE_ID, presetId: PILEUP_RST.id,
    difficulty: { ...pileupLevel('intermediate').axes }, params: { ...report.run.params }, result, scored: score.contacts, evidence: analysis.evidence,
    rx: {}, tx: [], filter: 500, wpmOf: {}, adjusted: {}, earned: [], pileup: pileupTraceDetail(level, 24, steps, analysis),
  };
}

describe('pileup learning under six kinds of pile', () => {
  it('every condition plays out and gets judged', () => {
    for (const { name, report } of all()) expect(report.breaches, name).toEqual([]);
    for (const name of Object.keys(CONDITIONS)) expect(runs(name).reduce((sum, report) => sum + report.analysis.summary.picks, 0), name).toBeGreaterThan(SEEDS.length);
  }, 120_000);

  it('bad-condition and overlapped characters stay out of the normal (weak-pair) stats', () => {
    let hidden = 0;
    for (const { name, report } of all()) {
      const answers = answersOf(report);
      const kept = forWeakAnalysis(answers);
      for (const answer of kept) {
        expect(answer.qso!.condition, name).toBe('clean');
        expect(answer.qso!.blame, name).toBeUndefined();
        expect(answer.qso!.env.overlap, name).toBeUndefined();
      }
      hidden += answers.length - kept.length;
      // Weak characters of a poor-RF run are kept on record but never in the normal stats.
      if (name === 'poor RF') expect(answers.some((answer) => answer.qso!.condition === 'weak' && !isCleanCopy(answer))).toBe(true);
    }
    expect(hidden).toBeGreaterThan(0);
  });

  it('a doubling is never a reception error', () => {
    let doubled = 0;
    for (const { name, report } of all()) {
      for (const mistake of report.analysis.mistakes) {
        if (mistake.note === 'doubled') {
          doubled += 1;
          expect(mistake.cause, name).toBe('doubling');
        }
      }
      // Doubled characters never count as copy evidence or as a clean answer.
      for (const answer of answersOf(report)) if (answer.qso!.situation === 'doubled') expect(isCleanCopy(answer)).toBe(false);
      expect(report.analysis.mistakes.filter((mistake) => mistake.cause === 'reception' && mistake.note === 'doubled'), name).toEqual([]);
    }
    expect(doubled).toBeGreaterThan(0);
    // The timing-poor operator doubles most, and it moves no difficulty axis on its own.
    const share = (name: string) => {
      const picks = runs(name).reduce((sum, report) => sum + report.analysis.summary.picks, 0);
      return runs(name).reduce((sum, report) => sum + report.analysis.summary.doubledPicks, 0) / picks;
    };
    expect(share('timing-poor')).toBeGreaterThan(share('normal'));
  });

  it('eager / lid and look-alike mix-ups never lower callsign or copy', () => {
    let blamedCalls = 0;
    for (const { name, report } of all()) {
      const { analysis, score } = report;
      for (const [contactId, blame] of Object.entries(analysis.blamed)) {
        if (!blame.call) continue;
        blamedCalls += 1;
        expect(['similar', 'interference', 'logging', 'procedure'], name).toContain(blame.call);
        // That contact's call adds nothing to the whole-call buckets callsign learns from.
        const scored = score.contacts.find((contact) => contact.contactId === contactId)!;
        const answers = answersOf(report).filter((answer) => answer.id.includes(`-${contactId}-call-`));
        expect(answers.every((answer) => answer.qso!.blame === blame.call), name).toBe(true);
        expect(scored.firstCall?.correct ?? false).toBe(false);
      }
      // Callsign learns only from clean, unblamed calls: as many first calls as that.
      const clean = score.contacts.filter((contact) => contact.firstCall?.situation === 'clean' && !analysis.blamed[contact.contactId]?.call).length;
      expect(analysis.evidence.calls?.first.clean?.total ?? 0, name).toBe(clean);
    }
    expect(blamedCalls).toBeGreaterThan(0);
    // The skill itself: a run's interference misses never take callsign below the same run without them.
    for (const report of runs('lid / eager-heavy')) {
      const profile = updateSkills(emptyQsoProfile(), { modeId: 'pileup', alphabet: 'international', wpm: 20, evidence: report.analysis.evidence });
      const first = profile.skills.callsign?.first.clean;
      if (first) expect(first.value).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('look-alike mistakes are recorded apart, with the station they were mixed up with', () => {
    let similar = 0;
    for (const { name, report } of all()) {
      for (const mistake of report.analysis.mistakes.filter((item) => item.cause === 'similar' || item.cause === 'interference')) {
        if (mistake.note === 'dropped') continue;
        expect(mistake.with, name).toBeTruthy();
        if (mistake.cause === 'similar') similar += 1;
      }
    }
    expect(similar).toBeGreaterThan(0);
    // More look-alikes on the frequency, more contacts worked against one.
    const met = (name: string) => runs(name).reduce((sum, report) => sum + report.analysis.summary.similarMet, 0);
    expect(met('similar-heavy')).toBeGreaterThan(met('normal'));
  });

  it('おまかせ moves only the axes each run gives cause for, never the level-only ones', () => {
    const pinned = AXES.filter((axis) => !(PILEUP_ADAPT_AXES as readonly Axis[]).includes(axis));
    for (const name of Object.keys(CONDITIONS)) {
      let state = { difficulty: normalizeDifficulty(pileupLevel('intermediate').axes), votes: {} as Record<string, number> };
      for (const report of runs(name)) {
        const votes = votePileupAxes(report.analysis);
        for (const axis of Object.keys(votes)) expect(PILEUP_ADAPT_AXES, name).toContain(axis);
        state = adjustDifficulty(state, report.analysis.evidence, pinned, votes);
      }
      for (const axis of pinned) expect(state.difficulty[axis], `${name} ${axis}`).toBe(normalizeDifficulty(pileupLevel('intermediate').axes)[axis]);
    }
    // Doubling alone gives no vote: the timing-poor bot's runs, doublings removed, vote the same.
    for (const report of runs('timing-poor')) {
      const rest = Object.fromEntries(Object.entries(report.analysis.summary.causes).filter(([cause]) => cause !== 'doubling'));
      const without = { ...report.analysis, summary: { ...report.analysis.summary, doubledPicks: 0, causes: rest } };
      expect(votePileupAxes(without)).toEqual(votePileupAxes(report.analysis));
    }
  });

  it('the synced summary carries counts only: no steps, no air, no RF', () => {
    for (const { name, report } of all()) {
      const summary = pileupSummary({
        result: report.result, score: report.score, analysis: report.analysis, level: 'intermediate', modeId: PILEUP_MODE_ID, presetId: PILEUP_RST.id,
        fieldCount: 2, difficulty: pileupLevel('intermediate').axes, wallClock: (t) => t * 1000,
      });
      const json = JSON.stringify(summary);
      for (const key of ['"steps"', '"rx"', '"callers":[', '"responders"', '"offsetHz"', '"snr"', '"env"', '"mistakes"', '"text"', '"over"']) expect(json, `${name} ${key}`).not.toContain(key);
      expect(summary.pileup?.picks).toBe(report.analysis.summary.picks);
      expect(json.length, name).toBeLessThan(6000);
    }
  });

  it('stored → reloaded, the review and its causes come out the same', () => {
    for (const { name, report } of all()) {
      const stored = JSON.parse(JSON.stringify(traceOf(report))) as AnyRunTrace;
      expect(isPileupTrace(stored)).toBe(true);
      const trace = stored as PileupTrace;
      expect(reviewStats(pickGroups(trace.pileup.steps, trace.result), trace.result), name).toEqual(reviewStats(pickGroups(report.steps, report.result), report.result));
      const again = reanalyse(trace);
      expect(again.summary, name).toEqual(trace.pileup.analysis.summary);
      expect(again.mistakes, name).toEqual(trace.pileup.analysis.mistakes);
      expect(again.copy, name).toEqual(trace.pileup.analysis.copy);
    }
  });

  it('answers from different contacts of one run never share an id', () => {
    for (const { name, report } of all()) {
      const ids = answersOf(report).map((answer) => answer.id);
      expect(new Set(ids).size, name).toBe(ids.length);
    }
  });

  it('pileup skills fold in; CQ run stats stay untouched', () => {
    let profile = emptyQsoProfile();
    for (const report of runs('normal')) {
      profile = updatePileupSkills(profile, report.analysis);
      profile = recordRunOutcome(profile, {
        contacts: pileupContacts(report.result, report.score, report.analysis, wpmOf(report)), alphabet: 'international', at: 1,
        seconds: report.result.stats.seconds, frequencyChecks: 0, busyAvoided: 0, cleanContacts: 0, cleanRate: 0,
        pileup: pileupOutcome(report.result, report.score, report.analysis),
      }).qso;
    }
    const skill = profile.skills.pileup!;
    for (const key of ['copy', 'overlap', 'narrowing', 'timing', 'logging'] as const) expect(skill[key]?.n, key).toBeGreaterThan(0);
    expect(profile.stats!.bestRate ?? 0).toBe(0);
    expect(profile.stats!.frequencyChecks ?? 0).toBe(0);
    expect(profile.stats!.pileup!.contacts).toBeGreaterThan(0);
  });
});

describe('pileup badge goals are reachable', () => {
  it('a few hours of runs at sensible levels get every tier', () => {
    // A learner who works up the levels: as many runs as each badge's top tier needs, at most 120 (≈14 h of 7-minute runs).
    const plan: { level: 'intro' | 'beginner' | 'intermediate' | 'advanced'; bot: 'average' | 'skilled' }[] = [
      { level: 'intro', bot: 'skilled' }, { level: 'beginner', bot: 'skilled' }, { level: 'intermediate', bot: 'average' }, { level: 'intermediate', bot: 'skilled' }, { level: 'advanced', bot: 'skilled' },
    ];
    let profile = emptyQsoProfile();
    const tierAt: Record<string, number[]> = {};
    for (let index = 0; index < 120; index += 1) {
      const { level, bot } = plan[index % plan.length];
      const report = runPileupSim({ seed: 500 + index, level, bot, duration: 420 });
      const folded = recordRunOutcome(profile, {
        contacts: [], alphabet: 'international', at: index, seconds: report.result.stats.seconds, frequencyChecks: 0, busyAvoided: 0, cleanContacts: 0, cleanRate: 0,
        pileup: pileupOutcome(report.result, report.score, report.analysis),
      });
      profile = folded.qso;
      for (const { id, tier } of folded.earned) (tierAt[id] ??= [])[tier] = index + 1;
      if (BADGES.filter((badge) => badge.id.startsWith('pileup')).every((badge) => profile.badges?.[badge.id]?.tier === 3)) break;
    }
    const stats = profile.stats!.pileup ?? emptyPileupStats();
    for (const badge of BADGES.filter((item) => item.id.startsWith('pileup'))) {
      expect(profile.badges?.[badge.id]?.tier, `${badge.id} ${JSON.stringify(stats)}`).toBe(3);
      // The first tier comes early.
      expect(tierAt[badge.id][1], badge.id).toBeLessThanOrEqual(6);
    }
  }, 120_000);
});
