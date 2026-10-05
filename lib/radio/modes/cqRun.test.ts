import { describe, expect, it } from 'vitest';
import { DEFAULT_RUN_PARAMS, RunSession, type RadioPort } from './cqRun';
import { seeded } from '../random';

const ME = { call: 'JA1ZZZ', name: 'MASA', qth: 'TOKYO' };
const radio: RadioPort = { now: () => 0, send: () => {}, stationsChanged: () => {} };
const session = (seed: number) => new RunSession({ random: seeded(seed), me: ME, params: DEFAULT_RUN_PARAMS }, radio);
const at = { start: 0, end: 1, rf: 7_012_000 };

describe('RunSession arrivals', () => {
  it('brings λ callers per CQ and half that per QRZ?', () => {
    const cq = session(1);
    for (let index = 0; index < 1500; index += 1) cq.transmit('CQ DE JA1ZZZ K', at);
    expect(cq.agents.length / 1500).toBeCloseTo(DEFAULT_RUN_PARAMS.callers, 1);

    const qrz = session(2);
    for (let index = 0; index < 1500; index += 1) qrz.transmit('QRZ? DE JA1ZZZ K', at);
    expect(qrz.agents.length / 1500).toBeCloseTo(DEFAULT_RUN_PARAMS.callers / 2, 1);
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
