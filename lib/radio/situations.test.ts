import { describe, expect, it } from 'vitest';
import type { CopySituation } from '../types';
import { conditionContrast, forWeakAnalysis, qsoConditionBreakdown, weakPairs } from '../analytics';
import { causeOf, collectEvidence, fieldAnswers, hardestSituation, mergeEvidence, type CharCell, type FieldResult } from './attribution';
import { situationOf } from './conditions';
import { emptyQsoProfile, updateSkills } from './skills';

const NO_TX = { total: 0, onFrequency: 0, procedure: 0 };
const ENV = { snr: 4, qrm: 0, qsb: 0, qrn: 0, offset: 0 };
const conditionOf = (situation: CopySituation) => (situation === 'doubled' ? 'muted' : situation);

/** A field whose characters went through `situations` (one per character, the last repeated). */
const field = (key: string, expected: string, input: string, situations: CopySituation[]): FieldResult => ({
  key,
  label: key,
  expected,
  input,
  correct: expected === input,
  cells: [...expected].map((char, index): CharCell => {
    const situation = situations[Math.min(index, situations.length - 1)];
    const ok = input[index] === char;
    return { op: ok ? 'match' : 'sub', expected: char, input: input[index] ?? '', condition: conditionOf(situation), situation, cause: ok ? 'ok' : causeOf(situation), env: null };
  }),
});

const answers = (fields: FieldResult[]) =>
  fieldAnswers(fields, { sessionId: 's', timestamp: 0, wpm: 20, modeId: 'cq-run', presetId: 'basic', alphabet: 'international' });

describe('copy situations', () => {
  it('tells a doubling from band QRM', () => {
    expect(situationOf('muted', null)).toBe('doubled');
    expect(situationOf('qrm', { ...ENV, qrm: 1.2, qrmFrom: 'caller' })).toBe('doubled');
    expect(situationOf('qrm', { ...ENV, qrm: 1.2, qrmFrom: 'band' })).toBe('qrm');
    expect(situationOf('qsb', { ...ENV, qsb: 0.5 })).toBe('qsb');
    expect(causeOf('doubled')).toBe('doubling');
    expect(causeOf('qrm')).toBe('environment');
    expect(causeOf('clean')).toBe('copy');
    expect(hardestSituation(['clean', 'qsb', 'doubled', 'weak'])).toBe('doubled');
  });

  it('keeps doubled characters out of clean copy and band robustness, and sorts calls by their hardest character', () => {
    const fields = [
      field('call', 'JA1ABC', 'JA1AXC', ['clean', 'clean', 'clean', 'clean', 'doubled', 'clean']),
      field('name', 'TARO', 'TARO', ['qsb']),
      field('qth', 'TOKYO', 'TOKXO', ['clean']),
    ];
    const evidence = collectEvidence(fields, NO_TX);
    expect(evidence.clean).toEqual({ total: 10, correct: 9 });
    expect(evidence.doubled).toEqual({ total: 1, correct: 0 });
    expect(evidence.env).toEqual({ qsb: { total: 4, correct: 4 } });
    expect(evidence.causes).toMatchObject({ copy: 1, doubling: 1, environment: 0 });
    expect(evidence.calls!.log).toEqual({ doubled: { total: 1, correct: 0 } });

    const merged = mergeEvidence([evidence, collectEvidence([field('call', 'JH3XYZ', 'JH3XYZ', ['clean'])], NO_TX)], NO_TX);
    expect(merged.calls!.log).toEqual({ doubled: { total: 1, correct: 0 }, clean: { total: 1, correct: 1 } });
    expect(merged.doubled).toEqual({ total: 1, correct: 0 });
  });

  it('builds callsign skill per situation without touching the clean estimate', () => {
    const evidence = collectEvidence([field('call', 'JA1ABC', 'JA1ABC', ['clean'])], NO_TX);
    evidence.calls!.first = { clean: { total: 4, correct: 4 }, doubled: { total: 4, correct: 1 } };
    const { skills } = updateSkills(emptyQsoProfile(), { modeId: 'cq-run', alphabet: 'international', wpm: 20, evidence });
    expect(skills.callsign!.log.clean!.value).toBe(1);
    expect(skills.callsign!.first.clean!.value).toBe(1);
    expect(skills.callsign!.first.situations.doubled!.value).toBeCloseTo(0.25);
    expect(skills.callsign!.log.situations).toEqual({});
  });

  it('leaves hard-condition errors out of weak pairs but keeps them for contrast', () => {
    const fields: FieldResult[] = [];
    // R is copied fine in the clear and falls apart under QRM; C/K errors in the clear are real weak pairs.
    for (let index = 0; index < 8; index += 1) fields.push(field('name', 'R', 'R', ['clean']));
    for (let index = 0; index < 4; index += 1) fields.push(field('name', 'R', 'K', ['qrm']));
    for (let index = 0; index < 3; index += 1) fields.push(field('qth', 'C', 'K', ['clean']));
    for (let index = 0; index < 3; index += 1) fields.push(field('call', 'A', 'N', ['doubled']));
    const logs = answers(fields);
    expect(logs.every((log) => log.qso?.situation)).toBe(true);
    const clean = forWeakAnalysis(logs);
    expect(clean.every((log) => log.qso!.situation === 'clean')).toBe(true);
    expect(weakPairs(clean).map((pair) => [pair.a, pair.b].sort().join(''))).toEqual(['CK']);
    expect(conditionContrast(logs)).toEqual([expect.objectContaining({ symbol: 'R', situation: 'qrm', clean: 1, accuracy: 0 })]);
    const rows = qsoConditionBreakdown(logs);
    expect(rows.map((row) => row.condition).sort()).toEqual(['clean', 'doubled', 'qrm']);
    expect(qsoConditionBreakdown(logs, 'call')).toEqual([expect.objectContaining({ condition: 'doubled', answers: 3, accuracy: 0 })]);
  });
});
