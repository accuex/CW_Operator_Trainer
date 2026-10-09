import { CARDS } from './morse';
import { isKochComplete, kochProgressOf, normalizeKoch } from './koch';
import { ownedCardRarity, rarityRank } from './cardRarity';
import { EXAM_PASS_ACCURACY } from './examScore';
import { BADGES, badgeTier } from './radio/badges';
import type { AchievementProgress, AnswerLog, CardRarityOwned, ExamSessionSummary, SessionRecord, TrainerProfile } from './types';
import type { CardRarity } from './cardArtwork';

export { ownedCardRarity } from './cardRarity';

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
  | 'daily-habit'
  | 'first-sr'
  | 'first-ssr'
  | 'wabun-speed-star'
  | 'wabun-issoutsu-pace'
  | 'digit-master'
  | 'kigo-master'
  | 'grand-archive'
  | 'wabun-koch-awakening'
  | 'wabun-koch-complete'
  | 'koch-double-crown'
  | 'queue-depth-5'
  | 'exam-pass-latin'
  | 'exam-pass-wabun'
  | 'exam-triple-crown'
  | 'qso-debut'
  | 'qso-100'
  | 'pileup-debut'
  | 'contest-debut'
  | 'qso-gold-badge'
  | 'answers-1000'
  | 'answers-10000'
  | 'perfect-50'
  | 'speed-25'
  | 'streak-30'
  | 'night-owl'
  | 'early-bird';

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
const LATIN_DIGITS = CARDS.filter((card) => card.kind === 'digit' && card.alphabet === 'international');
const KIGO_CARDS = CARDS.filter((card) => card.kind === 'punctuation' || card.kind === 'prosign');

/** Volume and habit thresholds (shared by condition copy and predicates). */
const ANSWERS_BRONZE = 1_000;
const ANSWERS_SILVER = 10_000;
const PERFECT_RUN = 50;
const FAST_WPM = 25;
const FAST_CORRECT = 500;
const QSO_CONTACTS = 100;
const HOUR_ANSWERS = 100;
const QUEUE_DEEP = 5;

const rarityFolder = (rarity: CardRarity) => rarity.toLowerCase();

const art = (id: AchievementId, rarity: CardRarity) =>
  `/cards/achievements/${rarityFolder(rarity)}/${id}.webp`;

const def = (id: AchievementId, rarity: CardRarity, title: string, description: string, condition: string): AchievementDef => ({
  id, title, description, condition, rarity, artwork: art(id, rarity),
});

