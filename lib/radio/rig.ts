import { clickReach, cutStation, dirtScale, enqueue, fadeAt, schedulePending, type Station, type Transmission } from './band';
import { keyText, type Keyed, type KeyingOptions, type Mark } from './keying';

/**
 * Multi-voice receiver for the QSO simulator.
 *
 *   station osc ─ key ─ (hum) ─ amp ┐
 *   key clicks (noise ─ edge ─ level) ┤
 *   band noise ───────────────────────┼─ bus ─ BPF ─ BPF ─ AGC ─ AF ─ out
 *   QRN crashes ──────────────────────┘          └─ meter
 *
 * Audio pitch = BFO pitch + (station RF − VFO), so tuning sweeps the tone and the
 * IF filter really removes neighbours. Runs on a performance clock with no audio
 * until powerOn() so the scope is alive before the user taps.
 */

export interface Crash { t: number; dur: number; level: number }
export interface RigLevels { af: number; noise: number; qrn: number; qsb: number }
export const FILTERS = [250, 500, 2400] as const;
export type FilterWidth = (typeof FILTERS)[number];

interface Voice {
  osc: OscillatorNode;
  key: GainNode;
  amp: GainNode;
  chirp: GainNode | null;
  chirpSource: ConstantSourceNode | null;
  /** AC hum: `body` gain swings with a 100 Hz LFO scaled by `depth`. */
  hum: { lfo: OscillatorNode; depth: GainNode; body: GainNode } | null;
  /** Key clicks: band noise gated by `edge` on every key edge, scaled by `level`. */
  clicks: { source: AudioBufferSourceNode; edge: GainNode; level: GainNode } | null;
}
interface Rx {
  bus: GainNode;
  f1: BiquadFilterNode;
  f2: BiquadFilterNode;
  agc: DynamicsCompressorNode;
  af: GainNode;
  meter: AnalyserNode;
  noise: GainNode;
  noiseSource: AudioBufferSourceNode;
  noiseBuffer: AudioBuffer;
  meterData: Float32Array<ArrayBuffer>;
}

const LOOKAHEAD = 1.5;
const TICK_MS = 100;
const RAMP = 0.004;
const AUDIBLE = [40, 4000] as const;

type AudioContextCtor = typeof AudioContext;
const audioContextCtor = (): AudioContextCtor | null => {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
};

export class RigEngine {
  vfo: number;
  pitch = 600;
  filter: FilterWidth = 500;
  levels: RigLevels = { af: 0.6, noise: 0.35, qrn: 0.4, qsb: 0.5 };
  stations: Station[] = [];
  crashes: Crash[] = [];
  txUntil = 0;
  /** Start of the current (or last) run of our keying; with txUntil, when the receiver is muted. */
  txFrom = 0;
  random: () => number;
  /** Bumped whenever the clock source changes (power on/off); times from other epochs don't compare. */
  epoch = 0;
  /** A station's message was scheduled (absolute times, current epoch). */
  onTransmission: ((station: Station, tx: Transmission) => void) | null = null;
  /** Called after every scheduler tick, e.g. to sample band conditions. */
  onTick: ((now: number) => void) | null = null;

  private ctx: AudioContext | null = null;
  private rx: Rx | null = null;
  private voices = new Map<number, Voice>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Cancels an in-flight powerOn so OFF never leaves a live context. */
  private powerGen = 0;

  constructor(vfo = 7_012_000, random: () => number = Math.random) {
    this.vfo = vfo;
    this.random = random;
  }

  get powered() { return this.ctx !== null; }
  get transmitting() { return this.now() < this.txUntil; }
  now() { return this.ctx ? this.ctx.currentTime : performance.now() / 1000; }

  /** Start the scheduler (visual only until powerOn). */
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** Must run inside a user gesture (iOS). Audio starts only after resume succeeds. */
  async powerOn() {
    if (this.ctx) return;
    const Ctor = audioContextCtor();
    if (!Ctor) throw new Error('Web Audio unavailable');
    const gen = ++this.powerGen;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    // iOS: play one silent frame in the gesture so the context unlocks.
    const silent = ctx.createBufferSource();
    silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silent.connect(ctx.destination);
    silent.start();
    try { await ctx.resume(); } catch { /* resumes on next gesture */ }
    if (gen !== this.powerGen) {
      try { await ctx.close(); } catch { /* abandoned */ }
      return;
    }
    this.ctx = ctx;
    this.epoch += 1;
    this.rx = this.buildReceiver(ctx);
    this.applyFilter();
    this.applyLevels();
    for (const station of this.stations) {
      this.resetClock(station);
      this.attach(station);
    }
    this.tick();
  }

