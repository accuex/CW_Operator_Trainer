import type { CharacterKind, LearnCourse } from './course';

export type AlphabetType = 'international' | 'wabun';
export type TrainingMode =
  | 'mnemonic'
  | 'sound'
  | 'transition'
  | 'koch'
  | 'reflex'
  | 'groups'
  | 'plain'
  | 'words'
  | 'callsigns'
  | 'custom'
  | 'weak-character'
  | 'weak-pair'
  | 'queue'
  | 'exam';

export interface AudioSettings {
  pitch: number;
  volume: number;
  characterSpeed: number;
  effectiveSpeed: number;
  waveform: OscillatorType;
  attack: number;
  release: number;
  /** 短いディレイ反響。ノート／モニタ内蔵スピーカーでも分かる強さ */
  reverb: boolean;
}

export interface ToneEvent {
  symbol: string;
  kind: 'tone';
  start: number;
  duration: number;
  element: '.' | '-';
}

export interface CharacterTiming {
  symbol: string;
  index: number;
  start: number;
  end: number;
}

export interface MorseTimeline {
  tones: ToneEvent[];
  characters: CharacterTiming[];
  duration: number;
  dit: number;
  characterGap: number;
  wordGap: number;
}

export interface AnswerLog {
  id: string;
  timestamp: number;
  alphabetType: AlphabetType;
  correctSymbol: string;
  inputSymbol: string;
  characterSpeed: number;
  effectiveSpeed: number;
  queueTarget: number;
  actualQueueDepth: number;
  stimulusTime: number;
  inputTime: number;
  responseLatency: number;
  mode: TrainingMode;
  isCorrect: boolean;
  isEarly: boolean;
  sessionId: string;
}

export interface QueueInputResult {
  expected: string;
  input: string;
  isCorrect: boolean;
  isEarly: boolean;
  actualDepth: number;
  responseLatency: number;
  stableRun: number;
}

export interface QueueMetrics {
  target: number;
  answered: number;
  correct: number;
  earlyCopies: number;
  queueDrops: number;
  burstOutputs: number;
  meanDepth: number;
  medianDepth: number;
  stableDepth: number;
  stableRate: number;
  longestStableRun: number;
  cadenceStability: number;
  scoreMultiplier: number;
}

/** Owned rarity on a character card. Absent + mastered ⇒ treat as R. */
export type CardRarityOwned = 'R' | 'SR' | 'SSR';

export interface CardProgress {
  /** Recall Check attempts (identification), not Discover listens. */
  attempts: number;
  /** Recall Check correct answers. */
  correct: number;
  streak: number;
  mastered: boolean;
  /** True after Discover exposure; gates MASTERED / CARD GET. */
  reviewed: boolean;
  /** Completed Discover listen-throughs (full ×5 CW exposure). */
  exposures?: number;
  /** Target Count (confirm) correct answers — analytics / legacy. */
  confirmCorrect?: number;
  /**
   * Visible learn meter 0–90. Goes up on correct confirm/recall, down on wrong.
   * CARD GET still uses attempts/accuracy/streak thresholds, not this alone.
   */
  progressMeter?: number;
  selectedMnemonic?: string;
  customMnemonic?: string;
  masteredAt?: number;
  /**
   * Highest rarity owned for this character card (R→SR→SSR upgrade model).
   * When omitted, mastered cards are treated as R.
   */
  rarityOwned?: CardRarityOwned;
}

export interface AchievementProgress {
  unlockedAt: number;
}

/** Koch 法レベル試験の進捗。レッスン番号はキーを文字列化して保存。 */
export interface KochProgress {
  /** 挑戦中のレッスン（1–40）。昇級試験に合格すると +1。 */
  level: number;
  /** レッスンごとのベスト正解率 0–1（練習・試験とも）。 */
  best: Record<string, number>;
  /** 昇級試験に合格した時刻。 */
  clearedAt: Record<string, number>;
}

export interface TrainerProfile {
  version: 1;
  goal: 'fun' | 'sound' | 'experienced' | 'exam' | null;
  /** Learn / Collection feature-set filter. Null until the user picks a course. */
  learnCourse?: LearnCourse | null;
  /** Unlocked character kinds within the selected course catalog. */
  unlockedKinds?: CharacterKind[];
  cards: Record<string, CardProgress>;
  /** Achievement archive unlocks keyed by AchievementId. */
  achievements?: Record<string, AchievementProgress>;
  koch?: KochProgress;
  /**
   * Collection preview: ignore unlock state and show all cards/achievements
   * (SSR art). Does not mutate mastered / rarityOwned / unlockedAt.
   */
  revealAll?: boolean;
  totalTrainingMs: number;
  lastMode: string;
}

export interface SessionRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  mode: TrainingMode;
  alphabetType: AlphabetType;
  answers: number;
  accuracy: number;
  queue?: QueueMetrics;
}
