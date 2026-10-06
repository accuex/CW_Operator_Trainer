import { RandomPersonaSource, type PersonaRequest, type PersonaSource, type StationPersona } from '../air/persona';
import { pick, type Random } from '../random';
import { formatSerial, type CutStyle, type SerialFormat } from './serial';

/**
 * The contest's field: every station taking part, each running its own contest. A
 * station has its own rate (so its serial keeps climbing while it is off working others),
 * its own way of keying the serial, and its own log — what it copied of us when we
 * worked it. A station that worked us may come back later (it forgot, or its logger
 * didn't say): a dupe, with a higher serial.
 *
 * The field stands in for the persona source of the run: callers are drawn from it,
 * and their logs are what our log is checked against at the end (BUST / NIL).
 */

export interface FieldOptions {
  /** Share of new callers whose call looks like one on frequency. */
  similar: number;
  /** 0–1: how hard serials are to copy — higher, more of them cut and the numbers bigger. */
  serial: number;
  /** Chance a new caller is a station that worked us already (when there is one off frequency). */
  dupes: number;
}

/** A line in a station's log: us, as it copied us. */
export interface StationLogLine {
  /** The caller (agent) that made the contact. */
  agentId: number;
  at: number;
  /** Our call as it logged it. */
  call: string;
  /** Our serial as it copied it (null: it never got one). */
  nr: number | null;
  /** The serial it gave us. */
  sent: number;
}

export interface FieldStation {
  persona: StationPersona;
  /** Its contacts an hour with everyone else. */
  rate: number;
  /** Its serial when our run began (contacts already in its log). */
  base: number;
  format: SerialFormat;
  log: StationLogLine[];
  /** Serials it has given us, in order. */
  given: number[];
}

export class ContestField implements PersonaSource {
  private readonly stations = new Map<string, FieldStation>();
  private readonly inner: RandomPersonaSource;

  constructor(private options: FieldOptions, private me: string) {
    this.inner = new RandomPersonaSource(options.similar);
  }

  next(request: PersonaRequest): StationPersona {
    const { random, active } = request;
    // A station that worked us, off frequency now, may call again (a dupe).
    const back = [...this.stations.values()].filter((station) => station.log.length > 0 && !active.includes(station.persona.call));
    if (back.length && random() < this.options.dupes) return pick(back, random).persona;
    const persona = contestPersona(this.inner.next(request), random);
    this.stations.set(persona.call, this.drawStation(persona, random));
    return persona;
  }

  station(call: string) { return this.stations.get(call) ?? null; }
  get all(): readonly FieldStation[] { return [...this.stations.values()]; }

  /**
   * The serial `call` gives us at run time `t`: the contacts it had at the start, those it
   * has made with others since (its rate), and those with us — always above the last it gave us.
   */
  serialFor(call: string, t: number) {
    const station = this.stations.get(call);
    if (!station) throw new Error(`not in the field: ${call}`);
    const serial = Math.max(station.base + Math.floor((Math.max(0, t) * station.rate) / 3600) + station.log.length + 1, (station.given.at(-1) ?? 0) + 1);
    station.given.push(serial);
    return serial;
  }

  /** How `call` keys a serial. */
  serialText(call: string, serial: number) {
    const station = this.stations.get(call);
    return formatSerial(serial, station?.format ?? { cut: 'none', pad: true });
  }

  /** `call` logged us (its caller `agentId` has our exchange in and sent its own). */
  record(call: string, line: Omit<StationLogLine, 'call'>) {
    const station = this.stations.get(call);
    if (!station) return;
    const existing = station.log.find((item) => item.agentId === line.agentId);
    if (existing) Object.assign(existing, { nr: line.nr });
    else station.log.push({ ...line, call: this.me });
  }

  /** It took its contact back (it answered a call that wasn't its own, or we said QSO B4). */
  unrecord(call: string, agentId: number) {
    const station = this.stations.get(call);
    if (!station) return;
    station.log = station.log.filter((item) => item.agentId !== agentId);
  }

  /** Our serial as caller `agentId` of `call` has it now (it may have copied it again). */
  update(call: string, agentId: number, nr: number | null) {
    const line = this.stations.get(call)?.log.find((item) => item.agentId === agentId);
    if (line && nr !== null) line.nr = nr;
  }

  private drawStation(persona: StationPersona, random: Random): FieldStation {
    const s = Math.min(1, Math.max(0, this.options.serial));
    const rate = Math.round(30 + random() * (60 + 90 * s));
    // Hours into the contest when we come on: early (small numbers) at 0, deep in at 1.
    const hours = 0.1 + random() * (0.4 + 2.6 * s);
    return { persona, rate, base: Math.floor(rate * hours), format: drawFormat(s, persona, random), log: [], given: [] };
  }
}

/** Everyone sends 599 in a contest; most cut it to 5NN (a novice spells it out). */
function contestPersona(persona: StationPersona, random: Random): StationPersona {
  const novice = persona.style === 'novice';
  return { ...persona, rst: '599', cutNumbers: !novice && random() < 0.85 };
}

/** How it keys its serial: more cut and fewer leading zeros as `s` rises. A novice sends plain digits. */
function drawFormat(s: number, persona: StationPersona, random: Random): SerialFormat {
  const cutDraw = random();
  const padDraw = random();
  if (persona.style === 'novice') return { cut: 'none', pad: true };
  let cut: CutStyle = 'none';
  if (cutDraw < 0.15 + 0.55 * s) cut = cutDraw < 0.1 * s ? 'all' : cutDraw < 0.3 * s ? 'tnae' : 'tn';
  return { cut, pad: padDraw < 0.75 - 0.35 * s };
}
