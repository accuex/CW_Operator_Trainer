import { callDistance } from '../air/intent';
import { shapeOf } from '../pileup/nextAction';
import { formatSerial, PLAIN_SERIAL, serialOf } from './serial';

/**
 * "Enter sends the next message" for the contest run desk (ESM, as a contest logger has it).
 *
 * The loop it drives:  CQ TEST → a call typed → "{CALL} 5NN {NR}" → their serial typed →
 * "TU {MYCALL}" and the line logged → the next caller.
 *
 * Like the pileup's nextAction it decides only from what the operator can see: the
 * fields as typed, the desk's own state (whom we sent our exchange to, the partials we
 * sent) and our own log (DUPE, our next serial). It takes no session and no station, so
 * it can't use who is really calling or what they really sent; a miscopy goes out as typed.
 *
 *   phase      CALL         NR           Enter sends
 *   start /    empty        —            CQ TEST {MYCALL} TEST
 *   listening  a piece      —            {PIECE}?          (the field stays, to add letters)
 *              a full call  —            {CALL} 5NN {NR}   → working
 *              a DUPE       —            {CALL} QSO B4     (the log has it; ; works it anyway)
 *   working    the call sent  a serial   TU {MYCALL} + log → listening
 *              the call sent  empty/bad  NR?
 *              another call   a serial   {CALL} TU {MYCALL} + log (the call put right as we close)
 *              a near call    empty      {CALL} 5NN {NR}   — a correction, the same serial
 *              a DUPE call    empty      {CALL} QSO B4     → listening (the contact left; ; works it)
 *              a far call     empty      {CALL} 5NN {NR}   — a new station, the same serial
 *              a piece        —          {PIECE}?          → listening
 *              empty          —          CQ TEST …         — the contact is dropped unlogged
 *   any        anything else (spaces …)  as typed
 *
 * A different call typed while working is read from the typed strings and our log alone:
 * one a letter or two off the call we sent (callDistance ≤ NEAR_CALL) is that call put
 * right — the station hears its call and our exchange again; a call already in our log is
 * a DUPE whoever it is, so it gets QSO B4 (the station before it is left unlogged, as with
 * CQ); anything further off is another station picked, its exchange a fresh one. Before,
 * every different call went out as a correction, so a DUPE typed mid-contact was worked
 * as if it were the same station put right (Stage 3's known limit) and a contact the
 * operator had moved on from looked like a call corrected.
 *
 * Our serial: the next line's number in our log ({NR} = lines logged + 1). It is given
 * when the exchange goes out and sent again unchanged (correction, F2, AGN?) until the
 * contact is logged; a contact dropped unlogged gives its number to the next station.
 * Logging takes it, and the next exchange carries the one after.
 *
 * Built for the runner's side only; a search-and-pounce desk will have its own table on
 * the same fields, serial and log.
 */

export type EsmPhase = 'start' | 'listening' | 'working';

/** The desk's own state: only what the operator has done. */
export interface EsmState {
  phase: EsmPhase;
  /** The call our exchange went to (working), else null. */
  sentCall: string | null;
  /** The partials we sent while picking this station, oldest first. Cleared by CQ, TU and QSO B4. */
  path: string[];
}

export const ESM_START: EsmState = { phase: 'start', sentCall: null, path: [] };

/** The fields as typed: their call, the report and serial they sent us. */
export interface EsmInput { call: string; nr: string; rst: string }

export const EMPTY_INPUT: EsmInput = { call: '', nr: '', rst: '' };

/** What the desk knows from our own log. */
export interface EsmLog {
  me: string;
  /** Our serial for the next line logged. */
  nextNr: number;
  /** The call is in our log already. */
  isDupe: (call: string) => boolean;
}

export type EsmKind = 'cq' | 'partial' | 'exchange' | 'correct' | 'tu' | 'b4' | 'ask' | 'mycall' | 'hiscall' | 'raw' | 'none';

export interface EsmAction {
  kind: EsmKind;
  /** What goes on the air ('' for none). */
  text: string;
  /** The call or piece it is about. */
  subject?: string;
  /** Our serial, if the text carries it. */
  nr?: number;
  /** A TU that logs: the fields as typed (the report as 599 if left empty). */
  log?: { call: string; rst: string; nr: string };
}

