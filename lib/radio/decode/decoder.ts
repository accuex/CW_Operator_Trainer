import type { Station } from '../band';
import { CONDITION_LIMITS } from '../conditions';
import { HORE, PAREN_CLOSE, PAREN_OPEN, RATA, ROMAN_CODES, voice, WABUN_CODES } from './tables';

/**
 * The rig's CW decoder (a receive aid, not the truth). Two stages:
 *
 *   1. Detector: what a tone detector at the BFO pitch would see, sample by sample
 *      (5 ms), built from the band as it is — each station's actual key-down marks
 *      (its fist, cut short, whatever went out), level × QSB fade, the IF passband,
 *      the detector's own narrow bin around the pitch (tuning), other stations in the
 *      bin (collision, with their beat), the AGC pumped by strong stations inside the
 *      passband (a wide filter lets them in), band noise (deterministic, from a hash)
 *      and QRN crashes. Nothing while we transmit.
 *   2. Timing decoder: an adaptive threshold on that envelope, a glitch / dropout
 *      filter, a dot length estimate from the recent marks (AUTO) or a fixed one
 *      (LOCK), then dot / dash, character and word gaps, and the code table — Latin or
 *      wabun, switched by the ホレ / ラタ it actually decoded (AUTO).
 *
 * The text the station meant is never read: the decoder sees marks and levels only, so
 * what it prints is what came through. Confidence comes from the signal margin and how
 * well the timing fits; a doubtful character prints as '?'. Pure and deterministic.
 */

export type DecodeLang = 'auto' | 'roman' | 'wabun';
export type DecodeSpeed = 'auto' | 'lock';
export const DECODE_REASONS = ['muted', 'collision', 'qrm', 'qrn', 'off-frequency', 'qsb', 'weak', 'fist-timing', 'speed-estimate'] as const;
export type DecodeReason = (typeof DECODE_REASONS)[number];
export type DecodeScript = 'roman' | 'wabun' | 'control';
export type DecodeMark = 'ok' | 'unsure' | 'unknown' | 'space';

/** What the band did to a character while it was keyed (for the dev trace and the reasons). */
export interface DecodeEnv {
  /** Strongest station's level over the noise floor, in the detector bin (worst sample). */
  snr: number;
  /** Its offset from the VFO, Hz. */
  offset: number;
  /** Its QSB fade (lowest). */
  fade: number;
  /** Another station's level in the passband over the followed one (highest). */
  other: number;
  /** That station was inside the detector bin (a collision, not QRM). */
  inBin: boolean;
  /** How far strong stations pulled the AGC down (1 = not at all). */
  pump: number;
  /** QRN crash over the followed signal (highest). */
  crash: number;
  /** Timing fit of the character, 0–1. */
  fit: number;
  /** IF filter width when it printed. */
  filter: number;
}

export interface DecodedChar {
  /** Running number (a voiced mark rewrites the character it joins, keeping its number). */
  seq: number;
  /** What the window shows: a character, '?', a switch ([ホレ] …) or ' '. */
  text: string;
  /** Dots and dashes as detected ('' for a space). */
  code: string;
  start: number;
  end: number;
  epoch: number;
  conf: number;
  mark: DecodeMark;
  script: DecodeScript;
  /** The station the detector was following (most samples), null for a space. */
  source: number | null;
  /** Speed estimate when it printed. */
  wpm: number;
  env: DecodeEnv | null;
  /** Why a character is doubtful (empty when ok). */
  reasons: DecodeReason[];
}

/** The receiver at an instant, physical only (no message text). */
export interface DecodeBand {
  stations: readonly Station[];
  vfo: number;
  filter: number;
  noise: number;
  epoch: number;
  crashAt: (t: number) => number;
  /** We are keying (the receiver is muted). */
  muted: (t: number) => boolean;
}

export interface DecoderOptions {
  lang?: DecodeLang;
  speed?: DecodeSpeed;
  /** WPM to start from (AUTO) or to hold (LOCK). */
  wpm?: number;
  seed?: number;
  /** Characters kept (oldest drop). */
  keep?: number;
}

