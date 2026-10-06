import { parseIntent, type AskField, type OperatorIntent } from '../air/intent';
import { pileupIntent } from '../modes/pileupRun';
import { isContestCall, parseSerial } from './serial';

/**
 * How a contest frequency hears our transmission: as a pileup does ("JA3AB?" is a
 * partial, "TU JS2WDR" a QRZ?), and besides
 *   the serial after the report ("JA1ABC 5NN 023", "5NN T23") or on its own ("023 023");
 *   NR? / CALL? asked for (CALL? alone: everyone calling, again);
 *   "QSO B4": the station is in the log already;
 *   "JA1ABC TU JS2WDR" (the call put right as we close, as a logger's ESM sends it): the
 *   contact ends and the frequency is open — a QRZ? to the rest, as "TU JS2WDR" is.
 */

/** A contest report: always 5xx ("199" after NR? is a serial, not an RST). */
const REPORT = /^5[1-9N][1-9N]$/;
/** Words that are never a serial even if they read as one (B4 → 74, 73 as a sign-off). */
const NOT_SERIAL = new Set(['B4', '73', '88', '5NN', '599']);
const PROCEDURE = new Set(['CQ', 'DE', 'K', 'TU', 'R', 'TEST', 'NR', 'QSO', 'AGN', 'QRZ', 'QRS', 'CALL', 'EE', 'BK', 'PSE', 'UR', '?']);

const bare = (token: string) => token.replace(/\?+$/, '');

/** The serial in `tokens`: the word right after the report, else the first word that is only a number. */
export function serialIn(tokens: readonly string[]): number | null {
  const reportAt = tokens.findIndex((token) => REPORT.test(token));
  if (reportAt >= 0) {
    const next = tokens[reportAt + 1];
    if (next && !next.endsWith('?') && !isContestCall(next)) {
      const value = parseSerial(next);
      if (value !== null) return value;
    }
  }
  for (const [index, token] of tokens.entries()) {
    if (index === reportAt || token.endsWith('?') || NOT_SERIAL.has(token) || PROCEDURE.has(token) || REPORT.test(token) || isContestCall(token)) continue;
    const value = parseSerial(token);
    if (value !== null) return value;
  }
  return null;
}

export function contestIntent(base: OperatorIntent): OperatorIntent {
  const read = pileupIntent(base);
  // A cut serial ("24T") reads as a call to the plain parser: it is the number.
  const calls = read.calls.filter(isContestCall);
  const queried = read.queried?.filter(isContestCall);
  const intent: OperatorIntent = calls.length === read.calls.length && queried?.length === read.queried?.length ? read : { ...read, calls, ...(read.queried ? { queried } : {}) };
  const { tokens } = intent;
  const asked = (word: string) => tokens.some((token, index) => bare(token) === word && (token.endsWith('?') || tokens[index + 1] === '?' || bare(tokens[index + 1] ?? '') === 'AGN'));
  const ask: AskField[] = [...intent.ask];
  if (asked('NR') && !ask.includes('NR')) ask.push('NR');
  // CALL? from a runner with nobody in QSO: "everyone, your call again" — an AGN? to the pile.
  const callAsked = asked('CALL');
  if (callAsked && !ask.includes('CALL')) ask.push('CALL');
  const serial = serialIn(tokens);
  const b4 = tokens.some((token, index) => token === 'B4' && tokens[index - 1] === 'QSO');
  const closedWithCall = intent.closing && intent.mentionsMe && intent.calls.length > 0 && !intent.report && serial === null && !b4 && !ask.length && !intent.partial;
  const changed = serial !== null || b4 || closedWithCall || ask.length !== intent.ask.length;
  if (!changed) return intent;
  return {
    ...intent,
    ...(closedWithCall ? { calls: [], queried: undefined, qrz: true } : {}),
    ask,
    ...(callAsked && !intent.calls.length ? { agn: true } : {}),
    ...(serial !== null ? { serial } : {}),
    ...(b4 ? { b4: true as const } : {}),
  };
}

/** Our transmission as a contest frequency reads it. */
export const readContest = (text: string, ownCall: string) => contestIntent(parseIntent(text, ownCall));
