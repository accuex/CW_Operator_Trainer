import { describe, expect, it } from 'vitest';
import { confusionMatrix, weakPairs } from './analytics';
import { CARDS, INTERNATIONAL_MORSE, WABUN_MORSE, expandWabunVoicing, resolveMnemonicSegments, tokenizeMorseInput } from './morse';
import { cardsForCourse, selectCourseDefaults } from './course';
import { CARD_ARTWORK, artworkFor } from './cardArtwork';
import { QueueEvaluator } from './queue';
import { DEFAULT_SETTINGS } from './storage';
import { nextSpeedFromCharacter, nextSpeedFromEffective } from './speed';
import { applyMeterDelta, CONFIRM_METER, readProgressMeter, RECALL_METER } from './progressMeter';
import { buildTargetCountRound, isTargetCountSymbol, resolveConfirmDistractors } from './targetCount';
import { buildMorseTimeline, buildRepeatedSymbolTimeline } from './timing';
import { buildExamSession, formatWabunFilingTimeLabel, formatWabunFilingTimePlay, measureExamAudioSec, randomGroup } from './training';
import { OUBUN_PLAIN_PASSAGES, WABUN_PLAIN_PASSAGES, plainCorpusStats } from './plainCorpus';
import { correctionPenaltyPoints, scoreExamCopy, stripExamProcedureMarks } from './examScore';
import type { AnswerLog, CardProgress } from './types';

describe('Morse data', () => {
  it('maps representative international symbols', () => {
    expect(INTERNATIONAL_MORSE.S).toBe('...');
    expect(INTERNATIONAL_MORSE.O).toBe('---');
    expect(INTERNATIONAL_MORSE['5']).toBe('.....');
    expect(INTERNATIONAL_MORSE.Q).toBe('--.-');
    expect(INTERNATIONAL_MORSE['[AS]']).toBe('.-...');
    expect(INTERNATIONAL_MORSE['/']).toBe('-..-.');
    expect(INTERNATIONAL_MORSE[':']).toBe('---...');
    expect(INTERNATIONAL_MORSE["'"]).toBe('.----.');
    expect(INTERNATIONAL_MORSE['(']).toBe('-.--.');
    expect(INTERNATIONAL_MORSE[')']).toBe('-.--.-');
    expect(INTERNATIONAL_MORSE['"']).toBe('.-..-.');
    expect(INTERNATIONAL_MORSE['@']).toBe('.--.-.');
    expect(INTERNATIONAL_MORSE['[BT]']).toBe('-...-');
    expect(INTERNATIONAL_MORSE['[AR]']).toBe('.-.-.');
  });
  it('keeps Wabun in an independent namespace', () => {
    expect(WABUN_MORSE.イ).toBe('.-');
    expect(WABUN_MORSE.ツ).toBe('.--.');
    expect(WABUN_MORSE.ン).toBe('.-.-.');
    expect(WABUN_MORSE.ニ).toBe('-.-.');
  });
  it('uses data-defined mnemonic rhythm segments', () => {
    const b = CARDS.find((card) => card.alphabet === 'international' && card.symbol === 'B');
    expect(resolveMnemonicSegments(b?.mnemonics[0], '-...')).toEqual(['ビー', 'ト', 'ル', 'ズ']);
    expect(resolveMnemonicSegments({ label: 'ア・ロー', segments: ['ア', 'ロー'] }, '.-')).toEqual(['ア', 'ロー']);
    expect(resolveMnemonicSegments({ label: '未定義の合調語' }, '-...')).toEqual(['·', '·', '·', '·']);
  });
  it('keeps every Recommended mnemonic segment count aligned to Morse length', () => {
    for (const card of CARDS) {
      if (!card.hasMnemonic) continue;
      const recommended = card.mnemonics.find((option) => option.category === 'Recommended');
      expect(recommended?.segments, `${card.alphabet}:${card.symbol}`).toHaveLength(card.code.length);
    }
  });
  it('keeps prosign cards wired to their Morse codes', () => {
    const asCard = CARDS.find((card) => card.symbol === '[AS]');
    const ctCard = CARDS.find((card) => card.symbol === '[CT]');
    expect(asCard?.code).toBe('.-...');
    expect(ctCard?.code).toBe('-.-.-');
  });
});

