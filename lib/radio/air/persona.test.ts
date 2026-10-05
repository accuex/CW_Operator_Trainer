import { describe, expect, it } from 'vitest';
import { isCallsign, isNearCall } from './intent';
import { lookAlike, MAX_WPM, RandomPersonaSource } from './persona';
import { MIN_TARGET_WPM, QTH_AREA } from '../qso';
import { seeded } from '../random';

describe('RandomPersonaSource', () => {
  const random = seeded(5);
  const source = new RandomPersonaSource(0.3);
  const spread = 80;
  const active: string[] = [];
  const people = Array.from({ length: 600 }, () => {
    const persona = source.next({ random, speed: 22, weak: 0.4, spread, active: active.slice(-4) });
    active.push(persona.call);
    return persona;
  });

  it('keeps every value in range', () => {
    for (const p of people) {
      expect(Math.abs(p.offsetHz)).toBeLessThanOrEqual(spread);
      expect(p.wpm).toBeGreaterThanOrEqual(MIN_TARGET_WPM);
      expect(p.wpm).toBeLessThanOrEqual(MAX_WPM);
      expect(p.qrsFloor).toBeLessThanOrEqual(p.wpm);
      expect(p.strength).toBeGreaterThanOrEqual(0.025);
      expect(p.strength).toBeLessThanOrEqual(1);
      expect(p.patience).toBeGreaterThanOrEqual(2);
      expect(p.patience).toBeLessThanOrEqual(5);
      expect(p.rxWidth).toBeGreaterThanOrEqual(250);
      expect(p.rxWidth).toBeLessThanOrEqual(500);
      expect(p.reaction[0]).toBeLessThan(p.reaction[1]);
    }
  });

  it('hands out valid, unique calls whose QTH fits the call area', () => {
    expect(new Set(people.map((p) => p.call)).size).toBe(people.length);
    for (const p of people) {
      expect(isCallsign(p.call)).toBe(true);
      const area = QTH_AREA.find(([qth]) => qth === p.qth)?.[1];
      if (area !== undefined) expect(area).toBe(p.area);
    }
  });

  it('spreads offsets around zero', () => {
    const mean = people.reduce((sum, p) => sum + p.offsetHz, 0) / people.length;
    expect(Math.abs(mean)).toBeLessThan(10);
    expect(people.some((p) => Math.abs(p.offsetHz) > spread / 2)).toBe(true);
  });

  it('includes some novices and some look-alikes', () => {
    expect(people.some((p) => p.style === 'novice')).toBe(true);
    const lookAlikes = people.filter((p, index) => active.slice(Math.max(0, index - 4), index).some((call) => isNearCall(p.call, call)));
    expect(lookAlikes.length).toBeGreaterThan(20);
  });
});

describe('lookAlike', () => {
  it('stays one or two letters off', () => {
    const random = seeded(8);
    for (let index = 0; index < 200; index += 1) {
      const other = lookAlike('JH3ABC', random);
      if (other === null) continue;
      expect(isNearCall(other, 'JH3ABC')).toBe(true);
    }
  });
});
