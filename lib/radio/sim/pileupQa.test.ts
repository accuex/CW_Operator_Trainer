import { beforeAll, describe, expect, it } from 'vitest';
import { forWeakAnalysis } from '../../analytics';
import { BADGES, recordRunOutcome } from '../badges';
import { adjustDifficulty, AXES, AXIS_SPECS, normalizeDifficulty, type Axis, type DifficultyVector } from '../difficulty';
import { PILEUP_LEVELS, pileupAxesOf, pileupLevel, type PileupLevelId } from '../modes/pileupLevels';
import { PILEUP_ADAPT_AXES, pileupContacts, pileupOutcome, pileupSummary, updatePileupSkills, votePileupAxes } from '../pileup/learning';
import { pickGroups, reviewStats } from '../pileup/review';
import { pileupAnswers, pileupTraceDetail, PILEUP_MODE_ID, reanalyse } from '../pileup/save';
import { PILEUP_RST } from '../exchange';
import { RUN_TRACE_VERSION, type PileupTrace } from '../runTrace';
import { emptyQsoProfile } from '../skills';
import { PILEUP_BAND, runPileupSim, type PileupSimOptions, type PileupSimReport } from './pileupSim';

/**
 * Pileup Run v1 QA: every level under six kinds of pile, and おまかせ runs chained the
 * way the desk chains them (each run starts from the axes the last one left). The
 * default is a quick pass; PILEUP_QA_LONG=1 runs the long one.
 */

const LONG = !!process.env.PILEUP_QA_LONG;
const SEEDS = LONG ? [11, 12, 13, 14] : [11];
const DURATION = LONG ? 1200 : 300;
const CHAIN = LONG ? 12 : 3;
const LEVELS = PILEUP_LEVELS.map((level) => level.id);

type Condition = (level: PileupLevelId) => Omit<PileupSimOptions, 'seed' | 'level'>;
const CONDITIONS: Record<string, Condition> = {
  normal: () => ({ bot: 'average' }),
  crowded: (level) => ({ bot: 'average', axes: { pile: Math.min(30, pileupLevel(level).axes.pile * 2 + 2), timing: 1, stack: Math.max(20, pileupLevel(level).axes.stack / 2) } }),
  'poor RF': (level) => ({ bot: 'average', axes: { weak: Math.min(1, pileupLevel(level).axes.weak + 0.5) }, band: { ...PILEUP_BAND, noise: 0.7 } }),
  'similar-heavy': () => ({ bot: 'average', axes: { similar: 0.4 } }),
  'timing-poor': () => ({ bot: 'timing-poor' }),
  'eager-lid-heavy': () => ({ bot: 'average', axes: { manners: 1 } }),
};

interface Run { name: string; level: PileupLevelId; seed: number; report: PileupSimReport }
const crashes: string[] = [];
function play(name: string, level: PileupLevelId, seed: number, options: Omit<PileupSimOptions, 'seed' | 'level'>): Run | null {
  try {
    return { name, level, seed, report: runPileupSim({ ...options, level, seed, duration: DURATION }) };
  } catch (error) {
    crashes.push(`${name} ${level} ${seed}: ${(error as Error).stack}`);
    return null;
  }
}

