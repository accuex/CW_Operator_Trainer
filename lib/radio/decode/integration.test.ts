import { describe, expect, it } from 'vitest';
import type { AnswerLog, QsoAssist, QsoPileupSummary } from '../../types';
import { conditionContrast, hiddenByCondition, pileupBreakdown, qsoConditionBreakdown } from '../../analytics';
import type { FieldResult } from '../attribution';
import { recordQsoOutcome, recordRunOutcome } from '../badges';
import { adjustDifficulty, type DifficultyVector, type QsoEvidence } from '../difficulty';
import { normalizeQsoProfile } from '../skills';
import { assistedAnswers, outcomeWithoutCopy, withoutCopy } from './assist';
import { runDecodeSim } from './sim';

/**
 * Integration QA (QSO / Wabun / DECODE): what a session where DECODE printed may and
 * may not move outside the skills — badges, 実戦マーク, the analysis screens, おまかせ
 * across several QSOs — and what the decoder carries from one session into the next.
 */

const SHOWN: QsoAssist = { decode: 'shown', decodeUsed: true, decodeSeconds: 60, decodeShown: 40, loggedShown: 2 };
const OVER = 'JA1ZZZ DE JF8QNW GM UR RST 579 579 NAME TARO TARO QTH SAPPORO HW? BK';

const cells = (text: string) => [...text].map((char) => ({ op: 'match', expected: char, input: char, condition: 'clean' }));
const field = (key: string, value: string): FieldResult => ({ key, label: key, expected: value, input: value, correct: true, cells: cells(value) as never });
const evidence: QsoEvidence = {
  clean: { total: 40, correct: 40 },
  env: { qsb: { total: 10, correct: 10 } },
  causes: { copy: 0, environment: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 },
  tx: { total: 3, onFrequency: 3 },
};
const outcome = {
  fields: [field('call', 'JF8QNW'), field('name', 'TARO'), field('qth', 'SAPPORO')], evidence, alphabet: 'international' as const,
  wpm: 25, tx: [{ offsetHz: 0 }, { offsetHz: 5 }, { offsetHz: 0 }], complete: true, at: 1,
};

describe('DECODE shown: badges and 実戦マーク', () => {
  it('a QSO: no 実戦マーク, call, speed or band credit; zero-in and hand keying still count', () => {
    const profile = normalizeQsoProfile(undefined);
    const plain = recordQsoOutcome(profile, outcome).qso;
    const assisted = recordQsoOutcome(profile, outcomeWithoutCopy(outcome)).qso;
    expect(Object.keys(plain.charMarks ?? {}).length).toBeGreaterThan(0);
    expect(plain.stats?.callsign).toBe(1);
    expect(plain.stats?.fastClean?.[25]).toBe(40);
    expect(plain.stats?.envCorrect?.qsb).toBe(10);
    expect(assisted.charMarks ?? {}).toEqual(profile.charMarks ?? {});
    expect(assisted.stats?.callsign ?? 0).toBe(0);
    expect(assisted.stats?.fastClean?.[25] ?? 0).toBe(0);
    expect(assisted.stats?.envCorrect?.qsb ?? 0).toBe(0);
    // Tuning and procedure are the operator's own, screen or no screen.
    expect(assisted.stats?.zeroIn).toBe(1);
    expect(assisted.stats?.freehand).toBe(1);
  });

  it('a run: its contacts give no copy credit; the run itself is still counted', () => {
    const profile = normalizeQsoProfile(undefined);
    const run = { alphabet: 'international' as const, at: 1, seconds: 900, frequencyChecks: 2, busyAvoided: 1, cleanContacts: 0, cleanRate: 0 };
    const contact = { fields: outcome.fields, evidence, wpm: 25, complete: true };
    const plain = recordRunOutcome(profile, { ...run, contacts: [contact, contact] });
    const assisted = recordRunOutcome(profile, { ...run, contacts: [contact, contact].map(outcomeWithoutCopy) });
    expect(plain.qso.stats?.callsign).toBe(2);
    expect(assisted.qso.stats?.callsign ?? 0).toBe(0);
    expect(assisted.marked).toEqual([]);
    expect(assisted.qso.stats?.frequencyChecks).toBe(3);
  });
});