  async powerOff() {
    this.powerGen += 1;
    const ctx = this.ctx;
    const rx = this.rx;
    this.ctx = null;
    this.rx = null;
    this.txUntil = 0;
    this.txFrom = 0;
    if (!ctx) return;
    this.epoch += 1;
    this.silence(ctx, rx);
    for (const station of this.stations) this.detach(station);
    for (const station of this.stations) this.resetClock(station);
    try { await ctx.close(); } catch { /* already closed */ }
  }

  private silence(ctx: AudioContext, rx: Rx | null) {
    if (rx) {
      try { rx.noiseSource.stop(); } catch { /* already stopped */ }
      try { rx.af.gain.value = 0; } catch { /* closed */ }
      try { rx.af.disconnect(); } catch { /* closed */ }
    }
    try { void ctx.suspend(); } catch { /* closed */ }
  }

  /** Suspend audio while the tab is hidden; the scheduler restarts cleanly on resume. */
  async setBackground(hidden: boolean) {
    if (!this.ctx) return;
    try {
      if (hidden) await this.ctx.suspend();
      else await this.ctx.resume();
    } catch { /* ignore */ }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.powerOff();
  }

  setStations(next: Station[]) {
    const keep = new Set(next.map((station) => station.id));
    for (const station of this.stations) if (!keep.has(station.id)) this.detach(station);
    for (const station of next) {
      if (this.voices.has(station.id)) continue;
      this.resetClock(station);
      if (this.ctx) this.attach(station);
    }
    this.stations = next;
  }

  setVfo(hz: number) {
    this.vfo = Math.round(hz);
    this.retune();
  }

  setPitch(hz: number) {
    this.pitch = hz;
    this.applyFilter();
    this.retune();
  }

  setFilter(width: FilterWidth) {
    this.filter = width;
    this.applyFilter();
  }

  setLevels(levels: Partial<RigLevels>) {
    this.levels = { ...this.levels, ...levels };
    this.applyLevels();
  }

  /** Queue a reply from a station `delay` seconds from now. */
  send(station: Station, text: string, delay = 0.8) {
    enqueue(station, text, this.now(), delay);
    this.tick();
  }

  /** Stop a station mid-message (it heard you break in). */
  cut(station: Station) {
    const now = this.now();
    cutStation(station, now);
    const voice = this.voices.get(station.id);
    if (!voice) return;
    voice.key.gain.cancelScheduledValues(now);
    voice.key.gain.setValueAtTime(0, now);
    voice.chirp?.gain.cancelScheduledValues(now);
    if (voice.clicks) {
      voice.clicks.edge.gain.cancelScheduledValues(now);
      voice.clicks.edge.gain.setValueAtTime(0, now);
    }
  }

  /**
   * Key our own transmitter. Resolves when the last element ends. `onKeyed` gets the
   * on-air span (engine clock, current epoch) as soon as it is fixed — before the
   * first element sounds — so stations can hear our carrier while we send. `keyer`
   * replaces the Latin `keyText` (a wabun transmission keys its segments).
   */
  transmit(
    text: string, wpm: number, effectiveWpm = wpm, onKeyed?: (span: { start: number; end: number; epoch: number }) => void,
    keyer: (text: string, options: KeyingOptions) => Keyed = keyText,
  ): Promise<number> {
    const ctx = this.ctx;
    const rx = this.rx;
    if (!ctx || !rx) return Promise.resolve(0);
    const { marks, length } = keyer(text, { wpm, effectiveWpm });
    const t0 = Math.max(ctx.currentTime, this.txUntil) + 0.05;
    onKeyed?.({ start: t0, end: t0 + length, epoch: this.epoch });
    const osc = ctx.createOscillator();
    const key = ctx.createGain();
    osc.frequency.value = this.pitch;
    key.gain.value = 0;
    osc.connect(key).connect(ctx.destination);
    applyKeying(key.gain, marks, t0, 0.22);
    osc.start(t0);
    osc.stop(t0 + length + 0.05);
    // Receiver mutes while we key (no full break-in).
    rx.af.gain.setTargetAtTime(0, t0, 0.01);
    rx.af.gain.setTargetAtTime(this.levels.af, t0 + length, 0.05);
    // Back-to-back overs are one muted stretch.
    if (t0 > this.txUntil + 0.06) this.txFrom = t0;
    this.txUntil = t0 + length;
    return new Promise((resolve) => {
      setTimeout(() => resolve(length), (t0 + length - ctx.currentTime) * 1000);
    });
  }

  /** 0–1 S-meter from the post-filter signal. */
  meter() {
    const rx = this.rx;
    if (!rx) return 0;
    rx.meter.getFloatTimeDomainData(rx.meterData);
    let sum = 0;
    for (const value of rx.meterData) sum += value * value;
    const db = 10 * Math.log10(sum / rx.meterData.length + 1e-9);
    return Math.max(0, Math.min(1, (db + 60) / 52));
  }

