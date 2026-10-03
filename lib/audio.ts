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

export class MorseAudioEngine {
  private context: AudioContext | null = null;
  private active: ActiveVoice | null = null;

  private async getContext(): Promise<AudioContext> {
    if (!this.context) this.context = new AudioContext({ latencyHint: 'interactive' });
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context;
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
      // 符号本体の終了はすぐ通知。反響の余韻だけ少し残してから切断。
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
    await this.getContext();
  }

  stop() {
    if (this.context?.state === 'suspended') void this.context.resume();
    this.silenceActive();
  }

  /** Freeze scheduled tones + context clock (exam Stop). */
  async pause() {
    if (!this.context) return;
    if (this.context.state === 'running') await this.context.suspend();
  }

  /** Resume after pause (exam Continue). */
  async resume() {
    if (!this.context) return;
    if (this.context.state === 'suspended') await this.context.resume();
  }

  get state() { return this.context?.state ?? 'closed'; }
  get paused() { return this.context?.state === 'suspended'; }
}
