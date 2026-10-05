import type { AlphabetType } from '../../types';
import type { Station } from '../band';
import type { Axis, DifficultyVector } from '../difficulty';
import type { ExchangePreset } from '../exchange';
import type { TxResult } from '../qso';

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

export interface QsoMode {
  id: string;
  label: string;
  description: string;
  alphabet: AlphabetType;
  /** False = shown as 準備中. */
  available: boolean;
  presets: string[];
  /** Difficulty axes this mode uses; the panel shows only these. */
  axes: readonly Axis[];
  steps: QsoStep[];
  createSession(ctx: SessionContext): QsoSession;
}
