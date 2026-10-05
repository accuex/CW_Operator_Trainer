import type { AlphabetType, PileupStats, QsoBadgeRecord, QsoCharMark, QsoEnvCondition, QsoProfile, QsoStats } from '../types';
import { isEnvCondition } from './conditions';
import type { FieldResult } from './attribution';
import type { QsoEvidence } from './difficulty';
import type { QsoIssue } from './qso';
import { QRL_LISTEN } from './modes/cqRun';
import type { PileupOutcome } from './pileup/learning';

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
/** A run counts toward the rate badge from this long, with at least this many clean contacts. */
export const RATE_MIN_SECONDS = 300;
export const RATE_MIN_CONTACTS = 5;

/** A pileup run counts toward its rate and timing badges from this long, with at least this many picks. */
export const PILEUP_RUN_SECONDS = 300;
export const PILEUP_RUN_PICKS = 5;
/** …and as calm with at most this many calls sent over the station (doubled). */
export const PILEUP_CALM_DOUBLED = 1;

/** A character gets its mark after this many clean, correct copies at MARK_WPM or faster. */
export const MARK_WPM = 18;
export const MARK_COUNT = 5;

export const TIER_LABEL = ['', '銅', '銀', '金'] as const;

export interface BadgeTierDef { goal: number; label: string; value: (stats: QsoStats) => number }
export interface BadgeDef { id: string; title: string; description: string; unit: string; tiers: [BadgeTierDef, BadgeTierDef, BadgeTierDef] }

const fast = (wpm: number) => (stats: QsoStats) => stats.fastClean[wpm] ?? 0;
const env = (condition: QsoEnvCondition) => (stats: QsoStats) => stats.envCorrect[condition] ?? 0;
const counter = (key: 'zeroIn' | 'freehand' | 'callsign' | 'frequencyChecks') => (stats: QsoStats) => stats[key] ?? 0;
const bestRate = (stats: QsoStats) => stats.bestRate ?? 0;
const pileup = (key: keyof PileupStats) => (stats: QsoStats) => stats.pileup?.[key] ?? 0;
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
  {
    id: 'frequency-check',
    title: '周波数確認',
    description: `CQ の前に QRL? を出して ${QRL_LISTEN} 秒以上聴き、空いていると確かめてから CQ を出した周波数（使用中と分かって CQ を控えた周波数も数えます）`,
    unit: '回',
    tiers: counted(counter('frequencyChecks'), [5, 20, 50], '回'),
  },
  {
    id: 'run-rate',
    title: 'CQ ランのレート',
    description: `${RATE_MIN_SECONDS / 60} 分以上のランで、全項目を正しくログした完了交信の 1 時間あたりの数（最高記録）`,
    unit: '/h',
    tiers: [
      // RST / NAME / QTH runs top out near 40/h even keyed fast (headless sims); 20 is a steady run.
      { goal: 20, label: '20 局/h', value: bestRate },
      { goal: 30, label: '30 局/h', value: bestRate },
      { goal: 40, label: '40 局/h', value: bestRate },
    ],
  },
  // Pileup goals below were checked against headless runs (lib/radio/sim/pileupLearning.test.ts): a 7-minute
  // run at 中級 gives an average bot ~6 right contacts, ~3 narrowed picks and ~1 look-alike worked; clean
  // rates run 25–60/h (a skilled ear at 入門・初級 reaches ~75–80).
  { id: 'pileup', title: 'パイルアップ', description: 'パイルアップで、正しいコールでログし最後まで終えた交信の数（1 局目から数えます）', unit: '局', tiers: counted(pileup('contacts'), [1, 50, 300], '局') },
  { id: 'pileup-partial', title: 'partial で絞る', description: 'partial から始めて、送った断片に当てはまる局を正しく拾って交信を終えた数', unit: '回', tiers: counted(pileup('narrowed'), [3, 25, 100], '回') },
  { id: 'pileup-similar', title: '似たコールを聞き分ける', description: '似たコールの局が同時に呼んでいた中で、正しいコールで交信を終えた数', unit: '回', tiers: counted(pileup('similar'), [2, 10, 40], '回') },
  {
    id: 'pileup-calm',
    title: 'ダブらない',
    description: `${PILEUP_RUN_SECONDS / 60} 分以上・${PILEUP_RUN_PICKS} 回以上コールを送ったパイルアップで、相手の送信に重ねてしまったのが ${PILEUP_CALM_DOUBLED} 回以下だったラン`,
    unit: 'ラン',
    tiers: counted(pileup('calmRuns'), [1, 10, 30], 'ラン'),
  },
  {
    id: 'pileup-rate',
    title: 'パイルアップのレート',
    description: `${PILEUP_RUN_SECONDS / 60} 分以上のパイルアップで、全項目を正しくログした完了交信の 1 時間あたりの数（最高記録）`,
    unit: '/h',
    tiers: [
      { goal: 40, label: '40 局/h', value: pileup('bestRate') },
      { goal: 60, label: '60 局/h', value: pileup('bestRate') },
      { goal: 75, label: '75 局/h', value: pileup('bestRate') },
    ],
  },
];

