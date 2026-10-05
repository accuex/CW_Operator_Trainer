import { describe, expect, it } from 'vitest';
import type { AnswerLog } from '../types';
import { forWeakAnalysis, qsoConditionBreakdown } from '../analytics';
import { makeStation, type Transmission } from './band';
import { align, collectEvidence, fieldAnswers, scoreFields } from './attribution';
import { CopyMonitor, judgeSamples, sampleBand, type BandSample, type RxRecord } from './conditions';
import { DEFAULT_DIFFICULTY, adjustDifficulty, voteAxes, type QsoEvidence } from './difficulty';
import { BASIC_RST_NAME_QTH } from './exchange';
import { keyText } from './keying';
import { qsoMode } from './modes';
import { emptyQsoProfile, recommendStage, updateSkills } from './skills';

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const sample = (t: number, over: Partial<BandSample> = {}): BandSample => ({
  station: 1, t, epoch: 1, listening: true, offset: 0, filter: 500, snr: 4, qrm: 0, qsb: 0, qrn: 0, ...over,
});

/** A transmission at `start` with per-character spans, as the rig would record it. */
const sentAt = (text: string, start: number): Transmission => {
  const keyed = keyText(text, { wpm: 20 });
  return {
    text,
    start,
    length: keyed.length,
    marks: keyed.marks.map(([a, b]) => [start + a, start + b] as const),
    chars: keyed.chars.map((span) => ({ ...span, start: start + span.start, end: start + span.end })),
  };
};

/** Monitor filled every 50 ms over [from, to] with `pick(t)`. */
const monitorOf = (from: number, to: number, pick: (t: number) => Partial<BandSample>) => {
  const monitor = new CopyMonitor();
  for (let t = from; t <= to; t += 0.05) monitor.push(sample(t, pick(t)));
  return monitor;
};

describe('keyText character spans', () => {
  it('reports each character with its word and extent', () => {
    const { chars, length } = keyText('UR 599', { wpm: 20 });
    expect(chars.map((span) => span.char).join('')).toBe('UR599');
    expect(chars.map((span) => span.word)).toEqual([0, 0, 1, 1, 1]);
    expect(chars[2].index).toBe(0);
    expect(chars[4].end).toBeCloseTo(length, 6);
    chars.slice(1).forEach((span, i) => expect(span.start).toBeGreaterThan(chars[i].end));
  });
});

describe('reception conditions', () => {
  it('labels the worst thing on the air during a character', () => {
    expect(judgeSamples([sample(0)]).condition).toBe('clean');
    expect(judgeSamples([sample(0), sample(0.1, { qrm: 0.9 })]).condition).toBe('qrm');
    expect(judgeSamples([sample(0, { qsb: 0.7 })]).condition).toBe('qsb');
    expect(judgeSamples([sample(0, { qrn: 0.8 })]).condition).toBe('qrn');
    expect(judgeSamples([sample(0, { snr: 0.5 })]).condition).toBe('weak');
    expect(judgeSamples([sample(0, { offset: 600 })]).condition).toBe('detuned');
    expect(judgeSamples([sample(0, { listening: false })]).condition).toBe('muted');
    expect(judgeSamples([]).condition).toBe('unheard');
  });

  it('only counts other stations inside the passband as QRM', () => {
    const random = seeded(1);
    const target = makeStation(random, { role: 'target', rf: 7_012_000, strength: 0.5, fade: 1 });
    const near = makeStation(random, { rf: 7_012_100, strength: 0.5, fade: 1 });
    const far = makeStation(random, { rf: 7_013_500, strength: 1, fade: 1 });
    near.marks = [[0, 1]];
    far.marks = [[0, 1]];
    const base = { t: 0.5, epoch: 1, listening: true, vfo: 7_012_000, noise: 0.3, target, crash: 0 };
    expect(sampleBand({ ...base, filter: 500, stations: [target, far] }).qrm).toBe(0);
    expect(sampleBand({ ...base, filter: 500, stations: [target, near] }).qrm).toBeGreaterThan(0.4);
    // 100 Hz away is still inside even a 250 Hz filter (±125 Hz + slack).
    expect(sampleBand({ ...base, filter: 250, stations: [target, near] }).qrm).toBeGreaterThan(0.4);
  });
});

