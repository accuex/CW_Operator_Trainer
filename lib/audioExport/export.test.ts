import { describe, it, expect } from 'vitest';
import { buildMorseTimeline } from '../timing';
import { DEFAULT_SETTINGS } from '../storage';
import { buildExportTimeline } from './timeline';
import { encodeMp3 } from './encode';

describe('offline audio export', () => {
  it('preserves the announcement, inter-sheet silence and Wabun timing', () => {
    const settings = DEFAULT_SETTINGS;
    const announcement = buildMorseTimeline('シケン', 'wabun', settings);
    const sheet1 = buildMorseTimeline('ABC', 'international', settings);
    const sheet2 = buildMorseTimeline('XYZ', 'international', settings);
    const combined = buildExportTimeline([
      { text: 'シケン', alphabet: 'wabun', silenceAfter: 5 },
      { text: 'ABC', alphabet: 'international', silenceAfter: 5 },
      { text: 'XYZ', alphabet: 'international' },
    ], settings);
    expect(combined.duration).toBeCloseTo(announcement.duration + sheet1.duration + sheet2.duration + 10);
    expect(combined.tones[announcement.tones.length].start).toBeCloseTo(announcement.duration + 5);
    expect(combined.tones.at(-1)?.symbol).toBe('Z');
  });
  it('does not insert extra pauses into consecutive Wabun sheets', () => {
    const settings = DEFAULT_SETTINGS;
    const first = buildMorseTimeline('アイ', 'wabun', settings);
    const output = buildExportTimeline([{ text: 'アイ', alphabet: 'wabun' }, { text: 'ウエ', alphabet: 'wabun' }], settings);
    expect(output.tones[first.tones.length].start).toBeCloseTo(first.duration);
    expect(() => buildExportTimeline([], settings)).toThrow();
  });
  it('encodes real MP3 frames, with valid MPEG sync bytes and progress completion', () => {
    const pcm = Float32Array.from({ length: 44100 }, (_, index) => Math.sin(index * 2 * Math.PI * 600 / 44100) * 0.25);
    const progress: number[] = [];
    const chunks = encodeMp3(pcm, 44100, (value) => progress.push(value));
    expect(chunks.reduce((sum, chunk) => sum + chunk.length, 0)).toBeGreaterThan(1000);
    expect(chunks[0][0]).toBe(255);
    expect(chunks[0][1] & 224).toBe(224);
    expect(progress.at(-1)).toBe(1);
  });
});