describe('course filters', () => {
  it('starts amateur-latin with A–Z only', () => {
    const defaults = selectCourseDefaults('amateur-latin');
    const cards = cardsForCourse(CARDS, defaults.learnCourse, defaults.unlockedKinds);
    expect(cards.every((card) => card.kind === 'latinLetter')).toBe(true);
    expect(cards).toHaveLength(26);
  });
  it('keeps amateur-wabun to kana cards', () => {
    const defaults = selectCourseDefaults('amateur-wabun');
    const cards = cardsForCourse(CARDS, defaults.learnCourse, defaults.unlockedKinds);
    expect(cards.every((card) => card.kind === 'wabun')).toBe(true);
    expect(cards.length).toBeGreaterThan(40);
  });
  it('can unlock JARL punctuation into amateur-latin without wiping letters', () => {
    const cards = cardsForCourse(CARDS, 'amateur-latin', ['latinLetter', 'punctuation', 'prosign']);
    expect(cards.some((card) => card.symbol === '/')).toBe(true);
    expect(cards.some((card) => card.symbol === '[AS]')).toBe(true);
    expect(cards.some((card) => card.symbol === 'A')).toBe(true);
    expect(cards.every((card) => card.alphabet === 'international')).toBe(true);
  });
  it('keeps unlocked amateur-wabun symbols on the wabun alphabet', () => {
    const cards = cardsForCourse(CARDS, 'amateur-wabun', ['wabun', 'digit', 'punctuation', 'prosign']);
    expect(cards.some((card) => card.symbol === 'ー')).toBe(true);
    expect(cards.some((card) => card.symbol === '[0]')).toBe(true);
    expect(cards.some((card) => card.symbol === '/')).toBe(false);
    expect(cards.every((card) => card.alphabet === 'wabun')).toBe(true);
  });
});

describe('card artwork manifest', () => {
  it('maps full international A–Z, Wabun 48 kana, and blue-series artwork', () => {
    expect(artworkFor('international', 'F')?.artwork).toBe('/cards/international/F.webp');
    expect(artworkFor('international', 'A')?.artwork).toBe('/cards/international/A.webp');
    expect(artworkFor('wabun', 'ツ')?.artwork).toBe('/cards/wabun/tsu.webp');
    expect(artworkFor('wabun', 'ア')?.artwork).toBe('/cards/wabun/a.webp');
    expect(artworkFor('wabun', 'ヱ')?.artwork).toBe('/cards/wabun/we.webp');
    expect(artworkFor('wabun', 'ン')?.artwork).toBe('/cards/wabun/n.webp');
    expect(artworkFor('international', '0')?.artwork).toBe('/cards/kigo/0.webp');
    expect(artworkFor('international', '/')?.artwork).toBe('/cards/kigo/slash.webp');
    expect(artworkFor('international', '[BT]')?.artwork).toBe('/cards/kigo/bt.webp');
    expect(artworkFor('wabun', 'ー')?.artwork).toBe('/cards/kigo/choon.webp');
    expect(artworkFor('wabun', '[0]')?.artwork).toBe('/cards/kigo/abbr0.webp');
    const intl = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').every((s) => artworkFor('international', s)?.artwork);
    const wabun = 'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセスン'.split('').every((s) => artworkFor('wabun', s)?.artwork);
    expect(intl).toBe(true);
    expect(wabun).toBe(true);
    expect(Object.keys(CARD_ARTWORK)).toHaveLength(26 + 48 + 39);
  });
  it('uses browser-safe ASCII asset paths', () => {
    expect(Object.values(CARD_ARTWORK).every(({ artwork }) => /^\/[A-Za-z0-9/_-]+\.(webp|png)$/.test(artwork))).toBe(true);
  });
  it('leaves unillustrated latin extras on the CSS fallback', () => {
    expect(artworkFor('international', ',')).toBeUndefined();
    expect(artworkFor('international', '?')).toBeUndefined();
  });
});

describe('progress meter', () => {
  const base = (): CardProgress => ({
    attempts: 0, correct: 0, streak: 0, mastered: false, reviewed: true, exposures: 1, confirmCorrect: 0, progressMeter: 20,
  });
  it('raises and lowers the visible meter without granting mastery', () => {
    expect(applyMeterDelta(base(), CONFIRM_METER.hit).progressMeter).toBe(21);
    expect(applyMeterDelta(base(), CONFIRM_METER.miss).progressMeter).toBe(19);
    expect(applyMeterDelta(base(), RECALL_METER.hit).progressMeter).toBe(30);
    expect(applyMeterDelta(base(), RECALL_METER.miss).progressMeter).toBe(10);
    expect(applyMeterDelta({ ...base(), progressMeter: 2 }, RECALL_METER.miss).progressMeter).toBe(0);
    expect(applyMeterDelta({ ...base(), mastered: true }, RECALL_METER.miss).mastered).toBe(true);
    expect(readProgressMeter({ ...base(), mastered: true })).toBe(100);
  });
});

