import { describe, expect, it } from 'vitest';
import type { PileupResult } from '../modes/pileupRun';
import type { JudgedContact } from '../modes/runCore';
import { fitting, nextPractice, pickGroups, responderRole, reviewStats, withOverlaps, type CallerSnap, type DeskStep } from './review';

const caller = (id: number, call: string): CallerSnap => ({ id, call, offsetHz: id * 40, db: -id, wpm: 24, style: 'twice', traits: [], state: 'waiting' });
const PILE = [caller(1, 'JA3ABC'), caller(2, 'JH3ABD'), caller(3, 'JR1XYZ')];
let clock = 0;
const step = (kind: DeskStep['kind'], text: string, subject?: string, working: string | null = null): DeskStep => {
  clock += 10;
  return { at: clock, end: clock + 2, text, kind, subject, working, callers: PILE, responders: [] };
};
const contact = (call: string, sentAt: number[], outcome: JudgedContact['outcome']) =>
  ({ id: `c${sentAt[0]}`, stationId: 1, truth: { call, rst: '599', name: '', qth: '' }, sentCalls: [call], sentAt, outcome, logIds: [] } as unknown as JudgedContact);

describe('responderRole', () => {
  it('a partial: fits, look-alike, unrelated', () => {
    const partial = { kind: 'partial' as const, subject: '3AB', working: null };
    expect(responderRole(partial, 'JA3ABC')).toBe('match');
    expect(responderRole(partial, 'JA3ACC')).toBe('near');
    expect(responderRole(partial, 'JR1XYZ')).toBe('off');
  });
  it('a pick and AGN?: the partner, a look-alike, unrelated', () => {
    expect(responderRole({ kind: 'pick', subject: 'JA3ABC', working: null }, 'JA3ABC')).toBe('partner');
    expect(responderRole({ kind: 'pick', subject: 'JA3ABC', working: null }, 'JA3ABD')).toBe('near');
    expect(responderRole({ kind: 'pick', subject: 'QQ6NP', working: null }, 'JM6NP')).toBe('near'); // its correction
    expect(responderRole({ kind: 'agn', working: 'JA3ABC' }, 'JR1XYZ')).toBe('off');
    expect(responderRole({ kind: 'qrz', working: null }, 'JR1XYZ')).toBe('call');
  });
  it('a station keyed over our message never heard it: it is calling on, not a lid', () => {
    const over = [{ id: 7, call: 'JR1XYZ', text: 'JR1XYZ', at: 0 }];
    expect(responderRole({ kind: 'pick', subject: 'JA3ABC', working: null, over }, 'JR1XYZ', 7)).toBe('call');
    expect(responderRole({ kind: 'partial', subject: '3AB', working: null, over }, 'JR1XYZ', 7)).toBe('call');
    expect(responderRole({ kind: 'pick', subject: 'JA3ABC', working: null, over }, 'JR1XYZ', 8)).toBe('off');
  });
  it('AGN?: out of turn only for a station that heard us call the one we were after', () => {
    const caller = { id: 7, call: 'JR1XYZ', rf: 0, snr: 10, keying: true } as unknown as DeskStep['callers'][number];
    const pick = (over: DeskStep['over']): DeskStep => ({ at: 0, end: 2, text: 'JA3ABC 5NN', kind: 'pick', subject: 'JA3ABC', working: null, callers: [caller], responders: [], over });
    const agn = { kind: 'agn' as const, working: 'JA3ABC', over: [] };
    expect(responderRole(agn, 'JR1XYZ', 7, [pick([])])).toBe('off');
    expect(responderRole(agn, 'JR1XYZ', 7, [pick([{ id: 7, call: 'JR1XYZ', text: '', at: 0 }])])).toBe('call');
    expect(responderRole(agn, 'JR1XYZ', 8, [pick([])])).toBe('call'); // not on the frequency yet
    expect(responderRole(agn, 'JA3ABC', 1, [pick([])])).toBe('partner');
  });
});

