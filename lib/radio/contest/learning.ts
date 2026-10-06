import type { AnswerLog, ContestSkill, QsoContestAnalysisSummary, QsoProfile, SkillEstimate } from '../../types';
import { collectEvidence, fieldAnswers } from '../attribution';
import type { RunOutcome } from '../badges';
import type { Axis, AxisVotes } from '../difficulty';
import { ewma } from '../skills';
import type { ContestAnalysis, Tally } from './analysis';
import type { ContestReview, ReviewSource } from './review';
import type { ContestScoredContact } from './score';
import { CONTEST_CALL } from './score';

/**
 * A contest run into the learning system: its own skills, おまかせ by cause, the answers
 * and the numbers its badges count. Each axis moves only on its own evidence:
 *
 *   first calls in the clear              → speed
 *   first calls with several keying       → density (how many call a minute)
 *   look-alikes mixed up                  → similar
 *   weak-signal characters                → weak
 *   serials in the clear                  → serial (cut numbers, big numbers)
 *   QRM / QSB / QRN                       → the robustness skill only (no contest axis)
 *   our doublings, lids                   → the timing skill / nothing: never easier
 *   procedure, logging, DUPE, dropped     → their skills only: never read as copy
 *
 * The rest of the level (stack, pitch spread, manners, timing, pressure, dupes) stays
 * where the level put it. One bad run moves nothing: votes need two runs in a row, as
 * every mode's おまかせ (difficulty.ts).
 */

/** The axes おまかせ moves in a contest; the rest stay where the level put them. */
export const CONTEST_ADAPT_AXES = ['speed', 'density', 'similar', 'weak', 'serial'] as const satisfies readonly Axis[];

const MIN_CALLS = 4;
const MIN_ENV = 4;
/** Copy in the clear this good: a loss elsewhere is the crowd's, the band's or the numbers', not the ear's. */
const COPY_HOLDS = 0.8;
const rate = (tally: Tally) => tally.correct / tally.total;

/** Per-axis vote from one contest run: +1 harder, −1 easier (see the table above). */
export function voteContestAxes(analysis: ContestAnalysis): AxisVotes {
  const votes: AxisVotes = {};
  const { causes, copy, crowded, serial, evidence } = analysis;
  const copyOk = copy.total >= MIN_CALLS ? rate(copy) : null;
  if (copyOk !== null) {
    if (copyOk >= 0.9) votes.speed = 1;
    else if (copyOk < 0.7) votes.speed = -1;
  }
  // Several keying at once: only the crowd's fault when copy in the clear holds up.
  if (crowded.total >= MIN_CALLS) {
    const ok = rate(crowded);
    if (ok < 0.6 && (copyOk ?? 1) >= COPY_HOLDS) votes.density = -1;
    else if (ok >= 0.85 && !causes.overlap) votes.density = 1;
  }
  if ((causes.similar ?? 0) >= 2) votes.similar = -1;
  else if (analysis.similarMet >= 3 && !causes.similar) votes.similar = 1;
  const weak = evidence.env.weak;
  if (weak && weak.total >= MIN_ENV) {
    const ok = weak.correct / weak.total;
    if (ok < 0.6 && (copyOk ?? 1) >= COPY_HOLDS) votes.weak = -1;
    else if (ok >= 0.9 && !causes.weak) votes.weak = 1;
  } else if ((causes.weak ?? 0) >= 2) votes.weak = -1;
  // Serials in the clear: the numbers' fault only when calls are copied fine.
  if (serial.total >= MIN_CALLS) {
    const ok = rate(serial);
    if (ok < 0.7 && (copyOk ?? 1) >= COPY_HOLDS) votes.serial = -1;
    else if (ok >= 0.9) votes.serial = 1;
  }
  return votes;
}

const round = (estimate: SkillEstimate): SkillEstimate => ({ value: Math.round(estimate.value * 1000) / 1000, n: estimate.n });
const fold = (prior: SkillEstimate | undefined, tally: Tally, per: number) =>
  (tally.total ? round(ewma(prior, tally.correct / tally.total, Math.min(1, tally.total / per))) : prior);

/** The contest skills, each from its own numbers (the shared ones go through updateSkills). */
export function updateContestSkills(profile: QsoProfile, analysis: ContestAnalysis, modeId = 'contest'): QsoProfile {
  const prior: ContestSkill = profile.skills.contest ?? {};
  const next: ContestSkill = {
    call: fold(prior.call, analysis.copy, 4),
    serial: fold(prior.serial, analysis.serial, 4),
    overlap: fold(prior.overlap, analysis.crowded, 4),
    similar: fold(prior.similar, { total: analysis.similarMet, correct: analysis.similarRight }, 3),
    timing: fold(prior.timing, analysis.timing, 8),
    procedure: fold(prior.procedure, analysis.procedure, 8),
    logging: fold(prior.logging, analysis.logging, 8),
  };
  const skill = Object.fromEntries(Object.entries(next).filter(([, value]) => value)) as ContestSkill;
  // The mode's procedure as every mode keeps it (skills.procedure), from the same tally.
  const procedure = fold(profile.skills.procedure[modeId], analysis.procedure, 8);
  return { ...profile, skills: { ...profile.skills, contest: skill, procedure: { ...profile.skills.procedure, ...(procedure ? { [modeId]: procedure } : {}) } } };
}

