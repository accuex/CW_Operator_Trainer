import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fadeAt, schedulePending, type Station } from '../band';
import { seeded } from '../random';
import { adjustDifficulty, type DifficultyVector, type QsoEvidence } from '../difficulty';
import { normalizeQsoProfile, updateSkills } from '../skills';
import { updateWabunSkills } from '../wabun/learning';
import { voteWabunAxes } from '../wabun/adapt';
import type { WabunEvidence } from '../wabun/review';
import type { AnswerLog } from '../../types';
import { CwDecoder, decodedText, type DecodedChar } from './decoder';
import { assistedAnswers, compareDecode, decodeAssist, decodeNote, followDecoder, isAssisted, keyedTruth, newDecodeUsage, wabunWithoutCopy, withoutCopy } from './assist';
import { DECODE_PRESET_IDS, DECODE_PRESETS } from './presets';
import { agreement, runDecodePreset, runDecodeSim, simStations, VFO, type DecodeSimStation } from './sim';

const OVER = 'JA1ZZZ DE JF8QNW GM UR RST 579 579 NAME TARO TARO QTH SAPPORO HW? BK';
const one = (station: Partial<DecodeSimStation>, extra: Parameters<typeof runDecodeSim>[0] extends infer O ? Partial<O> : never = {}) =>
  runDecodeSim({ seed: 11, noise: 0.2, ...extra, stations: [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 18, strength: 0.7, ...station }] });
const printed = (chars: readonly DecodedChar[]) => chars.filter((char) => char.mark !== 'space');
const reasonCount = (chars: readonly DecodedChar[], reason: string) => printed(chars).filter((char) => char.reasons.includes(reason as never)).length;
const truthOf = (result: ReturnType<typeof runDecodeSim>, index = 0) => result.sent[index].tx.map(keyedTruth).join(' ');

describe('DECODE: clean keying', () => {
  it('reads a clean Roman over almost perfectly, digits and spacing included', () => {
    const { result } = runDecodePreset('decode-clean');
    expect(agreement(truthOf(result), result.text)).toBeGreaterThanOrEqual(0.97);
    expect(result.text).toContain('579 579');
    expect(result.text).toContain('HW?');
    // Words come out as words.
    expect(result.text.trim().split(/\s+/).length).toBe(OVER.split(' ').length);
    expect(printed(result.chars).filter((char) => char.mark === 'ok').length / printed(result.chars).length).toBeGreaterThan(0.9);
  });

  it('reads wabun: [ホレ] switches to kana, [ラタ] back, voiced marks join the kana', () => {
    const { result } = runDecodePreset('decode-wabun');
    expect(agreement(truthOf(result), result.text)).toBeGreaterThanOrEqual(0.95);
    expect(result.text).toContain('[ホレ]');
    expect(result.text).toContain('[ラタ]');
    expect(result.text).toContain('コンニチハ');
    // ゴ / ガ arrive as base + ゛ and print as one kana.
    expect(result.text).toMatch(/ゴキゲンヨウ/);
    expect(result.text).toMatch(/ガンバ/);
    expect(result.text.indexOf('[ラタ]')).toBeLessThan(result.text.lastIndexOf('KN'));
    // Latin before ホレ and after ラタ.
    expect(result.text.startsWith('JA1ZZZ DE JF8QNW')).toBe(true);
  });

  it('LANG 欧文 never prints kana; LANG 和文 prints kana from the start', () => {
    const roman = runDecodePreset('decode-wabun', { lang: 'roman' }).result;
    expect(roman.text).not.toMatch(/[ァ-ヶ]/);
    expect(roman.text).not.toContain('[ホレ]');
    const wabun = runDecodePreset('decode-wabun', { lang: 'wabun' }).result;
    expect(wabun.text.slice(0, 12)).toMatch(/[ァ-ヶ]/);
  });

  it('keyer speeds 12–30 WPM all read (AUTO follows from 15)', () => {
    for (const wpm of [12, 20, 30]) {
      const result = one({ wpm }, { seed: 30 + wpm });
      expect(agreement(truthOf(result), result.text), `${wpm} WPM`).toBeGreaterThanOrEqual(wpm >= 25 ? 0.85 : 0.95);
      expect(Math.abs(result.decoder!.wpm - wpm), `${wpm} WPM estimate`).toBeLessThan(wpm * 0.15);
    }
  });

  it('noise alone does not move the speed estimate (nothing on frequency)', () => {
    for (const noise of [0.3, 0.6]) {
      const result = runDecodeSim({ seed: 71, noise, qrn: 0.5, limit: 120, stations: [{ call: 'JF8QNW', text: OVER, offset: 600, wpm: 30, strength: 1 }] });
      expect(Math.abs(result.decoder!.wpm - 15), `noise ${noise}`).toBeLessThan(2);
    }
  });

  it('a speed change mid-stream: AUTO follows; LOCK holds and reads worse', () => {
    const stations: DecodeSimStation[] = [
      { call: 'JF8QNW', text: OVER, offset: 0, wpm: 16, strength: 0.7 },
      { call: 'JF8QNW', text: OVER, offset: 0, wpm: 28, strength: 0.7, delay: 75 },
    ];
    const auto = runDecodeSim({ seed: 41, stations, decoderWpm: 16 });
    const lock = runDecodeSim({ seed: 41, stations, decoderWpm: 16, speed: 'lock' });
    expect(Math.abs(auto.decoder!.wpm - 28)).toBeLessThan(4);
    expect(lock.decoder!.wpm).toBe(16);
    const late = (result: typeof auto) => decodedText(result.chars.filter((char) => char.start > 75));
    expect(agreement(OVER, late(auto))).toBeGreaterThan(agreement(OVER, late(lock)));
    expect(agreement(OVER, late(auto))).toBeGreaterThanOrEqual(0.85);
  });
});