export const DT = 0.005;
const NOISE_BUCKET = 0.01;
/** Detector bin: flat ±BIN_FLAT Hz around the pitch, then a gaussian skirt. */
const BIN_FLAT = 45;
const BIN_SKIRT = 50;
/** Above this the AGC pulls the gain down (the rig's compressor threshold, as a level). */
const AGC_REF = 0.3;
const AGC_RELEASE = 0.25;
const NOISE_SIGMA = 0.5;
const DEBOUNCE = 3;
const MIN_WPM = 5;
const MAX_WPM = 50;
const RECENT = 20;
const SQUELCH = 2.5;

export const binGain = (offset: number) => {
  const away = Math.abs(offset) - BIN_FLAT;
  return away <= 0 ? 1 : Math.exp(-((away / BIN_SKIRT) ** 2));
};
export const inPassband = (offset: number, filter: number) => Math.abs(offset) <= filter / 2 + CONDITION_LIMITS.passbandSlack;
/** The noise floor sampleBand uses (a wide filter lets in more). */
export const noiseFloor = (noise: number, filter: number) => 0.05 + noise * Math.sqrt(filter / 500) * 0.25;
const unitOf = (wpm: number) => 1.2 / wpm;
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/** Integer hash → [0, 1). */
function hash01(seed: number, index: number, salt: number) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index | 0, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) + 0.5) / 4294967296;
}

interface Element { start: number; end: number; glitches: number }
interface CharAcc {
  samples: number;
  /** Sum over key-down samples of the level over the noise. */
  margin: number;
  sources: Map<number, number>;
  snr: number; offset: number; fade: number; other: number; inBin: boolean; pump: number; crash: number;
  /** A QRN crash while keyed down, station or not (broadband: a blanker would see it). */
  impulse: boolean;
}
const newAcc = (): CharAcc => ({ samples: 0, margin: 0, sources: new Map(), snr: Infinity, offset: 0, fade: 1, other: 0, inBin: false, pump: 1, crash: 0, impulse: false });

export interface DecoderStats {
  /** Detector samples computed. */
  samples: number;
  /** Station-samples evaluated (the real cost). */
  stationSamples: number;
  /** Characters printed. */
  printed: number;
  /** Samples skipped while we keyed. */
  muted: number;
}

export class CwDecoder {
  lang: DecodeLang;
  speed: DecodeSpeed;
  readonly seed: number;
  readonly keep: number;
  /** Every printed character, oldest first (bounded). */
  chars: DecodedChar[] = [];
  /** Bumped whenever `chars` changes (a voiced mark rewrites the previous kana). */
  version = 0;
  stats: DecoderStats = { samples: 0, stationSamples: 0, printed: 0, muted: 0 };

  private t: number | null = null;
  private epoch = -1;
  private unit: number;
  /** Where AUTO starts estimating (a new session starts here again). */
  private readonly startUnit: number;
  private script: 'roman' | 'wabun' | 'paren' = 'roman';
  // Detector state.
  private agc = 0;
  /** Noise before the AGC (the AGC moves it with the signal, so it doesn't lag). */
  private noiseRaw = 0;
  private noiseLevel = 0;
  private gain = 1;
  private markLevel = 0;
  private key = false;
  private pendingState = false;
  private pendingCount = 0;
  private edge = 0;
  // Timing decoder state.
  private mark: Element | null = null;
  private elements: Element[] = [];
  private gaps: number[] = [];
  /** The gap before this character when it follows one in the same word (spacing). */
  private lead: number | null = null;
  private lastEnd = -Infinity;
  private spaced = true;
  private glitches = 0;
  private recent: number[] = [];
  private acc: CharAcc = newAcc();
  private wasMuted = false;
  private seq = 0;
  private filter = 500;

  constructor({ lang = 'auto', speed = 'auto', wpm = 15, seed = 1, keep = 600 }: DecoderOptions = {}) {
    this.lang = lang;
    this.speed = speed;
    this.seed = seed >>> 0;
    this.keep = keep;
    this.unit = unitOf(clamp(wpm, MIN_WPM, MAX_WPM));
    this.startUnit = this.unit;
  }

  get wpm() { return Math.round((1.2 / this.unit) * 10) / 10; }

  /** Hold the current estimate (or a given speed); AUTO estimates again from here. */
  setSpeed(speed: DecodeSpeed, wpm?: number) {
    this.speed = speed;
    if (wpm) this.unit = unitOf(clamp(wpm, MIN_WPM, MAX_WPM));
  }

