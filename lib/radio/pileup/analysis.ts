import type { CopySituation, PileupCause, PileupCrowd, QsoPileupSummary } from '../../types';
import { callOfFields, collectEvidence, mergeEvidence, tallyCall, type FieldResult } from '../attribution';
import { callDistance, isNearCall, matchesPartial } from '../air/intent';
import type { CallTally, QsoEvidence } from '../difficulty';
import type { PileupResult } from '../modes/pileupRun';
import type { JudgedContact } from '../modes/runCore';
import type { ClockNow, CopyMonitor, RxRecord } from '../conditions';
import { PILEUP_RST } from '../exchange';
import { cleanRate, scoreRun, type RunScore } from '../runReview';
import { pickGroups, responderRole, reviewStats, type CallerSnap, type DeskStep, type PickGroup } from './review';

/**
 * What a pileup run says about the operator, cause by cause. Every miss gets the one
 * reason it went wrong where it did — our copy, the pile calling at once, a weak or
 * noisy signal, our call keyed over the station (a doubling: it never heard us), a
 * look-alike on the frequency, an eager or lid caller answering out of turn, procedure
 * or the log — so a look-alike or a lid never counts as poor copy, and a doubling never
 * as a copy error at all.
 *
 * Built from what the review keeps (the books, our messages with the frequency around
 * them, each contact scored), so a stored run gives the same answer again.
 */

export type MistakeNote = 'first-call' | 'bust' | 'nil' | 'doubled' | 'dupe' | 'report' | 'no-closing' | 'unlogged' | 'dropped';

export interface PileupMistake {
  cause: PileupCause;
  note: MistakeNote;
  /** When it went out (the run's clock). */
  at: number;
  /** The station it was about (truth), or the call logged for a NIL. */
  call: string;
  /** What we sent or logged instead. */
  sent?: string;
  /** The other station it was mixed up with (a look-alike, a lid). */
  with?: string;
}

export interface Tally { total: number; correct: number }

export interface PileupAnalysis {
  summary: Omit<QsoPileupSummary, 'level'>;
  /** First calls right, judged in the clear (pure copy): what moves the speed. */
  copy: Tally;
  /** Log lines (and contacts never logged) without a slip. */
  logging: Tally;
  mistakes: PileupMistake[];
  /** Fields whose characters are not the copy's fault (a look-alike, a lid, a slip), per contact. */
  blamed: Record<string, Partial<Record<string, PileupCause>>>;
  /** Character evidence for skills and おまかせ: blamed fields left out, only clean whole calls kept for callsign. */
  evidence: QsoEvidence;
}

/** What a character's situation makes of a miss. */
const SITUATION_CAUSE: Record<CopySituation, PileupCause> = {
  clean: 'reception', weak: 'weak', qsb: 'environment', qrn: 'environment', qrm: 'environment',
  overlap: 'overlap', doubled: 'doubling', detuned: 'reception', unheard: 'procedure',
};
/** Causes that aren't the operator's copy: the contact's characters stay out of copy evidence. */
const NOT_COPY: ReadonlySet<PileupCause> = new Set(['similar', 'interference', 'logging', 'procedure']);

export const crowdOf = (stations: number): PileupCrowd => (stations >= 3 ? '3+' : stations === 2 ? '2' : '1');

const isPick = (step: DeskStep) => step.kind === 'pick' || step.kind === 'correct';
const empty = (): Tally => ({ total: 0, correct: 0 });
const add = (tally: Tally, correct: boolean) => {
  tally.total += 1;
  tally.correct += correct ? 1 : 0;
};

/** Everyone on the frequency around a message: the callers seen as it went out and whoever answered. */
function around(step: DeskStep | undefined, previous: DeskStep | undefined): CallerSnap[] {
  if (!step) return [];
  const out = new Map(step.callers.map((caller) => [caller.id, caller]));
  for (const responder of [...(previous?.responders ?? []), ...step.responders]) {
    if (!out.has(responder.id)) out.set(responder.id, { id: responder.id, call: responder.call, offsetHz: 0, db: 0, wpm: 0, style: '', traits: [], state: '' });
  }
  return [...out.values()];
}

/**
 * Another station on the frequency our wrong call is at least as close to as to the
 * right one: the call was mixed up with it, not just misheard.
 */
function lookAlikeFor(truth: string, truthId: number, sent: string, stations: CallerSnap[]): CallerSnap | null {
  let best: CallerSnap | null = null;
  for (const station of stations) {
    if (station.id === truthId || station.call === truth) continue;
    const close = station.call === sent || (isNearCall(sent, station.call) && callDistance(sent, station.call) <= callDistance(sent, truth));
    if (close && (!best || callDistance(sent, station.call) < callDistance(sent, best.call))) best = station;
  }
  return best;
}

/** It answered out of turn in this pick: a partial it didn't fit, or into a call that wasn't its own. */
const outOfTurn = (group: PickGroup | undefined, id: number) =>
  Boolean(group?.steps.some((step, index) => step.responders.some((responder) => {
    if (responder.id !== id) return false;
    const role = responderRole(step, responder.call, responder.id, group.steps.slice(0, index));
    return role === 'off' || (role === 'near' && step.kind === 'partial');
  })));