describe('DECODE: fists', () => {
  it('a mild straight key still reads, with at most an occasional ? or spacing slip', () => {
    const { result } = runDecodePreset('decode-straight');
    expect(agreement(truthOf(result), result.text)).toBeGreaterThanOrEqual(0.9);
  });

  it('fatigue: more doubtful characters late in a long over than early (not broken)', () => {
    let early = 0;
    let late = 0;
    let score = 0;
    for (const seed of [1, 2, 3, 703]) {
      const { result } = runDecodePreset('decode-fatigue', { seed });
      const chars = printed(result.chars);
      const mid = (chars[0].start + chars.at(-1)!.end) / 2;
      const doubtful = (char: DecodedChar) => char.mark !== 'ok' || char.reasons.includes('fist-timing');
      early += chars.filter((char) => char.start < mid && doubtful(char)).length;
      late += chars.filter((char) => char.start >= mid && doubtful(char)).length;
      score += agreement(truthOf(result), result.text);
    }
    expect(late).toBeGreaterThan(early);
    expect(score / 4).toBeGreaterThanOrEqual(0.8);
  });
});

describe('DECODE: band conditions', () => {
  it('weak: worse as the signal drops, then nothing; says weak', () => {
    const scores = [0.7, 0.3, 0.25, 0.12].map((strength) => {
      const result = one({ strength }, { noise: 0.3 });
      return { strength, score: agreement(OVER, result.text), weak: reasonCount(result.chars, 'weak'), n: printed(result.chars).length };
    });
    expect(scores[0].score).toBeGreaterThanOrEqual(0.97);
    expect(scores[2].score).toBeLessThan(scores[0].score);
    expect(scores[2].weak).toBeGreaterThan(0);
    expect(scores[3].n).toBeLessThan(5);
  });

  it('QSB: deep fades cost characters, marked qsb', () => {
    const { result } = runDecodePreset('decode-qsb');
    const clean = runDecodePreset('decode-qsb', { qsb: 0 }).result;
    expect(agreement(truthOf(result), result.text)).toBeLessThan(agreement(truthOf(clean), clean.text));
    expect(reasonCount(result.chars, 'qsb')).toBeGreaterThan(0);
  });

  it('QRN: crashes garble, marked qrn', () => {
    const quiet = one({}, { seed: 51 });
    const noisy = one({}, { seed: 51, qrn: 1 });
    expect(agreement(OVER, noisy.text)).toBeLessThan(agreement(OVER, quiet.text));
    expect(reasonCount(noisy.chars, 'qrn')).toBeGreaterThan(0);
  });

  it('QRM: a strong neighbour ruins 2.4k; a narrow filter cuts it (250 best)', () => {
    const score = (filter: number) => {
      const { result } = runDecodePreset('decode-qrm', { filter });
      return { score: agreement(truthOf(result), decodedText(result.chars.filter((char) => char.source !== result.stations[1].id))), qrm: reasonCount(result.chars, 'qrm') };
    };
    const wide = score(2400);
    const mid = score(500);
    const narrow = score(250);
    expect(narrow.score).toBeGreaterThanOrEqual(0.95);
    expect(mid.score).toBeGreaterThan(wide.score);
    expect(narrow.score).toBeGreaterThan(wide.score + 0.3);
    expect(wide.qrm).toBeGreaterThan(0);
  });

  it('filter: a weak signal reads better narrow (less noise)', () => {
    const at = (filter: number) => agreement(OVER, one({ strength: 0.25 }, { filter, seed: 61 }).text);
    expect(at(250)).toBeGreaterThan(at(2400));
  });

  it('off frequency: zero-in reads; +90 Hz doubtful (off-frequency); +150 Hz nothing', () => {
    const zero = one({ offset: 0 }, { noise: 0.3 });
    const off = runDecodePreset('decode-offfreq').result;
    const far = one({ offset: 150 }, { noise: 0.3 });
    expect(agreement(OVER, zero.text)).toBeGreaterThanOrEqual(0.97);
    expect(reasonCount(off.chars, 'off-frequency')).toBeGreaterThan(0);
    expect(printed(off.chars).filter((char) => char.mark !== 'ok').length).toBeGreaterThan(printed(zero.chars).filter((char) => char.mark !== 'ok').length);
    expect(printed(far.chars).length).toBeLessThan(3);
  });

  it('collision: follows the stronger station; the overlap is doubtful and says collision', () => {
    const { result } = runDecodePreset('decode-collision');
    const [strong, weak] = result.stations;
    const sources = printed(result.chars).map((char) => char.source);
    expect(sources.filter((source) => source === strong.id).length).toBeGreaterThan(sources.filter((source) => source === weak.id).length);
    expect(reasonCount(result.chars, 'collision')).toBeGreaterThan(0);
    expect(agreement(truthOf(result, 0), result.text)).toBeLessThan(0.97);
  });
});