export const badgeById = (id: string) => BADGES.find((badge) => badge.id === id);

export const emptyPileupStats = (): PileupStats => ({ contacts: 0, narrowed: 0, similar: 0, calmRuns: 0, bestRate: 0 });

export const emptyStats = (): QsoStats => ({ fastClean: {}, envCorrect: {}, zeroIn: 0, freehand: 0, callsign: 0 });

export function normalizeStats(raw: Partial<QsoStats> | undefined): QsoStats {
  const base = emptyStats();
  if (!raw || typeof raw !== 'object') return base;
  return { ...base, ...raw, fastClean: { ...raw.fastClean }, envCorrect: { ...raw.envCorrect }, ...(raw.pileup ? { pileup: { ...emptyPileupStats(), ...raw.pileup } } : {}) };
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

  const { badges, earned } = award(qso, stats, at);
  return { qso: { ...qso, stats, charMarks, badges }, earned, marked };
}

function award(qso: QsoProfile, stats: QsoStats, at: number) {
  const badges: Record<string, QsoBadgeRecord> = { ...qso.badges };
  const earned: EarnedBadge[] = [];
  for (const badge of BADGES) {
    const tier = tierFor(badge, stats);
    if (tier > (badges[badge.id]?.tier ?? 0)) {
      badges[badge.id] = { tier: tier as 1 | 2 | 3, at, criteriaVersion: BADGE_CRITERIA_VERSION };
      earned.push({ id: badge.id, tier: tier as 1 | 2 | 3 });
    }
  }
  return { badges, earned };
}

export interface RunOutcome {
  /** Every contact with a log line judged; `tx` stays empty (zero-in and hand keying are rag-chew badges). */
  contacts: Omit<QsoOutcome, 'tx' | 'at' | 'alphabet'>[];
  alphabet: AlphabetType;
  at: number;
  seconds: number;
  /** Frequencies checked properly before CQ, and ones found in use and left alone (see RunResult.stats). */
  frequencyChecks: number;
  busyAvoided: number;
  /** Clean contacts and their rate per hour. */
  cleanContacts: number;
  cleanRate: number;
  /** A pileup: its own counters, and no CQ-run rate or frequency checks. */
  pileup?: PileupOutcome;
}

/** Fold a whole run in: each contact like a QSO, then the run's own procedure and rate. */
export function recordRunOutcome(qso: QsoProfile, run: RunOutcome): { qso: QsoProfile; earned: EarnedBadge[]; marked: string[] } {
  let next = qso;
  const marked: string[] = [];
  for (const contact of run.contacts) {
    const folded = recordQsoOutcome(next, { ...contact, tx: [], at: run.at, alphabet: run.alphabet });
    next = folded.qso;
    marked.push(...folded.marked);
  }
  const stats = normalizeStats(next.stats);
  if (run.pileup) foldPileup(stats, run.pileup);
  else {
    stats.frequencyChecks = (stats.frequencyChecks ?? 0) + run.frequencyChecks + run.busyAvoided;
    if (run.seconds >= RATE_MIN_SECONDS && run.cleanContacts >= RATE_MIN_CONTACTS) stats.bestRate = Math.max(stats.bestRate ?? 0, Math.round(run.cleanRate));
  }
  next = { ...next, stats, badges: award(next, stats, run.at).badges };
  // Everything the run lifted, from what was held before it.
  const earned = BADGES.flatMap((badge): EarnedBadge[] => {
    const tier = next.badges?.[badge.id]?.tier;
    return tier && tier > (qso.badges?.[badge.id]?.tier ?? 0) ? [{ id: badge.id, tier }] : [];
  });
  return { qso: next, earned, marked };
}

function foldPileup(stats: QsoStats, run: PileupOutcome) {
  const pile = { ...emptyPileupStats(), ...stats.pileup };
  pile.contacts += run.contacts;
  pile.narrowed += run.narrowed;
  pile.similar += run.similar;
  const counts = run.seconds >= PILEUP_RUN_SECONDS && run.picks >= PILEUP_RUN_PICKS;
  if (counts && run.doubledPicks <= PILEUP_CALM_DOUBLED) pile.calmRuns += 1;
  if (counts && run.contacts >= RATE_MIN_CONTACTS) pile.bestRate = Math.max(pile.bestRate, Math.round(run.cleanRate));
  stats.pileup = pile;
}
