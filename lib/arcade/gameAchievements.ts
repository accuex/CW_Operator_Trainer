import type { GuardGame } from './cwGuard';
import { PRESETS, type Preset } from './presets';
import { GAME_REWARDS, type GameRewardId, isGameReward } from './rewardCatalog';
import type { TrainerProfile } from '../types';
export type GameEventKind='started'|'stage_cleared'|'boss_awakened'|'boss_defeated'|'completed'|'game_over'|'interception';
export interface GameEvidence {
  id:string; game:'cw-guard'; runId:string; kind:GameEventKind; recordedAt:string;
  stage:number; wpm:number; minWpm:number; preset:Preset; presetChanged:boolean; score:number; combo:number; maxCombo:number; correct:number; attempts:number; wrongAnswers:number; hints:boolean; practice:boolean;
  cityDamage:number; stagesCleared:number[]; bossDefeated:boolean;
}
export interface GameAchievementDefinition {
  id:`cw-guard:${string}`; game:'cw-guard'; accepts:(e:GameEvidence)=>boolean;
}
const stage = (e: GameEvidence, n: number) => e.kind==='stage_cleared' && e.stage===n && e.stagesCleared.includes(n);
const boss = (e: GameEvidence) => ['boss_defeated','completed'].includes(e.kind) && e.bossDefeated && [1,2,3].every(n=>e.stagesCleared.includes(n));
const CONDITIONS: Record<GameRewardId, (e:GameEvidence)=>boolean> = {
  'cw-guard:first-clear': e=>e.minWpm>=8 && stage(e,1),
  'cw-guard:stage3-clear': e=>e.minWpm>=12 && stage(e,3),
  'cw-guard:boss-clear': e=>e.minWpm>=15 && boss(e),
  'cw-guard:speed20': e=>e.minWpm>=20 && stage(e,3),
  'cw-guard:boss20': e=>e.minWpm>=20 && boss(e),
  'cw-guard:perfect-defense': e=>e.minWpm>=15 && e.cityDamage===0 && boss(e),
  'cw-guard:combo80': e=>e.minWpm>=15 && e.kind==='interception' && e.maxCombo>=80,
  'cw-guard:wabun': e=>e.minWpm>=15 && e.preset==='wabun' && boss(e),
  'cw-guard:ace': e=>e.minWpm>=20 && !e.hints && boss(e),
};
export const GAME_ACHIEVEMENTS:readonly GameAchievementDefinition[]=GAME_REWARDS.map(d=>({id:d.id,game:'cw-guard',accepts:CONDITIONS[d.id]}));
export const GAME_EVIDENCE_KEY='cwot:arcade:guard:evidence:v1';
export function transitionEvidence(previous:GuardGame|null,next:GuardGame|null,recordedAt=new Date().toISOString()):GameEvidence[]{
  if(!next)return [];
  const fresh=previous?.runId!==next.runId,kinds:GameEventKind[]=[];
  if(fresh) kinds.push('started');
  else {
    if(next.correct>previous.correct)kinds.push('interception');
    if(['intermission','warning'].includes(next.phase)&&previous.phase!==next.phase)kinds.push('stage_cleared');
    if(next.phase==='awakening'&&previous.phase!==next.phase)kinds.push('boss_awakened');
    if(next.phase==='defeating'&&previous.phase!==next.phase)kinds.push('boss_defeated');
    if(next.phase==='clear'&&previous.phase!==next.phase&&next.boss&&next.drones[0].hp===0)kinds.push('completed');
    if(next.phase==='over'&&previous.phase!==next.phase)kinds.push('game_over');
  }
  return kinds.map(kind=>({id:`${next.runId}:${kind}:${next.stage}:${kind==='interception'?next.correct:0}`,game:'cw-guard',runId:next.runId,kind,recordedAt,
    stage:next.stage,wpm:next.wpm,minWpm:next.rewardStats.minWpm,preset:next.rewardStats.preset,presetChanged:next.rewardStats.presetChanged,
    score:next.score,combo:next.combo,maxCombo:next.maxCombo,correct:next.correct,attempts:next.attempts,wrongAnswers:next.attempts-next.correct,
    hints:next.rewardStats.hintsUsed,practice:next.bossOnly,cityDamage:next.rewardStats.cityDamage,stagesCleared:[...next.rewardStats.stagesCleared],bossDefeated:Boolean(next.boss&&next.drones[0].hp===0)}));
}
/** Structural/condition validation, not an authenticity proof against devtools edits. */
export function validGameEvidence(value: unknown): value is GameEvidence {
  if(!value||typeof value!=='object')return false;
  const e=value as GameEvidence;
  return e.game==='cw-guard' && typeof e.runId==='string' && e.runId.length>0 && e.runId.length<=128 &&
    ['started','stage_cleared','boss_awakened','boss_defeated','completed','game_over','interception'].includes(e.kind) &&
    e.id===`${e.runId}:${e.kind}:${e.stage}:${e.kind==='interception'?e.correct:0}` &&
    typeof e.recordedAt==='string' && Number.isFinite(Date.parse(e.recordedAt)) &&
    [e.stage,e.wpm,e.minWpm,e.score,e.combo,e.maxCombo,e.correct,e.attempts,e.wrongAnswers,e.cityDamage].every(n=>Number.isSafeInteger(n)&&n>=0) &&
    e.stage>=1&&e.stage<=4&&e.wpm>=8&&e.wpm<=40&&e.minWpm>=8&&e.minWpm<=e.wpm&&
    Object.hasOwn(PRESETS,e.preset)&&typeof e.presetChanged==='boolean'&&typeof e.hints==='boolean'&&typeof e.practice==='boolean'&&typeof e.bossDefeated==='boolean'&&
    e.maxCombo>=e.combo&&e.correct>=e.maxCombo&&e.attempts>=e.correct&&e.wrongAnswers===e.attempts-e.correct&&
    Array.isArray(e.stagesCleared)&&e.stagesCleared.length<=3&&new Set(e.stagesCleared).size===e.stagesCleared.length&&e.stagesCleared.every(n=>[1,2,3].includes(n))&&
    (!e.bossDefeated||e.stage===4);
}
export function evaluateGameAchievements(events:readonly GameEvidence[],definitions:readonly GameAchievementDefinition[]=GAME_ACHIEVEMENTS,already:readonly string[]=[]):string[]{
  return [...new Set(definitions.filter(d=>d.game==='cw-guard'&&isGameReward(d.id)&&!already.includes(d.id)&&events.some(e=>validGameEvidence(e)&&!e.practice&&!e.presetChanged&&d.accepts(e))).map(d=>d.id))];
}
/** Requires evidence satisfying this exact reward, not an arbitrary ID/unlockedAt. */
export function gameRewardOwned(profile: TrainerProfile, id: string): boolean {
  const progress=profile.achievements?.[id];
  return Boolean(progress && Number.isFinite(progress.unlockedAt)&&progress.unlockedAt>0&&progress.gameEvidence&&
    progress.unlockedAt===Date.parse(progress.gameEvidence.recordedAt)&&evaluateGameAchievements([progress.gameEvidence]).includes(id));
}
export function applyGameEvidence(profile: TrainerProfile, events: readonly GameEvidence[]): {profile:TrainerProfile;unlocked:GameRewardId[]} {
  const unlocked=evaluateGameAchievements(events,GAME_ACHIEVEMENTS,GAME_REWARDS.filter(d=>gameRewardOwned(profile,d.id)).map(d=>d.id)) as GameRewardId[];
  if(!unlocked.length)return {profile,unlocked};
  const achievements={...profile.achievements};
  for(const id of unlocked){
    const evidence=events.find(e=>evaluateGameAchievements([e]).includes(id))!;
    achievements[id]={unlockedAt:Date.parse(evidence.recordedAt),gameEvidence:{...evidence,stagesCleared:[...evidence.stagesCleared]}};
  }
  return {profile:{...profile,achievements},unlocked};
}
export function recordGameTransition(previous:GuardGame|null,next:GuardGame|null){
  const events=transitionEvidence(previous,next);if(!events.length)return events;
  try{
    const parsed=JSON.parse(localStorage.getItem(GAME_EVIDENCE_KEY)??'[]');
    const existing:GameEvidence[]=Array.isArray(parsed)?parsed.filter(validGameEvidence):[];
    const ids=new Set(existing.map(e=>e.id));
    localStorage.setItem(GAME_EVIDENCE_KEY,JSON.stringify([...existing,...events.filter(e=>!ids.has(e.id))].slice(-200)));
  }catch{/* Storage denial must never interrupt play. */}
  return events;
}
