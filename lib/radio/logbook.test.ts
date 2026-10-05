import { describe, expect, it } from 'vitest';
import type { QsoSessionSummary, SessionRecord } from '../types';
import { logbookEntries } from './logbook';

const summary = (over: Partial<QsoSessionSummary> = {}): QsoSessionSummary => ({
  modeId: 'ragchew', presetId: 'basic-rst-name-qth', call: 'JA3ABC', outcome: 'complete', fields: 4, fieldsCorrect: 3,
  cleanAccuracy: 1, causes: { copy: 0, environment: 0, tuning: 0, timing: 0, procedure: 0 }, difficulty: {}, adjusted: {}, ...over,
});
const session = (id: string, qso?: QsoSessionSummary): SessionRecord => ({
  id, startedAt: 0, endedAt: 500, mode: 'qso', alphabetType: 'international', answers: 0, accuracy: 0, qso,
} as SessionRecord);

describe('logbookEntries', () => {
  it('treats a legacy session as one contact and skips non-QSO sessions', () => {
    const entries = logbookEntries([session('a', summary()), session('b')]);
    expect(entries).toEqual([{ id: 'a:0', sessionId: 'a', modeId: 'ragchew', call: 'JA3ABC', fields: 4, fieldsCorrect: 3, outcome: 'complete', at: 500 }]);
  });

  it('expands every contact of a run', () => {
    const contacts = [
      { call: 'K1AA', fields: 3, fieldsCorrect: 3, outcome: 'complete' as const, at: 100 },
      { call: 'DL2BB', fields: 3, fieldsCorrect: 2, outcome: 'partial' as const, at: 200 },
    ];
    const entries = logbookEntries([session('r', summary({ modeId: 'cq-run', contacts }))]);
    expect(entries.map((entry) => [entry.id, entry.call, entry.modeId])).toEqual([['r:0', 'K1AA', 'cq-run'], ['r:1', 'DL2BB', 'cq-run']]);
  });
});
