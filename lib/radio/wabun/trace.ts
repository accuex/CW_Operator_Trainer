import type { QsoAssist } from '../../types';
import type { DecodeOverTrace } from '../decode/assist';
import type { QsoIssue } from '../qso';
import type { TracedRx } from '../trace';
import type { WabunLog } from './copy';
import type { WabunProcedure } from './procedure';
import type { WabunCopyMeasure, WabunEvidence, WabunFollowMeasure, WabunRepeatReview, WabunVerdict } from './review';
import type { WabunNote, WabunPhase, WabunResponse, WabunTxResult, WabunUnderstood } from './dialogue';
import type { WabunAxes, WabunAxis } from './adapt';
import type { WabunFist } from './fist';
import type { CorrectionRead, WabunIntent } from './intent';
import type { WabunFact, WabunLevel, WabunTruth } from './scenario';
import { composeVoicing, keyedText, keySegments, type Segment } from './segments';

/**
 * One transmission of ours, four things kept apart (none of them overwrites another):
 *
 *   input       what we typed, as the field showed it
 *   notation    what the keyer was given (segments.ts notation)
 *   keyed       what actually went out, unit by unit (a letter with no code is dropped by
 *               the keyer and so is not here; a correction ラタ is the same ラタ)
 *   intent      what we meant, read from the notation (our switches, report, asks …)
 *   understood  what the station took from it (null until it was on the air)
 *
 * A slip stays what was sent: "ゴール アリガトウ" is keyed and reviewed as ゴール; nothing
 * is rewritten into the phrase that was meant. Only a ラタ correction we sent changes
 * what the station reads.
 */
export interface WabunTxTrace {
  input: string;
  notation: string;
  keyed: string;
  segments: Segment[];
  /** Kana of the body as keyed, word by word, a correction's ラタ in place (nothing applied). */
  keyedWabun: string;
  switches: number;
  corrections: CorrectionRead[];
  intent: Pick<WabunIntent, 'opened' | 'closed' | 'unopened' | 'report' | 'ack' | 'closing' | 'asks' | 'repeat' | 'qrs' | 'body'>;
  understood: WabunUnderstood | null;
  /** Where the QSO stood when we sent it. */
  phase?: WabunPhase;
  /** How it was put together and what the station made of it (procedure.ts). */
  notes?: WabunNote[];
  issue?: QsoIssue;
  /** The station asked us for these in answer. */
  request?: WabunFact[];
  /** We started it while the station was still keying. */
  breakIn?: boolean;
}

export function traceTransmission(input: string, notation: string, result: WabunTxResult | null, extra: { phase?: WabunPhase; breakIn?: boolean } = {}): WabunTxTrace {
  const keyed = keySegments(notation, { wpm: 20 });
  const keyedWabun = composeVoicing(keyed.chars.reduce<string[]>((words, span) => {
    const segment = keyed.segments[span.segment];
    const correction = segment.kind === 'control' && segment.correction;
    if (span.script !== 'wabun' && !correction) return words;
    words[span.word] = (words[span.word] ?? '') + (correction ? 'ラタ' : span.char);
    return words;
  }, []).filter(Boolean).join(' '));
  const intent = result?.intent;
  return {
    input,
    notation,
    keyed: keyedText(keyed),
    segments: keyed.segments,
    keyedWabun,
    switches: keyed.switches.length,
    corrections: intent?.corrections ?? [],
    intent: intent
      ? { opened: intent.opened, closed: intent.closed, unopened: intent.unopened, report: intent.report, ack: intent.ack, closing: intent.closing, asks: intent.asks, repeat: intent.repeat, qrs: intent.qrs, body: intent.body }
      : { opened: false, closed: false, unopened: false, report: null, ack: false, closing: false, asks: [], repeat: false, qrs: false, body: '' },
    understood: result ? result.understood : null,
    ...(extra.phase ? { phase: extra.phase } : {}),
    notes: result?.notes ?? [],
    ...(result?.issue ? { issue: result.issue } : {}),
    request: result?.request ?? [],
    breakIn: Boolean(extra.breakIn),
  };
}

export const WABUN_RECORD_VERSION = 1;

/**
 * One wabun QSO as reviewed, kept on the device (IndexedDB, with the other single-QSO
 * traces; never synced). The truth is in it: it is written after the QSO, for the review
 * and later analysis.
 */
export interface WabunQsoRecord {
  kind: 'wabun';
  version: number;
  id: string;
  startedAt: number;
  endedAt: number;
  modeId: string;
  level: WabunLevel;
  complete: boolean;
  /** The station's speed at the end (after any QRS). */
  wpm: number;
  truth: WabunTruth;
  /** The facts this QSO told, in order. */
  told: WabunFact[];
  /** Level 4: the news went out in the closing over (a long talk over split in two). */
  newsInClosing: boolean;
  log: WabunLog;
  memo: string;
  checks: Partial<Record<WabunFact, string>>;
  /** The station's overs, character by character as received. */
  rx: TracedRx[];
  /** Our overs: input, keyed, intent, understood. */
  tx: WabunTxTrace[];
  copy: WabunCopyMeasure;
  follow: WabunFollowMeasure;
  procedure: WabunProcedure;
  repeats: WabunRepeatReview[];
  requests: WabunFact[][];
  /** What the station finally took from us. */
  understood: { rst: string | null; name: string | null };
  evidence: WabunEvidence;
  verdict: WabunVerdict;
  /** Level 5: the news went out in the chat over (a long talk over split). */
  newsInChat?: boolean;
  /** Level 3 on: our responses to its talk / chat. */
  responses?: WabunResponse[];
  /** Level 5: how the station keyed (the numbers; the review shows words). */
  fist?: WabunFist | null;
  /** The axes it ran at, and whether おまかせ was on (it then moves them from here). */
  axes?: WabunAxes;
  auto?: boolean;
  /** What おまかせ moved after this QSO (filled in when saved; null: おまかせ off). */
  adjusted?: Partial<Record<WabunAxis, [number, number]>> | null;
  /** DECODE's use (none: never on); then the copy evidence stayed out of the skills and おまかせ. */
  assist?: QsoAssist;
  /** Dev: each over against what DECODE printed (only when it was on). */
  decode?: DecodeOverTrace[];
}