/** The report we give everyone. */
export const CONTEST_REPORT = '5NN';

/** A memory template filled: {CALL}, {MYCALL}, {NR}. */
const fill = (template: string, vars: Record<'CALL' | 'MYCALL' | 'NR', string>) =>
  clean(template.replace(/\{(CALL|MYCALL|NR)\}/g, (_, key: 'CALL' | 'MYCALL' | 'NR') => vars[key]));

const none: EsmAction = { kind: 'none', text: '' };
const clean = (text: string) => text.toUpperCase().replace(/\s+/g, ' ').trim();

/** Our serial as it goes out. */
export const ourNr = (nr: number) => formatSerial(nr, PLAIN_SERIAL);

/** The serial typed in the NR field, if it reads as one ("023", "23", "T23", "2NN"). */
export const typedSerial = (nr: string) => serialOf(clean(nr));

/** A typed call this close to the one we sent is that call put right (one or two letters off). */
export const NEAR_CALL = 2;

/** Our exchange to `call` while working `sent`: a correction if it is near, else a new station. */
const exchangeKind = (call: string, sent: string | null): 'exchange' | 'correct' =>
  (sent !== null && call !== sent && callDistance(call, sent) <= NEAR_CALL ? 'correct' : 'exchange');

const exchange = (call: string, log: EsmLog, kind: 'exchange' | 'correct'): EsmAction =>
  ({ kind, text: `${call} ${CONTEST_REPORT} ${ourNr(log.nextNr)}`, subject: call, nr: log.nextNr });

const cq = (log: EsmLog): EsmAction => ({ kind: 'cq', text: `CQ TEST ${clean(log.me)} TEST` });

const logOf = (call: string, input: EsmInput) => ({ call, rst: clean(input.rst) || '599', nr: clean(input.nr) });

/** A piece asked about: "JA1" → "JA1?", "1AB?" as typed. */
export function contestPartial(piece: string): EsmAction {
  const text = clean(piece);
  const subject = text.replace(/\?+$/, '');
  if (!subject) return none;
  return { kind: 'partial', text: `${subject}?`, subject };
}

/** Enter. */
export function esmEnter(state: EsmState, input: EsmInput, log: EsmLog): EsmAction {
  const call = clean(input.call);
  const shape = shapeOf(call);
  if (shape === 'other') return { kind: 'raw', text: call };
  if (shape === 'piece') return contestPartial(call);
  if (state.phase === 'working' && state.sentCall) {
    if (shape === 'empty') return cq(log);
    const nr = typedSerial(input.nr);
    if (call !== state.sentCall) {
      if (nr !== null) return { kind: 'tu', text: `${call} TU ${clean(log.me)}`, subject: call, log: logOf(call, input) };
      if (log.isDupe(call)) return { kind: 'b4', text: `${call} QSO B4`, subject: call };
      return exchange(call, log, exchangeKind(call, state.sentCall));
    }
    return nr !== null ? { kind: 'tu', text: `TU ${clean(log.me)}`, subject: call, log: logOf(call, input) } : { kind: 'ask', text: 'NR?' };
  }
  if (shape === 'empty') return cq(log);
  if (log.isDupe(call)) return { kind: 'b4', text: `${call} QSO B4`, subject: call };
  return exchange(call, log, 'exchange');
}

/** ";" — their call and our exchange, whatever the log says (a DUPE worked all the same, or the exchange again). */
export function esmExchange(state: EsmState, input: EsmInput, log: EsmLog): EsmAction {
  const call = clean(input.call).replace(/\?+$/, '');
  if (shapeOf(call) !== 'call') return none;
  return exchange(call, log, state.phase === 'working' ? exchangeKind(call, state.sentCall) : 'exchange');
}

/** "\" — TU and log the fields as typed (a call is needed; the serial as typed, even if it reads as none). */
export function esmLogTu(state: EsmState, input: EsmInput, log: EsmLog): EsmAction {
  const call = clean(input.call).replace(/\?+$/, '');
  if (shapeOf(call) !== 'call') return none;
  const corrected = state.phase === 'working' && state.sentCall !== null && call !== state.sentCall;
  return { kind: 'tu', text: corrected ? `${call} TU ${clean(log.me)}` : `TU ${clean(log.me)}`, subject: call, log: logOf(call, input) };
}

