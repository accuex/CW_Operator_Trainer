import type { CopySituation, QsoCharEnv } from '../../types';
import type { CharSpan } from '../keying';
import { judgeChar, situationOf, type CharJudgement, type ClockNow, type CopyMonitor, type RxRecord } from '../conditions';
import { gaussian, type Random } from '../random';

/**
 * PileupEar: what an operator copies of one received transmission, character by
 * character, from what each character actually went through on the air. It never
 * looks at who sent it — no station, no call — only the keyed characters, how they
 * fared (the band samples), the signal's pitch and loudness. What comes out is what a
 * human would have on paper: copied letters, wrong letters, gaps ('·').
 *
 * How a character's conditions are found is an OverlapProbe: today the 100 ms band
 * samples (CopyMonitor + judgeChar); later, say, key-down interval intersection.
 *
 * Under an overlap the chance of copying a character is a logistic of the separation
 * cues — how much louder the wanted signal is than the interference (its effective QRM
 * contribution, pitch-weighted like the QRM model), how far apart in pitch and speed,
 * how many key at once. Otherwise it is the plausible-operator miss rate by condition.
 */

/** How the conditions of one received character are found. */
export interface OverlapProbe {
  judge(record: RxRecord, span: CharSpan, now: ClockNow): CharJudgement;
}

/** The band samples the rig takes every 100 ms. */
export class SampledProbe implements OverlapProbe {
  constructor(private monitor: CopyMonitor) {}
  judge(record: RxRecord, span: CharSpan, now: ClockNow) { return judgeChar(this.monitor, record, span, now); }
}

/** What the ear knows of the signal itself: where it is and how loud — never whose it is. */
export interface EarSignal { rf: number; level: number }

/** One received transmission as copied. */
export interface Heard {
  start: number;
  end: number;
  /** Its pitch off our dial, Hz (as well as the ear can tell). */
  pitch: number;
  /** Its loudness, dB (as well as the ear can tell). */
  level: number;
  /** Copied words; '·' where a character was lost. */
  words: string[];
}

export interface EarSkill {
  /** Copies everything a receiver could (never what was muted or never heard). */
  perfect?: boolean;
  /** Added to the overlap logistic: higher separates better. */
  overlapBias: number;
  /** Multiplies the plausible-operator miss rate off overlaps. */
  missScale: number;
  /** How well it tells pitch apart, Hz (1 σ). */
  pitchSigma: number;
}

export const EAR_SKILLS = {
  perfect: { perfect: true, overlapBias: 0, missScale: 0, pitchSigma: 0 },
  skilled: { overlapBias: 0.6, missScale: 0.5, pitchSigma: 5 },
  average: { overlapBias: -0.3, missScale: 1, pitchSigma: 10 },
  novice: { overlapBias: -1.5, missScale: 2, pitchSigma: 20 },
} satisfies Record<string, EarSkill>;

/** A plausible operator: rarely wrong in the clear, more so as conditions get worse. */
export const EAR_MISS: Partial<Record<CopySituation, number>> = {
  clean: 0.01, weak: 0.07, qsb: 0.06, qrn: 0.06, qrm: 0.12, overlap: 0.35, detuned: 0.3, doubled: 1, unheard: 1,
};

export const LOST = '·';

/** Effective interference over the character, dB over the wanted signal (pitch-weighted like the QRM model). */
export function interferenceDb(env: QsoCharEnv): number {
  const overlap = env.overlap;
  if (env.qrmFrom === 'caller' && env.qrm > 0) return 20 * Math.log10(Math.max(env.qrm, 1e-3));
  if (!overlap) return Number.NEGATIVE_INFINITY;
  return overlap.dB + 20 * Math.log10(overlap.dHz < 200 ? 1 : 0.6);
}

/** Chance of copying a character under an overlap from its separation cues. */
export function overlapCopyChance(env: QsoCharEnv, bias: number) {
  const overlap = env.overlap!;
  const sir = -interferenceDb(env);
  const z = 0.3 * Math.max(-20, Math.min(20, sir)) + 0.02 * Math.min(overlap.dHz, 250) + 0.08 * Math.min(Math.abs(overlap.dWpm), 10) - 1.2 * Math.log2(overlap.n) + bias;
  return 1 / (1 + Math.exp(-z));
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';

export class PileupEar {
  constructor(private probe: OverlapProbe, private skill: EarSkill, private random: Random) {}

  /** Copy `record` (on `signal`, our dial at `vfo`) as of `now`, once it has ended. */
  hear(record: RxRecord, signal: EarSignal, vfo: number, now: ClockNow): Heard {
    const { tx } = record;
    const words: string[][] = [];
    for (const span of tx.chars) {
      (words[span.word] ??= []).push(this.copy(this.probe.judge(record, span, now), span.char));
    }
    const sigma = this.skill.pitchSigma;
    return {
      start: tx.start,
      end: tx.start + tx.length,
      pitch: Math.round(signal.rf - vfo + (sigma ? gaussian(this.random) * sigma : 0)),
      level: Math.round(20 * Math.log10(Math.max(signal.level, 1e-3)) + (sigma ? gaussian(this.random) * sigma / 10 : 0)),
      words: words.filter(Boolean).map((chars) => chars.join('')),
    };
  }

  private copy({ condition, env }: CharJudgement, char: string) {
    if (condition === 'unheard' || condition === 'muted') return LOST;
    if (char.length > 1) return char; // prosigns: always recognisable as such
    const { skill, random } = this;
    if (skill.perfect) return char;
    let chance: number;
    let wrongShare: number;
    if (env.overlap) {
      chance = overlapCopyChance(env, skill.overlapBias);
      // Buried deep, a character is plainly lost; half-heard, it is misread.
      wrongShare = 0.3 * chance;
    } else {
      chance = 1 - Math.min(1, (EAR_MISS[situationOf(condition, env)] ?? 0) * skill.missScale);
      wrongShare = 0.35;
    }
    if (random() < chance) return char;
    if (random() >= wrongShare) return LOST;
    const pool = DIGITS.includes(char) ? DIGITS : LETTERS;
    return pool[(pool.indexOf(char) + 1 + Math.floor(random() * (pool.length - 1))) % pool.length];
  }
}