describe('target count rounds', () => {
  it('builds 5×2 cipher groups with 2–5 target hits', () => {
    let n = 0;
    const rng = () => {
      const sequence = [0.1, 0.4, 0.2, 0.8, 0.3, 0.9, 0.15, 0.55, 0.7, 0.05, 0.6, 0.25, 0.85, 0.35];
      return sequence[n++ % sequence.length];
    };
    const round = buildTargetCountRound({
      target: 'A',
      distractors: ['F', 'C', 'B', 'I', 'N', 'D'],
      rng,
    });
    expect(round).not.toBeNull();
    expect(round!.symbols).toHaveLength(10);
    expect(round!.groups).toHaveLength(2);
    expect(round!.groups.every((group) => group.length === 5)).toBe(true);
    expect(round!.count).toBeGreaterThanOrEqual(2);
    expect(round!.count).toBeLessThanOrEqual(5);
    expect(round!.symbols.filter((symbol) => symbol === 'A')).toHaveLength(round!.count);
    expect(round!.text.split(' ')).toHaveLength(2);
  });
  it('rejects prosign tokens and empty distractor pools', () => {
    expect(isTargetCountSymbol('[AS]')).toBe(false);
    expect(buildTargetCountRound({ target: '[AS]', distractors: ['A', 'B'] })).toBeNull();
    expect(buildTargetCountRound({ target: 'A', distractors: ['A'] })).toBeNull();
  });
  it('bootstraps ANDG when no learned distractors', () => {
    expect(resolveConfirmDistractors({
      target: 'K',
      alphabet: 'international',
      learnedSymbols: [],
      availableSymbols: ['K', 'M'],
    })).toEqual(['A', 'N', 'D', 'G']);
    expect(resolveConfirmDistractors({
      target: 'A',
      alphabet: 'international',
      learnedSymbols: [],
      availableSymbols: ['A'],
    })).toEqual(['N', 'D', 'G']);
    expect(resolveConfirmDistractors({
      target: 'イ',
      alphabet: 'wabun',
      learnedSymbols: [],
      availableSymbols: ['イ'],
    })).toEqual(['ロ', 'ハ', 'ニ']);
  });
});

describe('speed slider coupling', () => {
  it('keeps a fixed shared scale and only drops effective when character falls', () => {
    expect(nextSpeedFromCharacter(20, 12, 18)).toEqual({ characterSpeed: 18, effectiveSpeed: 12 });
    expect(nextSpeedFromCharacter(20, 18, 15)).toEqual({ characterSpeed: 15, effectiveSpeed: 15 });
  });
  it('stops once at character when effective climbs from Farnsworth', () => {
    expect(nextSpeedFromEffective(20, 12, 22, false)).toEqual({
      characterSpeed: 20, effectiveSpeed: 20, stoppedAtNotch: true,
    });
    expect(nextSpeedFromEffective(20, 20, 22, true)).toEqual({
      characterSpeed: 22, effectiveSpeed: 22, stoppedAtNotch: false,
    });
  });
  it('raises character freely when already matched, and drops only effective downward', () => {
    expect(nextSpeedFromEffective(20, 20, 24, false)).toEqual({
      characterSpeed: 24, effectiveSpeed: 24, stoppedAtNotch: false,
    });
    expect(nextSpeedFromEffective(24, 24, 10, false)).toEqual({
      characterSpeed: 24, effectiveSpeed: 10, stoppedAtNotch: false,
    });
  });
});

describe('Morse timing', () => {
  it('preserves 20 WPM element timing while expanding spacing', () => {
    const timeline = buildMorseTimeline('A', 'international', { ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 10 });
    expect(timeline.dit).toBeCloseTo(0.06);
    expect(timeline.tones.map((tone) => tone.duration)).toEqual([0.06, 0.18]);
    expect(timeline.characterGap).toBeCloseTo(0.36);
    expect(timeline.wordGap).toBeCloseTo(0.84);
  });
  it('uses a full word gap without stretching tones', () => {
    const timeline = buildMorseTimeline('E E', 'international', { ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 20 });
    expect(timeline.tones[1].start - (timeline.tones[0].start + timeline.tones[0].duration)).toBeCloseTo(0.42);
    expect(timeline.tones.every((tone) => tone.duration === 0.06)).toBe(true);
  });
  it('repeats prosign tokens as whole units', () => {
    const timeline = buildRepeatedSymbolTimeline('[AS]', '.-...', 2, { ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 20 });
    expect(timeline.characters).toHaveLength(2);
    expect(timeline.characters.every((character) => character.symbol === '[AS]')).toBe(true);
  });
  it('spaces Discover repeats with character gaps, not word gaps', () => {
    const timeline = buildRepeatedSymbolTimeline('A', '.-', 2, { ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 20 });
    const firstEnd = timeline.characters[0].end;
    const secondStart = timeline.characters[1].start;
    expect(secondStart - firstEnd).toBeCloseTo(timeline.characterGap);
    expect(timeline.characterGap).toBeCloseTo(0.18);
    expect(timeline.wordGap).toBeCloseTo(0.42);
  });
});