  audioFrequency(station: Station) { return this.pitch + (station.rf - this.vfo); }

  /** Receiver on and not keying our own transmitter. */
  get listening() { return this.powered && !this.transmitting; }

  /** The receiver was muted at t (we were keying). */
  mutedAt(t: number) { return t >= this.txFrom && t < this.txUntil; }

  /** Strongest static crash active at t (0 = quiet). */
  crashAt(t: number) {
    let level = 0;
    for (const crash of this.crashes) if (t >= crash.t && t <= crash.t + crash.dur) level = Math.max(level, crash.level);
    return level;
  }

  private tick() {
    const now = this.now();
    for (const station of this.stations) {
      for (const tx of schedulePending(station, now, now + LOOKAHEAD, this.random)) {
        this.play(station, tx.marks);
        this.onTransmission?.(station, tx);
      }
      station.fade = fadeAt(station, now, this.levels.qsb);
      if (station.drift) station.rf += station.drift * (TICK_MS / 1000);
      this.updateVoice(station, 0.3);
    }
    if (this.random() < this.levels.qrn * 0.08) this.crash(0.3 + this.random() * 0.7 * this.levels.qrn);
    this.crashes = this.crashes.filter((crash) => now < crash.t + crash.dur + 0.2);
    this.onTick?.(now);
  }

  private play(station: Station, marks: Mark[]) {
    const voice = this.voices.get(station.id);
    if (!voice) return;
    applyKeying(voice.key.gain, marks, 0, 1);
    if (voice.chirp) {
      for (const [start] of marks) {
        voice.chirp.gain.setValueAtTime(-station.chirp, start);
        voice.chirp.gain.setTargetAtTime(0, start, 0.015);
      }
    }
    if (voice.clicks) {
      const edge = voice.clicks.edge.gain;
      for (const mark of marks) {
        for (const at of mark) {
          edge.setValueAtTime(1, at);
          edge.setTargetAtTime(0, at, 0.0015);
        }
      }
    }
  }

  private crash(level: number) {
    const t = this.now();
    const dur = 0.05 + this.random() * 0.25;
    this.crashes.push({ t, dur, level });
    const ctx = this.ctx;
    const rx = this.rx;
    if (!ctx || !rx) return;
    const source = ctx.createBufferSource();
    source.buffer = rx.noiseBuffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level * 1.5, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    source.connect(gain).connect(rx.bus);
    source.start(t, this.random());
    source.stop(t + dur + 0.05);
    source.onended = () => gain.disconnect();
  }

  private retune() {
    for (const station of this.stations) this.updateVoice(station, 0.02);
  }

  private updateVoice(station: Station, smoothing: number) {
    const voice = this.voices.get(station.id);
    const ctx = this.ctx;
    if (!voice || !ctx) return;
    const freq = this.audioFrequency(station);
    // Opposite sideband / far out of the passband: silent rather than mirrored.
    const audible = freq > AUDIBLE[0] && freq < AUDIBLE[1];
    const next = Math.max(AUDIBLE[0], freq);
    // Short glide so jog/VFO steps sing as a continuous pitch sweep.
    const t = ctx.currentTime;
    voice.osc.frequency.cancelScheduledValues(t);
    voice.osc.frequency.setValueAtTime(voice.osc.frequency.value, t);
    voice.osc.frequency.linearRampToValueAtTime(next, t + 0.045);
    voice.amp.gain.setTargetAtTime(audible ? station.strength * 0.5 * station.fade : 0, t, smoothing);
    const dirt = station.dirt;
    if (voice.hum && dirt) {
      const depth = dirt.hum * dirtScale(this.levels.noise) * 0.6;
      voice.hum.body.gain.setTargetAtTime(1 - depth / 2, t, smoothing);
      voice.hum.depth.gain.setTargetAtTime(depth / 2, t, smoothing);
    }
    if (voice.clicks && dirt) {
      // Splatter falls off with distance from the dial, so a clicky neighbour well outside the filter still ticks.
      const reach = clickReach(station, this.levels.noise);
      const leak = reach ? Math.exp(-Math.abs(station.rf - this.vfo) / reach) : 0;
      voice.clicks.level.gain.setTargetAtTime(dirt.clicks * station.strength * station.fade * leak * 0.9, t, smoothing);
    }
  }

  private resetClock(station: Station) {
    station.marks = [];
    station.busyUntil = 0;
    if (station.nextAt !== Number.POSITIVE_INFINITY || station.queue.length) station.nextAt = this.now() + this.random() * 3;
  }

