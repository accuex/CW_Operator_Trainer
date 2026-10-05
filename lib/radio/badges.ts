import type { AlphabetType, QsoBadgeRecord, QsoCharMark, QsoEnvCondition, QsoProfile, QsoStats } from '../types';
import { isEnvCondition } from './conditions';
import type { FieldResult } from './attribution';
import type { QsoEvidence } from './difficulty';
import type { QsoIssue } from './qso';

/**
 * 実戦習熟バッジ and per-character 実戦マーク. Separate from card rarity: they
 * are earned from QSO evidence only and never touch `profile.cards`.
 *
 * The profile keeps raw counters (`stats`); tiers are derived from them with the
 * criteria below. Earned tiers are stored with the criteria version and never
 * taken away, so thresholds can be retuned later without revoking anything.
 */

export const BADGE_CRITERIA_VERSION = 1;

/** A QSO counts toward the speed badge when clean copy was at least this good. */
export const FAST_CLEAN_ACCURACY = 0.95;
export const FAST_CLEAN_MIN_CHARS = 8;
export const FAST_WPM_STEPS = [15, 20, 25, 30] as const;
/** …and toward an environment badge when that condition's chars held up this well. */
export const ENV_ACCURACY = 0.85;
export const ENV_MIN_CHARS = 4;
export const ZERO_IN_HZ = 30;

/** A character gets its mark after this many clean, correct copies at MARK_WPM or faster. */
export const MARK_WPM = 18;
export const MARK_COUNT = 5;

export const TIER_LABEL = ['', '銅', '銀', '金'] as const;

export interface BadgeTierDef { goal: number; label: string; value: (stats: QsoStats) => number }
export interface BadgeDef { id: string; title: string; description: string; unit: string; tiers: [BadgeTierDef, BadgeTierDef, BadgeTierDef] }

const fast = (wpm: number) => (stats: QsoStats) => stats.fastClean[wpm] ?? 0;
const env = (condition: QsoEnvCondition) => (stats: QsoStats) => stats.envCorrect[condition] ?? 0;
const counter = (key: 'zeroIn' | 'freehand' | 'callsign') => (stats: QsoStats) => stats[key];
const counted = (value: BadgeTierDef['value'], goals: [number, number, number], unit: string): BadgeDef['tiers'] =>
  goals.map((goal) => ({ goal, label: `${goal} ${unit}`, value })) as BadgeDef['tiers'];

export const BADGES: BadgeDef[] = [
  {
    id: 'speed',
    title: '実戦速度',
    description: `通常条件の受信が ${FAST_CLEAN_ACCURACY * 100}% 以上だった QSO で、正しく取れた字数（その速さ以上）`,
    unit: '字',
    tiers: [
      { goal: 200, label: '15 WPM で 200 字', value: fast(15) },
      { goal: 200, label: '20 WPM で 200 字', value: fast(20) },
      { goal: 200, label: '25 WPM で 200 字', value: fast(25) },
    ],
  },
  { id: 'qrm', title: '混信に強い', description: '近くの局と重なっていた字を、その QSO で 85% 以上取れたときの正解字数', unit: '字', tiers: counted(env('qrm'), [30, 100, 300], '字') },
  { id: 'qsb', title: 'フェージングに強い', description: '深いフェージング中の字を、その QSO で 85% 以上取れたときの正解字数', unit: '字', tiers: counted(env('qsb'), [30, 100, 300], '字') },
  { id: 'qrn', title: '空電に強い', description: '空電と重なった字を、その QSO で 85% 以上取れたときの正解字数', unit: '字', tiers: counted(env('qrn'), [30, 100, 300], '字') },
  { id: 'weak', title: '弱い信号に強い', description: 'ノイズに埋もれかけた字を、その QSO で 85% 以上取れたときの正解字数', unit: '字', tiers: counted(env('weak'), [30, 100, 300], '字') },
  { id: 'zero-in', title: 'ゼロイン', description: `すべての送信を相手の ±${ZERO_IN_HZ} Hz 以内で出した QSO の数`, unit: 'QSO', tiers: counted(counter('zeroIn'), [10, 30, 100], 'QSO') },
  { id: 'freehand', title: '手打ち運用', description: '定型ボタンを使わず、手順ミスなしで最後まで終えた QSO の数', unit: 'QSO', tiers: counted(counter('freehand'), [10, 30, 100], 'QSO') },
  { id: 'callsign', title: 'コールサイン', description: '相手のコールサインを正しくログに書けた QSO の数', unit: 'QSO', tiers: counted(counter('callsign'), [10, 50, 150], 'QSO') },
];

export const badgeById = (id: string) => BADGES.find((badge) => badge.id === id);

export const emptyStats = (): QsoStats => ({ fastClean: {}, envCorrect: {}, zeroIn: 0, freehand: 0, callsign: 0 });

