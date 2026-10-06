import { beforeAll, describe, expect, it } from 'vitest';
import { forWeakAnalysis } from '../../analytics';
import { adjustDifficulty, AXES, AXIS_SPECS, normalizeDifficulty, type Axis, type DifficultyVector } from '../difficulty';
import type { ContestAnalysis } from '../contest/analysis';
import { CONTEST_ADAPT_AXES, voteContestAxes } from '../contest/learning';
import { CONTEST_AXES, CONTEST_LEVELS, contestAxesOf, contestLevel, type ContestAxes, type ContestLevelId } from '../contest/levels';
import { contestSave, reanalyse, reviewOf } from '../contest/save';
import { seeded } from '../random';
import type { ContestTrace } from '../runTrace';
import { runContestSim, type ContestSimOptions, type ContestSimReport } from './contestSim';
import { PILEUP_BAND } from './pileupSim';

/**
 * Contest Run v1 QA: every level under four kinds of band and four ears, through the
 * desk's ESM, and おまかせ runs chained the way the desk chains them. The default is a
 * quick pass; CONTEST_QA_LONG=1 runs the long one.
 */

const LONG = !!process.env.CONTEST_QA_LONG;
const SEEDS = LONG ? [11, 12, 13, 14] : [11];
const DURATION = LONG ? 1800 : 300;
const CHAIN = LONG ? 20 : 4;
const LEVELS = CONTEST_LEVELS.map((level) => level.id);
const BOTS = ['perfect-ear', 'skilled', 'average', 'novice'] as const;

type Condition = (level: ContestLevelId) => Omit<ContestSimOptions, 'seed' | 'level' | 'bot'>;
const CONDITIONS: Record<string, Condition> = {
  calm: () => ({ band: PILEUP_BAND }),
  realistic: () => ({ band: { noise: 0.35, qsb: 0.3, qrn: 0.2, qrm: 2 } }),
  rough: () => ({ band: { noise: 0.45, qsb: 0.6, qrn: 0.5, qrm: 4 } }),
  weak: (level) => ({ band: { noise: 0.5, qsb: 0.2, qrn: 0.1, qrm: 1 }, axes: { weak: Math.min(1, contestLevel(level).axes.weak + 0.5) } }),
};

interface Run { name: string; level: ContestLevelId; bot: (typeof BOTS)[number]; seed: number; report: ContestSimReport }
const crashes: string[] = [];
function play(name: string, level: ContestLevelId, bot: Run['bot'], seed: number, options: Omit<ContestSimOptions, 'seed' | 'level' | 'bot'>, duration = DURATION): Run | null {
  try {
    const report = runContestSim({ ...options, level, bot, seed, duration, esm: true });
    // Judged already: the band samples are the bulk of a report, and a long pass keeps hundreds.
    report.records.length = 0;
    return { name, level, bot, seed, report: { ...report, monitor: null as never } };
  } catch (error) {
    crashes.push(`${name} ${level} ${bot} ${seed}: ${(error as Error).stack}`);
    return null;
  }
}

/** Hand the worker back between runs, so a long pass doesn't starve vitest's own messages. */
const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));
const grid: Run[] = [];
beforeAll(async () => {
  for (const level of LEVELS) {
    for (const bot of BOTS) {
      for (const [name, condition] of Object.entries(CONDITIONS)) {
        for (const seed of SEEDS) {
          const run = play(name, level, bot, seed, condition(level));
          if (run) grid.push(run);
          await breathe();
        }
      }
    }
  }
}, LONG ? 3_600_000 : 300_000);
const label = ({ name, level, bot, seed }: Run) => `${level} ${bot} ${name} #${seed}`;
const byLevel = (level: ContestLevelId, bot?: Run['bot']) => grid.filter((run) => run.level === level && (!bot || run.bot === bot));
const sum = (runs: readonly Run[], of: (report: ContestSimReport) => number) => runs.reduce((total, run) => total + of(run.report), 0);

/** Most callers on the air (arrived, not yet gone) at once. */
function peakAgents(report: ContestSimReport) {
  const edges = report.run.agents.flatMap((agent) => [[agent.arrivedAt, 1], [agent.goneAt ?? Infinity, -1]] as const).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let peak = 0;
  for (const [, delta] of edges) peak = Math.max(peak, (now += delta));
  return peak;
}
/** Longest silence from us before QRT (the bot always has something to send: CQ TEST, a call, TU). */
function longestQuiet(report: ContestSimReport) {
  const ours = report.sent.map((item) => item.at).filter((at) => at <= report.qrtAt);
  let gap = ours[0] ?? report.qrtAt;
  for (let index = 1; index < ours.length; index += 1) gap = Math.max(gap, ours[index] - ours[index - 1]);
  return gap;
}

