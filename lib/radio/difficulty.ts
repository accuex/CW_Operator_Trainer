import type { CopySituation, QsoCauseCounts, QsoEnvCondition } from '../types';

/**
 * Difficulty is a vector, not a stage: each axis moves on its own evidence.
 * Copy errors move speed, errors under QRM move the QRM axis, missed tuning moves
 * drift — never "the QSO failed, so slow everything down".
 */

export const AXES = ['speed', 'crowd', 'qsb', 'qrn', 'noise', 'weak', 'drift', 'pile', 'stack', 'even', 'manners', 'timing', 'similar', 'density', 'serial'] as const;
/** The axes every mode had before pileup-run; rag-chew uses all of these. */
export const BAND_AXES = ['speed', 'crowd', 'qsb', 'qrn', 'noise', 'weak', 'drift'] as const satisfies readonly Axis[];
export type Axis = (typeof AXES)[number];
export type DifficultyVector = Record<Axis, number>;

export interface AxisSpec { label: string; min: number; max: number; step: number; unit?: string; hint: string }

export const AXIS_SPECS: Record<Axis, AxisSpec> = {
  speed: { label: '速さ', min: 8, max: 35, step: 1, unit: 'WPM', hint: '相手局と自局の符号速度' },
  crowd: { label: '混信局', min: 0, max: 12, step: 1, unit: '局', hint: '周りで運用している局の数' },
  qsb: { label: 'QSB', min: 0, max: 1, step: 0.05, hint: '信号の強さがゆっくり上下する' },
  qrn: { label: 'QRN', min: 0, max: 1, step: 0.05, hint: '雷などのバリバリという空電' },
  noise: { label: 'ノイズ', min: 0, max: 1, step: 0.05, hint: 'バンド全体のザーッという雑音' },
  weak: { label: '弱信号', min: 0, max: 1, step: 0.05, hint: '相手局の信号の弱さ' },
  drift: { label: 'ドリフト', min: 0, max: 1, step: 0.1, hint: '相手局の周波数がじわじわずれる' },
  pile: { label: '呼ぶ局数', min: 2, max: 30, step: 1, unit: '局', hint: '同時に呼んでくる局のおおよその数' },
  stack: { label: '集中度', min: 20, max: 200, step: 5, unit: 'Hz', hint: '呼ぶ局のオフセットの広がり（小さいほど同じ所に集まる）' },
  even: { label: '強弱差', min: 0, max: 12, step: 0.5, unit: 'dB', hint: '呼ぶ局どうしの強さの差（小さいほど聞き分けにくい）' },
  manners: { label: '荒れ', min: 0, max: 1, step: 0.05, hint: '0 は親切（近い断片にも返す・2 回呼ぶ）、1 は荒れ（割り込み・テールエンド・聞こえていない局）' },
  timing: { label: '一斉度', min: 0, max: 1, step: 0.05, hint: '呼び始めの揃い方（大きいほど一斉に呼ぶ）' },
  similar: { label: '似たコール', min: 0, max: 0.4, step: 0.02, hint: '呼んでくる局のうち、すでに呼んでいる局と似たコールの局の割合' },
  density: { label: '呼ぶ局の多さ', min: 0.5, max: 12, step: 0.5, unit: '局/分', hint: 'コンテストで 1 分あたりに見つけて呼んでくる局の数' },
  serial: { label: '番号の難しさ', min: 0, max: 1, step: 0.05, hint: 'コンテストのシリアル番号の取りにくさ（カット数字・大きな番号・先頭の 0 なし）' },
};

export const DEFAULT_DIFFICULTY: DifficultyVector = {
  speed: 14, crowd: 3, qsb: 0.25, qrn: 0.2, noise: 0.3, weak: 0.15, drift: 0, pile: 3, stack: 100, even: 6, manners: 0.25, timing: 0.25, similar: 0.12, density: 4, serial: 0.5,
};

export const clampAxis = (axis: Axis, value: number) => {
  const { min, max, step } = AXIS_SPECS[axis];
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
};

export function normalizeDifficulty(raw: Partial<Record<string, number>> | undefined, base = DEFAULT_DIFFICULTY): DifficultyVector {
  const out = { ...base };
  for (const axis of AXES) {
    const value = raw?.[axis];
    if (typeof value === 'number' && Number.isFinite(value)) out[axis] = clampAxis(axis, value);
  }
  return out;
}

/** Target station signal from the vector. */
export const targetStrength = (d: DifficultyVector, random: () => number) => (0.85 - d.weak * 0.75) * (0.85 + random() * 0.3);
export const targetDrift = (d: DifficultyVector, random: () => number) => (random() < 0.5 ? -1 : 1) * d.drift * 1.6;

/* ── Auto adjust ─────────────────────────────────────────────────────────── */

/** Whole calls by situation. */
export type CallTally = Partial<Record<CopySituation, { total: number; correct: number }>>;

/** What one QSO tells us about each axis. */
export interface QsoEvidence {
  /** Clean-condition characters: copy skill at this speed. */
  clean: { total: number; correct: number };
  /** Characters under each band condition. */
  env: Partial<Record<QsoEnvCondition, { total: number; correct: number }>>;
  /** Characters under another caller keying at the same time. No axis moves on these (yet). */
  overlap?: { total: number; correct: number };
  /** Characters lost to our doubling (sent while we keyed). No axis moves on these. */
  doubled?: { total: number; correct: number };
  /** Whole calls: as logged, and as we first sent them back (run modes). */
  calls?: { log: CallTally; first: CallTally };
  causes: QsoCauseCounts;
  /** Transmissions made / made on frequency. */
  tx: { total: number; onFrequency: number };
}

