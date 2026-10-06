import { fadeAt, makeStation, schedulePending, type Station, type Transmission } from '../band';
import type { Crash } from '../rig';
import { seeded } from '../random';
import { fistKeyer, wabunKeyer } from '../wabun/segments';
import { makeFist } from '../wabun/fist';
import type { FistKind } from '../wabun/fist';
import { CwDecoder, decodedText, type DecodeLang, type DecodeSpeed, type DecodedChar } from './decoder';
import { DECODE_PRESETS, type DecodePreset, type DecodePresetId } from './presets';

/**
 * The decoder on a scripted band, without Web Audio: stations keyed on the rig's
 * scheduler (100 ms ticks, 1.5 s lookahead), QSB / QRN like the engine, and the
 * decoder run after every tick on what has gone out so far. For the tests, the QA
 * presets and the mass simulation. The truth (what each station keyed) is only
 * returned beside the output, to compare.
 */

const TICK = 0.1;
const LOOKAHEAD = 1.5;
export const VFO = 7_012_000;

export interface DecodeSimStation {
  call: string;
  text: string;
  /** Hz from the VFO. */
  offset: number;
  wpm: number;
  strength: number;
  /** Latin jitter (keyText) when no fist. */
  jitter?: number;
  fist?: { kind: FistKind; strength?: number; fatigue?: boolean };
  wabun?: boolean;
  /** Seconds before it starts. */
  delay?: number;
  qsbRate?: number;
  /** Repeat the text this many times. */
  repeat?: number;
}

export interface DecodeSimOptions {
  seed: number;
  stations: DecodeSimStation[];
  filter?: number;
  noise?: number;
  qsb?: number;
  qrn?: number;
  lang?: DecodeLang;
  speed?: DecodeSpeed;
  /** Decoder WPM to start from / hold. */
  decoderWpm?: number;
  /** Our own transmissions (the receiver is muted). */
  tx?: { start: number; end: number }[];
  /** Run this long (default: until every station is done + 2 s). */
  limit?: number;
  /** false: never run the decoder (DECODE OFF). */
  decode?: boolean;
}

export interface DecodeSimResult {
  decoder: CwDecoder | null;
  chars: DecodedChar[];
  text: string;
  /** Per station, what it keyed. */
  sent: { call: string; id: number; tx: Transmission[] }[];
  stations: Station[];
  /** Wall-clock milliseconds spent in the decoder. */
  ms: number;
  seconds: number;
}

/** The scripted stations on a band at `vfo`, starting from `t0` (the dev desk puts them on the real rig). */
export function simStations(random: () => number, specs: readonly DecodeSimStation[], vfo: number, t0: number): Station[] {
  return specs.map((spec) => {
    const fist = spec.fist ? makeFist(random, spec.fist.kind, { strength: spec.fist.strength, fatigue: spec.fist.fatigue }) : null;
    const queue = Array.from({ length: spec.repeat ?? 1 }, () => spec.text);
    return makeStation(random, {
      role: 'target', call: spec.call, rf: vfo + spec.offset, wpm: spec.wpm, strength: spec.strength,
      jitter: spec.jitter ?? 0, drift: 0, chirp: 0, qsbRate: spec.qsbRate ?? 0.1, qsbPhase: 0, gap: [1, 1],
      queue, nextAt: t0 + (spec.delay ?? 0.5), loop: null,
      ...(fist ? { keyer: fistKeyer(fist) } : spec.wabun ? { keyer: wabunKeyer } : {}),
    });
  });
}

export function runDecodeSim(options: DecodeSimOptions): DecodeSimResult {
  const { seed, filter = 500, noise = 0.2, qsb = 0, qrn = 0, lang = 'auto', speed = 'auto', tx = [], decode = true } = options;
  const random = seeded(seed);
  const stations = simStations(random, options.stations, VFO, 0);
  const sent = stations.map((station) => ({ call: station.call, id: station.id, tx: [] as Transmission[] }));
  const decoder = decode ? new CwDecoder({ lang, speed, wpm: options.decoderWpm ?? 15, seed }) : null;
  let crashes: Crash[] = [];
  const crashAt = (t: number) => crashes.reduce((level, crash) => (t >= crash.t && t <= crash.t + crash.dur ? Math.max(level, crash.level) : level), 0);
  const muted = (t: number) => tx.some((span) => t >= span.start && t < span.end);
  let ms = 0;
  let end = options.limit ?? Infinity;
  let t = 0;
  for (; t < end; t += TICK) {
    stations.forEach((station, index) => {
      for (const transmission of schedulePending(station, t, t + LOOKAHEAD, random)) sent[index].tx.push(transmission);
      station.fade = fadeAt(station, t, qsb);
    });
    if (random() < qrn * 0.08) crashes.push({ t, dur: 0.05 + random() * 0.25, level: 0.3 + random() * 0.7 * qrn });
    crashes = crashes.filter((crash) => t < crash.t + crash.dur + 0.2);
    if (decoder) {
      const before = performance.now();
      decoder.process(t, { stations, vfo: VFO, filter, noise, epoch: 0, crashAt, muted });
      ms += performance.now() - before;
    }
    if (options.limit === undefined && end === Infinity && stations.every((station) => station.nextAt === Number.POSITIVE_INFINITY && !station.queue.length)) {
      end = Math.max(...stations.map((station) => station.busyUntil)) + 2;
    }
    if (t > 3600) break;
  }
  const chars = decoder ? [...decoder.chars] : [];
  return { decoder, chars, text: decodedText(chars), sent, stations, ms, seconds: t };
}

/** A preset run (the same station every time from its seed). */
export function runDecodePreset(id: DecodePresetId, overrides: Partial<DecodeSimOptions> = {}) {
  const preset: DecodePreset = DECODE_PRESETS[id];
  return { preset, result: runDecodeSim({ ...preset.sim, ...overrides }) };
}

/** Per-character agreement of decoded text with what was keyed (edit distance), 0–1. */
export function agreement(truth: string, decoded: string) {
  const a = [...truth.replace(/\s+/g, ' ').trim()];
  const b = [...decoded.replace(/\s+/g, ' ').trim()];
  if (!a.length) return b.length ? 0 : 1;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return Math.max(0, 1 - prev[b.length] / a.length);
}