  setLang(lang: DecodeLang) {
    this.lang = lang;
    this.script = lang === 'wabun' ? 'wabun' : 'roman';
  }

  /**
   * Forget the signal (power cycle, new session); the printed text stays unless `clear`.
   * `clear` is a new session: AUTO forgets the last station's speed too (LOCK is the
   * operator's setting and stays).
   */
  reset(clear = false) {
    this.t = null;
    this.agc = 0;
    this.noiseRaw = 0;
    this.noiseLevel = 0;
    this.markLevel = 0;
    this.key = false;
    this.pendingCount = 0;
    this.dropChar();
    this.lastEnd = -Infinity;
    this.spaced = true;
    this.script = this.lang === 'wabun' ? 'wabun' : 'roman';
    if (clear) {
      this.chars = [];
      this.recent = [];
      if (this.speed === 'auto') this.unit = this.startUnit;
      this.version += 1;
    } else {
      // The signal was lost (power cycle): what comes next is a new word.
      this.space(0, 0);
    }
  }

  /** Run the detector and the decoder up to `until` (engine clock). */
  process(until: number, band: DecodeBand) {
    if (band.epoch !== this.epoch) {
      this.reset();
      this.epoch = band.epoch;
    }
    if (this.t === null || until - this.t > 2) this.t = until - DT;
    const from = this.t;
    if (until <= from) return;
    const floor = noiseFloor(band.noise, band.filter);
    this.filter = band.filter;
    // Per station, once per call: where it sits, how loud, its marks in the window.
    const live = [] as { station: Station; offset: number; level: number; bin: number; marks: (readonly [number, number])[]; cursor: number }[];
    for (const station of band.stations) {
      const offset = station.rf - band.vfo;
      if (!inPassband(offset, band.filter)) continue;
      const marks = station.marks.filter(([start, end]) => end >= from && start <= until);
      if (!marks.length) continue;
      live.push({ station, offset, level: station.strength * station.fade, bin: binGain(offset), marks, cursor: 0 });
    }
    for (let t = from + DT; t <= until + 1e-9; t += DT) {
      this.stats.samples += 1;
      if (band.muted(t)) {
        this.stats.muted += 1;
        if (!this.wasMuted) {
          // Our TX cuts in: the half-heard character goes, and what follows is a new word.
          this.dropChar();
          if (!this.spaced) {
            this.spaced = true;
            this.space(this.lastEnd, t);
          }
        }
        this.wasMuted = true;
        this.key = false;
        this.pendingCount = 0;
        continue;
      }
      if (this.wasMuted) {
        this.wasMuted = false;
        this.lastEnd = -Infinity;
        this.spaced = true;
      }
      // Detector: phasors at the pitch; each station turns at its offset (beats).
      let re = 0;
      let im = 0;
      let agcIn = 0;
      let first = 0;
      let firstOf: (typeof live)[number] | null = null;
      let second = 0;
      let secondInBin = false;
      for (const item of live) {
        this.stats.stationSamples += 1;
        while (item.cursor < item.marks.length && item.marks[item.cursor][1] < t) item.cursor += 1;
        const mark = item.marks[item.cursor];
        if (!mark || t < mark[0]) continue;
        agcIn = Math.max(agcIn, item.level);
        const amp = item.level * item.bin;
        const phase = 2 * Math.PI * ((item.offset * t) % 1);
        re += amp * Math.cos(phase);
        im += amp * Math.sin(phase);
        if (amp > first) {
          if (firstOf) { second = first; secondInBin = Math.abs(firstOf.offset) <= BIN_FLAT + BIN_SKIRT / 2; }
          first = amp;
          firstOf = item;
        } else if (amp > second) {
          second = amp;
          secondInBin = Math.abs(item.offset) <= BIN_FLAT + BIN_SKIRT / 2;
        }
      }
      const bucket = Math.floor(t / NOISE_BUCKET);
      const r = NOISE_SIGMA * floor * Math.sqrt(-2 * Math.log(hash01(this.seed, bucket, 1)));
      const theta = 2 * Math.PI * hash01(this.seed, bucket, 2);
      re += r * Math.cos(theta);
      im += r * Math.sin(theta);
      const crash = band.crashAt(t);
      if (crash > 0) {
        const c = crash * 0.6 * Math.sqrt(-2 * Math.log(hash01(this.seed, bucket, 3)));
        const phi = 2 * Math.PI * hash01(this.seed, bucket, 4);
        re += c * Math.cos(phi);
        im += c * Math.sin(phi);
        agcIn = Math.max(agcIn, crash * 0.6);
      }
      this.agc = Math.max(agcIn, this.agc * Math.exp(-DT / AGC_RELEASE));
      const gain = 1 / Math.max(this.agc, AGC_REF);
      this.gain = gain;
      const x = Math.hypot(re, im);
      const y = x * gain;

      // Threshold: noise level from key-up samples, mark level from key-down ones.
      if (this.noiseRaw === 0) this.noiseRaw = x || 1e-6;
      this.noiseLevel = this.noiseRaw * gain;
      if (this.markLevel === 0) this.markLevel = this.noiseLevel * 3;
      const on = Math.max(this.noiseLevel * 2.2, this.noiseLevel + 0.5 * (this.markLevel - this.noiseLevel));
      const off = Math.max(this.noiseLevel * 1.8, this.noiseLevel + 0.35 * (this.markLevel - this.noiseLevel));
      const wants = this.key ? y > off : y > on;
      // Levels from samples that agree with the key (not the debounce in between).
      if (this.key && wants) this.markLevel += (y - this.markLevel) * (DT / 0.3);
      else if (!this.key && !wants) {
        this.noiseRaw += (x - this.noiseRaw) * (DT / 0.4);
        // A station gone: the mark level sinks below the squelch so noise prints nothing and a weaker one can key.
        this.markLevel += (this.noiseLevel * 2 - this.markLevel) * (DT / 1.5);
      }
      if (wants !== this.key) {
        if (wants === this.pendingState) this.pendingCount += 1;
        else { this.pendingState = wants; this.pendingCount = 1; }
        if (this.pendingCount >= DEBOUNCE) {
          this.key = wants;
          this.pendingCount = 0;
          // The edge happened when the change began.
          this.edge = t - (DEBOUNCE - 1) * DT;
          if (wants) this.keyDown(this.edge);
          else this.keyUp(this.edge);
        }
      } else this.pendingCount = 0;

      if (this.key) {
        this.acc.samples += 1;
        this.acc.margin += y / Math.max(this.noiseLevel, 1e-9);
        if (crash > 0) this.acc.impulse = true;
      }
      if (this.key && firstOf) {
        const acc = this.acc;
        acc.sources.set(firstOf.station.id, (acc.sources.get(firstOf.station.id) ?? 0) + 1);
        acc.snr = Math.min(acc.snr, first / floor);
        acc.offset = Math.abs(firstOf.offset) > Math.abs(acc.offset) ? firstOf.offset : acc.offset;
        acc.fade = Math.min(acc.fade, firstOf.station.fade);
        const ratio = second / Math.max(first, 1e-6);
        if (ratio > acc.other) { acc.other = ratio; acc.inBin = secondInBin; }
        acc.pump = Math.max(acc.pump, this.agc / Math.max(firstOf.level, AGC_REF));
        acc.crash = Math.max(acc.crash, crash / Math.max(first, 1e-6));
      }
      if (!this.key) this.idle(t, live);
    }
    this.t = until;
  }

