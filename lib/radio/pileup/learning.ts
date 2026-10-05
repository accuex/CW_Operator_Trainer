import type { PileupSkill, QsoContactSummary, QsoProfile, QsoSessionSummary, SkillEstimate } from '../../types';
import { callOfFields, collectEvidence } from '../attribution';
import type { RunOutcome } from '../badges';
import type { Axis, AxisVotes, DifficultyVector } from '../difficulty';
import type { PileupResult } from '../modes/pileupRun';
import type { RunScore } from '../runReview';
import { ewma } from '../skills';
import type { PileupAnalysis, Tally } from './analysis';

/**
 * A pileup run into the learning system: its own skills, おまかせ by cause, the synced
 * summary and the numbers its badges count. Each skill and each axis moves only on
 * its own evidence:
 *
 *   pure copy (first calls in the clear)  → speed
 *   first calls out of several at once    → pile (how many call)
 *   look-alikes mixed up                  → similar
 *   weak-signal characters                → weak
 *   partials that fit several, picks lost → stack (how close in pitch they call)
 *   our doublings                         → the timing skill only, never easier
 *   procedure / log slips                 → their skills only
 *   eager / lid interference              → nothing: it isn't our copy
 */

/** The axes おまかせ moves in a pileup; the rest stay where the level put them. */
export const PILEUP_ADAPT_AXES = ['speed', 'pile', 'similar', 'weak', 'stack'] as const satisfies readonly Axis[];

const MIN_CALLS = 4;
const MIN_ENV = 4;
/** Copy in the clear this good: a loss elsewhere is the pile's or the band's, not our ear's. */
const COPY_HOLDS = 0.8;
const rate = (tally: Tally) => tally.correct / tally.total;

export const crowdedTally = (analysis: Pick<PileupAnalysis, 'summary'>): Tally => {
  const { firstCall } = analysis.summary;
  return {
    total: (firstCall['2']?.total ?? 0) + (firstCall['3+']?.total ?? 0),
    correct: (firstCall['2']?.correct ?? 0) + (firstCall['3+']?.correct ?? 0),
  };
};

/** Per-axis vote from one pileup run: +1 harder, −1 easier (see the table above). */
export function votePileupAxes(analysis: PileupAnalysis): AxisVotes {
  const votes: AxisVotes = {};
  const { summary, copy, evidence } = analysis;
  const causes = summary.causes;
  const copyOk = copy.total >= MIN_CALLS ? rate(copy) : null;
  if (copyOk !== null) {
    if (copyOk >= 0.9) votes.speed = 1;
    else if (copyOk < 0.7) votes.speed = -1;
  }
  // Out of several at once: only the pile's fault when copy in the clear holds up.
  const crowded = crowdedTally(analysis);
  if (crowded.total >= MIN_CALLS) {
    const ok = rate(crowded);
    if (ok < 0.6 && (copyOk ?? 1) >= COPY_HOLDS) votes.pile = -1;
    else if (ok >= 0.85 && (causes.overlap ?? 0) === 0) votes.pile = 1;
  }
  if ((causes.similar ?? 0) >= 2) votes.similar = -1;
  else if (summary.similarMet >= 3 && !causes.similar) votes.similar = 1;
  const weak = evidence.env.weak;
  if (weak && weak.total >= MIN_ENV) {
    const ok = weak.correct / weak.total;
    if (ok < 0.6 && (copyOk ?? 1) >= COPY_HOLDS) votes.weak = -1;
    else if (ok >= 0.9 && !causes.weak) votes.weak = 1;
  } else if ((causes.weak ?? 0) >= 2) votes.weak = -1;
  // Narrowing down: partials that fit several, or picks begun with a partial that didn't end in the right station.
  if (summary.partials >= 3) {
    const narrowing = summary.narrowings ? summary.narrowed / summary.narrowings : null;
    if (summary.crowdedPartials > summary.partials / 2 || (summary.narrowings >= 2 && narrowing! < 0.4)) votes.stack = -1;
    else if (summary.narrowings >= 3 && narrowing! >= 0.8 && summary.crowdedPartials <= summary.partials / 3) votes.stack = 1;
  }
  return votes;
}

const round = (estimate: SkillEstimate): SkillEstimate => ({ value: Math.round(estimate.value * 1000) / 1000, n: estimate.n });
const fold = (prior: SkillEstimate | undefined, tally: Tally, per: number) =>
  (tally.total ? round(ewma(prior, tally.correct / tally.total, Math.min(1, tally.total / per))) : prior);

