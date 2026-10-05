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
/**
 * What a character actually went through, one step past the raw condition: a character
 * buried under another caller keying at the same time (QRM from a caller) was an
 * overlap; one sent while we were keying (muted) was doubled — our doubling. Neither
 * is the band. Records from before overlap existed file both under doubled.
 */
export type CopySituation = 'clean' | QsoEnvCondition | 'overlap' | 'doubled' | 'detuned' | 'unheard';
/**
 * Why a log character was wrong. copy = clean conditions (the skill itself);
 * environment = band (QRM / QSB / QRN / weak); overlap = another caller keyed over it;
 * doubling = it went out under our transmission; tuning = off the passband; timing = never heard.
 */
export type QsoCause = 'ok' | 'copy' | 'environment' | 'overlap' | 'doubling' | 'tuning' | 'timing';

/** Other callers keyed over a character: the strongest of them against the one copied. */
export interface QsoOverlapEnv {
  /** Callers keying at once besides the one copied (most at any instant of the character). */
  n: number;
  /** |strongest − copied| tone, Hz. */
  dHz: number;
  /** Strongest over copied, dB (positive: it was louder). */
  dB: number;
  /** Strongest − copied, WPM. */
  dWpm: number;
}

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
  /** Who the strongest QRM was: another caller (an overlap) or the band. Absent: no QRM. */
  qrmFrom?: 'caller' | 'band';
  /** Other callers actually keying during the character (absent: none). */
  overlap?: QsoOverlapEnv;
}

export interface QsoAnswerMeta {
  modeId: string;
  presetId: string;
  field: string;
  condition: CopyCondition;
  /** Older records lack it (then it follows `condition`). */
  situation?: CopySituation;
  cause: QsoCause;
  env: QsoCharEnv;
  /**
   * Set when the miss wasn't this character's copy at all (a pileup: a look-alike
   * station, a lid's interference, a logging slip): kept, but out of weak-character analysis.
   */
  blame?: string;
}

/** `overlap` is absent on records from before it was told apart from doubling. */
export type QsoCauseCounts = Record<Exclude<QsoCause, 'ok' | 'overlap'>, number> & { overlap?: number; procedure: number };

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
  /** Pileup numbers (pileup-run only): counts, never the trace. */
  pileup?: QsoPileupSummary;
}

/** Why a pileup went wrong where it did (see lib/radio/pileup/analysis.ts). */
export type PileupCause = 'reception' | 'overlap' | 'weak' | 'environment' | 'doubling' | 'similar' | 'interference' | 'procedure' | 'logging';
/** Stations that answered the cue a pick was made from. */
export type PileupCrowd = '1' | '2' | '3+';

/** The synced side of a pileup run: what it says about the operator, no trace. */
export interface QsoPileupSummary {
  level: string;
  picks: number;
  /** Calls we sent that the station was keying over (it never heard them). */
  doubledPicks: number;
  partials: number;
  /** Partials nobody / several on the frequency fit. */
  emptyPartials: number;
  crowdedPartials: number;
  /** Picks that started with a partial, and of them the ones worked right with a call fitting that partial. */
  narrowings: number;
  narrowed: number;
  /** First call sent right, by how many stations answered the cue it was picked from (look-alike and lid cases left out). */
  firstCall: Partial<Record<PileupCrowd, { total: number; correct: number }>>;
  /** Contacts with a look-alike on the frequency at the pick, and of them the ones logged right. */
  similarMet: number;
  similarRight: number;
  hijacks: number;
  /** Off-cue answers from eager and lid callers. */
  eager: number;
  lid: number;
  causes: Partial<Record<PileupCause, number>>;
  cleanRate: number;
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
  /** Exchange tempo: short (standard) or the long rubber stamp. */
  tempo?: 'short' | 'long';
  /** Callers who came to the frequency, and doublings with them. */
  callers?: number;
  doublings?: number;
  /** CQs sent on a frequency in use. */
  busyCqs?: number;
  /** First CQs keyed before listening out a QRL?. */
  qrlNoListen?: number;
  /** Every frequency we called CQ on, in order, and how it was checked. */
  frequencies?: QsoFrequencySummary[];
  /** Frequencies checked properly before CQ (listened out a QRL?, clear), and ones found in use and left alone. */
  frequencyChecks?: number;
  busyAvoided?: number;
  /** Complete contacts logged all-correct, per hour. */
  cleanRate?: number;
}

