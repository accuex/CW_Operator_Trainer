import { randomSuffix } from './band';
import { normalizeRst, normalizeWord } from './exchange';

export { normalizeRst };

/**
 * One rag-chew QSO with a station calling CQ:
 *   cq      — target loops CQ. Send your call (tuned within TUNE_TOLERANCE_HZ) → report
 *   report  — target sends RST / NAME / QTH. Send your report (RST, R, TU or 73) → done
 *   done    — target sends 73. Fill the log.
 * AGN / ? repeats the last message, QRS repeats it slower.
 */

export type QsoPhase = 'cq' | 'report' | 'done';

export interface QsoTarget { call: string; name: string; qth: string; rst: string; wpm: number }
export interface QsoLog { call: string; rst: string; name: string; qth: string }
export const LOG_FIELDS = ['call', 'rst', 'name', 'qth'] as const;

/** How far off zero-beat the other station still hears you. */
export const TUNE_TOLERANCE_HZ = 150;
export const MIN_TARGET_WPM = 8;

/** QTH → call area digit, so the call and QTH agree like on the real band. */
const QTH_AREA: [string, number][] = [
  ['TOKYO', 1], ['YOKOHAMA', 1], ['CHIBA', 1], ['NAGOYA', 2], ['SHIZUOKA', 2], ['OSAKA', 3], ['KYOTO', 3], ['KOBE', 3],
  ['HIROSHIMA', 4], ['OKAYAMA', 4], ['MATSUYAMA', 5], ['KOCHI', 5], ['FUKUOKA', 6], ['KUMAMOTO', 6], ['SENDAI', 7], ['AOMORI', 7],
  ['SAPPORO', 8], ['HAKODATE', 8], ['KANAZAWA', 9], ['TOYAMA', 9], ['NIIGATA', 0], ['NAGANO', 0],
];
const NAMES = ['HIRO', 'KEN', 'TARO', 'YUKI', 'AKI', 'MASA', 'NORI', 'TAKA', 'SHIN', 'JUN', 'MIKI', 'KAZU', 'TOSHI', 'YOSHI', 'NAO', 'EMI'];
const JA_PREFIX = ['JA', 'JH', 'JR', 'JE', 'JF', 'JG', 'JI', 'JJ', 'JK', 'JL', 'JM', 'JN', 'JO', 'JP', 'JS'];
const RST = ['599', '599', '589', '579', '579', '569', '559'];

const pick = <T,>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)];

export function makeTarget(random: () => number, wpm: number): QsoTarget {
  const [qth, area] = pick(QTH_AREA, random);
  return {
    call: `${pick(JA_PREFIX, random)}${area}${randomSuffix(random)}`,
    name: pick(NAMES, random),
    qth,
    rst: pick(RST, random),
    wpm: Math.max(MIN_TARGET_WPM, Math.round(wpm)),
  };
}

export const cqText = (t: QsoTarget) => `CQ CQ CQ DE ${t.call} ${t.call} K`;
export const reportText = (t: QsoTarget, myCall: string) =>
  `${myCall} DE ${t.call} GM TNX FER CALL = UR RST ${t.rst} ${t.rst} = NAME ${t.name} ${t.name} = QTH ${t.qth} ${t.qth} = HW? ${myCall} DE ${t.call} K`;
export const finalText = (t: QsoTarget, myCall: string) => `${myCall} DE ${t.call} R TNX FB QSO = 73 TU ${myCall} DE ${t.call} EE`;
export const qrzText = (t: QsoTarget) => `QRZ? DE ${t.call} K`;

export const tokensOf = (text: string) => text.toUpperCase().replace(/[^A-Z0-9/?=\s]/g, ' ').split(/\s+/).filter(Boolean);
export const normalizeCall = (call: string) => call.toUpperCase().replace(/[^A-Z0-9/]/g, '');
/** Plausible amateur call: prefix with a digit, then 1–4 letters. */
export const isCallsign = (call: string) => /^[A-Z0-9]{1,3}[0-9][A-Z]{1,4}$/.test(normalizeCall(call));

export interface TxResult {
  phase: QsoPhase;
  /** What the target sends back (null = silence). */
  reply: string | null;
  /** The target heard you (on frequency). */
  heard: boolean;
  /** Target slows down by this many WPM before replying. */
  slower: number;
  /** Japanese coaching line for the UI. */
  hint: string;
  /** What went wrong on our side, if anything (tuning vs procedure). */
  issue?: QsoIssue;
}

export type QsoIssue = 'off-frequency' | 'missing-call' | 'missing-report';
export const isProcedureIssue = (issue: QsoIssue | undefined) => issue === 'missing-call' || issue === 'missing-report';

export interface TxContext { myCall: string; offsetHz: number }

export function respond(phase: QsoPhase, target: QsoTarget, tx: string, { myCall, offsetHz }: TxContext): TxResult {
  const tokens = tokensOf(tx);
  const me = normalizeCall(myCall);
  const base = { phase, reply: null, heard: false, slower: 0 };
  if (!tokens.length) return { ...base, hint: '送信する文を入れてください' };
  if (Math.abs(offsetHz) > TUNE_TOLERANCE_HZ) {
    return { ...base, issue: 'off-frequency', hint: phase === 'cq' ? '応答がありません。相手の信号にぴったり同調してから呼びましょう' : '応答がありません。周波数がずれたようです' };
  }
  const heard = { ...base, heard: true };
  const last = phase === 'cq' ? cqText(target) : phase === 'report' ? reportText(target, me) : finalText(target, me);
  const qrs = tokens.includes('QRS');
  if (qrs || tokens.includes('AGN') || tokens.includes('AGN?') || tokens.every((token) => token === '?')) {
    if (phase === 'cq' && !tokens.includes(me)) return { ...heard, reply: last, hint: 'もう一度 CQ を出してくれます' };
    if (phase !== 'cq') {
      return { ...heard, reply: last, slower: qrs ? 4 : 0, hint: qrs ? '少しゆっくり、もう一度送ってくれます' : 'もう一度送ってくれます' };
    }
  }
  if (phase === 'cq') {
    if (tokens.includes(me)) {
      return { ...heard, phase: 'report', reply: reportText(target, me), hint: '応答あり！ RST・名前・QTH をログに書き取りましょう' };
    }
    return { ...heard, issue: 'missing-call', reply: qrzText(target), hint: '自分のコールサインを入れて呼びましょう（例: 相手 DE 自分 K）' };
  }
  if (phase === 'report') {
    const reported = tokens.some((token) => /^[1-5][1-9N][1-9N]$/.test(token)) || tokens.some((token) => ['R', 'TU', 'TNX', '73'].includes(token));
    if (reported) return { ...heard, phase: 'done', reply: finalText(target, me), hint: '交信成立。最後の 73 を聴いたら、ログを確定しましょう' };
    return { ...heard, issue: 'missing-report', hint: 'こちらのレポートを送りましょう（例: R TNX UR 599 73）' };
  }
  return { ...heard, hint: '交信は終わっています。ログを確定しましょう' };
}


export interface LogScore { fields: Record<(typeof LOG_FIELDS)[number], boolean>; correct: number; total: number }

export function scoreLog(target: QsoTarget, log: QsoLog): LogScore {
  const fields = {
    call: normalizeCall(log.call) === target.call,
    rst: normalizeRst(log.rst) === target.rst,
    name: normalizeWord(log.name) === target.name,
    qth: normalizeWord(log.qth) === target.qth,
  };
  return { fields, correct: Object.values(fields).filter(Boolean).length, total: LOG_FIELDS.length };
}