describe('log attribution', () => {
  const truth = { call: 'JH3ABC', rst: '579', name: 'KEN', qth: 'OSAKA' };
  const report = 'JA1ZZZ DE JH3ABC = UR RST 579 579 = NAME KEN KEN = QTH OSAKA OSAKA K';
  const now = { t: 100, epoch: 1 };

  it('aligns with substitutions, deletions and insertions', () => {
    expect(align('KEN', 'KEN').every((cell) => cell.op === 'match')).toBe(true);
    expect(align('OSAKA', 'OSKA').map((cell) => cell.op)).toEqual(['match', 'match', 'del', 'match', 'match']);
    expect(align('KEN', 'KIN')[1]).toEqual({ op: 'sub', expected: 'E', input: 'I' });
    expect(align('579', '5799').filter((cell) => cell.op === 'ins')).toHaveLength(1);
  });

  it('blames copy on a clean band and the band under QRM', () => {
    const tx = sentAt(report, 10);
    const records: RxRecord[] = [{ tx, station: 1, epoch: 1, cutAt: null }];
    const clean = monitorOf(9, 80, () => ({}));
    const fields = scoreFields(BASIC_RST_NAME_QTH, truth, { ...truth, name: 'KIN' }, records, clean, now);
    const name = fields.find((field) => field.key === 'name')!;
    expect(name.correct).toBe(false);
    expect(name.cells[1]).toMatchObject({ op: 'sub', condition: 'clean', cause: 'copy' });

    const noisy = monitorOf(9, 80, () => ({ qrm: 0.9 }));
    const underQrm = scoreFields(BASIC_RST_NAME_QTH, truth, { ...truth, name: 'KIN' }, records, noisy, now);
    expect(underQrm.find((field) => field.key === 'name')!.cells[1]).toMatchObject({ condition: 'qrm', cause: 'environment' });
  });

  it('uses the easiest repeat of each character', () => {
    const tx = sentAt(report, 10);
    const first = tx.chars.find((span) => span.char === 'K' && tx.text.split(' ')[span.word] === 'KEN')!;
    // QRM only during the first "KEN"; the second one is clean.
    const monitor = monitorOf(9, 80, (t) => (t >= first.start - 0.05 && t <= first.end + 0.3 ? { qrm: 0.9 } : {}));
    const [, , name] = scoreFields(BASIC_RST_NAME_QTH, truth, { ...truth, name: 'XEN' }, [{ tx, station: 1, epoch: 1, cutAt: null }], monitor, now);
    expect(name.cells[0]).toMatchObject({ condition: 'clean', cause: 'copy' });
  });

  it('finds a cut-number report on the air (5NN is 599)', () => {
    const tx = sentAt('R UR 5NN NAME KEN QTH OSAKA BK', 10);
    const fields = scoreFields(BASIC_RST_NAME_QTH, { ...truth, rst: '599' }, { ...truth, rst: '599' }, [{ tx, station: 1, epoch: 1, cutAt: null }], monitorOf(9, 80, () => ({})), now);
    expect(fields[1].cells.map((cell) => cell.condition)).toEqual(['clean', 'clean', 'clean']);
  });

  it('calls it tuning when off the passband and timing when never sent', () => {
    const tx = sentAt(report, 10);
    const detuned = monitorOf(9, 80, () => ({ offset: 800 }));
    const cut: RxRecord[] = [{ tx, station: 1, epoch: 1, cutAt: tx.chars.find((span) => tx.text.split(' ')[span.word] === 'QTH')!.start - 0.01 }];
    const fields = scoreFields(BASIC_RST_NAME_QTH, truth, { call: 'JH3ABX', rst: '', name: '', qth: '' }, cut, detuned, now);
    expect(fields[0].cells[5]).toMatchObject({ condition: 'detuned', cause: 'tuning' });
    // QTH comes after the cut: never on the air.
    expect(fields[3].cells.every((cell) => cell.condition === 'unheard' && cell.cause === 'timing')).toBe(true);
  });

  it('collects evidence and builds AnswerLogs that keep the environment', () => {
    const tx = sentAt(report, 10);
    const monitor = monitorOf(9, 80, () => ({ qsb: 0.8 }));
    const fields = scoreFields(BASIC_RST_NAME_QTH, truth, { ...truth, qth: 'OSAKO' }, [{ tx, station: 1, epoch: 1, cutAt: null }], monitor, now);
    const evidence = collectEvidence(fields, { total: 3, onFrequency: 2, procedure: 1 });
    expect(evidence.causes).toMatchObject({ environment: 1, tuning: 1, procedure: 1, copy: 0 });
    expect(evidence.env.qsb).toEqual({ total: 17, correct: 16 });
    const answers = fieldAnswers(fields, { sessionId: 's1', timestamp: 1, wpm: 20, modeId: 'ragchew', presetId: BASIC_RST_NAME_QTH.id, alphabet: 'international' });
    expect(answers).toHaveLength(17);
    expect(answers.every((answer) => answer.mode === 'qso' && answer.qso?.condition === 'qsb')).toBe(true);
    expect(answers.find((answer) => !answer.isCorrect)?.qso).toMatchObject({ field: 'qth', cause: 'environment' });
  });
});

