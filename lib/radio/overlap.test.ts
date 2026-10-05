import { describe, expect, it } from 'vitest';
import { makeStation, type Station } from './band';
import { CopyMonitor, judgeChar, judgeSamples, sampleBand, situationOf, type RxRecord } from './conditions';
import { keyText, type Mark } from './keying';

/**
 * Callers keyed over each other, built by hand: each station's key-down intervals are
 * set directly, so which samples of a character another caller covers is known exactly.
 */

const RF = 7_010_000;
const db = (value: number) => 10 ** (value / 20);

const station = (init: Partial<Station> & { rf: number }) =>
  makeStation(() => 0.5, { role: 'caller', strength: 0.5, wpm: 20, fade: 1, jitter: 0, drift: 0, chirp: 0, marks: [], ...init });

/** Sample the band for `target` every 100 ms over [0, until], as the rig does. */
function monitorOf(target: Station, stations: Station[], { until = 4, filter = 500, listening = (() => true) as (t: number) => boolean } = {}) {
  const monitor = new CopyMonitor();
  for (let tenth = 0; tenth <= until * 10; tenth += 1) {
    const t = tenth / 10;
    monitor.push(sampleBand({ t, epoch: 0, listening: listening(t), vfo: target.rf, filter, noise: 0, target, stations, crash: 0 }));
  }
  return monitor;
}

/** Judge a character of `target` keyed over [start, end]. */
function judge(target: Station, others: Station[], [start, end]: [number, number], options?: Parameters<typeof monitorOf>[2]) {
  const monitor = monitorOf(target, [target, ...others], options);
  const judgement = judgeSamples([...monitor.window(target.id, 0, start, end)]);
  return { ...judgement, situation: situationOf(judgement.condition, judgement.env) };
}

const CHAR: [number, number] = [1, 2];
const keyedOver = (from: number, to: number): Mark[] => [[from, to]];

