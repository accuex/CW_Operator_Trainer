import { describe, expect, it } from 'vitest';
import type { AirEvent } from '../air/ether';
import { keyText } from '../keying';
import { DEFAULT_RUN_PARAMS, RunSession, type Placement } from '../modes/cqRun';
import { seeded } from '../random';
import { HeadlessRadio } from '../sim/runSim';
import { MAX_QSY_REQUESTS, type OccupantAgent } from './occupant';

const ME = { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };
const VFO = 7_012_000;
const QRL_ANSWERS = new Set(['QRL', 'YES', 'C', 'R QRL', 'YES QRL', 'QRL PSE']);

/** A run with residents placed and a clock we drive by hand. */
function setup(seed: number, placement: Placement = { onFrequency: true, nearby: 0, oneSided: false }) {
  const random = seeded(seed);
  const radio = new HeadlessRadio(random);
  const run = new RunSession({ random, me: ME, params: DEFAULT_RUN_PARAMS }, radio);
  radio.onTransmission = (station, tx) => run.onStationTransmission(station, tx);
  run.populate(VFO, 0, placement);
  const heard: AirEvent[] = [];
  let t = 0;
  const until = (end: number) => {
    for (; t < end; t = Math.round((t + 0.05) * 1000) / 1000) {
      radio.advance(t);
      heard.push(...run.tick(t));
    }
  };
  /** Wait for a gap where nobody is keying on `rf` (as the air has it), then send. */
  const send = (text: string, rf = VFO) => {
    const ear = { key: 'me' as const, listenRf: () => rf, rxWidth: 500 };
    while (run.ether.hearsKeying(ear, undefined, t) || run.ether.hearsKeying(ear, undefined, t + 0.3)) until(t + 0.05);
    const start = t + 0.05;
    const end = start + keyText(text, { wpm: 20 }).length;
    const result = run.transmit(text, { start, end, rf });
    return { ...result, end };
  };
  const after = (from: number) => heard.filter((event) => event.from !== 'me' && event.start >= from);
  return { run, radio, until, send, after, get t() { return t; } };
}

const pairOf = (run: RunSession) => run.occupants[0];
const isPair = (run: RunSession, event: AirEvent) => run.residents.some((agent) => agent.id === event.from);

describe('OccupantPair', () => {
  it('takes turns by ear and signs off, then leaves the frequency', () => {
    const sim = setup(1);
    sim.until(900);
    const overs = sim.after(0).filter((event) => isPair(sim.run, event));
    expect(overs.length).toBeGreaterThanOrEqual(6);
    // Strictly alternating speakers, last one a sign-off.
    overs.slice(1).forEach((event, index) => expect(event.from).not.toBe(overs[index].from));
    expect(overs[overs.length - 1].text).toMatch(/EE$/);
    expect(pairOf(sim.run).done).toBe(true);
    expect(sim.run.stations).toEqual([]);
  });

  it('answers a QRL? on its frequency once, and ignores one 1 kHz away', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const sim = setup(seed);
      sim.until(8);
      const { end } = sim.send('QRL? DE JS2WDR');
      sim.until(end + 12);
      const answers = sim.after(end).filter((event) => QRL_ANSWERS.has(event.text));
      expect(answers, `seed ${seed}`).toHaveLength(1);

      const away = setup(seed);
      away.until(8);
      const far = away.send('QRL? DE JS2WDR', VFO + 1000);
      away.until(far.end + 12);
      expect(away.after(far.end).filter((event) => QRL_ANSWERS.has(event.text))).toEqual([]);
    }
  });

  it('asks a CQ on top of it to QSY, a few times at most', () => {
    const sim = setup(2);
    sim.until(30);
    const first = sim.send('CQ CQ DE JS2WDR JS2WDR K');
    expect(first.issues).toContain('cq-without-qrl');
    sim.until(first.end + 25);
    expect(sim.after(first.end).some((event) => /QSY/.test(event.text))).toBe(true);
    for (let index = 0; index < MAX_QSY_REQUESTS + 2; index += 1) {
      const next = sim.send('CQ CQ DE JS2WDR JS2WDR K');
      sim.until(next.end + 25);
    }
    expect(pairOf(sim.run).qsyRequests).toBe(MAX_QSY_REQUESTS);
    expect(sim.run.finish(sim.t).stats.busyCqs).toBe(MAX_QSY_REQUESTS + 3);
  });

  it('flags a CQ after a QRL? was answered differently, and clears after QSY', () => {
    const sim = setup(3);
    sim.until(10);
    const qrl = sim.send('QRL? DE JS2WDR');
    sim.until(qrl.end + 6);
    expect(sim.send('CQ DE JS2WDR K').issues).toContain('busy-frequency');

    const moved = VFO + 1000;
    sim.send('QRL? DE JS2WDR', moved);
    sim.until(sim.t + 6);
    const cq = sim.send('CQ DE JS2WDR K', moved);
    expect(cq.issues).toEqual([]);
    const result = sim.run.finish(sim.t);
    expect(result.frequencies.map((use) => [use.rf, use.qrlFirst, use.busyCqs])).toEqual([[VFO, true, 1], [moved, true, 0]]);
  });

  it('lets the side we barely hear answer now and then (one-sided)', () => {
    let faint = 0;
    let answered = 0;
    for (let seed = 1; seed <= 40; seed += 1) {
      const sim = setup(seed, { onFrequency: true, nearby: 0, oneSided: true });
      sim.until(8);
      const { end } = sim.send('QRL? DE JS2WDR');
      sim.until(end + 12);
      const answer = sim.after(end).find((event) => QRL_ANSWERS.has(event.text));
      if (!answer) continue;
      answered += 1;
      const pair = pairOf(sim.run);
      const weak = pair[pair.faint!] as OccupantAgent;
      if (answer.from === weak.id) faint += 1;
    }
    expect(answered).toBeGreaterThan(30);
    expect(faint).toBeGreaterThan(answered * 0.15);
    expect(faint).toBeLessThan(answered * 0.85);
  });

  it('places QSOs nearby that keep clear of our frequency', () => {
    const sim = setup(4, { onFrequency: false, nearby: 2 });
    expect(sim.run.occupants).toHaveLength(2);
    for (const pair of sim.run.occupants) expect(Math.abs(pair.rf - VFO)).toBeGreaterThan(600);
    sim.until(30);
    expect(sim.run.frequencyBusy(VFO, sim.t)).toBe(false);
    expect(sim.run.frequencyBusy(sim.run.occupants[0].rf, sim.t)).toBe(true);
  });
});
