import { INTERNATIONAL_MORSE } from '../morse';

export type Difficulty = 'beginner' | 'standard' | 'expert';
export const MODES = {
  beginner: { label: '初級', wpm: 8, seconds: 9, pool: 'ETANIMSO', hints: true, factor: 1 },
  standard: { label: '中級', wpm: 15, seconds: 5.5, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', hints: false, factor: 1.6 },
  expert: { label: '上級', wpm: 24, seconds: 3.5, pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', hints: false, factor: 2.3 },
} as const;
export interface Drone { id: number; row: number; column: number; symbol: string; alive: boolean }
export interface Attack { id: number; enemy: number; choices: string[]; wpm: number }
export type Phase = 'idle' | 'sending' | 'answer' | 'feedback' | 'clear' | 'over' | 'paused';
export interface GuardGame {
  mode: Difficulty; hints: boolean; stage: number; seed: number; drones: Drone[]; attack: Attack | null;
  phase: Phase; cityDamage: number[]; ammo: number; score: number; combo: number; maxCombo: number; correct: number; attempts: number;
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
  return { mode, hints, stage: 1, seed: next, drones, attack: null, phase: 'idle', cityDamage: [0,0,0,0], ammo: drones.length + 8,
    score: 0, combo: 0, maxCombo: 0, correct: 0, attempts: 0, result: null };
}
export function nextAttack(game: GuardGame): GuardGame {
  if (!['idle', 'feedback'].includes(game.phase)) return game;
  const remaining = game.drones.filter((d) => d.alive);
  if (!remaining.length) return { ...game, phase: 'clear', attack: null };
  if (game.cityDamage.every((damage) => damage === 2) || game.ammo < remaining.length) return { ...game, phase: 'over', attack: null };
  // Only the lowest surviving row may transmit. Its four letters form the answer set.
  const row = Math.max(...remaining.map((d) => d.row));
  const candidates = remaining.filter((d) => d.row === row);
  const [order, seed1] = shuffle(candidates, game.seed); const target = order[0];
  const [choices, seed3] = shuffle(game.drones.filter((d) => d.row === row).map((d) => d.symbol), seed1);
  const variation = game.mode === 'expert' ? ((game.attempts % 3) - 1) * 2 : 0;
  return { ...game, seed: seed3, phase: 'sending', result: null, attack: { id: (game.attack?.id ?? 0) + 1, enemy: target.id, choices,
    wpm: MODES[game.mode].wpm + (game.stage - 1) * 2 + variation } };
}
export function openAnswer(game: GuardGame, attackId: number): GuardGame {
  return game.phase === 'sending' && game.attack?.id === attackId ? { ...game, phase: 'answer' } : game;
}
export function answerAttack(game: GuardGame, attackId: number, selected: string | null): GuardGame {
  if (game.phase !== 'answer' || game.attack?.id !== attackId || (selected !== null && !game.attack.choices.includes(selected))) return game;
  const target = game.drones.find((d) => d.id === game.attack!.enemy)!;
  const correct = selected === target.symbol; const combo = correct ? game.combo + 1 : 0;
  const multiplier = 1 + Math.min(4, Math.floor(combo / 4)) * 0.25;
  const points = correct ? Math.round(100 * MODES[game.mode].factor * (game.attack.wpm / MODES[game.mode].wpm) * multiplier * (game.hints ? 0.75 : 1)) : 0;
  const cityDamage = [...game.cityDamage];
  if (!correct) {
    const hit = cityDamage[target.column] < 2 ? target.column : cityDamage.findIndex((damage) => damage < 2);
    if (hit >= 0) cityDamage[hit]++;
  }
  return { ...game, cityDamage, phase: 'feedback', ammo: game.ammo - 1, combo, maxCombo: Math.max(game.maxCombo, combo),
    attempts: game.attempts + 1, correct: game.correct + Number(correct), score: game.score + points,
    drones: game.drones.map((d) => d.id === target.id && correct ? { ...d, alive: false } : d),
    result: { correct, answer: target.symbol, selected, points } };
}
export function nextStage(game: GuardGame): GuardGame {
  if (game.phase !== 'clear' || game.stage >= 3) return game;
  const [drones, seed] = formation(game.mode, game.stage + 1, game.seed);
  return { ...game, cityDamage: game.cityDamage.map((damage) => Math.max(0,damage-1)), stage: game.stage + 1, seed, drones, phase: 'idle', attack: null, result: null, ammo: drones.length + 8 };
}
export function pauseGame(game: GuardGame): GuardGame {
  if (!['sending','answer','feedback'].includes(game.phase)) return game;
  const next = game.phase === 'feedback' ? nextAttack(game) : game;
  return ['clear','over'].includes(next.phase) ? next : { ...next, phase: 'paused', combo: 0 };
}
export function resumeAttack(game: GuardGame): GuardGame {
  if (game.phase !== 'paused') return game;
  return { ...game, combo: 0, phase: game.attack ? 'sending' : 'idle', result: null };
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
export const dronePosition = (drone: Drone, offset: number) => ({ x: 115 + drone.column * 122 + offset, y: 65 + drone.row * 47 });
export const batteryPosition = (index: number) => ({ x: 115 + index * 122, y: 370 });
export function missilePosition(from: {x:number;y:number}, to: {x:number;y:number}, progress: number) {
  const t = Math.max(0,Math.min(1,progress));
  return {x:from.x+(to.x-from.x)*t, y:from.y+(to.y-from.y)*t};
}

export const selectedBattery = (game: GuardGame | null) => game?.result?.selected ? game.attack?.choices.indexOf(game.result.selected) ?? -1 : -1;
