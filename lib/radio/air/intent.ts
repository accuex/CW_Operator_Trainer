import { normalizeRst } from '../exchange';

/**
 * What an operator meant by a transmission, independent of who hears it. Every mode
 * and every agent decides from this, never from raw text, so "3ABC?", "QRZ?" or
 * "UR 5NN" read the same in a rag-chew, a CQ run, a contest or free play.
 */

export const tokensOf = (text: string) => text.toUpperCase().replace(/[^A-Z0-9/?=\s]/g, ' ').split(/\s+/).filter(Boolean);
export const normalizeCall = (call: string) => call.toUpperCase().replace(/[^A-Z0-9/]/g, '');
/** Plausible amateur call: prefix with a digit, then 1–4 letters. */
export const isCallsign = (call: string) => /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}$/.test(normalizeCall(call));

export type AskField = 'NAME' | 'QTH' | 'RST';

export interface OperatorIntent {
  text: string;
  tokens: string[];
  /** Is the frequency in use? */
  qrl: boolean;
  cq: boolean;
  qrz: boolean;
  /** AGN / AGN? / a bare "?". */
  agn: boolean;
  qrs: boolean;
  /** Partial call asked for: "3ABC?" → "3ABC". */
  partial: string | null;
  /** Callsign-shaped words other than the sender's own, in order. */
  calls: string[];
  /** The sender's own call appears anywhere. */
  mentionsMe: boolean;
  /** "DE <own call>". */
  deMe: boolean;
  /** RST sent, normalised (5NN → 599). */
  report: string | null;
  fields: { name?: string; qth?: string };
  ask: AskField[];
  /** TU / 73 / EE / SK / CUL / GB. */
  closing: boolean;
  /** R / RR / ROGER / QSL. */
  roger: boolean;
}

/** Procedure words and Q-codes; never a partial call or a field value. */
const KEYWORDS = new Set([
  'CQ', 'DE', 'K', 'KN', 'BK', 'AR', 'SK', 'BT', 'R', 'RR', 'ROGER', 'QSL', 'TU', 'TNX', 'TKS', '73', 'EE', 'CUL', 'GB', 'GL',
  'QRZ', 'QRL', 'QRS', 'QRQ', 'QSY', 'AGN', 'PSE', 'UR', 'RST', 'RPRT', 'NAME', 'OP', 'QTH', 'HW', 'GM', 'GA', 'GE', 'GN',
  'FB', 'OM', 'YL', 'ES', 'FER', 'CALL', 'IS', 'HR', 'TEST', 'NR', 'DR', 'ALL', 'SRI', 'C', 'YES', 'NO', 'OK', '?', '=',
]);
const CLOSING = new Set(['TU', '73', 'EE', 'SK', 'CUL', 'GB']);
const ROGER = new Set(['R', 'RR', 'ROGER', 'QSL']);
const REPORT = /^[1-5][1-9N][1-9N]$/;
const FRAGMENT = /^[A-Z0-9/]{2,8}$/;
const FIELD_VALUE = /^[A-Z][A-Z0-9/]{1,15}$/;

const bare = (token: string) => token.replace(/\?+$/, '');
const asks = (tokens: string[], index: number) => tokens[index].endsWith('?') || tokens[index + 1] === '?';

/** Value after a field keyword ("NAME KEN", "NAME IS KEN", "OP KEN"). */
function fieldAfter(tokens: string[], keys: string[]) {
  for (let index = 0; index < tokens.length; index += 1) {
    if (!keys.includes(tokens[index])) continue;
    let next = index + 1;
    if (tokens[next] === 'IS' || tokens[next] === 'HR') next += 1;
    const value = tokens[next];
    if (value && FIELD_VALUE.test(value) && !KEYWORDS.has(value)) return value;
  }
  return undefined;
}

export function parseIntent(text: string, ownCall: string): OperatorIntent {
  const tokens = tokensOf(text).filter((token) => token !== '=');
  const me = normalizeCall(ownCall);
  const has = (...words: string[]) => tokens.some((token) => words.includes(token));

  const calls: string[] = [];
  let partial: string | null = null;
  tokens.forEach((token, index) => {
    const word = bare(token);
    if (!word || KEYWORDS.has(word)) return;
    if (isCallsign(word)) {
      if (word !== me && !calls.includes(word)) calls.push(word);
      return;
    }
    if (partial === null && asks(tokens, index) && FRAGMENT.test(word) && !REPORT.test(word)) partial = word;
  });

  const ask: AskField[] = [];
  tokens.forEach((token, index) => {
    const word = bare(token);
    const field = word === 'NAME' || word === 'OP' ? 'NAME' : word === 'QTH' ? 'QTH' : word === 'RST' || word === 'RPRT' ? 'RST' : null;
    if (field && asks(tokens, index) && !ask.includes(field)) ask.push(field);
  });

  const reportToken = tokens.find((token) => REPORT.test(token));
  return {
    text,
    tokens,
    qrl: tokens.some((token, index) => bare(token) === 'QRL' && asks(tokens, index)),
    cq: has('CQ'),
    qrz: has('QRZ', 'QRZ?'),
    agn: has('AGN', 'AGN?') || (tokens.length > 0 && tokens.every((token) => token === '?')),
    qrs: has('QRS', 'QRS?'),
    partial,
    calls,
    mentionsMe: tokens.some((token) => bare(token) === me),
    deMe: tokens.some((token, index) => token === 'DE' && bare(tokens[index + 1] ?? '') === me),
    report: reportToken ? normalizeRst(reportToken) : null,
    fields: { name: fieldAfter(tokens, ['NAME', 'OP']), qth: fieldAfter(tokens, ['QTH']) },
    ask,
    closing: tokens.some((token) => CLOSING.has(token)),
    roger: tokens.some((token) => ROGER.has(token)),
  };
}

/** Edit distance between two calls. */
export function callDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = above;
    }
  }
  return row[b.length];
}

/** `sent` was probably meant for `actual`: 1–2 edits off and about the same length. */
export const isNearCall = (sent: string, actual: string) =>
  sent !== actual && Math.abs(sent.length - actual.length) <= 1 && callDistance(sent, actual) <= 2;

export const matchesPartial = (call: string, partial: string) => call.includes(partial);
