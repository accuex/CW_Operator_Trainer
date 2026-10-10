import { describe,it,expect } from 'vitest';
import { buildMorseTimeline } from '../timing';
import { DEFAULT_SETTINGS } from '../storage';
import { MODES } from './cwGuard';
import { laserSegments,transmissionWindow,LASER_WAIT_Y } from './laser';
const timeline=(symbol:string,wpm=8)=>buildMorseTimeline(symbol,'international',{...DEFAULT_SETTINGS,characterSpeed:wpm,effectiveSpeed:wpm});
describe('CW beam growth',()=>{
  it.each(['A','N','S','O'])('%s grows from the root in exact tone order with 3:1 lengths and element gaps',symbol=>{
    const t=timeline(symbol), origin=222, window=transmissionWindow(MODES.beginner.pool,8);
    expect(laserSegments(t,0,true,window,origin)).toEqual([]);
    const complete=laserSegments(t,window,true,window,origin);
    expect(complete).toHaveLength(t.tones.length);
    const unit=(LASER_WAIT_Y-origin)/t.duration*t.dit;
    complete.forEach((segment,i)=>{
      expect(segment.length).toBeCloseTo(unit*(t.tones[i].element==='-'?3:1));
      if(i) expect(complete[i-1].y-segment.y-segment.length).toBeCloseTo(unit);
      const halfway=laserSegments(t,t.tones[i].start+t.tones[i].duration/2,true,window,origin);
      expect(halfway).toHaveLength(i+1);
      expect(halfway[i].length).toBeCloseTo(segment.length/2);
      expect(halfway[i].y).toBe(origin);
      if(i) expect(halfway[0].y).toBeGreaterThan(origin);
    });
    expect(complete[0].y+complete[0].length).toBeCloseTo(LASER_WAIT_Y);
    expect(laserSegments(t,window*4,true,window,origin)).toEqual(complete);
  });
  it.each([16,20,30,40])('%i WPM preserves dot/dash/gap and independent equal-speed travel',wpm=>{
    for(const symbol of ['A','N','S','O','5','0']){
      const t=timeline(symbol,wpm), window=transmissionWindow(MODES.expert.pool,wpm);
      for(const origin of [81,222,269]){
        const full=laserSegments(t,t.duration,true,window,origin);
        const unit=(LASER_WAIT_Y-origin)/t.duration*t.dit;
        full.forEach((s,i)=>{
          expect(s.length).toBeCloseTo(unit*(t.tones[i].element==='-'?3:1));
          if(i) expect(full[i-1].y-s.y-s.length).toBeCloseTo(unit);
        });
        const end=t.tones[0].start+t.tones[0].duration;
        const a=laserSegments(t,end+t.dit*.1,true,window,origin)[0];
        const b=laserSegments(t,end+t.dit*.5,true,window,origin)[0];
        expect(b.y-a.y).toBeCloseTo(unit*.4);
        expect((b.y+b.length)-(a.y+a.length)).toBeCloseTo(unit*.4);
        expect(b.length).toBeCloseTo(a.length);
        expect(laserSegments(t,window,true,window,origin)).toEqual(full);
      }
    }
  });
  it('OFF has identical geometry and duration for every symbol, with no gaps or flashes',()=>{
    for(const mode of Object.values(MODES)){
      const window=transmissionWindow(mode.pool,mode.wpm);
      for(const symbol of mode.pool){
        const t=timeline(symbol,mode.wpm);
        expect(t.duration).toBeLessThanOrEqual(window+1e-10);
        expect(laserSegments(t,window*.4,false,window,269)).toEqual([{y:269,length:(LASER_WAIT_Y-269)*.4}]);
        expect(laserSegments(t,window,false,window,269)).toEqual([{y:269,length:LASER_WAIT_Y-269}]);
      }
    }
  });
  it('uses the same audio elapsed fraction at different speeds and never reaches town during transmission',()=>{
    for(const wpm of [8,12,16,20,30,40]){
      const t=timeline('A',wpm), window=transmissionWindow(MODES.standard.pool,wpm);
      const segments=laserSegments(t,t.duration/2,true,window,81);
      const reference=laserSegments(timeline('A',8),timeline('A',8).duration/2,true,transmissionWindow(MODES.standard.pool,8),81);
      expect(segments).toHaveLength(reference.length);
      segments.forEach((segment,i)=>{expect(segment.y).toBeCloseTo(reference[i].y);expect(segment.length).toBeCloseTo(reference[i].length);});
      expect(laserSegments(t,window*4,false,window,81)[0].length+81).toBe(LASER_WAIT_Y);
    }
  });
});
