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
export const LASER_WAIT_Y = 287; // Legacy layout reference; physics never stops here.
export const LASER_IMPACT_Y = 318;
/** World units / second. Independent of WPM, symbol, hints and viewport. */
export const LASER_SPEED = 18;
export const laserTravelSeconds = (originY: number) => Math.max(0,LASER_IMPACT_Y-originY)/LASER_SPEED;
export function laserSegments(timeline: MorseTimeline, elapsed: number, hints: boolean, _window: number, originY: number): LaserSegment[] {
  const time=Math.max(0,elapsed);
  const distance=Math.max(0,LASER_IMPACT_Y-originY);
  if (!hints) return [{y:originY,length:Math.min(distance,time*LASER_SPEED)}];
  // Audio tone-on emits a head; tone-off releases its tail. Both then travel
  // at the same world velocity. Do not normalize by signal length or WPM.
  return timeline.tones.flatMap(tone => {
    const age=time-tone.start;
    const head=Math.min(distance,Math.max(0,age)*LASER_SPEED);
    const tail=Math.min(distance,Math.max(0,age-tone.duration)*LASER_SPEED);
    return head>tail ? [{y:originY+tail,length:head-tail}] : [];
  });
}