  private keyDown(t: number) {
    const bridge = Math.max(0.01, 0.3 * this.unit);
    if (this.mark && t - this.mark.end < bridge) {
      // A dropout inside an element: one element.
      this.mark.end = Number.POSITIVE_INFINITY;
      this.mark.glitches += 1;
      return;
    }
    if (this.mark) this.commit();
    if (this.elements.length) this.gaps.push(t - this.lastEnd);
    else if (t - this.lastEnd < 5 * this.unit) this.lead = t - this.lastEnd;
    this.mark = { start: t, end: Number.POSITIVE_INFINITY, glitches: 0 };
  }

  private keyUp(t: number) {
    if (this.mark) this.mark.end = t;
  }

  /** Key up: settle the element, then the character, then the word space. */
  private idle(t: number, live: { station: Station }[]) {
    const bridge = Math.max(0.01, 0.3 * this.unit);
    if (this.mark && this.mark.end !== Number.POSITIVE_INFINITY && t - this.mark.end >= bridge) this.commit();
    if (this.mark) return;
    const off = t - this.lastEnd;
    if (this.elements.length && off >= 2 * this.unit) this.print(live);
    if (!this.spaced && !this.elements.length && off >= 5 * this.unit) {
      this.spaced = true;
      this.space(this.lastEnd, t);
    }
  }