export function analysePileup(result: PileupResult, steps: readonly DeskStep[], score: RunScore): PileupAnalysis {
  const groups = pickGroups(steps, result);
  const stats = reviewStats(groups, result);
  const groupOf = new Map<DeskStep, PickGroup>();
  for (const group of groups) for (const step of group.steps) groupOf.set(step, group);
  const indexOf = new Map(steps.map((step, index) => [step, index]));
  const stepAt = (at: number | undefined) => (at === undefined ? undefined : steps.find((step) => step.at === at));
  const previousOf = (step: DeskStep | undefined) => (step ? steps[(indexOf.get(step) ?? 0) - 1] : undefined);
  const scoredOf = new Map(score.contacts.map((item) => [item.contactId, item]));

  const mistakes: PileupMistake[] = [];
  const blamed: PileupAnalysis['blamed'] = {};
  const firstCall: Partial<Record<PileupCrowd, Tally>> = {};
  const copy = empty();
  let similarMet = 0;
  let similarRight = 0;

  /** Why a call we sent wasn't the station's. */
  const classify = (contact: JudgedContact, sent: string, step: DeskStep | undefined, situation: CopySituation) => {
    const other = lookAlikeFor(contact.truth.call, contact.stationId, sent, around(step, previousOf(step)));
    if (other) return { cause: (outOfTurn(step && groupOf.get(step), other.id) ? 'interference' : 'similar') as PileupCause, with: other.call };
    return { cause: SITUATION_CAUSE[situation], with: undefined };
  };

  for (const contact of result.contacts) {
    const scored = scoredOf.get(contact.id);
    const truth = contact.truth.call;
    const step = stepAt(contact.sentAt[0]);
    const firstSituation = scored?.firstCall?.situation ?? 'clean';
    const logged = scored?.fields ? callOfFields(scored.fields) : null;
    const right = contact.outcome === 'complete' && Boolean(logged?.correct);
    const blame: Partial<Record<string, PileupCause>> = {};

    if (step && around(step, previousOf(step)).some((station) => station.id !== contact.stationId && (isNearCall(truth, station.call) || isNearCall(station.call, truth)))) {
      similarMet += 1;
      if (right) similarRight += 1;
    }

    const first = contact.sentCalls[0];
    const last = contact.sentCalls[contact.sentCalls.length - 1];
    let callCause: PileupCause | null = null;
    if (first !== undefined && first !== truth) {
      const why = classify(contact, first, step, firstSituation);
      callCause = why.cause;
      mistakes.push({ cause: why.cause, note: contact.outcome === 'bust' ? 'bust' : 'first-call', at: contact.sentAt[0], call: truth, sent: first, with: why.with });
    } else if (contact.outcome === 'bust' && last !== undefined) {
      const lastStep = stepAt(contact.sentAt[contact.sentAt.length - 1]);
      const why = classify(contact, last, lastStep, logged?.situation ?? firstSituation);
      callCause = why.cause;
      mistakes.push({ cause: why.cause, note: 'bust', at: contact.sentAt[contact.sentAt.length - 1], call: truth, sent: last, with: why.with });
    }
    if (callCause && NOT_COPY.has(callCause)) blame.call = callCause;

    // Our first copy, where it can say anything about copy: not mixed up, not lost to our own keying.
    if (scored?.firstCall && !blame.call && firstSituation !== 'doubled' && firstSituation !== 'unheard') {
      const previous = previousOf(step);
      const answered = new Set(previous?.responders.map((responder) => responder.id) ?? []).size;
      add((firstCall[crowdOf(answered)] ??= empty()), scored.firstCall.correct);
      if (firstSituation === 'clean') add(copy, scored.firstCall.correct);
    }

    const report = scored?.fields?.find((field) => field.key === 'rst');
    if (report && !report.correct && report.input) {
      blame.rst = 'logging';
      mistakes.push({ cause: 'logging', note: 'report', at: contact.closedAt ?? contact.exchangedAt ?? contact.startedAt, call: truth, sent: report.input });
    }
    if (contact.outcome === 'no-closing' || (contact.outcome === 'incomplete' && contact.logIds.length)) {
      mistakes.push({ cause: 'procedure', note: 'no-closing', at: contact.exchangedAt ?? contact.startedAt, call: truth });
    }
    if (Object.keys(blame).length) blamed[contact.id] = blame;
  }

  for (const id of result.unlogged) {
    const contact = result.contacts.find((item) => item.id === id);
    if (contact) mistakes.push({ cause: 'logging', note: 'unlogged', at: contact.exchangedAt ?? contact.startedAt, call: contact.truth.call });
  }
  const sentCalls = new Set(steps.filter(isPick).map((step) => step.subject));
  for (const entry of result.log) {
    // A NIL: a call put on the air but nobody worked under it (logged without a reply), or one never sent.
    if (entry.verdict === 'nil') mistakes.push({ cause: sentCalls.has(entry.fields.call) ? 'procedure' : 'logging', note: 'nil', at: entry.at, call: entry.fields.call });
    if (entry.verdict === 'dupe') mistakes.push({ cause: 'logging', note: 'dupe', at: entry.at, call: entry.fields.call });
  }
  for (const step of steps) {
    if (isPick(step) && step.over?.some((tx) => tx.call === step.subject)) mistakes.push({ cause: 'doubling', note: 'doubled', at: step.at, call: step.subject! });
  }

  let eager = 0;
  let lid = 0;
  for (const group of groups) {
    group.steps.forEach((step, index) => {
      for (const responder of step.responders) {
        const role = responderRole(step, responder.call, responder.id, group.steps.slice(0, index));
        if (role === 'near' && step.kind === 'partial') eager += 1;
        else if (role === 'off') lid += 1;
      }
    });
  }
  let narrowings = 0;
  let narrowed = 0;
  for (const group of groups) {
    if (group.moves === null) {
      // Given up on: a lid or an eager caller answering out of turn got in the way.
      const interferer = group.steps.flatMap((step, index) => step.responders.filter((responder) => {
        const role = responderRole(step, responder.call, responder.id, group.steps.slice(0, index));
        return role === 'off' || (role === 'near' && step.kind === 'partial');
      }))[0];
      if (group.partials && interferer) mistakes.push({ cause: 'interference', note: 'dropped', at: group.steps[0].at, call: interferer.call });
      continue;
    }
    if (!group.partials) continue;
    narrowings += 1;
    // Worked right, and one of our pieces fit it (a later piece may be a miscopy of the same station).
    const pieces = group.steps.filter((step) => step.kind === 'partial' && step.subject).map((step) => step.subject!);
    const worked = group.contacts.some((contact) => {
      const fields = scoredOf.get(contact.id)?.fields;
      return contact.outcome === 'complete' && fields && callOfFields(fields)?.correct && pieces.some((piece) => matchesPartial(contact.truth.call, piece));
    });
    if (worked) narrowed += 1;
  }

  const causes: Partial<Record<PileupCause, number>> = {};
  for (const mistake of mistakes) causes[mistake.cause] = (causes[mistake.cause] ?? 0) + 1;
  mistakes.sort((a, b) => a.at - b.at);
  const lines = result.log.length + result.unlogged.length;
  const slips = mistakes.filter((mistake) => mistake.cause === 'logging' || mistake.note === 'nil').length;

  return {
    summary: {
      picks: stats.picks,
      doubledPicks: stats.doubledPicks,
      partials: stats.partials,
      emptyPartials: stats.emptyPartials,
      crowdedPartials: stats.crowdedPartials,
      narrowings,
      narrowed,
      firstCall,
      similarMet,
      similarRight,
      hijacks: result.stats.hijacks,
      eager,
      lid,
      causes,
      cleanRate: Math.round(cleanRate(result, score)),
    },
    copy,
    logging: { total: lines, correct: Math.max(0, lines - slips) },
    mistakes,
    blamed,
    evidence: pileupEvidence(score, blamed, { total: steps.length, procedure: causes.procedure ?? 0 }),
  };
}

