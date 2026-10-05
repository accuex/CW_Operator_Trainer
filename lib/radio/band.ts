import { keyText, type CharSpan, type Mark } from './keying';

/**
 * Band model for the QSO simulator: who is on the air, where, and what they send.
 * Pure (no Web Audio) so the scheduler can run on any clock and be tested.
 */

/** qrm: background chatter · target: the rag-chew partner · caller: answers our CQ · occupant: already using a frequency. */
export type StationRole = 'qrm' | 'target' | 'caller' | 'occupant';

export interface Station {
  id: number;
  role: StationRole;
  call: string;
  /** RF frequency in Hz. */
  rf: number;
  wpm: number;
  /** Linear 0.025–1 before fading. */
  strength: number;
  jitter: number;
  /** Hz per second. */
  drift: number;
  /** Hz the carrier starts low on each key-down (old transmitter). */
  chirp: number;
  qsbRate: number;
  qsbPhase: number;
  /** Latest QSB factor, 0–1. */
  fade: number;
  /** Repeating message (CQ loop / QRM chatter). null = only sends what is queued. */
  loop: (() => string) | null;
  /** Pause between looped transmissions, seconds [min, max]. */
  gap: [number, number];
  queue: string[];
  /** Absolute key-down intervals on the scheduler clock (for scope drawing). */
  marks: Mark[];
  nextAt: number;
  busyUntil: number;
}

/** One message on the air. Times are absolute on the scheduler clock. */
export interface Transmission { text: string; start: number; marks: Mark[]; length: number; chars: CharSpan[] }

export const BAND_EDGES = { low: 7_000_000, high: 7_030_000 } as const;

const QRM_PREFIX = ['JA1', 'JH1', 'JR3', 'JE6', 'JA7', 'JF8', 'JO1', '7K1', 'JL3', 'JG2', 'UA0', 'BV2', 'HL5', 'VK2', 'W6', 'K7', 'DL1', 'YB0'];

const pick = <T,>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)];
export const randomSuffix = (random: () => number, length = 3) =>
  Array.from({ length }, () => String.fromCharCode(65 + Math.floor(random() * 26))).join('');
export const randomQrmCall = (random: () => number) => pick(QRM_PREFIX, random) + randomSuffix(random);

const QRM_MESSAGES: ((call: string, random: () => number) => string)[] = [
  (c) => `CQ CQ CQ DE ${c} ${c} K`,
  (c) => `CQ TEST ${c} ${c} TEST`,
  (c) => `QRZ? DE ${c} K`,
  (c, r) => `R TU 5NN ${10 + Math.floor(r() * 40)} DE ${c} BK`,
  () => 'GM OM UR RST 599 599 = HW? BK',
  (c) => `TNX FER QSO 73 TU DE ${c} EE`,
];
export const qrmMessage = (call: string, random: () => number) => pick(QRM_MESSAGES, random)(call, random);

let nextId = 1;

export function makeStation(random: () => number, init: Partial<Station> & { rf: number }): Station {
  const call = init.call ?? randomQrmCall(random);
  const station: Station = {
    id: nextId++,
    role: 'qrm',
    call,
    wpm: 14 + Math.floor(random() * 18),
    strength: 10 ** (-random() * 1.6),
    jitter: random() < 0.3 ? 0.25 : 0.05,
    drift: random() < 0.15 ? (random() - 0.5) * 0.6 : 0,
    chirp: random() < 0.12 ? 25 : 0,
    qsbRate: 0.05 + random() * 0.25,
    qsbPhase: random() * Math.PI * 2,
    fade: 1,
    loop: null,
    gap: [1.5, 6.5],
    queue: [],
    marks: [],
    nextAt: 0,
    busyUntil: 0,
    ...init,
  };
  if (!init.loop && station.role === 'qrm') {
    let text = qrmMessage(call, random);
    station.loop = () => {
      if (random() < 0.35) text = qrmMessage(call, random);
      return text;
    };
  }
  return station;
}

/** QRM stations spread over ±span around center, kept clear of the given frequencies. */
export function makeQrm(random: () => number, count: number, center: number, keepClear: number[] = [], clearance = 150) {
  const out: Station[] = [];
  for (let guard = 0; out.length < count && guard < count * 20; guard += 1) {
    const rf = Math.round(center + (random() - 0.5) * 4600);
    if (keepClear.some((hz) => Math.abs(hz - rf) < clearance)) continue;
    out.push(makeStation(random, { rf }));
  }
  return out;
}

/**
 * Pop every transmission that starts before `horizon` and advance the station.
 * Mutates the station (marks / nextAt / busyUntil / queue).
 */
export function schedulePending(station: Station, now: number, horizon: number, random: () => number): Transmission[] {
  const out: Transmission[] = [];
  while (station.nextAt < horizon) {
    const queued = station.queue.shift();
    const text = queued ?? station.loop?.();
    if (!text) { station.nextAt = Number.POSITIVE_INFINITY; break; }
    const start = Math.max(station.nextAt, now);
    const keyed = keyText(text, { wpm: station.wpm, jitter: station.jitter, random });
    const marks = keyed.marks.map(([a, b]) => [start + a, start + b] as const);
    const chars = keyed.chars.map((span) => ({ ...span, start: start + span.start, end: start + span.end }));
    station.marks.push(...marks);
    station.busyUntil = start + keyed.length;
    const [low, high] = station.gap;
    station.nextAt = station.queue.length ? station.busyUntil + 0.6 : station.busyUntil + low + random() * (high - low);
    out.push({ text, start, marks, length: keyed.length, chars });
  }
  station.marks = station.marks.filter(([, end]) => end > now - 1);
  return out;
}

/** Queue a one-shot message (reply) after `delay` seconds, or right after the current one. */
export function enqueue(station: Station, text: string, now: number, delay = 0.8) {
  station.queue.push(text);
  station.nextAt = Math.max(now + delay, station.busyUntil + 0.6);
}

/** Drop everything not yet sent (key-up from `now`). */
export function cutStation(station: Station, now: number) {
  station.marks = station.marks.filter(([start]) => start < now).map(([start, end]) => [start, Math.min(end, now)] as const);
  station.busyUntil = Math.min(station.busyUntil, now);
  station.queue = [];
  station.nextAt = Number.POSITIVE_INFINITY;
}

export const isKeyed = (station: Station, t: number) => station.marks.some(([start, end]) => t >= start && t <= end);

/** QSB: slow sinusoidal fading, depth 0–1. */
export const fadeAt = (station: Station, t: number, depth: number) =>
  1 - depth * (0.5 + 0.5 * Math.sin(t * station.qsbRate * Math.PI * 2 + station.qsbPhase)) * 0.95;

export function nearestStation(stations: Station[], hz: number, within: number) {
  let best: Station | null = null;
  for (const station of stations) {
    if (Math.abs(station.rf - hz) > within) continue;
    if (!best || Math.abs(station.rf - hz) < Math.abs(best.rf - hz)) best = station;
  }
  return best;
}

/** 7012000 → { main: '7.012', sub: '00' } (MHz.kHz + 10 Hz digits). */
export function formatFrequency(hz: number) {
  const tens = Math.round(hz / 10);
  const khz = Math.floor(tens / 100);
  const sub = String(tens % 100).padStart(2, '0');
  const mhz = Math.floor(khz / 1000);
  return { main: `${mhz}.${String(khz % 1000).padStart(3, '0')}`, sub };
}