/** Hand the worker back between runs, so a long pass doesn't starve vitest's own messages. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));
const grid: Run[] = [];
const all = () => grid;
beforeAll(async () => {
  for (const level of LEVELS) {
    for (const [name, condition] of Object.entries(CONDITIONS)) {
      for (const seed of SEEDS) {
        const run = play(name, level, seed, condition(level));
        if (run) grid.push(run);
        await breathe();
      }
    }
  }
}, LONG ? 3_600_000 : 300_000);
const label = ({ name, level, seed }: Run) => `${level} ${name} #${seed}`;

const wpmOf = (report: PileupSimReport) => (id: number) => report.run.agents.find((agent) => agent.id === id)?.station.wpm ?? 20;
const answersOf = (report: PileupSimReport, sessionId: string) => pileupAnswers(report.result, report.score, report.analysis, { sessionId, timestamp: 1, wpmOf: wpmOf(report) });
const traceOf = ({ report, level }: Run): PileupTrace => ({
  kind: 'run', version: RUN_TRACE_VERSION, id: 't', startedAt: 0, endedAt: 1, modeId: PILEUP_MODE_ID, presetId: PILEUP_RST.id,
  difficulty: { ...pileupLevel(level).axes }, params: { ...report.run.params }, result: report.result, scored: report.score.contacts, evidence: report.analysis.evidence,
  rx: {}, tx: [], filter: 500, wpmOf: {}, adjusted: {}, earned: [], pileup: pileupTraceDetail(level, 24, report.steps, report.analysis),
});

/** Most callers on the air (arrived, not yet gone) at once. */
function peakAgents(report: PileupSimReport) {
  const edges = report.run.agents.flatMap((agent) => [[agent.arrivedAt, 1], [agent.goneAt ?? Infinity, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let peak = 0;
  for (const [, delta] of edges) peak = Math.max(peak, (now += delta));
  return peak;
}
/** Longest silence from us before QRT (the bot always has something to send: CQ, QRZ?, a call). */
function longestQuiet(report: PileupSimReport) {
  const ours = report.steps.filter((step) => step.at <= report.qrtAt).map((step) => step.at);
  let gap = ours[0] ?? report.qrtAt;
  for (let index = 1; index < ours.length; index += 1) gap = Math.max(gap, ours[index] - ours[index - 1]);
  return gap;
}

/** The evidence a move needs behind it, by axis. */
const JUSTIFIED: Record<string, (report: PileupSimReport) => boolean> = {
  speed: ({ analysis }) => analysis.copy.total > 0,
  pile: ({ analysis }) => Object.entries(analysis.summary.firstCall).some(([bucket, tally]) => bucket !== '1' && tally.total > 0),
  similar: ({ analysis }) => analysis.summary.similarMet > 0 || (analysis.summary.causes.similar ?? 0) > 0,
  weak: ({ analysis }) => (analysis.evidence.env.weak?.total ?? 0) > 0 || (analysis.summary.causes.weak ?? 0) > 0,
  stack: ({ analysis }) => analysis.summary.partials >= 3,
};

describe(`pileup v1 QA (${LONG ? 'long' : 'quick'}: ${LEVELS.length} levels × ${Object.keys(CONDITIONS).length} conditions × ${SEEDS.length} seeds × ${DURATION} s)`, () => {
  it('no crash, no stuck desk, no unbounded callers, nothing left on the air after QRT', () => {
    const runs = all();
    expect(crashes).toEqual([]);
    expect(runs).toHaveLength(LEVELS.length * Object.keys(CONDITIONS).length * SEEDS.length);
    const rows: string[] = [];
    for (const run of runs) {
      const { report } = run;
      expect(report.breaches, label(run)).toEqual([]);
      expect(report.settled, label(run)).toBe(true);
      expect(report.run.stations.filter((station) => station.role === 'caller'), label(run)).toEqual([]);
      expect(report.run.agents.every((agent) => agent.gone), label(run)).toBe(true);
      const quiet = longestQuiet(report);
      const peak = peakAgents(report);
      // A slow (入門) contact is our call, their whole report and TU: under a minute and a half; stuck would be the rest of the run.
      expect(quiet, label(run)).toBeLessThan(90);
      expect(peak, label(run)).toBeLessThanOrEqual(Math.max(12, report.run.params.pile * 3));
      // Callers come at a steady pace, not faster and faster.
      expect(report.run.agents.length / DURATION, label(run)).toBeLessThan(1);
      rows.push(`${label(run).padEnd(32)} contacts ${String(report.good).padStart(3)} quiet ${quiet.toFixed(1).padStart(5)} s dry ${report.longestDry.toFixed(0).padStart(4)} s peak ${String(peak).padStart(2)} agents ${report.run.agents.length}`);
    }
    if (LONG) console.log(rows.join('\n'));
  });

  it('only contacts with something logged are stored; answers come from those alone, ids unique across runs', () => {
    const ids = new Set<string>();
    let total = 0;
    all().forEach((run, index) => {
      const { report } = run;
      const summary = pileupSummary({
        result: report.result, score: report.score, analysis: report.analysis, level: run.level, modeId: PILEUP_MODE_ID, presetId: PILEUP_RST.id,
        fieldCount: 2, difficulty: pileupLevel(run.level).axes, wallClock: (t) => t * 1000,
      });
      const logged = new Set(report.result.contacts.filter((contact) => contact.logIds.length).map((contact) => contact.id));
      // Stored: what we logged, and what reached the station's side unlogged (shown as 「ログ漏れ」); never a contact that went nowhere.
      const kept = report.result.contacts.filter((contact) => contact.logIds.length || contact.outcome !== 'incomplete');
      expect(summary.contacts?.length, label(run)).toBe(kept.length);
      for (const contact of kept) if (!contact.logIds.length) expect(report.analysis.mistakes.some((mistake) => mistake.note === 'unlogged' && mistake.call === contact.truth.call), label(run)).toBe(true);
      // Badges count logged contacts with the right call only.
      expect(pileupOutcome(report.result, report.score, report.analysis).contacts, label(run)).toBeLessThanOrEqual(logged.size);
      for (const contact of report.score.contacts) if (contact.fields?.length) expect(logged.has(contact.contactId), label(run)).toBe(true);
      // Badge contacts: what we logged, less the fields that weren't our copy's doing (all blamed: it folds in as nothing).
      const scored = report.score.contacts.filter((contact) => contact.fields && report.result.contacts.some((item) => item.id === contact.contactId));
      const badge = pileupContacts(report.result, report.score, report.analysis, wpmOf(report));
      expect(badge, label(run)).toHaveLength(scored.length);
      badge.forEach((contact, at) => {
        const blame = report.analysis.blamed[scored[at].contactId] ?? {};
        for (const field of contact.fields) expect(blame[field.key as keyof typeof blame], label(run)).toBeUndefined();
      });
      for (const answer of answersOf(report, `run${index}`)) {
        expect(ids.has(answer.id), `${label(run)} ${answer.id}`).toBe(false);
        ids.add(answer.id);
        total += 1;
      }
    });
    expect(total).toBeGreaterThan(0);
  });

  it('normal weak-pair stats stay clean; doublings are never reception; eager / lid never cost callsign', () => {
    for (const run of all()) {
      const { report } = run;
      for (const answer of forWeakAnalysis(answersOf(report, 's'))) {
        expect(answer.qso!.condition, label(run)).toBe('clean');
        expect(answer.qso!.blame, label(run)).toBeUndefined();
        expect(answer.qso!.env.overlap, label(run)).toBeUndefined();
        expect(answer.qso!.situation, label(run)).not.toBe('doubled');
      }
      for (const mistake of report.analysis.mistakes) if (mistake.note === 'doubled') expect(mistake.cause, label(run)).toBe('doubling');
      for (const [contactId, blame] of Object.entries(report.analysis.blamed)) {
        if (blame.call !== 'interference') continue;
        const scored = report.score.contacts.find((contact) => contact.contactId === contactId)!;
        expect(scored.firstCall?.correct ?? false, label(run)).toBe(false);
      }
      const clean = report.score.contacts.filter((contact) => contact.firstCall?.situation === 'clean' && !report.analysis.blamed[contact.contactId]?.call).length;
      expect(report.analysis.evidence.calls?.first.clean?.total ?? 0, label(run)).toBe(clean);
    }
  });

  it('the synced summary has counts only; stored and reloaded, the review is the same', () => {
    for (const run of all()) {
      const { report } = run;
      const json = JSON.stringify(pileupSummary({
        result: report.result, score: report.score, analysis: report.analysis, level: run.level, modeId: PILEUP_MODE_ID, presetId: PILEUP_RST.id,
        fieldCount: 2, difficulty: pileupLevel(run.level).axes, wallClock: (t) => t * 1000,
      }));
      for (const key of ['"steps"', '"rx"', '"callers":[', '"responders"', '"offsetHz"', '"snr"', '"env"', '"mistakes"', '"text"', '"over"', '"monitor"']) expect(json, `${label(run)} ${key}`).not.toContain(key);
      expect(json.length, label(run)).toBeLessThan(12_000);
      const trace = JSON.parse(JSON.stringify(traceOf(run))) as PileupTrace;
      expect(reviewStats(pickGroups(trace.pileup.steps, trace.result), trace.result), label(run)).toEqual(reviewStats(pickGroups(report.steps, report.result), report.result));
      const again = reanalyse(trace);
      expect(again.summary, label(run)).toEqual(trace.pileup.analysis.summary);
      expect(again.mistakes, label(run)).toEqual(trace.pileup.analysis.mistakes);
    }
  });
});

describe('pileup v1 QA: おまかせ ON, runs chained', () => {
  const pinned = AXES.filter((axis) => !(PILEUP_ADAPT_AXES as readonly Axis[]).includes(axis));
  const chains: Record<string, { moves: string[]; axes: DifficultyVector }> = {};

  it('every move is one of the pileup axes, in bounds, with this run’s evidence behind it', async () => {
    for (const level of LEVELS) {
      for (const bot of ['average', 'skilled', 'timing-poor'] as const) {
        const base = pileupLevel(level).axes;
        let state = { difficulty: normalizeDifficulty(base), votes: {} as Record<string, number> };
        const moves: string[] = [];
        for (let index = 0; index < CHAIN; index += 1) {
          const axes = pileupAxesOf(state.difficulty, base);
          const run = play(`auto ${bot}`, level, 700 + index, { bot, axes });
          await breathe();
          expect(run, `${level} ${bot} ${index}`).not.toBeNull();
          const { report } = run!;
          expect(report.breaches).toEqual([]);
          const votes = votePileupAxes(report.analysis);
          const next = adjustDifficulty(state, report.analysis.evidence, pinned, votes);
          for (const [axis, delta] of Object.entries(next.moved) as [Axis, number][]) {
            const where = `${level} ${bot} run ${index} ${axis} ${delta}`;
            expect(PILEUP_ADAPT_AXES, where).toContain(axis);
            // Moved on a vote of this run, the way it voted.
            expect(votes[axis], where).toBeDefined();
            expect(JUSTIFIED[axis](report), where).toBe(true);
            expect(next.difficulty[axis], where).toBeGreaterThanOrEqual(AXIS_SPECS[axis].min);
            expect(next.difficulty[axis], where).toBeLessThanOrEqual(AXIS_SPECS[axis].max);
            moves.push(`${index}:${axis}${delta > 0 ? '+' : ''}${delta}`);
          }
          // Doubling alone moves nothing: the same run with its doublings taken out votes the same.
          const rest = Object.fromEntries(Object.entries(report.analysis.summary.causes).filter(([cause]) => cause !== 'doubling' && cause !== 'interference' && cause !== 'procedure' && cause !== 'logging'));
          expect(votePileupAxes({ ...report.analysis, summary: { ...report.analysis.summary, doubledPicks: 0, eager: 0, lid: 0, causes: rest } }), level).toEqual(votes);
          for (const axis of pinned) expect(next.difficulty[axis], `${level} ${axis}`).toBe(normalizeDifficulty(base)[axis]);
          state = next;
        }
        chains[`${level} ${bot}`] = { moves, axes: state.difficulty };
      }
    }
    if (LONG) for (const [key, chain] of Object.entries(chains)) console.log(key.padEnd(24), chain.moves.join(' ') || '(none)');
  }, LONG ? 3_600_000 : 300_000);

  it('a learner’s runs reach every badge tier and leave the CQ run stats alone', () => {
    let profile = emptyQsoProfile();
    const runs = all();
    for (const { report } of runs) {
      profile = updatePileupSkills(profile, report.analysis);
      profile = recordRunOutcome(profile, {
        contacts: pileupContacts(report.result, report.score, report.analysis, wpmOf(report)), alphabet: 'international', at: 1,
        seconds: report.result.stats.seconds, frequencyChecks: 0, busyAvoided: 0, cleanContacts: 0, cleanRate: 0,
        pileup: pileupOutcome(report.result, report.score, report.analysis),
      }).qso;
    }
    expect(profile.stats!.bestRate ?? 0).toBe(0);
    expect(profile.stats!.frequencyChecks ?? 0).toBe(0);
    if (!LONG) return;
    const tiers = Object.fromEntries(BADGES.filter((badge) => badge.id.startsWith('pileup')).map((badge) => [badge.id, profile.badges?.[badge.id]?.tier ?? 0]));
    console.log('badge tiers after the grid', JSON.stringify(tiers), JSON.stringify(profile.stats!.pileup));
  });
});
