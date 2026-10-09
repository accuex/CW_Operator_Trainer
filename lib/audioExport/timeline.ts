import { buildMorseTimeline } from '../timing';
import type { AlphabetType, AudioSettings, ToneEvent } from '../types';

export interface AudioExportSegment { text: string; alphabet: AlphabetType; silenceAfter?: number }
export function buildExportTimeline(segments: AudioExportSegment[], settings: AudioSettings) {
  const tones: ToneEvent[] = [];
  let duration = 0;
  for (const segment of segments) {
    const timeline = buildMorseTimeline(segment.text, segment.alphabet, settings);
    tones.push(...timeline.tones.map((tone) => ({ ...tone, start: tone.start + duration })));
    duration += timeline.duration + Math.max(0, segment.silenceAfter ?? 0);
  }
  if (!tones.length) throw new Error('保存する符号がありません');
  return { tones, duration };
}
