import { INTERNATIONAL_MORSE } from '../morse';
import type { MorseTimeline } from '../types';

/** Same window for every symbol in a difficulty pool; no visual length/timing oracle. */
export function transmissionWindow(pool: string, wpm: number): number {
  const dit = 1.2 / Math.max(5,wpm);
  return Math.max(...[...pool].map(symbol => {
    const code=INTERNATIONAL_MORSE[symbol];
    return [...code].reduce((sum,element)=>sum+(element==='-'?3:1),Math.max(0,code.length-1));
  })) * dit;
}
export interface LaserSegment { y: number; length: number }
export const LASER_WAIT_Y = 287;
export const LASER_IMPACT_Y = 318;
export function laserSegments(timeline: MorseTimeline, elapsed: number, hints: boolean, window: number, originY: number): LaserSegment[] {
  const distance=Math.max(0,LASER_WAIT_Y-originY);
  const t=Math.min(window,Math.max(0,elapsed));
  if (!hints) return [{y:originY,length:distance*Math.min(1,t/window)}];
  // Each tone starts at the emitter. Its head travels while sounding; after
  // tone-off its tail follows downward. Earlier tones are lower, never appended.
  // Audio elapsed time preserves dash:dot and inter-element gaps at 3:1:1.
  // ON uses the actual signal, not the longest signal plus silent wait.
  // Short codes gain spacing without changing the answer clock.
  const visualDuration=Math.max(timeline.duration,timeline.dit);
  const visualTime=Math.min(t,visualDuration);
  const scale=distance/visualDuration;
  return timeline.tones.flatMap(tone => {
    const age=Math.max(0,visualTime-tone.start);
    const length=Math.min(tone.duration,age)*scale;
    const tail=Math.max(0,age-tone.duration)*scale;
    return length>0 ? [{y:originY+tail,length}] : [];
  });
}