/**
 * The run's character evidence without what isn't copy: blamed fields dropped, and of
 * whole calls only the clean ones (shared with callsign) — a call picked out of a pile
 * stays the pileup's.
 */
function pileupEvidence(score: RunScore, blamed: PileupAnalysis['blamed'], tx: { total: number; procedure: number }): QsoEvidence {
  const NO_TX = { total: 0, onFrequency: 0, procedure: 0 };
  const parts = score.contacts.map((contact) => {
    const blame = blamed[contact.contactId] ?? {};
    const fields = (contact.fields ?? []).filter((field: FieldResult) => !blame[field.key]);
    const evidence = collectEvidence(fields, NO_TX);
    if (!blame.call) tallyCall(evidence.calls!.first, contact.firstCall);
    const clean = (tally: CallTally): CallTally => (tally.clean ? { clean: tally.clean } : {});
    evidence.calls = { log: clean(evidence.calls!.log), first: clean(evidence.calls!.first) };
    return evidence;
  });
  return mergeEvidence(parts, { total: tx.total, onFrequency: tx.total, procedure: tx.procedure });
}

export interface PileupJudgeInput {
  result: PileupResult;
  /** Steps as StepRecorder.finish() gives them. */
  steps: readonly DeskStep[];
  recordsOf(stationId: number): RxRecord[];
  monitor: CopyMonitor;
  now: ClockNow;
}

/** QRT: every contact scored character by character (as a CQ run), then the pileup's causes. */
export function judgePileup({ result, steps, recordsOf, monitor, now }: PileupJudgeInput) {
  const score = scoreRun({ result, preset: PILEUP_RST, recordsOf, monitor, now, tx: { total: steps.length, procedure: 0 } });
  return { score, analysis: analysePileup(result, steps, score) };
}
