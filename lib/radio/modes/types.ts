import type { AlphabetType } from '../../types';
import type { Station } from '../band';
import type { Axis, DifficultyVector } from '../difficulty';
import type { ExchangePreset } from '../exchange';
import type { TxResult } from '../qso';
import type { AgentMe } from '../agents/types';
import type { Random } from '../random';
import type { ExchangeTempo, RadioPort, RunSession } from './cqRun';

/**
 * A QSO mode is an independent game (rag-chew, CQ run, contest, pile-up, wabun …),
 * not a rung on a ladder. Each one builds its own band and agents and talks its own
 * protocol; the view only knows this interface.
 */

export interface QsoStep { id: string; label: string }

export interface SessionContext {
  random: () => number;
  myCall: string;
  vfo: number;
  difficulty: DifficultyVector;
  preset: ExchangePreset;
}

export interface QsoSession {
  readonly preset: ExchangePreset;
  /** Station the user works (the one we judge copy against). */
  readonly target: Station;
  /** Every station on the band for this scenario, target included. */
  readonly stations: Station[];
  /** Index into mode.steps. */
  readonly step: number;
  readonly phase: string;
  /** Logging is allowed (exchange has been sent to us). */
  readonly canLog: boolean;
  /** Field key → what the other station actually sent. */
  truth(): Record<string, string>;
  /** Our transmission went out; the agents answer. */
  onTransmit(text: string, ctx: { offsetHz: number }): TxResult;
  /** Ready-made transmissions for the current step. */
  macros(log: Record<string, string>): [string, string][];
}

interface QsoModeBase {
  id: string;
  label: string;
  description: string;
  alphabet: AlphabetType;
  /** False = shown as 準備中. */
  available: boolean;
  presets: string[];
  /** Difficulty axes this mode uses; the panel shows only these. */
  axes: readonly Axis[];
}

/** One contact with one station per session (rag-chew). */
export interface SingleQsoMode extends QsoModeBase {
  kind: 'single';
  steps: QsoStep[];
  createSession(ctx: SessionContext): QsoSession;
}

export interface RunContext {
  random: Random;
  me: AgentMe;
  difficulty: DifficultyVector;
  /** Exchange tempo the operator chose (short if omitted). */
  tempo?: ExchangeTempo;
}

/**
 * We hold a frequency and work station after station until QRT (CQ run; later
 * pileup-run and contest-run). The session lives on the shared air; the rig feeds it
 * through `radio`.
 */
export interface RunQsoMode extends QsoModeBase {
  kind: 'run';
  createRun(ctx: RunContext, radio: RadioPort): RunSession;
}

/**
 * A pileup: everyone calls at once and we pull one call at a time out of it. It has its
 * own desk, which picks the level (no difficulty axes yet) and starts PileupSession itself.
 */
export interface PileupQsoMode extends QsoModeBase {
  kind: 'pileup';
}

/**
 * A contest: a fictional contest's exchange (report and serial) at a contest's pace. It
 * has its own desk (levels, ESM, the logger's numbers) and starts ContestRunSession itself.
 */
export interface ContestQsoMode extends QsoModeBase {
  kind: 'contest';
}

export type QsoMode = SingleQsoMode | RunQsoMode | PileupQsoMode | ContestQsoMode;
