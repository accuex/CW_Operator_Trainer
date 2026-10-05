import { describe, expect, it } from 'vitest';
import { CopyMonitor } from './conditions';
import { DEFAULT_DIFFICULTY } from './difficulty';
import { BASIC_RST_NAME_QTH } from './exchange';
import { fillMemory, memoryTemplates, MEMORY_KEYS } from './memories';
import { runSummary, scoreRun } from './runReview';
import { runSim } from './sim/runSim';

describe('scoreRun / runSummary', () => {
  const report = runSim({ seed: 3, bot: { phantomRate: 1 } });
  const { result } = report;
  const score = scoreRun({
    result, preset: BASIC_RST_NAME_QTH, recordsOf: () => [], monitor: new CopyMonitor(), now: { t: 0, epoch: 0 }, tx: { total: report.tx, procedure: 0 },
  });

  it('judges one log line per contact and never a NIL line', () => {
    expect(score.contacts).toHaveLength(result.contacts.length);
    for (const contact of score.contacts) {
      expect(contact.fields).not.toBeNull();
      // The bot logs exactly what was sent.
      expect(contact.fields!.every((field) => field.correct)).toBe(true);
    }
    const nilIds = result.log.filter((entry) => entry.verdict === 'nil').map((entry) => entry.id);
    expect(nilIds.length).toBeGreaterThan(0);
    expect(score.contacts.some((contact) => contact.logId && nilIds.includes(contact.logId))).toBe(false);
  });

  it('summarises the run for sync', () => {
    const summary = runSummary({
      result, score, modeId: 'cq-run', presetId: BASIC_RST_NAME_QTH.id, fieldCount: 4, difficulty: DEFAULT_DIFFICULTY, wallClock: (t) => 1_000_000 + t * 1000,
    });
    expect(summary.contacts).toHaveLength(result.contacts.length);
    expect(summary.contacts!.every((contact) => contact.fieldsCorrect === 4 && contact.outcome === 'complete')).toBe(true);
    expect(summary.run!.nil).toBe(result.stats.nil);
    expect(summary.fields).toBe(result.contacts.length * 4);
    expect(summary.outcome).toBe('complete');
  });
});

describe('memory keys', () => {
  it('fills slots and drops empty ones', () => {
    const vars = { CALL: 'jh3abc', MYCALL: 'JA1ZZZ', RST: '599', MYNAME: 'MASA', MYQTH: 'TOKYO' };
    expect(fillMemory(MEMORY_KEYS[0].template, vars)).toBe('CQ CQ DE JA1ZZZ JA1ZZZ K');
    expect(fillMemory(MEMORY_KEYS[1].template, vars)).toBe('JH3ABC DE JA1ZZZ UR 599 599 NAME MASA MASA QTH TOKYO TOKYO BK');
    expect(fillMemory(MEMORY_KEYS[2].template, vars)).toBe('R TNX 73 TU DE JA1ZZZ QRZ?');
    expect(fillMemory('{call}', { CALL: '3AB?' })).toBe('3AB?');
  });

  it('falls back to defaults for missing templates', () => {
    expect(memoryTemplates(['CQ TEST {MYCALL}', '', 5])).toEqual(['CQ TEST {MYCALL}', ...MEMORY_KEYS.slice(1).map((memory) => memory.template)]);
    expect(memoryTemplates(null)).toHaveLength(8);
  });
});