/** How we took a frequency: kept for analysing operating procedure later. */
export interface QsoFrequencySummary {
  /** Hz. */
  rf: number;
  /** Wall clock of the first CQ there. */
  at: number;
  qrlFirst: boolean;
  /** Seconds listened between QRL? and the first CQ (null: no QRL?). */
  qrlListen: number | null;
  busyCqs: number;
  /** Times a station there asked us to QSY. */
  qsyAsked: number;
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
  /** Pileup: the level `difficulty` was set from (おまかせ moves it from there). */
  level?: string;
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
    /** Whole-call copy (see CallsignSkill). Absent until a call was judged. */
    callsign?: CallsignSkill;
    /** Pileup skills, kept apart from callsign (see PileupSkill). */
    pileup?: PileupSkill;
  };
  modes: Record<string, QsoModeProgress>;
  /** Raw evidence counters badges are computed from (see lib/radio/badges.ts). */
  stats?: QsoStats;
  /** Earned badge tiers. Never revoked when criteria change. */
  badges?: Record<string, QsoBadgeRecord>;
  /** Per card key (`alphabet:symbol`): clean, correct copies in fast QSOs. */
  charMarks?: Record<string, QsoCharMark>;
}

/**
 * A whole call, right or wrong, sorted by what its characters went through. `clean` is
 * the call-copy skill itself; calls with any character under QRM, QSB, a doubling … go
 * to their own bucket instead, kept for "fine normally, falls apart under QRM".
 */
export interface CallSkillBuckets {
  clean?: SkillEstimate;
  situations: Partial<Record<Exclude<CopySituation, 'clean'>, SkillEstimate>>;
}

export interface CallsignSkill {
  /** The call as finally logged. */
  log: CallSkillBuckets;
  /** The first call we sent back (run modes): copy on the first hearing. */
  first: CallSkillBuckets;
}

/**
 * Pileup skills, each from its own evidence: a look-alike, a lid or our own doubling
 * never counts against call copy. Clean first calls are shared with callsign.
 */
export interface PileupSkill {
  /** First call right, picked from one station in the clear (no look-alike, no lid). */
  copy?: SkillEstimate;
  /** …picked from two or more answering at once. */
  overlap?: SkillEstimate;
  /** Picks begun with a partial that ended worked right, with a call fitting it. */
  narrowing?: SkillEstimate;
  /** Contacts with a look-alike on the frequency logged right. */
  similar?: SkillEstimate;
  /** Calls sent with the station clear (not keying over them). */
  timing?: SkillEstimate;
  /** Log lines without a logging slip. */
  logging?: SkillEstimate;
}

/** Pileup counters for its badges. */
export interface PileupStats {
  /** Complete contacts logged right. */
  contacts: number;
  /** …of them picked with a partial that fit. */
  narrowed: number;
  /** …of them made with a look-alike on the frequency. */
  similar: number;
  /** Runs long enough to count with at most one doubled call. */
  calmRuns: number;
  /** Best clean rate in a run long enough to count. */
  bestRate: number;
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
  /**
   * Frequencies checked properly before a CQ: QRL?, listened QRL_LISTEN s or more, and
   * clear — or found in use and left without calling CQ there.
   */
  frequencyChecks?: number;
  /** Best clean rate (complete, all-correct contacts per hour) in a run long enough to count. */
  bestRate?: number;
  pileup?: PileupStats;
}

export interface QsoBadgeRecord { tier: 1 | 2 | 3; at: number; criteriaVersion: number }
export interface QsoCharMark { count: number; at?: number }
