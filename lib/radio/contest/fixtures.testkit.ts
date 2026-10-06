import type { CopyCondition, CopySituation, QsoCause } from '../../types';
import { align, type CharCell, type FieldResult } from '../attribution';
import type { JudgedContact } from '../modes/runCore';
import { analyseContest, type AirLine } from './analysis';
import type { ContestReview, DeskSent, ReviewLine, ReviewSource, TheirOnlyLine } from './review';
import { scoreSerial, type ContestScoredContact } from './score';

/**
 * Hand-made contest runs for the Stage 4 tests: the books, our log as checked, what we
 * sent, what reached our receiver and each contact scored — so the cause a failure gets
 * is the one the situation calls for, and nothing else. Test-only.
 */

const CONDITION: Record<CopySituation, CopyCondition> = {
  clean: 'clean', weak: 'weak', qsb: 'qsb', qrn: 'qrn', qrm: 'qrm', overlap: 'qrm', doubled: 'muted', detuned: 'detuned', unheard: 'unheard',
};
const CAUSE: Record<CopySituation, QsoCause> = {
  clean: 'copy', weak: 'environment', qsb: 'environment', qrn: 'environment', qrm: 'environment', overlap: 'overlap', doubled: 'doubling', detuned: 'tuning', unheard: 'timing',
};

export function callField(expected: string, input: string, situation: CopySituation = 'clean'): FieldResult {
  const cells = align(expected, input).map((cell): CharCell => ({
    ...cell, condition: CONDITION[situation], situation, cause: cell.op === 'match' ? 'ok' : CAUSE[situation], env: null,
  }));
  return { key: 'call', label: 'CALL', expected, input, correct: expected === input, cells };
}
export const nrField = (keyed: string, typed: string, situation: CopySituation = 'clean') =>
  scoreSerial(keyed, typed, [...keyed].map(() => ({ situation, condition: CONDITION[situation], env: null })));

export interface Spec {
  call: string;
  /** Calls we sent it (default: its call). */
  sent?: string[];
  firstSituation?: CopySituation;
  /** Our line: the call and serial as logged and the check's verdict; null for no line. */
  line?: { call?: string; nr?: string; verdict?: ReviewLine['verdict']; callSituation?: CopySituation; nrSituation?: CopySituation } | null;
  keyed?: string;
  serialHeard?: CopySituation | null;
  doublings?: number;
  /** Exchanged (default when a line is logged or the station has us). */
  exchanged?: boolean;
  /** The station has us without a line of ours. */
  theirOnly?: TheirOnlyLine['kind'];
  /** Others keying around our first call (seconds from it). */
  air?: { call: string; at: number; text?: string }[];
  /** The station's own message just before our first call. */
  heard?: boolean;
  /** Our messages (seconds from the contact's start). */
  desk?: Omit<DeskSent, 'text'>[];
}

export interface Fixture { result: ReviewSource; review: ContestReview; sent: DeskSent[]; scored: ContestScoredContact[]; air: AirLine[] }

/** A run of hand-made contacts, one a minute (station ids from 1, others from 100). */
export function fixture(specs: readonly Spec[], extra: { lines?: ReviewLine[]; theirOnly?: TheirOnlyLine[] } = {}): Fixture {
  const contacts: JudgedContact[] = [];
  const lines: ReviewLine[] = [...(extra.lines ?? [])];
  const theirOnly: TheirOnlyLine[] = [...(extra.theirOnly ?? [])];
  const scored: ContestScoredContact[] = [];
  const air: AirLine[] = [];
  const sent: DeskSent[] = [];
  let other = 100;
  specs.forEach((spec, index) => {
    const t = index * 60 + 10;
    const station = index + 1;
    const sentCalls = spec.sent ?? [spec.call];
    const keyed = spec.keyed ?? '123';
    const lineSpec = spec.line === null ? null : { call: spec.call, nr: keyed, verdict: 'ok' as const, ...spec.line };
    const exchanged = spec.exchanged ?? (lineSpec !== null || spec.theirOnly === 'dropped');
    const id = `c${station}`;
    const logId = lineSpec ? `l${station}` : null;
    contacts.push({
      id, stationId: station, truth: { call: spec.call, rst: '599', name: '', qth: '', nr: keyed },
      sentCalls, sentAt: sentCalls.map((_, n) => t + 2 + n * 4), doublings: spec.doublings ?? 0, corrections: 0, partials: 0, asks: 0, qrs: 0,
      txCount: 2, busted: false, startedAt: t, ...(exchanged ? { exchangedAt: t + 6 } : {}), ...(lineSpec ? { closedAt: t + 9 } : {}),
      status: 'closed', outcome: lineSpec ? 'complete' : exchanged ? 'no-closing' : 'incomplete', logIds: logId ? [logId] : [],
    } as JudgedContact);
    if (spec.heard ?? true) air.push({ station, call: spec.call, at: t, end: t + 1.5, text: spec.call });
    for (const item of spec.air ?? []) {
      other += 1;
      air.push({ station: other, call: item.call, at: t + 2 + item.at, end: t + 2 + item.at + 1.5, text: item.text ?? item.call });
    }
    for (const item of spec.desk ?? []) sent.push({ ...item, at: t + item.at, ...(item.end !== undefined ? { end: t + item.end } : {}), text: item.subject ?? '' });
    if (lineSpec && logId) {
      lines.push({ id: logId, at: t + 9, call: lineSpec.call, rst: '599', nr: lineSpec.nr, sentNr: station, verdict: lineSpec.verdict, their: null, theyBustedUs: false });
    }
    if (spec.theirOnly) theirOnly.push({ station: spec.call, at: t + 7, copied: station, sent: Number(keyed) || 0, kind: spec.theirOnly, exchange: null });
    scored.push({
      contactId: id, logId,
      fields: lineSpec ? [callField(spec.call, lineSpec.call, lineSpec.callSituation), nrField(keyed, lineSpec.nr, lineSpec.nrSituation)] : null,
      firstCall: { sent: sentCalls[0], correct: sentCalls[0] === spec.call, situation: spec.firstSituation ?? 'clean' },
      keyed, serialHeard: spec.serialHeard === undefined ? 'clean' : spec.serialHeard,
    });
  });
  const result = { contacts, clock: { start: 0, end: specs.length * 60 + 60 } } as unknown as ReviewSource;
  const review = { lines: lines.sort((a, b) => a.at - b.at), theirOnly } as unknown as ContestReview;
  return { result, review, sent: sent.sort((a, b) => a.at - b.at), scored, air: air.sort((a, b) => a.at - b.at) };
}

export const analyse = (specs: readonly Spec[], extra?: Parameters<typeof fixture>[1]) => analyseContest(fixture(specs, extra));