  private attach(station: Station) {
    const ctx = this.ctx;
    const rx = this.rx;
    if (!ctx || !rx || this.voices.has(station.id)) return;
    const osc = ctx.createOscillator();
    const key = ctx.createGain();
    const amp = ctx.createGain();
    key.gain.value = 0;
    amp.gain.value = 0;
    let hum: Voice['hum'] = null;
    if (station.dirt?.hum) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      const body = ctx.createGain();
      lfo.frequency.value = 100;
      depth.gain.value = 0;
      lfo.connect(depth).connect(body.gain);
      lfo.start();
      osc.connect(key).connect(body).connect(amp);
      hum = { lfo, depth, body };
    } else {
      osc.connect(key).connect(amp);
    }
    amp.connect(rx.bus);
    let clicks: Voice['clicks'] = null;
    if (station.dirt?.clicks) {
      const source = ctx.createBufferSource();
      source.buffer = rx.noiseBuffer;
      source.loop = true;
      const edge = ctx.createGain();
      const level = ctx.createGain();
      edge.gain.value = 0;
      level.gain.value = 0;
      source.connect(edge).connect(level).connect(rx.bus);
      source.start(0, Math.random() * 2);
      clicks = { source, edge, level };
    }
    let chirp: GainNode | null = null;
    let chirpSource: ConstantSourceNode | null = null;
    if (station.chirp) {
      chirpSource = ctx.createConstantSource();
      chirp = ctx.createGain();
      chirp.gain.value = 0;
      chirpSource.connect(chirp).connect(osc.frequency);
      chirpSource.start();
    }
    osc.frequency.value = Math.max(AUDIBLE[0], this.audioFrequency(station));
    osc.start();
    this.voices.set(station.id, { osc, key, amp, chirp, chirpSource, hum, clicks });
  }

  private detach(station: Station) {
    const voice = this.voices.get(station.id);
    if (!voice) return;
    this.voices.delete(station.id);
    try {
      voice.osc.stop();
      voice.chirpSource?.stop();
      voice.hum?.lfo.stop();
      voice.clicks?.source.stop();
      voice.clicks?.level.disconnect();
      voice.amp.disconnect();
    } catch { /* torn down */ }
  }

  private buildReceiver(ctx: AudioContext): Rx {
    const bus = ctx.createGain();
    const f1 = ctx.createBiquadFilter();
    const f2 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f2.type = 'bandpass';
    const agc = ctx.createDynamicsCompressor();
    agc.threshold.value = -30;
    agc.ratio.value = 8;
    agc.attack.value = 0.003;
    agc.release.value = 0.25;
    const af = ctx.createGain();
    const meter = ctx.createAnalyser();
    meter.fftSize = 1024;
    bus.connect(f1).connect(f2).connect(agc).connect(af).connect(ctx.destination);
    f2.connect(meter);

    // Band noise: white plus a low-passed rumble, looped.
    const length = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let brown = 0;
    for (let index = 0; index < length; index += 1) {
      brown = 0.97 * brown + 0.03 * (Math.random() * 2 - 1);
      data[index] = (Math.random() * 2 - 1) * 0.6 + brown * 3;
    }
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const noise = ctx.createGain();
    source.connect(noise).connect(bus);
    source.start();
    return { bus, f1, f2, agc, af, meter, noise, noiseSource: source, noiseBuffer, meterData: new Float32Array(meter.fftSize) };
  }

  private applyFilter() {
    const ctx = this.ctx;
    const rx = this.rx;
    if (!ctx || !rx) return;
    for (const filter of [rx.f1, rx.f2]) {
      filter.frequency.setTargetAtTime(this.pitch, ctx.currentTime, 0.01);
      filter.Q.setTargetAtTime(this.pitch / this.filter, ctx.currentTime, 0.01);
    }
    // Narrow filters lose level; make up for it so switching doesn't jump in loudness.
    rx.bus.gain.setTargetAtTime(this.filter === 2400 ? 0.5 : this.filter === 500 ? 1.6 : 3, ctx.currentTime, 0.02);
  }

  private applyLevels() {
    const ctx = this.ctx;
    const rx = this.rx;
    if (!ctx || !rx) return;
    if (!this.transmitting) rx.af.gain.setTargetAtTime(this.levels.af, ctx.currentTime, 0.02);
    rx.noise.gain.setTargetAtTime(this.levels.noise * 0.25, ctx.currentTime, 0.02);
  }
}

function applyKeying(param: AudioParam, marks: Mark[], offset: number, level: number) {
  for (const [start, end] of marks) {
    param.setValueAtTime(0, offset + start);
    param.linearRampToValueAtTime(level, offset + start + RAMP);
    param.setValueAtTime(level, offset + end);
    param.linearRampToValueAtTime(0, offset + end + RAMP);
  }
}
