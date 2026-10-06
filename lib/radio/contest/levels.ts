import type { CallerParams } from '../modes/runCore';

/**
 * Contest levels are data: where the axes start, never a lock. Several axes are the
 * pileup's (stack / even / manners / timing / similar, the band's speed and weak); the
 * contest adds its own:
 *
 *   density  — callers finding us a minute (the rate the frequency could give)
 *   serial   — 0–1: serials harder to copy (more cut numbers, bigger, no leading zeros)
 *   pressure — 0–1: callers give up and move on sooner
 *   dupes    — chance a new caller is a station we worked already
 *
 * PROVISIONAL: the numbers are a first guess. As with Pileup (Stage 2.5) they are to be
 * set by people playing it, never fitted to the simulator's bot.
 */

export type ContestLevelId = 'intro' | 'beginner' | 'intermediate' | 'advanced' | 'expert';

export interface ContestAxes {
  speed: number;
  density: number;
  stack: number;
  even: number;
  manners: number;
  timing: number;
  similar: number;
  serial: number;
  pressure: number;
  dupes: number;
  weak: number;
}

export const CONTEST_AXES = ['speed', 'density', 'stack', 'even', 'manners', 'timing', 'similar', 'serial', 'pressure', 'dupes', 'weak'] as const satisfies readonly (keyof ContestAxes)[];

export interface ContestLevel { id: ContestLevelId; label: string; axes: ContestAxes }

export const CONTEST_LEVELS: readonly ContestLevel[] = [
  { id: 'intro', label: '入門', axes: { speed: 16, density: 1.5, stack: 150, even: 10, manners: 0, timing: 0, similar: 0.05, serial: 0, pressure: 0, dupes: 0.03, weak: 0.1 } },
  { id: 'beginner', label: '初級', axes: { speed: 20, density: 2.5, stack: 120, even: 10, manners: 0.2, timing: 0.2, similar: 0.08, serial: 0.25, pressure: 0.25, dupes: 0.05, weak: 0.15 } },
  { id: 'intermediate', label: '中級', axes: { speed: 24, density: 4, stack: 90, even: 12, manners: 0.4, timing: 0.4, similar: 0.1, serial: 0.5, pressure: 0.5, dupes: 0.06, weak: 0.2 } },
  { id: 'advanced', label: '上級', axes: { speed: 28, density: 6, stack: 70, even: 14, manners: 0.6, timing: 0.6, similar: 0.12, serial: 0.75, pressure: 0.7, dupes: 0.08, weak: 0.25 } },
  { id: 'expert', label: 'エキスパート', axes: { speed: 32, density: 9, stack: 50, even: 16, manners: 0.8, timing: 0.8, similar: 0.15, serial: 1, pressure: 0.9, dupes: 0.1, weak: 0.3 } },
];

export const contestLevel = (id: ContestLevelId) => CONTEST_LEVELS.find((level) => level.id === id)!;
export const isContestLevel = (id: unknown): id is ContestLevelId => CONTEST_LEVELS.some((level) => level.id === id);

/**
 * Where a level starts once おまかせ has moved it: the stored vector's value for each axis
 * it has, the level's own for the rest (pressure and dupes are never moved, so always the level's).
 */
export const contestAxesOf = (difficulty: Partial<Record<string, number>>, base: ContestAxes): ContestAxes =>
  Object.fromEntries(CONTEST_AXES.map((axis) => [axis, typeof difficulty[axis] === 'number' ? difficulty[axis] : base[axis]])) as unknown as ContestAxes;

export interface ContestParams extends CallerParams, Omit<ContestAxes, 'speed' | 'weak'> {}

/** Contest callers want the contact but have others to work: less patient than a pileup's, less as `pressure` rises. */
export const contestCrowd = (pressure: number) => {
  const p = Math.min(1, Math.max(0, pressure));
  return { patience: Math.round((1.6 - 1.0 * p) * 100) / 100, recall: 0.85, brief: 0 };
};

export function contestParamsOf(axes: ContestAxes): ContestParams {
  return {
    speed: axes.speed,
    weak: axes.weak,
    spread: axes.stack,
    crowd: contestCrowd(axes.pressure),
    tempo: 'short',
    density: axes.density,
    stack: axes.stack,
    even: axes.even,
    manners: axes.manners,
    timing: axes.timing,
    similar: axes.similar,
    serial: axes.serial,
    pressure: axes.pressure,
    dupes: axes.dupes,
  };
}
