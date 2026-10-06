import type { ContestCause, ContestFailure, CopySituation, QsoEnvCondition } from '../../types';
import { collectEvidence, mergeEvidence, tallyCall, type FieldResult } from '../attribution';
import { callDistance, isNearCall, matchesPartial, nearPartial, normalizeCall } from '../air/intent';
import { SITUATION_SEVERITY } from '../conditions';
import type { CallTally, QsoEvidence } from '../difficulty';
import type { JudgedContact } from '../modes/runCore';
import type { ContestReview, DeskSent, ReviewLine, ReviewSource } from './review';
import type { ContestScoredContact } from './score';
import { parseSerial } from './serial';

/**
 * What a contest run says about the operator. Every failure gets one primary cause —
 * the one the learning system acts on — and, apart from it, whatever else was going on
 * (auxiliary: shown in the review, never fed to おまかせ or a skill).
 *
 * Failures (what went wrong), as the log check and the books show them:
 *   bust-call   our line's call is wrong (the log check)
 *   bust-nr     our line's serial is wrong (the log check)
 *   first-call  the call we first sent back was wrong (put right before the line was written)
 *   nil         nobody has us for a line of ours
 *   dupe        a line for a call already in our log
 *   dropped     we exchanged and went on without logging (the station has us, we don't)
 *   unmatched   the station has us, no exchange of ours went to it
 *   doubled     we keyed over the station (it never heard that message)
 *   abandoned   a contact started and never exchanged
 *
 * Causes (why):
 *   reception    copy in the clear (the ear itself)
 *   weak         the characters missed were weak
 *   environment  QRM / QSB / QRN from the band (`env` says which)
 *   overlap      another caller keyed over the station (or we copied another caller's serial)
 *   doubling     we keyed over the station
 *   similar      a look-alike was on the frequency, and our call was nearer it than the station
 *   interference an eager or lid caller answered out of turn (`interferer` says which)
 *   procedure    procedure and timing: a line written before the exchange, without the
 *                serial, a contact left part-way, a station never answered
 *   logging      the log itself: the call put right on the air and typed wrong, a serial
 *                that doesn't read as one, a report typed wrong
 *   dupe         DUPE handling: a call already in our log worked and written again
 *   dropped      dropped after the exchange (when a look-alike took the exchange we sent
 *                a call we logged right, it is interference instead: its slip, not ours)
 *
 * Only reception, weak and the look-alike / overlap / serial counts move おまかせ, each
 * its own axis (see learning.ts). Procedure, logging, DUPE, dropped, doublings and lids
 * never count as copy: the fields they touch are blamed and stay out of copy evidence
 * and weak-character analysis. dropped and unmatched are never reception.
 *
 * Built from what the trace keeps (the books, our messages, the callers' messages and
 * each contact scored), so a stored run gives the same answer again.
 */

export const CONTEST_ANALYSIS_VERSION = 1;

export type { ContestCause, ContestFailure };

export const CONTEST_CAUSES: readonly ContestCause[] = ['reception', 'weak', 'environment', 'overlap', 'doubling', 'similar', 'interference', 'procedure', 'logging', 'dupe', 'dropped'];

/** A caller's message as we received it (seconds from the start of the run). */
export interface AirLine { station: number; call: string; at: number; end: number; text: string }

/** One character that went wrong: as keyed, as we have it ('' for lost), what it went through. */
export interface CharSlip { field: 'call' | 'nr'; expected: string; input: string; situation: CopySituation }

export interface ContestMistake {
  failure: ContestFailure;
  /** The one cause the learning system reads. */
  cause: ContestCause;
  /** Everything else that was going on: for the review only. */
  aux: ContestCause[];
  /** Seconds from the start. */
  at: number;
  /** The station (as it really was) or, with none, the call we logged. */
  call: string;
  /** The field it is about. */
  field?: 'call' | 'nr';
  /** What we sent or logged instead. */
  got?: string;
  /** The right value (as keyed). */
  expected?: string;
  /** The look-alike, the interferer, or the station whose serial we took. */
  with?: string;
  /** environment: which band condition. */
  env?: Exclude<QsoEnvCondition, 'weak'>;
  /** interference: an eager caller (near our call or piece) or a lid (nowhere near). */
  interferer?: 'eager' | 'lid';
  slips?: CharSlip[];
  /** doubled: how many times. */
  count?: number;
}

