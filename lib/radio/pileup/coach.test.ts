import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRESH_COACH, idleTip, IDLE_SECONDS, tipAfterSend, type CoachLevel, type CoachMemory } from './coach';
import { afterSend, nextAction, START, type PickState } from './nextAction';

const ME = 'JS2WDR';

/** Type and press Enter through a script; the tips that came up. */
function play(level: CoachLevel, script: string[]) {
  let state: PickState = START;
  let memory: CoachMemory = FRESH_COACH;
  const tips: (string | null)[] = [];
  for (const call of script) {
    const action = nextAction(state, { call, rst: call && state.phase === 'working' ? '599' : '' }, ME);
    state = afterSend(state, action);
    const result = tipAfterSend(level, memory, action, state);
    memory = result.memory;
    tips.push(result.tip);
  }
  return tips;
}

describe('coach', () => {
  it('follows our own messages', () => {
    expect(play('always', ['', '3A', '3AB', 'JA3ABC'])).toEqual([null, 'partial', 'partial', 'picked']);
  });

  it('notices the same piece three times', () => {
    expect(play('always', ['', '3A', '3A', '3A'])).toEqual([null, 'partial', 'partial', 'samePiece']);
  });

  it('notices QRZ? three times running (CQ counts)', () => {
    expect(play('always', ['', '', ''])).toEqual([null, null, 'qrzRun']);
  });

  it('"once" gives each tip once a run; "off" none', () => {
    expect(play('once', ['', '3A', '3AB', 'JA3ABC', 'JA3ABC', '', '3B'])).toEqual([null, 'partial', null, 'picked', null, null, null]);
    expect(play('off', ['', '3A', '3A', '3A', 'JA3ABC', '', '', ''])).toEqual(Array(8).fill(null));
  });

  it('the idle tip: listening with nothing typed for a while', () => {
    const listening: PickState = { phase: 'listening', sentCall: null, path: [] };
    expect(idleTip('always', FRESH_COACH, listening, false, IDLE_SECONDS).tip).toBe('idle');
    expect(idleTip('always', FRESH_COACH, listening, false, IDLE_SECONDS - 1).tip).toBeNull();
    expect(idleTip('always', FRESH_COACH, listening, true, 30).tip).toBeNull();
    expect(idleTip('always', FRESH_COACH, { ...listening, path: ['3A'] }, false, 30).tip).toBeNull();
    expect(idleTip('always', FRESH_COACH, START, false, 30).tip).toBeNull();
    const once = idleTip('once', FRESH_COACH, listening, false, 30);
    expect(idleTip('once', once.memory, listening, false, 30).tip).toBeNull();
  });

  it('knows nothing of the stations', () => {
    const source = readFileSync(new URL('./coach.ts', import.meta.url), 'utf8');
    expect([...source.matchAll(/from '([^']+)'/g)].map((match) => match[1])).toEqual(['./nextAction']);
  });
});
