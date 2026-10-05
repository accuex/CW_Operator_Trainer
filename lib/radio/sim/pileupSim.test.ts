import { describe, expect, it } from 'vitest';
import { PILEUP_LEVELS, pileupParamsOf, type PileupLevelId } from '../modes/pileupLevels';
import { BOT_IDS, BOT_PROFILES, PileupBot, type BotAction } from '../pileup/bot';
import { seeded } from '../random';
import { BOT_SEED, runPileupSim } from './pileupSim';

const LEVELS = PILEUP_LEVELS.map((level) => level.id);

describe('pileup simulator: invariants', () => {
  it.each(LEVELS)('%s: every bot — no breach, nobody left on frequency, nothing unsettled', (level) => {
    for (const bot of BOT_IDS) {
      for (const seed of [1, 2]) {
        const report = runPileupSim({ seed, level, bot });
        expect(report.breaches, `${level}/${bot}/${seed}`).toEqual([]);
        expect(report.settled, `${level}/${bot}/${seed}`).toBe(true);
        expect(report.run.agents.every((agent) => agent.gone)).toBe(true);
      }
    }
  });

  it('rounds end and come again; a continuous pile stays about its size', () => {
    const rounds = runPileupSim({ seed: 3, level: 'intro', bot: 'perfect-ear' });
    expect(rounds.result.stats.rounds).toBeGreaterThan(1);
    expect(rounds.waiting.max).toBeLessThanOrEqual(pileupParamsOf(PILEUP_LEVELS[0].axes).pile);
    for (const level of ['intermediate', 'dx'] as const) {
      const { pile } = pileupParamsOf(PILEUP_LEVELS.find((item) => item.id === level)!.axes);
      const report = runPileupSim({ seed: 3, level, bot: 'average', duration: 900 });
      expect(report.result.stats.rounds).toBe(1);
      expect(report.waiting.max).toBeLessThanOrEqual(Math.round(pile * 1.2) + Math.ceil(pile * 0.3));
    }
  });

  it('the same bot does worse as the level goes up', () => {
    const completion = (level: PileupLevelId) => {
      let good = 0;
      let served = 0;
      for (const seed of [1, 2, 3, 4]) {
        const report = runPileupSim({ seed, level, bot: 'average' });
        good += report.good;
        served += report.arrived - report.leftAtQrt;
      }
      return good / served;
    };
    const [intro, intermediate, dx] = (['intro', 'intermediate', 'dx'] as const).map(completion);
    expect(intro).toBeGreaterThan(0.9);
    expect(intro).toBeGreaterThan(intermediate);
    expect(intermediate).toBeGreaterThan(dx);
  });

  it('DX: a perfect ear always gets through', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const report = runPileupSim({ seed, level: 'dx', bot: 'perfect-ear' });
      expect(report.good).toBeGreaterThanOrEqual(4);
      expect(report.longestDry).toBeLessThan(120);
    }
  });
});

describe('pileup bot: decides from observations only', () => {
  it('replayed with what it copied (and nothing else), it makes exactly the same moves', () => {
    for (const [seed, level, botId] of [[1, 'intermediate', 'average'], [2, 'dx', 'skilled'], [3, 'beginner', 'novice']] as const) {
      const report = runPileupSim({ seed, level, bot: botId, record: true });
      const replay = new PileupBot(BOT_PROFILES[botId], 'JS2WDR', seeded(seed + BOT_SEED));
      const original: (BotAction | null)[] = [];
      const replayed: (BotAction | null)[] = [];
      for (const item of report.trace) {
        if (item.kind === 'heard') {
          // What it copied carries nothing but what was on paper.
          expect(Object.keys(item.heard).sort()).toEqual(['end', 'level', 'pitch', 'start', 'words']);
          replay.hear(item.heard);
        } else if (item.kind === 'keyed') replay.keyed(item.end);
        else {
          original.push(item.action);
          replayed.push(replay.act(item.sense));
        }
      }
      expect(replayed).toEqual(original);
      expect(replay.logs).toEqual(report.bot.logs);
    }
  });
});
