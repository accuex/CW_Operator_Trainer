import type { QsoContactSummary, QsoSessionSummary } from '../types';
import { collectEvidence, scoreFields, type FieldResult } from './attribution';
import type { ClockNow, CopyMonitor, RxRecord } from './conditions';
import type { DifficultyVector, QsoEvidence } from './difficulty';
import type { ExchangePreset } from './exchange';
import type { RunResult } from './modes/cqRun';

/**
 * Judging a finished run: every contact's log line is scored character by character
 * against what that station actually sent, with the band conditions it was sent
 * under — exactly as a rag-chew's single log is.
 */

export interface ScoredContact {
  contactId: string;
  /** The log line judged for it (the first one tied to it), if any. */
  logId: string | null;
  fields: FieldResult[] | null;
}

export interface RunScore {
  contacts: ScoredContact[];
  evidence: QsoEvidence;
  /** Every judged field, all contacts. */
  fields: FieldResult[];
}

export interface RunScoreInput {
  result: RunResult;
  preset: ExchangePreset;
  /** What we received from one station. */
  recordsOf(stationId: number): RxRecord[];
  monitor: CopyMonitor;
  now: ClockNow;
  /** Our transmissions, and how many had a procedure slip. */
  tx: { total: number; procedure: number };
}

export function scoreRun({ result, preset, recordsOf, monitor, now, tx }: RunScoreInput): RunScore {
  const contacts = result.contacts.map((contact): ScoredContact => {
    const line = result.log.find((entry) => entry.contactId === contact.id && entry.verdict === 'ok');
    if (!line) return { contactId: contact.id, logId: null, fields: null };
    const truth: Record<string, string> = { ...contact.truth };
    const log: Record<string, string> = { ...line.fields };
    return { contactId: contact.id, logId: line.id, fields: scoreFields(preset, truth, log, recordsOf(contact.stationId), monitor, now) };
  });
  const fields = contacts.flatMap((contact) => contact.fields ?? []);
  // A run has no "off frequency": we transmit where we listen.
  const evidence = collectEvidence(fields, { total: tx.total, onFrequency: tx.total, procedure: tx.procedure });
  return { contacts, evidence, fields };
}

export interface RunSummaryInput {
  result: RunResult;
  score: RunScore;
  modeId: string;
  presetId: string;
  fieldCount: number;
  difficulty: DifficultyVector;
  /** Engine time → wall clock (ms). */
  wallClock(t: number): number;
}

/** The synced summary: one line per contact made or logged, plus the run's numbers. */
export function runSummary({ result, score, modeId, presetId, fieldCount, difficulty, wallClock }: RunSummaryInput): QsoSessionSummary {
  const contacts: QsoContactSummary[] = result.contacts
    .filter((contact) => contact.outcome !== 'incomplete' || contact.logIds.length)
    .map((contact) => {
      const fields = score.contacts.find((item) => item.contactId === contact.id)?.fields;
      return {
        call: contact.truth.call,
        fields: fields?.length ?? fieldCount,
        fieldsCorrect: fields?.filter((field) => field.correct).length ?? 0,
        outcome: contact.outcome,
        at: wallClock(contact.closedAt ?? contact.exchangedAt ?? contact.startedAt),
      };
    });
  const { evidence } = score;
  return {
    modeId,
    presetId,
    call: contacts[0]?.call ?? '',
    outcome: contacts.some((contact) => contact.outcome === 'complete') ? 'complete' : 'partial',
    fields: contacts.reduce((sum, contact) => sum + contact.fields, 0),
    fieldsCorrect: contacts.reduce((sum, contact) => sum + contact.fieldsCorrect, 0),
    cleanAccuracy: evidence.clean.total ? evidence.clean.correct / evidence.clean.total : null,
    causes: evidence.causes,
    difficulty: { ...difficulty },
    adjusted: {},
    contacts,
    run: {
      seconds: Math.round(result.stats.seconds),
      contacts: result.stats.contacts,
      rate: Math.round(result.stats.rate),
      firstCallAccuracy: result.stats.firstCallAccuracy,
      partials: result.stats.partials,
      corrections: result.stats.corrections,
      busts: result.stats.busts,
      nil: result.stats.nil,
      unlogged: result.stats.unlogged,
      dupes: result.stats.dupes,
      missed: result.missed.length,
      tempo: result.tempo,
      callers: result.stats.callers,
      doublings: result.stats.doublings,
      busyCqs: result.stats.busyCqs,
      qrlNoListen: result.stats.qrlNoListen,
      frequencies: result.frequencies.map((use) => ({
        rf: use.rf,
        at: Math.round(wallClock(use.firstCqAt)),
        qrlFirst: use.qrlFirst,
        qrlListen: use.qrlListen === null ? null : Math.round(use.qrlListen * 10) / 10,
        busyCqs: use.busyCqs,
        qsyAsked: use.qsyAsked,
      })),
    },
  };
}
