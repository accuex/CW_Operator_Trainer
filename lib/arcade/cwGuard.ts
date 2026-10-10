import { INTERNATIONAL_MORSE } from '../morse';

export type Difficulty = 'beginner' | 'standard' | 'expert';
export const MODES = {
  beginner: { label: '初級', wpm: 8, seconds: 9, pool: 'ETANIMSO', hints: true, factor: 1 },
  standard: { label: '中級', wpm: 15, seconds: 5.5, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', hints: false, factor: 1.6 },
  expert: { label: '上級', wpm: 24, seconds: 3.5, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', hints: false, factor: 2.3 },
} as const;
export interface Drone { id: number; row: number; column: number; symbol: string; alive: boolean }
export interface Attack { id: number; enemy: number; choices: string[]; wpm: number }
export type Phase = 'idle' | 'entering' | 'charging' | 'sending' | 'answer' | 'feedback' | 'clear' | 'over' | 'paused';
export interface GuardGame {
  mode: Difficulty; hints: boolean; stage: number; seed: number; drones: Drone[]; attack: Attack | null;
  phase: Phase; squadRow: number | null; squadChoices: string[]; attackSerial: number; retryUntil: number; shotAt: number | null; pausedFrom?: Phase; cityDamage: number[]; ammo: number; score: number; combo: number; maxCombo: number; correct: number; attempts: number;
  result: { correct: boolean; answer: string; selected: string | null; points: number } | null;
}
function random(seed: number): [number, number] {
  const next = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [next / 4294967296, next];
}
function shuffle<T>(input: readonly T[], seed: number): [T[], number] {
  const list = [...input];
  for (let i = list.length - 1; i > 0; i--) {
    const [value, next] = random(seed); seed = next;
    const j = Math.floor(value * (i + 1)); [list[i], list[j]] = [list[j], list[i]];
  }
  return [list, seed];
}
function formation(mode: Difficulty, stage: number, seed: number): [Drone[], number] {
  const drones: Drone[] = [];
  let previous = '';
  for (let row = 0; row < (stage === 1 ? 4 : 5); row++) {
    const [symbols, next] = shuffle([...MODES[mode].pool], seed); seed = next;
    if (symbols.slice(0,4).sort().join('') === previous) [symbols[3],symbols[4]] = [symbols[4],symbols[3]];
    previous = symbols.slice(0,4).sort().join('');
    for (let column = 0; column < 4; column++) drones.push({ id: row * 4 + column, row, column, symbol: symbols[column], alive: true });
  }
  return [drones, seed];
}
export function createGame(mode: Difficulty, hints = MODES[mode].hints, seed = Date.now() >>> 0): GuardGame {
  const [drones, next] = formation(mode, 1, seed);
  return { mode, hints, stage: 1, seed: next, drones, attack: null, phase: 'idle', squadRow: null, squadChoices: [], attackSerial: 0, retryUntil: 0, shotAt: null, cityDamage: [0,0,0,0], ammo: drones.length + 8,
    score: 0, combo: 0, maxCombo: 0, correct: 0, attempts: 0, result: null };
}
export function nextAttack(game: GuardGame): GuardGame {
  if (!['idle', 'feedback'].includes(game.phase)) return game;
  const remaining = game.drones.filter((d) => d.alive);
  if (!remaining.length) return { ...game, phase: 'clear', attack: null };
  if (game.cityDamage.every((damage) => damage === 2) || game.ammo < remaining.length) return { ...game, phase: 'over', attack: null };
  // Only the lowest surviving row may transmit. Its four letters form the answer set.
  const row = Math.max(...remaining.map((d) => d.row));
  if (game.squadRow !== row) {
    // Keys are a squad-level set, independent of enemy count or attack selection.
    const [squadChoices, seed] = shuffle([...new Set(game.drones.filter(d=>d.row===row).map(d=>d.symbol))],game.seed);
    return { ...game, seed, squadChoices, phase: 'entering', squadRow: row, attack: null, result: null, retryUntil: 0, shotAt: null };
  }
  const candidates = remaining.filter((d) => d.row === row);
  const [order, seed1] = shuffle(candidates, game.seed); const target = order[0];
  const choices = [...game.squadChoices];
  const variation = game.mode === 'expert' ? ((game.attempts % 3) - 1) * 2 : 0;
  return { ...game, seed: seed1, attackSerial: game.attackSerial+1, phase: 'charging', result: null, retryUntil: 0, shotAt: null, attack: { id: game.attackSerial + 1, enemy: target.id, choices,
    wpm: MODES[game.mode].wpm + (game.stage - 1) * 2 + variation } };
}
/** Entry and preparation must finish before any audio/answer phase. */
export function completeArrival(game: GuardGame): GuardGame {
  return game.phase === 'entering' ? nextAttack({ ...game, phase: 'idle' }) : game;
}
export function beginTransmission(game: GuardGame, attackId: number): GuardGame {
  return game.phase === 'charging' && game.attack?.id === attackId ? { ...game, phase: 'sending' } : game;
}
export function squadDrones(game: GuardGame): Drone[] {
  const row=game.squadRow ?? Math.max(...game.drones.filter(d=>d.alive).map(d=>d.row));
  return game.drones.filter(d=>d.row===row);
}
export const squadNumber = (game: GuardGame) => (game.stage===1 ? 4 : 5)-(game.squadRow ?? (game.stage===1 ? 3 : 4));
export const ARRIVAL_MS=850;
export const CHARGE_MS=260;
export function openAnswer(game: GuardGame, attackId: number): GuardGame {
  return game.phase === 'sending' && game.attack?.id === attackId ? { ...game, phase: 'answer' } : game;
}
export const RETRY_SECONDS = .3;
/** A miss spends a round but does not resolve the attack or reveal its answer. */
export function answerAttack(game: GuardGame, attackId: number, selected: string | null, now = 0, deadline = Infinity): GuardGame {
  if (game.phase !== 'answer' || game.attack?.id !== attackId) return game;
  if (selected === null || now >= deadline) return expireAttack(game,attackId);
  if (!Number.isFinite(now) || now < game.retryUntil || game.ammo <= 0 || !game.attack.choices.includes(selected)) return game;
  const target = game.drones.find(d=>d.id===game.attack!.enemy)!;
  const correct = selected===target.symbol, combo=correct?game.combo+1:0;
  const multiplier=1+Math.min(4,Math.floor(combo/4))*.25;
  const points=correct?Math.round(100*MODES[game.mode].factor*(game.attack.wpm/MODES[game.mode].wpm)*multiplier*(game.hints?.75:1)):0;
  const shot: GuardGame = {...game, ammo:game.ammo-1, combo, maxCombo:Math.max(game.maxCombo,combo), attempts:game.attempts+1,
    correct:game.correct+Number(correct), score:game.score+points, retryUntil:now+RETRY_SECONDS, shotAt:now,
    phase:correct?'feedback':'answer', drones:game.drones.map(d=>d.id===target.id&&correct?{...d,alive:false}:d),
    result:{correct,answer:correct?target.symbol:'',selected,points}};
  return !correct && shot.ammo===0 ? expireAttack(shot,attackId) : shot;
}
/** Timeout/impact ends the opportunity once; town damage is applied once, no phantom shot. */
export function expireAttack(game: GuardGame, attackId: number): GuardGame {
  if (game.phase!=='answer' || game.attack?.id!==attackId) return game;
  const target=game.drones.find(d=>d.id===game.attack!.enemy)!;
  const cityDamage=[...game.cityDamage];
  const hit=cityDamage[target.column]<2?target.column:cityDamage.findIndex(d=>d<2);
  if(hit>=0) cityDamage[hit]++;
  return {...game,cityDamage,phase:'feedback',combo:0,
    result:{correct:false,answer:target.symbol,selected:game.result?.selected??null,points:0}};
}
export function nextStage(game: GuardGame): GuardGame {
  if (game.phase !== 'clear' || game.stage >= 3) return game;
  const [drones, seed] = formation(game.mode, game.stage + 1, game.seed);
  return { ...game, cityDamage: game.cityDamage.map((damage) => Math.max(0,damage-1)), stage: game.stage + 1, seed, drones, squadRow: null, squadChoices: [], retryUntil: 0, shotAt: null, phase: 'idle', attack: null, result: null, ammo: drones.length + 8 };
}
export function pauseGame(game: GuardGame): GuardGame {
  if (!['entering','charging','sending','answer','feedback'].includes(game.phase)) return game;
  const next = game.phase === 'feedback' ? nextAttack(game) : game;
  return ['clear','over'].includes(next.phase) ? next : { ...next, pausedFrom: next.phase, phase: 'paused', combo: 0 };
}
export function resumeAttack(game: GuardGame): GuardGame {
  if (game.phase !== 'paused') return game;
  return { ...game, combo: 0, phase: game.pausedFrom==='entering' ? 'entering' : game.pausedFrom==='charging' ? 'charging' : game.attack ? 'sending' : 'idle', result: null, retryUntil: 0, shotAt: null };
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

export const selectedBattery = (game: GuardGame | null) => game?.result?.selected ? game.attack?.choices.indexOf(game.result.selected) ?? -1 : -1;
