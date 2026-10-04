/**
 * UI sound effects on a dedicated AudioContext so they never share a
 * scheduler with Morse playback. Only trigger after the Morse signal ended
 * (answer feedback, card reveal) to keep the training audio clean.
 */
export type SfxName = 'hit' | 'miss' | 'combo' | 'reveal' | 'rare' | 'tap';

let context: AudioContext | null = null;
let enabled = true;
let needsHardUnlock = false;

export const setSfxEnabled = (value: boolean) => { enabled = value; };

type ContextState = AudioContextState | 'interrupted';

const stateOf = (audio: AudioContext) => audio.state as ContextState;

async function closeSfx() {
  const current = context;
  context = null;
  if (!current) return;
  try {
    if (stateOf(current) !== 'closed') await current.close();
  } catch { /* ignore */ }
}

async function prime(audio: AudioContext) {
  try {
    if (stateOf(audio) !== 'running') await audio.resume();
    const buffer = audio.createBuffer(1, 1, audio.sampleRate);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    source.start(0);
  } catch { /* ignore */ }
}

async function ensureSfxContext(create: boolean, hard = false) {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;

  if (hard || needsHardUnlock) {
    if (!create && !hard) return null;
    await closeSfx();
    if (!create && !hard) return null;
    context = new AudioContext({ latencyHint: 'interactive' });
    try {
      await context.resume();
      await prime(context);
    } catch { /* gesture */ }
    if (stateOf(context) === 'running') needsHardUnlock = false;
    return context;
  }

  if (context && stateOf(context) === 'closed') context = null;
  if (!context) {
    if (!create) return null;
    context = new AudioContext({ latencyHint: 'interactive' });
  }
  let state = stateOf(context);
  if (state === 'suspended' || state === 'interrupted') {
    try {
      await context.resume();
      await prime(context);
    } catch { /* gesture race */ }
    state = stateOf(context);
  }
  if (state !== 'running') {
    await closeSfx();
    context = new AudioContext({ latencyHint: 'interactive' });
    try {
      await context.resume();
      await prime(context);
    } catch { /* ignore */ }
    if (stateOf(context) === 'running') needsHardUnlock = false;
  }
  return context;
}

/** Drop SFX session when the app backgrounds (YouTube etc.). */
export function markSfxBackground() {
  needsHardUnlock = true;
  void closeSfx();
}

/** Soft wake — hard unlock happens on next play / gesture. */
export async function wakeSfx() {
  if (needsHardUnlock || !context) return;
  await ensureSfxContext(false);
}

export async function unlockSfx() {
  await ensureSfxContext(true, needsHardUnlock || !context);
}

function tone(audio: AudioContext, frequency: number, start: number, duration: number, volume: number, type: OscillatorType = 'sine', glideTo?: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + duration);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

function fire(audio: AudioContext, name: SfxName, masterVolume: number) {
  const v = Math.max(0, Math.min(0.6, masterVolume)) * 0.55;
  if (v <= 0) return;
  const t = audio.currentTime + 0.01;
  switch (name) {
    case 'tap':
      tone(audio, 1400, t, 0.05, v * 0.4, 'triangle');
      break;
    case 'hit':
      tone(audio, 880, t, 0.12, v, 'triangle');
      tone(audio, 1318.5, t + 0.08, 0.2, v, 'triangle');
      break;
    case 'combo':
      [880, 1108.7, 1318.5, 1760].forEach((f, i) => tone(audio, f, t + i * 0.06, 0.18, v * 0.85, 'triangle'));
      break;
    case 'miss':
      tone(audio, 260, t, 0.22, v * 0.8, 'square', 180);
      break;
    case 'reveal':
      [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(audio, f, t + i * 0.09, 0.5, v * 0.8, 'triangle'));
      tone(audio, 2093, t + 0.4, 0.8, v * 0.35, 'sine');
      break;
    case 'rare':
      [523.3, 659.3, 784, 1046.5, 1318.5, 1568].forEach((f, i) => tone(audio, f, t + i * 0.08, 0.6, v * 0.75, 'triangle'));
      [2093, 2637].forEach((f, i) => tone(audio, f, t + 0.55 + i * 0.12, 1, v * 0.3, 'sine'));
      break;
  }
}

export function playSfx(name: SfxName, masterVolume = 0.25) {
  if (!enabled) return;
  void ensureSfxContext(true, needsHardUnlock || !context).then((audio) => {
    if (!audio || stateOf(audio) !== 'running') return;
    fire(audio, name, masterVolume);
  });
}