export function normalizeStats(raw: Partial<QsoStats> | undefined): QsoStats {
  const base = emptyStats();
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...raw, fastClean: { ...raw.fastClean }, envCorrect: { ...raw.envCorrect } };
}

/** Tier the counters currently support (0 = none). Tiers must be met in order. */
export function tierFor(badge: BadgeDef, stats: QsoStats): 0 | 1 | 2 | 3 {
  let tier = 0;
  for (const def of badge.tiers) {
    if (def.value(stats) < def.goal) break;
    tier += 1;
  }
  return tier as 0 | 1 | 2 | 3;
}

/** Shown tier: the better of what is stored and what the counters support. */
export function badgeTier(badge: BadgeDef, qso: QsoProfile | undefined): 0 | 1 | 2 | 3 {
  return Math.max(qso?.badges?.[badge.id]?.tier ?? 0, tierFor(badge, normalizeStats(qso?.stats))) as 0 | 1 | 2 | 3;
}

/** Progress toward the next tier, or null when the badge is complete. */
export function nextTier(badge: BadgeDef, qso: QsoProfile | undefined) {
  const tier = badgeTier(badge, qso);
  if (tier >= 3) return null;
  const def = badge.tiers[tier as 0 | 1 | 2];
  const value = def.value(normalizeStats(qso?.stats));
  return { tier: (tier + 1) as 1 | 2 | 3, label: def.label, value: Math.min(value, def.goal), goal: def.goal };
}

export const charMarkKey = (alphabet: AlphabetType, symbol: string) => `${alphabet}:${symbol}`;
export const hasCharMark = (mark: QsoCharMark | undefined) => (mark?.count ?? 0) >= MARK_COUNT;

export interface QsoOutcome {
  fields: FieldResult[];
  evidence: QsoEvidence;
  alphabet: AlphabetType;
  /** Slowest speed the target actually sent at (QRS counts). */
  wpm: number;
  tx: { offsetHz: number; issue?: QsoIssue; macro?: boolean }[];
  complete: boolean;
  at: number;
}

export interface EarnedBadge { id: string; tier: 1 | 2 | 3 }

/** Fold one QSO into the counters, marks and badges. */
export function recordQsoOutcome(qso: QsoProfile, outcome: QsoOutcome): { qso: QsoProfile; earned: EarnedBadge[]; marked: string[] } {
  const { fields, evidence, alphabet, wpm, tx, complete, at } = outcome;
  const stats = normalizeStats(qso.stats);
  const cells = fields.flatMap((field) => field.cells).filter((cell) => cell.op !== 'ins');

  const { clean } = evidence;
  if (clean.total >= FAST_CLEAN_MIN_CHARS && clean.correct / clean.total >= FAST_CLEAN_ACCURACY) {
    for (const step of FAST_WPM_STEPS) if (wpm >= step) stats.fastClean[step] = (stats.fastClean[step] ?? 0) + clean.correct;
  }
  for (const [condition, bucket] of Object.entries(evidence.env) as [QsoEnvCondition, { total: number; correct: number }][]) {
    if (isEnvCondition(condition) && bucket.total >= ENV_MIN_CHARS && bucket.correct / bucket.total >= ENV_ACCURACY) {
      stats.envCorrect[condition] = (stats.envCorrect[condition] ?? 0) + bucket.correct;
    }
  }
  if (tx.length && tx.every((event) => Math.abs(event.offsetHz) <= ZERO_IN_HZ && event.issue !== 'off-frequency')) stats.zeroIn += 1;
  if (complete && tx.length && tx.every((event) => !event.macro && !event.issue)) stats.freehand += 1;
  if (fields.find((field) => field.key === 'call')?.correct) stats.callsign += 1;

  const charMarks = { ...qso.charMarks };
  const marked: string[] = [];
  if (wpm >= MARK_WPM) {
    for (const cell of cells) {
      if (cell.op !== 'match' || cell.condition !== 'clean') continue;
      const key = charMarkKey(alphabet, cell.expected);
      const before = charMarks[key];
      const count = (before?.count ?? 0) + 1;
      const reached = !hasCharMark(before) && count >= MARK_COUNT;
      charMarks[key] = { count, at: reached ? at : before?.at };
      if (reached) marked.push(cell.expected);
    }
  }

  const badges: Record<string, QsoBadgeRecord> = { ...qso.badges };
  const earned: EarnedBadge[] = [];
  for (const badge of BADGES) {
    const tier = tierFor(badge, stats);
    if (tier > (badges[badge.id]?.tier ?? 0)) {
      badges[badge.id] = { tier: tier as 1 | 2 | 3, at, criteriaVersion: BADGE_CRITERIA_VERSION };
      earned.push({ id: badge.id, tier: tier as 1 | 2 | 3 });
    }
  }
  return { qso: { ...qso, stats, charMarks, badges }, earned, marked };
}
