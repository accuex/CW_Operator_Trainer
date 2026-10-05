import type { CopySituation, QsoContactSummary, QsoSessionSummary } from '../types';
import { collectEvidence, hardestSituation, judgeValue, mergeEvidence, scoreFields, tallyCall, type FieldResult } from './attribution';
import { situationOf, type ClockNow, type CopyMonitor, type RxRecord } from './conditions';
import type { DifficultyVector, QsoEvidence } from './difficulty';
import type { ExchangePreset } from './exchange';
import type { RunResult } from './modes/cqRun';

/**
 * Judging a finished run: every contact's log line is scored character by character
 * against what that station actually sent, with the band conditions it was sent
 * under — exactly as a rag-chew's single log is.
 */

/** The first call we sent back to a station, judged on what we could have heard of it by then. */
export interface FirstCall { sent: string; correct: boolean; situation: CopySituation }

export interface ScoredContact {
  contactId: string;
  /** The log line judged for it (the first one tied to it), if any. */
  logId: string | null;
  fields: FieldResult[] | null;
  firstCall: FirstCall | null;
  /** This contact alone (no transmit side). */
  evidence: QsoEvidence;
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

const NO_TX = { total: 0, onFrequency: 0, procedure: 0 };

/**
 * Our first copy of a call: only what the station had sent before we answered it can
 * have been heard, so the call's characters are judged up to then.
 */
export function judgeFirstCall(truth: string, sent: string | undefined, sentAt: number | undefined, records: RxRecord[], monitor: CopyMonitor, now: ClockNow): FirstCall | null {
  if (!sent || sentAt === undefined || !truth) return null;
  const before = records.filter((record) => record.epoch !== now.epoch || record.tx.start < sentAt);
  const judged = judgeValue(truth, before, monitor, { t: sentAt, epoch: now.epoch });
  return { sent, correct: sent === truth, situation: hardestSituation(judged.map((item) => situationOf(item.condition, item.env))) };
}

export function scoreRun({ result, preset, recordsOf, monitor, now, tx }: RunScoreInput): RunScore {
  const contacts = result.contacts.map((contact): ScoredContact => {
    const records = recordsOf(contact.stationId);
    const firstCall = judgeFirstCall(contact.truth.call, contact.sentCalls[0], contact.sentAt[0], records, monitor, now);
    const line = result.log.find((entry) => entry.contactId === contact.id && entry.verdict === 'ok');
    const fields = line ? scoreFields(preset, { ...contact.truth }, { ...line.fields }, records, monitor, now) : null;
    const evidence = collectEvidence(fields ?? [], NO_TX);
    tallyCall(evidence.calls!.first, firstCall);
    return { contactId: contact.id, logId: line?.id ?? null, fields, firstCall, evidence };
  });
  const fields = contacts.flatMap((contact) => contact.fields ?? []);
  // A run has no "off frequency": we transmit where we listen.
  const evidence = mergeEvidence(contacts.map((contact) => contact.evidence), { total: tx.total, onFrequency: tx.total, procedure: tx.procedure });
  return { contacts, evidence, fields };
}

/** Complete contacts with every field logged right. */
export function cleanContacts(result: RunResult, score: RunScore) {
  return result.contacts.filter((contact) => {
    const fields = score.contacts.find((item) => item.contactId === contact.id)?.fields;
    return contact.outcome === 'complete' && Boolean(fields?.every((field) => field.correct));
  }).length;
}

/** …per hour. */
export const cleanRate = (result: RunResult, score: RunScore) => (result.stats.seconds > 0 ? (cleanContacts(result, score) * 3600) / result.stats.seconds : 0);

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
      frequencyChecks: result.stats.frequencyChecks,
      busyAvoided: result.stats.busyAvoided,
      cleanRate: Math.round(cleanRate(result, score)),
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
