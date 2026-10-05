import { describe, expect, it } from 'vitest';
import { callDistance, isNearCall, matchesPartial, parseIntent } from './intent';
import { seeded } from '../random';

const ME = 'JA1ZZZ';

describe('parseIntent', () => {
  it('reads a CQ with our call', () => {
    const intent = parseIntent('CQ CQ DE JA1ZZZ JA1ZZZ K', ME);
    expect(intent.cq).toBe(true);
    expect(intent.mentionsMe).toBe(true);
    expect(intent.deMe).toBe(true);
    expect(intent.calls).toEqual([]);
  });

  it('reads an exchange addressed to a station', () => {
    const intent = parseIntent('JH3ABC UR 5NN NAME MASA QTH TOKYO BK', ME);
    expect(intent.calls).toEqual(['JH3ABC']);
    expect(intent.report).toBe('599');
    expect(intent.fields).toEqual({ name: 'MASA', qth: 'TOKYO' });
    expect(intent.closing).toBe(false);
  });

  it('reads partial calls in both forms', () => {
    expect(parseIntent('3ABC?', ME).partial).toBe('3ABC');
    expect(parseIntent('ABC ?', ME).partial).toBe('ABC');
    expect(parseIntent('3ABC?', ME).agn).toBe(false);
  });

  it('never takes a keyword or report for a partial', () => {
    expect(parseIntent('QRZ?', ME).partial).toBeNull();
    expect(parseIntent('QRZ?', ME).qrz).toBe(true);
    expect(parseIntent('599?', ME).partial).toBeNull();
    expect(parseIntent('NAME?', ME).ask).toEqual(['NAME']);
  });

  it('reads AGN, QRS, QRL and a bare ?', () => {
    expect(parseIntent('AGN?', ME).agn).toBe(true);
    expect(parseIntent('?', ME).agn).toBe(true);
    expect(parseIntent('PSE QRS', ME).qrs).toBe(true);
    expect(parseIntent('QRL?', ME).qrl).toBe(true);
  });

  it('collects asked fields in order', () => {
    expect(parseIntent('PSE QTH? NAME?', ME).ask).toEqual(['QTH', 'NAME']);
    expect(parseIntent('RST ?', ME).ask).toEqual(['RST']);
  });

  it('reads closings and rogers', () => {
    const intent = parseIntent('R TNX KEN 73 TU EE', ME);
    expect(intent.closing).toBe(true);
    expect(intent.roger).toBe(true);
    expect(parseIntent('QRZ? DE JA1ZZZ K', ME).closing).toBe(false);
  });

  it('never throws on noise', () => {
    const random = seeded(99);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/?= .,[]!';
    for (let index = 0; index < 2000; index += 1) {
      const length = Math.floor(random() * 40);
      const text = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
      expect(() => parseIntent(text, ME)).not.toThrow();
    }
  });
});

describe('call matching', () => {
  it('measures edit distance', () => {
    expect(callDistance('JH3ABC', 'JH3ABC')).toBe(0);
    expect(callDistance('JH3ABC', 'JH3ABD')).toBe(1);
    expect(callDistance('JH3ABC', 'JA3ABD')).toBe(2);
    expect(callDistance('JH3AB', 'JH3ABC')).toBe(1);
  });

  it('treats 1–2 edits of about the same length as near', () => {
    expect(isNearCall('JH3ABD', 'JH3ABC')).toBe(true);
    expect(isNearCall('JA3ABD', 'JH3ABC')).toBe(true);
    expect(isNearCall('JH3ABC', 'JH3ABC')).toBe(false);
    expect(isNearCall('JA1XYZ', 'JH3ABC')).toBe(false);
    expect(isNearCall('JH3A', 'JH3ABC')).toBe(false);
  });

  it('matches partials anywhere in the call', () => {
    expect(matchesPartial('JH3ABC', '3AB')).toBe(true);
    expect(matchesPartial('JH3ABC', 'ABC')).toBe(true);
    expect(matchesPartial('JH3ABC', 'XBC')).toBe(false);
  });
});