/**
 * The memory keys, laid out as contest loggers have them: the run's own messages on
 * F1–F6, the questions on F7–F11. Alternatives where F keys are taken (Mac):
 * Ctrl+1–9, 0, - (or Alt/Option with the same keys).
 */
export const CONTEST_KEYS = [
  { key: 'F1', label: 'CQ', template: 'CQ TEST {MYCALL} TEST' },
  { key: 'F2', label: '交換', template: '5NN {NR}' },
  { key: 'F3', label: 'TU', template: 'TU {MYCALL}' },
  { key: 'F4', label: '自局', template: '{MYCALL}' },
  { key: 'F5', label: '相手', template: '{CALL}' },
  { key: 'F6', label: 'QSO B4', template: '{CALL} QSO B4' },
  { key: 'F7', label: '?', template: '?' },
  { key: 'F8', label: 'AGN?', template: 'AGN?' },
  { key: 'F9', label: 'NR?', template: 'NR?' },
  { key: 'F10', label: 'CALL?', template: 'CALL?' },
  { key: 'F11', label: 'QRS', template: 'QRS' },
] as const;

/** The alternative for each memory key (Ctrl / Alt with these). */
export const CONTEST_ALT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-'] as const;

/** A memory key (0 = F1). Keys that need the CALL field send nothing while it is empty. F3 logs as "\" does. */
export function esmKey(index: number, state: EsmState, input: EsmInput, log: EsmLog): EsmAction {
  const memory = CONTEST_KEYS[index];
  if (!memory) return none;
  const call = clean(input.call).replace(/\?+$/, '');
  const text = fill(memory.template, { CALL: call, MYCALL: clean(log.me), NR: ourNr(log.nextNr) });
  switch (memory.key) {
    case 'F1': return cq(log);
    case 'F2': return { kind: 'raw', text, nr: log.nextNr };
    case 'F3': {
      const logged = esmLogTu(state, input, log);
      return logged.kind === 'tu' ? logged : { kind: 'raw', text };
    }
    case 'F4': return { kind: 'mycall', text };
    case 'F5': return call ? { kind: 'hiscall', text, subject: call } : none;
    case 'F6': return shapeOf(call) === 'call' ? { kind: 'b4', text, subject: call } : none;
    case 'F7': case 'F8': case 'F9': case 'F10': return { kind: 'ask', text };
    default: return { kind: 'raw', text };
  }
}

const has = (text: string, ...words: string[]) => text.split(' ').some((word) => words.includes(word.replace(/\?+$/, '')));

/** The state once `action` is on the air. */
export function esmAfter(state: EsmState, action: EsmAction): EsmState {
  switch (action.kind) {
    case 'none': return state;
    case 'cq':
    case 'tu':
    case 'b4': return { phase: 'listening', sentCall: null, path: [] };
    case 'partial': return { phase: 'listening', sentCall: null, path: [...state.path, action.subject ?? action.text] };
    case 'exchange':
    case 'correct': return { phase: 'working', sentCall: action.subject ?? null, path: [...state.path, action.subject ?? action.text] };
    case 'raw':
      if (has(action.text, 'CQ', 'TU')) return { phase: 'listening', sentCall: null, path: [] };
      return state.phase === 'start' ? { ...state, phase: 'listening' } : state;
    default: return state.phase === 'start' ? { ...state, phase: 'listening' } : state;
  }
}

/** The fields once `action` is on the air: TU and QSO B4 clear them for the next caller; everything else keeps them. */
export function esmFieldsAfter(input: EsmInput, action: EsmAction): EsmInput {
  return action.kind === 'tu' || action.kind === 'b4' ? EMPTY_INPUT : input;
}

/** One line for the desk: where we are, from our own actions only. */
export function esmPhaseLine(state: EsmState): string {
  if (state.phase === 'start') return 'CQ TEST を出して始めます';
  if (state.phase === 'working') return `${state.sentCall} に交換を送りました`;
  return state.path.length ? `絞り込み ${state.path.length} 回目` : '聴取中';
}
