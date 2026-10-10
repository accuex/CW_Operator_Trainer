import { INTERNATIONAL_MORSE } from '../morse';
import type { MorseTimeline } from '../types';
import { laserTravelSeconds, transmissionWindow } from './laser';

export type Difficulty = 'beginner' | 'standard' | 'expert';
export const MODES = {
  beginner: { label: '初級', wpm: 8, seconds: 9, interval: 1.8, pool: 'ETANIMSO', hints: true, factor: 1 },
  standard: { label: '中級', wpm: 15, seconds: 5.5, interval: .7, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', hints: false, factor: 1.6 },
  expert: { label: '上級', wpm: 24, seconds: 3.5, interval: .18, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', hints: false, factor: 2.3 },
} as const;
export interface Drone { id: number; row: number; column: number; symbol: string; alive: boolean }
export interface Building { id: number; x: number; width: number; height: number; hp: number; maxHp: number }
export interface Attack {
  id: number; order: number; enemy: number; symbol: string; wpm: number;
  x: number; y: number; readyAt: number; startedAt: number | null;
  toneEndsAt: number | null; sendEndsAt: number | null; impactAt: number | null;
  window: number; timeline: MorseTimeline | null; status: 'preparing'|'sending'|'flying';
}
export interface Resolution { attack: Attack; at: number; status: 'intercepted'|'impacted'; buildingId: number | null }
export interface Shot { id: number; attackId: number; enemy: number; at: number; selected: string; correct: boolean; points: number }
export type Phase = 'idle'|'entering'|'active'|'clear'|'over'|'paused';
export interface GuardGame {
  mode: Difficulty; hints: boolean; stage: number; seed: number; drones: Drone[]; buildings: Building[];
  phase: Phase; pausedFrom?: Phase; time: number; arrivalUntil: number; nextFireAt: number;
  squadRow: number | null; squadChoices: string[]; attackSerial: number; attacks: Attack[]; transmittingId: number | null;
  resolved: Resolution[]; shots: Shot[]; retryUntil: number; ammo: number; score: number; combo: number; maxCombo: number; correct: number; attempts: number;
  result: { correct: boolean; answer: string; selected: string | null; points: number; at: number; attackId: number } | null;
}
function random(seed: number): [number,number] {
  const next=(Math.imul(seed,1664525)+1013904223)>>>0;
  return [next/4294967296,next];
}
function shuffle<T>(input: readonly T[],seed: number): [T[],number] {
  const list=[...input];
  for(let i=list.length-1;i>0;i--){const [value,next]=random(seed);seed=next;const j=Math.floor(value*(i+1));[list[i],list[j]]=[list[j],list[i]];}
  return [list,seed];
}
function formation(mode: Difficulty,stage: number,seed: number): [Drone[],number] {
  const drones: Drone[]=[];let previous='';
  for(let row=0;row<(stage===1?4:5);row++){
    const [symbols,next]=shuffle([...MODES[mode].pool],seed);seed=next;
    if(symbols.slice(0,4).sort().join('')===previous) [symbols[3],symbols[4]]=[symbols[4],symbols[3]];
    previous=symbols.slice(0,4).sort().join('');
    for(let column=0;column<4;column++) drones.push({id:row*4+column,row,column,symbol:symbols[column],alive:true});
  }
  return [drones,seed];
}
/** City footprints use the same 600-unit logical world on every viewport. */
export function createCity(): Building[] {
  return [[22,39,38],[72,43,56],[128,38,44],[181,46,68],[243,34,39],[291,51,57],[358,43,45],[420,55,64],[494,64,42]]
    .map(([x,width,height],id)=>({id,x,width,height,hp:2,maxHp:2}));
}
export const buildingAt = (buildings: readonly Building[],x: number) => buildings.find(b=>x>=b.x && x<b.x+b.width);
export const cityHp = (game: GuardGame) => game.buildings.reduce((total,b)=>total+b.hp,0);
export const cityMaxHp = (game: GuardGame) => game.buildings.reduce((total,b)=>total+b.maxHp,0);
export const ARRIVAL_MS=850, CHARGE_MS=260, RETRY_SECONDS=.3;
export function createGame(mode: Difficulty,hints=MODES[mode].hints,seed=Date.now()>>>0): GuardGame {
  const [drones,next]=formation(mode,1,seed);
  return {mode,hints,stage:1,seed:next,drones,buildings:createCity(),phase:'idle',time:0,arrivalUntil:0,nextFireAt:0,
    squadRow:null,squadChoices:[],attackSerial:0,attacks:[],transmittingId:null,resolved:[],shots:[],retryUntil:0,
    ammo:drones.length+8,score:0,combo:0,maxCombo:0,correct:0,attempts:0,result:null};
}
export const oldestAttack = (game: GuardGame | null) => game?.attacks[0];
export const transmittingAttack = (game: GuardGame | null) => game?.attacks.find(a=>a.id===game.transmittingId);
export const canAnswer = (game: GuardGame | null) => Boolean(game?.phase==='active' && game.ammo>0 && game.time>=game.retryUntil && oldestAttack(game)?.status==='flying');
export function squadDrones(game: GuardGame): Drone[] {
  const row=game.squadRow??Math.max(...game.drones.filter(d=>d.alive).map(d=>d.row));
  return game.drones.filter(d=>d.row===row);
}
export const squadNumber = (game: GuardGame) => (game.stage===1?4:5)-(game.squadRow??(game.stage===1?3:4));
/** Starts only one transmission; an enemy cannot own two outstanding attacks. */
export function nextAttack(game: GuardGame): GuardGame {
  if(game.phase==='paused'||game.phase==='clear'||game.phase==='over') return game;
  if(game.ammo<=0 || cityHp(game)===0) return {...game,phase:'over',transmittingId:null,attacks:[]};
  if(game.transmittingId!==null) return game;
  const remaining=game.drones.filter(d=>d.alive);
  if(!remaining.length && !game.attacks.length) return game.resolved.some(r=>r.status==='intercepted'&&game.time-r.at<1)?game:{...game,phase:'clear'};
  if(game.phase==='entering') return game;
  const row=remaining.length?Math.max(...remaining.map(d=>d.row)):game.squadRow;
  if(row!==game.squadRow){
    if(game.attacks.length || game.resolved.some(r=>r.status==='intercepted'&&game.time-r.at<1)) return game;
    const [squadChoices,seed]=shuffle([...new Set(game.drones.filter(d=>d.row===row).map(d=>d.symbol))],game.seed);
    return {...game,seed,squadRow:row,squadChoices,phase:'entering',arrivalUntil:game.time+ARRIVAL_MS/1000,result:null};
  }
  if(game.time<game.nextFireAt) return game;
  const candidates=remaining.filter(d=>d.row===row && !game.attacks.some(a=>a.enemy===d.id));
  if(!candidates.length) return game;
  const [order,seed]=shuffle(candidates,game.seed), target=order[0];
  const id=game.attackSerial+1;
  const variation=game.mode==='expert'?((id-1)%3-1)*2:0;
  const wpm=MODES[game.mode].wpm+(game.stage-1)*2+variation;
  const attack: Attack={id,order:id,enemy:target.id,symbol:target.symbol,wpm,x:0,y:0,readyAt:game.time+CHARGE_MS/1000,
    startedAt:null,toneEndsAt:null,sendEndsAt:null,impactAt:null,window:transmissionWindow(MODES[game.mode].pool,wpm),timeline:null,status:'preparing'};
  return {...game,seed,phase:'active',attackSerial:id,transmittingId:id,attacks:[...game.attacks,attack]};
}
/** Bind exactly once to the actual Web Audio handle; firing position never follows the robot. */
export function beginTransmission(game: GuardGame,id: number,timeline: MorseTimeline,startedAt: number,x: number,y: number): GuardGame {
  const attack=game.attacks.find(a=>a.id===id);
  if(game.phase!=='active'||game.transmittingId!==id||attack?.status!=='preparing'||game.time<attack.readyAt) return game;
  if(![startedAt,x,y].every(Number.isFinite)||timeline.duration>attack.window+1e-6 || laserTravelSeconds(y)<=attack.window) return game;
  return {...game,attacks:game.attacks.map(a=>a.id===id?{...a,x,y,timeline,startedAt,
    toneEndsAt:startedAt+timeline.duration,sendEndsAt:startedAt+a.window,impactAt:startedAt+laserTravelSeconds(y),status:'sending'}:a)};
}
/** Resolve each physical impact once; empty ground and ruins never redirect damage. */
export function advanceGame(game: GuardGame,now: number): GuardGame {
  if(!['active','entering'].includes(game.phase)||!Number.isFinite(now)||now<game.time) return game;
  let g={...game,time:now,shots:game.shots.filter(s=>now-s.at<1.1),resolved:game.resolved.filter(r=>now-r.at<1.1)};
  if(g.phase==='entering') return now>=g.arrivalUntil?nextAttack({...g,phase:'active'}):g;
  const tx=transmittingAttack(g);
  if(tx?.sendEndsAt!==null && tx?.sendEndsAt!==undefined && now>=tx.sendEndsAt){
    g={...g,transmittingId:null,nextFireAt:tx.sendEndsAt+MODES[g.mode].interval,
      attacks:g.attacks.map(a=>a.id===tx.id?{...a,status:'flying' as const}:a)};
  }
  const impacts=g.attacks.filter(a=>a.impactAt!==null&&now>=a.impactAt);
  for(const attack of impacts){
    const hit=buildingAt(g.buildings,attack.x);
    g={...g,combo:0,attacks:g.attacks.filter(a=>a.id!==attack.id),
      buildings:g.buildings.map(b=>b.id===hit?.id?{...b,hp:Math.max(0,b.hp-1)}:b),
      resolved:[...g.resolved,{attack,at:attack.impactAt!,status:'impacted' as const,buildingId:hit?.id??null}],
      result:{correct:false,answer:attack.symbol,selected:null,points:0,at:now,attackId:attack.id}};
  }
  return nextAttack(g);
}
/** Input always names the observed FIFO head. Stale or later IDs never retarget a shot. */
export function answerAttack(game: GuardGame,id: number,selected: string,now=game.time): GuardGame {
  if(game.phase!=='active'||!Number.isFinite(now)||now<game.time) return game;
  const g=advanceGame(game,now), attack=oldestAttack(g);
  if(!canAnswer(g)||attack?.id!==id||!g.squadChoices.includes(selected)) return g;
  const correct=selected===attack.symbol,combo=correct?g.combo+1:0;
  const points=correct?Math.round(100*MODES[g.mode].factor*(attack.wpm/MODES[g.mode].wpm)*(1+Math.min(4,Math.floor(combo/4))*.25)*(g.hints?.75:1)):0;
  const shot: Shot={id:g.attempts+1,attackId:id,enemy:attack.enemy,at:now,selected,correct,points};
  const hit: GuardGame={...g,ammo:g.ammo-1,attempts:g.attempts+1,combo,maxCombo:Math.max(g.maxCombo,combo),score:g.score+points,correct:g.correct+Number(correct),
    retryUntil:now+RETRY_SECONDS,shots:[...g.shots,shot],
    drones:correct?g.drones.map(d=>d.id===attack.enemy?{...d,alive:false}:d):g.drones,
    attacks:correct?g.attacks.filter(a=>a.id!==id):g.attacks,
    resolved:correct?[...g.resolved,{attack,at:now,status:'intercepted',buildingId:null}]:g.resolved,
    result:{correct,answer:correct?attack.symbol:'',selected,points,at:now,attackId:id}};
  return nextAttack(hit);
}
export function nextStage(game: GuardGame): GuardGame {
  if(game.phase!=='clear'||game.stage>=3) return game;
  const [drones,seed]=formation(game.mode,game.stage+1,game.seed);
  return {...game,stage:game.stage+1,seed,drones,buildings:game.buildings.map(b=>({...b,hp:Math.min(b.maxHp,b.hp+1)})),
    phase:'idle',squadRow:null,squadChoices:[],attacks:[],transmittingId:null,result:null,resolved:[],shots:[],nextFireAt:game.time,ammo:drones.length+8};
}
export function pauseGame(game: GuardGame): GuardGame {
  return ['active','entering'].includes(game.phase)?{...game,pausedFrom:game.phase,phase:'paused',combo:0}:game;
}
export function resumeAttack(game: GuardGame): GuardGame {
  if(game.phase!=='paused') return game;
  // Only an interrupted transmission is replayed. Older flying beams retain
  // IDs, origins and frozen flight time; no ammunition is refunded.
  return {...game,phase:game.pausedFrom==='entering'?'entering':'active',retryUntil:game.time,
    attacks:game.attacks.map(a=>a.id===game.transmittingId?{...a,status:'preparing',readyAt:game.time,startedAt:null,toneEndsAt:null,sendEndsAt:null,impactAt:null,timeline:null}:a)};
}
export const signalCode = (symbol: string) => INTERNATIONAL_MORSE[symbol];
export const answerSeconds = (game: GuardGame) => Math.max(2, MODES[game.mode].seconds - (game.stage - 1) * 0.5);
export const scoreKey = (mode: Difficulty, hints: boolean) => `${mode}:${hints ? 'guided' : 'sound'}`;
export function readBest(mode: Difficulty, hints: boolean): number {
  try { const n = JSON.parse(localStorage.getItem('cwot:arcade:guard:city:v1') ?? '{}')[scoreKey(mode,hints)]; return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0; } catch { return 0; }
}
export function saveBest(game: GuardGame): number {
  const best = Math.max(readBest(game.mode, game.hints), game.score);
  try {
    const records: Record<string, number> = {};
    for (const mode of Object.keys(MODES) as Difficulty[]) for (const hints of [true,false]) records[scoreKey(mode,hints)] = readBest(mode,hints);
    records[scoreKey(game.mode, game.hints)] = best;
    localStorage.setItem('cwot:arcade:guard:city:v1', JSON.stringify(records));
  } catch { /* Private browsing/storage full must not interrupt play. */ }
  return best;
}

// Shared by rendering and tests. Visual movement is independent of the audio clock.
export const formationOffset = (seconds: number) => Math.sin(seconds * .32) * 30;
// Pass through an upright pose only near a direction reversal.
export const movementPose = (seconds: number): 'left'|'right'|'idle' => {
  const velocity=Math.cos(seconds*.32);
  return Math.abs(velocity)<.12?'idle':velocity>0?'right':'left';
};
export const dronePosition = (drone: Drone, offset: number, seconds=0) => ({ x: 115 + drone.column * 122 + offset, y: 77 + Math.sin(seconds*2)*2 });
export const batteryPosition = (index: number) => ({ x: 115 + index * 122, y: 370 });
export function missilePosition(from: {x:number;y:number}, to: {x:number;y:number}, progress: number) {
  const t = Math.max(0,Math.min(1,progress));
  return {x:from.x+(to.x-from.x)*t, y:from.y+(to.y-from.y)*t};
}

export const selectedBattery = (game: GuardGame | null) => game?.result?.selected ? game.squadChoices.indexOf(game.result.selected) : -1;
