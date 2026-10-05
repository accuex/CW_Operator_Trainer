import type { AskField } from '../air/intent';
import type { StationPersona } from '../air/persona';
import { keyText } from '../keying';

/**
 * What a station sends, by its style and the situation. Fixed templates per
 * (style × state) — never words strung together at random — so every message is
 * something a real operator would send and every one can be tested.
 */

const twice = (word: string) => `${word} ${word}`;
const rstOf = (p: StationPersona) => (p.cutNumbers ? p.rst.replace(/9/g, 'N') : p.rst);

/** `repeat`: times the call goes out (1–3); omitted, as the style sends it. */
export function callText(p: StationPersona, me: string, repeat?: number | null) {
  const calls = repeat ? Array.from({ length: repeat }, () => p.call).join(' ') : null;
  switch (p.style) {
    case 'once': return calls ?? p.call;
    case 'twice': return calls ?? twice(p.call);
    case 'formal': return `${me} DE ${calls ?? twice(p.call)} K`;
    case 'novice': return `${me} DE ${calls ?? twice(p.call)} [AR]`;
  }
}

/**
 * How a caller sends its call in a pileup (where everyone is calling the same station):
 * the DX's call and "DE … K" sentence are dropped, the persona's habits stay — a
 * "twice" sends it twice, formal keeps its DE and K, a novice its DE and AR, and
 * `repeat` (the crowd's) still counts the calls. Longest first; the caller sends the
 * first that fits its time (pileupCallText).
 *   kind 'call': calling;  'answer': back to a partial or a call near its own.
 */
export function pileupCallForms(p: StationPersona, kind: 'call' | 'answer', repeat?: number | null): string[] {
  const own = kind === 'call' && repeat ? repeat : p.style === 'once' && kind === 'call' ? 1 : 2;
  const counts = [...new Set([own, Math.min(own, 2), 1])].filter((count) => count <= own);
  const calls = (count: number) => Array.from({ length: count }, () => p.call).join(' ');
  const end = p.style === 'novice' ? ' [AR]' : p.style === 'formal' ? ' K' : '';
  const de = p.style === 'novice' || p.style === 'formal';
  const forms = counts.map((count) => `${de ? 'DE ' : ''}${calls(count)}${end}`);
  return de ? [...forms, `${p.call}${end}`] : forms;
}

/** Longest a pileup call should take, seconds: shorter forms are used above it. */
export const PILEUP_CALL_SECONDS = 16;

/** The first of the pileup call forms that keys within PILEUP_CALL_SECONDS at `wpm` (else the shortest). */
export function pileupCallText(p: StationPersona, kind: 'call' | 'answer', wpm: number, repeat?: number | null) {
  const forms = pileupCallForms(p, kind, repeat);
  return forms.find((form) => keyText(form, { wpm }).length <= PILEUP_CALL_SECONDS) ?? forms[forms.length - 1];
}

/** Answer to a partial call that matches. */
export const partialReply = (p: StationPersona) => (p.style === 'formal' || p.style === 'novice' ? `DE ${twice(p.call)} K` : twice(p.call));

/** "That's not quite my call." */
export const correctionText = (p: StationPersona) => (p.style === 'once' || p.style === 'twice' ? twice(p.call) : `DE ${twice(p.call)}`);

/** We named it but sent nothing else. */
export const confirmText = (p: StationPersona) => (p.style === 'novice' ? `R R DE ${p.call} K` : 'R R');

export function exchangeText(p: StationPersona, me: { call: string; name: string }, heardName: boolean) {
  const rst = rstOf(p);
  if (p.sendStyle === 'brief') return `R UR ${rst} NAME ${p.name} QTH ${p.qth} BK`;
  const greet = heardName && me.name ? `GM ${me.name}` : 'GM';
  return `R ${me.call} DE ${p.call} ${greet} UR ${twice(rst)} NAME ${p.name} QTH ${p.qth} BK`;
}

/** The DX-style exchange: only the fields it sends ("R 5NN", "5NN 5NN TU", "R TU UR 5NN 5NN NAME KEN"). */
export function dxExchangeText(p: StationPersona, me: { call: string }, sends: readonly AskField[]) {
  const rst = rstOf(p);
  const name = sends.includes('NAME') ? ` NAME ${p.name}` : '';
  switch (p.style) {
    case 'once': return `R ${rst}${name}`;
    case 'twice': return `${twice(rst)}${name} TU`;
    case 'formal': return `R TU UR ${twice(rst)}${name}`;
    case 'novice': return `R ${me.call} DE ${p.call} UR ${twice(rst)}${name} K`;
  }
}

export const askText = (p: StationPersona, fields: AskField[]) =>
  `${p.style === 'formal' || p.style === 'novice' ? 'PSE ' : ''}${fields.map((field) => `${field}?`).join(' ')}`;

/** Only the fields we asked for again. */
export function fieldsText(p: StationPersona, fields: AskField[]) {
  const value: Record<AskField, string> = { RST: rstOf(p), NAME: p.name, QTH: p.qth };
  return fields.map((field) => `${field} ${twice(value[field])}`).join(' ');
}

export function finalText(p: StationPersona, me: { name: string }) {
  if (p.closing === 'ee') return 'EE';
  return me.name ? `R TNX ${me.name} 73 TU EE` : 'TU 73 EE';
}

/** We went quiet on it. */
export const nudgeText = (p: StationPersona, me: string) => (p.style === 'once' ? '?' : `${me}?`);