  private commit() {
    const mark = this.mark!;
    this.mark = null;
    const length = mark.end - mark.start;
    if (length < Math.max(0.012, 0.3 * this.unit)) {
      // A noise spike, not an element.
      this.glitches += 1;
      if (this.elements.length) this.gaps.pop();
      return;
    }
    this.elements.push(mark);
    this.glitches += mark.glitches;
    this.lastEnd = mark.end;
    this.spaced = false;
  }

  /**
   * Dot length from the recent marks: two clusters (dots / dashes) when they split like
   * dots and dashes do, else the nearer of the two. A step moves it at most 8 %, so one
   * broken element can't throw it (a new speed takes a few characters).
   */
  private learn(length: number) {
    this.recent.push(length);
    if (this.recent.length > RECENT) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
    let target = length < 2 * this.unit ? length : length / 3;
    let best = 0;
    for (let index = 2; index < sorted.length - 1; index += 1) {
      const dot = mean(sorted.slice(0, index));
      const dash = mean(sorted.slice(index));
      const ratio = dash / dot;
      const step = sorted[index] / sorted[index - 1];
      if (ratio >= 2 && ratio <= 5 && step > 1.5 && step > best) {
        best = step;
        target = (dot + dash / 3) / 2;
      }
    }
    const next = clamp(target, this.unit * 0.92, this.unit * 1.08);
    this.unit = clamp(next, unitOf(MAX_WPM), unitOf(MIN_WPM));
  }

  private dropChar() {
    this.mark = null;
    this.elements = [];
    this.gaps = [];
    this.lead = null;
    this.glitches = 0;
    this.acc = newAcc();
  }

