import { Mp3Encoder } from '@breezystack/lamejs';

export function encodeMp3(samples: Float32Array, sampleRate: number, progress: (value: number) => void = () => {}) {
  const encoder = new Mp3Encoder(1, sampleRate, 96);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const size = 1152;
  for (let offset = 0; offset < samples.length; offset += size) {
    const pcm = new Int16Array(Math.min(size, samples.length - offset));
    for (let index = 0; index < pcm.length; index++) {
      const value = Math.max(-1, Math.min(1, samples[offset + index]));
      pcm[index] = Math.round(value * (value < 0 ? 32768 : 32767));
    }
    const bytes = encoder.encodeBuffer(pcm);
    if (bytes.length) chunks.push(new Uint8Array(bytes));
    if (offset % (size * 64) === 0) progress(offset / samples.length);
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(new Uint8Array(tail));
  progress(1);
  return chunks;
}
