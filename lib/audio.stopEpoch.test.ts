import { afterEach, describe, expect, it, vi } from 'vitest';
import { MorseAudioEngine } from './audio';

type Gate = { wait: Promise<void>; release: () => void };

function makeGate(): Gate {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

/** Minimal Web Audio stubs so schedule() can run under vitest/node. */
function installAudioMock(options?: { resumeGate?: Gate }) {
  class GainNodeMock {
    gain = {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    };
    connect = vi.fn();
    disconnect = vi.fn();
  }
  class OscillatorNodeMock {
    type = 'sine';
    frequency = { setValueAtTime: vi.fn() };
    onended: (() => void) | null = null;
    connect = vi.fn();
    disconnect = vi.fn();
    start = vi.fn();
    stop = vi.fn(function stop(this: OscillatorNodeMock) {
      queueMicrotask(() => this.onended?.());
    });
  }
  class DelayNodeMock {
    delayTime = { value: 0 };
    connect = vi.fn();
    disconnect = vi.fn();
  }
  class AudioContextMock {
    state: AudioContextState = 'suspended';
    currentTime = 0;
    sampleRate = 48000;
    destination = {};
    createOscillator = () => new OscillatorNodeMock();
    createGain = () => new GainNodeMock();
    createDelay = () => new DelayNodeMock();
    createBuffer = () => ({});
    createBufferSource = () => ({
      buffer: null as unknown,
      connect: vi.fn(),
      start: vi.fn(),
    });
    resume = async () => {
      if (options?.resumeGate) await options.resumeGate.wait;
      this.state = 'running';
    };
    close = async () => { this.state = 'closed'; };
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
  }
  vi.stubGlobal('AudioContext', AudioContextMock);
}

describe('MorseAudioEngine stop during play()', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not start a new voice when stop() races with getContext()', async () => {
    const gate = makeGate();
    installAudioMock({ resumeGate: gate });
    const engine = new MorseAudioEngine();
    const settings = {
      characterSpeed: 20,
      effectiveSpeed: 20,
      pitch: 600,
      volume: 0.5,
      waveform: 'sine' as const,
      attack: 0.005,
      release: 0.005,
      reverb: false,
      farnsworth: false,
    };

    const pending = engine.play('A', 'international', settings);
    engine.stop();
    gate.release();

    const handle = await pending;
    expect(handle.startedAt).toBe(0);
    await handle.finished;
  });

  it('play() after stop() still works', async () => {
    installAudioMock();
    const engine = new MorseAudioEngine();
    const settings = {
      characterSpeed: 20,
      effectiveSpeed: 20,
      pitch: 600,
      volume: 0.5,
      waveform: 'sine' as const,
      attack: 0.005,
      release: 0.005,
      reverb: false,
      farnsworth: false,
    };
    engine.stop();
    const handle = await engine.play('E', 'international', settings);
    expect(handle.startedAt).toBeGreaterThan(0);
    expect(handle.currentTime()).toBe(0);
    expect(handle.timelineTime!()).toBeCloseTo(-.08);
    handle.stop();
    await handle.finished;
  });
});