describe('DECODE: rig behaviour', () => {
  it('prints nothing while we transmit (muted), and reads again after', () => {
    const result = one({ text: `${OVER} ${OVER}` }, { tx: [{ start: 10, end: 20 }] });
    expect(printed(result.chars).filter((char) => char.start >= 10.05 && char.end <= 20)).toHaveLength(0);
    expect(result.decoder!.stats.muted).toBeGreaterThan(0);
    expect(printed(result.chars).some((char) => char.start > 22)).toBe(true);
    // What was cut and what follows are not run together.
    const lastBefore = result.chars.findLastIndex((char) => char.mark !== 'space' && char.start < 10);
    expect(result.chars[lastBefore + 1]?.mark).toBe('space');
  });

  it('OFF: no decoder, nothing printed, nothing spent', () => {
    const result = one({}, { decode: false });
    expect(result.decoder).toBeNull();
    expect(result.chars).toHaveLength(0);
    expect(result.ms).toBe(0);
  });

  it('is deterministic: the same seed prints the same characters and confidences', () => {
    for (const id of DECODE_PRESET_IDS) {
      const a = runDecodePreset(id).result.chars.map((char) => `${char.text}${char.conf}${char.reasons.join()}`);
      const b = runDecodePreset(id).result.chars.map((char) => `${char.text}${char.conf}${char.reasons.join()}`);
      expect(a, id).toEqual(b);
    }
  });

  it('keeps a bounded buffer (decoder and session usage)', () => {
    const decoder = new CwDecoder({ keep: 40 });
    const random = seeded(3);
    const stations = simStations(random, [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 20, strength: 0.7, repeat: 3 }], VFO, 0);
    const usage = newDecodeUsage();
    for (let t = 0; t < 80; t += 0.1) {
      for (const station of stations) { schedulePending(station, t, t + 1.5, random); station.fade = fadeAt(station, t, 0); }
      decoder.process(t, { stations, vfo: VFO, filter: 500, noise: 0.2, epoch: 0, crashAt: () => 0, muted: () => false });
      followDecoder(usage, decoder.chars);
    }
    expect(decoder.chars.length).toBeLessThanOrEqual(40);
    // The session keeps following past the window: every printed character counted once.
    expect(usage.shown).toBeGreaterThan(80);
    expect(usage.chars.length).toBe(usage.shown + usage.chars.filter((char) => char.mark === 'space').length);
  });

  it('reset(true) clears the window (new session / QRT); a new epoch forgets the signal only', () => {
    const result = one({});
    const decoder = result.decoder!;
    const version = decoder.version;
    decoder.reset(true);
    expect(decoder.chars).toHaveLength(0);
    expect(decoder.version).toBeGreaterThan(version);
  });

  it('no truth leakage: reads only where / how loud / the key marks, never the text', () => {
    const random = seeded(5);
    const stations = simStations(random, [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 20, strength: 0.7 }], VFO, 0);
    const touched = new Set<string>();
    const watched = stations.map((station) => new Proxy(station, { get(target, key, receiver) { touched.add(String(key)); return Reflect.get(target, key, receiver); } }));
    const decoder = new CwDecoder();
    for (let t = 0; t < 40; t += 0.1) {
      for (const station of stations) { schedulePending(station, t, t + 1.5, random); station.fade = fadeAt(station, t, 0); }
      decoder.process(t, { stations: watched as Station[], vfo: VFO, filter: 500, noise: 0.2, epoch: 0, crashAt: () => 0, muted: () => false });
    }
    expect(decoder.chars.length).toBeGreaterThan(20);
    const allowed = new Set(['rf', 'strength', 'fade', 'marks', 'id', 'wpm']);
    expect([...touched].filter((key) => !allowed.has(key))).toEqual([]);
    // And the source has no path to a message: no queue / text / call / transmissions.
    const source = readFileSync(new URL('./decoder.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\.queue|\.call\b|station\.text|\.loop\b|Transmission|keyText|onTransmission/);
  });
});

