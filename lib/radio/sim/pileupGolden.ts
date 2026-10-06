import { digest, idBase, relativeIds, type GoldenEntry } from './golden';
import { PILEUP_BAND, runPileupSim, type PileupSimOptions } from './pileupSim';
import type { SimAirEvent } from './runSim';

/**
 * Golden snapshots of pileup runs, taken from Pileup Run v1 (a211c8b): every transmission
 * on the air, every caller (persona, manners, reactions, how it ended), the books at QRT,
 * the review's record of our messages and the causes as judged. Work on other modes
 * (contest) that touches the shared air, agents or books must leave these bit for bit.
 */

export interface PileupGoldenScenario { name: string; seeds: number[]; options: Omit<PileupSimOptions, 'seed'> }

export const PILEUP_GOLDEN_SCENARIOS: PileupGoldenScenario[] = [
  { name: 'intro-average', seeds: [1, 2], options: { level: 'intro', bot: 'average' } },
  { name: 'beginner-novice', seeds: [11, 12], options: { level: 'beginner', bot: 'novice' } },
  { name: 'intermediate-average', seeds: [21, 22], options: { level: 'intermediate', bot: 'average' } },
  { name: 'intermediate-loud-first', seeds: [31], options: { level: 'intermediate', bot: 'loud-first' } },
  { name: 'advanced-skilled', seeds: [41, 42], options: { level: 'advanced', bot: 'skilled' } },
  { name: 'advanced-timing-poor', seeds: [51], options: { level: 'advanced', bot: 'timing-poor' } },
  { name: 'dx-skilled', seeds: [61, 62], options: { level: 'dx', bot: 'skilled' } },
  { name: 'dx-partial-averse', seeds: [71], options: { level: 'dx', bot: 'partial-averse' } },
  { name: 'intermediate-poor-rf', seeds: [81], options: { level: 'intermediate', bot: 'average', axes: { weak: 0.7 }, band: { ...PILEUP_BAND, noise: 0.7 } } },
  { name: 'advanced-similar-lids', seeds: [91], options: { level: 'advanced', bot: 'average', axes: { similar: 0.4, manners: 1 } } },
];

export function snapshotPileup(name: string, seed: number, options: PileupGoldenScenario['options']): { entry: GoldenEntry; full: string } {
  const base = idBase();
  const air: SimAirEvent[] = [];
  const report = runPileupSim({ seed, ...options, onAir: (event) => air.push(event) });
  const { result, run, analysis, score } = report;
  const snapshot = {
    air,
    agents: run.agents.map((agent) => ({
      id: agent.id,
      persona: agent.persona,
      manners: agent.manners,
      rf: agent.station.rf,
      wpm: agent.station.wpm,
      arrivedAt: agent.arrivedAt,
      state: agent.state,
      goneReason: agent.goneReason,
      goneAt: agent.goneAt,
      callsMade: agent.callsMade,
      attempts: agent.attempts,
      doublings: agent.doublings,
      corrections: agent.corrections,
      busted: agent.busted,
      hijacked: agent.hijacked,
      reactions: agent.reactions,
      addressedAs: agent.addressedAs,
      addressedAt: agent.addressedAt,
    })),
    result,
    report: { qrtAt: report.qrtAt, settled: report.settled, breaches: report.breaches, tx: report.tx, moves: report.moves, busts: report.busts, good: report.good },
    steps: report.steps,
    score: { contacts: score.contacts, evidence: score.evidence },
    analysis: { summary: analysis.summary, copy: analysis.copy, logging: analysis.logging, mistakes: analysis.mistakes, blamed: analysis.blamed, evidence: analysis.evidence },
    bot: report.bot.logs,
  };
  const full = JSON.stringify(snapshot, relativeIds(base));
  const { stats } = result;
  return {
    full,
    entry: {
      name,
      seed,
      digest: digest(full),
      summary: {
        air: air.length,
        callers: stats.callers,
        contacts: stats.contacts,
        log: result.log.map((entry) => `${entry.fields.call}:${entry.verdict}`).join(','),
        rate: stats.rate,
        busts: stats.busts,
        nil: stats.nil,
        partials: stats.partials,
        doublings: stats.doublings,
        hijacks: stats.hijacks,
        mistakes: analysis.mistakes.map((mistake) => `${mistake.note}:${mistake.cause}`).join(','),
        settled: report.settled,
      },
    },
  };
}

export function allPileupSnapshots() {
  const out: { entry: GoldenEntry; full: string }[] = [];
  for (const scenario of PILEUP_GOLDEN_SCENARIOS) for (const seed of scenario.seeds) out.push(snapshotPileup(scenario.name, seed, scenario.options));
  return out;
}
