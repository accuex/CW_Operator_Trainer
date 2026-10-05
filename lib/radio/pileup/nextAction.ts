import { isCallsign } from '../air/intent';
import { fillMemory } from '../memories';

/**
 * "Enter sends the next message" for the pileup desk (ESM, as in a contest logger).
 *
 * What goes out is decided only from what the operator can see: the CALL and RST fields
 * as typed, their shape (callsign or not), the desk's public phase, and what the operator
 * sent before (the path). Never from who is calling, how many fit a partial or whether
 * the call is right — this module takes no session and no station, so it can't. The
 * same fields in the same state always give the same action.
 *
 *   phase      CALL field                  Enter sends
 *   start      empty                       CQ {MYCALL} {MYCALL}
 *   listening  empty                       QRZ?
 *   (start)    a piece ("3AB", "JA?ABC")   {PIECE} AGN?      — the field stays, to add letters
 *              a piece ending "?" ("3AB?") as typed           — a partial
 *              a full call                 {CALL} 5NN        → working
 *              anything else (spaces …)    as typed
 *   working    the call we sent, no RST    AGN?
 *              the call we sent, RST       TU {MYCALL} + log → listening (TU is the next QRZ)
 *              another full call           {CALL} 5NN        — a correction
 *              a piece                     {PIECE} AGN?      → listening (narrowing again)
 *              empty                       QRZ?              — the contact is dropped unlogged
 *
 * Ways round the table when it reads the field differently from the operator:
 * Ctrl+Enter sends the field as typed (sendAsTyped), F6 sends "{PIECE} AGN?" even for a
 * callsign-shaped piece ("JA3AB" heard as a part of a longer call), and a trailing "?"
 * makes anything a partial.
 */

export type PickPhase = 'start' | 'listening' | 'working';

/** The desk's own state: only what the operator has done. */
export interface PickState {
  phase: PickPhase;
  /** The call we sent with the report (working), else null. */
  sentCall: string | null;
  /** What we asked for while picking this station — pieces and the call(s), oldest first ("3A", "3AB", "JA3ABC"). Cleared by CQ, QRZ? and TU. */
  path: string[];
}

export const START: PickState = { phase: 'start', sentCall: null, path: [] };

/** The fields as typed. */
export interface PickInput { call: string; rst: string }

export type ActionKind = 'cq' | 'qrz' | 'partial' | 'pick' | 'correct' | 'agn' | 'tu' | 'raw' | 'none';

export interface PickAction {
  kind: ActionKind;
  /** What goes on the air ('' for none). */
  text: string;
  /** The piece or call this action is about (partial, pick, correct). */
  subject?: string;
  /** A TU that logs: the fields as typed. */
  log?: { call: string; rst: string };
}

export type InputShape = 'empty' | 'call' | 'piece' | 'other';

/** The report we give everyone (in the pileup's cut-number form). */
export const OUR_REPORT = '5NN';

const clean = (text: string) => text.toUpperCase().replace(/\s+/g, ' ').trim();
const PIECE = /^[A-Z0-9/?]+$/;

/** A full call, portable or not ("JA3ABC", "JA3ABC/1"). Anything with "?" in it is not. */
const fullCall = (text: string) => !text.includes('?') && (isCallsign(text) || text.split('/').some((part) => part.length > 2 && isCallsign(part)));

/** The shape of the CALL field, by its letters alone. */
export function shapeOf(call: string): InputShape {
  const text = clean(call);
  if (!text) return 'empty';
  if (!PIECE.test(text)) return 'other';
  return fullCall(text) ? 'call' : 'piece';
}

const none: PickAction = { kind: 'none', text: '' };

/** A partial for a piece: "3AB" → "3AB AGN?", "3AB?" / "JA3AB?" as typed. */
export function partialFor(piece: string): PickAction {
  const text = clean(piece);
  if (!text) return none;
  const subject = text.replace(/\?+$/, '');
  if (text.endsWith('?') && subject) return { kind: 'partial', text, subject };
  return { kind: 'partial', text: `${subject || text} AGN?`, subject: subject || text };
}

