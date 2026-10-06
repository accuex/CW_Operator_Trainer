import type { WabunProcedure } from './procedure';
import type { WabunEvidence } from './review';
import type { WabunLevel, WabunLoad } from './scenario';

/**
 * おまかせ for the wabun QSO: its own axes, each moved by its own evidence only, slowly.
 *
 *   speed   the station's WPM            ← copy.wabun (memo, clean characters). No memo: no vote.
 *   load    how much the talk carries    ← follow.wabun, first time, facts told in the clear.
 *                                          A fact got back by asking again holds (no vote): asking
 *                                          is how a QSO is followed. Not when copy is the trouble.
 *   rf      weak / noise / QSB / QRN / crowd ← follow of facts first told through a band condition,
 *                                          only when the same QSO's clear facts were followed.
 *   tuning  how far the station wanders  ← our overs on its frequency.
 *   fist    how much of the Level 5 hand shows ← Level 5 follow, first time (a hand key only).
 *
 * Procedure (switches, KN, the station asking us back) moves nothing: a slip there is
 * not a reason to slow the station or shorten the talk. Like adjustDifficulty, a vote
 * must come twice the same way before an axis moves, at most two axes move per QSO,
 * easing off first. Kept in modes['wabun-ragchew'].wabun.
 */

export const WABUN_AXES = ['speed', 'load', 'rf', 'tuning', 'fist'] as const;
export type WabunAxis = (typeof WABUN_AXES)[number];
export interface WabunAxes { speed: number; load: WabunLoad; rf: number; tuning: number; fist: number }

export const WABUN_AXIS_SPECS: Record<WabunAxis, { label: string; min: number; max: number; step: number; unit?: string }> = {
  speed: { label: '相手の速さ', min: 8, max: 25, step: 1, unit: 'WPM' },
  load: { label: '話の量', min: 0, max: 2, step: 1 },
  rf: { label: '電波の状態', min: 0, max: 1, step: 0.25 },
  tuning: { label: '周波数のずれ', min: 0, max: 1, step: 0.25 },
  fist: { label: '手打ちのクセ（Lv5）', min: 0.4, max: 1, step: 0.2 },
};

/** Stage 4's desk: rf 0.25 is its quiet band (WABUN_RIG_LEVELS, strength 0.6, three neighbours). */
export const defaultWabunAxes = (speed = 13): WabunAxes => ({ speed, load: 1, rf: 0.25, tuning: 0, fist: 1 });

export interface WabunAdaptState { axes: WabunAxes; votes: Partial<Record<WabunAxis, number>>; /** The level the votes came from (they start over on another). */ level?: number }

const clamp = (axis: WabunAxis, value: number) => {
  const { min, max, step } = WABUN_AXIS_SPECS[axis];
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
};

export function normalizeWabunAdapt(raw: Partial<WabunAdaptState> | undefined, speed = 13): WabunAdaptState {
  const axes = defaultWabunAxes(speed);
  for (const axis of WABUN_AXES) {
    const value = raw?.axes?.[axis];
    if (typeof value === 'number' && Number.isFinite(value)) (axes as unknown as Record<WabunAxis, number>)[axis] = clamp(axis, value);
  }
  const votes: Partial<Record<WabunAxis, number>> = {};
  for (const axis of WABUN_AXES) if (typeof raw?.votes?.[axis] === 'number') votes[axis] = raw.votes[axis];
  return { axes, votes, ...(typeof raw?.level === 'number' ? { level: raw.level } : {}) };
}

/** The band an rf value gives: Stage 4's desk at 0.25, a clean strong signal at 0, a hard one at 1. */
export function wabunBand(rf: number) {
  return {
    rig: { noise: Math.round((0.1 + 0.6 * rf) * 100) / 100, qrn: Math.round(0.6 * rf * 100) / 100, qsb: Math.round(0.8 * rf * 100) / 100 },
    strength: Math.round((0.75 - 0.6 * rf) * 100) / 100,
    crowd: Math.round(1 + 8 * rf),
  };
}
/** Hz per second the station wanders at a tuning value (0: it stays put). */
export const wabunDrift = (tuning: number) => Math.round(tuning * 0.3 * 100) / 100;

const MIN_COPY = 8;
const MIN_FACTS = 3;
const MIN_DEGRADED = 2;
const VOTES_TO_MOVE = 2;
const MAX_MOVES = 2;

export type WabunVotes = Partial<Record<WabunAxis, -1 | 1>>;