describe('pickGroups', () => {
  it('splits at TU and at a QRZ? after something was asked; repeated QRZ? stay together', () => {
    clock = 0;
    const steps = [
      step('cq', 'CQ JS2WDR JS2WDR'), step('qrz', 'QRZ?'), step('partial', '3A AGN?', '3A'), step('partial', '3AB AGN?', '3AB'),
      step('pick', 'JA3ABC 5NN', 'JA3ABC'), step('agn', 'AGN?', undefined, 'JA3ABC'), step('tu', 'TU JS2WDR', undefined, 'JA3ABC'),
      step('partial', 'XY AGN?', 'XY'), step('qrz', 'QRZ?'), step('pick', 'JR1XYZ 5NN', 'JR1XYZ'), step('tu', 'TU JS2WDR'),
    ];
    const result = { contacts: [contact('JA3ABC', [steps[4].at], 'complete'), contact('JR1XYZ', [steps[9].at], 'bust')] };
    const groups = pickGroups(steps, result);
    expect(groups.map((group) => group.steps.map((item) => item.text))).toEqual([
      ['CQ JS2WDR JS2WDR', 'QRZ?', '3A AGN?', '3AB AGN?', 'JA3ABC 5NN', 'AGN?', 'TU JS2WDR'],
      ['XY AGN?'],
      ['QRZ?', 'JR1XYZ 5NN', 'TU JS2WDR'],
    ]);
    expect(groups.map((group) => group.outcome)).toEqual(['complete', 'dropped', 'bust']);
    expect(groups[0]).toMatchObject({ partials: 2, moves: 5, toPick: 40 });
    expect(groups[1]).toMatchObject({ partials: 1, moves: null, toPick: null });
  });

  it('who fit each partial', () => {
    clock = 0;
    expect(fitting(step('partial', '3AB AGN?', '3AB'))!.map((item) => item.call)).toEqual(['JA3ABC', 'JH3ABD']);
    expect(fitting(step('partial', 'QQ AGN?', 'QQ'))).toEqual([]);
    expect(fitting(step('qrz', 'QRZ?'))).toBeNull();
  });
});

describe('reviewStats and nextPractice', () => {
  it('counts picks, partials, and partials nobody or several fit', () => {
    clock = 0;
    const steps = [step('cq', 'CQ'), step('partial', '3AB AGN?', '3AB'), step('partial', 'ABC AGN?', 'ABC'), step('partial', 'QQ AGN?', 'QQ'), step('pick', 'JA3ABC 5NN', 'JA3ABC'), step('tu', 'TU')];
    const result = {
      contacts: [contact('JA3ABC', [steps[4].at], 'complete')], missed: [],
      stats: { contacts: 1, rate: 60, busts: 0, nil: 0, hijacks: 0 },
    } as unknown as PileupResult;
    const stats = reviewStats(pickGroups(steps, result), result);
    expect(stats).toMatchObject({ picks: 1, movesPerPick: 5, partials: 3, emptyPartials: 1, crowdedPartials: 1, partialShare: 1 });
    expect(nextPractice(stats, 'dx')).toMatch(/選局までに時間/); // 40 s to the pick
    expect(nextPractice({ ...stats, emptyPartials: 2 }, 'dx')).toMatch(/誰にも当てはまらない/);
  });
  it('no picks: how to start', () => {
    expect(nextPractice({ picks: 0 } as never, 'intro')).toMatch(/2〜3 文字/);
  });
});

describe('withOverlaps', () => {
  it('a station keying over the start of our message never copied it', () => {
    clock = 0;
    const steps = [step('pick', 'JA3ABC 5NN', 'JA3ABC'), step('pick', 'JA3ABC 5NN', 'JA3ABC')]; // at 10 and 20
    const txs = [
      { id: 1, call: 'JA3ABC', text: 'JA3ABC JA3ABC', start: 9, end: 11 }, // over the first one's head
      { id: 2, call: 'JH3ABD', text: 'JH3ABD', start: 10.6, end: 13 }, // came in after the head: it heard us
      { id: 1, call: 'JA3ABC', text: 'R 599', start: 22.5, end: 24 }, // answered the second
    ];
    const marked = withOverlaps(steps, txs);
    expect(marked.map((item) => item.over!.map((tx) => tx.call))).toEqual([['JA3ABC'], []]);
    const result = { contacts: [], missed: [], stats: { contacts: 0, rate: 0, busts: 0, nil: 0, hijacks: 0 } } as unknown as PileupResult;
    const stats = reviewStats(pickGroups(marked, result), result);
    expect(stats.doubledPicks).toBe(1);
    expect(nextPractice({ ...stats, doubledPicks: 2 }, 'dx')).toMatch(/呼び終わる/);
  });
});