describe('DECODE: learning kept apart', () => {
  const char = (seq: number, text: string, mark: DecodedChar['mark'] = 'ok'): DecodedChar => ({
    seq, text, code: '', start: seq, end: seq + 0.1, epoch: 0, conf: 1, mark, script: 'roman', source: 1, wpm: 20, env: null, reasons: [],
  });

  it('records how DECODE was used, never that something was read', () => {
    expect(decodeAssist(undefined)).toBeUndefined();
    expect(decodeAssist(newDecodeUsage())).toBeUndefined();
    const silent = { ...newDecodeUsage(), onSeconds: 12 };
    expect(decodeAssist(silent)).toMatchObject({ decode: 'on', decodeUsed: true, decodeSeconds: 12, decodeShown: 0, loggedShown: 0 });
    const usage = newDecodeUsage();
    usage.onSeconds = 30;
    followDecoder(usage, [char(1, 'T'), char(2, 'A'), char(3, 'R'), char(4, 'O'), char(5, ' ', 'space'), char(6, '5'), char(7, '7'), char(8, '9')]);
    const assist = decodeAssist(usage, ['TARO', '599', 'Q'])!;
    expect(assist).toMatchObject({ decode: 'shown', decodeShown: 7, loggedShown: 1 });
    expect(isAssisted(assist)).toBe(true);
    expect(Object.keys(assist)).not.toContain('read');
    expect(decodeNote(assist)).toContain('入れていません');
    expect(decodeNote(decodeAssist(silent))).toContain('いつも通り');
  });

  it('follows a voiced rewrite of the last character without counting it twice', () => {
    const usage = newDecodeUsage();
    followDecoder(usage, [char(1, 'コ')]);
    followDecoder(usage, [char(1, 'ゴ')]);
    followDecoder(usage, [char(1, 'ゴ'), char(2, 'ハ')]);
    expect(usage.chars.map((item) => item.text).join('')).toBe('ゴハ');
    expect(usage.shown).toBe(2);
  });

  const evidence: QsoEvidence = {
    clean: { total: 40, correct: 40 },
    env: { qsb: { total: 10, correct: 10 } },
    overlap: { total: 3, correct: 1 },
    calls: { log: { clean: { total: 1, correct: 1 } } as never, first: {} as never },
    causes: { copy: 0, environment: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 },
    tx: { total: 4, onFrequency: 4 },
  };

  it('DECODE shown: the copy stays out of the skills and おまかせ; tuning / procedure still count', () => {
    const profile = normalizeQsoProfile(undefined);
    const learned = withoutCopy(evidence);
    const after = updateSkills(profile, { modeId: 'ragchew', alphabet: 'international', wpm: 20, evidence: learned });
    expect(after.skills.copy.international).toEqual(profile.skills.copy.international);
    expect(after.skills.robustness).toEqual(profile.skills.robustness);
    expect(after.skills.callsign).toEqual(profile.skills.callsign);
    expect(after.skills.tuning).not.toEqual(profile.skills.tuning);
    const plain = updateSkills(profile, { modeId: 'ragchew', alphabet: 'international', wpm: 20, evidence });
    expect(plain.skills.copy.international).toBeDefined();
    const state = { difficulty: { speed: 20 } as unknown as DifficultyVector, votes: { speed: 1 } };
    const moved = adjustDifficulty(state, learned).moved as Record<string, number>;
    expect(moved.speed).toBeUndefined();
    expect(adjustDifficulty(state, evidence).moved).toHaveProperty('speed');
  });

  it('DECODE shown: the answers stay, out of weak-character analysis', () => {
    const answer = { id: 'a', isCorrect: true, qso: { modeId: 'ragchew', presetId: 'p', field: 'name', condition: 'clean', cause: 'none', env: {} } } as unknown as AnswerLog;
    expect(assistedAnswers([answer], undefined)[0]).toBe(answer);
    expect(assistedAnswers([answer], { decode: 'on', decodeUsed: true, decodeSeconds: 3, decodeShown: 0, loggedShown: 0 })[0]).toBe(answer);
    expect(assistedAnswers([answer], { decode: 'shown', decodeUsed: true, decodeSeconds: 3, decodeShown: 9, loggedShown: 1 })[0].qso?.blame).toBe('decode');
  });

  it('wabun: DECODE shown never raises copy.wabun and leaves only the tuning vote', () => {
    const wabun: WabunEvidence = {
      'copy.wabun': { total: 30, correct: 30, clean: { total: 30, correct: 30 }, wpm: 13 },
      'follow.wabun': {
        total: 6, correct: 6, first: 6, paths: { first: 6, 'repeat-recovered': 0, 'not-reached': 0, missed: 0 } as never,
        conditions: { clean: { total: 6, correct: 6, first: 6 }, degraded: { total: 0, correct: 0, first: 0 } },
      },
    };
    const procedure = { overs: 3, onFrequency: 3, slips: 0 } as never;
    const profile = normalizeQsoProfile(undefined);
    const stripped = wabunWithoutCopy(wabun);
    const after = updateWabunSkills(profile, { modeId: 'wabun-ragchew', evidence: stripped, procedure });
    expect(after.skills.copy.wabun).toEqual(profile.skills.copy.wabun);
    expect(after.skills.follow?.wabun?.n ?? 0).toBe(0);
    expect(updateWabunSkills(profile, { modeId: 'wabun-ragchew', evidence: wabun, procedure }).skills.copy.wabun).toBeDefined();
    const votes = voteWabunAxes({ level: 5, evidence: stripped, procedure, fistKind: 'straight' });
    expect(Object.keys(votes)).toEqual(['tuning']);
  });

  it('dev comparison: each over against what DECODE printed', () => {
    const { result } = runDecodePreset('decode-clean');
    const traces = compareDecode(result.sent[0].tx.map((tx) => ({ tx, station: result.sent[0].id, epoch: 0 })), result.chars);
    expect(traces).toHaveLength(1);
    expect(traces[0].truth).toBe(OVER);
    expect(agreement(traces[0].truth, traces[0].decoded)).toBeGreaterThanOrEqual(0.97);
    expect(traces[0].conf).toBeGreaterThan(0.6);
    expect(traces[0].filter).toBe(500);
  });
});

describe('DECODE presets', () => {
  it('each preset names its seed / station / WPM / condition and runs', () => {
    for (const id of DECODE_PRESET_IDS) {
      const preset = DECODE_PRESETS[id];
      expect(preset.sim.seed, id).toBeGreaterThan(0);
      expect(preset.station && preset.condition && preset.listen, id).toBeTruthy();
      const { result } = runDecodePreset(id);
      expect(result.text.length, id).toBeGreaterThan(0);
    }
  });
});