/** What one QSO says about each axis (+1 harder, −1 easier, nothing: no evidence or hold). */
export function voteWabunAxes({ level, evidence, procedure, fistKind }: { level: WabunLevel; evidence: WabunEvidence; procedure: Pick<WabunProcedure, 'overs' | 'onFrequency'>; fistKind?: string | null }): WabunVotes {
  const votes: WabunVotes = {};
  const copy = evidence['copy.wabun'];
  // speed: the ear, character by character, in the clear. Only with a memo.
  const clean = copy?.clean;
  const copyRate = clean && clean.total >= MIN_COPY ? clean.correct / clean.total : null;
  if (copyRate !== null) votes.speed = copyRate >= 0.95 ? 1 : copyRate < 0.8 ? -1 : undefined;
  const follow = evidence['follow.wabun'];
  const inClear = follow.conditions?.clean ?? { total: follow.total, correct: follow.correct, first: follow.first };
  const copyTrouble = votes.speed === -1;
  // load: what the talk carries, from the first time it was told (Level 3 on; Levels 1 / 2 carry no talk).
  if (level >= 3 && inClear.total >= MIN_FACTS && !copyTrouble) {
    const first = inClear.first / inClear.total;
    const got = inClear.correct / inClear.total;
    if (first >= 0.9) votes.load = 1;
    // Missed for good (not just asked back): too much to follow.
    else if (got < 0.75) votes.load = -1;
  }
  // rf: facts that came through a band condition, against the clear ones of the same QSO.
  const rough = follow.conditions?.degraded;
  if (rough && rough.total >= MIN_DEGRADED && !copyTrouble) {
    const first = rough.first / rough.total;
    const clearOk = inClear.total ? inClear.correct / inClear.total >= 0.85 : true;
    if (first < 0.6 && clearOk) votes.rf = -1;
    else if (first >= 0.9) votes.rf = 1;
  }
  // tuning: on its frequency or not (nothing else: a procedure slip is not a tuning one).
  if (procedure.overs >= 2) {
    const share = procedure.onFrequency / procedure.overs;
    if (share === 1) votes.tuning = 1;
    else if (share < 0.6) votes.tuning = -1;
  }
  // fist: Level 5, a hand key: the same follow as load, the hand eased first when it went badly.
  if (level === 5 && fistKind && fistKind !== 'keyer' && follow.total >= MIN_FACTS && !copyTrouble) {
    const first = follow.first / follow.total;
    if (first >= 0.9) votes.fist = 1;
    else if (first < 0.6) votes.fist = -1;
  }
  for (const axis of WABUN_AXES) if (votes[axis] === undefined) delete votes[axis];
  return votes;
}

export interface WabunAdjust extends WabunAdaptState { moved: Partial<Record<WabunAxis, [number, number]>> }

/** Votes into the state; an axis moves one step after two votes the same way, two axes at most, easing first. */
export function adjustWabun(state: WabunAdaptState, fresh: WabunVotes, level: number, pinned: readonly WabunAxis[] = []): WabunAdjust {
  const votes: Partial<Record<WabunAxis, number>> = state.level === level ? { ...state.votes } : {};
  for (const axis of WABUN_AXES) {
    const vote = fresh[axis];
    if (!vote || pinned.includes(axis)) continue;
    const prior = votes[axis] ?? 0;
    votes[axis] = Math.sign(prior) === vote ? prior + vote : vote;
  }
  const ready = WABUN_AXES.filter((axis) => Math.abs(votes[axis] ?? 0) >= VOTES_TO_MOVE && !pinned.includes(axis));
  ready.sort((a, b) => Math.sign(votes[a] ?? 0) - Math.sign(votes[b] ?? 0));
  const axes = { ...state.axes };
  const moved: WabunAdjust['moved'] = {};
  for (const axis of ready.slice(0, MAX_MOVES)) {
    const from = axes[axis];
    const to = clamp(axis, from + Math.sign(votes[axis] ?? 0) * WABUN_AXIS_SPECS[axis].step);
    votes[axis] = 0;
    if (to === from) continue;
    (axes as unknown as Record<WabunAxis, number>)[axis] = to;
    moved[axis] = [from, to];
  }
  return { axes, votes, level, moved };
}

/** A move for people ("相手の速さ 13 → 14 WPM"). */
export function describeWabunMove(axis: WabunAxis, [from, to]: [number, number]) {
  const spec = WABUN_AXIS_SPECS[axis];
  const show = (value: number) => (axis === 'load' ? ['少なめ', 'ふつう', '多め'][value] : axis === 'speed' ? `${value}` : `${Math.round(value * 100)}%`);
  return `${spec.label} ${show(from)} → ${show(to)}${spec.unit ? ` ${spec.unit}` : ''}`;
}
