import {describe,it,expect} from 'vitest';
import {advanceGame,answerAttack,beginTransmission,buildingAt,canAnswer,cityHp,createGame,createBossGame,enemyPosition,nextAttack,oldestAttack,transmittingAttack,pauseGame,resumeAttack,type GuardGame} from './cwGuard';
import {buildMorseTimeline} from '../timing';
import {DEFAULT_SETTINGS} from '../storage';
import {LASER_SPEED} from './laser';
const timeline=(symbol:string,wpm:number)=>buildMorseTimeline(symbol,'international',{...DEFAULT_SETTINGS,characterSpeed:wpm,effectiveSpeed:wpm});
function ready(boss=false){const g=boss?createBossGame('expert',73):nextAttack(createGame('beginner',true,73));return advanceGame(g,g.arrivalUntil);}
function emit(g:GuardGame,symbol?:string,wpm?:number,x?:number,preRoll=0){
 const tx=transmittingAttack(g)!;
 g=advanceGame(g,Math.max(g.time,tx.readyAt));
 const a={...transmittingAttack(g)!,symbol:symbol??tx.symbol,wpm:wpm??tx.wpm};
 if(symbol)g={...g,squadChoices:[...new Set([symbol,...g.squadChoices])].slice(0,4)};
 g={...g,attacks:g.attacks.map(b=>b.id===a.id?{...a,window:Math.max(a.window,timeline(a.symbol,a.wpm).duration)}:b)};
 const p=enemyPosition(g,g.drones.find(d=>d.id===a.enemy)!);
 return beginTransmission(g,a.id,timeline(a.symbol,a.wpm),g.time+preRoll,x??p.x,p.y+(g.boss?52:32));
}
describe('city reachability and last-tone input',()=>{
 it('has substantial reachable footprints at both edges and all nine buildings, even with reduced motion',()=>{
  const g=ready();
  for(const reduced of [false,true]){
   const xs=Array.from({length:1000},(_,i)=>g.drones.slice(12).map(d=>enemyPosition(g,d,i*.05,reduced).x)).flat();
   expect(Math.min(...xs)).toBeCloseTo(60,1);expect(Math.max(...xs)).toBeCloseTo(536,1);
   for(const b of g.buildings)expect(xs.filter(x=>buildingAt(g.buildings,x)?.id===b.id).length).toBeGreaterThan(10);
  }
  expect(buildingAt(g.buildings,65)?.id).toBe(0);expect(buildingAt(g.buildings,520)?.id).toBe(8);expect(buildingAt(g.buildings,71)).toBeUndefined();
 });
 it.each([73,12345,987654])('natural no-input play (%s) damages every building and ends without an immortal last building',seed=>{
  let g=nextAttack(createGame('beginner',true,seed));const fired:number[]=[];
  for(let i=0;i<20000&&g.phase!=='over';i++){
   g=advanceGame(g,g.time+.05);
   const a=transmittingAttack(g);
   if(a?.status==='preparing'&&g.time>=a.readyAt){g=emit(g);fired.push(transmittingAttack(g)!.x);}
  }
  expect(g.phase).toBe('over');expect(cityHp(g)).toBe(0);expect(g.buildings.every(b=>b.hp===0)).toBe(true);
  for(const b of g.buildings)expect(fired.some(x=>buildingAt(g.buildings,x)?.id===b.id)).toBe(true);
 });
 it('hits each edge by actual bound X and keeps firing position fixed while sender moves',()=>{
  for(const [x,id] of [[65,0],[520,8]]){
   let g=emit(ready(),undefined,undefined,x);const a=oldestAttack(g)!;
   g={...g,buildings:g.buildings.map(b=>({...b,hp:b.id===id?1:0}))};
   const moving=advanceGame(g,g.time+1);expect(oldestAttack(moving)!.x).toBe(x);
   g=advanceGame(moving,a.impactAt!);expect(g.phase).toBe('over');expect(cityHp(g)).toBe(0);
  }
 });
 it('lets a sole building survive a gap hit, then ends when that building is hit',()=>{
  let g=emit(ready(),undefined,undefined,71);g={...g,buildings:g.buildings.map(b=>({...b,hp:b.id===0?1:0}))};
  g=advanceGame(g,oldestAttack(g)!.impactAt!);expect(cityHp(g)).toBe(1);expect(g.phase).not.toBe('over');
  g=advanceGame(g,Math.max(g.time,g.nextFireAt));g=emit(g,undefined,undefined,65);
  g=advanceGame(g,oldestAttack(g)!.impactAt!);expect(g.phase).toBe('over');
 });
 it.each(Array.from({length:33},(_,i)=>i+8))('%s WPM unlocks E/T/A/N/S/O at exactly the last tone onset, not the end/window',wpm=>{
  for(const symbol of ['E','T','A','N','S','O']){
   const g=emit(ready(),symbol,wpm,undefined,.08),a=oldestAttack(g)!,last=a.timeline!.tones.at(-1)!;
   expect(a.answerAt).toBeCloseTo(a.startedAt!+last.start,10);
   expect(canAnswer(advanceGame(g,a.answerAt!-1e-6))).toBe(false);
   const unlocked=advanceGame(g,a.answerAt!);expect(canAnswer(unlocked)).toBe(true);
   expect(unlocked.time).toBeLessThan(a.toneEndsAt!);expect(a.status).toBe('sending');
   const hit=answerAttack(unlocked,a.id,symbol);expect(hit.correct).toBe(1);expect(hit.transmittingId).toBeNull();expect(hit.attacks.some(b=>b.id===a.id)).toBe(false);
   expect(hit.nextFireAt).toBeGreaterThanOrEqual(a.sendEndsAt!);
   expect(a.impactAt!-a.startedAt!).toBeCloseTo((318-a.y)/LASER_SPEED);
   if(symbol==='E'||symbol==='T')expect(a.answerAt).toBe(a.startedAt);
  }
 });
 it('wrong last-tone shots retain the transmitter, FIFO and cooldown; an early success cannot deadlock serial sends',()=>{
  let g=emit(ready(),'A',20),a=oldestAttack(g)!;g=advanceGame(g,a.answerAt!);
  const wrong=answerAttack(g,a.id,g.squadChoices.find(c=>c!==a.symbol)!);
  expect(wrong.transmittingId).toBe(a.id);expect(wrong.ammo).toBe(g.ammo-1);expect(wrong.combo).toBe(0);
  expect(answerAttack(wrong,a.id,a.symbol).correct).toBe(0);
  const hit=answerAttack(wrong,a.id,a.symbol,wrong.retryUntil);expect(hit.correct).toBe(1);
  const next=advanceGame(hit,hit.nextFireAt);expect(transmittingAttack(next)?.status).toBe('preparing');expect(transmittingAttack(next)?.id).not.toBe(a.id);
 });
 it('cannot skip the FIFO head during a later last tone and does not cancel that unrelated transmitter',()=>{
  let g=emit(ready(),'A',20),a=oldestAttack(g)!;g=advanceGame(g,a.sendEndsAt!);g=advanceGame(g,g.nextFireAt);g=emit(g,'N',20);
  const later=transmittingAttack(g)!;g=advanceGame(g,later.answerAt!);
  expect(answerAttack(g,later.id,later.symbol).attempts).toBe(0);
  const hit=answerAttack(g,a.id,a.symbol);expect(hit.correct).toBe(1);expect(transmittingAttack(hit)?.id).toBe(later.id);
 });
 it('reset/replay recomputes last tone onset and cannot answer during paused or pre-roll states',()=>{
  let g=emit(ready(),'S',30),a=oldestAttack(g)!;
  const paused=pauseGame(g);expect(canAnswer(paused)).toBe(false);
  const resumed=resumeAttack(paused);expect(oldestAttack(resumed)?.answerAt).toBeNull();expect(canAnswer(resumed)).toBe(false);
  g=emit(resumed);a=oldestAttack(g)!;expect(a.answerAt).toBeCloseTo(a.startedAt!+a.timeline!.tones.at(-1)!.start);
 });
 it('ends empty-ammo play with a surviving city, but finishes an already successful missile before ending',()=>{
  let g=emit(ready(),'E',20);g=advanceGame(g,oldestAttack(g)!.answerAt!);
  expect(nextAttack({...g,ammo:0}).phase).toBe('over');
  g=answerAttack({...g,ammo:1},oldestAttack(g)!.id,'E');expect(g.ammo).toBe(0);expect(g.phase).toBe('active');
  expect(advanceGame(g,g.time+.54).phase).toBe('active');expect(advanceGame(g,g.time+.55).phase).toBe('over');
 });
 it('last bullet clearing a wave permits next-wave supply, while total city destruction takes priority',()=>{
  let g=emit(ready(),'E',20),a=oldestAttack(g)!;
  g={...g,ammo:1,drones:g.drones.map(d=>({...d,alive:d.id===a.enemy,hp:d.id===a.enemy?1:0}))};
  g=answerAttack(g,a.id,'E',a.answerAt!);expect(g.phase).not.toBe('over');expect(advanceGame(g,g.time+1.1).phase).toBe('clear');
  expect(nextAttack({...g,buildings:g.buildings.map(b=>({...b,hp:0}))}).phase).toBe('over');
 });
 it('last bullet at HP50 earns awakening supply after safe CW completion; unreachable future supply cannot keep play alive',()=>{
  let g=emit(ready(true),'E',30),a=oldestAttack(g)!;
  g={...g,ammo:1,drones:g.drones.map(d=>({...d,hp:51})),boss:{...g.boss!,keyTier:1}};
  g=answerAttack(g,a.id,'E',a.answerAt!);expect(g.ammo).toBe(0);expect(g.phase).toBe('active');
  g=advanceGame(g,a.toneEndsAt!);expect(g.phase).toBe('awakening');expect(g.ammo).toBe(10);
  const impossible={...ready(true),ammo:0,drones:ready(true).drones.map(d=>({...d,hp:51})),boss:{...ready(true).boss!,keyTier:1}};
  expect(nextAttack(impossible).phase).toBe('over');
 });
});