function saveOf({ report, level }: Run, id: string) {
  const axes = { ...contestLevel(level).axes };
  const wpmOf = Object.fromEntries(Object.entries(report.result.roster ?? {}).map(([station, item]) => [station, item.wpm]));
  return contestSave({
    id, startedAt: 0, endedAt: report.qrtAt * 1000, level, wpm: axes.speed, minutes: 0, axes, params: report.run.params,
    result: report.result, sent: report.sent, judged: { scored: report.judged.scored, air: report.judged.air, analysis: report.judged.analysis }, wpmOf,
  });
}

describe(`contest v1 QA (${LONG ? 'long' : 'quick'}: ${LEVELS.length} levels × ${BOTS.length} ears × ${Object.keys(CONDITIONS).length} bands × ${SEEDS.length} seeds × ${DURATION} s)`, () => {
  it('no crash, no breach, no stuck desk, nothing left on the air after QRT, callers bounded', () => {
    expect(crashes).toEqual([]);
    expect(grid).toHaveLength(LEVELS.length * BOTS.length * Object.keys(CONDITIONS).length * SEEDS.length);
    for (const run of grid) {
      const { report } = run;
      expect(report.breaches, label(run)).toEqual([]);
      expect(report.settled, label(run)).toBe(true);
      expect(report.run.stations.filter((station) => station.role === 'caller'), label(run)).toEqual([]);
      expect(report.run.agents.every((agent) => agent.gone), label(run)).toBe(true);
      // A slow (入門) contact is a call, a report and serial, TU: well under a minute and a half.
      expect(longestQuiet(report), label(run)).toBeLessThan(90);
      expect(peakAgents(report), label(run)).toBeLessThanOrEqual(30);
      // Callers come at a steady pace, not faster and faster.
      expect(report.run.agents.length / DURATION, label(run)).toBeLessThan(1);
      expect(report.result.qsos.length, label(run)).toBeGreaterThan(0);
    }
  });

  it('serials, the log check, the score and the rate agree with each other', () => {
    for (const run of grid) {
      const { result, judged, sentSerials } = run.report;
      const where = label(run);
      // Ours: one up a line, never repeated, never back.
      expect(result.qsos.map((line) => line.sentNr), where).toEqual(result.qsos.map((_, index) => index + 1));
      sentSerials.forEach((serial, index) => { if (index) expect(serial, where).toBeGreaterThanOrEqual(sentSerials[index - 1]); });
      // Theirs: each station's serials only climb (checked as a breach), never the same twice.
      for (const station of run.report.run.field.all) expect(new Set(station.given).size, `${where} ${station.persona.call}`).toBe(station.given.length);
      const { counts, claimed, checked } = result.check;
      expect(counts.ok + counts['bust-nr'] + counts['bust-call'] + counts.nil + counts.dupe, where).toBe(result.qsos.length);
      expect(claimed.qsos, where).toBe(result.qsos.length - counts.dupe);
      expect(checked.qsos, where).toBe(counts.ok);
      expect(claimed.total, where).toBe(Math.max(0, claimed.points) * claimed.mults);
      expect(checked.mults, where).toBeLessThanOrEqual(claimed.mults);
      expect(checked.total, where).toBeLessThanOrEqual(claimed.total);
      const { review, analysis } = judged;
      expect(review.counts, where).toEqual(counts);
      expect(review.rates.average, where).toBeCloseTo((result.qsos.length * 3600) / review.seconds, -0.5);
      expect(review.rates.blocks.reduce((total, block) => total + block.logged, 0), where).toBe(result.qsos.length);
      expect(review.rates.perMinute.logged.reduce((total, count) => total + count, 0), where).toBe(result.qsos.length);
      // The causes' failures are the log check's.
      expect(analysis.failures['bust-call'] ?? 0, where).toBe(counts['bust-call']);
      expect(analysis.failures['bust-nr'] ?? 0, where).toBe(counts['bust-nr']);
      expect(analysis.failures.dupe ?? 0, where).toBe(counts.dupe);
      expect((analysis.failures.nil ?? 0) + (analysis.failures.unmatched ?? 0), where).toBeGreaterThanOrEqual(counts.nil);
      // Ids: unique within the run, and no two callers on the air with one call.
      for (const items of [result.qsos, result.contacts, result.log]) expect(new Set(items.map((item) => item.id)).size, where).toBe(items.length);
      const agents = run.report.run.agents;
      expect(new Set(agents.map((agent) => agent.id)).size, where).toBe(agents.length);
      for (const [index, a] of agents.entries()) {
        for (const b of agents.slice(index + 1)) {
          if (a.call === b.call) expect(a.arrivedAt >= (b.goneAt ?? Infinity) || b.arrivedAt >= (a.goneAt ?? Infinity), `${where} ${a.call}`).toBe(true);
        }
      }
    }
  });

  it('the levels load up the way they say: every load axis climbs, and the field with it', () => {
    const harder: (keyof ContestAxes)[] = ['speed', 'density', 'even', 'manners', 'timing', 'similar', 'serial', 'pressure', 'dupes', 'weak'];
    for (const [index, level] of CONTEST_LEVELS.entries()) {
      if (!index) continue;
      const before = CONTEST_LEVELS[index - 1].axes;
      for (const axis of harder) expect(level.axes[axis], `${level.id} ${axis}`).toBeGreaterThanOrEqual(before[axis]);
      expect(level.axes.stack, level.id).toBeLessThanOrEqual(before.stack);
      expect(CONTEST_AXES.some((axis) => level.axes[axis] !== before[axis]), level.id).toBe(true);
    }
    const field = LEVELS.map((level) => {
      const runs = byLevel(level);
      const wpm = runs.flatMap((run) => run.report.run.agents.map((agent) => agent.station.wpm));
      return { level, wpm: wpm.reduce((total, item) => total + item, 0) / wpm.length, peak: sum(runs, peakAgents) / runs.length, missed: sum(runs, (report) => report.result.missed.length) / runs.length };
    });
    for (let index = 1; index < field.length; index += 1) {
      expect(field[index].wpm, field[index].level).toBeGreaterThan(field[index - 1].wpm);
      expect(field[index].peak, field[index].level).toBeGreaterThan(field[index - 1].peak);
      expect(field[index].missed, field[index].level).toBeGreaterThanOrEqual(field[index - 1].missed);
    }
    if (LONG) console.log(field.map((item) => `${item.level.padEnd(12)} wpm ${item.wpm.toFixed(1)} peak ${item.peak.toFixed(1)} missed ${item.missed.toFixed(1)}`).join('\n'));
  });

  it('a perfect ear can solve every level in every band: no BUST CALL, NIL or DUPE, and more contacts as the field gets busier', () => {
    for (const level of LEVELS) {
      for (const run of byLevel(level, 'perfect-ear')) {
        const { counts } = run.report.result.check;
        expect(counts['bust-call'], label(run)).toBe(0);
        expect(counts.nil, label(run)).toBe(0);
        expect(counts.dupe, label(run)).toBe(0);
        expect(counts['bust-nr'], label(run)).toBeLessThanOrEqual(1);
        expect(counts.ok / Math.max(1, run.report.result.qsos.length), label(run)).toBeGreaterThanOrEqual(0.9);
      }
    }
    const ok = (level: ContestLevelId) => sum(byLevel(level, 'perfect-ear'), (report) => report.result.check.counts.ok);
    expect(ok('expert')).toBeGreaterThan(ok('intro'));
    expect(ok('intermediate')).toBeGreaterThan(ok('intro'));
  });

  it('weaker ears fail more, and the causes are the conditions they were given', () => {
    const okRate = (bot: Run['bot']) => {
      const runs = grid.filter((run) => run.bot === bot);
      return sum(runs, (report) => report.result.check.counts.ok) / sum(runs, (report) => report.result.qsos.length);
    };
    expect(okRate('perfect-ear')).toBeGreaterThanOrEqual(okRate('skilled'));
    expect(okRate('skilled')).toBeGreaterThan(okRate('novice'));
    for (const run of grid) {
      const { analysis } = run.report.judged;
      // A calm band has no fading, no crashes and no one weak: nothing goes down to the band.
      if (run.name === 'calm') {
        expect(analysis.mistakes.filter((mistake) => mistake.cause === 'environment' && mistake.env !== 'qrm'), label(run)).toEqual([]);
        if (contestLevel(run.level).axes.weak === 0) expect(analysis.causes.weak ?? 0, label(run)).toBe(0);
      }
      for (const mistake of analysis.mistakes) {
        if (mistake.cause === 'environment' && mistake.env === 'qsb') expect(CONDITIONS[run.name](run.level).band!.qsb, label(run)).toBeGreaterThan(0);
        if (mistake.cause === 'environment' && mistake.env === 'qrn') expect(CONDITIONS[run.name](run.level).band!.qrn, label(run)).toBeGreaterThan(0);
        // Dropped and unmatched contacts are never the ear's; neither is a doubling.
        if (mistake.failure === 'dropped' || mistake.failure === 'unmatched') expect(['dropped', 'procedure', 'interference'], label(run)).toContain(mistake.cause);
        if (mistake.failure === 'doubled') expect(mistake.cause, label(run)).toBe('doubling');
      }
    }
    // Over the whole grid, the poor-RF bands are where the band's causes are.
    const rf = (names: string[]) => grid.filter((run) => run.bot !== 'perfect-ear' && names.includes(run.name))
      .reduce((total, run) => total + (run.report.judged.analysis.causes.weak ?? 0) + (run.report.judged.analysis.causes.environment ?? 0), 0);
    expect(rf(['rough', 'weak'])).toBeGreaterThan(rf(['calm']));
  });

  it('normal weak-pair stats stay clean: what isn\'t copy never reaches them', () => {
    for (const [index, run] of grid.entries()) {
      for (const answer of forWeakAnalysis(saveOf(run, `qa-${index}`).answers)) {
        expect(answer.qso!.condition, label(run)).toBe('clean');
        expect(answer.qso!.blame, label(run)).toBeUndefined();
        expect(answer.qso!.env.overlap, label(run)).toBeUndefined();
      }
    }
  });

  it('saved, stored and reloaded: the same review and causes; the synced summary has counts only; ids unique across runs', () => {
    const traceIds = new Set<string>();
    const answerIds = new Set<string>();
    for (const [index, run] of grid.entries()) {
      const id = `run-${index}`;
      const saved = saveOf(run, id);
      expect(traceIds.has(saved.trace.id)).toBe(false);
      traceIds.add(saved.trace.id);
      for (const answer of saved.answers) {
        expect(answerIds.has(answer.id), `${label(run)} ${answer.id}`).toBe(false);
        answerIds.add(answer.id);
      }
      const trace = JSON.parse(JSON.stringify(saved.trace)) as ContestTrace;
      expect(reviewOf(trace), label(run)).toEqual(saved.review);
      expect(reanalyse(trace), label(run)).toEqual(saved.analysis);
      expect(voteContestAxes(reanalyse(trace)!), label(run)).toEqual(voteContestAxes(saved.analysis));
      const json = JSON.stringify(saved.summary);
      // Counts only: no log lines, timeline, RF or the other side's log (claimed/checked "qsos" are counts).
      for (const key of ['"lines"', '"qsos":[', '"theirOnly":[', '"sent"', '"air"', '"scored"', '"roster"', '"mistakes"', '"text"', '"rf"', '"offsetHz"', '"monitor"', '"JS2WDR"']) {
        expect(json, `${label(run)} ${key}`).not.toContain(key);
      }
      expect(saved.summary.call, label(run)).toBe('');
      expect(saved.summary.contacts, label(run)).toEqual([]);
      // No caller's call in what syncs.
      for (const line of run.report.result.qsos.slice(0, 5)) expect(json, label(run)).not.toContain(`"${line.call}"`);
      expect(json.length, label(run)).toBeLessThan(4_000);
    }
  });
});