describe('FIFO queue scoring', () => {
  it('marks Queue 2 input before the third symbol as early', () => {
    const queue = new QueueEvaluator(['A','B','C','D'], 2);
    const result = queue.input('A', 2, 1, [0.2,0.4,0.6,0.8]);
    expect(result?.isCorrect).toBe(true);
    expect(result?.isEarly).toBe(true);
    expect(result?.actualDepth).toBe(1);
  });
  it.each([1, 2, 3])('opens the FIFO gate at Queue %i only after enough later symbols', (depth) => {
    const earlyQueue = new QueueEvaluator(['A','B','C','D','E'], depth);
    expect(earlyQueue.input('A', depth, 1, [0,1,2,3,4])?.isEarly).toBe(true);
    const readyQueue = new QueueEvaluator(['A','B','C','D','E'], depth);
    const result = readyQueue.input('A', depth + 1, 1, [0,1,2,3,4]);
    expect(result?.isEarly).toBe(false);
    expect(result?.actualDepth).toBe(depth);
  });
  it('builds stable depth only through FIFO cadence', () => {
    const queue = new QueueEvaluator(['A','B','C','D','E','F','G'], 2);
    ['A','B','C','D','E'].forEach((symbol, index) => queue.input(symbol, index + 3, index + 1, [0,1,2,3,4,5,6]));
    expect(queue.metrics().stableDepth).toBe(2);
    expect(queue.metrics().longestStableRun).toBe(5);
    expect(queue.metrics().earlyCopies).toBe(0);
  });
  it('detects burst output instead of rewarding it', () => {
    const queue = new QueueEvaluator(['A','B','C','D','E','F'], 2);
    ['A','B','C','D'].forEach((symbol, index) => queue.input(symbol, 6, 4 + index * 0.03, [0,1,2,3,4,5]));
    expect(queue.metrics().burstOutputs).toBe(1);
    expect(queue.metrics().stableDepth).toBeLessThan(2);
  });
});

describe('random group sequencing', () => {
  it('can avoid immediate character repeats', () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const group = randomGroup('international', 24, ['A', 'W', 'C', 'G'], { avoidImmediateRepeat: true });
      for (let index = 1; index < group.length; index += 1) {
        expect(group[index]).not.toBe(group[index - 1]);
      }
    }
  });
});

