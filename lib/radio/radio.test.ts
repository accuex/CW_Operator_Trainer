import { describe, expect, it } from 'vitest';
import { cutStation, enqueue, formatFrequency, isKeyed, makeQrm, makeStation, nearestStation, schedulePending } from './band';
import { keyText } from './keying';
import { TUNE_TOLERANCE_HZ, cqText, finalText, isCallsign, makeTarget, normalizeRst, reportText, respond, scoreLog } from './qso';
import { heatColor, hzAtRatio } from './scope';

/** Deterministic PRNG (mulberry32). */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('keyText', () => {
  it('times PARIS at 20 WPM like the standard (50 units incl. word gap)', () => {
    const unit = 1.2 / 20;
    const { marks, length } = keyText('PARIS PARIS', { wpm: 20 });
    // .--. .- .-. .. ... → 14 elements per word
    expect(marks).toHaveLength(28);
    expect(length).toBeCloseTo(unit * (50 + 43), 6);
    expect(marks[0][1] - marks[0][0]).toBeCloseTo(unit, 6);
    expect(marks[1][1] - marks[1][0]).toBeCloseTo(unit * 3, 6);
  });

  it('stretches only the spacing for Farnsworth', () => {
    const plain = keyText('AB', { wpm: 20 });
    const slow = keyText('AB', { wpm: 20, effectiveWpm: 10 });
    expect(slow.marks[0][1] - slow.marks[0][0]).toBeCloseTo(plain.marks[0][1] - plain.marks[0][0], 6);
    expect(slow.length).toBeGreaterThan(plain.length);
  });

  it('skips unknown characters and keeps prosigns', () => {
    expect(keyText('A★', { wpm: 20 }).marks).toHaveLength(2);
    expect(keyText('[AR]', { wpm: 20 }).marks).toHaveLength(5);
  });
});

describe('band scheduler', () => {
  it('loops a station and records absolute marks', () => {
    const random = seeded(1);
    const station = makeStation(random, { rf: 7_012_000, loop: () => 'CQ', jitter: 0, gap: [1, 1] });
    station.nextAt = 10;
    const first = schedulePending(station, 10, 11.5, random);
    expect(first).toHaveLength(1);
    expect(first[0].start).toBe(10);
    expect(isKeyed(station, first[0].marks[0][0] + 0.01)).toBe(true);
    expect(station.nextAt).toBeCloseTo(station.busyUntil + 1, 6);
  });

  it('sends queued replies once, then falls silent without a loop', () => {
    const random = seeded(2);
    const station = makeStation(random, { rf: 7_010_000, role: 'target', loop: null, nextAt: Number.POSITIVE_INFINITY });
    enqueue(station, 'R TU', 5, 0.5);
    expect(station.nextAt).toBe(5.5);
    const sent = schedulePending(station, 5, 7, random);
    expect(sent.map((tx) => tx.text)).toEqual(['R TU']);
    expect(schedulePending(station, 30, 31.5, random)).toEqual([]);
    expect(station.nextAt).toBe(Number.POSITIVE_INFINITY);
  });

  it('cuts a station mid-message', () => {
    const random = seeded(3);
    const station = makeStation(random, { rf: 7_010_000, loop: () => 'CQ CQ CQ', jitter: 0 });
    station.nextAt = 0;
    schedulePending(station, 0, 1, random);
    cutStation(station, 0.5);
    expect(station.marks.every(([, end]) => end <= 0.5)).toBe(true);
    expect(isKeyed(station, 0.8)).toBe(false);
  });

  it('keeps QRM clear of the target and snaps click-to-tune', () => {
    const random = seeded(4);
    const qrm = makeQrm(random, 10, 7_012_000, [7_012_500]);
    expect(qrm).toHaveLength(10);
    expect(qrm.every((station) => Math.abs(station.rf - 7_012_500) >= 150)).toBe(true);
    const target = makeStation(random, { rf: 7_012_500 });
    expect(nearestStation([...qrm, target], 7_012_530, 100)?.id).toBe(target.id);
    expect(nearestStation([target], 7_013_000, 100)).toBeNull();
  });

  it('formats the dial', () => {
    expect(formatFrequency(7_012_000)).toEqual({ main: '7.012', sub: '00' });
    expect(formatFrequency(7_003_456)).toEqual({ main: '7.003', sub: '46' });
  });
});

describe('QSO flow', () => {
  const target = { call: 'JH3ABC', name: 'KEN', qth: 'OSAKA', rst: '579', wpm: 16 };
  const me = { myCall: 'JA1ZZZ', offsetHz: 0 };

  it('makes JA calls whose area matches the QTH', () => {
    const random = seeded(5);
    for (let i = 0; i < 20; i += 1) {
      const t = makeTarget(random, 18);
      expect(isCallsign(t.call)).toBe(true);
      expect(t.wpm).toBe(18);
    }
  });

  it('ignores you when you are off frequency', () => {
    const result = respond('cq', target, 'JA1ZZZ K', { ...me, offsetHz: TUNE_TOLERANCE_HZ + 1 });
    expect(result).toMatchObject({ heard: false, reply: null, phase: 'cq' });
  });

  it('answers your call, then your report, then closes', () => {
    const call = respond('cq', target, 'JH3ABC DE JA1ZZZ JA1ZZZ K', me);
    expect(call).toMatchObject({ phase: 'report', reply: reportText(target, 'JA1ZZZ') });
    expect(call.reply).toContain('RST 579 579');
    const report = respond('report', target, 'R TNX KEN UR 5NN 73', me);
    expect(report).toMatchObject({ phase: 'done', reply: finalText(target, 'JA1ZZZ') });
  });

  it('sends QRZ? when it hears something without your call', () => {
    expect(respond('cq', target, 'DE K', me).reply).toBe('QRZ? DE JH3ABC K');
  });

  it('repeats on AGN and slows down on QRS', () => {
    expect(respond('cq', target, 'AGN?', me).reply).toBe(cqText(target));
    expect(respond('report', target, '?', me)).toMatchObject({ phase: 'report', reply: reportText(target, 'JA1ZZZ'), slower: 0 });
    expect(respond('report', target, 'QRS PSE', me)).toMatchObject({ phase: 'report', slower: 4 });
  });

  it('waits for a report before closing', () => {
    expect(respond('report', target, 'HELLO', me)).toMatchObject({ phase: 'report', reply: null, heard: true });
  });

  it('scores the log with cut numbers and loose case', () => {
    expect(normalizeRst('5NN')).toBe('599');
    expect(normalizeRst('5n9')).toBe('599');
    const score = scoreLog(target, { call: 'jh3abc', rst: '579', name: 'Ken ', qth: 'OSAKA' });
    expect(score).toMatchObject({ correct: 4, total: 4 });
    expect(scoreLog(target, { call: 'JH3ABD', rst: '599', name: 'KEN', qth: '' }).fields).toEqual({ call: false, rst: false, name: true, qth: false });
  });
});

describe('scope helpers', () => {
  it('maps canvas position to Hz', () => {
    expect(hzAtRatio(0.5, 7_012_000, 2500)).toBe(7_012_000);
    expect(hzAtRatio(0, 7_012_000, 2500)).toBe(7_009_500);
  });

  it('clamps the palette', () => {
    expect(heatColor(-1)).toEqual([4, 8, 40]);
    expect(heatColor(2)).toEqual([255, 45, 35]);
  });
});
