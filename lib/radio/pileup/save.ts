import type { AnswerLog } from '../../types';
import { fieldAnswers } from '../attribution';
import { PILEUP_RST } from '../exchange';
import type { PileupResult } from '../modes/pileupRun';
import type { RunScore } from '../runReview';
import type { PileupTrace, PileupTraceDetail } from '../runTrace';
import { analysePileup, type PileupAnalysis } from './analysis';
import type { DeskStep } from './review';

/**
 * A pileup run as it is stored: one answer per character (the misses a look-alike, a lid
 * or a slip caused carry the blame, so they stay out of copy stats), and the device-only
 * detail the review redraws from.
 */

export const PILEUP_MODE_ID = 'pileup';

export function pileupAnswers(
  result: PileupResult,
  score: RunScore,
  analysis: Pick<PileupAnalysis, 'blamed'>,
  base: { sessionId: string; timestamp: number; wpmOf(stationId: number): number },
): AnswerLog[] {
  return score.contacts.flatMap(({ contactId, fields }) => {
    const contact = result.contacts.find((item) => item.id === contactId);
    if (!fields || !contact) return [];
    return fieldAnswers(fields, {
      sessionId: base.sessionId, contactId, timestamp: base.timestamp, wpm: base.wpmOf(contact.stationId),
      modeId: PILEUP_MODE_ID, presetId: PILEUP_RST.id, alphabet: PILEUP_RST.alphabet,
    }, analysis.blamed[contactId]);
  });
}

export function pileupTraceDetail(level: string, wpm: number, steps: DeskStep[], analysis: PileupAnalysis): PileupTraceDetail {
  const { summary, copy, logging, mistakes } = analysis;
  return { level, wpm, steps, analysis: { summary, copy, logging, mistakes } };
}

/** The causes again from a stored run alone (what the review shows is what was judged). */
export const reanalyse = (trace: PileupTrace) => analysePileup(trace.result, trace.pileup.steps, {
  contacts: trace.scored, evidence: trace.evidence, fields: trace.scored.flatMap((contact) => contact.fields ?? []),
});
