import { describe, expect, it } from 'vitest';
import { INTERNATIONAL_MORSE, WABUN_MORSE } from '../../morse';
import { keyText } from '../keying';
import { composeVoicing, displayNotation, keySegments, keyedText, parseSegments, renderSegments, textOf } from './segments';

const codesOf = (text: string) => {
  const keyed = keySegments(text, { wpm: 20 });
  return keyed.chars.map((span) => [span.char, span.script] as const);
};

describe('wabun segments', () => {
  it('splits Latin, the switches and the kana body', () => {
    const segments = parseSegments('JA1ZZZ DE JA7LBT [ホレ] コンニチハ コール [ラタ] JA1ZZZ DE JA7LBT KN');
    expect(segments).toEqual([
      { kind: 'roman', text: 'JA1ZZZ DE JA7LBT' },
      { kind: 'control', sign: 'ホレ', to: 'wabun' },
      { kind: 'wabun', text: 'コンニチハ コール' },
      { kind: 'control', sign: 'ラタ', to: 'roman' },
      { kind: 'roman', text: 'JA1ZZZ DE JA7LBT KN' },
    ]);
    expect(textOf(segments, 'roman')).toBe('JA1ZZZ DE JA7LBT JA1ZZZ DE JA7LBT KN');
    expect(textOf(segments, 'wabun')).toBe('コンニチハ コール');
    expect(renderSegments(segments)).toBe('JA1ZZZ DE JA7LBT [ホレ] コンニチハ コール [ラタ] JA1ZZZ DE JA7LBT KN');
    expect(parseSegments(renderSegments(segments))).toEqual(segments);
  });

  it('keeps ホレ in a CQ as a word that switches nothing', () => {
    const segments = parseSegments('CQ CQ CQ <ホレ> DE JA7LBT PSE <ホレ> K');
    expect(segments.filter((segment) => segment.kind === 'control')).toEqual([
      { kind: 'control', sign: 'ホレ', to: null }, { kind: 'control', sign: 'ホレ', to: null },
    ]);
    expect(segments.some((segment) => segment.kind === 'wabun')).toBe(false);
    const keyed = keySegments(segments, { wpm: 18 });
    expect(keyed.switches).toEqual([]);
    expect(keyed.chars.filter((span) => span.script === 'control').map((span) => span.char)).toEqual(['[ホレ]', '[ホレ]']);
    expect(displayNotation('CQ <ホレ> DE X [ホレ] ア [ラタ] K')).toBe('CQ ホレ DE X ホレ ア ラタ K');
  });

  it('records each switch with its direction and on-air time, a word gap either side', () => {
    const wpm = 20;
    const unit = 1.2 / wpm;
    const keyed = keySegments('DE JA7LBT [ホレ] アリ [ラタ] KN', { wpm });
    expect(keyed.switches.map(({ sign, to }) => [sign, to])).toEqual([['ホレ', 'wabun'], ['ラタ', 'roman']]);
    const [hore, rata] = keyed.switches;
    const before = keyed.chars.filter((span) => span.end <= hore.start).at(-1)!;
    expect(before.char).toBe('T');
    expect(hore.start - before.end).toBeCloseTo(7 * unit);
    const first = keyed.chars.find((span) => span.start >= hore.end)!;
    expect(first).toMatchObject({ char: 'ア', script: 'wabun' });
    expect(first.start - hore.end).toBeCloseTo(7 * unit);
    expect(keyed.chars.find((span) => span.start >= rata.end)).toMatchObject({ char: 'K', script: 'roman' });
    // A word never spans two segments.
    const segmentOfWord = new Map<number, number>();
    for (const span of keyed.chars) {
      expect(segmentOfWord.get(span.word) ?? span.segment).toBe(span.segment);
      segmentOfWord.set(span.word, span.segment);
    }
  });

  it('keys the same letter in the alphabet in force', () => {
    // ラ and R share nothing; A in roman is .-, ア in wabun is --.--
    const keyed = keySegments('A [ホレ] ア [ラタ] A', { wpm: 20 });
    const lengths = keyed.chars.map((span) => span.end - span.start);
    expect(keyed.chars.map((span) => span.script)).toEqual(['roman', 'control', 'wabun', 'control', 'roman']);
    expect(lengths[0]).toBeCloseTo(lengths[4]);
    expect(lengths[2]).toBeGreaterThan(lengths[0]);
    expect(WABUN_MORSE.ア).toBe('--.--');
  });

  it('sends 濁点 and 半濁点 as their own unit after the base kana', () => {
    expect(codesOf('[ホレ] ガ パ ワタナベ [ラタ]').filter(([, script]) => script === 'wabun').map(([char]) => char).join(''))
      .toBe('カ゛ハ゜ワタナヘ゛');
    const keyed = keySegments('[ホレ] ド [ラタ]', { wpm: 20 });
    const [base, mark] = keyed.chars.filter((span) => span.script === 'wabun');
    expect(base.word).toBe(mark.word);
    expect(mark.index).toBe(base.index + 1);
    // Hiragana and small kana go out as telegraph kana (small kana full-size).
    expect(codesOf('[ホレ] きょう [ラタ]').filter(([, script]) => script === 'wabun').map(([char]) => char).join('')).toBe('キヨウ');
  });

  it('sends digits and RST in either alphabet with the same code', () => {
    for (const digit of '0123456789') expect(WABUN_MORSE[digit]).toBe(INTERNATIONAL_MORSE[digit]);
    const inBody = keySegments('[ホレ] 599 [ラタ]', { wpm: 20 }).chars.filter((span) => span.script === 'wabun');
    const inLatin = keySegments('599', { wpm: 20 }).chars;
    expect(inBody.map((span) => span.char)).toEqual(['5', '9', '9']);
    expect(inBody.map((span) => span.end - span.start)).toEqual(inLatin.map((span) => span.end - span.start).map((value) => expect.closeTo(value, 9)));
  });

  it('switches to roman inside parentheses of a wabun body only', () => {
    expect(parseSegments('[ホレ] リグハ （ IC705 ） デス [ラタ]').map((segment) => segment.kind === 'control' ? `${segment.sign}>${segment.to}` : segment.kind))
      .toEqual(['ホレ>wabun', 'wabun', '（>roman', 'roman', '）>wabun', 'wabun', 'ラタ>roman']);
    const keyed = keySegments('[ホレ] リグハ （ IC705 ） デス [ラタ]', { wpm: 20 });
    expect(keyed.chars.filter((span) => span.script === 'roman').map((span) => span.char).join('')).toBe('IC705');
    expect(keyed.switches.map((event) => event.sign)).toEqual(['ホレ', '（', '）', 'ラタ']);
  });

  it('borrows ? from Latin code inside a wabun body', () => {
    const chars = keySegments('[ホレ] タナカ? [ラタ]', { wpm: 20 }).chars.filter((span) => span.script === 'wabun');
    expect(chars.map((span) => span.char)).toEqual(['タ', 'ナ', 'カ', '?']);
  });

  it('times a roman-only text exactly as keyText', () => {
    const text = 'JA1ZZZ DE JA7LBT 599 TU [AR] E E';
    const a = keySegments(text, { wpm: 22, effectiveWpm: 15 });
    const b = keyText(text, { wpm: 22, effectiveWpm: 15 });
    expect(a.marks).toEqual(b.marks);
    expect(a.length).toBe(b.length);
    expect(a.switches).toEqual([]);
  });

  it('writes a correction ラタ as {ラタ}: same sign on the air, no switch, [ラタ] unchanged', () => {
    const text = 'DE JA1ZZZ [ホレ] ゴール {ラタ} コール [ラタ] KN';
    const segments = parseSegments(text);
    expect(segments.filter((segment) => segment.kind === 'control')).toEqual([
      { kind: 'control', sign: 'ホレ', to: 'wabun' },
      { kind: 'control', sign: 'ラタ', to: null, correction: true },
      { kind: 'control', sign: 'ラタ', to: 'roman' },
    ]);
    expect(renderSegments(segments)).toBe(text);
    expect(displayNotation(text)).toBe('DE JA1ZZZ ホレ ゴール ラタ コール ラタ KN');
    const keyed = keySegments(text, { wpm: 20 });
    const codes = keyed.chars.filter((span) => span.char === '[ラタ]').map((span) => span.end - span.start);
    expect(codes[0]).toBeCloseTo(codes[1]);
    expect(keyed.switches.map((event) => event.to)).toEqual(['wabun', 'roman']);
    expect(keyed.corrections).toHaveLength(1);
    // The kana after a correction is still kana.
    expect(keyed.chars.filter((span) => span.script === 'wabun').map((span) => span.char).join('')).toBe('コ゛ールコール');
    // The old notation parses as before (Stage 1 overs are unchanged).
    expect(parseSegments('[ホレ] ア [ラタ] K').map((segment) => segment.kind)).toEqual(['control', 'wabun', 'control', 'roman']);
  });

  it('prints what was keyed, voiced kana composed back, dropped letters gone', () => {
    expect(composeVoicing('コ゛ール ハ゜ン ア゛')).toBe('ゴール パン ア゛');
    expect(keyedText(keySegments('JA1ZZZ [ホレ] ガx 599 [ラタ] K', { wpm: 20 }))).toBe('JA1ZZZ ホレ ガ 599 ラタ K');
  });
});
