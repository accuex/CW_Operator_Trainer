import {describe,it,expect} from 'vitest';
import {advanceGame,answerAttack,beginTransmission,canAnswer,createGame,enemyPosition,nextAttack,nextStage,oldestAttack,pauseGame,resumeAttack,squadDrones,transmittingAttack,type GuardGame} from './cwGuard';
import {PRESETS,type Preset,stageInterval} from './presets';
import {INTERNATIONAL_MORSE,WABUN_MORSE} from '../morse';
import {buildMorseTimeline} from '../timing';
import {DEFAULT_SETTINGS} from '../storage';
import {laserTravelSeconds,transmissionWindow} from './laser';
import {transitionEvidence} from './gameAchievements';
export function campaignStep(g:GuardGame):GuardGame{
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
describe('continuous CW defence campaign',()=>{
 it.each((Object.keys(PRESETS) as Preset[]).flatMap(preset=>[8,40].map(wpm=>({preset,wpm}))))('$preset / $wpm WPM completes STAGE1→2→3→WARNING→100HP boss with one awakening',({preset,wpm})=>{
  let g=nextAttack(createGame('beginner',true,73,{wpm,preset})),guard=0;
  const milestones:string[]=[],events= new Set<string>();const speeds=new Set<number>();
  while(g.phase!=='clear'&&g.phase!=='over'&&guard++<10000){
    const before=g;g=campaignStep(g);
    if(g.phase!==before.phase&&['warning','intermission','awakening','defeating','clear'].includes(g.phase))milestones.push(`${g.stage}:${g.phase}`);
    for(const e of transitionEvidence(before,g))expect(events.has(e.id)).toBe(false),events.add(e.id);
    for(const a of g.attacks){speeds.add(a.wpm);expect(PRESETS[preset].symbols).toContain(a.symbol);}
    if(g.phase==='entering'&&!g.boss)expect(squadDrones(g)).toHaveLength(5);
  }
  expect(g.phase).toBe('clear');expect(g.correct).toBe(245);expect(g.maxCombo).toBe(245);expect(g.attempts).toBe(245);expect(g.ammo).toBe(60);
  expect(milestones).toEqual(['1:intermission','2:intermission','3:warning','4:awakening','4:defeating','4:clear']);
  expect(speeds).toEqual(new Set([wpm]));expect(g.preset).toBe(preset);expect(g.boss?.form).toBe('final');expect(g.drones[0].hp).toBe(0);expect(g.attacks).toEqual([]);
 });
 it('same STAGE has identical HP and cadence at 8 and 40 WPM; 4 keys independent of 5–8 robots',()=>{
  for(const count of [5,6,8])for(const wpm of [8,40]){
    let g=createGame('expert',true,73,{wpm,enemiesPerSquad:count});
    for(let stage=1;stage<=3;stage++){
      expect(g.drones.every(d=>d.hp===stage&&d.maxHp===stage)).toBe(true);
      const ready=nextAttack(g);expect(squadDrones(ready)).toHaveLength(count);expect(ready.squadChoices).toHaveLength(4);
      expect(g.ammo).toBe(g.drones.length*stage+8);g=nextStage({...g,phase:'clear'});
    }
  }
  expect([1,2,3].map(stageInterval)).toEqual([1.8,.7,.18]);
 });
 it('only existing exact tables supply all four presets; no mixed alphabet, aliases or prosigns',()=>{
  expect(PRESETS.letters.symbols).toHaveLength(26);expect(PRESETS.alphanumeric.symbols).toHaveLength(36);
  for(const [id,p] of Object.entries(PRESETS))for(const symbol of p.symbols){
    const t=buildMorseTimeline(symbol,p.alphabet,{...DEFAULT_SETTINGS,characterSpeed:40,effectiveSpeed:40});
    expect(t.tones.map(t=>t.element).join('')).toBe((id==='wabun'?WABUN_MORSE:INTERNATIONAL_MORSE)[symbol]);
    expect(symbol).toHaveLength(1);
  }
  expect(PRESETS.wabun.symbols).toContain('ヰ');expect(PRESETS.wabun.symbols).not.toContain('┘');
  for(const wpm of [8,12,16,20,22,30,40])for(const p of Object.values(PRESETS))expect(transmissionWindow(p.symbols,wpm,p.alphabet)).toBeLessThan(laserTravelSeconds(145));
 });
 it('immediately accepts next FIFO head while multiple visible missiles still fly; wrong answers alone cool down',()=>{
  let g=nextAttack({...createGame('expert',true,73,{wpm:40}),stage:3});g=advanceGame(g,g.arrivalUntil);
  for(let i=0;i<3;i++){
    const a=transmittingAttack(g)!;g=advanceGame(g,a.readyAt);
    g=beginTransmission(g,a.id,buildMorseTimeline(a.symbol,'international',{...DEFAULT_SETTINGS,characterSpeed:40,effectiveSpeed:40}),g.time,150+i*100,109);
    g=advanceGame(g,transmittingAttack(g)!.sendEndsAt!);if(i<2)g=advanceGame(g,g.nextFireAt);
  }
  const ids=g.attacks.map(a=>a.id),time=g.time;
  for(const id of ids){expect(canAnswer(g)).toBe(true);const a=oldestAttack(g)!;g=answerAttack(g,id,a.symbol,time);}
  expect(g.correct).toBe(3);expect(g.shots.filter(s=>s.correct&&s.at===time)).toHaveLength(3);
  expect(g.attacks).toEqual([]);expect(answerAttack(g,ids[0],'A',time).correct).toBe(3);
 });
 it('freezes WARNING and resumes once without skipping the boss arrival or changing selected WPM',()=>{
  let g={...createGame('expert',false,73,{wpm:40,preset:'wabun'}),stage:3,phase:'warning' as const,transitionUntil:2.6,attacks:[],drones:[]};
  const paused=pauseGame(g);expect(advanceGame(paused,999)).toBe(paused);
  g=resumeAttack(paused) as typeof g;const boss=advanceGame(g,2.6);
  expect(boss.phase).toBe('entering');expect(boss.stage).toBe(4);expect(boss.drones[0].hp).toBe(100);expect(boss.wpm).toBe(40);expect(boss.preset).toBe('wabun');
  expect(advanceGame(boss,boss.arrivalUntil).phase).toBe('active');
 });
});