describe('weak-character analysis', () => {
  const base = { id: 'x', timestamp: 0, alphabetType: 'international', characterSpeed: 20, effectiveSpeed: 20, queueTarget: 0, actualQueueDepth: 0, stimulusTime: 0, inputTime: 0, responseLatency: 1, isEarly: false, sessionId: 's' } as const;
  const env = { snr: 1, qrm: 0, qsb: 0, qrn: 0, offset: 0 };
  const logs: AnswerLog[] = [
    { ...base, mode: 'koch', correctSymbol: 'K', inputSymbol: 'R', isCorrect: false },
    { ...base, mode: 'qso', correctSymbol: 'E', inputSymbol: 'I', isCorrect: false, qso: { modeId: 'ragchew', presetId: 'p', field: 'name', condition: 'clean', cause: 'copy', env } },
    { ...base, mode: 'qso', correctSymbol: 'S', inputSymbol: 'H', isCorrect: false, qso: { modeId: 'ragchew', presetId: 'p', field: 'qth', condition: 'qrm', cause: 'environment', env } },
  ];

  it('leaves out band-condition QSO misses unless asked, and keeps them for QSO analysis', () => {
    expect(forWeakAnalysis(logs).map((log) => log.correctSymbol)).toEqual(['K', 'E']);
    expect(forWeakAnalysis(logs, true)).toHaveLength(3);
    expect(qsoConditionBreakdown(logs)).toEqual([
      { condition: 'clean', answers: 1, accuracy: 0 },
      { condition: 'qrm', answers: 1, accuracy: 0 },
    ]);
  });
});

describe('difficulty tuner', () => {
  const evidence = (over: Partial<QsoEvidence> = {}): QsoEvidence => ({
    clean: { total: 12, correct: 12 },
    env: {},
    causes: { copy: 0, environment: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 },
    tx: { total: 3, onFrequency: 3 },
    ...over,
  });

  it('moves speed on clean copy only, the band on band errors only', () => {
    expect(voteAxes(evidence())).toMatchObject({ speed: 1, drift: 1 });
    expect(voteAxes(evidence({ clean: { total: 12, correct: 8 } })).speed).toBe(-1);
    // Clean copy fine, but QRM ruined it → ease QRM, leave speed rising.
    const qrm = voteAxes(evidence({ env: { qrm: { total: 6, correct: 2 } } }));
    expect(qrm).toMatchObject({ speed: 1, crowd: -1 });
    // Clean copy also bad → it's a copy problem, don't blame the band.
    expect(voteAxes(evidence({ clean: { total: 12, correct: 6 }, env: { qrm: { total: 6, correct: 2 } } })).crowd).toBeUndefined();
    // Too little evidence → no vote.
    expect(voteAxes(evidence({ clean: { total: 3, correct: 0 } })).speed).toBeUndefined();
    expect(voteAxes(evidence({ tx: { total: 3, onFrequency: 1 } })).drift).toBe(-1);
  });

  it('needs two agreeing QSOs, respects pins and moves at most two axes', () => {
    const state = { difficulty: DEFAULT_DIFFICULTY, votes: {} };
    const once = adjustDifficulty(state, evidence());
    expect(once.moved).toEqual({});
    const twice = adjustDifficulty(once, evidence());
    expect(twice.moved).toEqual({ speed: 1, drift: 0.1 });
    expect(twice.difficulty.speed).toBe(DEFAULT_DIFFICULTY.speed + 1);

    const pinned = adjustDifficulty(adjustDifficulty(state, evidence(), ['speed']), evidence(), ['speed']);
    expect(pinned.moved.speed).toBeUndefined();

    const busy = evidence({ env: { qrm: { total: 6, correct: 6 }, qsb: { total: 6, correct: 6 }, qrn: { total: 6, correct: 6 } } });
    const many = adjustDifficulty(adjustDifficulty(state, busy), busy);
    expect(Object.keys(many.moved)).toHaveLength(2);
    expect(many.moved.speed).toBe(1);
  });

  it('a mixed signal resets the streak instead of moving', () => {
    const state = { difficulty: DEFAULT_DIFFICULTY, votes: {} };
    const up = adjustDifficulty(state, evidence());
    const down = adjustDifficulty(up, evidence({ clean: { total: 12, correct: 6 } }));
    expect(down.moved.speed).toBeUndefined();
    expect(down.votes.speed).toBe(-1);
  });
});

