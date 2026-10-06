import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nowId } from '../../ids';
import type { JudgedContact } from '../modes/runCore';
import { RUN_TRACE_LIMIT, isContestTrace, type AnyRunTrace } from '../runTrace';
import { runContestSim } from '../sim/contestSim';
import { deskLog, deskNumbers, dupeLineIds, isNewMult } from './desk';
import { contestLevel, contestParamsOf } from './levels';
import { crossCheck, type ContestLogLine, type TheirLine } from './log';
import { buildContestReview, perMinute, rateOver, storedRules, type ReviewSource } from './review';
import { SPRINT_RULES } from './rules';
import { contestSave, reviewOf, storedResult } from './save';

const STORED_RULES = storedRules(SPRINT_RULES);

const contact = (call: string, at: number, change: Partial<JudgedContact> = {}): JudgedContact => ({
  id: `c-${call}-${at}`, stationId: at, truth: { call, rst: '599', name: '', qth: '', nr: '1' },
  sentCalls: [call], sentAt: [at - 5], doublings: 0, corrections: 0, partials: 0, asks: 0, qrs: 0, txCount: 2, busted: false,
  startedAt: at - 10, exchangedAt: at - 2, closedAt: at, status: 'closed', outcome: 'complete', logIds: [`l-${at}`],
  ...change,
} as JudgedContact);

/**
 * A hand-made run (clock starting at 1000): one of every verdict, a contact exchanged and
 * then dropped (the station logged us, we did not), and a line only the other side has
 * that no exchange of ours went to.
 */
function fixture(): ReviewSource {
  const start = 1000;
  const ours: ContestLogLine[] = [
    { id: 'l-1060', at: 1060, call: 'JA1AAA', rst: '599', nr: '011', sentNr: 1 },
    { id: 'l-1120', at: 1120, call: 'JA1BBX', rst: '599', nr: '021', sentNr: 2 },
    { id: 'l-1180', at: 1180, call: 'JA1CCC', rst: '599', nr: '039', sentNr: 3 },
    { id: 'l-1240', at: 1240, call: 'JA1DDD', rst: '599', nr: '041', sentNr: 4 },
    { id: 'l-1300', at: 1300, call: 'JA1AAA', rst: '599', nr: '012', sentNr: 5 },
  ];
  const theirs: TheirLine[] = [
    { station: 'JA1AAA', at: 1058, nr: 1, sent: 11 },
    { station: 'JA1BBB', at: 1118, nr: 2, sent: 21 },
    { station: 'JA1CCC', at: 1178, nr: 3, sent: 31 },
    { station: 'JA1AAA', at: 1298, nr: 5, sent: 12 },
    // Dropped: we sent our exchange (006), it sent 051 and logged us; we called CQ instead of TU.
    { station: 'JA2EEE', at: 1350, nr: 6, sent: 51 },
    // Unmatched: it has us, no exchange of ours went to anything like it.
    { station: 'JA3FFF', at: 1400, nr: 6, sent: 61 },
  ];
  const check = crossCheck(ours, theirs, SPRINT_RULES);
  const contacts = [
    contact('JA1AAA', 1060, { doublings: 1 }),
    contact('JA1BBB', 1120, { busted: true, outcome: 'bust' }),
    contact('JA1CCC', 1180),
    contact('JA1AAA', 1300),
    contact('JA2EEE', 1352, { status: 'exchanged' as JudgedContact['status'], closedAt: undefined, outcome: 'no-closing', logIds: [] }),
    contact('JA4GGG', 1420, { exchangedAt: undefined, closedAt: undefined, outcome: 'incomplete', logIds: [], doublings: 2 }),
  ];
  return {
    contacts,
    log: [],
    unlogged: ['c-JA2EEE-1352', 'c-JA4GGG-1420'],
    missed: [
      { stationId: 90, call: 'JA5HHH', wpm: 26, strength: 0.5, offsetHz: 100, calls: 3, reason: 'patience' },
      { stationId: 91, call: 'JA1AAA', wpm: 26, strength: 0.5, offsetHz: 0, calls: 1, reason: 'b4' },
    ],
    stats: {
      seconds: 480, contacts: 5, rate: 0, firstCallAccuracy: null, partials: 0, corrections: 0, busts: 1, nil: 0, unlogged: 2, dupes: 1,
      callers: 9, doublings: 3, dupeCallers: 2, b4: 1, bestRate: 38,
    },
    rules: STORED_RULES,
    clock: { start, end: start + 480 },
    qsos: ours,
    check,
    blocks: { size: 60, logged: [], good: [] },
  };
}

