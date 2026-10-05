import type { CallStyle } from '../air/persona';

/**
 * How a caller conducts itself on a run, apart from who it is (call, speed, patience).
 * Each field names one behaviour; "helpful" or "chaotic" crowds are presets made of
 * these, never fields of their own. The CQ run's callers get `mannersOf(style)`, which
 * is exactly how they have always behaved: every pileup field at its default draws no
 * random number and changes nothing.
 */
export interface CallerManners {
  /** Doesn't call while someone else is keying (it may be a QSO it missed the start of). */
  holdsForTraffic: boolean;
  /** Extra seconds it listens before calling again after a doubling, [min, max]; null: comes straight back. */
  doubleListenOut: readonly [number, number] | null;
  /** In QSO with us and our message went under its own: extra seconds before it asks again. */
  askLag: number;
  /** Times it corrects a call 1–2 letters off its own before giving up on that. */
  maxCorrections: number;
  /** Corrections used up: chance it plays along with the wrong call (else it leaves). */
  bustChance: number;
  /**
   * eager: chance it answers a partial one letter off a piece of its call ("3ABD?" for
   * JA3ABC) — and a call meant for a look-alike that is closer than it (a hijack).
   */
  answersNearPartial: number;
  /** lid: chance it calls anyway on a partial that doesn't fit it at all. */
  callsOnMismatch: number;
  /** lid: chance it calls, each time it would, while we work someone else (or after our QRX). */
  callsOverQso: number;
  /** Chance it calls straight after our TU to someone else, without waiting for QRZ? or the frequency to clear. */
  tailEnd: number;
  /** Chance it fails to copy a transmission of ours (it then goes on calling as if nothing was said). */
  missesUs: number;
  /** Times its call goes out in one call (1–3); null: as its style sends it. */
  repeat: number | null;
  /** Seconds from hearing our cue to calling, [min, max]; narrow = everyone starts together. null: its persona's reaction. */
  timing: readonly [number, number] | null;
}

export const MAX_CORRECTIONS = 2;

/** A seasoned caller holds for traffic and listens out a doubling; a novice does neither and is slower to ask. */
export function mannersOf(style: CallStyle): CallerManners {
  const novice = style === 'novice';
  return {
    holdsForTraffic: !novice,
    doubleListenOut: novice ? null : [1, 2.5],
    askLag: novice ? 2 : 0,
    maxCorrections: MAX_CORRECTIONS,
    bustChance: 0.5,
    answersNearPartial: 0,
    callsOnMismatch: 0,
    callsOverQso: 0,
    tailEnd: 0,
    missesUs: 0,
    repeat: null,
    timing: null,
  };
}

/** Answers only what is meant for it: no eager, lid, tail-end or missed-us behaviour. */
export const isDisciplined = (manners: CallerManners) =>
  manners.answersNearPartial === 0 && manners.callsOnMismatch === 0 && manners.callsOverQso === 0 && manners.tailEnd === 0 && manners.missesUs === 0;

/**
 * How a mode's transmissions read to a caller standing by. The CQ run's is how callers
 * have always read it; a pileup reads a bare AGN? as "everyone again", wakes only on
 * QRZ? (or our call with TU) and slows straight to the floor on QRS.
 */
export interface CallerProcedure {
  /** A bare AGN? / ? calls back those standing by after a partial or QRX, not only those waiting. */
  agnWakesStandby: boolean;
  /** Our TU to someone else is a cue to call even without our call or QRZ? in it. */
  closingWakes: boolean;
  /** QRS: straight down to its floor, not one step. */
  qrsToFloor: boolean;
  /** In QSO, a call near its own is for it only if nobody else on frequency has that call exactly. */
  partnerChecksPeers: boolean;
  /** Picked but not yet given a report, it hears us move on (QRZ?, CQ, a partial): it is back in the pile. */
  requeueOnCue: boolean;
}

export const CQ_PROCEDURE: CallerProcedure = { agnWakesStandby: false, closingWakes: true, qrsToFloor: false, partnerChecksPeers: false, requeueOnCue: false };
export const PILEUP_PROCEDURE: CallerProcedure = { agnWakesStandby: true, closingWakes: false, qrsToFloor: true, partnerChecksPeers: true, requeueOnCue: true };