export const ACHIEVEMENTS: AchievementDef[] = [
  def('latin-starter', 'R', '欧文入門', '欧文カードを集めはじめた証。', '欧文 A–Z を 10 枚 GET'),
  def('latin-master', 'SR', '欧文マスター', 'A–Z をコンプリートしたオペレーター。', '欧文 A–Z 全 26 枚を GET（R 以上）'),
  def('latin-speed-star', 'SR', '欧文スピードスター', '実戦速度帯で欧文をそろえた証。', '欧文 A–Z 全枚を SR 以上（コッホ実効 ≥ 18）'),
  def('latin-issoutsu-pace', 'SSR', '一総通ペース', '一総通速度帯で欧文を極めた勲章。', '欧文 A–Z 全枚を SSR（コッホ実効 ≥ 22）'),
  def('wabun-starter', 'R', '和文入門', '和文カードを集めはじめた証。', '和文カードを 10 枚 GET'),
  def('wabun-master', 'SR', '和文マスター', '和文カードをコンプリートしたオペレーター。', `和文カード全 ${WABUN_CHARS.length} 枚を GET（R 以上）`),
  def('koch-awakening', 'R', 'コッホ開眼', 'レベル試験で文字を広げはじめた。', '欧文コッホ Lv.5 に到達'),
  def('koch-complete', 'SR', 'コッホ完走', 'コッホ法の全昇級をクリアした。', '欧文コッホ全レベル（昇級試験）クリア'),
  def('queue-debut', 'R', '遅れ受信デビュー', '頭の中にキューを作りはじめた。', '遅れ受信を 1 セッション完走'),
  def('queue-depth-3', 'SR', 'Queue 3 安定', '深さ 3 を安定して回せた証。', '遅れ受信で安定深度 3 以上を記録'),
  def('exam-debut', 'R', '一総通初受験', '試験机に座った記念カード。', '一総通試験を 1 回完走（科目は問わない）'),
  def('streak-3', 'R', '3日連続', '三日坊主を超えた。', '連続学習日数 3 日'),
  def('streak-7', 'SR', '7日連続', '一週間、キーを握り続けた。', '連続学習日数 7 日'),
  def('daily-habit', 'SR', '日課のオペレーター', '毎日の目標を積み重ねた証。', `1 日 ${DAILY_GOAL} 問達成を累計 10 回`),

  def('first-sr', 'R', 'はじめての SR', '実戦速度の扉を開けた一枚。', '文字カードを 1 枚でも SR 以上に昇格（コッホ実効 ≥ 18）'),
  def('first-ssr', 'SR', 'はじめての SSR', '虹色の一枚を手にした。', '文字カードを 1 枚でも SSR に昇格（コッホ実効 ≥ 22）'),
  def('wabun-speed-star', 'SR', '和文スピードスター', '実戦速度帯で和文をそろえた証。', `和文カード全 ${WABUN_CHARS.length} 枚を SR 以上（和文コッホ実効 ≥ 18）`),
  def('wabun-issoutsu-pace', 'SSR', '和文一総通ペース', '75 字/分の和文を体に入れた勲章。', `和文カード全 ${WABUN_CHARS.length} 枚を SSR（和文コッホ実効 ≥ 22）`),
  def('digit-master', 'R', '数字マスター', 'RST もシリアルも怖くない。', '数字 0–9 の 10 枚を GET'),
  def('kigo-master', 'SR', '記号・手続マスター', '/ も = も AR も、迷わず取れる。', `記号・手続符号カード全 ${KIGO_CARDS.length} 枚を GET（欧文・和文とも）`),
  def('grand-archive', 'SSR', '図鑑コンプリート', 'すべての符号を手にした電信の収集家。', `文字カード全 ${CARDS.length} 枚を GET`),
  def('wabun-koch-awakening', 'R', '和文コッホ開眼', 'イロハの音が耳に入りはじめた。', '和文コッホ Lv.5 に到達'),
  def('wabun-koch-complete', 'SR', '和文コッホ完走', '和文コッホの全昇級をクリアした。', '和文コッホ全レベル（昇級試験）クリア'),
  def('koch-double-crown', 'SSR', '欧和コッホ二冠', '欧文も和文も、コッホを走り切った。', '欧文・和文コッホの全レベルをクリア'),
  def('queue-depth-5', 'SSR', 'Queue 5 の境地', '5 字遅れで書ける、ベテランの頭の中。', `遅れ受信で安定深度 ${QUEUE_DEEP} 以上を記録`),
  def('exam-pass-latin', 'SR', '欧文 合格圏', '本番速度の欧文を書き切った。', `一総通 欧文（普通語・暗語どちらか）を本番速度以上・${EXAM_PASS_ACCURACY * 100}% 以上で採点`),
  def('exam-pass-wabun', 'SR', '和文 合格圏', '本番速度の和文電報を書き切った。', `一総通 和文を本番速度（22 WPM）以上・${EXAM_PASS_ACCURACY * 100}% 以上で採点`),
  def('exam-triple-crown', 'SSR', '電気通信術 三冠', '欧文普通語・暗語・和文、すべて合格圏。', `一総通の 3 科目すべてを本番速度以上・${EXAM_PASS_ACCURACY * 100}% 以上で採点`),
  def('qso-debut', 'R', '初交信', 'はじめて電波の向こうと話した。', 'QSO シミュレーターで 1 セッション完了'),
  def('qso-100', 'SR', '百局交信', 'ログ帳が 100 局で埋まった。', `QSO シミュレーターで交信成立（complete）累計 ${QSO_CONTACTS} 局`),
  def('pileup-debut', 'R', 'パイルアップ初陣', '呼ばれる側の景色を知った。', 'パイルアップを 1 回運用'),
  def('contest-debut', 'R', 'コンテスト初参戦', 'TEST の声に飛び込んだ。', 'コンテストを 1 回運用'),
  def('qso-gold-badge', 'SSR', '金バッジ保持者', '実戦習熟バッジで頂点に立った。', 'QSO バッジのどれか 1 つを金まで育てる'),
  def('answers-1000', 'R', '千本ノック', '1,000 字ぶんキーを叩いた。', `累計回答 ${ANSWERS_BRONZE.toLocaleString('en-US')} 字`),
  def('answers-10000', 'SR', '一万字の鍵', '1 万字の符号が指に染みついた。', `累計回答 ${ANSWERS_SILVER.toLocaleString('en-US')} 字`),
  def('perfect-50', 'SR', 'パーフェクト 50', '一度も落とさず 50 字。', `1 セッション内で ${PERFECT_RUN} 字連続正解`),
  def('speed-25', 'SR', '25 WPM の壁', '一総通ペースの、さらにその先へ。', `実効 ${FAST_WPM} WPM 以上で正解 ${FAST_CORRECT} 字`),
  def('streak-30', 'SSR', '30日連続', 'ひと月、一日も欠かさず電鍵へ。', '連続学習日数 30 日'),
  def('night-owl', 'R', '深夜オペ', '静かなバンドは夜に開く。', `0〜3 時台に累計 ${HOUR_ANSWERS} 字回答`),
  def('early-bird', 'R', '朝練オペ', '出勤前のワッチは三文の得。', `5〜7 時台に累計 ${HOUR_ANSWERS} 字回答`),
];

