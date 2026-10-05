import type { CopyCondition, QsoCharEnv } from '../types';
import { isKeyed, type Station, type Transmission } from './band';
import type { CharSpan } from './keying';

/**
 * Per-character reception conditions. The rig samples the band every tick; each
 * character the target sends is later judged against the samples taken while it
 * was keyed, so a log error can be blamed on copy, the band, tuning or timing.
 */

export interface BandSample {
  /** Station the sample describes (the one being copied). */
  station: number;
  t: number;
  /** Clock epoch (the rig's clock restarts on power on/off). */
  epoch: number;
  /** Receiver on and not transmitting. */
  listening: boolean;
  offset: number;
  filter: number;
  snr: number;
  qrm: number;
  qsb: number;
  qrn: number;
}

/** Thresholds that turn the raw numbers into a condition label. */
export const CONDITION_LIMITS = { snr: 1.2, qrm: 0.4, qsb: 0.5, qrn: 0.45, passbandSlack: 20 } as const;

/** Lower = easier to copy. A field character keeps its easiest occurrence. */
export const CONDITION_SEVERITY: Record<CopyCondition, number> = {
  clean: 0, weak: 1, qsb: 2, qrn: 3, qrm: 4, detuned: 5, muted: 6, unheard: 7,
};
export const ENV_CONDITIONS = ['weak', 'qsb', 'qrn', 'qrm'] as const;
export const isEnvCondition = (condition: CopyCondition) => (ENV_CONDITIONS as readonly string[]).includes(condition);

export interface BandSnapshot {
  t: number;
  epoch: number;
  listening: boolean;
  vfo: number;
  filter: number;
  noise: number;
  target: Station;
  stations: Station[];
  /** Strongest crash active at t (0 = none). */
  crash: number;
}

/** Reduce the band at one instant to the numbers that matter for copying `target`. */
export function sampleBand({ t, epoch, listening, vfo, filter, noise, target, stations, crash }: BandSnapshot): BandSample {
  const level = target.strength * target.fade;
  const half = filter / 2 + CONDITION_LIMITS.passbandSlack;
  let qrm = 0;
  for (const station of stations) {
    if (station === target || Math.abs(station.rf - vfo) > half || !isKeyed(station, t)) continue;
    // Closer in tone is harder to separate by ear.
    const near = Math.abs(station.rf - target.rf) < 200 ? 1 : 0.6;
    qrm = Math.max(qrm, (station.strength * station.fade * near) / Math.max(level, 1e-3));
  }
  const floor = 0.05 + noise * Math.sqrt(filter / 500) * 0.25;
  return {
    station: target.id,
    t,
    epoch,
    listening,
    offset: target.rf - vfo,
    filter,
    snr: level / floor,
    qrm,
    qsb: 1 - target.fade,
    qrn: crash,
  };
}

/** Per station: 20 minutes at the rig's 100 ms tick. */
const MAX_SAMPLES = 12_000;

/**
 * Band samples per copied station. Every station whose copy is judged (the QSO
 * partner, each caller in a run) gets its own series, so callers overlapping one
 * another show up as QRM to each other.
 */
export class CopyMonitor {
  private series = new Map<number, BandSample[]>();

  push(sample: BandSample) {
    let list = this.series.get(sample.station);
    if (!list) this.series.set(sample.station, (list = []));
    list.push(sample);
    if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES);
  }

  reset() { this.series.clear(); }

  samplesOf(station: number): readonly BandSample[] { return this.series.get(station) ?? []; }

  /** Samples of `station` covering [start, end]; falls back to the nearest one for short characters. */
  window(station: number, epoch: number, start: number, end: number) {
    const same = this.samplesOf(station).filter((sample) => sample.epoch === epoch);
    const inside = same.filter((sample) => sample.t >= start - 0.05 && sample.t <= end + 0.05);
    if (inside.length) return inside;
    let best: BandSample | null = null;
    for (const sample of same) if (!best || Math.abs(sample.t - start) < Math.abs(best.t - start)) best = sample;
    return best && Math.abs(best.t - start) < 0.5 ? [best] : [];
  }
}

export interface CharJudgement { condition: CopyCondition; env: QsoCharEnv }

const NO_ENV: QsoCharEnv = { snr: 0, qrm: 0, qsb: 0, qrn: 0, offset: 0 };

/** Worst-case numbers over a character, then the label. */
export function judgeSamples(samples: BandSample[]): CharJudgement {
  if (!samples.length) return { condition: 'unheard', env: NO_ENV };
  const env: QsoCharEnv = {
    snr: Math.min(...samples.map((sample) => sample.snr)),
    qrm: Math.max(...samples.map((sample) => sample.qrm)),
    qsb: Math.max(...samples.map((sample) => sample.qsb)),
    qrn: Math.max(...samples.map((sample) => sample.qrn)),
    offset: Math.max(...samples.map((sample) => Math.abs(sample.offset))),
  };
  const round = (value: number) => Math.round(value * 100) / 100;
  const rounded = { snr: round(env.snr), qrm: round(env.qrm), qsb: round(env.qsb), qrn: round(env.qrn), offset: Math.round(env.offset) };
  const listening = samples.filter((sample) => sample.listening).length / samples.length;
  if (listening < 0.5) return { condition: 'muted', env: rounded };
  const outside = samples.filter((sample) => Math.abs(sample.offset) > sample.filter / 2 + CONDITION_LIMITS.passbandSlack).length;
  if (outside / samples.length >= 0.5) return { condition: 'detuned', env: rounded };
  if (env.qrm > CONDITION_LIMITS.qrm) return { condition: 'qrm', env: rounded };
  if (env.qrn > CONDITION_LIMITS.qrn) return { condition: 'qrn', env: rounded };
  if (env.qsb > CONDITION_LIMITS.qsb) return { condition: 'qsb', env: rounded };
  if (env.snr < CONDITION_LIMITS.snr) return { condition: 'weak', env: rounded };
  return { condition: 'clean', env: rounded };
}

/** A copied station's transmission as it actually went out: cut short, maybe never finished. */
export interface RxRecord { tx: Transmission; station: number; epoch: number; cutAt: number | null }

export interface ClockNow { t: number; epoch: number }

/** Judge one character of a received transmission as of `now`. */
export function judgeChar(monitor: CopyMonitor, record: RxRecord, span: CharSpan, now: ClockNow): CharJudgement {
  const cut = span.start >= (record.cutAt ?? Number.POSITIVE_INFINITY);
  const pending = record.epoch === now.epoch && span.end > now.t;
  if (cut || pending) return { condition: 'unheard', env: NO_ENV };
  return judgeSamples(monitor.window(record.station, record.epoch, span.start, span.end));
}

export const pickEasier = (a: CharJudgement | null, b: CharJudgement) =>
  !a || CONDITION_SEVERITY[b.condition] < CONDITION_SEVERITY[a.condition] ? b : a;

/** `station` broke off at `now` (all stations when omitted): anything of its still on the air was cut. */
export function markCut(records: RxRecord[], epoch: number, now: number, station?: number) {
  for (const record of records) {
    if (station !== undefined && record.station !== station) continue;
    if (record.epoch === epoch && record.tx.start + record.tx.length > now) record.cutAt = now;
  }
}
