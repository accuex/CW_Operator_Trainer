import {describe,it,expect,vi,afterEach} from 'vitest';
import {GameSE,SoundEvents,soundVoices,readMix,saveMix,MIX_KEY,DEFAULT_MIX,type Sound} from './se';
import {advanceGame,answerAttack,beginTransmission,canAnswer,enemyPosition,nextAttack,oldestAttack,transmittingAttack,createGame,pauseGame,resumeAttack,type GuardGame} from './cwGuard';
import {PRESETS} from './presets';
import {buildMorseTimeline} from '../timing';
import {DEFAULT_SETTINGS} from '../storage';
afterEach(()=>vi.unstubAllGlobals());
function campaignStep(g:GuardGame):GuardGame{
  if(canAnswer(g)){const a=oldestAttack(g)!;return answerAttack(g,a.id,a.symbol);}
  if(g.phase==='entering')return advanceGame(g,g.arrivalUntil);
  if(['intermission','warning'].includes(g.phase))return advanceGame(g,g.transitionUntil);
  if(g.phase==='awakening'||g.phase==='rekeying')return advanceGame(g,g.boss!.transitionUntil!);
  if(g.phase==='defeating')return advanceGame(g,g.boss!.defeatedAt!+3);
  const a=transmittingAttack(g);
  if(a?.status==='preparing'){
    g=advanceGame(g,Math.max(g.time,a.readyAt));const p=enemyPosition(g,g.drones.find(d=>d.id===a.enemy)!);
    return beginTransmission(g,a.id,buildMorseTimeline(a.symbol,PRESETS[g.preset].alphabet,{...DEFAULT_SETTINGS,characterSpeed:a.wpm,effectiveSpeed:a.wpm}),g.time,p.x,p.y+(g.boss?52:25.6));
  }
  const times=[a?.answerAt,a?.sendEndsAt,g.nextFireAt].filter((n):n is number=>n!=null&&n>g.time+1e-8);
  return advanceGame(g,times.length?Math.min(...times):g.time+.02);
}