export interface Tally { total: number; correct: number }

export interface ContestAnalysis {
  version: number;
  mistakes: ContestMistake[];
  /** Primary causes counted. */
  causes: Partial<Record<ContestCause, number>>;
  failures: Partial<Record<ContestFailure, number>>;
  /** First calls right, in the clear (pure copy, not a look-alike or a lid). */
  copy: Tally;
  /** Calls as logged right, in the clear. */
  calls: Tally;
  /** Serials as logged right, in the clear. */
  serial: Tally;
  /** First calls right with two or more callers keying just before. */
  crowded: Tally;
  /** Contacts with a look-alike on the frequency, and of them the ones logged with the right call. */
  similarMet: number;
  similarRight: number;
  /** Answers out of turn heard: from eager callers (near the call or piece we sent) and lids. */
  eager: number;
  lid: number;
  /** Calls we sent with the station clear (not keying over it). */
  timing: Tally;
  /** Contacts carried through without a procedure slip (dropped, abandoned, a line before the exchange …). */
  procedure: Tally;
  /** Lines without a logging slip. */
  logging: Tally;
  /** Most lines checked right in a row (DUPE lines skipped, a BUST or NIL ends it). */
  streak: number;
  /** Fields whose misses weren't copy, per contact: they stay out of copy evidence. */
  blamed: Record<string, Partial<Record<'call' | 'nr', ContestCause>>>;
  /** Character evidence for skills and おまかせ (blamed fields left out; only clean whole calls for callsign). */
  evidence: QsoEvidence;
}

export interface ContestAnalysisInput {
  result: ReviewSource;
  review: ContestReview;
  /** Our messages (seconds from the start; `end` when known). */
  sent: readonly DeskSent[];
  scored: readonly ContestScoredContact[];
  air: readonly AirLine[];
}

/** What a character's situation makes of a miss. */
const SITUATION_CAUSE: Record<CopySituation, ContestCause> = {
  clean: 'reception', detuned: 'reception', weak: 'weak', qsb: 'environment', qrn: 'environment', qrm: 'environment',
  overlap: 'overlap', doubled: 'doubling', unheard: 'procedure',
};

/** Causes that aren't the operator's copy: the field they touch stays out of copy evidence. */
export const NOT_COPY: ReadonlySet<ContestCause> = new Set(['similar', 'interference', 'procedure', 'logging', 'dupe', 'dropped']);

/** Seconds around our first call to a station in which another caller counts as "on the frequency". */
const AROUND_BEFORE = 12;
const AROUND_AFTER = 2;
/** An answer within this long of our message is a reply to it. */
const REPLY_WINDOW = 3;
/** Callers keying in this long before our call count as calling at once. */
const CROWD_WINDOW = 6;

const empty = (): Tally => ({ total: 0, correct: 0 });
const add = (tally: Tally, correct: boolean) => {
  tally.total += 1;
  tally.correct += correct ? 1 : 0;
};
const hardest = (situations: readonly CopySituation[]): CopySituation =>
  situations.reduce<CopySituation>((worst, situation) => (SITUATION_SEVERITY[situation] > SITUATION_SEVERITY[worst] ? situation : worst), 'clean');
const unique = <T>(items: readonly T[]) => [...new Set(items)];

/** Who our message was for: the call or piece it carried, or the station we were working. */
interface Addressed { at: number; end: number; to: string | null; partial: boolean }

function addressed(sent: readonly DeskSent[]): Addressed[] {
  let working: string | null = null;
  return sent.map((item) => {
    const end = item.end ?? item.at + 3;
    switch (item.kind) {
      case 'exchange':
      case 'correct':
        working = item.subject ?? null;
        return { at: item.at, end, to: working, partial: false };
      case 'partial': return { at: item.at, end, to: item.subject ?? null, partial: true };
      case 'hiscall': return { at: item.at, end, to: item.subject ?? null, partial: false };
      case 'ask':
      case 'raw':
        return { at: item.at, end, to: working, partial: false };
      default:
        // CQ, TU, QSO B4, our call: the frequency is open, anyone may call.
        working = null;
        return { at: item.at, end, to: null, partial: false };
    }
  });
}