export const achievementById = (id: string) => ACHIEVEMENTS.find((item) => item.id === id);

const cardRarityOf = (card: (typeof CARDS)[number], profile: TrainerProfile) =>
  ownedCardRarity(profile.cards[`${card.alphabet}:${card.symbol}`]);

const masteredCount = (cards: typeof CARDS, profile: TrainerProfile) =>
  cards.filter((card) => cardRarityOf(card, profile)).length;

const allAtLeast = (cards: typeof CARDS, profile: TrainerProfile, min: CardRarityOwned) => {
  const need = rarityRank(min);
  return cards.every((card) => rarityRank(cardRarityOf(card, profile)) >= need);
};

const anyAtLeast = (profile: TrainerProfile, min: CardRarityOwned) => {
  const need = rarityRank(min);
  return Object.values(profile.cards).some((progress) => rarityRank(ownedCardRarity(progress)) >= need);
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

/** Longest run of correct answers inside one session (answers kept in log order). */
export function longestCorrectRun(answers: AnswerLog[]) {
  const runs = new Map<string, number>();
  let best = 0;
  for (const answer of answers) {
    const run = answer.isCorrect ? (runs.get(answer.sessionId) ?? 0) + 1 : 0;
    runs.set(answer.sessionId, run);
    if (run > best) best = run;
  }
  return best;
}

const answersInHours = (answers: AnswerLog[], from: number, to: number) =>
  answers.filter((answer) => {
    const hour = new Date(answer.timestamp).getHours();
    return hour >= from && hour <= to;
  }).length;

const fastCorrect = (answers: AnswerLog[]) =>
  answers.filter((answer) => answer.isCorrect && Math.min(answer.effectiveSpeed, answer.characterSpeed) >= FAST_WPM).length;

/** Exam subjects scored at the real exam's speed or faster, at the pass line or better. */
export function passedExamSubjects(sessions: SessionRecord[]) {
  const passed = new Set<ExamSessionSummary['subject']>();
  for (const session of sessions) {
    if (session.mode !== 'exam' || !session.exam) continue;
    if (session.accuracy < EXAM_PASS_ACCURACY) continue;
    if (session.exam.wpm < session.exam.officialWpm) continue;
    passed.add(session.exam.subject);
  }
  return passed;
}

/** Contacts completed in the QSO simulator (a rag-chew is one; a run lists its contacts). */
export function completedQsoContacts(sessions: SessionRecord[]) {
  let total = 0;
  for (const session of sessions) {
    const qso = session.qso;
    if (session.mode !== 'qso' || !qso) continue;
    if (qso.contacts) total += qso.contacts.filter((contact) => contact.outcome === 'complete').length;
    else if (qso.outcome === 'complete') total += 1;
  }
  return total;
}

const kochDone = (profile: TrainerProfile, alphabet: 'international' | 'wabun') =>
  isKochComplete(kochProgressOf(profile, alphabet), alphabet);

type Predicate = (ctx: AchievementContext) => boolean;

const PREDICATES: Record<AchievementId, Predicate> = {
  'latin-starter': ({ profile }) => masteredCount(LATIN_LETTERS, profile) >= 10,
  'latin-master': ({ profile }) => allAtLeast(LATIN_LETTERS, profile, 'R'),
  'latin-speed-star': ({ profile }) => allAtLeast(LATIN_LETTERS, profile, 'SR'),
  'latin-issoutsu-pace': ({ profile }) => allAtLeast(LATIN_LETTERS, profile, 'SSR'),
  'wabun-starter': ({ profile }) => masteredCount(WABUN_CHARS, profile) >= 10,
  'wabun-master': ({ profile }) => allAtLeast(WABUN_CHARS, profile, 'R'),
  'koch-awakening': ({ profile }) => normalizeKoch(profile.koch).level >= 5,
  'koch-complete': ({ profile }) => kochDone(profile, 'international'),
  'queue-debut': ({ sessions }) => sessions.some((session) => session.mode === 'queue'),
  'queue-depth-3': ({ sessions }) => sessions.some((session) => (session.queue?.stableDepth ?? 0) >= 3),
  'exam-debut': ({ sessions, answers }) => (
    sessions.some((session) => session.mode === 'exam')
    || answers.some((answer) => answer.mode === 'exam')
  ),
  'streak-3': ({ answers, now }) => streakDaysFromAnswers(answers, now) >= 3,
  'streak-7': ({ answers, now }) => streakDaysFromAnswers(answers, now) >= 7,
  'daily-habit': ({ answers }) => dailyGoalClears(answers) >= 10,

  'first-sr': ({ profile }) => anyAtLeast(profile, 'SR'),
  'first-ssr': ({ profile }) => anyAtLeast(profile, 'SSR'),
  'wabun-speed-star': ({ profile }) => allAtLeast(WABUN_CHARS, profile, 'SR'),
  'wabun-issoutsu-pace': ({ profile }) => allAtLeast(WABUN_CHARS, profile, 'SSR'),
  'digit-master': ({ profile }) => allAtLeast(LATIN_DIGITS, profile, 'R'),
  'kigo-master': ({ profile }) => allAtLeast(KIGO_CARDS, profile, 'R'),
  'grand-archive': ({ profile }) => allAtLeast(CARDS, profile, 'R'),
  'wabun-koch-awakening': ({ profile }) => kochProgressOf(profile, 'wabun').level >= 5,
  'wabun-koch-complete': ({ profile }) => kochDone(profile, 'wabun'),
  'koch-double-crown': ({ profile }) => kochDone(profile, 'international') && kochDone(profile, 'wabun'),
  'queue-depth-5': ({ sessions }) => sessions.some((session) => (session.queue?.stableDepth ?? 0) >= QUEUE_DEEP),
  'exam-pass-latin': ({ sessions }) => {
    const passed = passedExamSubjects(sessions);
    return passed.has('plain') || passed.has('codes');
  },
  'exam-pass-wabun': ({ sessions }) => passedExamSubjects(sessions).has('wabun'),
  'exam-triple-crown': ({ sessions }) => passedExamSubjects(sessions).size >= 3,
  'qso-debut': ({ sessions }) => sessions.some((session) => session.mode === 'qso'),
  'qso-100': ({ sessions }) => completedQsoContacts(sessions) >= QSO_CONTACTS,
  'pileup-debut': ({ sessions }) => sessions.some((session) => Boolean(session.qso?.pileup)),
  'contest-debut': ({ sessions }) => sessions.some((session) => Boolean(session.qso?.contest)),
  'qso-gold-badge': ({ profile }) => BADGES.some((badge) => badgeTier(badge, profile.qso) === 3),
  'answers-1000': ({ answers }) => answers.length >= ANSWERS_BRONZE,
  'answers-10000': ({ answers }) => answers.length >= ANSWERS_SILVER,
  'perfect-50': ({ answers }) => longestCorrectRun(answers) >= PERFECT_RUN,
  'speed-25': ({ answers }) => fastCorrect(answers) >= FAST_CORRECT,
  'streak-30': ({ answers, now }) => streakDaysFromAnswers(answers, now) >= 30,
  'night-owl': ({ answers }) => answersInHours(answers, 0, 3) >= HOUR_ANSWERS,
  'early-bird': ({ answers }) => answersInHours(answers, 5, 7) >= HOUR_ANSWERS,
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
