import { describe, expect, it } from 'vitest';
import type { CopyCondition } from '../types';
import { BADGES, BADGE_CRITERIA_VERSION, MARK_COUNT, badgeTier, nextTier, recordQsoOutcome, tierFor, type QsoOutcome } from './badges';
import type { CharCell, FieldResult } from './attribution';
import { emptyQsoProfile } from './skills';

const field = (key: string, expected: string, input = expected, condition: CopyCondition = 'clean'): FieldResult => ({
  key,
  label: key,
  expected,
  input,
  correct: expected === input,
  cells: [...expected].map((char, index): CharCell => {
    const ok = input[index] === char;
    return { op: ok ? 'match' : 'sub', expected: char, input: input[index] ?? '', condition, cause: ok ? 'ok' : 'copy', env: null };
  }),
});

const outcome = (over: Partial<QsoOutcome> = {}): QsoOutcome => ({
  fields: [field('call', 'JA3ABC'), field('rst', '599'), field('name', 'TARO'), field('qth', 'OSAKA')],
  evidence: { clean: { total: 18, correct: 18 }, env: {}, causes: { copy: 0, environment: 0, tuning: 0, timing: 0, procedure: 0 }, tx: { total: 2, onFrequency: 2 } },
  alphabet: 'international',
  wpm: 20,
  tx: [{ offsetHz: 10 }, { offsetHz: -5 }],
  complete: true,
  at: 1000,
  ...over,
});

const speed = BADGES.find((badge) => badge.id === 'speed')!;

describe('QSO badges', () => {
  it('counts a clean, accurate QSO toward every speed step it reached', () => {
    const { qso } = recordQsoOutcome(emptyQsoProfile(), outcome({ wpm: 21 }));
    expect(qso.stats?.fastClean).toEqual({ 15: 18, 20: 18 });
    expect(qso.stats).toMatchObject({ zeroIn: 1, freehand: 1, callsign: 1 });
  });

  it('ignores sloppy QSOs for speed and macro or off-frequency QSOs for handcraft', () => {
    const sloppy = outcome({
      evidence: { ...outcome().evidence, clean: { total: 18, correct: 15 } },
      tx: [{ offsetHz: 80, macro: true }, { offsetHz: 0, issue: 'off-frequency' }],
    });
    const { qso } = recordQsoOutcome(emptyQsoProfile(), sloppy);
    expect(qso.stats?.fastClean).toEqual({});
    expect(qso.stats).toMatchObject({ zeroIn: 0, freehand: 0 });
  });

  it('credits an environment only when that condition held up in the QSO', () => {
    const evidence = { ...outcome().evidence, env: { qrm: { total: 10, correct: 9 }, qsb: { total: 10, correct: 5 } } };
    const { qso } = recordQsoOutcome(emptyQsoProfile(), outcome({ evidence }));
    expect(qso.stats?.envCorrect).toEqual({ qrm: 9 });
  });

  it('awards tiers in order, records the criteria version and never revokes', () => {
    let qso = emptyQsoProfile();
    const earned: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const result = recordQsoOutcome(qso, outcome({ wpm: 16 }));
      qso = result.qso;
      earned.push(...result.earned.map((badge) => `${badge.id}:${badge.tier}`));
    }
    // 10 QSOs earn the counters; 18 clean chars × 12 passes 200 for speed.
    expect(earned).toEqual(['zero-in:1', 'freehand:1', 'callsign:1', 'speed:1']);
    expect(qso.badges?.speed).toMatchObject({ tier: 1, criteriaVersion: BADGE_CRITERIA_VERSION });
    expect(nextTier(speed, qso)).toMatchObject({ tier: 2, value: 0, goal: 200 });
    // Stored tier survives counters that no longer support it (e.g. stricter criteria).
    const reset = { ...qso, stats: { ...qso.stats!, fastClean: {} } };
    expect(tierFor(speed, reset.stats)).toBe(0);
    expect(badgeTier(speed, reset)).toBe(1);
  });

  it('marks characters after enough clean, correct copies at speed', () => {
    let qso = emptyQsoProfile();
    const marked: string[] = [];
    const slow = recordQsoOutcome(qso, outcome({ wpm: 16 }));
    expect(slow.qso.charMarks).toEqual({});
    for (let index = 0; index < MARK_COUNT; index += 1) {
      const result = recordQsoOutcome(qso, outcome({ fields: [field('call', 'JA3ABC', 'JA3ABD'), field('qth', 'KOBE', 'KOBE', 'qrm')] }));
      qso = result.qso;
      marked.push(...result.marked);
    }
    // A appears twice per QSO, so it is marked first; C was miscopied, KOBE was under QRM.
    expect(marked).toEqual(['A', 'J', '3', 'B']);
    expect(qso.charMarks?.['international:A']?.count).toBe(MARK_COUNT * 2);
    expect(qso.charMarks?.['international:C']).toBeUndefined();
    expect(qso.charMarks?.['international:K']).toBeUndefined();
  });
});
