import type { AlphabetType, CallSkillBuckets, CallsignSkill, CopySituation, QsoEnvCondition, QsoModeProgress, QsoProfile, SkillEstimate } from '../types';
import { DEFAULT_DIFFICULTY, normalizeDifficulty, type CallTally, type DifficultyVector } from './difficulty';
import type { QsoEvidence } from './difficulty';

/**
 * QSO skills live beside — not inside — the card collection. They feed the
 * recommended stage and, later, badges; they never gate cards or modes.
 */

export const emptyQsoProfile = (): QsoProfile => ({ version: 1, skills: { copy: {}, robustness: {}, procedure: {} }, modes: {} });

export function normalizeQsoProfile(raw: QsoProfile | undefined): QsoProfile {
  const base = emptyQsoProfile();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    skills: { ...base.skills, ...raw.skills, copy: { ...raw.skills?.copy }, robustness: { ...raw.skills?.robustness }, procedure: { ...raw.skills?.procedure } },
    modes: { ...raw.modes },
  };
}

export function modeProgress(profile: QsoProfile, modeId: string, seed?: Partial<DifficultyVector>): QsoModeProgress {
  const stored = profile.modes[modeId];
  return {
    qsos: stored?.qsos ?? 0,
    perfect: stored?.perfect ?? 0,
    lastAt: stored?.lastAt ?? 0,
    difficulty: normalizeDifficulty(stored?.difficulty, { ...DEFAULT_DIFFICULTY, ...seed }),
    pinned: stored?.pinned ?? [],
    auto: stored?.auto ?? true,
    votes: stored?.votes ?? {},
    ...(stored?.level ? { level: stored.level } : {}),
  };
}

/** EWMA that trusts early evidence more (≈ running mean until n reaches 1/alpha). */
export function ewma(prior: SkillEstimate | undefined, sample: number, weight = 1, alpha = 0.15): SkillEstimate {
  if (!prior || prior.n === 0) return { value: sample, n: weight };
  const k = Math.max(alpha, weight / (prior.n + weight));
  return { value: prior.value + (sample - prior.value) * k, n: prior.n + weight };
}

const round = (estimate: SkillEstimate): SkillEstimate => ({ value: Math.round(estimate.value * 1000) / 1000, n: estimate.n });

export const emptyCallsign = (): CallsignSkill => ({ log: { situations: {} }, first: { situations: {} } });

/** One run's calls into the buckets: each call is one sample, clean calls apart from the rest. */
function foldCalls(prior: CallSkillBuckets | undefined, tally: CallTally): CallSkillBuckets {
  const out: CallSkillBuckets = { ...prior, situations: { ...prior?.situations } };
  for (const [situation, bucket] of Object.entries(tally) as [CopySituation, { total: number; correct: number }][]) {
    if (!bucket.total) continue;
    const sample = bucket.correct / bucket.total;
    if (situation === 'clean') out.clean = round(ewma(out.clean, sample, bucket.total));
    else out.situations[situation] = round(ewma(out.situations[situation], sample, bucket.total));
  }
  return out;
}

export function updateSkills(
  profile: QsoProfile,
  { modeId, alphabet, wpm, evidence }: { modeId: string; alphabet: AlphabetType; wpm: number; evidence: QsoEvidence },
): QsoProfile {
  const skills = { ...profile.skills, copy: { ...profile.skills.copy }, robustness: { ...profile.skills.robustness }, procedure: { ...profile.skills.procedure } };
  const { clean, env, tx, causes } = evidence;
  if (clean.total) {
    const prior = skills.copy[alphabet];
    // A new speed restarts the estimate's confidence but keeps its value as a prior.
    const carried = prior && prior.wpm === wpm ? prior : prior ? { value: prior.value, n: Math.min(prior.n, 4) } : undefined;
    skills.copy[alphabet] = { ...round(ewma(carried, clean.correct / clean.total, Math.min(1, clean.total / 12))), wpm };
  }
  for (const [condition, bucket] of Object.entries(env) as [QsoEnvCondition, { total: number; correct: number }][]) {
    if (bucket.total) skills.robustness[condition] = round(ewma(skills.robustness[condition], bucket.correct / bucket.total, Math.min(1, bucket.total / 8)));
  }
  if (evidence.calls) {
    const prior = skills.callsign ?? emptyCallsign();
    skills.callsign = { log: foldCalls(prior.log, evidence.calls.log), first: foldCalls(prior.first, evidence.calls.first) };
  }
  if (tx.total) {
    skills.tuning = round(ewma(skills.tuning, tx.onFrequency / tx.total));
    skills.procedure[modeId] = round(ewma(skills.procedure[modeId], Math.max(0, 1 - causes.procedure / tx.total)));
  }
  return { ...profile, skills };
}

/* ── Recommended stage (display only, never stored, never locks) ─────────── */

export type StageId = 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
export interface StageAdvice { stage: StageId; title: string; reason: string; modeId: string; preset?: Partial<DifficultyVector> }

export const STAGES: Record<StageId, string> = {
  S0: 'はじめての QSO',
  S1: 'ふつうの QSO',
  S2: '実戦の QSO',
  S3: 'コンテスト',
  S4: 'パイルアップ',
};

const solid = (estimate: SkillEstimate | undefined, value: number, n = 3) => Boolean(estimate && estimate.n >= n && estimate.value >= value);

export function recommendStage(profile: QsoProfile | undefined): StageAdvice {
  const qso = normalizeQsoProfile(profile);
  const ragchew = qso.modes.ragchew;
  const copy = qso.skills.copy.international;
  if (!ragchew || ragchew.qsos < 3 || !copy || copy.n < 2) {
    return { stage: 'S0', modeId: 'ragchew', title: STAGES.S0, reason: 'まずは混信少なめの 1 対 1 で、呼ぶ → 書き取る → 73 の流れに慣れましょう', preset: { crowd: 1, qsb: 0.1, qrn: 0.1, noise: 0.2, weak: 0 } };
  }
  const robust = (['qrm', 'qsb', 'qrn', 'weak'] as const).filter((condition) => solid(qso.skills.robustness[condition], 0.85, 2)).length;
  if (!solid(copy, 0.9) || (copy.wpm ?? 0) < 15) {
    return { stage: 'S1', modeId: 'ragchew', title: STAGES.S1, reason: `通常環境での受信 ${Math.round(copy.value * 100)}%（${copy.wpm} WPM）。15 WPM・90% が次の目安です` };
  }
  if (robust < 3) {
    return { stage: 'S2', modeId: 'ragchew', title: STAGES.S2, reason: `QRM・QSB・QRN・弱信号のうち ${robust} 種類で安定。混信やフェージングの中でも取れるようにしましょう` };
  }
  return { stage: 'S3', modeId: 'ragchew', title: STAGES.S3, reason: '実戦環境でも安定しています。コンテストモードの準備ができたら挑戦しましょう（準備中）' };
}
