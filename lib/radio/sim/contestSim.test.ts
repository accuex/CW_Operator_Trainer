import { describe, expect, it } from 'vitest';
import { CONTEST_LEVELS } from '../contest/levels';
import { runContestSim } from './contestSim';

const LEVELS = CONTEST_LEVELS.map((level) => level.id);
const BOTS = ['perfect-ear', 'skilled', 'average'] as const;

describe('contest simulator: invariants', () => {
  it.each(LEVELS)('%s: every bot — no breach, everyone settles, our serials count up', (level) => {
    for (const bot of BOTS) {
      for (const seed of [1, 2]) {
        const label = `${level}/${bot}/${seed}`;
        const report = runContestSim({ seed, level, bot, duration: 300 });
        expect(report.breaches, label).toEqual([]);
        expect(report.settled, label).toBe(true);
        expect(report.result.qsos.map((line) => line.sentNr), label).toEqual(report.result.qsos.map((_, index) => index + 1));
        // Every serial we keyed is the next one or a repeat of the last.
        report.sentSerials.forEach((serial, index) => {
          if (index) expect(serial - report.sentSerials[index - 1], label).toBeGreaterThanOrEqual(0);
        });
      }
    }
  });

  it('through the desk\'s ESM: no breach, and every serial sent is the one logged', () => {
    for (const level of LEVELS) {
      for (const bot of BOTS) {
        const report = runContestSim({ seed: 1, level, bot, duration: 300, esm: true });
        expect(report.breaches, `${level}/${bot}`).toEqual([]);
        expect(report.settled, `${level}/${bot}`).toBe(true);
        expect(report.result.qsos.length, `${level}/${bot}`).toBeGreaterThan(0);
        expect(report.esmActions.filter((action) => action.log).length).toBe(report.result.qsos.length);
      }
    }
  });

  it('is deterministic: the same seed runs the same contest', () => {
    const a = runContestSim({ seed: 7, level: 'intermediate', bot: 'average', duration: 300 });
    const b = runContestSim({ seed: 7, level: 'intermediate', bot: 'average', duration: 300 });
    expect(b.result.qsos).toEqual(a.result.qsos);
    expect(b.result.check.counts).toEqual(a.result.check.counts);
    expect(b.tx).toBe(a.tx);
  });
});

describe('contest simulator: the log check', () => {
  it('a perfect ear never busts a call or is not in the log, and few serials go wrong', () => {
    for (const level of LEVELS) {
      for (const seed of [1, 2, 3]) {
        const { counts } = runContestSim({ seed, level, bot: 'perfect-ear', duration: 600 }).result.check;
        expect(counts['bust-call'], `${level}/${seed}`).toBe(0);
        expect(counts.nil, `${level}/${seed}`).toBe(0);
        expect(counts.dupe, `${level}/${seed}`).toBe(0);
        expect(counts['bust-nr'], `${level}/${seed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a station worked already: QSO B4 sends it off; working it again is a dupe', () => {
    const axes = { dupes: 0.5 };
    let b4 = 0;
    let dupes = 0;
    for (const seed of [1, 2, 3]) {
      const told = runContestSim({ seed, level: 'beginner', axes, bot: 'perfect-ear', duration: 600 });
      expect(told.breaches).toEqual([]);
      expect(told.result.check.counts.dupe).toBe(0);
      b4 += told.result.stats.b4;
      const worked = runContestSim({ seed, level: 'beginner', axes, bot: 'perfect-ear', dupes: 'work', duration: 600 });
      expect(worked.breaches).toEqual([]);
      dupes += worked.result.check.counts.dupe;
      // A dupe scores nothing: checked points never count it.
      expect(worked.result.check.checked.qsos).toBe(worked.result.check.counts.ok);
    }
    expect(b4).toBeGreaterThan(0);
    expect(dupes).toBeGreaterThan(0);
  });

  it('a busier frequency makes more contacts for a perfect ear, and loses more callers', () => {
    const totals = (level: (typeof LEVELS)[number]) => {
      let qsos = 0;
      let departures = 0;
      for (const seed of [1, 2, 3]) {
        const report = runContestSim({ seed, level, bot: 'perfect-ear', duration: 600 });
        qsos += report.result.check.counts.ok;
        departures += report.departures;
      }
      return { qsos, departures };
    };
    const intro = totals('intro');
    const expert = totals('expert');
    expect(expert.qsos).toBeGreaterThan(intro.qsos);
    expect(expert.departures).toBeGreaterThan(intro.departures);
  });
});
