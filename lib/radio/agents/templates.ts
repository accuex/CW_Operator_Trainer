import type { AskField } from '../air/intent';
import type { StationPersona } from '../air/persona';

/**
 * What a station sends, by its style and the situation. Fixed templates per
 * (style × state) — never words strung together at random — so every message is
 * something a real operator would send and every one can be tested.
 */

const twice = (word: string) => `${word} ${word}`;
const rstOf = (p: StationPersona) => (p.cutNumbers ? p.rst.replace(/9/g, 'N') : p.rst);

export function callText(p: StationPersona, me: string) {
  switch (p.style) {
    case 'once': return p.call;
    case 'twice': return twice(p.call);
    case 'formal': return `${me} DE ${twice(p.call)} K`;
    case 'novice': return `${me} DE ${twice(p.call)} [AR]`;
  }
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