describe('DECODE shown: the analysis screens', () => {
  const log = (isCorrect: boolean, symbol = 'R', condition = 'clean'): AnswerLog => ({
    id: `${Math.random()}`, correctSymbol: symbol, isCorrect, qso: { modeId: 'ragchew', presetId: 'p', field: 'name', condition, situation: condition },
  }) as unknown as AnswerLog;

  it('condition rows and "fine normally, not under X" leave the assisted characters out', () => {
    const own = [log(true), log(true), log(false, 'R', 'qsb')];
    const assisted = assistedAnswers([log(false), log(false), log(false)], SHOWN);
    const rows = qsoConditionBreakdown([...own, ...assisted]);
    expect(rows.find((row) => row.condition === 'clean')).toEqual({ condition: 'clean', answers: 2, accuracy: 1 });
    // Assisted clean misses would have hidden the contrast; assisted QSB hits would have masked it.
    const ear = [...Array.from({ length: 6 }, () => log(true)), ...Array.from({ length: 3 }, () => log(false, 'R', 'qsb'))];
    const screen = assistedAnswers([...Array.from({ length: 6 }, () => log(false)), ...Array.from({ length: 6 }, () => log(true, 'R', 'qsb'))], SHOWN);
    expect(conditionContrast([...ear, ...screen]).map((row) => row.symbol)).toEqual(['R']);
  });

  it('the "含める（N字）" count is what the switch adds: assisted characters never are', () => {
    const own = [log(true), log(false, 'R', 'qsb'), log(true, 'R', 'qrm')];
    const assisted = assistedAnswers([log(false), log(false, 'R', 'qsb')], SHOWN);
    expect(hiddenByCondition([...own, ...assisted])).toBe(2);
  });

  it('pileup findings leave out a run where DECODE printed', () => {
    const pileup = (correct: number): QsoPileupSummary => ({
      level: 'p1', picks: 10, doubledPicks: 0, partials: 0, emptyPartials: 0, crowdedPartials: 0, narrowings: 0, narrowed: 0,
      firstCall: { '1': { total: 5, correct } }, similarMet: 0, similarRight: 0, hijacks: 0, eager: 0, lid: 0, causes: {}, cleanRate: 0,
    });
    const sessions = [{ qso: { pileup: pileup(2) } }, { qso: { pileup: pileup(5), assist: SHOWN } }] as never;
    const breakdown = pileupBreakdown(sessions)!;
    expect(breakdown.runs).toBe(1);
    expect(breakdown.firstCall['1']).toEqual({ total: 5, correct: 2 });
  });
});

describe('DECODE × おまかせ over several QSOs', () => {
  const start = { difficulty: { speed: 18, drift: 0.2 } as unknown as DifficultyVector, votes: {} as Record<string, number> };
  const good = evidence;
  const poor: QsoEvidence = { ...evidence, clean: { total: 40, correct: 20 } };

  it('OFF / shown / OFF / shown / OFF: a shown QSO votes nothing on copy and keeps the votes it found', () => {
    let state = start;
    const steps: { moved: Record<string, number>; votes: Record<string, number> }[] = [];
    for (const [shown, measured] of [[false, good], [true, poor], [false, good], [true, poor], [false, good]] as const) {
      const result = adjustDifficulty(state, shown ? withoutCopy(measured) : measured);
      steps.push({ moved: result.moved as Record<string, number>, votes: result.votes as Record<string, number> });
      state = result;
    }
    // 1: a first vote. 2 (shown, the copy was poor): neither a pass nor a fail — the vote stands untouched.
    expect(steps[0].votes.speed).toBe(1);
    expect(steps[1].votes.speed).toBe(1);
    expect(steps[1].moved.speed).toBeUndefined();
    // 3: the second QSO measured by ear agrees → the speed moves (two measured QSOs, not the shown one).
    expect(steps[2].moved.speed).toBe(1);
    // 4 (shown) never starts a new streak on its own; 5 is a first vote again.
    expect(steps[3].votes.speed ?? 0).toBe(0);
    expect(steps[4].moved.speed).toBeUndefined();
    expect(steps[4].votes.speed).toBe(1);
  });

  it('shown QSOs alone never move a copy axis, however many in a row; tuning still votes', () => {
    let state = start;
    let drift = 0;
    for (let index = 0; index < 6; index += 1) {
      const result = adjustDifficulty(state, withoutCopy(poor));
      expect(result.moved.speed).toBeUndefined();
      expect(result.moved.qsb).toBeUndefined();
      drift += result.moved.drift ? 1 : 0;
      state = result;
    }
    expect(state.votes.speed ?? 0).toBe(0);
    // Every QSO on frequency: the tuning axis moves as it would without DECODE.
    expect(drift).toBe(3);
  });
});

describe('DECODE: what one session leaves for the next', () => {
  it('a new session forgets AUTO\'s speed estimate; a LOCKed speed is the operator\'s and stays', () => {
    const fast = runDecodeSim({ seed: 21, noise: 0.2, decoderWpm: 15, stations: [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 30, strength: 0.7 }] });
    const auto = fast.decoder!;
    expect(auto.wpm).toBeGreaterThan(25);
    auto.reset(true);
    expect(auto.wpm).toBe(15);
    expect(auto.chars).toHaveLength(0);

    const again = runDecodeSim({ seed: 21, noise: 0.2, decoderWpm: 15, stations: [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 30, strength: 0.7 }] }).decoder!;
    again.setSpeed('lock');
    const held = again.wpm;
    again.reset(true);
    expect(again.wpm).toBe(held);
    // A power cycle (same session) keeps AUTO's estimate: only the signal is forgotten.
    const cycled = runDecodeSim({ seed: 21, noise: 0.2, decoderWpm: 15, stations: [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 30, strength: 0.7 }] }).decoder!;
    const before = cycled.wpm;
    cycled.reset();
    expect(cycled.wpm).toBe(before);
  });
});
