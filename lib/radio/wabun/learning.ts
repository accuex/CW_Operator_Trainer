import type { FollowSkill, QsoProfile, SkillEstimate } from '../../types';
import { ewma, updateSkills } from '../skills';
import type { WabunProcedure } from './procedure';
import { FOLLOW_PATHS, type WabunEvidence } from './review';

/**
 * A wabun QSO into the skills, each from its own evidence and nothing else:
 *
 *   skills.copy.wabun            memo characters under clean conditions (shared with the
 *                                other wabun copy: character by character). No memo: untouched.
 *   skills.follow.wabun          facts followed of those that reached us (FollowSkill).
 *   skills.procedure[modeId]     overs without a procedure slip; skills.tuning: on frequency.
 *
 * A procedure slip never lowers copy or follow; a fact keyed under our TX is in neither.
 * No difficulty axis moves (no adaptive difficulty yet).
 */

const round = (estimate: SkillEstimate): SkillEstimate => ({ value: Math.round(estimate.value * 1000) / 1000, n: estimate.n });

export function updateFollow(prior: FollowSkill | undefined, follow: WabunEvidence['follow.wabun']): FollowSkill {
  const paths = { ...Object.fromEntries(FOLLOW_PATHS.map((path) => [path, 0])), ...prior?.paths } as FollowSkill['paths'];
  for (const path of FOLLOW_PATHS) paths[path] += follow.paths[path];
  const base = { paths, qsos: (prior?.qsos ?? 0) + 1 };
  // Nothing reached us: the paths say so, the estimates stay.
  if (!follow.total) return { value: prior?.value ?? 0, n: prior?.n ?? 0, ...(prior?.first ? { first: prior.first } : {}), ...base };
  const weight = Math.min(1, follow.total / 4);
  const value = round(ewma(prior?.n ? prior : undefined, follow.correct / follow.total, weight));
  return { ...value, first: round(ewma(prior?.first, follow.first / follow.total, weight)), ...base };
}

export function updateWabunSkills(profile: QsoProfile, { modeId, evidence, procedure }: { modeId: string; evidence: WabunEvidence; procedure: WabunProcedure }): QsoProfile {
  const copy = evidence['copy.wabun'];
  const shared = updateSkills(profile, {
    modeId,
    alphabet: 'wabun',
    wpm: copy?.wpm ?? 0,
    evidence: {
      clean: copy?.clean ?? { total: 0, correct: 0 },
      env: {},
      causes: { copy: 0, environment: 0, doubling: 0, tuning: 0, timing: 0, procedure: procedure.slips },
      tx: { total: procedure.overs, onFrequency: procedure.onFrequency },
    },
  });
  const follow = { ...shared.skills.follow, wabun: updateFollow(shared.skills.follow?.wabun, evidence['follow.wabun']) };
  return { ...shared, skills: { ...shared.skills, follow } };
}
