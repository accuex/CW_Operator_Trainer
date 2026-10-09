import Mp3Worker from './mp3.worker?worker';
import type { AudioSettings } from '../types';
import { buildExportTimeline, type AudioExportSegment } from './timeline';

/** Live playbackと独立したオフライン音声。入力・採点・再生状態には触らない。 */
export async function createMp3(segments: AudioExportSegment[], settings: AudioSettings, onProgress: (value: number) => void, signal: AbortSignal) {
  const timeline = buildExportTimeline(segments, settings);
  const sampleRate = 44100;
  const context = new OfflineAudioContext(1, Math.ceil((timeline.duration + 0.3) * sampleRate), sampleRate);
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = settings.waveform;
  oscillator.frequency.value = settings.pitch;
  gain.gain.value = 0;
  const attack = Math.min(0.008, Math.max(0.001, settings.attack));
  const release = Math.min(0.012, Math.max(0.001, settings.release));
  for (const event of timeline.tones) {
    const on = 0.08 + event.start;
    const off = on + event.duration;
    gain.gain.setValueAtTime(0, Math.max(0.08, on - 0.001));
    gain.gain.linearRampToValueAtTime(settings.volume, on + attack);
    gain.gain.setValueAtTime(settings.volume, Math.max(on + attack, off - release));
    gain.gain.linearRampToValueAtTime(0, off);
  }
  oscillator.connect(gain);
  gain.connect(context.destination);
  if (settings.reverb) {
    const delay = context.createDelay(1);
    const wet = context.createGain();
    const feedback = context.createGain();
    delay.delayTime.value = 0.045;
    wet.gain.value = 0.16;
    feedback.gain.value = 0.14;
    gain.connect(delay); delay.connect(wet); wet.connect(context.destination);
    delay.connect(feedback); feedback.connect(delay);
  }
  oscillator.start(0.08);
  oscillator.stop(0.08 + timeline.duration + 0.03);
  const rendered = await context.startRendering();
  signal.throwIfAborted();
  const samples = rendered.getChannelData(0);
  return await new Promise<Blob>((resolve, reject) => {
    const worker = new Mp3Worker();
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { cleanup(); reject(new Error('MP3の変換に失敗しました')); };
    worker.onmessage = (event: MessageEvent<{ progress?: number; chunks?: Uint8Array<ArrayBuffer>[]; error?: string }>) => {
      if (event.data.error) { cleanup(); reject(new Error(event.data.error)); }
      else if (event.data.chunks) { cleanup(); resolve(new Blob(event.data.chunks, { type: 'audio/mpeg' })); }
      else if (event.data.progress !== undefined) onProgress(event.data.progress);
    };
    worker.postMessage({ samples, sampleRate }, [samples.buffer]);
  });
}