describe('exam session volume', () => {
  it('builds sheets with audio that fits the official duration where applicable', () => {
    const wabunPlain = buildExamSession({ subjectId: 'wabun', telegram: false });
    const wabunForm = buildExamSession({ subjectId: 'wabun', telegram: true });
    const codes = buildExamSession({ subjectId: 'codes', telegram: false });
    const plain = buildExamSession({ subjectId: 'plain', telegram: true });
    expect(wabunPlain.sheets).toHaveLength(2);
    expect(wabunForm.sheets).toHaveLength(5);
    expect(codes.sheets).toHaveLength(2);
    expect(plain.sheets).toHaveLength(2);
    // 和文額表は複数枚になるので時間フィット対象外。本文ストリームと欧文は5分以内。
    expect(measureExamAudioSec(wabunPlain.sheets, 'wabun', 22)).toBeLessThanOrEqual(310);
    expect(measureExamAudioSec(codes.sheets, 'international', 21)).toBeLessThanOrEqual(310);
    expect(measureExamAudioSec(plain.sheets, 'international', 23)).toBeLessThanOrEqual(310);
    expect(wabunForm.totalChars).toBeGreaterThan(300);
    expect(codes.totalChars).toBeGreaterThan(150);
    expect(plain.totalChars).toBeGreaterThan(250);
  });
  it('builds codes telegram pages as 40 five-letter groups (8×5) with address+body count', () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const codes = buildExamSession({ subjectId: 'codes', telegram: true });
      expect(codes.sheets).toHaveLength(2);
      expect(codes.sheets[0].playText.startsWith('HRHR NR ')).toBe(true);
      expect(codes.sheets[1].playText.startsWith('NR ')).toBe(true);
      expect(codes.sheets[1].playText.startsWith('HRHR')).toBe(false);
      for (const sheet of codes.sheets) {
        const groups = sheet.body.trim().split(/\s+/);
        expect(groups).toHaveLength(40);
        expect(groups.every((group) => /^[A-Z0-9]{5}$/.test(group))).toBe(true);
        expect(sheet.body.split('\n')).toHaveLength(5);
        const addressWords = sheet.address.trim().split(/\s+/).length;
        const raw = addressWords + 40;
        expect(sheet.count === String(raw) || sheet.count.startsWith(`${raw + 1}/`) || /^\d+\/\d+$/.test(sheet.count)).toBe(true);
      }
      // 1通目は AR、最終通（2通目）は次がないので AR なし
      expect(codes.sheets[0].playText.endsWith(' +')).toBe(true);
      expect(codes.sheets[1].playText.endsWith(' +')).toBe(false);
    }
  });
  it('builds the wabun exam as exactly 2 telegrams on 5 sheets', () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const wabun = buildExamSession({ subjectId: 'wabun', telegram: true });
      expect(wabun.sheets).toHaveLength(5);

      const starts = wabun.sheets.filter((sheet) => !sheet.continuation);
      expect(starts).toHaveLength(2);
      expect(starts[0].playText.startsWith('HRHR 、 ')).toBe(true);
      expect(starts[1].playText.startsWith('、 ')).toBe(true);
      expect(starts[1].playText.startsWith('HRHR')).toBe(false);
      expect(starts.every((sheet) => sheet.address !== '—')).toBe(true);

      const pageSplit = starts.map((sheet) => Math.ceil(Number(sheet.count) / 60));
      expect(pageSplit[0] + pageSplit[1]).toBe(5);
      expect([2, 3]).toContain(pageSplit[0]);
      expect([2, 3]).toContain(pageSplit[1]);

      const continuations = wabun.sheets.filter((sheet) => sheet.continuation);
      expect(continuations).toHaveLength(3);
      expect(continuations.every((sheet) => sheet.address === '—')).toBe(true);
      expect(continuations.every((sheet) => !sheet.playText.startsWith('HRHR'))).toBe(true);

      for (let index = 0; index < wabun.sheets.length; index += 1) {
        const sheet = wabun.sheets[index];
        if (sheet.continuation) continue;
        const count = Number(sheet.count);
        const pages = Math.ceil(count / 60);
        if (pages === 1) {
          expect(sheet.playText.endsWith(' [ラタ]')).toBe(true);
        } else {
          expect(sheet.playText.endsWith(' ウホ')).toBe(true);
          for (let page = 1; page < pages; page += 1) {
            const next = wabun.sheets[index + page];
            expect(next?.continuation).toBe(true);
            expect(next?.count).toBe(sheet.count);
            if (page === pages - 1) {
              expect(next?.playText.endsWith(' [ラタ]')).toBe(true);
            } else {
              expect(next?.playText.endsWith(' ウホ')).toBe(true);
            }
          }
        }
      }
    }
  });
  it('splits a 100-char wabun telegram into full form + body-only page', () => {
    const wabun = buildExamSession({ subjectId: 'wabun', telegram: true, wabunBodyChars: 100 });
    expect(wabun.sheets).toHaveLength(2);
    expect(wabun.sheets[0].continuation).toBeFalsy();
    expect(wabun.sheets[0].body.replace(/\s+/g, '').length).toBe(60);
    expect(wabun.sheets[0].count).toBe('100');
    expect(wabun.sheets[0].playText.endsWith(' ウホ')).toBe(true);
    expect(wabun.sheets[1].continuation).toBe(true);
    expect(wabun.sheets[1].address).toBe('—');
    expect(wabun.sheets[1].body.replace(/\s+/g, '').length).toBe(40);
    expect(wabun.sheets[1].playText.endsWith(' [ラタ]')).toBe(true);
  });
  it('splits a 130-char wabun telegram into 3 pages (2nd+ body only)', () => {
    const wabun = buildExamSession({ subjectId: 'wabun', telegram: true, wabunBodyChars: 130 });
    expect(wabun.sheets).toHaveLength(3);
    expect(wabun.sheets[0].body.replace(/\s+/g, '').length).toBe(60);
    expect(wabun.sheets[0].playText.endsWith(' ウホ')).toBe(true);
    expect(wabun.sheets[1].continuation).toBe(true);
    expect(wabun.sheets[1].body.replace(/\s+/g, '').length).toBe(60);
    expect(wabun.sheets[1].playText.endsWith(' ウホ')).toBe(true);
    expect(wabun.sheets[2].continuation).toBe(true);
    expect(wabun.sheets[2].body.replace(/\s+/g, '').length).toBe(10);
    expect(wabun.sheets[2].playText.endsWith(' [ラタ]')).toBe(true);
    expect(wabun.sheets.every((sheet) => sheet.count === '130')).toBe(true);
  });
  it('splits a 264-char wabun telegram into 5 pages (2nd+ body only)', () => {
    const wabun = buildExamSession({ subjectId: 'wabun', telegram: true, wabunBodyChars: 264 });
    expect(wabun.sheets).toHaveLength(5);
    expect(wabun.sheets[0].continuation).toBeFalsy();
    expect(wabun.sheets[0].body.replace(/\s+/g, '').length).toBe(60);
    expect(wabun.sheets[0].playText.endsWith(' ウホ')).toBe(true);
    for (let page = 1; page < 4; page += 1) {
      expect(wabun.sheets[page].continuation).toBe(true);
      expect(wabun.sheets[page].body.replace(/\s+/g, '').length).toBe(60);
      expect(wabun.sheets[page].playText.endsWith(' ウホ')).toBe(true);
    }
    expect(wabun.sheets[4].continuation).toBe(true);
    expect(wabun.sheets[4].body.replace(/\s+/g, '').length).toBe(24);
    expect(wabun.sheets[4].playText.endsWith(' [ラタ]')).toBe(true);
    expect(wabun.sheets.every((sheet) => sheet.count === '264')).toBe(true);
  });
  it('fits a short wabun telegram on a single page', () => {
    const wabun = buildExamSession({ subjectId: 'wabun', telegram: true, wabunBodyChars: 48 });
    expect(wabun.sheets).toHaveLength(1);
    expect(wabun.sheets[0].continuation).toBeFalsy();
    expect(wabun.sheets[0].count).toBe('48');
    expect(wabun.sheets[0].playText.endsWith(' [ラタ]')).toBe(true);
  });
  it('prefixes exam sessions with シケン シケン announcement', () => {
    for (const subjectId of ['wabun', 'codes', 'plain'] as const) {
      const session = buildExamSession({ subjectId, telegram: true });
      expect(session.announcement).toBe('シケン シケン');
    }
  });
  it('sends wabun filing time with セ/コ and 12-hour cut digits', () => {
    expect(formatWabunFilingTimePlay(9, 35)).toBe('セ [9]、[3][5]');
    expect(formatWabunFilingTimePlay(17, 38)).toBe('コ [5]、[3][8]');
    expect(formatWabunFilingTimeLabel(17, 38)).toBe('コ 5字38分');
    const wabun = buildExamSession({ subjectId: 'wabun', telegram: true, wabunBodyChars: 48 });
    expect(wabun.sheets[0].playText).toMatch(/[セコ] /);
    expect(wabun.sheets[0].playText).toMatch(/\[\d\](?:\[\d\])?、\[\d\]\[\d\]/);
  });
  it('wraps plain telegrams with HRHR on first only, then NR, BT(=); AR(+) only on non-final telegram', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const plain = buildExamSession({ subjectId: 'plain', telegram: true, examClass: 'class1' });
      expect(plain.sheets[0].playText.startsWith('HRHR NR ')).toBe(true);
      expect(plain.sheets[1].playText.startsWith('NR ')).toBe(true);
      expect(plain.sheets[1].playText.startsWith('HRHR')).toBe(false);
      expect(plain.sheets[0].playText.endsWith(' +')).toBe(true);
      expect(plain.sheets[1].playText.endsWith(' +')).toBe(false);
      for (const sheet of plain.sheets) {
        expect(sheet.playText).toContain(' = ');
        expect(sheet.receivedAt).toMatch(/^\d{4}$/);
      }
      if (plain.sheets[0].signature) {
        expect(plain.sheets[0].playText).toContain(`=${plain.sheets[0].signature} +`);
      }
    }
  });
  it('wraps wabun telegrams with HRHR, 、, [ホレ], [ラタ]', () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const wabun = buildExamSession({ subjectId: 'wabun', telegram: true });
      const first = wabun.sheets[0];
      const last = wabun.sheets[wabun.sheets.length - 1];
      const secondStart = wabun.sheets.find((sheet, index) => index > 0 && !sheet.continuation);
      expect(first.playText.startsWith('HRHR 、 ')).toBe(true);
      expect(first.playText).toContain(' [ホレ] ');
      expect(first.playText).toMatch(/\[[0-9]\]、\[[0-9]\]/);
      expect(first.address).toContain('」');
      expect(secondStart?.playText.startsWith('、 ')).toBe(true);
      expect(secondStart?.playText.startsWith('HRHR')).toBe(false);
      expect(last.playText.endsWith(' [ラタ]')).toBe(true);
    }
  });
  it('includes ヰ and ヱ in wabun body only when includeWiWe is on', () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const off = buildExamSession({ subjectId: 'wabun', telegram: true });
      const offBody = off.sheets.map((sheet) => sheet.body).join('');
      expect(offBody).not.toMatch(/[ヰヱ]/);

      const on = buildExamSession({ subjectId: 'wabun', telegram: true, includeWiWe: true });
      const onBody = on.sheets.map((sheet) => sheet.body).join('');
      expect(onBody).toContain('ヰ');
      expect(onBody).toContain('ヱ');
    }
  });
  it('uses 12-hour M/S filing time for class3', () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const sheet = buildExamSession({
        subjectId: 'plain', telegram: true, examClass: 'class3', procedural: true,
      }).sheets[0];
      expect(sheet.receivedAt).toMatch(/^\d{1,2}( \d{2})?[MS]$/);
      expect(sheet.date).toBeTruthy();
    }
  });
});

