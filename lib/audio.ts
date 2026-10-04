import { buildMorseTimeline, buildRepeatedSymbolTimeline } from './timing';
import type { AlphabetType, AudioSettings, MorseTimeline } from './types';

export interface PlaybackHandle {
  timeline: MorseTimeline;
  startedAt: number;
  currentTime: () => number;
  receivedCount: () => number;
  stop: () => void;
  finished: Promise<void>;
}

type ActiveVoice = {
  oscillator: OscillatorNode;
  gain: GainNode;
  extras: AudioNode[];
  resolveFinished: () => void;
  ringTimer: ReturnType<typeof setTimeout> | null;
};

/** 反響余韻を切るまでの待ち（ディレイ＋フィードバックが消えるまで） */
const REVERB_RING_MS = 280;

/** WebKit adds `interrupted` when another app takes the audio session. */
type ContextState = AudioContextState | 'interrupted';

const contextState = (context: AudioContext) => context.state as ContextState;

export class MorseAudioEngine {
  private context: AudioContext | null = null;
  private active: ActiveVoice | null = null;
  /** True while exam (etc.) intentionally froze the clock — ignore OS wake. */
  private holdSuspended = false;
  /**
   * Set when the app loses audio to the OS / another app.
   * Next unlock/play must recreate AudioContext inside a user gesture.
   */
  private needsHardUnlock = false;
  private stateListener: ((event: Event) => void) | null = null;

  private createContext() {
    const context = new AudioContext({ latencyHint: 'interactive' });
    this.bindStateListener(context);
    return context;
  }

  private bindStateListener(context: AudioContext) {
    if (this.stateListener && this.context) {
      this.context.removeEventListener('statechange', this.stateListener);
    }
    this.stateListener = () => {
      const state = contextState(context);
      if (state === 'interrupted' || state === 'suspended') {
        // OS / other-app took the session. Do not trust this context again.
        if (!this.holdSuspended) this.needsHardUnlock = true;
      }
    };
    context.addEventListener('statechange', this.stateListener);
  }

  /** iOS: resume alone is not enough — play a zero-length buffer in the gesture. */
  private async prime(context: AudioContext) {
    try {
      if (contextState(context) !== 'running') await context.resume();
      const buffer = context.createBuffer(1, 1, context.sampleRate);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(0);
    } catch {
      /* prime is best-effort */
    }
  }

  private async closeContext() {
    const context = this.context;
    this.context = null;
    if (!context) return;
    if (this.stateListener) {
      try { context.removeEventListener('statechange', this.stateListener); } catch { /* ignore */ }
      this.stateListener = null;
    }
    try {
      if (contextState(context) !== 'closed') await context.close();
    } catch { /* ignore */ }
  }

  /**
   * App went to background or another app took audio.
   * Drop the session so the next user gesture builds a fresh context.
   */
  markBackground() {
    this.holdSuspended = false;
    this.needsHardUnlock = true;
    this.silenceActive();
    void this.closeContext();
  }

  private async ensureRunning(options: { create?: boolean; force?: boolean; hard?: boolean } = {}): Promise<AudioContext | null> {
    const create = options.create ?? true;
    const force = options.force ?? false;
    const hard = options.hard ?? false;

    if (hard || this.needsHardUnlock) {
      if (!create && !force && !hard) return null;
      this.silenceActive();
      await this.closeContext();
      if (!create && !hard && !force) return null;
      this.context = this.createContext();
      try {
        await this.context.resume();
        await this.prime(this.context);
      } catch { /* gesture may still be required */ }
      if (contextState(this.context) === 'running') this.needsHardUnlock = false;
      return this.context;
    }

    if (this.context && contextState(this.context) === 'closed') {
      this.context = null;
    }
    if (!this.context) {
      if (!create) return null;
      this.context = this.createContext();
    }
    if (this.holdSuspended && !force) return this.context;

    let state = contextState(this.context);
    if (state === 'suspended' || state === 'interrupted') {
      try {
        await this.context.resume();
        await this.prime(this.context);
      } catch {
        /* try recreate below */
      }
      state = contextState(this.context);
    }

    if (state !== 'running' && !this.holdSuspended) {
      this.silenceActive();
      await this.closeContext();
      this.context = this.createContext();
      try {
        await this.context.resume();
        await this.prime(this.context);
      } catch { /* still blocked until next gesture */ }
      if (contextState(this.context) === 'running') this.needsHardUnlock = false;
    }

    return this.context;
  }

  private async getContext(): Promise<AudioContext> {
    this.holdSuspended = false;
    const hard = this.needsHardUnlock;
    const context = await this.ensureRunning({ create: true, force: true, hard });
    if (!context) throw new Error('AudioContext unavailable');
    return context;
  }

  /**
   * 短いディレイ1本＋控えめフィードバック。
   * （やりすぎると符号が濁るので wet / feedback は弱め）
   */
  private connectReverb(context: AudioContext, source: GainNode, extras: AudioNode[]) {
    const dry = context.createGain();
    dry.gain.value = 1;

    const delay = context.createDelay(1);
    delay.delayTime.value = 0.045;
    const feedback = context.createGain();
    feedback.gain.value = 0.14;
    const wet = context.createGain();
    wet.gain.value = 0.16;

    source.connect(dry);
    dry.connect(context.destination);

    source.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(context.destination);

    extras.push(dry, delay, feedback, wet);
  }