/** What a contest adds to its badges' counters. */
export interface ContestOutcome {
  /** Lines checked ok. */
  qsos: number;
  /** Longest run of lines checked ok (no BUST / NIL between). */
  streak: number;
  /** Lines checked ok an hour over the whole run. */
  rate: number;
  seconds: number;
  lines: number;
  /** BUST, NIL and dropped contacts together. */
  faults: number;
}

export function contestOutcome(review: ContestReview, analysis: Pick<ContestAnalysis, 'streak'>): ContestOutcome {
  const dropped = review.theirOnly.filter((line) => line.kind === 'dropped').length;
  return {
    qsos: review.counts.ok,
    streak: analysis.streak,
    rate: review.seconds > 0 ? Math.round((review.counts.ok * 3600) / review.seconds) : 0,
    seconds: review.seconds,
    lines: review.lines.length,
    faults: review.counts['bust-call'] + review.counts['bust-nr'] + review.counts.nil + dropped,
  };
}

/** Digits a station may key as letters: these characters are the contest's notation, not the alphabet. */
const CUT_LETTER = /^[A-Z]$/;
/** The blame cut-number characters carry: kept, but out of character-confusion stats. */
export const CUT_BLAME = 'cut-number';

/**
 * One answer per character, the way pileups store them. Misses that weren't copy carry
 * the blame (they stay out of weak-character analysis). A serial's cut letters (T for 0,
 * N for 9 …) carry `cut-number`: what we typed for them is a digit, the letter we heard
 * is only inferred, so they never become a letter confusion.
 */
export function contestAnswers(
  result: Pick<ReviewSource, 'contacts'>,
  scored: readonly ContestScoredContact[],
  analysis: Pick<ContestAnalysis, 'blamed'>,
  base: { sessionId: string; timestamp: number; modeId: string; presetId: string; wpmOf(stationId: number): number },
): AnswerLog[] {
  return scored.flatMap(({ contactId, fields }) => {
    const contact = result.contacts.find((item) => item.id === contactId);
    if (!fields || !contact) return [];
    const answers = fieldAnswers(fields, {
      sessionId: base.sessionId, contactId, timestamp: base.timestamp, wpm: base.wpmOf(contact.stationId),
      modeId: base.modeId, presetId: base.presetId, alphabet: CONTEST_CALL.alphabet,
    }, analysis.blamed[contactId]);
    return answers.map((answer) => (answer.qso?.field === 'nr' && !answer.qso.blame && CUT_LETTER.test(answer.correctSymbol)
      ? { ...answer, qso: { ...answer.qso, blame: CUT_BLAME } }
      : answer));
  });
}

/**
 * Each contact as the shared QSO counters see it: blamed fields left out, and a serial
 * only when every keyed character was a digit (a cut letter isn't a letter copied).
 */
export function contestContacts(
  result: Pick<ReviewSource, 'contacts'>,
  scored: readonly ContestScoredContact[],
  analysis: Pick<ContestAnalysis, 'blamed'>,
  wpmOf: (stationId: number) => number,
): RunOutcome['contacts'] {
  return scored.flatMap(({ contactId, fields }) => {
    const contact = result.contacts.find((item) => item.id === contactId);
    if (!fields || !contact) return [];
    const blame = analysis.blamed[contactId] ?? {};
    const kept = fields.filter((field) => !blame[field.key as 'call' | 'nr'] && !(field.key === 'nr' && field.cells.some((cell) => CUT_LETTER.test(cell.expected))));
    return [{ fields: kept, evidence: collectEvidence(kept, { total: 0, onFrequency: 0, procedure: 0 }), wpm: wpmOf(contact.stationId), complete: contact.outcome === 'complete' }];
  });
}

/** The synced counts of an analysis. */
export function analysisSummary(analysis: ContestAnalysis): QsoContestAnalysisSummary {
  const pair = (tally: Tally): [number, number] => [tally.correct, tally.total];
  return {
    version: analysis.version,
    causes: { ...analysis.causes },
    failures: { ...analysis.failures },
    copy: pair(analysis.copy),
    serial: pair(analysis.serial),
    crowded: pair(analysis.crowded),
    similar: [analysis.similarRight, analysis.similarMet],
    eager: analysis.eager,
    lid: analysis.lid,
    streak: analysis.streak,
  };
}