describe('telegram token playback', () => {
  it('plays [BT]/[AR] and =/+ as single Morse units', () => {
    const bracket = buildMorseTimeline('HRHR [BT] A [AR]', 'international', {
      ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 20,
    });
    expect(bracket.characters.some((character) => character.symbol === '[BT]')).toBe(true);
    expect(bracket.characters.some((character) => character.symbol === '[AR]')).toBe(true);
    const printed = buildMorseTimeline('= HONTEN +', 'international', {
      ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 20,
    });
    expect(printed.characters.map((character) => character.symbol).join('')).toBe('=HONTEN+');
    expect(printed.tones.filter((tone) => tone.symbol === '=').length).toBe(INTERNATIONAL_MORSE['='].length);
  });
  it('plays wabun [ホレ]/[ラタ]/cut digits and HRHR', () => {
    const timeline = buildMorseTimeline('HRHR 、 セ [9]、[5][5] [ホレ] ア [ラタ]', 'wabun', {
      ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 20,
    });
    const symbols = timeline.characters.map((character) => character.symbol);
    expect(symbols.filter((symbol) => symbol === 'H')).toHaveLength(2);
    expect(symbols).toContain('[ホレ]');
    expect(symbols).toContain('[ラタ]');
    expect(symbols).toContain('[9]');
    expect(symbols).toContain('、');
  });
});