/** Enter. */
export function nextAction(state: PickState, input: PickInput, me: string): PickAction {
  const call = clean(input.call);
  const rst = clean(input.rst);
  const shape = shapeOf(call);
  if (state.phase === 'working' && state.sentCall) {
    switch (shape) {
      case 'empty': return { kind: 'qrz', text: 'QRZ?' };
      case 'piece': return partialFor(call);
      case 'other': return { kind: 'raw', text: call };
      case 'call':
        if (call !== state.sentCall) return { kind: 'correct', text: `${call} ${OUR_REPORT}`, subject: call };
        return rst ? { kind: 'tu', text: `TU ${clean(me)}`, log: { call, rst } } : { kind: 'agn', text: 'AGN?' };
    }
  }
  switch (shape) {
    case 'empty': return state.phase === 'start' ? { kind: 'cq', text: `CQ ${clean(me)} ${clean(me)}` } : { kind: 'qrz', text: 'QRZ?' };
    case 'piece': return partialFor(call);
    case 'other': return { kind: 'raw', text: call };
    case 'call': return { kind: 'pick', text: `${call} ${OUR_REPORT}`, subject: call };
  }
}

/** Ctrl+Enter: the CALL field exactly as typed, nothing added. */
export function sendAsTyped(input: PickInput): PickAction {
  const text = clean(input.call);
  return text ? { kind: 'raw', text } : none;
}

/** The memory keys, F1–F10: fixed messages, filled from the fields as typed. */
export const PILEUP_KEYS = [
  { key: 'F1', label: 'CQ', template: 'CQ {MYCALL} {MYCALL}' },
  { key: 'F2', label: '{CALL} 5NN', template: '{CALL} 5NN' },
  { key: 'F3', label: 'TU', template: 'TU {MYCALL}' },
  { key: 'F4', label: '自局', template: '{MYCALL}' },
  { key: 'F5', label: '{CALL}?', template: '{CALL}?' },
  { key: 'F6', label: '{PIECE} AGN?', template: '{PIECE} AGN?' },
  { key: 'F7', label: 'QRZ?', template: 'QRZ?' },
  { key: 'F8', label: 'AGN?', template: 'AGN?' },
  { key: 'F9', label: 'QRS', template: 'QRS' },
  { key: 'F10', label: 'QRX', template: 'QRX' },
] as const;

/** A memory key (0 = F1). Keys that need the CALL field send nothing while it is empty. */
export function keyAction(index: number, state: PickState, input: PickInput, me: string): PickAction {
  const memory = PILEUP_KEYS[index];
  if (!memory) return none;
  const call = clean(input.call);
  const bare = call.replace(/\?+$/, '');
  const text = fillMemory(memory.template.replace('{PIECE}', '{CALL}'), { CALL: bare, MYCALL: me });
  switch (memory.key) {
    case 'F1': return { kind: 'cq', text };
    case 'F2':
      if (!bare) return none;
      return state.phase === 'working' && state.sentCall && bare !== state.sentCall ? { kind: 'correct', text, subject: bare } : { kind: 'pick', text, subject: bare };
    case 'F3': return { kind: 'tu', text, ...(bare ? { log: { call: bare, rst: clean(input.rst) } } : {}) };
    case 'F4': return { kind: 'qrz', text }; // our call alone: a pileup hears QRZ?
    case 'F5':
    case 'F6': return bare ? { kind: 'partial', text, subject: bare } : none;
    case 'F7': return { kind: 'qrz', text };
    case 'F8': return { kind: 'agn', text };
    default: return { kind: 'raw', text };
  }
}

const has = (text: string, ...words: string[]) => text.split(' ').some((word) => words.includes(word.replace(/\?+$/, '')));

/** The state once `action` is on the air. */
export function afterSend(state: PickState, action: PickAction): PickState {
  switch (action.kind) {
    case 'none': return state;
    case 'cq':
    case 'qrz':
    case 'tu': return { phase: 'listening', sentCall: null, path: [] };
    case 'partial': return { phase: 'listening', sentCall: null, path: [...state.path, action.subject ?? action.text] };
    case 'pick':
    case 'correct': return { phase: 'working', sentCall: action.subject ?? null, path: [...state.path, action.subject ?? action.text] };
    case 'agn': return state.phase === 'start' ? { ...state, phase: 'listening' } : state;
    case 'raw':
      if (has(action.text, 'CQ', 'QRZ', 'TU')) return { phase: 'listening', sentCall: null, path: [] };
      return state.phase === 'start' ? { ...state, phase: 'listening' } : state;
  }
}

/** The CALL and RST fields once `action` is on the air: a partial keeps the piece to add to; a TU or QRZ? clears both. */
export function fieldsAfter(input: PickInput, action: PickAction): PickInput {
  return action.kind === 'tu' || action.kind === 'qrz' || action.kind === 'cq' ? { call: '', rst: '' } : input;
}

/** One line for the desk: where we are, from our own actions only. */
export function phaseLine(state: PickState): string {
  if (state.phase === 'start') return 'CQ を出して始めます';
  if (state.phase === 'working') return `${state.sentCall} と交信中`;
  return state.path.length ? `絞り込み ${state.path.length} 回目` : '聴取中';
}
