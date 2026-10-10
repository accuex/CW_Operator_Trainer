import type { GuardGame } from './cwGuard';
import type { Preset } from './presets';
export type GameEventKind='started'|'stage_cleared'|'boss_awakened'|'boss_defeated'|'completed'|'game_over'|'interception';
export interface GameEvidence {
  id:string; game:'cw-guard'; runId:string; kind:GameEventKind; recordedAt:string;
  stage:number; wpm:number; preset:Preset; score:number; combo:number; maxCombo:number; correct:number; attempts:number; hints:boolean; practice:boolean;
}
export interface GameAchievementDefinition {
  id:`cw-guard:${string}`; game:'cw-guard'; accepts:(e:GameEvidence)=>boolean;
}
// No approved game rewards exist yet. Ordinary learning/card visibility never calls this evaluator.
export const GAME_ACHIEVEMENTS:readonly GameAchievementDefinition[]=[];
export const GAME_EVIDENCE_KEY='cwot:arcade:guard:evidence:v1';
export function transitionEvidence(previous:GuardGame|null,next:GuardGame|null,recordedAt=new Date().toISOString()):GameEvidence[]{
  if(!next)return [];
  const fresh=previous?.runId!==next.runId,kinds:GameEventKind[]=[];
  if(fresh) kinds.push('started');
  if(!fresh&&next.correct>previous.correct)kinds.push('interception');
  if(['intermission','warning'].includes(next.phase)&&previous?.phase!==next.phase)kinds.push('stage_cleared');
  if(next.phase==='awakening'&&previous?.phase!==next.phase)kinds.push('boss_awakened');
  if(next.phase==='defeating'&&previous?.phase!==next.phase)kinds.push('boss_defeated');
  if(next.phase==='clear'&&previous?.phase!==next.phase&&next.boss&&next.drones[0].hp===0)kinds.push('completed');
  if(next.phase==='over'&&previous?.phase!==next.phase)kinds.push('game_over');
  return kinds.map(kind=>({id:`${next.runId}:${kind}:${next.stage}:${kind==='interception'?next.correct:0}`,game:'cw-guard',runId:next.runId,kind,recordedAt,
    stage:next.stage,wpm:next.wpm,preset:next.preset,score:next.score,combo:next.combo,maxCombo:next.maxCombo,correct:next.correct,attempts:next.attempts,hints:next.scoreHints,practice:next.bossOnly}));
}
/** Explicitly game-only; records and unlocks never touch TrainerProfile or card visibility. */
export function evaluateGameAchievements(events:readonly GameEvidence[],definitions:readonly GameAchievementDefinition[],already:readonly string[]=[]):string[]{
  return [...new Set(definitions.filter(d=>d.game==='cw-guard'&&d.id.startsWith('cw-guard:')&&!already.includes(d.id)&&events.some(e=>e.game===d.game&&!e.practice&&d.accepts(e))).map(d=>d.id))];
}
export function recordGameTransition(previous:GuardGame|null,next:GuardGame|null){
  const events=transitionEvidence(previous,next);if(!events.length)return;
  try{
    const parsed=JSON.parse(localStorage.getItem(GAME_EVIDENCE_KEY)??'[]');
    const existing:GameEvidence[]=Array.isArray(parsed)?parsed.filter(e=>e&&typeof e.id==='string'&&e.game==='cw-guard'):[];
    const ids=new Set(existing.map(e=>e.id));
    localStorage.setItem(GAME_EVIDENCE_KEY,JSON.stringify([...existing,...events.filter(e=>!ids.has(e.id))].slice(-200)));
  }catch{/* Guests, storage-full and private browsing keep playing. Local records are not official certificates. */}
}
