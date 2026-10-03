import type { CardProgress } from './types';

/** Visible meter caps at 90 until CARD GET (mastered → 100). */
export const METER_CAP = 90;

export const CONFIRM_METER = { hit: 1, miss: -1 } as const;
export const RECALL_METER = { hit: 10, miss: -10 } as const;

/** Derive a starting meter for profiles that predate `progressMeter`. */
export function legacyProgressMeter(progress: CardProgress): number {
  const recallXp = progress.attempts * 10;
  const confirmXp = Math.min(20, progress.confirmCorrect ?? 0);
  return Math.min(METER_CAP, recallXp + confirmXp);
}

export function readProgressMeter(progress?: CardProgress): number {
  if (!progress) return 0;
  if (progress.mastered) return 100;
  if (typeof progress.progressMeter === 'number' && Number.isFinite(progress.progressMeter)) {
    return Math.max(0, Math.min(METER_CAP, progress.progressMeter));
  }
  return legacyProgressMeter(progress);
}

export function applyMeterDelta(progress: CardProgress, delta: number): CardProgress {
  if (progress.mastered) return progress;
  const base = typeof progress.progressMeter === 'number' && Number.isFinite(progress.progressMeter)
    ? progress.progressMeter
    : legacyProgressMeter(progress);
  return {
    ...progress,
    progressMeter: Math.max(0, Math.min(METER_CAP, base + delta)),
  };
}
