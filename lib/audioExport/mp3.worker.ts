import { encodeMp3 } from './encode';
self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
  try {
    const chunks = encodeMp3(event.data.samples, event.data.sampleRate, (progress) => self.postMessage({ progress }));
    self.postMessage({ chunks }, { transfer: chunks.map((chunk) => chunk.buffer) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'MP3の変換に失敗しました' });
  }
};
