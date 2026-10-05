import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_PARAMS, RunSession, type RadioPort } from './cqRun';
import { seeded } from '../random';

const ME = { call: 'JA1ZZZ', name: 'MASA', qth: 'TOKYO' };
const radio: RadioPort = { now: () => 0, send: () => {}, stationsChanged: () => {} };
const session = (seed: number) => new RunSession({ random: seeded(seed), me: ME, params: DEFAULT_RUN_PARAMS }, radio);
const at = { start: 0, end: 1, rf: 7_012_000 };

describe('RunSession arrivals', () => {
  it('brings callers per minute on the air, however fast we CQ', () => {
    const perMinute = (seed: number, text: string, every: number) => {
      const run = session(seed);
      for (let index = 0; index < 6000; index += 1) run.transmit(text, { ...at, start: index * every, end: index * every + 1 });
      return run.agents.length / ((6000 * every) / 60);
    };
    const { arrivals } = DEFAULT_RUN_PARAMS;
    const near = (value: number, expected: number) => expect(Math.abs(value / arrivals - expected)).toBeLessThan(0.12 * expected);
    near(perMinute(1, 'CQ DE JA1ZZZ K', 10), 1);
    near(perMinute(2, 'CQ DE JA1ZZZ K', 4), 1);
    near(perMinute(3, 'R TU 73 DE JA1ZZZ QRZ?', 10), 1);
    // A bare QRZ? is found by half as many; listeners who heard us too long ago have gone.
    near(perMinute(4, 'QRZ?', 10), 0.5);
    near(perMinute(5, 'CQ DE JA1ZZZ K', 90), 0.5);
  });

  it('brings nobody to a CQ without our call, and says so', () => {
    const run = session(3);
    for (let index = 0; index < 50; index += 1) expect(run.transmit('CQ CQ K', at).issues).toEqual(['cq-without-call']);
    expect(run.agents).toHaveLength(0);
  });

  it('logs a call nobody worked as NIL', () => {
    const run = session(4);
    run.logEntry({ call: 'JQ9QQQ', rst: '599', name: 'X', qth: 'Y' }, 0);
    const result = run.finish(10);
    expect(result.log[0].verdict).toBe('nil');
    expect(result.stats.nil).toBe(1);
  });
});