describe('plain corpus', () => {
  it('keeps a large pool of official-style plain passages', () => {
    const stats = plainCorpusStats();
    expect(stats.oubun).toBeGreaterThanOrEqual(100);
    expect(stats.wabun).toBeGreaterThanOrEqual(100);
    expect(OUBUN_PLAIN_PASSAGES.every((passage) => passage === passage.toUpperCase())).toBe(true);
    expect(OUBUN_PLAIN_PASSAGES.every((passage) => !/[.]/.test(passage))).toBe(true);
    expect(WABUN_PLAIN_PASSAGES.every((passage) => /^[\u30A0-\u30FF0-9、ー]+$/.test(passage))).toBe(true);
  });
  it('feeds exam plain bodies from stored sets with natural English patterns', () => {
    const sheet = buildExamSession({ subjectId: 'plain', telegram: true }).sheets[0];
    expect(sheet.body.split(/\s+/).length).toBeGreaterThan(30);
    expect(/\b(IT IS|THERE IS|AT THE|THESE|THAT)\b/.test(sheet.body)).toBe(true);
  });
  it('loads 1000 stored exam sets per telegram subject from one JSON', async () => {
    const { storedExamSetCount } = await import('./examSets');
    expect(storedExamSetCount('plain')).toBe(1000);
    expect(storedExamSetCount('codes')).toBe(1000);
    expect(storedExamSetCount('wabun')).toBe(1000);
  });
  it('expands voiced kana into base + dakuten for playback', () => {
    expect(expandWabunVoicing('ガ')).toEqual(['カ', '゛']);
    expect(tokenizeMorseInput('ガア', 'wabun')).toEqual(['カ', '゛', 'ア']);
  });
  it('maps small kana to full-size so センチョウ etc. actually tone', () => {
    expect(expandWabunVoicing('ョ')).toEqual(['ヨ']);
    expect(expandWabunVoicing('ッ')).toEqual(['ツ']);
    expect(tokenizeMorseInput('センチョウ', 'wabun')).toEqual(['セ', 'ン', 'チ', 'ヨ', 'ウ']);
    const timeline = buildMorseTimeline('センチョウ', 'wabun', {
      ...DEFAULT_SETTINGS, characterSpeed: 20, effectiveSpeed: 20,
    });
    expect(timeline.characters.map((character) => character.symbol).join('')).toBe('センチヨウ');
    expect(timeline.tones.length).toBeGreaterThan(0);
  });
});

