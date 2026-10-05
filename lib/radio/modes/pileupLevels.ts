import type { CallStyle, StationPersona } from '../air/persona';
import { mannersOf, type CallerManners } from '../agents/manners';
import type { DifficultyVector } from '../difficulty';
import type { Random } from '../random';
import type { CallerParams } from './runCore';

/**
 * Pileup levels are data: a named setting of the difficulty axes, never a lock. The
 * session reads only the axes (pile / stack / even / manners / timing and the band's
 * speed and weak), so a level is just where the sliders start.
 *
 *   pile    — callers standing by          stack  — how close in pitch they call, ±Hz
 *   even    — strength spread among them, dB (0: all alike)
 *   manners — 0 helpful (eager, call twice) … 1 chaotic (lids, tail-enders, deaf)
 *   timing  — 0 calls spread out … 1 everyone starts together
 *   similar — share of new callers whose call looks like one already calling
 */

export type PileupLevelId = 'intro' | 'beginner' | 'intermediate' | 'advanced' | 'dx';
export type PileupAxes = Pick<DifficultyVector, 'pile' | 'stack' | 'even' | 'manners' | 'timing' | 'similar' | 'speed' | 'weak'>;
export const PILEUP_AXES = ['pile', 'stack', 'even', 'manners', 'timing', 'similar', 'speed', 'weak'] as const satisfies readonly (keyof PileupAxes)[];
export interface PileupLevel { id: PileupLevelId; label: string; axes: PileupAxes }

export const PILEUP_LEVELS: readonly PileupLevel[] = [
  { id: 'intro', label: '入門', axes: { pile: 2, stack: 150, even: 10, manners: 0, timing: 0, similar: 0.12, speed: 14, weak: 0.1 } },
  { id: 'beginner', label: '初級', axes: { pile: 3, stack: 100, even: 6, manners: 0.25, timing: 0.25, similar: 0.12, speed: 16, weak: 0.15 } },
  { id: 'intermediate', label: '中級', axes: { pile: 5, stack: 60, even: 4, manners: 0.5, timing: 0.5, similar: 0.12, speed: 20, weak: 0.2 } },
  { id: 'advanced', label: '上級', axes: { pile: 10, stack: 40, even: 3, manners: 0.75, timing: 0.75, similar: 0.12, speed: 24, weak: 0.25 } },
  { id: 'dx', label: 'DX級', axes: { pile: 22, stack: 25, even: 0.5, manners: 1, timing: 1, similar: 0.12, speed: 26, weak: 0.3 } },
];

export const pileupLevel = (id: PileupLevelId) => PILEUP_LEVELS.find((level) => level.id === id)!;
export const isPileupLevel = (id: unknown): id is PileupLevelId => PILEUP_LEVELS.some((level) => level.id === id);

/** The pileup axes out of a full difficulty vector (older stored vectors lack `similar`: the levels' share). */
export const pileupAxesOf = (difficulty: Partial<Record<string, number>>, base: PileupAxes): PileupAxes =>
  Object.fromEntries(PILEUP_AXES.map((axis) => [axis, typeof difficulty[axis] === 'number' ? difficulty[axis] : base[axis]])) as PileupAxes;

/** Up to this many standing by, a pileup comes in rounds; above, it is refilled as callers go. */
export const ROUND_PILE = 3;

export interface PileupParams extends CallerParams, Omit<PileupAxes, 'speed' | 'weak'> {
  /** Rounds (true) or continuous refill. */
  rounds: boolean;
  /** Report only, or report and name both ways (gentler). */
  exchange: 'rst' | 'rst-name';
}

/** Pileup callers keep at it far longer than a CQ run's (they want this one in the log). */
const PILEUP_CROWD = { patience: 2, recall: 0.9, brief: 0 };

export function pileupParamsOf(axes: PileupAxes, exchange: PileupParams['exchange'] = 'rst'): PileupParams {
  return {
    speed: axes.speed,
    weak: axes.weak,
    spread: axes.stack,
    crowd: PILEUP_CROWD,
    tempo: 'short',
    pile: axes.pile,
    stack: axes.stack,
    even: axes.even,
    manners: axes.manners,
    timing: axes.timing,
    similar: axes.similar,
    rounds: axes.pile <= ROUND_PILE,
    exchange,
  };
}

/** Shares of each kind of caller (drawn independently) and how strongly each acts, at `manners` 0–1. */
export function mannersMix(manners: number) {
  const m = Math.min(1, Math.max(0, manners));
  return {
    eager: 0.6 - 0.4 * m,
    // 入門 is about pulling one call out of a few: an eager answer (and so a hijack) is rare
    // there, and comes in up to 初級's share by manners 0.25.
    eagerChance: m < 0.25 ? 0.1 + (0.625 - 0.1) * (m / 0.25) : 0.7 - 0.3 * m,
    lid: m < 0.4 ? 0 : 0.05 + (m - 0.5) * 0.3,
    tailEnd: m < 0.7 ? 0 : (m - 0.5) * 0.6,
    missesUs: m < 0.7 ? 0 : (m - 0.5) * 0.4,
    /** Helpful crowds send their call twice whatever their habit. */
    repeat: m < 0.3 ? 2 : null,
  };
}

const LID = { callsOnMismatch: 0.5, callsOverQso: 0.35 };
const TAIL_END = 0.8;
const MISSES_US = 0.35;

/** Seconds from our cue to calling: spread out at timing 0, all at once at 1. */
export const timingRange = (timing: number): readonly [number, number] => {
  const t = Math.min(1, Math.max(0, timing));
  return [Math.round((0.3 - 0.1 * t) * 100) / 100, Math.round((3 - 2.4 * t) * 100) / 100];
};

/** One caller's manners at this pileup's setting. */
export function pileupManners(style: CallStyle, params: Pick<PileupParams, 'manners' | 'timing'>, random: Random): CallerManners {
  const mix = mannersMix(params.manners);
  const base = mannersOf(style);
  const eager = random() < mix.eager;
  const lid = random() < mix.lid;
  const tail = random() < mix.tailEnd;
  const deaf = random() < mix.missesUs;
  return {
    ...base,
    // A lid doesn't wait for anyone.
    holdsForTraffic: base.holdsForTraffic && !lid,
    doubleListenOut: lid ? null : base.doubleListenOut,
    answersNearPartial: eager ? mix.eagerChance : 0,
    callsOnMismatch: lid ? LID.callsOnMismatch : 0,
    callsOverQso: lid ? LID.callsOverQso : 0,
    tailEnd: tail ? TAIL_END : 0,
    missesUs: deaf ? MISSES_US : 0,
    repeat: mix.repeat,
    timing: timingRange(params.timing),
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Where a pileup caller keys and how loud it is: within ±stack of us, its level spread
 * `even` dB around the pile's. Who it is stays as it is — how short it sends its call in
 * a pileup is the caller's pileup form (pileupCallText), not a different persona.
 */
export function shapePileupPersona(persona: StationPersona, params: Pick<PileupParams, 'stack' | 'even' | 'weak'>, random: Random): StationPersona {
  const offsetHz = Math.round((random() * 2 - 1) * params.stack);
  const level = (0.85 - params.weak * 0.75) * 0.75;
  const strength = clamp(level * 10 ** (((random() - 0.5) * params.even) / 20), 0.025, 1);
  return { ...persona, offsetHz, strength };
}