/** Which axis an environment condition belongs to. */
const ENV_AXIS: Record<QsoEnvCondition, Axis> = { qrm: 'crowd', qsb: 'qsb', qrn: 'qrn', weak: 'weak' };

const MIN_CLEAN = 8;
const MIN_ENV = 4;
/** Consecutive same-direction votes before an axis moves (hysteresis). */
const VOTES_TO_MOVE = 2;
/** Never retune more than this many axes after one QSO. */
const MAX_MOVES = 2;
const STEP_SIZE: Record<Axis, number> = {
  speed: 1, crowd: 1, qsb: 0.1, qrn: 0.1, noise: 0.1, weak: 0.1, drift: 0.1, pile: 1, stack: 10, even: 0.5, manners: 0.05, timing: 0.05, similar: 0.04, density: 0.5, serial: 0.1,
};
/** Axes that get harder as the number falls (a tighter stack, a smaller strength spread). */
const HARDER_DOWN: ReadonlySet<Axis> = new Set(['stack', 'even']);
/** One step on an axis from `value`: a big pile moves by more than one caller. */
const stepOf = (axis: Axis, value: number) => (axis === 'pile' ? Math.max(1, Math.round(value * 0.15)) : STEP_SIZE[axis]);

const rate = (bucket: { total: number; correct: number }) => bucket.correct / bucket.total;

/** Per-axis vote from one QSO: +1 harder, −1 easier, 0 no evidence / hold. */
export function voteAxes(e: QsoEvidence): Partial<Record<Axis, -1 | 1>> {
  const votes: Partial<Record<Axis, -1 | 1>> = {};
  const cleanOk = e.clean.total >= MIN_CLEAN ? rate(e.clean) : null;
  if (cleanOk !== null) {
    if (cleanOk >= 0.95) votes.speed = 1;
    else if (cleanOk < 0.8) votes.speed = -1;
  }
  for (const condition of Object.keys(ENV_AXIS) as QsoEnvCondition[]) {
    const bucket = e.env[condition];
    if (!bucket || bucket.total < MIN_ENV) continue;
    const axis = ENV_AXIS[condition];
    const ok = rate(bucket);
    // Only blame the band when clean copy was fine; otherwise it's a copy problem.
    if (ok < 0.6 && (cleanOk ?? 1) >= 0.85) votes[axis] = -1;
    else if (ok >= 0.9) votes[axis] = 1;
  }
  // Noise has no label of its own; ride along with weak-signal evidence.
  if (votes.weak) votes.noise = votes.weak;
  if (e.tx.total >= 2) {
    const onFrequency = e.tx.onFrequency / e.tx.total;
    if (onFrequency === 1 && e.causes.tuning === 0) votes.drift = 1;
    else if (onFrequency < 0.6 || e.causes.tuning >= 3) votes.drift = -1;
  }
  return votes;
}

export interface AdjustState { difficulty: DifficultyVector; votes: Partial<Record<Axis, number>> }
export interface AdjustResult extends AdjustState { moved: Partial<Record<Axis, number>> }

export type AxisVotes = Partial<Record<Axis, -1 | 1>>;

/**
 * Accumulate votes, then move at most MAX_MOVES unpinned axes (speed first, then easier-first).
 * A vote is +1 harder / −1 easier whichever way the axis's number goes; a mode with its
 * own evidence (pileup) hands its votes in as `fresh`.
 */
export function adjustDifficulty(state: AdjustState, evidence: QsoEvidence, pinned: readonly string[] = [], fresh: AxisVotes = voteAxes(evidence)): AdjustResult {
  const votes = { ...state.votes };
  for (const axis of AXES) {
    const vote = fresh[axis];
    if (!vote || pinned.includes(axis)) continue;
    const prior = votes[axis] ?? 0;
    votes[axis] = Math.sign(prior) === vote ? prior + vote : vote;
  }
  const ready = AXES.filter((axis) => Math.abs(votes[axis] ?? 0) >= VOTES_TO_MOVE && !pinned.includes(axis));
  // Easing off beats pushing on; speed first because it's the core skill.
  ready.sort((a, b) => (Math.sign(votes[a] ?? 0) - Math.sign(votes[b] ?? 0)) || (a === 'speed' ? -1 : b === 'speed' ? 1 : 0));
  const difficulty = { ...state.difficulty };
  const moved: Partial<Record<Axis, number>> = {};
  for (const axis of ready.slice(0, MAX_MOVES)) {
    const direction = Math.sign(votes[axis] ?? 0);
    const next = clampAxis(axis, difficulty[axis] + direction * (HARDER_DOWN.has(axis) ? -1 : 1) * stepOf(axis, difficulty[axis]));
    votes[axis] = 0;
    if (next === difficulty[axis]) continue;
    moved[axis] = Math.round((next - difficulty[axis]) * 100) / 100;
    difficulty[axis] = next;
  }
  return { difficulty, votes, moved };
}

export function describeMove(axis: Axis, delta: number) {
  const spec = AXIS_SPECS[axis];
  if (axis === 'speed' || axis === 'crowd' || axis === 'pile') return `${spec.label} ${delta > 0 ? '+' : ''}${delta} ${spec.unit}`;
  if (axis === 'stack') return `${spec.label}を${delta < 0 ? '少し高く（呼ぶ局が近くに集まる）' : '少し低く（呼ぶ局が散らばる）'}`;
  if (axis === 'similar') return `${spec.label}を${delta > 0 ? '少し多く' : '少し少なく'}`;
  if (axis === 'density') return `${spec.label} ${delta > 0 ? '+' : ''}${delta} ${spec.unit}`;
  if (axis === 'serial') return `${spec.label}を${delta > 0 ? '少し上げる（カット数字・大きな番号が増える）' : '少し下げる'}`;
  return `${spec.label}を${delta > 0 ? '少し強く' : '少し弱く'}`;
}
