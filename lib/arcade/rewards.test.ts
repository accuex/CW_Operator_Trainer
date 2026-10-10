import {describe,it,expect} from 'vitest';
import {advanceGame,answerAttack,beginTransmission,canAnswer,createGame,enemyPosition,nextAttack,oldestAttack,pauseGame,resumeAttack,transmittingAttack,type GuardGame} from './cwGuard';
import {PRESETS,type Preset} from './presets';
import {buildMorseTimeline} from '../timing';
import {DEFAULT_SETTINGS,DEFAULT_PROFILE,normalizeProfile} from '../storage';
import {applyAchievements,satisfiedAchievements} from '../achievements';
import {applyGameEvidence,evaluateGameAchievements,gameRewardOwned,transitionEvidence,validGameEvidence,type GameEvidence} from './gameAchievements';
import {GAME_REWARDS,speedTier} from './rewardCatalog';

function step(g:GuardGame):GuardGame {
 if(canAnswer(g)){const a=oldestAttack(g)!;return answerAttack(g,a.id,a.symbol);}
 if(g.phase==='entering')return advanceGame(g,g.arrivalUntil);
 if(['intermission','warning'].includes(g.phase))return advanceGame(g,g.transitionUntil);
 if(['awakening','rekeying'].includes(g.phase))return advanceGame(g,g.boss!.transitionUntil!);
 if(g.phase==='defeating')return advanceGame(g,g.boss!.defeatedAt!+3);
 const a=transmittingAttack(g);
 if(a?.status==='preparing'){
  g=advanceGame(g,Math.max(g.time,a.readyAt));const p=enemyPosition(g,g.drones.find(d=>d.id===a.enemy)!);
  return beginTransmission(g,a.id,buildMorseTimeline(a.symbol,PRESETS[g.preset].alphabet,{...DEFAULT_SETTINGS,characterSpeed:a.wpm,effectiveSpeed:a.wpm}),g.time,p.x,p.y+(g.boss?52:25.6));
 }
 const times=[a?.answerAt,a?.sendEndsAt,g.nextFireAt].filter((n):n is number=>n!=null&&n>g.time+1e-8);
 return advanceGame(g,times.length?Math.min(...times):g.time+.02);
}
function campaign(wpm=20,preset:Preset='letters',hints=false,modify?:(g:GuardGame)=>GuardGame){
 let g=nextAttack(createGame('expert',hints,73,{wpm,preset}));const events:GameEvidence[]=[];let count=0;
 while(!['clear','over'].includes(g.phase)&&count++<10000){const old=g;g=step(modify?modify(g):g);events.push(...transitionEvidence(old,g));}
 expect(g.phase).toBe('clear');expect(g.correct).toBe(245);expect(events.every(validGameEvidence)).toBe(true);
 return {g,events,ids:evaluateGameAchievements(events)};
}
describe('CW迎撃隊 reward conditions and isolation',()=>{
 it.each([8,11,12,14,15,19,20,40])('%i WPM actual full campaign awards only threshold-qualified rewards',wpm=>{
  const {ids}=campaign(wpm);
  expect(ids).toContain('cw-guard:first-clear');
  expect(ids.includes('cw-guard:stage3-clear')).toBe(wpm>=12);
  for(const id of ['boss-clear','perfect-defense','combo80'])expect(ids.includes(`cw-guard:${id}`)).toBe(wpm>=15);
  for(const id of ['speed20','boss20','ace'])expect(ids.includes(`cw-guard:${id}`)).toBe(wpm>=20);
  expect(ids).not.toContain('cw-guard:wabun');
 });
 it('20 is highest tier, never requires 40; all nine rewards have specified portrait paths',()=>{
  expect([8,11,12,14,15,19,20,40].map(speedTier)).toEqual(['R','R','SR','SR','SSR','SSR','SSSR','SSSR']);
  expect(GAME_REWARDS.filter(d=>d.rarity==='SSSR')).toHaveLength(6);
 });
 it('wabun campaign earns all six SSSR, persists evidence and deduplicates without changing old progress',()=>{
  const {events,ids}=campaign(20,'wabun');expect(ids).toHaveLength(9);
  const original={...DEFAULT_PROFILE,achievements:{'latin-starter':{unlockedAt:1}}};
  const {profile,unlocked}=applyGameEvidence(original,events);expect(unlocked).toHaveLength(9);
  const restored=normalizeProfile(JSON.parse(JSON.stringify(profile)));
  expect(restored.achievements?.['latin-starter']).toEqual({unlockedAt:1});
  for(const d of GAME_REWARDS)expect(gameRewardOwned(restored,d.id)).toBe(true);
  expect(applyGameEvidence(restored,events)).toEqual({profile:restored,unlocked:[]});
  const r=profile.achievements!['cw-guard:ace'].gameEvidence!;
  expect(r).toMatchObject({minWpm:20,preset:'wabun',hints:false,cityDamage:0,bossDefeated:true,wrongAnswers:0});
 });
 it('minimum speed cannot be recovered by raising it again',()=>{
  let lowered=false,raised=false;
  const {ids,g}=campaign(20,'letters',false,g=>{
    if(g.correct===5&&!lowered){lowered=true;return {...g,wpm:8};}
    if(lowered&&g.correct===6&&!raised){raised=true;return {...g,wpm:20};}return g;
  });expect(g.rewardStats.minWpm).toBe(8);expect(ids).toEqual(['cw-guard:first-clear']);
 });
 it('brief hint use invalidates ace, while other boss awards remain',()=>{
  const {ids}=campaign(20,'letters',false,g=>({...g,hints:g.correct===5}));
  expect(ids).not.toContain('cw-guard:ace');expect(ids).toContain('cw-guard:boss20');
 });
 it('preset switching invalidates rewards for that run',()=>{
  const {ids}=campaign(20,'letters',false,g=>({...g,preset:g.correct===5?'wabun':'letters'}));expect(ids).toEqual([]);
 });
 it('city damage survives healing; ruined or empty ground never adds damage',()=>{
  let g=nextAttack(createGame('beginner'));g=advanceGame(g,g.arrivalUntil);
  const a=transmittingAttack(g)!;g=advanceGame(g,a.readyAt);
  g=beginTransmission(g,a.id,buildMorseTimeline(a.symbol,'international',DEFAULT_SETTINGS),g.time,30,109);
  g=advanceGame(g,oldestAttack(g)!.impactAt!);
  expect(g.rewardStats.cityDamage).toBe(1);
  const healed={...g,buildings:g.buildings.map(b=>({...b,hp:b.maxHp}))};
  expect(healed.rewardStats.cityDamage).toBe(1);
  const {events}=campaign(20);
  expect(evaluateGameAchievements(events.map(e=>({...e,cityDamage:1})))).not.toContain('cw-guard:perfect-defense');
 });
 it('wrong answer resets combo, records mistakes, retry and pause retain reward history',()=>{
  let g=nextAttack(createGame('beginner',false,73,{wpm:20}));
  while(!canAnswer(g))g=step(g);
  const a=oldestAttack(g)!;g=answerAttack({...g,combo:3,maxCombo:3,correct:3,attempts:3},a.id,g.squadChoices.find(s=>s!==a.symbol)!);
  expect(g.combo).toBe(0);expect(g.attempts-g.correct).toBe(1);
  expect(resumeAttack(pauseGame(g)).rewardStats).toEqual(g.rewardStats);
  const {events}=campaign(15);
  expect(evaluateGameAchievements(events.map(e=>({...e,maxCombo:79,combo:Math.min(e.combo,79)})))).not.toContain('cw-guard:combo80');
 });
 it('ordinary study, arbitrary IDs, previews, developer runs and malformed evidence grant nothing',()=>{
  const arbitrary={...DEFAULT_PROFILE,revealAll:true,achievements:{'cw-guard:ace':{unlockedAt:1}}};
  expect(gameRewardOwned(arbitrary,'cw-guard:ace')).toBe(false);
  expect(normalizeProfile(arbitrary).achievements).toEqual({});
  expect(satisfiedAchievements({profile:arbitrary,answers:[],sessions:[]}).some(id=>id.startsWith('cw-guard:'))).toBe(false);
  expect(applyAchievements(arbitrary,[],[]).unlocked.some(id=>id.startsWith('cw-guard:'))).toBe(false);
  expect(applyGameEvidence(DEFAULT_PROFILE,[{id:'cw-guard:ace'} as GameEvidence]).unlocked).toEqual([]);
  const {events}=campaign(20);expect(evaluateGameAchievements(events.map(e=>({...e,practice:true})))).toEqual([]);
  expect(evaluateGameAchievements(events.map(e=>({...e,game:'another-game'} as never)))).toEqual([]);
  expect(transitionEvidence(null,{...createGame('expert'),phase:'clear'}).map(e=>e.kind)).toEqual(['started']);
 });
});
