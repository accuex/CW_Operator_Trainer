import { contestMode } from './contestMode';
import { cqRunMode } from './cqRunMode';
import { demoMode } from './demoMode';
import { pileupMode } from './pileupMode';
import { ragchew } from './ragchew';
import { wabunMode } from './wabunMode';
import type { ContestQsoMode, DemoQsoMode, PileupQsoMode, QsoMode, QsoSession, QsoStep, RunContext, RunQsoMode, SessionContext, SingleQsoMode, WabunQsoMode } from './types';

export type { ContestQsoMode, DemoQsoMode, PileupQsoMode, QsoMode, QsoSession, QsoStep, RunContext, RunQsoMode, SessionContext, SingleQsoMode, WabunQsoMode };

export const QSO_MODES: QsoMode[] = [
  demoMode,
  ragchew,
  cqRunMode,
  contestMode,
  pileupMode,
  wabunMode,
];

export const qsoMode = (id: string): QsoMode => QSO_MODES.find((mode) => mode.id === id && mode.available) ?? ragchew;