const SENT = [
  { at: 50, kind: 'exchange' as const, text: 'JA1AAA 5NN 001', subject: 'JA1AAA', nr: 1 },
  { at: 340, kind: 'exchange' as const, text: 'JA2EEE 5NN 006', subject: 'JA2EEE', nr: 6 },
  { at: 352, kind: 'cq' as const, text: 'CQ TEST JS2WDR TEST' },
];

describe('contest review: the log check', () => {
  const review = buildContestReview(fixture(), SENT);

  it('one verdict per line of our log, times from the start of the run', () => {
    expect(review.lines.map((line) => [line.call, line.verdict, line.at])).toEqual([
      ['JA1AAA', 'ok', 60], ['JA1BBX', 'bust-call', 120], ['JA1CCC', 'bust-nr', 180], ['JA1DDD', 'nil', 240], ['JA1AAA', 'dupe', 300],
    ]);
    expect(review.counts).toEqual({ ok: 1, 'bust-call': 1, 'bust-nr': 1, nil: 1, dupe: 1 });
    // Each line with the station's own record beside it.
    expect(review.lines[1].their).toMatchObject({ station: 'JA1BBB', sent: 21, copied: 2 });
    expect(review.lines[2].their).toMatchObject({ station: 'JA1CCC', sent: 31 });
    expect(review.lines[3].their).toBeNull();
  });

  it('scores: claimed from our log (DUPE left out), checked with the penalties', () => {
    expect(review.claimed).toMatchObject({ qsos: 4, mults: 1 });
    // 1 good − NIL 1 − BUST CALL 1 (BUST NR costs nothing here): points floor at zero for the total.
    expect(review.checked).toMatchObject({ qsos: 1, points: -1, total: 0 });
  });

  it('exchanged then dropped: their log only, as "dropped", with the exchange we sent', () => {
    expect(review.theirOnly).toEqual([
      { station: 'JA2EEE', at: 350, copied: 6, sent: 51, kind: 'dropped', exchange: 'JA2EEE 5NN 006' },
      { station: 'JA3FFF', at: 400, copied: 6, sent: 61, kind: 'unmatched', exchange: null },
    ]);
    // Never one of our verdicts: no NIL, no penalty for us.
    expect(review.counts.nil).toBe(1);
  });

  it('who left: callers that gave up (not the ones told QSO B4) and contacts never exchanged', () => {
    expect(review.missed).toEqual([{ call: 'JA5HHH', calls: 3, reason: 'patience' }]);
    expect(review.abandoned).toEqual([{ call: 'JA4GGG', calls: 1, reason: 'incomplete' }]);
  });

  it('doublings, in total and by contact', () => {
    expect(review.doublings).toEqual({ total: 3, contacts: [{ call: 'JA1AAA', count: 1 }, { call: 'JA4GGG', count: 2 }] });
  });

  it('rate over time: a per-minute series that can be cut any way', () => {
    expect(review.rates.perMinute.logged).toEqual([0, 1, 1, 1, 1, 1, 0, 0]);
    expect(review.rates.perMinute.good).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
    expect(rateOver(review.rates.perMinute.logged, 0, 5)).toBe(48);
    expect(rateOver(review.rates.perMinute.logged, 5, 8)).toBe(20);
    expect(perMinute([0, 59.9, 60, 1000], 120)).toEqual([2, 2]);
  });
});