const state=()=>({...createGame('beginner',true,73),phase:'active' as const});
describe('arcade SE event clock',()=>{
 it('separates launch, missile arrival and destruction; no duplicates on animation frames or pause',()=>{
  const events=new SoundEvents();let g:GuardGame=state();events.update(g);
  const enemy=g.drones[0];g={...g,time:1,attempts:1,combo:1,shots:[{id:1,attackId:1,enemy:enemy.id,at:1,selected:'A',correct:true,points:100}],drones:g.drones.map(d=>d.id===enemy.id?{...d,hp:0,alive:false}:d)};
  expect(events.update(g)).toEqual(['launch']);expect(events.update({...g,time:1.54})).toEqual([]);
  g=pauseGame({...g,time:1.54});expect(events.update(g)).toEqual([]);expect(events.update(g)).toEqual([]);
  g=resumeAttack(g);expect(events.update(g)).toEqual([]);
  expect(events.update({...g,time:1.55})).toEqual(['hit','destroy']);expect(events.update({...g,time:1.6})).toEqual([]);
 });
 it('wrong shots only launch; boss damage and rapid simultaneous missiles have independent arrivals',()=>{
  const events=new SoundEvents();let g:GuardGame=state();events.update(g);
  g={...g,time:2,shots:[{id:1,attackId:1,enemy:0,at:2,selected:'B',correct:false,points:0}]};expect(events.update(g)).toEqual(['launch']);
  g={...g,time:2.3,shots:[...g.shots,{id:2,attackId:1,enemy:0,at:2.3,selected:'A',correct:true,points:100},{id:3,attackId:2,enemy:1,at:2.3,selected:'C',correct:true,points:100}]};expect(events.update(g)).toEqual(['launch','launch']);
  expect(events.update({...g,time:2.86})).toEqual(['hit','damage','hit','damage']);
 });
 it('milestones trigger once and reset per run; pause/resume does not replay awakening or warning',()=>{
  const e=new SoundEvents();let g:GuardGame=state();e.update(g);
  for(const n of [10,25,50,100]){g={...g,combo:n,correct:n};expect(e.update(g)).toEqual([`combo${n}`]);expect(e.update(g)).toEqual([]);}
  g={...g,phase:'warning'};expect(e.update(g)).toEqual(['stage','warning']);e.update(pauseGame(g));expect(e.update(g)).toEqual([]);
  g={...g,phase:'awakening'};expect(e.update(g)).toEqual(['awakening']);e.update(pauseGame(g));expect(e.update(g)).toEqual([]);
  g={...g,phase:'over'};expect(e.update(g)).toEqual(['over']);expect(e.update(g)).toEqual([]);
  e.update(null);expect(e.update({...g,runId:'new'})).toEqual(['over']);
 });
 it.each([8,40])('full campaign at %i WPM emits launches, delayed hits, all combo milestones and boss phases exactly once',wpm=>{
  let g=nextAttack(createGame('beginner',true,73,{wpm})),guard=0;const e=new SoundEvents(),sounds:Sound[]=[];e.update(g);
  while(g.phase!=='clear'&&g.phase!=='over'&&guard++<10000){g=campaignStep(g);sounds.push(...e.update(g));}
  expect(g.phase).toBe('clear');expect(sounds.filter(s=>s==='launch')).toHaveLength(245);expect(sounds.filter(s=>s==='hit')).toHaveLength(245);
  expect(sounds.filter(s=>s==='damage')).toHaveLength(75);expect(sounds.filter(s=>s==='destroy')).toHaveLength(70);expect(sounds.filter(s=>s==='bossHit')).toHaveLength(100);
  expect(sounds.filter(s=>s==='squad')).toHaveLength(14);expect(sounds.filter(s=>s==='stage')).toHaveLength(3);
  for(const sound of ['warning','bossEnter','awakening','final','bossDestroy','complete','combo10','combo25','combo50','combo100'])expect(sounds.filter(s=>s===sound)).toHaveLength(1);
 });
 it('physical impacts emit once and terminal/reset states discard future missile sounds',()=>{
  let g=nextAttack(state());g=advanceGame(g,g.arrivalUntil);const attack=g.attacks[0],e=new SoundEvents();e.update(g);
  g={...g,time:1,resolved:[{attack,at:1,status:'impacted',buildingId:null}]};expect(e.update(g)).toEqual(['impact']);expect(e.update({...g,time:1.1})).toEqual([]);
  g={...g,time:2,shots:[{id:1,attackId:attack.id,enemy:attack.enemy,at:2,selected:'A',correct:true,points:100}]};expect(e.update(g)).toEqual(['launch']);
  g={...g,phase:'over'};expect(e.update(g)).toEqual(['over']);expect(e.update({...g,time:3})).toEqual([]);e.update(null);
  expect(e.update({...state(),time:10})).toEqual([]);
 });
 it('all requested sounds use finite, short, bounded voices with no excessive high frequencies',()=>{
  const sounds:Sound[]=['launch','hit','damage','destroy','impact','combo10','combo25','combo50','combo100','squad','stage','warning','bossEnter','bossHit','awakening','final','bossDestroy','complete','over'];
  for(const sound of sounds)for(const v of soundVoices(sound)){expect(v.duration).toBeGreaterThan(.008);expect(v.at+v.duration).toBeLessThan(3);expect(v.gain).toBeLessThanOrEqual(.36);expect(v.frequency).toBeLessThan(2000);expect(Object.values(v).filter(x=>typeof x==='number').every(Number.isFinite)).toBe(true);}
 });
});
describe('separate synthesis and mix persistence',()=>{
 it('bounds rapid-fire polyphony, stops queued tails and uses a compressor without touching CW',async()=>{
  const sources:{stop:ReturnType<typeof vi.fn>}[]=[],compressors:unknown[]=[];
  const parameter=()=>({value:0,setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn(),setTargetAtTime:vi.fn()});
  const node=()=>({connect:vi.fn(),disconnect:vi.fn()});
  const c={currentTime:0,state:'running',sampleRate:1000,destination:{},resume:vi.fn(async()=>{}),close:vi.fn(async()=>{}),createGain:()=>({...node(),gain:parameter()}),createDynamicsCompressor:()=>{const limiter={...node(),threshold:parameter(),knee:parameter(),ratio:parameter(),attack:parameter(),release:parameter()};compressors.push(limiter);return limiter;},createBuffer:()=>({getChannelData:()=>new Float32Array(2000)}),createBiquadFilter:()=>({...node(),frequency:parameter()}),createOscillator:()=>{const n={...node(),frequency:parameter(),start:vi.fn(),stop:vi.fn(),onended:null};sources.push(n);return n;},createBufferSource:()=>{const n={...node(),start:vi.fn(),stop:vi.fn(),onended:null};sources.push(n);return n;}};
  const se=new GameSE(()=>c as unknown as AudioContext);await se.unlock();
  for(let i=0;i<100;i++)se.play('launch');expect(sources).toHaveLength(200);expect(sources.filter(s=>s.stop.mock.calls.length===1)).toHaveLength(32);expect(compressors).toHaveLength(1);
  se.stop();expect(sources.every(s=>s.stop.mock.calls.length===2)).toBe(true);
  se.setVolume(0);se.play('impact');expect(sources).toHaveLength(200);se.dispose();expect(c.close).toHaveBeenCalledOnce();
 });
 it('saves each independent volume and safely handles malformed or unavailable storage',()=>{
  const map=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>map.get(k),setItem:(k:string,v:string)=>map.set(k,v)});
  expect(readMix()).toEqual(DEFAULT_MIX);saveMix({cw:.8,bgm:.4,se:.7});expect(readMix()).toEqual({cw:.8,bgm:.4,se:.7});
  map.set(MIX_KEY,'{"cw":9,"bgm":-1,"se":"wrong"}');expect(readMix()).toEqual({cw:1,bgm:0,se:.65});
  map.set(MIX_KEY,'bad');expect(readMix()).toEqual(DEFAULT_MIX);
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error();},setItem:()=>{throw Error();}});expect(readMix()).toEqual(DEFAULT_MIX);expect(()=>saveMix(DEFAULT_MIX)).not.toThrow();
 });
});
