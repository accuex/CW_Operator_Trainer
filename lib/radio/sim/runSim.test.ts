import { describe, expect, it } from 'vitest';
import { runSim, type SimOptions } from './runSim';

const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);
const batch = (options: Omit<SimOptions, 'seed'>) => SEEDS.map((seed) => runSim({ seed, ...options }));
const contactsOf = (reports: ReturnType<typeof batch>) => reports.flatMap((report) => report.result.contacts);

describe('headless CQ run', () => {
  const perfect = batch({});

  it('settles every caller', () => {
    for (const report of perfect) {
      for (const agent of report.run.agents) expect(agent.gone, `${agent.call} ${agent.state}`).toBe(true);
    }
  });

  it('completes and logs every contact a perfect operator makes', () => {
    const contacts = contactsOf(perfect);
    expect(contacts.length).toBeGreaterThan(SEEDS.length * 1.5);
    for (const contact of contacts) {
      expect(contact.outcome).toBe('complete');
      expect(contact.txCount).toBeLessThanOrEqual(3);
      expect(contact.logIds).toHaveLength(1);
    }
    for (const report of perfect) {
      expect(report.result.log.every((entry) => entry.verdict === 'ok')).toBe(true);
      expect(report.result.unlogged).toEqual([]);
      expect(report.result.stats.firstCallAccuracy ?? 1).toBe(1);
    }
  });

  it('nobody times out on a frequency that is still working', () => {
    for (const report of perfect) {
      const early = report.run.agents.filter((agent) => agent.goneReason === 'timeout' && agent.arrivedAt < report.qrtAt - 60);
      expect(early).toEqual([]);
    }
  });

  it('is repeatable from a seed', () => {
    // Station ids come from a global counter; everything else must match.
    const strip = (report: ReturnType<typeof runSim>) =>
      JSON.stringify({ contacts: report.result.contacts, log: report.result.log, missed: report.result.missed }, (key, value) => (key === 'stationId' ? undefined : value));
    expect(strip(runSim({ seed: 7 }))).toBe(strip(runSim({ seed: 7 })));
    expect(strip(runSim({ seed: 7 }))).not.toBe(strip(runSim({ seed: 8 })));
  });

  it('turns wrong calls into corrections, or into busts when they are ignored', () => {
    const corrected = contactsOf(batch({ bot: { callErrorRate: 0.5 } }));
    expect(corrected.filter((contact) => contact.corrections > 0).length).toBeGreaterThan(corrected.length * 0.25);
    expect(corrected.every((contact) => contact.outcome === 'complete')).toBe(true);

    const ignored = contactsOf(batch({ bot: { callErrorRate: 0.5, ignoreCorrections: true } }));
    const busts = ignored.filter((contact) => contact.outcome === 'bust').length;
    expect(busts).toBeGreaterThan(ignored.length * 0.1);
    expect(busts).toBeLessThan(ignored.length * 0.5);
  });

  it('counts partials and flags phantom log lines as NIL', () => {
    const partial = batch({ bot: { partialRate: 0.5 } });
    expect(partial.reduce((sum, report) => sum + report.result.stats.partials, 0)).toBeGreaterThan(SEEDS.length / 2);

    const phantom = batch({ bot: { phantomRate: 0.3 } });
    const nil = phantom.reduce((sum, report) => sum + report.result.stats.nil, 0);
    const made = contactsOf(phantom).length;
    expect(nil / made).toBeGreaterThan(0.15);
    expect(nil / made).toBeLessThan(0.45);
    expect(contactsOf(phantom).every((contact) => contact.logIds.length === 1)).toBe(true);
  });

  it('keeps running with crowds and slow, weak callers', () => {
    const crowd = batch({ params: { arrivals: 5, speed: 12, weak: 0.6, spread: 200 } });
    for (const report of crowd) expect(report.run.agents.every((agent) => agent.gone)).toBe(true);
    expect(contactsOf(crowd).length).toBeGreaterThan(SEEDS.length);
  });

  it('checks the frequency with QRL? and moves off a QSO in progress', () => {
    const busy = batch({ placement: { onFrequency: true, nearby: 1 } });
    for (const report of busy) {
      expect(report.issues.filter((issue) => issue === 'cq-without-qrl' || issue === 'busy-frequency')).toEqual([]);
      expect(report.qsys).toBeGreaterThanOrEqual(1);
      expect(report.result.frequencies.every((use) => use.qrlFirst && use.busyCqs === 0)).toBe(true);
      expect(report.run.agents.every((agent) => agent.gone)).toBe(true);
    }
    expect(contactsOf(busy).length).toBeGreaterThan(SEEDS.length);
    expect(contactsOf(busy).every((contact) => contact.outcome === 'complete')).toBe(true);
  });

  it('calling CQ on top of a QSO is flagged, and the bot QSYs when asked', () => {
    const careless = batch({ placement: { onFrequency: true, nearby: 0 }, bot: { qrl: false, blindStart: true } });
    const flagged = careless.filter((report) => report.result.stats.busyCqs > 0);
    expect(flagged.length).toBeGreaterThan(SEEDS.length * 0.6);
    for (const report of flagged) expect(report.issues).toContain('cq-without-qrl');
    expect(careless.filter((report) => report.qsys > 0).length).toBeGreaterThan(SEEDS.length * 0.5);
  });

  const meanWaiting = (reports: ReturnType<typeof batch>, from: number, to: number) =>
    reports.reduce((sum, report) => sum + report.waiting.samples.slice(from, to).reduce((a, b) => a + b, 0) / (to - from), 0) / reports.length;

  it('settles to a few waiting callers, even with CQ repeat left running and nobody picked', () => {
    const long = { duration: 600 };
    for (const bot of [{}, { cqRepeat: 4 }, { cqRepeat: 4, pick: false }]) {
      const reports = batch({ ...long, bot });
      const early = meanWaiting(reports, 120, 300);
      const late = meanWaiting(reports, 420, 600);
      expect(late, JSON.stringify(bot)).toBeLessThan(2.5);
      expect(late, JSON.stringify(bot)).toBeLessThan(early * 1.5 + 0.5);
    }
  });

  it('builds a pileup from the same callers with other parameters, and it stays bounded', () => {
    const normal = batch({ duration: 600, bot: { cqRepeat: 4 } });
    const pileup = batch({ duration: 600, bot: { cqRepeat: 4 }, params: { arrivals: 8, crowd: { patience: 1.6, recall: 1 } } });
    const busy = meanWaiting(pileup, 300, 600);
    expect(busy).toBeGreaterThan(meanWaiting(normal, 300, 600) * 3);
    // Levels off: the last minutes add little to the ones before.
    expect(meanWaiting(pileup, 450, 600)).toBeLessThan(meanWaiting(pileup, 300, 450) * 1.15 + 1);
    expect(Math.max(...pileup.map((report) => report.waiting.max))).toBeLessThan(40);
  });

  it('still works callers it doubled with', () => {
    const reports = batch({ duration: 600, bot: { cqRepeat: 4 } });
    const doubled = reports.flatMap((report) => report.run.agents.filter((agent) => agent.doublings > 0));
    expect(doubled.length).toBeGreaterThan(SEEDS.length);
    const worked = doubled.filter((agent) => agent.state === 'done');
    expect(worked.length).toBeGreaterThan(doubled.length * 0.25);
    // Nobody gives up the moment its own call ends: there's always a chance to be answered.
    expect(doubled.filter((agent) => agent.goneReason === 'waited').length).toBeLessThan(doubled.length * 0.5);
    expect(reports.reduce((sum, report) => sum + report.result.stats.doublings, 0)).toBeGreaterThan(0);
  });

  it('flags CQs sent without listening after QRL?', () => {
    const hasty = batch({ placement: { onFrequency: false, nearby: 0 }, bot: { qrlListen: 0, cqListen: 1 } });
    for (const report of hasty) {
      expect(report.result.stats.qrlNoListen).toBeGreaterThanOrEqual(1);
      expect(report.issues).toContain('qrl-no-listen');
    }
    const careful = batch({ placement: { onFrequency: false, nearby: 0 } });
    for (const report of careful) {
      expect(report.result.stats.qrlNoListen).toBe(0);
      expect(report.result.frequencies[0].qrlListen).toBeGreaterThanOrEqual(3);
    }
  });
});