describe('contest review: from simulated runs', () => {
  const runs = [1, 2, 3, 4, 5, 6].flatMap((seed) => (['intro', 'intermediate', 'expert'] as const).map((level) => ({ seed, level, report: runContestSim({ seed, level, bot: 'average', duration: 300, esm: true }) })));

  it('accounts for every line, every block and every line only they have', () => {
    for (const { seed, level, report } of runs) {
      const label = `${level}/${seed}`;
      const review = buildContestReview(storedResult(report.result));
      expect(review.lines.length, label).toBe(report.result.qsos.length);
      expect(Object.values(review.counts).reduce((a, b) => a + b, 0), label).toBe(review.lines.length);
      expect(review.rates.blocks.reduce((sum, block) => sum + block.logged, 0), label).toBe(review.lines.length);
      expect(review.rates.perMinute.logged.reduce((a, b) => a + b, 0), label).toBe(review.lines.length);
      expect(review.lines.every((line) => line.at >= 0 && line.at <= review.seconds + 1), label).toBe(true);
      expect(review.theirOnly.length, label).toBe(report.result.check.theirOnly.length);
      for (const line of review.theirOnly.filter((item) => item.kind === 'dropped')) {
        expect(report.result.contacts.some((item) => item.truth.call === line.station && item.exchangedAt !== undefined && !item.logIds.length), label).toBe(true);
      }
    }
  });
});

describe('contest save: device record and cloud summary', () => {
  const report = runContestSim({ seed: 3, level: 'intermediate', bot: 'average', duration: 300, esm: true });
  const axes = contestLevel('intermediate').axes;
  const input = {
    id: nowId(), startedAt: 1_700_000_000_000, endedAt: 1_700_000_300_000, level: 'intermediate', wpm: 26, minutes: 10,
    axes, params: contestParamsOf(axes), result: report.result, sent: report.sent,
    judged: { scored: report.judged.scored, air: report.judged.air, analysis: report.judged.analysis }, wpmOf: { 1: 24 },
  };
  const saved = contestSave(input);

  it('the stored record shows the same review after a round trip (IndexedDB clones, JSON too)', () => {
    expect(reviewOf(structuredClone(saved.trace))).toEqual(saved.review);
    const reloaded = JSON.parse(JSON.stringify(saved.trace)) as AnyRunTrace;
    expect(isContestTrace(reloaded)).toBe(true);
    if (isContestTrace(reloaded)) {
      expect(reviewOf(reloaded)).toEqual(saved.review);
      expect(reloaded.contest.review).toEqual(saved.review);
    }
    // The rules' function is not stored; their numbers are.
    expect(saved.trace.result.rules).toEqual(STORED_RULES);
  });

  it('the summary holds counts and the score only: no log, stations, times, RF or review', () => {
    const { summary } = saved;
    expect(summary.modeId).toBe('contest');
    expect(summary.run).toBeUndefined();
    expect(summary.pileup).toBeUndefined();
    expect(summary.contacts).toEqual([]);
    expect(Object.keys(summary.contest!).sort()).toEqual([
      'abandoned', 'analysis', 'b4', 'bestRate', 'bustCall', 'bustNr', 'checked', 'claimed', 'doublings', 'dropped', 'dupe', 'dupeCallers',
      'level', 'logged', 'missed', 'nil', 'ok', 'rate', 'rulesId', 'seconds', 'theirOnly',
    ]);
    // The analysis in counts: causes, failures and tallies — no calls, characters or times.
    expect(Object.keys(summary.contest!.analysis!).sort()).toEqual(['causes', 'copy', 'crowded', 'eager', 'failures', 'lid', 'serial', 'similar', 'streak', 'version']);
    const text = JSON.stringify(summary);
    for (const word of ['lines', 'their"', 'rx', 'tx', 'blocks', 'perMinute', 'sent', 'review', 'contacts":[{', 'truth', 'air', 'mistakes', 'slips', 'roster', 'scored']) expect(text).not.toContain(word);
    for (const line of report.result.qsos) expect(text).not.toContain(line.call);
    expect(summary.contest).toMatchObject({ logged: saved.review.lines.length, ok: saved.review.counts.ok, checked: { total: saved.review.checked.total } });
  });

  it('the device record keeps the books and leaves out what a contest does not judge', () => {
    expect(saved.trace).toMatchObject({ kind: 'run', modeId: 'contest', id: input.id, scored: [], rx: {}, adjusted: {}, earned: [] });
    expect(saved.trace.tx.map((item) => item.text)).toEqual(report.sent.map((item) => item.text));
    // Stage 4: the contest's own scoring, the callers' messages and the causes, on this device only.
    expect(saved.trace.contest.scored).toEqual(report.judged.scored);
    expect(saved.trace.contest.air).toEqual(report.judged.air);
    expect(RUN_TRACE_LIMIT).toBe(50);
  });

  it('record ids do not collide', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => nowId()));
    expect(ids.size).toBe(5000);
  });
});