  /**
   * Mute & disconnect immediately.
   * Do not call oscillator.stop() here — schedule() already reserved a stop time,
   * and a second stop() throws InvalidStateError while leaving the voice connected.
   */
  private silenceActive() {
    const active = this.active;
    this.active = null;
    if (!active) return;
    if (active.ringTimer !== null) {
      clearTimeout(active.ringTimer);
      active.ringTimer = null;
    }
    const now = this.context?.currentTime ?? 0;
    try {
      active.gain.gain.cancelScheduledValues(now);
      active.gain.gain.setValueAtTime(0, now);
    } catch { /* torn down */ }
    const nodes: AudioNode[] = [active.oscillator, active.gain, ...active.extras];
    for (const node of nodes) {
      try { node.disconnect(); } catch { /* torn down */ }
    }
    active.resolveFinished();
  }

  private async schedule(timeline: MorseTimeline, settings: AudioSettings): Promise<PlaybackHandle> {
    this.silenceActive();
    const context = await this.getContext();
    this.silenceActive();

    if (contextState(context) !== 'running') {
      try {
        await context.resume();
        await this.prime(context);
      } catch { /* ignore */ }
    }
    if (contextState(context) !== 'running') {
      // Still dead — force one more hard recreate (gesture chain may still be warm).
      this.needsHardUnlock = true;
      const retry = await this.getContext();
      if (contextState(retry) !== 'running') {
        throw new Error('AudioContext not running');
      }
      return this.schedule(timeline, settings);
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const extras: AudioNode[] = [];
    const start = context.currentTime + 0.08;
    const attack = Math.min(0.008, Math.max(0.001, settings.attack));
    const release = Math.min(0.012, Math.max(0.001, settings.release));
    let finishedSettled = false;
    const resolveFinished = () => {
      if (finishedSettled) return;
      finishedSettled = true;
      resolveDone();
    };
    let resolveDone!: () => void;
    const finished = new Promise<void>((resolve) => { resolveDone = resolve; });

    oscillator.type = settings.waveform;
    oscillator.frequency.setValueAtTime(settings.pitch, start);
    gain.gain.setValueAtTime(0, context.currentTime);

    timeline.tones.forEach((event) => {
      const on = start + event.start;
      const off = on + event.duration;
      gain.gain.setValueAtTime(0, Math.max(start, on - 0.001));
      gain.gain.linearRampToValueAtTime(settings.volume, on + attack);
      gain.gain.setValueAtTime(settings.volume, Math.max(on + attack, off - release));
      gain.gain.linearRampToValueAtTime(0, off);
    });

    oscillator.connect(gain);

    if (settings.reverb) {
      this.connectReverb(context, gain, extras);
    } else {
      gain.connect(context.destination);
    }

    const voice: ActiveVoice = { oscillator, gain, extras, resolveFinished, ringTimer: null };
    oscillator.onended = () => {
      if (this.active !== voice) {
        resolveFinished();
        return;
      }
      resolveFinished();
      if (!settings.reverb) {
        this.active = null;
        return;
      }
      voice.ringTimer = setTimeout(() => {
        if (this.active !== voice) return;
        this.active = null;
        const nodes: AudioNode[] = [oscillator, gain, ...extras];
        for (const node of nodes) {
          try { node.disconnect(); } catch { /* torn down */ }
        }
      }, REVERB_RING_MS);
    };
    oscillator.start(start);
    oscillator.stop(start + timeline.duration + 0.03);
    this.active = voice;

    const stop = () => {
      if (this.active === voice) this.silenceActive();
      else resolveFinished();
    };

    return {
      timeline,
      startedAt: start,
      currentTime: () => Math.max(0, context.currentTime - start),
      receivedCount: () => timeline.characters.filter((character) => start + character.end <= context.currentTime).length,
      stop,
      finished,
    };
  }

  async play(text: string, alphabet: AlphabetType, settings: AudioSettings): Promise<PlaybackHandle> {
    return this.schedule(buildMorseTimeline(text, alphabet, settings), settings);
  }

  async playSymbol(symbol: string, code: string, settings: AudioSettings, repeats = 1): Promise<PlaybackHandle> {
    return this.schedule(buildRepeatedSymbolTimeline(symbol, code, repeats, settings), settings);
  }

  /** Ensure AudioContext is running (call from a user gesture before async work). */
  async unlock() {
    this.holdSuspended = false;
    await this.ensureRunning({ create: true, force: true, hard: this.needsHardUnlock || !this.context });
  }

  /**
   * Soft wake after foreground — does not create a context.
   * Hard unlock still happens on the next gesture / play.
   */
  async wake() {
    if (this.holdSuspended) return;
    if (this.needsHardUnlock || !this.context) return;
    await this.ensureRunning({ create: false, force: false });
  }

  stop() {
    this.holdSuspended = false;
    this.silenceActive();
  }

  /** Freeze scheduled tones + context clock (exam Stop). */
  async pause() {
    if (!this.context) return;
    this.holdSuspended = true;
    if (contextState(this.context) === 'running') await this.context.suspend();
  }

  /** Resume after pause (exam Continue). */
  async resume() {
    this.holdSuspended = false;
    if (this.needsHardUnlock || !this.context) {
      await this.unlock();
      return;
    }
    await this.ensureRunning({ create: false, force: true });
  }

  get state() { return this.context?.state ?? 'closed'; }
  get paused() { return this.holdSuspended || this.context?.state === 'suspended'; }
  get isDirty() { return this.needsHardUnlock; }
}