/** How a caller's message stood to the one of ours just before it: out of turn (eager / lid) or not. */
function turnOf(line: AirLine, ours: readonly Addressed[]): 'eager' | 'lid' | null {
  const before = ours.filter((item) => item.end <= line.at + 0.3 && line.at - item.end <= REPLY_WINDOW).at(-1);
  if (!before?.to) return null;
  const fits = before.partial ? matchesPartial(line.call, before.to) : line.call === before.to;
  if (fits) return null;
  const near = before.partial ? nearPartial(line.call, before.to) || callDistance(line.call, before.to) <= 2 : isNearCall(before.to, line.call) || callDistance(before.to, line.call) <= 2;
  return near ? 'eager' : 'lid';
}

export function analyseContest({ result, review, sent, scored, air }: ContestAnalysisInput): ContestAnalysis {
  const start = result.clock.start;
  const rel = (at: number) => Math.round((at - start) * 10) / 10;
  const ours = addressed(sent);
  const turns = new Map(air.map((line) => [line, turnOf(line, ours)]));
  const scoredOf = new Map(scored.map((item) => [item.contactId, item]));
  const lineOf = new Map(review.lines.map((line) => [line.id, line]));
  const contactOfLine = new Map<string, JudgedContact>();
  for (const contact of result.contacts) {
    const logId = scoredOf.get(contact.id)?.logId;
    if (logId) contactOfLine.set(logId, contact);
  }
  const sentSubjects = new Set(sent.flatMap((item) => (item.subject ? [item.subject] : [])));

  /** Other callers on the frequency around `t` (seconds from the start). */
  const around = (t: number, except: number) =>
    unique(air.filter((line) => line.station !== except && line.at <= t + AROUND_AFTER && line.end >= t - AROUND_BEFORE).map((line) => line.station))
      .map((station) => air.find((line) => line.station === station)!);

  const mistakes: ContestMistake[] = [];
  const blamed: ContestAnalysis['blamed'] = {};
  const copy = empty();
  const calls = empty();
  const serial = empty();
  const crowded = empty();
  const timing = empty();
  let similarMet = 0;
  let similarRight = 0;

  const slipsOf = (field: FieldResult | undefined, key: 'call' | 'nr'): CharSlip[] =>
    (field?.cells ?? []).filter((cell) => cell.op !== 'match').map((cell) => ({ field: key, expected: cell.expected, input: cell.input, situation: cell.situation }));
  const fromSituations = (situations: CopySituation[]) => {
    const worst = hardest(situations);
    const cause = SITUATION_CAUSE[worst];
    return { cause, env: worst === 'qsb' || worst === 'qrn' || worst === 'qrm' ? worst : undefined, others: unique(situations.map((situation) => SITUATION_CAUSE[situation])).filter((item) => item !== cause) };
  };

  /** Why a call we sent or logged wasn't the station's. */
  const classifyCall = (contact: JudgedContact, wrong: string, at: number, situations: CopySituation[], logged: boolean) => {
    const truth = contact.truth.call;
    const aux: ContestCause[] = [];
    if (contact.doublings) aux.push('doubling');
    // The call went out right and was typed wrong: the log, not the ear.
    if (logged && contact.sentCalls.at(-1) === truth) return { cause: 'logging' as const, aux };
    let other: AirLine | null = null;
    for (const line of around(at, contact.stationId)) {
      if (line.call === truth) continue;
      const close = line.call === wrong || (isNearCall(wrong, line.call) && callDistance(wrong, line.call) <= callDistance(wrong, truth));
      if (close && (!other || callDistance(wrong, line.call) < callDistance(wrong, other.call))) other = line;
    }
    const band = fromSituations(situations);
    if (other) {
      const turn = air.find((line) => line.station === other!.station && line.at >= at - AROUND_BEFORE && line.at <= at + 30 && turns.get(line));
      const kind = turn ? turns.get(turn)! : null;
      return {
        cause: (kind ? 'interference' : 'similar') as ContestCause,
        aux: unique([...aux, ...(band.cause !== 'reception' ? [band.cause] : []), ...band.others]),
        with: other.call,
        ...(kind ? { interferer: kind } : {}),
      };
    }
    return { cause: band.cause, aux: unique([...aux, ...band.others]).filter((item) => item !== band.cause), ...(band.env ? { env: band.env } : {}) };
  };

  /** Why a serial we logged wasn't the one the station sent. */
  const classifySerial = (contact: JudgedContact, field: FieldResult) => {
    const aux: ContestCause[] = contact.doublings ? ['doubling'] : [];
    if (!field.input) return { cause: 'procedure' as ContestCause, aux };
    const value = parseSerial(field.input);
    if (value === null) return { cause: 'logging' as ContestCause, aux };
    // Another caller's serial taken for this station's.
    const from = rel(contact.startedAt);
    const to = rel(contact.exchangedAt ?? contact.closedAt ?? contact.startedAt);
    const other = air.find((line) => line.station !== contact.stationId && line.at >= from - AROUND_BEFORE && line.at <= to + AROUND_AFTER
      && line.text.split(/\s+/).some((word) => parseSerial(word) === value));
    const band = fromSituations(field.cells.filter((cell) => cell.op !== 'match' && cell.op !== 'ins').map((cell) => cell.situation));
    if (other) {
      const kind = turns.get(other) ?? null;
      return { cause: (kind ? 'interference' : 'overlap') as ContestCause, aux: unique([...aux, ...band.others, band.cause]).filter((item) => item !== (kind ? 'interference' : 'overlap')), with: other.call, ...(kind ? { interferer: kind } : {}) };
    }
    return { cause: band.cause, aux: unique([...aux, ...band.others]).filter((item) => item !== band.cause), ...(band.env ? { env: band.env } : {}) };
  };

  const blame = (contactId: string, key: 'call' | 'nr', cause: ContestCause) => {
    if (NOT_COPY.has(cause)) (blamed[contactId] ??= {})[key] = cause;
  };

  for (const contact of result.contacts) {
    const item = scoredOf.get(contact.id);
    const truth = contact.truth.call;
    const firstAt = rel(contact.sentAt[0] ?? contact.startedAt);
    const line = item?.logId ? lineOf.get(item.logId) : undefined;
    const callField = item?.fields?.find((field) => field.key === 'call');
    const nrField = item?.fields?.find((field) => field.key === 'nr');
    const first = contact.sentCalls[0];

    const others = around(firstAt, contact.stationId);
    if (others.some((other) => isNearCall(truth, other.call) || isNearCall(other.call, truth))) {
      similarMet += 1;
      if (line && line.verdict !== 'nil' && callField?.correct) similarRight += 1;
    }
    const sentCount = contact.sentCalls.length;
    for (let index = 0; index < sentCount; index += 1) add(timing, index >= Math.min(contact.doublings, sentCount));

    // The call: the logged one if the check busted it, else the first one we sent.
    let callCause: ContestCause | null = null;
    if (line?.verdict === 'bust-call' && callField) {
      const situations = callField.cells.filter((cell) => cell.op !== 'match' && cell.op !== 'ins').map((cell) => cell.situation);
      const why = classifyCall(contact, line.call, firstAt, situations, true);
      callCause = why.cause;
      mistakes.push({ failure: 'bust-call', ...why, at: line.at, call: truth, field: 'call', got: line.call, expected: truth, slips: slipsOf(callField, 'call') });
    } else if (first !== undefined && first !== truth && line?.verdict !== 'nil') {
      const why = classifyCall(contact, first, firstAt, [item?.firstCall?.situation ?? 'clean'], false);
      callCause = why.cause;
      const firstCells = first.length === truth.length ? [...truth].flatMap((char, index) => (first[index] === char ? [] : [{ field: 'call' as const, expected: char, input: first[index], situation: item?.firstCall?.situation ?? 'clean' }])) : [];
      mistakes.push({ failure: contact.outcome === 'incomplete' && !contact.logIds.length ? 'abandoned' : 'first-call', ...why, at: firstAt, call: truth, field: 'call', got: first, expected: truth, slips: firstCells });
    } else if (contact.outcome === 'incomplete' && !contact.logIds.length) {
      mistakes.push({ failure: 'abandoned', cause: contact.doublings ? 'doubling' : 'procedure', aux: [], at: firstAt, call: truth });
    }
    if (callCause) blame(contact.id, 'call', callCause);

    if (line?.verdict === 'nil') {
      let cause: ContestCause = 'procedure';
      const aux: ContestCause[] = [];
      let extra: Partial<ContestMistake> = {};
      if (contact.exchangedAt === undefined) cause = contact.doublings ? 'doubling' : 'procedure';
      else if (contact.sentCalls.some((call) => call !== truth)) {
        const wrong = contact.sentCalls.find((call) => call !== truth)!;
        const why = classifyCall(contact, wrong, firstAt, [item?.firstCall?.situation ?? 'clean'], false);
        cause = why.cause;
        aux.push(...why.aux);
        extra = { got: wrong, expected: truth, ...('with' in why ? { with: why.with } : {}), ...('interferer' in why ? { interferer: why.interferer } : {}) };
      } else if (contact.doublings) aux.push('doubling');
      mistakes.push({ failure: 'nil', cause, aux, at: line.at, call: line.call, ...extra });
      blame(contact.id, 'call', cause);
      blame(contact.id, 'nr', cause);
    }

    if (line?.verdict === 'bust-nr' && nrField) {
      const why = classifySerial(contact, nrField);
      mistakes.push({ failure: 'bust-nr', ...why, at: line.at, call: truth, field: 'nr', got: nrField.input, expected: item?.keyed, slips: slipsOf(nrField, 'nr') });
      blame(contact.id, 'nr', why.cause);
    }
    if (line?.verdict === 'dupe') {
      mistakes.push({ failure: 'dupe', cause: 'dupe', aux: [], at: line.at, call: line.call });
      blame(contact.id, 'call', 'dupe');
      blame(contact.id, 'nr', 'dupe');
    }
    if (contact.doublings) mistakes.push({ failure: 'doubled', cause: 'doubling', aux: [], at: firstAt, call: truth, count: contact.doublings });

    // What the run says about copy, where it can say anything.
    // A logging slip is the log's: the call went out right, and that first call is copy all the same.
    const firstBlamed = callCause !== null && callCause !== 'logging' && NOT_COPY.has(callCause);
    const firstSituation = item?.firstCall?.situation;
    if (item?.firstCall && !firstBlamed && firstSituation !== 'doubled' && firstSituation !== 'unheard') {
      if (firstSituation === 'clean') add(copy, item.firstCall.correct);
      const calling = unique(air.filter((other) => other.at <= firstAt && other.end >= firstAt - CROWD_WINDOW).map((other) => other.station)).length;
      if (calling >= 2) add(crowded, item.firstCall.correct);
    }
    const lineBlame = blamed[contact.id] ?? {};
    if (line && line.verdict !== 'dupe' && callField && !lineBlame.call && callField.cells.every((cell) => cell.situation === 'clean')) add(calls, callField.correct);
    if (line && line.verdict !== 'dupe' && nrField && !lineBlame.nr && nrField.cells.length && nrField.cells.every((cell) => cell.situation === 'clean')) add(serial, nrField.correct);
  }

  // Lines with no contact behind them.
  for (const line of review.lines) {
    if (contactOfLine.has(line.id)) continue;
    if (line.verdict === 'nil') mistakes.push({ failure: 'nil', cause: sentSubjects.has(line.call) ? 'procedure' : 'logging', aux: [], at: line.at, call: line.call });
    else if (line.verdict === 'bust-call') mistakes.push({ failure: 'bust-call', cause: sentSubjects.has(line.call) ? 'reception' : 'logging', aux: [], at: line.at, call: line.their?.station ?? line.call, field: 'call', got: line.call, expected: line.their?.station });
    else if (line.verdict === 'dupe') mistakes.push({ failure: 'dupe', cause: 'dupe', aux: [], at: line.at, call: line.call });
  }

  // Lines only they have: never our copy.
  for (const line of review.theirOnly) {
    if (line.kind === 'dropped') {
      const contact = result.contacts
        .filter((item) => item.truth.call === line.station && item.exchangedAt !== undefined && !item.logIds.length)
        .sort((a, b) => Math.abs(rel(a.exchangedAt ?? 0) - line.at) - Math.abs(rel(b.exchangedAt ?? 0) - line.at))[0];
      const heard = contact ? scoredOf.get(contact.id)?.serialHeard : null;
      const aux: ContestCause[] = [];
      if (heard && heard !== 'clean') aux.push(SITUATION_CAUSE[heard]);
      if (contact?.doublings) aux.push('doubling');
      // Our exchange went to a call we logged right, and this look-alike took it as its own: its slip, not ours.
      const taken = contact && !contact.sentCalls.some((call) => normalizeCall(call) === normalizeCall(line.station))
        ? review.lines.find((item) => item.verdict !== 'dupe' && item.verdict !== 'nil' && contact.sentCalls.some((call) => normalizeCall(call) === normalizeCall(item.call)) && item.their?.station !== line.station)
        : undefined;
      if (taken) mistakes.push({ failure: 'dropped', cause: 'interference', aux: unique(aux), at: line.at, call: line.station, with: taken.call, interferer: 'eager' });
      else mistakes.push({ failure: 'dropped', cause: 'dropped', aux: unique(aux), at: line.at, call: line.station });
    } else {
      mistakes.push({ failure: 'unmatched', cause: 'procedure', aux: [], at: line.at, call: line.station });
    }
  }

  let eager = 0;
  let lid = 0;
  for (const turn of turns.values()) {
    if (turn === 'eager') eager += 1;
    else if (turn === 'lid') lid += 1;
  }

  mistakes.sort((a, b) => a.at - b.at);
  const causes: ContestAnalysis['causes'] = {};
  const failures: ContestAnalysis['failures'] = {};
  for (const mistake of mistakes) {
    causes[mistake.cause] = (causes[mistake.cause] ?? 0) + 1;
    failures[mistake.failure] = (failures[mistake.failure] ?? 0) + 1;
  }
  const lines = review.lines.length;
  const loggingSlips = mistakes.filter((mistake) => mistake.cause === 'logging').length;
  const worked = result.contacts.filter((contact) => contact.exchangedAt !== undefined || contact.logIds.length).length + (failures.abandoned ?? 0);
  const procedureSlips = mistakes.filter((mistake) => mistake.cause === 'procedure' || mistake.cause === 'dropped').length;

  return {
    version: CONTEST_ANALYSIS_VERSION,
    mistakes,
    causes,
    failures,
    copy,
    calls,
    serial,
    crowded,
    similarMet,
    similarRight,
    eager,
    lid,
    timing,
    procedure: { total: Math.max(worked, procedureSlips), correct: Math.max(0, Math.max(worked, procedureSlips) - procedureSlips) },
    logging: { total: lines, correct: Math.max(0, lines - loggingSlips) },
    streak: bestStreak(review.lines),
    blamed,
    evidence: contestEvidence(scored, blamed),
  };
}