describe('contest v1 QA: おまかせ ON, runs chained', () => {
  const pinnedOf = (user: readonly Axis[]) => [...user, ...AXES.filter((axis) => !(CONTEST_ADAPT_AXES as readonly Axis[]).includes(axis))];
  const NOT_COPY_CAUSES = ['procedure', 'logging', 'dupe', 'dropped', 'interference', 'doubling'];

  it('every move is a contest axis, in bounds, at most two a run, with this run\'s vote behind it; pinned axes hold', async () => {
    for (const level of LEVELS) {
      for (const [bot, user] of [['average', []], ['novice', []], ['skilled', ['speed']]] as const) {
        const base = contestLevel(level).axes;
        const pinned = pinnedOf(user);
        let state = { difficulty: normalizeDifficulty({ ...base }), votes: {} as Record<string, number> };
        for (let index = 0; index < CHAIN; index += 1) {
          const run = play(`auto ${bot}`, level, bot, 700 + index, { ...CONDITIONS.realistic(level), axes: contestAxesOf(state.difficulty, base) }, LONG ? 900 : 300);
          await breathe();
          expect(run, `${level} ${bot} ${index}`).not.toBeNull();
          const { analysis } = run!.report.judged;
          expect(run!.report.breaches).toEqual([]);
          const votes = voteContestAxes(analysis);
          const next = adjustDifficulty(state, analysis.evidence, pinned, votes);
          const moved = Object.entries(next.moved) as [Axis, number][];
          expect(moved.length, `${level} ${bot} ${index}`).toBeLessThanOrEqual(2);
          for (const [axis, delta] of moved) {
            const where = `${level} ${bot} run ${index} ${axis} ${delta}`;
            expect(CONTEST_ADAPT_AXES, where).toContain(axis);
            expect(Math.sign(votes[axis] ?? 0), where).toBe(Math.sign(delta));
            expect(next.difficulty[axis], where).toBeGreaterThanOrEqual(AXIS_SPECS[axis].min);
            expect(next.difficulty[axis], where).toBeLessThanOrEqual(AXIS_SPECS[axis].max);
          }
          for (const axis of pinned) expect(next.difficulty[axis], `${level} ${axis}`).toBe(state.difficulty[axis]);
          // Procedure, logging, DUPE, dropped, interference and doublings vote nothing: taken out, the votes are the same.
          const rest = Object.fromEntries(Object.entries(analysis.causes).filter(([cause]) => !NOT_COPY_CAUSES.includes(cause)));
          expect(voteContestAxes({ ...analysis, causes: rest }), `${level} ${bot} ${index}`).toEqual(votes);
          state = next;
        }
      }
    }
  }, LONG ? 3_600_000 : 300_000);

  it('a learner with a ceiling: from any level it settles near that ceiling and stays there, never stuck at an end', () => {
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    for (const ceiling of [18, 25, 32]) {
      for (const level of ['beginner', 'intermediate', 'advanced'] as ContestLevelId[]) {
        const random = seeded(ceiling * 10 + level.length);
        const tally = (n: number, p: number) => {
          let correct = 0;
          for (let index = 0; index < n; index += 1) if (random() < p) correct += 1;
          return { total: n, correct };
        };
        const base = contestLevel(level).axes;
        const pinned = pinnedOf([]);
        let state = { difficulty: normalizeDifficulty({ ...base }) as DifficultyVector, votes: {} as Record<string, number> };
        const speeds: number[] = [];
        let flips = 0;
        let last = 0;
        for (let index = 0; index < 160; index += 1) {
          const axes = contestAxesOf(state.difficulty, base);
          // A bad day now and then.
          const day = random() < 0.15 ? -3 : 0;
          const copy = sigmoid((ceiling + day - axes.speed) / 1.5) * 0.98 + 0.01;
          const analysis = {
            causes: {}, copy: tally(20, copy), crowded: tally(10, copy * sigmoid((ceiling / 3 - axes.density) / 1.2)),
            serial: tally(20, copy * sigmoid((ceiling / 30 - axes.serial) / 0.15)), similarMet: 0, evidence: { env: {} },
          } as unknown as ContestAnalysis;
          const votes = voteContestAxes(analysis);
          const next = adjustDifficulty(state, analysis.evidence, pinned, votes);
          expect(Object.keys(next.moved).length).toBeLessThanOrEqual(2);
          if (next.moved.speed) {
            const direction = Math.sign(next.moved.speed);
            if (last && direction !== last) flips += 1;
            last = direction;
          }
          state = next;
          speeds.push(axes.speed);
        }
        const tail = speeds.slice(80);
        const where = `ceiling ${ceiling} from ${level}`;
        expect(Math.min(...tail), where).toBeGreaterThanOrEqual(ceiling - 5);
        expect(Math.max(...tail), where).toBeLessThanOrEqual(ceiling + 1);
        expect(Math.min(...tail), where).toBeGreaterThan(AXIS_SPECS.speed.min);
        expect(Math.max(...tail), where).toBeLessThan(AXIS_SPECS.speed.max);
        // It tracks, it doesn't swing: a turn every few runs at most, within a few WPM.
        expect(Math.max(...tail) - Math.min(...tail), where).toBeLessThanOrEqual(4);
        expect(flips, where).toBeLessThan(60);
      }
    }
  });
});
