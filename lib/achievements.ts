import { CARDS } from './morse';
import { isKochComplete, normalizeKoch } from './koch';
import type { AchievementProgress, AnswerLog, CardProgress, CardRarityOwned, SessionRecord, TrainerProfile } from './types';
import type { CardRarity } from './cardArtwork';

/** Must match `DAILY_GOAL` in app/trainer/progress. */
const DAILY_GOAL = 40;

/** Achievement catalog ID. Artwork: /cards/achievements/{r|sr|ssr}/{id}.webp */
export type AchievementId =
  | 'latin-starter'
  | 'latin-master'
  | 'latin-speed-star'
  | 'latin-issoutsu-pace'
  | 'wabun-starter'
  | 'wabun-master'
  | 'koch-awakening'
  | 'koch-complete'
  | 'queue-debut'
  | 'queue-depth-3'
  | 'exam-debut'
  | 'streak-3'
  | 'streak-7'
  | 'daily-habit';

export interface AchievementDef {
  id: AchievementId;
  title: string;
  /** Short blurb shown in the archive when unlocked (or as hint when locked). */
  description: string;
  /** Condition copy for the detail drawer. */
  condition: string;
  rarity: CardRarity;
  /** Art path once the asset is placed. Missing files fall back to CSS face. */
  artwork: string;
}

export interface AchievementContext {
  profile: TrainerProfile;
  answers: AnswerLog[];
  sessions: SessionRecord[];
  now?: number;
}

const LATIN_LETTERS = CARDS.filter((card) => card.kind === 'latinLetter');
const WABUN_CHARS = CARDS.filter((card) => card.kind === 'wabun');

const rarityFolder = (rarity: CardRarity) => rarity.toLowerCase();

const art = (id: AchievementId, rarity: CardRarity) =>
  `/cards/achievements/${rarityFolder(rarity)}/${id}.webp`;

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    id: 'latin-starter',
    title: '欧文入門',
    description: '欧文カードを集めはじめた証。',
    condition: '欧文 A–Z を 10 枚 GET',
    rarity: 'R',
    artwork: art('latin-starter', 'R'),
  },
  {
    id: 'latin-master',
    title: '欧文マスター',
    description: 'A–Z をコンプリートしたオペレーター。',
    condition: '欧文 A–Z 全 26 枚を GET（R 以上）',
    rarity: 'SR',
    artwork: art('latin-master', 'SR'),
  },
  {
    id: 'latin-speed-star',
    title: '欧文スピードスター',
    description: '実戦速度帯で欧文をそろえた証。',
    condition: '欧文 A–Z 全枚を SR 以上（コッホ実効 ≥ 18）',
    rarity: 'SR',
    artwork: art('latin-speed-star', 'SR'),
  },
  {
    id: 'latin-issoutsu-pace',
    title: '一総通ペース',
    description: '一総通速度帯で欧文を極めた勲章。',
    condition: '欧文 A–Z 全枚を SSR（コッホ実効 ≥ 22）',
    rarity: 'SSR',
    artwork: art('latin-issoutsu-pace', 'SSR'),
  },
  {
    id: 'wabun-starter',
    title: '和文入門',
    description: '和文カードを集めはじめた証。',
    condition: '和文カードを 10 枚 GET',
    rarity: 'R',
    artwork: art('wabun-starter', 'R'),
  },
  {
    id: 'wabun-master',
    title: '和文マスター',
    description: '和文カードをコンプリートしたオペレーター。',
    condition: `和文カード全 ${WABUN_CHARS.length} 枚を GET（R 以上）`,
    rarity: 'SR',
    artwork: art('wabun-master', 'SR'),
  },
  {
    id: 'koch-awakening',
    title: 'コッホ開眼',
    description: 'レベル試験で文字を広げはじめた。',
    condition: 'コッホ Lv.5 に到達',
    rarity: 'R',
    artwork: art('koch-awakening', 'R'),
  },
  {
    id: 'koch-complete',
    title: 'コッホ完走',
    description: 'コッホ法の全昇級をクリアした。',
    condition: 'コッホ全レベル（昇級試験）クリア',
    rarity: 'SR',
    artwork: art('koch-complete', 'SR'),
  },
  {
    id: 'queue-debut',
    title: '遅れ受信デビュー',
    description: '頭の中にキューを作りはじめた。',
    condition: '遅れ受信を 1 セッション完走',
    rarity: 'R',
    artwork: art('queue-debut', 'R'),
  },
  {
    id: 'queue-depth-3',
    title: 'Queue 3 安定',
    description: '深さ 3 を安定して回せた証。',
    condition: '遅れ受信で安定深度 3 以上を記録',
    rarity: 'SR',
    artwork: art('queue-depth-3', 'SR'),
  },
  {
    id: 'exam-debut',
    title: '一総通初受験',
    description: '試験机に座った記念カード。',
    condition: '一総通試験を 1 回完走（科目は問わない）',
    rarity: 'R',
    artwork: art('exam-debut', 'R'),
  },
  {
    id: 'streak-3',
    title: '3日連続',
    description: '三日坊主を超えた。',
    condition: '連続学習日数 3 日',
    rarity: 'R',
    artwork: art('streak-3', 'R'),
  },
  {
    id: 'streak-7',
    title: '7日連続',
    description: '一週間、キーを握り続けた。',
    condition: '連続学習日数 7 日',
    rarity: 'SR',
    artwork: art('streak-7', 'SR'),
  },
  {
    id: 'daily-habit',
    title: '日課のオペレーター',
    description: '毎日の目標を積み重ねた証。',
    condition: `1 日 ${DAILY_GOAL} 問達成を累計 10 回`,
    rarity: 'SR',
    artwork: art('daily-habit', 'SR'),
  },
];

