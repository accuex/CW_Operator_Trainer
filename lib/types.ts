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
  | 'exam'
  | 'qso';

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
  /** Present only for characters copied in a QSO (mode 'qso'). */
  qso?: QsoAnswerMeta;
}

/**
 * Reception conditions while a character was on the air (best of its repeats).
 * clean = copyable; qrm/qsb/qrn/weak = band environment; detuned = off the passband;
 * muted = we were transmitting / receiver off; unheard = never played before the log.
 */
export type CopyCondition = 'clean' | 'weak' | 'qsb' | 'qrn' | 'qrm' | 'detuned' | 'muted' | 'unheard';
export type QsoEnvCondition = 'weak' | 'qsb' | 'qrn' | 'qrm';
/** Why a log character was wrong. */
export type QsoCause = 'ok' | 'copy' | 'environment' | 'tuning' | 'timing';

/** Raw environment numbers for a character, kept for QSO-only analysis. */
export interface QsoCharEnv {
  /** Target level over the noise floor in the passband (≈ SNR, linear). */
  snr: number;
  /** Strongest other signal in the passband relative to the target. */
  qrm: number;
  /** Fading depth 0–1 (1 − QSB factor). */
  qsb: number;
  /** Strongest static crash 0–1. */
  qrn: number;
  /** |target − VFO| in Hz. */
  offset: number;
}

export interface QsoAnswerMeta {
  modeId: string;
  presetId: string;
  field: string;
  condition: CopyCondition;
  cause: QsoCause;
  env: QsoCharEnv;
}

export type QsoCauseCounts = Record<Exclude<QsoCause, 'ok'>, number> & { procedure: number };

/** Synced per-QSO summary (the detailed trace stays on the device). */
export interface QsoSessionSummary {
  modeId: string;
  presetId: string;
  call: string;
  outcome: 'complete' | 'partial';
  fields: number;
  fieldsCorrect: number;
  /** Accuracy on clean characters only (copy skill). */
  cleanAccuracy: number | null;
  causes: QsoCauseCounts;
  difficulty: Record<string, number>;
  /** Axis changes applied after this QSO, e.g. { speed: 1 }. */
  adjusted: Record<string, number>;
  /**
   * Every contact in the session (a CQ run logs many; a rag-chew is one). Older
   * records lack it; `call` / `fields` / `fieldsCorrect` / `outcome` then stand for the only contact.
   */
  contacts?: QsoContactSummary[];
  /** CQ run numbers (run modes only). */
  run?: QsoRunSummary;
}

/**
 * How one contact ended. A rag-chew is complete or partial; a run also tells a
 * contact with no closing, one cut short and one made under a wrong call (bust).
 */
export type QsoContactOutcome = 'complete' | 'partial' | 'no-closing' | 'incomplete' | 'bust';

export interface QsoContactSummary {
  call: string;
  fields: number;
  fieldsCorrect: number;
  outcome: QsoContactOutcome;
  at: number;
}

export interface QsoRunSummary {
  seconds: number;
  /** Contacts made on the air (exchange done). */
  contacts: number;
  /** Complete contacts per hour. */
  rate: number;
  /** Share of contacts whose first call we sent was right. */
  firstCallAccuracy: number | null;
  partials: number;
  corrections: number;
  busts: number;
  nil: number;
  unlogged: number;
  dupes: number;
  /** Callers who called and left unworked. */
  missed: number;
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
  /** 挑戦中のレッスン（欧文 1–40 / 和文 1–52）。昇級試験に合格すると +1。 */
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
  /** 和文コッホの進捗（欧文とは別ラダー）。 */
  kochWabun?: KochProgress;
  /**
   * Collection preview: ignore unlock state and show all cards/achievements
   * (SSR art). Does not mutate mastered / rarityOwned / unlockedAt.
   */
  revealAll?: boolean;
  /** QSO simulator skills and per-mode progress (summary only; traces stay local). */
  qso?: QsoProfile;
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
  qso?: QsoSessionSummary;
}

/** EWMA estimate with its evidence count. */
export interface SkillEstimate { value: number; n: number }

export interface QsoModeProgress {
  qsos: number;
  perfect: number;
  lastAt: number;
  /** Current difficulty per axis (see lib/radio/difficulty.ts). */
  difficulty: Record<string, number>;
  /** Axes the user fixed; auto-adjust leaves them alone. */
  pinned: string[];
  /** おまかせ: adjust unpinned axes after each QSO. */
  auto: boolean;
  /** Staircase votes per axis (+ up / − down), reset when the axis moves. */
  votes: Record<string, number>;
}

export interface QsoProfile {
  version: 1;
  myCall?: string;
  /** Our name and QTH as sent in an exchange (CQ run). */
  myName?: string;
  myQth?: string;
  skills: {
    /** Clean-condition copy accuracy, with the speed it was measured at. */
    copy: Partial<Record<AlphabetType, SkillEstimate & { wpm: number }>>;
    /** Copy accuracy under each band condition. */
    robustness: Partial<Record<QsoEnvCondition, SkillEstimate>>;
    /** Share of transmissions made on frequency. */
    tuning?: SkillEstimate;
    /** Share of transmissions without a procedure slip, per mode. */
    procedure: Record<string, SkillEstimate>;
  };
  modes: Record<string, QsoModeProgress>;
  /** Raw evidence counters badges are computed from (see lib/radio/badges.ts). */
  stats?: QsoStats;
  /** Earned badge tiers. Never revoked when criteria change. */
  badges?: Record<string, QsoBadgeRecord>;
  /** Per card key (`alphabet:symbol`): clean, correct copies in fast QSOs. */
  charMarks?: Record<string, QsoCharMark>;
}

export interface QsoStats {
  /** Correct clean chars in QSOs copied ≥ 95% clean, by minimum WPM threshold. */
  fastClean: Record<string, number>;
  /** Correct chars under each condition, in QSOs that held up under it. */
  envCorrect: Partial<Record<QsoEnvCondition, number>>;
  /** QSOs where every transmission was within the zero-in tolerance. */
  zeroIn: number;
  /** Completed QSOs typed by hand with no procedure slip. */
  freehand: number;
  /** QSOs with the callsign field copied right. */
  callsign: number;
}

export interface QsoBadgeRecord { tier: 1 | 2 | 3; at: number; criteriaVersion: number }
export interface QsoCharMark { count: number; at?: number }
