import { describe,it,expect } from 'vitest';
import { buildMorseTimeline } from '../timing';
import { DEFAULT_SETTINGS } from '../storage';
import { MODES,createGame,nextStage,answerSeconds } from './cwGuard';
import { laserSegments,transmissionWindow,LASER_SPEED,LASER_IMPACT_Y,laserTravelSeconds,answerDeadline } from './laser';
const timeline=(symbol:string,wpm=8)=>buildMorseTimeline(symbol,'international',{...DEFAULT_SETTINGS,characterSpeed:wpm,effectiveSpeed:wpm});
describe('constant world-speed CW beams',()=>{
  it.each([8,12,16,20,22,30,40])('%i WPM uses exact audio tone-on/off and 1:3:1 lengths/gaps',wpm=>{
    for(const symbol of ['A','N','S','O','5','0']){
      const t=timeline(symbol,wpm), window=transmissionWindow(MODES.expert.pool,wpm), origin=109;
      expect(t.dit).toBeCloseTo(1.2/wpm);
      expect(laserSegments(t,0,true,window,origin)).toEqual([]);
      t.tones.forEach((tone,i)=>{
        const during=laserSegments(t,tone.start+tone.duration/2,true,window,origin)[i];
        expect(during.y).toBe(origin);
        expect(during.length).toBeCloseTo(tone.duration/2*LASER_SPEED);
      });
      const full=laserSegments(t,t.duration,true,window,origin);
      full.forEach((segment,i)=>{
        expect(segment.length).toBeCloseTo(t.dit*LASER_SPEED*(t.tones[i].element==='-'?3:1));
        if(i) expect(full[i-1].y-segment.y-segment.length).toBeCloseTo(t.dit*LASER_SPEED);
      });
      const end=t.tones[0].start+t.tones[0].duration;
      const a=laserSegments(t,end+.01,true,window,origin)[0];
      const b=laserSegments(t,end+.03,true,window,origin)[0];
      expect((b.y-a.y)/.02).toBeCloseTo(LASER_SPEED);
      expect(((b.y+b.length)-(a.y+a.length))/.02).toBeCloseTo(LASER_SPEED);
      expect(b.length).toBeCloseTo(a.length);
      // Transmission ending does not freeze motion or teleport a beam to town.
      const later=laserSegments(t,t.duration+1,true,window,origin);
      expect(later[0].y-full[0].y).toBeCloseTo(LASER_SPEED);
      const arrival=laserTravelSeconds(origin);
      expect(laserSegments(t,arrival-.001,true,window,origin)[0].y+full[0].length).toBeLessThan(LASER_IMPACT_Y);
      const hit=laserSegments(t,arrival,true,window,origin)[0];
      expect(hit.y+hit.length).toBeCloseTo(LASER_IMPACT_Y);
      expect(laserSegments(t,arrival+t.duration+1,true,window,origin)).toEqual([]);
    }
  });
  it('OFF is continuous, releases its tail at a shared window, never reveals individual tones',()=>{
    for(const wpm of [8,12,16,20,22,30,40]) {
      const window=transmissionWindow(MODES.expert.pool,wpm), arrival=laserTravelSeconds(109);
      for(const elapsed of [.02,.2,1,4,arrival+window+1]){
        const expected=laserSegments(timeline('A',wpm),elapsed,false,window,109);
        for(const symbol of MODES.expert.pool) expect(laserSegments(timeline(symbol,wpm),elapsed,false,window,109)).toEqual(expected);
        if(expected.length && elapsed>window) expect(expected[0].y).toBeGreaterThan(109);
      }
      expect(laserSegments(timeline('O',wpm),100,false,window,109)).toEqual([]);
    }
  });
  it('provides a symbol-independent answer allowance before physical impact for every difficulty/stage',()=>{
    for(const mode of ['beginner','standard','expert'] as const){
      let g=createGame(mode);
      for(let stage=1;stage<=3;stage++){
        if(stage>1) g=nextStage({...g,phase:'clear'});
        for(const variation of mode==='expert'?[-2,0,2]:[0]){
          const wpm=MODES[mode].wpm+(stage-1)*2+variation;
          const window=transmissionWindow(MODES[mode].pool,wpm);
          // Highest muzzle has shortest flight. Neither symbol nor hint changes deadline.
          const deadline=answerDeadline(window,answerSeconds(g),111);
          expect(deadline).toBeLessThanOrEqual(laserTravelSeconds(111));
          expect(deadline-window).toBeGreaterThan(2);
          expect(window).toBeLessThan(deadline);
          for(const symbol of MODES[mode].pool) expect(timeline(symbol,wpm).duration).toBeLessThanOrEqual(window+1e-9);
        }
      }
    }
  });
});