export const achievementById = (id: string) => ACHIEVEMENTS.find((item) => item.id === id);

/** Effective owned rarity: explicit rarityOwned, else mastered → R. */
export function ownedCardRarity(progress?: CardProgress): CardRarityOwned | null {
  if (progress?.rarityOwned) return progress.rarityOwned;
  if (progress?.mastered) return 'R';
  return null;
}

const rarityRank = (rarity: CardRarityOwned | null) => {
  if (rarity === 'SSR') return 3;
  if (rarity === 'SR') return 2;
  if (rarity === 'R') return 1;
  return 0;
};

const masteredCount = (cards: typeof CARDS, profile: TrainerProfile) =>
  cards.filter((card) => ownedCardRarity(profile.cards[`${card.alphabet}:${card.symbol}`])).length;

const allAtLeast = (cards: typeof CARDS, profile: TrainerProfile, min: CardRarityOwned) => {
  const need = rarityRank(min);
  return cards.every((card) => rarityRank(ownedCardRarity(profile.cards[`${card.alphabet}:${card.symbol}`])) >= need);
};

const dayKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

export function streakDaysFromAnswers(answers: AnswerLog[], now = Date.now()) {
  const today = dayKey(now);
  const days = new Set(answers.map((answer) => dayKey(answer.timestamp)));
  let streak = 0;
  const cursor = new Date(now);
  if (!days.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (days.has(dayKey(cursor.getTime()))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function dailyGoalClears(answers: AnswerLog[]) {
  const perDay = new Map<string, number>();
  for (const answer of answers) {
    const key = dayKey(answer.timestamp);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  let clears = 0;
  for (const count of perDay.values()) {
    if (count >= DAILY_GOAL) clears += 1;
  }
  return clears;
}

type Predicate = (ctx: AchievementContext) => boolean;

const PREDICATES: Record<AchievementId, Predicate> = {
  'latin-starter': ({ profile }) => masteredCount(LATIN_LETTERS, profile) >= 10,
  'latin-master': ({ profile }) => allAtLeast(LATIN_LETTERS, profile, 'R'),
  'latin-speed-star': ({ profile }) => allAtLeast(LATIN_LETTERS, profile, 'SR'),
  'latin-issoutsu-pace': ({ profile }) => allAtLeast(LATIN_LETTERS, profile, 'SSR'),
  'wabun-starter': ({ profile }) => masteredCount(WABUN_CHARS, profile) >= 10,
  'wabun-master': ({ profile }) => allAtLeast(WABUN_CHARS, profile, 'R'),
  'koch-awakening': ({ profile }) => normalizeKoch(profile.koch).level >= 5,
  'koch-complete': ({ profile }) => isKochComplete(normalizeKoch(profile.koch)),
  'queue-debut': ({ sessions }) => sessions.some((session) => session.mode === 'queue'),
  'queue-depth-3': ({ sessions }) => sessions.some((session) => (session.queue?.stableDepth ?? 0) >= 3),
  'exam-debut': ({ sessions, answers }) => (
    sessions.some((session) => session.mode === 'exam')
    || answers.some((answer) => answer.mode === 'exam')
  ),
  'streak-3': ({ answers, now }) => streakDaysFromAnswers(answers, now) >= 3,
  'streak-7': ({ answers, now }) => streakDaysFromAnswers(answers, now) >= 7,
  'daily-habit': ({ answers }) => dailyGoalClears(answers) >= 10,
};

export function isAchievementUnlocked(id: AchievementId, ctx: AchievementContext) {
  return PREDICATES[id](ctx);
}

/** IDs that currently satisfy their condition (including already unlocked). */
export function satisfiedAchievements(ctx: AchievementContext): AchievementId[] {
  return ACHIEVEMENTS.filter((item) => PREDICATES[item.id](ctx)).map((item) => item.id);
}

/**
 * Grant any newly satisfied achievements. Returns the same profile reference
 * when nothing changed.
 */
export function applyAchievements(
  profile: TrainerProfile,
  answers: AnswerLog[],
  sessions: SessionRecord[],
  now = Date.now(),
): { profile: TrainerProfile; unlocked: AchievementId[] } {
  const ctx = { profile, answers, sessions, now };
  const current = profile.achievements ?? {};
  const unlocked: AchievementId[] = [];
  let nextMap: Record<string, AchievementProgress> | null = null;

  for (const id of satisfiedAchievements(ctx)) {
    if (current[id]?.unlockedAt) continue;
    if (!nextMap) nextMap = { ...current };
    nextMap[id] = { unlockedAt: now };
    unlocked.push(id);
  }

  if (!nextMap) return { profile, unlocked: [] };
  return { profile: { ...profile, achievements: nextMap }, unlocked };
}

export const ACHIEVEMENT_ART_SPEC = ACHIEVEMENTS.map((item) => ({
  id: item.id,
  title: item.title,
  rarity: item.rarity,
  path: item.artwork,
  size: '1200×1800 WebP 推奨（文字カードと同じ）',
  note: '未取得時は図鑑で ???。合調なし・ビジュアル全振り。',
}));
