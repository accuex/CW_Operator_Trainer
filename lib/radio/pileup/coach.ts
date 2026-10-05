import type { PickAction, PickState } from './nextAction';

/**
 * The pileup desk's coach line. Like nextAction it reads only the operator's own
 * actions and the clock — never who is calling — so it can say how to work a pileup
 * but never who to pick.
 */

export type CoachTip = 'idle' | 'partial' | 'samePiece' | 'picked' | 'qrzRun';

export const COACH_TEXT: Record<CoachTip, string> = {
  idle: '全部取れなくて大丈夫。聞こえた 2〜3 文字だけ入れて Enter で、その文字を含む局だけ呼び直してもらえます',
  partial: '文字を含む局だけが呼び直します。聞こえた文字を足して、もう一度 Enter',
  samePiece: '強さやピッチの違う局に耳を移してみましょう。別の断片でも構いません',
  picked: '相手のレポートを聴き、受信 RST を入れて Enter で TU とログ記入',
  qrzRun: 'ピッチの少しずれた局は、混信の中でも拾いやすいことがあります',
};

/** Seconds after CQ / QRZ? / TU with nothing typed before the idle tip. */
export const IDLE_SECONDS = 10;

/** How much the coach says: every time, each tip once per run, or nothing. */
export type CoachLevel = 'always' | 'once' | 'off';

/** What the coach remembers: our recent messages and the tips already given. */
export interface CoachMemory {
  /** QRZ? (and CQ) sent in a row with nothing else between. */
  qrzRun: number;
  given: CoachTip[];
}

export const FRESH_COACH: CoachMemory = { qrzRun: 0, given: [] };

const allowed = (level: CoachLevel, memory: CoachMemory, tip: CoachTip) => level === 'always' || (level === 'once' && !memory.given.includes(tip));

/** The tip for a message we just sent (`before` / `after`: the desk state around it). */
export function tipAfterSend(level: CoachLevel, memory: CoachMemory, action: PickAction, after: PickState): { tip: CoachTip | null; memory: CoachMemory } {
  const qrzRun = action.kind === 'qrz' || action.kind === 'cq' ? memory.qrzRun + 1 : 0;
  let tip: CoachTip | null = null;
  if (action.kind === 'partial') {
    const subject = action.subject ?? '';
    tip = after.path.filter((piece) => piece === subject).length >= 3 ? 'samePiece' : 'partial';
  } else if (action.kind === 'pick' || action.kind === 'correct') tip = 'picked';
  else if (action.kind === 'qrz' && qrzRun >= 3) tip = 'qrzRun';
  const next = { ...memory, qrzRun };
  if (!tip || level === 'off' || !allowed(level, memory, tip)) return { tip: null, memory: next };
  return { tip, memory: { ...next, given: next.given.includes(tip) ? next.given : [...next.given, tip] } };
}

/** The idle tip: listening, nothing typed, `quiet` seconds since our last message. */
export function idleTip(level: CoachLevel, memory: CoachMemory, state: PickState, typed: boolean, quiet: number): { tip: CoachTip | null; memory: CoachMemory } {
  if (level === 'off' || state.phase !== 'listening' || state.path.length || typed || quiet < IDLE_SECONDS || !allowed(level, memory, 'idle')) return { tip: null, memory };
  return { tip: 'idle', memory: { ...memory, given: memory.given.includes('idle') ? memory.given : [...memory.given, 'idle'] } };
}