describe('exam procedure marks for scoring', () => {
  it('strips occidental HRHR NR BT(=) AR(+) that are not written on the form', () => {
    const play = 'HRHR NR 34 ATSUTAMARU/JEKU 42 1324 = MONIN SHANGHAI = ABCDE FGHIJ =CAPTAIN +';
    const writable = stripExamProcedureMarks(play, 'international');
    expect(writable).toBe('34 ATSUTAMARU/JEKU 42 1324 MONIN SHANGHAI ABCDE FGHIJ CAPTAIN');
    expect(writable).not.toMatch(/HRHR|NR|=|\+/);
    const scored = scoreExamCopy(writable, '34 ATSUTAMARU/JEKU 42 1324 MONIN SHANGHAI ABCDE FGHIJ CAPTAIN', 'international');
    expect(scored.expected.startsWith('HR')).toBe(false);
    expect(scored.matches).toBe(scored.expected.length);
  });
  it('strips wabun HRHR ホレ ラタ ウホ and separator 、 but keeps filing-time 、', () => {
    const play = 'HRHR 、 125 ハツ01 タナ93 コ [5]、[3][8] 、 サイトウキヨシ [ホレ] オウジユウ [ラタ]';
    const writable = stripExamProcedureMarks(play, 'wabun');
    expect(writable).toContain('[5]、[3][8]');
    expect(writable).toContain('125');
    expect(writable).toContain('オウジユウ');
    expect(writable).not.toMatch(/HRHR|ホレ|ラタ|ウホ/);
    expect(writable).not.toMatch(/^\s*、/);
  });
});

describe('exam recovery scoring', () => {
  it('recovers after a skipped block instead of shifting all later chars', () => {
    const scored = scoreExamCopy('ABCDEFGHIJ', 'DEFGHIJ', 'international');
    expect(scored.matches).toBe(7);
    expect(scored.deletions).toBe(3);
    expect(scored.substitutions).toBe(0);
    expect(scored.penalty).toBe(3); // 脱字×1 ×3
    expect(scored.hitRate).toBeCloseTo(0.7);
  });
  it('charges redundant characters as 冗字 (3 points each)', () => {
    const scored = scoreExamCopy('RADIO TOKYO', 'RADIO XXX TOKYO', 'international');
    expect(scored.matches).toBe(10);
    expect(scored.insertions).toBe(3);
    expect(scored.penalty).toBe(9);
    expect(scored.hitRate).toBe(1);
  });
  it('counts substitutions without wiping the rest of the copy', () => {
    const scored = scoreExamCopy('MORSE', 'MARSE', 'international');
    expect(scored.matches).toBe(4);
    expect(scored.substitutions).toBe(1);
    expect(scored.penalty).toBe(3);
  });
  it('prefers discarding a block over forcing many wrong characters', () => {
    const forcedWrong = scoreExamCopy('ABCDEFGHIJ', 'XYZDEFGHIJ', 'international');
    const discardBlock = scoreExamCopy('ABCDEFGHIJ', 'DEFGHIJ', 'international');
    expect(discardBlock.penalty).toBeLessThan(forcedWrong.penalty);
    expect(discardBlock.deletions).toBe(3);
    expect(discardBlock.substitutions).toBe(0);
  });
  it('weights 誤字 heavier than 脱字 per official criteria', () => {
    const wrong = scoreExamCopy('ABCDE', 'XBCDE', 'international');
    const omit = scoreExamCopy('ABCDE', 'BCDE', 'international');
    expect(wrong.penalty).toBe(3);
    expect(omit.penalty).toBe(1);
    expect(wrong.accuracy).toBeLessThan(omit.accuracy);
  });
  it('charges 抹消・訂正 as 1 point per up to 3 corrected chars', () => {
    expect(correctionPenaltyPoints(0)).toBe(0);
    expect(correctionPenaltyPoints(1)).toBe(1);
    expect(correctionPenaltyPoints(3)).toBe(1);
    expect(correctionPenaltyPoints(4)).toBe(2);
    expect(correctionPenaltyPoints(7)).toBe(3);
    const scored = scoreExamCopy('ABCDE', 'ABCDE', 'international', 4);
    expect(scored.correctionPenalty).toBe(2);
    expect(scored.penalty).toBe(2);
  });
});

describe('confusion analysis', () => {
  const log = (correctSymbol: string, inputSymbol: string): AnswerLog => ({ id: Math.random().toString(), timestamp: 0, alphabetType: 'international', correctSymbol, inputSymbol, characterSpeed: 20, effectiveSpeed: 12, queueTarget: 0, actualQueueDepth: 0, stimulusTime: 0, inputTime: 0, responseLatency: .4, mode: 'sound', isCorrect: correctSymbol === inputSymbol, isEarly: false, sessionId: 'test' });
  const logs = [...Array.from({length:18},()=>log('L','F')),...Array.from({length:13},()=>log('F','L')),...Array.from({length:8},()=>log('H','5')),...Array.from({length:61},()=>log('A','A'))];
  it('stores directed confusion cells', () => {
    const matrix = confusionMatrix(logs);
    expect(matrix.find((cell) => cell.correct === 'L' && cell.input === 'F')?.count).toBe(18);
    expect(matrix.find((cell) => cell.correct === 'F' && cell.input === 'L')?.count).toBe(13);
  });
  it('ranks bidirectional weak pairs', () => {
    expect(weakPairs(logs)[0]).toMatchObject({ a: 'L', b: 'F', total: 31 });
  });
});