describe('the live desk sees our own log only', () => {
  const report = runContestSim({ seed: 2, level: 'intermediate', bot: 'average', duration: 300, esm: true });
  const ours = report.result.qsos;

  it('the same typed log gives the same desk, whatever the check says', () => {
    // The checked lines carry verdicts and the stations' own records; the desk must not change with them.
    const checked = report.result.check.lines;
    const times = ours.map((line) => line.at);
    const a = deskNumbers(ours, times, report.result.clock.start, report.result.clock.end, SPRINT_RULES);
    const b = deskNumbers(checked, times, report.result.clock.start, report.result.clock.end, SPRINT_RULES);
    expect(b).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/verdict|their|checked|nil|bust/i);
    const logA = deskLog(ours, 'JS2WDR');
    const logB = deskLog(checked, 'JS2WDR');
    expect(logB.nextNr).toBe(logA.nextNr);
    for (const line of [...ours, { call: 'JA9ZZZ' }]) {
      expect(logB.isDupe(line.call)).toBe(logA.isDupe(line.call));
      expect(isNewMult(checked, line.call, SPRINT_RULES)).toBe(isNewMult(ours, line.call, SPRINT_RULES));
    }
    expect([...dupeLineIds(checked)]).toEqual([...dupeLineIds(ours)]);
  });

  it('the claimed score on the desk is the review\'s claimed score', () => {
    const live = deskNumbers(ours, ours.map((line) => line.at), report.result.clock.start, report.result.clock.end, SPRINT_RULES).score;
    expect(live).toMatchObject({ qsos: report.result.check.claimed.qsos, mults: report.result.check.claimed.mults, total: report.result.check.claimed.total });
  });

  it('the desk modules import nothing that knows the truth or the check', () => {
    const root = resolve(__dirname);
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const [, path] of source.matchAll(/from '(\.[^']+)'/g)) walk(resolve(dirname(file), `${path}.ts`));
    };
    walk(resolve(root, 'desk.ts'));
    walk(resolve(root, 'esm.ts'));
    const reached = [...seen].map((file) => file.replace(resolve(root, '..') + '/', ''));
    expect(reached).toEqual(expect.arrayContaining(['contest/desk.ts', 'contest/esm.ts', 'contest/log.ts', 'contest/rules.ts', 'air/intent.ts']));
    for (const file of reached) expect(file).not.toMatch(/^(agents|modes|sim)\/|contest\/(field|bot|review|save|levels)\.ts$|air\/(ether|persona)/);
  });

  it('the contest desk reads the run only through what an operator does', () => {
    const desk = readFileSync(resolve(__dirname, '../../../app/views/qso/ContestDesk.tsx'), 'utf8');
    const used = new Set([...desk.matchAll(/\.run\.(\w+)/g)].map((match) => match[1]));
    const allowed = ['transmit', 'logQso', 'editQso', 'qsos', 'finish', 'tick', 'drainNotes', 'rebase', 'onStationTransmission', 'keying', 'keyedUntil', 'params'];
    expect([...used].filter((name) => !allowed.includes(name))).toEqual([]);
  });
});
