import {describe,it,expect,vi,afterEach} from 'vitest';
import {GameMusic} from './music';
afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 let time=0;let frames=new Map<number,FrameRequestCallback>(),id=0;
 vi.stubGlobal('performance',{now:()=>time});vi.stubGlobal('requestAnimationFrame',(f:FrameRequestCallback)=>{frames.set(++id,f);return id;});vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
 const audio={volume:.08,currentTime:2,play:vi.fn(async()=>{}),pause:vi.fn()};let attached=true;
 const music=new GameMusic(()=>attached?audio as unknown as HTMLAudioElement:null);
 const tick=(t:number)=>{time=t;const pending=[...frames.values()];frames.clear();pending.forEach(f=>f(t));};
 return {music,audio,tick,detach:()=>attached=false};
}
describe('boss music lifecycle',()=>{
 it('primes silently on gesture, fades in, keeps loop position on pause and fades out after defeat',async()=>{
  const {music,audio,tick}=fixture();await music.unlock();expect(audio.volume).toBe(0);expect(audio.currentTime).toBe(0);
  await music.play(.08);tick(300);expect(audio.volume).toBeCloseTo(.04);tick(600);expect(audio.volume).toBe(.08);
  audio.currentTime=12;music.pause();expect(audio.currentTime).toBe(12);await music.play(.05);tick(1200);expect(audio.volume).toBe(.05);
  music.stop();tick(1850);expect(audio.volume).toBe(0);expect(audio.pause).toHaveBeenCalledTimes(3);
 });
 it('a pending silent prime never interrupts a newer WARNING music start',async()=>{
  const {music,audio,tick}=fixture();let done!:()=>void;
  audio.play.mockImplementationOnce(()=>new Promise<void>(resolve=>done=resolve));const prime=music.unlock();expect(audio.currentTime).toBe(0);
  await music.play(.08);done();await prime;tick(600);expect(audio.pause).not.toHaveBeenCalled();expect(audio.volume).toBe(.08);
 });
 it('cancels stale async starts after pause and stops audio even after DOM ref detaches',async()=>{
  const {music,audio,detach}=fixture();await music.unlock();
  let done!:()=>void;audio.play.mockImplementationOnce(()=>new Promise<void>(resolve=>done=resolve));const pending=music.play(.08);music.pause();done();await pending;
  expect(audio.pause).toHaveBeenCalledTimes(3);detach();music.dispose();expect(audio.pause).toHaveBeenCalledTimes(4);
 });
});