/** The pileup skills, each from its own numbers (the shared ones go through updateSkills). */
export function updatePileupSkills(profile: QsoProfile, analysis: PileupAnalysis): QsoProfile {
  const prior: PileupSkill = profile.skills.pileup ?? {};
  const { summary } = analysis;
  const next: PileupSkill = {
    copy: fold(prior.copy, analysis.copy, 4),
    overlap: fold(prior.overlap, crowdedTally(analysis), 4),
    narrowing: fold(prior.narrowing, { total: summary.narrowings, correct: summary.narrowed }, 4),
    similar: fold(prior.similar, { total: summary.similarMet, correct: summary.similarRight }, 3),
    timing: fold(prior.timing, { total: summary.picks, correct: summary.picks - summary.doubledPicks }, 8),
    logging: fold(prior.logging, analysis.logging, 8),
  };
  const skill = Object.fromEntries(Object.entries(next).filter(([, value]) => value)) as PileupSkill;
  return { ...profile, skills: { ...profile.skills, pileup: skill } };
}

/** What a pileup adds to its badges' counters. */
export interface PileupOutcome {
  /** Complete contacts logged right. */
  contacts: number;
  narrowed: number;
  /** Complete contacts logged right with a look-alike on the frequency. */
  similar: number;
  seconds: number;
  picks: number;
  doubledPicks: number;
  cleanRate: number;
}

export function pileupOutcome(result: PileupResult, score: RunScore, analysis: PileupAnalysis): PileupOutcome {
  const right = result.contacts.filter((contact) => {
    const fields = score.contacts.find((item) => item.contactId === contact.id)?.fields;
    return contact.outcome === 'complete' && fields && callOfFields(fields)?.correct;
  }).length;
  return {
    contacts: right,
    narrowed: analysis.summary.narrowed,
    similar: analysis.summary.similarRight,
    seconds: result.stats.seconds,
    picks: analysis.summary.picks,
    doubledPicks: analysis.summary.doubledPicks,
    cleanRate: analysis.summary.cleanRate,
  };
}

/**
 * Each contact as the shared QSO counters see it: fields that weren't our copy's doing
 * (a look-alike, a lid, a slip) left out, so they never count against copy or callsign.
 */
export function pileupContacts(result: PileupResult, score: RunScore, analysis: PileupAnalysis, wpmOf: (stationId: number) => number): RunOutcome['contacts'] {
  return score.contacts.flatMap(({ contactId, fields }) => {
    const contact = result.contacts.find((item) => item.id === contactId);
    if (!fields || !contact) return [];
    const blame = analysis.blamed[contactId] ?? {};
    const kept = fields.filter((field) => !blame[field.key]);
    return [{ fields: kept, evidence: collectEvidence(kept, { total: 0, onFrequency: 0, procedure: 0 }), wpm: wpmOf(contact.stationId), complete: contact.outcome === 'complete' }];
  });
}

export interface PileupSummaryInput {
  result: PileupResult;
  score: RunScore;
  analysis: PileupAnalysis;
  level: string;
  modeId: string;
  presetId: string;
  fieldCount: number;
  difficulty: Partial<DifficultyVector>;
  wallClock(t: number): number;
}

/** The synced summary: per contact and the run's numbers — counts only, no trace. */
export function pileupSummary({ result, score, analysis, level, modeId, presetId, fieldCount, difficulty, wallClock }: PileupSummaryInput): QsoSessionSummary {
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
  const { evidence } = analysis;
  return {
    modeId,
    presetId,
    call: contacts[0]?.call ?? '',
    outcome: contacts.some((contact) => contact.outcome === 'complete') ? 'complete' : 'partial',
    fields: contacts.reduce((sum, contact) => sum + contact.fields, 0),
    fieldsCorrect: contacts.reduce((sum, contact) => sum + contact.fieldsCorrect, 0),
    cleanAccuracy: evidence.clean.total ? evidence.clean.correct / evidence.clean.total : null,
    causes: evidence.causes,
    difficulty: { ...difficulty } as Record<string, number>,
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
      callers: result.stats.callers,
      doublings: result.stats.doublings,
      cleanRate: analysis.summary.cleanRate,
    },
    pileup: { level, ...analysis.summary },
  };
}