describe('overlap: callers actually keying over a character', () => {
  it('measures the one caller keyed over it: offset, strength and speed apart', () => {
    const target = station({ rf: RF, wpm: 20, marks: keyedOver(1, 2) });
    const other = station({ rf: RF + 80, strength: 0.5 * db(3), wpm: 26, marks: keyedOver(0.9, 2.1) });
    const result = judge(target, [other], CHAR);
    expect(result.env.overlap).toEqual({ n: 1, dHz: 80, dB: 3, dWpm: 6 });
    expect(result.condition).toBe('qrm');
    expect(result.env.qrmFrom).toBe('caller');
    expect(result.situation).toBe('overlap');
  });

  it('counts every caller keying at once, and describes the loudest', () => {
    const target = station({ rf: RF, wpm: 24, marks: keyedOver(1, 2) });
    const near = station({ rf: RF - 40, strength: 0.5 * db(-2), wpm: 30, marks: keyedOver(1, 2) });
    const loud = station({ rf: RF + 150, strength: 0.5 * db(7.5), wpm: 16, marks: keyedOver(1.2, 1.8) });
    const faint = station({ rf: RF + 220, strength: 0.5 * db(-9), wpm: 22, marks: keyedOver(1.4, 1.6) });
    const result = judge(target, [near, loud, faint], CHAR);
    expect(result.env.overlap).toEqual({ n: 3, dHz: 150, dB: 7.5, dWpm: -8 });
    expect(result.situation).toBe('overlap');
  });

  it('takes n at a single instant: two callers one after the other are one at a time', () => {
    const target = station({ rf: RF, marks: keyedOver(1, 2) });
    const first = station({ rf: RF + 60, strength: 0.5 * db(1), wpm: 18, marks: keyedOver(1, 1.35) });
    const second = station({ rf: RF - 120, strength: 0.5 * db(4), wpm: 28, marks: keyedOver(1.65, 2) });
    expect(judge(target, [first, second], CHAR).env.overlap).toEqual({ n: 1, dHz: 120, dB: 4, dWpm: 8 });
  });

  it('counts a caller only for the time it was keyed over the character, not for being in the same burst', () => {
    const target = station({ rf: RF, marks: keyedOver(1, 2) });
    // Calling in the same burst, but its key-down lies wholly before and after the character.
    const around = station({ rf: RF + 50, strength: 0.5 * db(6), wpm: 25, marks: [[0, 0.8], [2.2, 3]] });
    const result = judge(target, [around], CHAR);
    expect(result.env.overlap).toBeUndefined();
    expect(result.situation).toBe('clean');
    // A short overlap inside the character counts.
    const brief = station({ rf: RF + 50, strength: 0.5 * db(6), wpm: 25, marks: [[0, 0.8], [1.55, 1.75], [2.2, 3]] });
    const overlapped = judge(target, [brief], CHAR);
    expect(overlapped.env.overlap).toEqual({ n: 1, dHz: 50, dB: 6, dWpm: 5 });
    expect(overlapped.situation).toBe('overlap');
  });

  it('records a faint caller underneath, but the character stays copyable (clean)', () => {
    const target = station({ rf: RF, marks: keyedOver(1, 2) });
    const faint = station({ rf: RF + 30, strength: 0.5 * db(-12), wpm: 20, marks: keyedOver(1, 2) });
    const result = judge(target, [faint], CHAR);
    expect(result.env.overlap).toEqual({ n: 1, dHz: 30, dB: -12, dWpm: 0 });
    expect(result.situation).toBe('clean');
  });

  it('leaves band QRM out of the overlap', () => {
    const target = station({ rf: RF, marks: keyedOver(1, 2) });
    const chatter = station({ rf: RF + 70, role: 'qrm', strength: 0.5 * db(3), wpm: 25, marks: keyedOver(1, 2) });
    const result = judge(target, [chatter], CHAR);
    expect(result.env.overlap).toBeUndefined();
    expect(result.env.qrmFrom).toBe('band');
    expect(result.situation).toBe('qrm');
  });

  it('is our doubling, not an overlap, when we were keying (the overlap is still recorded)', () => {
    const target = station({ rf: RF, marks: keyedOver(1, 2) });
    const other = station({ rf: RF + 80, strength: 0.5 * db(3), wpm: 26, marks: keyedOver(1, 2) });
    const result = judge(target, [other], CHAR, { listening: (t) => t < 0.5 || t > 2.5 });
    expect(result.condition).toBe('muted');
    expect(result.situation).toBe('doubled');
    expect(result.env.overlap).toEqual({ n: 1, dHz: 80, dB: 3, dWpm: 6 });
  });

  it('judges real keyed calls character by character: only the ones the other call covers overlap', () => {
    const target = station({ rf: RF, wpm: 20 });
    const keyed = keyText('JA1ABC', { wpm: 20 });
    target.marks = keyed.marks.map(([start, end]): Mark => [start + 1, end + 1]);
    // A faster caller starts part-way through and is done before the end.
    const other = station({ rf: RF + 90, strength: 0.5 * db(2), wpm: 32 });
    const otherKeyed = keyText('JH3XYZ', { wpm: 32 });
    const otherStart = 1 + keyed.chars[2].start;
    other.marks = otherKeyed.marks.map(([start, end]): Mark => [start + otherStart, end + otherStart]);
    const otherEnd = otherStart + otherKeyed.length;
    const monitor = monitorOf(target, [target, other], { until: 1 + keyed.length + 1 });
    const record: RxRecord = { tx: { text: 'JA1ABC', start: 1, marks: target.marks, length: keyed.length, chars: keyed.chars.map((span) => ({ ...span, start: span.start + 1, end: span.end + 1 })) }, station: target.id, epoch: 0, cutAt: null };
    const now = { t: 100, epoch: 0 };
    const judged = record.tx.chars.map((span) => ({ span, judgement: judgeChar(monitor, record, span, now) }));
    expect(judged[0].judgement.env.overlap).toBeUndefined();
    expect(judged[1].judgement.env.overlap).toBeUndefined();
    const covered = judged.filter(({ span }) => span.start >= otherStart && span.end <= otherEnd);
    expect(covered.length).toBeGreaterThan(0);
    for (const { judgement } of covered) {
      expect(judgement.env.overlap).toEqual({ n: 1, dHz: 90, dB: 2, dWpm: 12 });
      expect(situationOf(judgement.condition, judgement.env)).toBe('overlap');
    }
    for (const { span, judgement } of judged.filter(({ span }) => span.start - 0.05 > otherEnd)) {
      expect(judgement.env.overlap, span.char).toBeUndefined();
    }
  });
});
