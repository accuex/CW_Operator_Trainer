import type { CopyCondition } from '../types';
import type { FieldResult } from './attribution';
import { judgeChar, type ClockNow, type CopyMonitor, type RxRecord } from './conditions';
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
  /** Target's transmissions; `conditions` has one CONDITION_CODE letter per sent character. */
  rx: { at: number; text: string; wpm: number; cut: boolean; conditions: string }[];
  tx: { at: number; text: string; offsetHz: number; issue?: QsoIssue }[];
  evidence: QsoEvidence;
  adjusted: Record<string, number>;
}

export function traceRx(records: RxRecord[], monitor: CopyMonitor, now: ClockNow, wpm: (record: RxRecord) => number) {
  return records.map((record) => ({
    at: record.tx.start,
    text: record.tx.text,
    wpm: wpm(record),
    cut: record.cutAt !== null && record.cutAt < record.tx.start + record.tx.length,
    conditions: record.tx.chars.map((span) => CONDITION_CODE[judgeChar(monitor, record, span, now).condition]).join(''),
  }));
}