  private print(live: { station: Station }[]) {
    const elements = this.elements;
    const gaps = this.gaps;
    const glitches = this.glitches;
    const acc = this.acc;
    const lead = this.lead;
    this.dropChar();
    // Signal margin: the key-down samples over the noise level at the time.
    const signal = clamp((acc.margin / Math.max(acc.samples, 1) - SQUELCH) / 4);
    // Speed from characters that stood above the noise (noise keying would drag it anywhere).
    // Noise keys a lone dot or dash now and then, and a QRN crash (broadband, what a blanker
    // would see) keys anything: those teach nothing.
    if (this.speed === 'auto' && signal > 0 && elements.length >= 2 && !acc.impulse) for (const element of elements) this.learn(element.end - element.start);
    const unit = this.unit;
    const code = elements.map((element) => (element.end - element.start < 2 * unit ? '.' : '-')).join('');
    // Timing fit: each element and gap against the book at the estimated speed.
    let worst = 0;
    for (const element of elements) {
      const length = (element.end - element.start) / unit;
      worst = Math.max(worst, length < 2 ? Math.abs(length - 1) : Math.abs(length / 3 - 1));
    }
    for (const gap of gaps) worst = Math.max(worst, Math.abs(gap / unit - 1) * 0.7);
    // Spacing: the gap before it against the book's three dots (half weight, a hand spaces freely).
    if (lead !== null) worst = Math.max(worst, Math.abs(lead / (3 * unit) - 1) * 0.5);
    const fit = 1 - clamp((worst - 0.12) / 0.3);
    // Squelch: noise alone keys now and then; nothing worth printing.
    if (signal <= 0 && elements.length <= 3) return;
    const conf = Math.round(clamp(Math.min(signal, fit) - 0.2 * glitches) * 100) / 100;

    let text: string | undefined;
    let script: DecodeScript = this.script === 'wabun' ? 'wabun' : 'roman';
    const auto = this.lang === 'auto';
    // A switch only on a switch it is sure of: a doubtful one stays '?' and the script stays.
    const sure = conf >= 0.25;
    if (sure && code === HORE && this.lang !== 'roman') {
      text = '[ホレ]';
      script = 'control';
      if (auto) this.script = 'wabun';
    } else if (sure && code === RATA && this.lang !== 'roman' && this.script !== 'roman') {
      text = '[ラタ]';
      script = 'control';
      if (auto) this.script = 'roman';
    } else if (sure && code === PAREN_OPEN && auto && this.script === 'wabun') {
      text = '（';
      script = 'control';
      this.script = 'paren';
    } else if (sure && code === PAREN_CLOSE && auto && this.script === 'paren') {
      text = '）';
      script = 'control';
      this.script = 'wabun';
    } else {
      text = (this.script === 'wabun' ? WABUN_CODES : ROMAN_CODES).get(code);
    }
    const sources = [...acc.sources.entries()].sort((a, b) => b[1] - a[1]);
    const source = sources[0]?.[0] ?? null;
    const env: DecodeEnv = {
      snr: Math.round((Number.isFinite(acc.snr) ? acc.snr : 0) * 100) / 100,
      offset: Math.round(acc.offset),
      fade: Math.round(acc.fade * 100) / 100,
      other: Math.round(acc.other * 100) / 100,
      inBin: acc.inBin,
      pump: Math.round(acc.pump * 100) / 100,
      crash: Math.round(acc.crash * 100) / 100,
      fit: Math.round(fit * 100) / 100,
      filter: this.filter,
    };
    const unknown = text === undefined || conf < 0.25;
    const mark: DecodeMark = unknown ? 'unknown' : conf < 0.6 ? 'unsure' : 'ok';
    const sourceStation = live.find((item) => item.station.id === source)?.station;
    const reasons = mark === 'ok' ? [] : reasonsOf(env, sourceStation ? Math.abs(1.2 / unit - sourceStation.wpm) / sourceStation.wpm : 0);
    const start = elements[0].start;
    const end = elements.at(-1)!.end;
    // A voiced mark joins the kana before it (カ ゛ → ガ).
    if (!unknown && (text === '゛' || text === '゜')) {
      const previous = this.chars.at(-1);
      const voiced = previous && previous.script === 'wabun' && previous.mark !== 'unknown' ? voice(previous.text, text) : null;
      if (previous && voiced) {
        this.chars[this.chars.length - 1] = {
          ...previous, text: voiced, code: `${previous.code} ${code}`, end, conf: Math.min(previous.conf, conf),
          mark: previous.mark === 'ok' && mark === 'ok' ? 'ok' : 'unsure',
          reasons: [...new Set([...previous.reasons, ...reasons])],
        };
        this.version += 1;
        return;
      }
    }
    this.push({ seq: 0, text: unknown ? '?' : text!, code, start, end, epoch: this.epoch, conf, mark, script, source, wpm: this.wpm, env, reasons });
  }

  /** A word space — only after something printed (a squelched blip leaves none). */
  private space(start: number, end: number) {
    const last = this.chars.at(-1);
    if (!last || last.mark === 'space') return;
    this.push({ seq: 0, text: ' ', code: '', start, end, epoch: this.epoch, conf: 1, mark: 'space', script: 'roman', source: null, wpm: this.wpm, env: null, reasons: [] });
  }

  private push(char: DecodedChar) {
    this.seq += 1;
    char.seq = this.seq;
    this.chars.push(char);
    if (this.chars.length > this.keep) this.chars.splice(0, this.chars.length - this.keep);
    this.version += 1;
    if (char.mark !== 'space') this.stats.printed += 1;
  }
}

/** Why a doubtful character was doubtful, most telling first. */
export function reasonsOf(env: DecodeEnv, speedError: number): DecodeReason[] {
  const out: DecodeReason[] = [];
  if (env.other >= 0.3 && env.inBin) out.push('collision');
  if ((env.other >= 0.3 && !env.inBin) || env.pump >= 1.5) out.push('qrm');
  if (env.crash >= 0.3) out.push('qrn');
  if (Math.abs(env.offset) > BIN_FLAT) out.push('off-frequency');
  if (env.fade < 0.6) out.push('qsb');
  if (env.snr < 3) out.push('weak');
  if (env.fit < 0.7 && env.snr >= 3) out.push('fist-timing');
  if (speedError > 0.25) out.push('speed-estimate');
  return out;
}

/** The window's text: characters joined, spaces collapsed. */
export const decodedText = (chars: readonly DecodedChar[]) => chars.map((char) => char.text).join('').replace(/ {2,}/g, ' ').trim();