describe('skills and recommended stage', () => {
  it('starts at S0, then reads clean copy and robustness', () => {
    expect(recommendStage(undefined).stage).toBe('S0');
    let profile = emptyQsoProfile();
    const good: QsoEvidence = { clean: { total: 12, correct: 12 }, env: {}, causes: { copy: 0, environment: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 }, tx: { total: 3, onFrequency: 3 } };
    for (let i = 0; i < 4; i += 1) profile = updateSkills(profile, { modeId: 'ragchew', alphabet: 'international', wpm: 18, evidence: good });
    profile.modes.ragchew = { qsos: 4, perfect: 4, lastAt: 0, difficulty: DEFAULT_DIFFICULTY, pinned: [], auto: true, votes: {} };
    expect(profile.skills.copy.international).toMatchObject({ value: 1, wpm: 18 });
    expect(recommendStage(profile).stage).toBe('S2');
    const rough: QsoEvidence = { ...good, env: { qrm: { total: 8, correct: 8 }, qsb: { total: 8, correct: 8 }, qrn: { total: 8, correct: 8 } } };
    for (let i = 0; i < 3; i += 1) profile = updateSkills(profile, { modeId: 'ragchew', alphabet: 'international', wpm: 18, evidence: rough });
    expect(recommendStage(profile).stage).toBe('S3');
  });
});

describe('mode registry', () => {
  it('pileup axes are neither shown nor retuned for the CQ run or rag-chew', () => {
    const pileupAxes = ['pile', 'stack', 'even', 'manners', 'timing'];
    for (const id of ['ragchew', 'cq-run']) expect(qsoMode(id).axes.filter((axis) => pileupAxes.includes(axis))).toEqual([]);
    // Every kind of evidence, good and bad, over and over: none of them ever moves.
    const all = { total: 20, correct: 20 };
    const none = { total: 20, correct: 0 };
    const causes = { copy: 0, environment: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 };
    let state = { difficulty: DEFAULT_DIFFICULTY, votes: {} };
    for (const bucket of [all, none, all, all, none, none]) {
      const evidence: QsoEvidence = { clean: bucket, env: { qrm: bucket, qsb: bucket, qrn: bucket, weak: bucket }, overlap: bucket, causes, tx: { total: 4, onFrequency: bucket === all ? 4 : 1 } };
      const next = adjustDifficulty(state, evidence);
      expect(Object.keys(next.moved).filter((axis) => pileupAxes.includes(axis))).toEqual([]);
      expect(Object.keys(next.votes).filter((axis) => pileupAxes.includes(axis))).toEqual([]);
      state = next;
    }
  });

  it('offers the CQ run as a run mode', () => {
    expect(qsoMode('cq-run').kind).toBe('run');
    expect(qsoMode('no-such-mode').id).toBe('ragchew');
  });

  it('offers the pileup with its own desk and no difficulty axes', () => {
    expect(qsoMode('pileup').kind).toBe('pileup');
    expect(qsoMode('pileup').axes).toEqual([]);
  });
});

describe('ragchew mode', () => {
  it('runs the exchange through the mode interface', () => {
    const mode = qsoMode('ragchew');
    if (mode.kind !== 'single') throw new Error('ragchew is a single-contact mode');
    const session = mode.createSession({ random: seeded(9), myCall: 'JA1ZZZ', vfo: 7_012_000, difficulty: DEFAULT_DIFFICULTY, preset: BASIC_RST_NAME_QTH });
    expect(session.stations[0]).toBe(session.target);
    expect(session.stations).toHaveLength(1 + DEFAULT_DIFFICULTY.crowd);
    expect(session.canLog).toBe(false);
    const truth = session.truth();
    expect(session.onTransmit('JA1ZZZ K', { offsetHz: 400 }).issue).toBe('off-frequency');
    expect(session.onTransmit('DE K', { offsetHz: 0 }).issue).toBe('missing-call');
    const call = session.onTransmit(`${truth.call} DE JA1ZZZ K`, { offsetHz: 0 });
    expect(call.reply).toContain(`NAME ${truth.name}`);
    expect(session.target.loop).toBeNull();
    expect(session.step).toBe(1);
    expect(session.canLog).toBe(true);
    session.onTransmit('R TU 599 73', { offsetHz: 0 });
    expect(session.step).toBe(2);
    // Unbuilt modes fall back to ragchew instead of throwing.
    expect(qsoMode('contest').id).toBe('ragchew');
  });
});
