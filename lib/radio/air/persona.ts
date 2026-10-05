import { randomSuffix } from '../band';
import { MIN_TARGET_WPM, JA_PREFIX, NAMES, QTH_AREA, RST } from '../qso';
import { gaussian, pick, type Random } from '../random';

/**
 * Who a station is and how it operates. Agents read only this, so a later source
 * can hand back persistent fictional stations (the KEN you worked last week)
 * instead of fresh random ones without touching any agent.
 */

/** How a station calls: JH3ABC / JH3ABC JH3ABC / JA1ZZZ DE JH3ABC JH3ABC K / slow novice. */
export type CallStyle = 'once' | 'twice' | 'formal' | 'novice';
/** Full rag-chew exchange or the short "R UR 579 NAME KEN QTH OSAKA BK". */
export type SendStyle = 'full' | 'brief';

export interface StationPersona {
  call: string;
  name: string;
  qth: string;
  /** Call area digit, consistent with qth. */
  area: number;
  wpm: number;
  jitter: number;
  style: CallStyle;
  sendStyle: SendStyle;
  /** How many unanswered calls it makes before giving up (calls lost in a doubling don't count). */
  patience: number;
  /** Seconds it waits to be picked, from its first call, before moving on. */
  waitLimit: number;
  /** Chance it calls again at each CQ / QRZ? / AGN? while waiting (else it sits that one out). */
  recall: number;
  /** Seconds from hearing us to keying, [min, max]. */
  reaction: readonly [number, number];
  /** Seconds it listens after its own call before calling again, [min, max]. */
  retry: readonly [number, number];
  /** Linear signal strength at our receiver, 0.025–1. */
  strength: number;
  /** Its transmit error from where it hears us, Hz. */
  offsetHz: number;
  /** Its receive passband, Hz. */
  rxWidth: number;
  /** Will not slow below this on QRS. */
  qrsFloor: number;
  /** The report it gives us. */
  rst: string;
  /** Sends 5NN for 599. */
  cutNumbers: boolean;
  /** Final reply: "TU 73 EE" with our name, or just "EE". */
  closing: 'full' | 'ee';
}

export interface PersonaRequest {
  random: Random;
  /** Centre speed, WPM. */
  speed: number;
  /** 0–1, weaker signals as it rises. */
  weak: number;
  /** Transmit offset spread, ±Hz. */
  spread: number;
  /** Calls already on the air, to make look-alikes from. */
  active: readonly string[];
  /** How the crowd behaves; an ordinary evening if omitted. */
  crowd?: Partial<CrowdTraits>;
}

/**
 * The knobs that make a frequency quiet or crowded, read per caller. Together with
 * the run's arrival rate they settle how many stations end up waiting — a pileup is
 * the same callers with these turned up, never a cap on their number.
 */
export interface CrowdTraits {
  /** Scales patience in calls and in seconds. */
  patience: number;
  /** Mean chance of calling again at each CQ / QRZ? / AGN?. */
  recall: number;
  /** Share of (non-novice) callers sending the short exchange. */
  brief: number;
}

export const DEFAULT_CROWD: CrowdTraits = { patience: 1, recall: 0.8, brief: 0.4 };

export interface PersonaSource {
  next(request: PersonaRequest): StationPersona;
}

export const NOVICE_RATE = 0.15;
export const MAX_WPM = 40;

const areaQths = (area: number) => QTH_AREA.filter(([, digit]) => digit === area).map(([qth]) => qth);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** A call one or two letters off `call` in the same area: JH3ABC → JA3ABC / JH3ABD. */
export function lookAlike(call: string, random: Random): string | null {
  const match = /^([A-Z0-9]{1,3})([0-9])([A-Z]{1,4})$/.exec(call);
  if (!match) return null;
  const [, prefix, digit, suffix] = match;
  if (random() < 0.5 && prefix.startsWith('J')) {
    const other = JA_PREFIX.filter((item) => item !== prefix);
    return `${pick(other, random)}${digit}${suffix}`;
  }
  const index = Math.floor(random() * suffix.length);
  const letter = String.fromCharCode(65 + Math.floor(random() * 26));
  const next = `${prefix}${digit}${suffix.slice(0, index)}${letter}${suffix.slice(index + 1)}`;
  return next === call ? null : next;
}

/** Fresh random Japanese stations, never the same call twice from one source (one run). */
export class RandomPersonaSource implements PersonaSource {
  private used = new Set<string>();

  constructor(private similarRate = 0.12) {}

  next({ random, speed, weak, spread, active, crowd: crowdChange }: PersonaRequest): StationPersona {
    const crowd = { ...DEFAULT_CROWD, ...crowdChange };
    const call = this.uniqueCall(random, active);
    const area = Number(/[0-9](?=[A-Z]+$)/.exec(call)?.[0] ?? 1);
    const novice = random() < NOVICE_RATE;
    const wpm = novice
      ? Math.max(MIN_TARGET_WPM, Math.round(speed) - 4 - Math.floor(random() * 5))
      : clamp(Math.round(speed + (random() * 2 - 1) * 3), MIN_TARGET_WPM, MAX_WPM);
    const style: CallStyle = novice ? 'novice' : random() < 0.3 ? 'once' : random() < 0.64 ? 'twice' : 'formal';
    const rst = pick(RST, random);
    return {
      call,
      name: pick(NAMES, random),
      qth: pick(areaQths(area).length ? areaQths(area) : ['TOKYO'], random),
      area,
      wpm,
      jitter: novice ? 0.2 : 0.03 + random() * 0.07,
      style,
      sendStyle: !novice && random() < crowd.brief ? 'brief' : 'full',
      patience: Math.max(1, Math.round((2 + Math.floor(random() * 4)) * crowd.patience)),
      waitLimit: Math.round((60 + random() * 90) * crowd.patience),
      recall: clamp(crowd.recall + (random() - 0.5) * 0.3, 0, 1),
      reaction: novice ? [0.5, 3] : [0.2, 1.5],
      retry: [2.5, 5],
      strength: clamp((0.85 - weak * 0.75) * (0.35 + random() * 0.8), 0.025, 1),
      offsetHz: Math.round(clamp(gaussian(random) * spread / 2, -spread, spread)),
      rxWidth: Math.round(250 + random() * 250),
      qrsFloor: novice ? wpm : Math.max(MIN_TARGET_WPM, wpm - 8),
      rst,
      cutNumbers: !novice && rst === '599' && random() < 0.5,
      closing: novice || random() < 0.6 ? 'full' : 'ee',
    };
  }

  private uniqueCall(random: Random, active: readonly string[]) {
    for (let guard = 0; guard < 50; guard += 1) {
      const similar = active.length && random() < this.similarRate ? lookAlike(pick(active, random), random) : null;
      const [, area] = pick(QTH_AREA, random);
      const call = similar ?? `${pick(JA_PREFIX, random)}${area}${randomSuffix(random, random() < 0.2 ? 2 : 3)}`;
      if (this.used.has(call)) continue;
      this.used.add(call);
      return call;
    }
    throw new Error('persona source ran out of calls');
  }
}
