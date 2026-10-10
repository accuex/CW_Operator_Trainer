import {describe,it,expect,vi} from 'vitest';
import {advanceGame,answerAttack,beginTransmission,bossDrone,BOSS_BONUS,canAnswer,cityHp,createGame,createBossGame,nextAttack,nextStage,oldestAttack,pauseGame,resumeAttack,transmittingAttack,enemyPosition,saveBest,readBest,type GuardGame} from './cwGuard';
import {buildMorseTimeline} from '../timing';
import {DEFAULT_SETTINGS} from '../storage';
import {LASER_SPEED} from './laser';
const tx=(g:GuardGame)=>{const a=transmittingAttack(g)!;g=advanceGame(g,Math.max(g.time,a.readyAt));const p=enemyPosition(g,g.drones.find(d=>d.id===a.enemy)!);return beginTransmission(g,a.id,buildMorseTimeline(a.symbol,'international',{...DEFAULT_SETTINGS,characterSpeed:a.wpm,effectiveSpeed:a.wpm}),g.time,p.x,p.y+(g.boss?52:32));};
function boss(mode:'beginner'|'standard'|'expert'='expert'){const g=createBossGame(mode,73);return advanceGame(g,g.arrivalUntil);}
const flying=(g:GuardGame)=>{g=tx(g);return advanceGame(g,transmittingAttack(g)!.sendEndsAt!);};
const hit=(g:GuardGame)=>{const a=oldestAttack(g)!;return answerAttack(g,a.id,a.symbol,Math.max(g.time,g.retryUntil));};
function step(g:GuardGame):GuardGame{
 if(g.phase==='entering') return advanceGame(g,g.arrivalUntil);
 if(g.phase==='awakening'||g.phase==='rekeying') return advanceGame(g,g.boss!.transitionUntil!);
 if(g.phase==='defeating') return advanceGame(g,g.boss!.defeatedAt!+3);
 if(canAnswer(g)) return hit(g);
 if(transmittingAttack(g)?.status==='preparing') return tx(g);
 const a=transmittingAttack(g);if(a?.sendEndsAt!=null) return advanceGame(g,a.sendEndsAt);
 return advanceGame(g,Math.max(g.time+.31,g.nextFireAt));
}
describe('enemy endurance and SIGNAL MASTER',()=>{
 it('uses difficulty HP and supplies enough normal ammunition for every required hit',()=>{
  for(const mode of ['beginner','standard','expert'] as const){
   const g=createGame(mode,true,73),range=mode==='beginner'?[1]:mode==='standard'?[1,2]:[2,3];
   expect([...new Set(g.drones.map(d=>d.maxHp))]).toEqual(range);
   expect(g.ammo).toBe(g.drones.reduce((n,d)=>n+d.hp,0)+8);
   expect(nextStage({...g,phase:'clear'}).ammo).toBe(nextStage({...g,phase:'clear'}).drones.reduce((n,d)=>n+d.hp,0)+8);
  }
 });
 it('correct hits cancel a beam but retain HP enemies, wrong answers cause no enemy damage',()=>{
  let g=nextAttack(createGame('expert',true,73));g=advanceGame(g,g.arrivalUntil);g=flying(g);
  const a=oldestAttack(g)!,enemy=g.drones.find(d=>d.id===a.enemy)!;
  const wrong=answerAttack(g,a.id,g.squadChoices.find(c=>c!==a.symbol)!,g.time);
  expect(wrong.drones).toEqual(g.drones);expect(wrong.attacks.some(b=>b.id===a.id)).toBe(true);
  g=hit(g);expect(g.drones.find(d=>d.id===enemy.id)).toMatchObject({hp:enemy.hp-1,alive:true});expect(g.combo).toBe(1);expect(g.attacks.some(b=>b.id===a.id)).toBe(false);
 });
 it('chooses letters per attack from fixed keys, including repeat attacks by a survivor',()=>{
  let g=nextAttack(createGame('expert',true,73));g=advanceGame(g,g.arrivalUntil);
  const sender=oldestAttack(g)!.enemy;g={...g,drones:g.drones.map(d=>d.row===g.squadRow&&d.id!==sender?{...d,alive:false,hp:0}:d)};
  const keys=[...g.squadChoices],symbols=[];
  while(g.drones.find(d=>d.id===sender)!.alive){g=flying(g);const a=oldestAttack(g)!;symbols.push(a.symbol);expect(keys).toContain(a.symbol);g=hit(g);expect(g.squadChoices).toEqual(keys);g=advanceGame(g,Math.max(g.time+.31,g.nextFireAt));}
  expect(symbols.length).toBeGreaterThanOrEqual(2);expect(new Set(symbols).size).toBeGreaterThan(1);
  expect(g.drones.find(d=>d.id===sender)?.hp).toBe(0);
 });
 it('starts HP100 after wave3 and supports an independent local-only boss practice',()=>{
  const regular=nextStage({...createGame('beginner',true,73),stage:3,phase:'clear',score:1234});
  expect(regular.stage).toBe(4);expect(regular.score).toBe(1234);expect(regular.bossOnly).toBe(false);
  const g=createBossGame('expert',73);expect(g.bossOnly).toBe(true);expect(g.drones).toHaveLength(1);expect(bossDrone(g)).toMatchObject({hp:100,maxHp:100});expect(g.ammo).toBe(140);expect(g.hints).toBe(false);expect(cityHp(g)).toBe(27);
 });
 it('keeps serial audio, multiple boss flights and strict FIFO even for the same source',()=>{
  let g=flying(boss());const a=oldestAttack(g)!;g=advanceGame(g,g.nextFireAt);g=flying(g);const b=g.attacks[1];
  expect(b.enemy).toBe(a.enemy);expect(b.startedAt!).toBeGreaterThanOrEqual(a.sendEndsAt!);expect(g.attacks).toHaveLength(2);
  const hp=bossDrone(g)!.hp;expect(answerAttack(g,b.id,b.symbol,g.time).correct).toBe(0);
  const wrong=answerAttack(g,a.id,b.symbol,g.time);expect(bossDrone(wrong)!.hp).toBe(hp);expect(oldestAttack(wrong)?.id).toBe(a.id);
  const done=hit(g);expect(bossDrone(done)!.hp).toBe(hp-1);expect(done.attacks.some(x=>x.id===b.id)).toBe(true);
  expect(a.impactAt!-a.startedAt!).toBeCloseTo((318-a.y)/LASER_SPEED);
 });
 it('applies spread as one answer event, clears all beams on one hit and bounds per-building impact',()=>{
  let g=boss();g={...g,boss:{...g.boss!,sequence:3},attacks:[],transmittingId:null,nextFireAt:g.time};g=flying(nextAttack(g));
  const a=oldestAttack(g)!;expect(a.pattern).toBe('spread');expect(a.beamOffsets).toEqual([-64,0,64]);
  const done=hit(g);expect(bossDrone(done)!.hp).toBe(99);expect(done.correct).toBe(1);expect(done.attacks.some(b=>b.id===a.id)).toBe(false);
  const impact=advanceGame(g,a.impactAt!);for(const b of impact.buildings)expect(3-b.hp).toBeLessThanOrEqual(1);
  expect(advanceGame(impact,impact.time).buildings).toEqual(impact.buildings);
 });
 it('waits for pending CW/flights before awakening or changing keys; resumes transition safely',()=>{
  let g=flying(boss());g=advanceGame(g,g.nextFireAt);g=tx(g);const originalKeys=[...g.squadChoices],later=g.attacks[1];
  g={...g,drones:g.drones.map(d=>({...d,hp:51})),boss:{...g.boss!,keyTier:1}};
  g=hit(g);expect(bossDrone(g)!.hp).toBe(50);expect(g.phase).toBe('active');expect(g.squadChoices).toEqual(originalKeys);expect(transmittingAttack(g)?.id).toBe(later.id);
  g=advanceGame(g,later.sendEndsAt!);expect(g.attacks).toHaveLength(1);g=hit(g);
  expect(g.phase).toBe('awakening');expect(g.boss?.awakened).toBe(true);expect(g.attacks).toEqual([]);expect(g.transmittingId).toBeNull();
  const ammo=g.ammo;g=resumeAttack(pauseGame(g));expect(g.phase).toBe('awakening');expect(g.ammo).toBe(ammo);
  g=advanceGame(g,g.boss!.transitionUntil!);expect(g.boss?.form).toBe('awakened');expect(g.boss?.keyTier).toBe(2);expect(g.squadChoices).not.toEqual(originalKeys);
  expect(nextAttack(g).phase).not.toBe('awakening');expect(g.ammo).toBe(ammo);
 });
 it.each(['beginner','standard','expert'] as const)('%s completes exactly100 hits, one awakening, final10, bonus once and no ammo starvation',mode=>{
  let g=createBossGame(mode,73),awakeCount=0,lastPhase=g.phase,guard=0;const patterns=new Set<string>();const speeds=new Set<number>();
  while(g.phase!=='clear'&&guard++<1500){
   const a=transmittingAttack(g);if(a){patterns.add(a.pattern);speeds.add(a.wpm);}
   g=step(g);if(g.phase==='awakening'&&lastPhase!=='awakening')awakeCount++;lastPhase=g.phase;
   if(bossDrone(g)!.hp<=10&&bossDrone(g)!.hp>0)expect(g.boss?.form).toBe('final');
   expect(g.ammo).toBeGreaterThan(0);
  }
  expect(g.phase).toBe('clear');expect(g.correct).toBe(100);expect(bossDrone(g)!.hp).toBe(0);expect(awakeCount).toBe(1);expect(g.boss?.finalSupply).toBe(true);expect(g.ammo).toBe(60);expect(patterns).toEqual(new Set(['single','double','charge','spread','triple','rapid']));
  const total=g.resolved.at(-1)?.attack;expect(g.score).toBeGreaterThan(BOSS_BONUS);expect(g.attacks).toEqual([]);expect(g.transmittingId).toBeNull();expect(nextStage(g)).toBe(g);expect(advanceGame(g,g.time+20).score).toBe(g.score);
  expect(speeds.size).toBeLessThanOrEqual(mode==='expert'?3:1);
 });
 it('defeat cancels future beams and holds still; paused defeat neither advances nor awards another bonus',()=>{
  let g=flying(boss());g=advanceGame(g,g.nextFireAt);g=flying(g);g={...g,drones:g.drones.map(d=>({...d,hp:1})),boss:{...g.boss!,form:'final',keyTier:3,awakened:true,finalSupply:true}};
  const previous=g.score;g=hit(g);expect(g.phase).toBe('defeating');expect(g.score-previous).toBeGreaterThan(BOSS_BONUS);expect(g.attacks).toEqual([]);
  const p=enemyPosition(g,bossDrone(g)!);expect(enemyPosition(g,bossDrone(g)!,g.time+2)).toEqual(p);
  const stopped=pauseGame(g);expect(advanceGame(stopped,999)).toBe(stopped);g=resumeAttack(stopped);expect(g.phase).toBe('defeating');g=advanceGame(g,g.boss!.defeatedAt!+3);expect(g.phase).toBe('clear');
 });
 it('does not change keys while milestone flights remain and wrong shots do not trigger transitions',()=>{
  let g=flying(boss());g={...g,drones:g.drones.map(d=>({...d,hp:76}))};const keys=[...g.squadChoices];
  const wrong=answerAttack(g,oldestAttack(g)!.id,g.squadChoices.find(c=>c!==oldestAttack(g)!.symbol)!,g.time);expect(wrong.boss?.keyTier).toBe(0);expect(bossDrone(wrong)!.hp).toBe(76);
  g=hit(g);expect(g.phase).toBe('rekeying');expect(g.squadChoices).toEqual(keys);expect(g.attacks).toEqual([]);
  g=advanceGame(g,g.boss!.transitionUntil!);expect(g.squadChoices).not.toEqual(keys);expect(g.boss?.keyTier).toBe(1);
 });
 it('can threaten every building from legitimate moving wing emitters without cropping the boss',()=>{
  const g=boss(),awake={...g,boss:{...g.boss!,form:'awakened' as const}};
  const xs=Array.from({length:1000},(_,i)=>enemyPosition(awake,bossDrone(awake)!,i*.1).x);
  expect(Math.min(...xs)).toBeGreaterThan(100);expect(Math.max(...xs)).toBeLessThan(500);
  for(const b of g.buildings)expect(xs.some(x=>[-64,0,64].some(dx=>x+dx>=b.x&&x+dx<b.x+b.width))).toBe(true);
 });
 it('separates boss-practice highscores from existing normal records',()=>{
  let raw='{}';vi.stubGlobal('localStorage',{getItem:()=>raw,setItem:(_:string,s:string)=>raw=s});
  const normal=createGame('beginner',false,73),practice=createBossGame('beginner',73);
  saveBest({...normal,score:900});saveBest({...practice,score:4000});expect(readBest('beginner',false)).toBe(900);expect(readBest('beginner',false,true)).toBe(4000);vi.unstubAllGlobals();
 });
});