/** Most lines checked right in a row: DUPE lines neither count nor break it. */
export function bestStreak(lines: readonly Pick<ReviewLine, 'at' | 'verdict'>[]) {
  let best = 0;
  let run = 0;
  for (const line of [...lines].sort((a, b) => a.at - b.at)) {
    if (line.verdict === 'dupe') continue;
    run = line.verdict === 'ok' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * The run's character evidence without what isn't copy: blamed fields dropped, and of
 * whole calls only the clean ones (shared with callsign). No transmissions: a contest
 * desk never tunes (tuning would read 100 %), and its procedure is ContestSkill's.
 */
function contestEvidence(scored: readonly ContestScoredContact[], blamed: ContestAnalysis['blamed']): QsoEvidence {
  const NO_TX = { total: 0, onFrequency: 0, procedure: 0 };
  const parts = scored.map((item) => {
    const blame = blamed[item.contactId] ?? {};
    const fields = (item.fields ?? []).filter((field) => !blame[field.key as 'call' | 'nr']);
    const evidence = collectEvidence(fields, NO_TX);
    if (!blame.call || blame.call === 'logging') tallyCall(evidence.calls!.first, item.firstCall);
    const clean = (tally: CallTally): CallTally => (tally.clean ? { clean: tally.clean } : {});
    evidence.calls = { log: clean(evidence.calls!.log), first: clean(evidence.calls!.first) };
    return evidence;
  });
  return mergeEvidence(parts, { total: 0, onFrequency: 0, procedure: 0 });
}
