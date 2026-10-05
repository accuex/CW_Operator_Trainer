import type { CopyCondition } from '../types';
import type { FieldResult } from './attribution';
import type { CopySituation, QsoOverlapEnv } from '../types';
import { judgeChar, situationOf, type ClockNow, type CopyMonitor, type RxRecord } from './conditions';
import type { QsoEvidence } from './difficulty';
import type { QsoIssue } from './qso';

/**
 * Detailed per-QSO record for the review screen and future QSO-only analysis.
 * Device-only (IndexedDB, latest QSO_TRACE_LIMIT); the cloud gets the summary.
 */

export const QSO_TRACE_LIMIT = 50;

export const CONDITION_CODE: Record<CopyCondition, string> = {
  clean: 'c', weak: 'w', qsb: 's', qrn: 'n', qrm: 'q', detuned: 'd', muted: 'm', unheard: 'u',
};
/** Same letters, plus o = overlap (another caller keyed over it), x = doubled (our transmission). */
export const SITUATION_CODE: Record<CopySituation, string> = {
  clean: 'c', weak: 'w', qsb: 's', qrn: 'n', qrm: 'q', overlap: 'o', detuned: 'd', doubled: 'x', unheard: 'u',
};

export interface TracedRx {
  at: number;
  text: string;
  wpm: number;
  cut: boolean;
  /** One CONDITION_CODE letter per sent character. */
  conditions: string;
  /** One SITUATION_CODE letter per sent character (older traces lack it). */
  situations?: string;
  /** Other callers keyed over a character, by its index in `conditions` (absent: none did). */
  overlaps?: Record<number, QsoOverlapEnv>;
}

export interface QsoTrace {
  id: string;
  startedAt: number;
  endedAt: number;
  modeId: string;
  presetId: string;
  difficulty: Record<string, number>;
  truth: Record<string, string>;
  log: Record<string, string>;
  fields: FieldResult[];
  /** Target's transmissions. */
  rx: TracedRx[];
  /** `macro`: sent unchanged from a 定型 button. */
  tx: { at: number; text: string; offsetHz: number; issue?: QsoIssue; macro?: boolean }[];
  evidence: QsoEvidence;
  adjusted: Record<string, number>;
}

export function traceRx(records: RxRecord[], monitor: CopyMonitor, now: ClockNow, wpm: (record: RxRecord) => number): TracedRx[] {
  return records.map((record) => {
    const judged = record.tx.chars.map((span) => judgeChar(monitor, record, span, now));
    const overlaps: Record<number, QsoOverlapEnv> = {};
    judged.forEach((item, index) => { if (item.env.overlap) overlaps[index] = item.env.overlap; });
    return {
      at: record.tx.start,
      text: record.tx.text,
      wpm: wpm(record),
      cut: record.cutAt !== null && record.cutAt < record.tx.start + record.tx.length,
      conditions: judged.map((item) => CONDITION_CODE[item.condition]).join(''),
      situations: judged.map((item) => SITUATION_CODE[situationOf(item.condition, item.env)]).join(''),
      ...(Object.keys(overlaps).length ? { overlaps } : {}),
    };
  });
}
