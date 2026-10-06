import type { Station, Transmission } from '../band';
import { Ether, type AirEvent } from '../air/ether';
import { callDistance, isNearCall, normalizeCall, parseIntent, type OperatorIntent } from '../air/intent';
import { RandomPersonaSource, type CrowdTraits, type PersonaSource, type StationPersona } from '../air/persona';
import { CallerAgent, createCaller, type CallerBehaviour } from '../agents/caller';
import type { Agent, AgentContext, AgentMe, AgentNote, GoneReason } from '../agents/types';
import { normalizeRst, normalizeWord } from '../exchange';
import type { MemoryTempo } from '../memories';
import type { Random } from '../random';

/**
 * What every run shares, whatever brings the callers and however the frequency is
 * kept: the shared air, the callers and residents on it, our partner, the books
 * (contacts, log, missed callers) and the clock. A mode (CQ run, later pileup and
 * contest) adds how callers arrive, what it watches on the frequency and its own
 * numbers at QRT.
 *
 * Pure and clock-agnostic — the rig (or the headless simulator) feeds it transmissions
 * and ticks, and it answers through a RadioPort. The callers are agents on the shared
 * air and decide on their own.
 */

export type RunPhase = 'setup' | 'cq' | 'pick' | 'exchange' | 'closing';
export type ContactStatus = 'open' | 'exchanged' | 'closed' | 'dropped';
/** How a contact ended, judged at QRT. */
export type ContactOutcome = 'complete' | 'no-closing' | 'incomplete' | 'bust';
export type LogVerdict = 'ok' | 'nil' | 'dupe';

/** Short exchanges (the standard run tempo) or the long rubber stamp — callers and our memory keys alike. */
export type ExchangeTempo = MemoryTempo;

/** Share of short-exchange callers by tempo. */
export const BRIEF_SHARE: Record<ExchangeTempo, number> = { short: 0.7, long: 0.15 };

/** Who the new callers are: what every mode's params have. */
export interface CallerParams {
  /** Centre speed of callers, WPM. */
  speed: number;
  /** Caller patience, recall and short-exchange share (see CrowdTraits); `brief` follows `tempo` unless given. */
  crowd: Partial<CrowdTraits>;
  tempo: ExchangeTempo;
  /** Callers' transmit offset, ±Hz. */
  spread: number;
  /** 0–1, weaker callers as it rises. */
  weak: number;
}

/** What the rig does for the run. */
export interface RadioPort {
  now(): number;
  /** Queue a message on a station's transmitter. */
  send(station: Station, text: string, delay: number): void;
  /** The run's stations changed (callers arrived or left). */
  stationsChanged(stations: Station[]): void;
}

export interface RunCoreConfig<P extends CallerParams> {
  random: Random;
  me: AgentMe;
  params: P;
  personas?: PersonaSource;
  /** Manners and exchange for every caller; omitted: the CQ run's. */
  behaviour?: CallerBehaviour;
}

/** `nr`: a contest serial — present only where the mode has one, so other modes' books read as before. */
export interface LogFields { call: string; rst: string; name: string; qth: string; nr?: string }

export interface RunContact {
  id: string;
  stationId: number;
  /** What the station actually is and sent. */
  truth: LogFields;
  /** Calls we sent meant for it, first = our first copy. */
  sentCalls: string[];
  /** When each of those went on the air. */
  sentAt: number[];
  /** Doublings between it and us. */
  doublings: number;
  corrections: number;
  /** Partial calls we sent before picking it. */
  partials: number;
  /** NAME? / QTH? / RST? we sent during it. */
  asks: number;
  qrs: number;
  /** Our transmissions while it was our partner. */
  txCount: number;
  busted: boolean;
  startedAt: number;
  exchangedAt?: number;
  closedAt?: number;
  status: ContactStatus;
}

export interface RunLogEntry { id: string; at: number; fields: LogFields; contactId: string | null }

export interface MissedCaller {
  stationId: number;
  call: string;
  wpm: number;
  strength: number;
  /** Where it keyed relative to us, Hz. */
  offsetHz: number;
  calls: number;
  reason: GoneReason;
}

export type JudgedContact = RunContact & { outcome: ContactOutcome; logIds: string[] };
export type JudgedLogEntry = RunLogEntry & { verdict: LogVerdict };

/** The books at QRT, as every mode keeps them. */
export interface RunBooks {
  contacts: JudgedContact[];
  log: JudgedLogEntry[];
  /** Contacts made on the air but never logged. */
  unlogged: string[];
  missed: MissedCaller[];
  stats: {
    seconds: number;
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
    /** Callers who came to the frequency. */
    callers: number;
    /** Doublings between us and callers. */
    doublings: number;
  };
}

export class RunCore<P extends CallerParams = CallerParams> {
  readonly ether = new Ether();
  readonly agents: CallerAgent[] = [];
  /** Stations living on the band regardless of us (QSOs in progress); free play adds more kinds. */
  readonly residents: Agent[] = [];
  protected contactList: RunContact[] = [];
  protected logList: RunLogEntry[] = [];
  private partner: CallerAgent | null = null;
  private closingSent = false;
  private started: number | null = null;
  private partialsPending = 0;
  private partialsTotal = 0;
  private seq = 0;
  private notes: AgentNote[] = [];
  private lastStations: Station[] = [];
  protected readonly personas: PersonaSource;
  private readonly ctx: AgentContext;

  constructor(protected config: RunCoreConfig<P>, protected radio: RadioPort) {
    this.personas = config.personas ?? new RandomPersonaSource();
    this.ctx = {
      now: () => radio.now(),
      random: config.random,
      send: (agent, text, delay) => radio.send(agent.station, text, delay),
      me: config.me,
      peers: () => this.agents.filter((agent) => !agent.gone),
      notify: (note) => this.onNote(note),
      hearsKeying: (agent, party, except) => this.ether.hearsKeying(agent, party, radio.now(), except),
      keyingSince: (agent, party) => this.ether.keyingSince(agent, party, radio.now()),
    };
  }

  get phase(): RunPhase {
    if (this.started === null) return 'setup';
    if (this.partner && !this.partner.gone) return this.closingSent ? 'closing' : 'exchange';
    return this.agents.some((agent) => agent.state === 'waiting' || agent.state === 'holding') ? 'pick' : 'cq';
  }

  get partnerCall() { return this.partner && !this.partner.gone ? this.partner.call : null; }
  get stations(): Station[] {
    return [...this.agents, ...this.residents].filter((agent) => this.onAir(agent)).map((agent) => agent.station);
  }

  /** Our transmitter is keyed at `now` — read from the air, not from what the UI has queued. */
  keying(now: number) { return this.ether.transmittingAt('me', now); }
  /** When our latest transmission ends (−∞ if none on the air recently). */
  get keyedUntil() { return this.ether.keyedUntil('me'); }

  /**
   * When the last caller we can hear within ±`width` Hz of `rf` stopped (or stops) keying,
   * as of `now`. Other stations' QRM doesn't count.
   */
  protected callersQuietNear(rf: number, width: number, now: number) {
    const ours = new Set<number>(this.agents.map((agent) => agent.id));
    return this.ether.lastNear(rf, width, (party) => party !== 'me' && ours.has(party), now);
  }

  /** Change how new callers behave from here on (tempo, crowd); those already here stay as they are. */
  setParams(change: Partial<P>) {
    this.config = { ...this.config, params: { ...this.config.params, ...change } };
  }
  get params(): Readonly<P> { return this.config.params; }

  get contacts(): readonly RunContact[] { return this.contactList.map((contact) => this.refresh(contact)); }
  get log(): readonly RunLogEntry[] { return this.logList; }

  /** A station's message went on the air (rig scheduler). */
  onStationTransmission(station: Station, tx: Transmission, epoch?: number) {
    this.ether.emit({ from: station.id, text: tx.text, intent: null, rf: station.rf, start: tx.start, end: tx.start + tx.length, epoch });
  }

  /**
   * Our transmission starting at `start`: what it says, and the books it touches whatever
   * the mode (the partner's contact, partial calls). Returns the partner it was sent to.
   */
  protected beginTransmit(text: string, start: number) {
    const intent = this.readIntent(text);
    this.started ??= start;
    const partner = this.partner && !this.partner.gone ? this.partner : null;
    if (partner) {
      const contact = this.contactOf(partner);
      if (contact) {
        contact.txCount += 1;
        contact.asks += intent.ask.length ? 1 : 0;
        contact.qrs += intent.qrs ? 1 : 0;
      }
      if (intent.closing) this.closingSent = true;
    }
    if (intent.partial) {
      this.partialsPending += 1;
      this.partialsTotal += 1;
    }
    return { intent, partner };
  }

  /** What our transmission means on this mode's frequency (a pileup reads some words its own way). */
  protected readIntent(text: string): OperatorIntent {
    return parseIntent(text, this.config.me.call);
  }

  /** An exchange sent to nobody in particular while more than one station is calling. */
  protected sentToNobody(intent: OperatorIntent, partner: CallerAgent | null) {
    const exchangeOnly = (intent.report || intent.fields.name) && !intent.calls.length;
    return Boolean(exchangeOnly && !partner && this.agents.filter((agent) => agent.state === 'waiting').length > 1);
  }

  /** Put our transmission on the air (after the mode has done with it). */
  protected emitOurs(text: string, intent: OperatorIntent, { start, end, rf }: { start: number; end: number; rf: number }) {
    this.ether.emit({ from: 'me', text, intent, rf, start, end });
  }

  /** Deliver what has ended on the air, run every agent's clock, drop stations that left. Returns delivered events. */
  tick(now: number): AirEvent[] {
    const due = this.ether.deliver(now);
    const everyone: Agent[] = [...this.agents, ...this.residents];
    for (const event of due) {
      for (const agent of everyone) {
        if (!agent.gone && this.ether.hears(agent, event)) agent.hear(event, this.ctx);
      }
    }
    for (const agent of everyone) agent.tick(now, this.ctx);
    this.afterAgents?.(now);
    const before = this.lastStations;
    const after = this.stations;
    if (after.length !== before.length || after.some((station, index) => station !== before[index])) {
      this.lastStations = after;
      this.radio.stationsChanged(after);
    }
    return due;
  }

  /** The mode's own clock, run each tick once every agent has had its turn. */
  protected afterAgents?(now: number): void;

  /** Clock moved to a new epoch (rig power cycled) shifted by `shift` seconds. */
  rebase(epoch: number, shift: number) {
    this.ether.setEpoch(epoch);
    for (const agent of [...this.agents, ...this.residents]) agent.rebase(shift);
  }

  /** Write one log line; it is tied to the contact it most likely records. */
  logEntry(fields: LogFields, at: number): RunLogEntry {
    const clean = cleanFields(fields);
    const entry: RunLogEntry = { id: `log-${(this.seq += 1)}`, at, fields: clean, contactId: this.matchContact(clean.call) };
    this.logList.push(entry);
    return entry;
  }

  /** Fix a line during the run. It stays tied to the same contact unless it had none. */
  editLog(id: string, fields: LogFields) {
    const entry = this.logList.find((item) => item.id === id);
    if (!entry) return null;
    entry.fields = cleanFields(fields);
    entry.contactId ??= this.matchContact(entry.fields.call, entry.id);
    return entry;
  }

  missed(): MissedCaller[] {
    return this.agents
      .filter((agent) => agent.state === 'gone' && agent.callsMade > 0 && !this.contactOf(agent))
      .map((agent) => ({
        stationId: agent.id,
        call: agent.call,
        wpm: agent.station.wpm,
        strength: agent.persona.strength,
        offsetHz: Math.round(agent.station.rf - agent.listenRf()),
        calls: agent.callsMade,
        reason: agent.goneReason ?? 'timeout',
      }));
  }

  /** QRT: judge every contact and log line. */
  protected closeBooks(now: number): RunBooks {
    const contacts = this.contacts.map((contact) => ({
      ...contact,
      outcome: outcomeOf(contact),
      logIds: this.logList.filter((entry) => entry.contactId === contact.id).map((entry) => entry.id),
    }));
    const seen = new Set<string>();
    const log = this.logList.map((entry) => {
      let verdict: LogVerdict = 'ok';
      if (!entry.contactId) verdict = 'nil';
      else if (seen.has(entry.contactId)) verdict = 'dupe';
      if (entry.contactId) seen.add(entry.contactId);
      return { ...entry, verdict };
    });
    const made = contacts.filter((contact) => contact.outcome !== 'incomplete');
    const unlogged = made.filter((contact) => !contact.logIds.length).map((contact) => contact.id);
    const addressed = contacts.filter((contact) => contact.sentCalls.length);
    const seconds = this.started === null ? 0 : Math.max(0, now - this.started);
    const complete = contacts.filter((contact) => contact.outcome === 'complete').length;
    return {
      contacts,
      log,
      unlogged,
      missed: this.missed(),
      stats: {
        seconds,
        contacts: made.length,
        rate: seconds > 0 ? (complete * 3600) / seconds : 0,
        firstCallAccuracy: addressed.length ? addressed.filter((contact) => contact.sentCalls[0] === contact.truth.call).length / addressed.length : null,
        partials: this.partialsTotal,
        corrections: contacts.reduce((sum, contact) => sum + contact.corrections, 0),
        busts: contacts.filter((contact) => contact.outcome === 'bust').length,
        nil: log.filter((entry) => entry.verdict === 'nil').length,
        unlogged: unlogged.length,
        dupes: log.filter((entry) => entry.verdict === 'dupe').length,
        callers: this.agents.length,
        doublings: this.agents.reduce((sum, agent) => sum + agent.doublings, 0),
      },
    };
  }

  /** New callers tune in to `rf`; they arrive as our message ends at `at`. */
  protected spawn(count: number, rf: number, at: number) {
    if (!count) return;
    const { random, params, behaviour } = this.config;
    const now = Math.max(at, this.radio.now());
    for (let index = 0; index < count; index += 1) {
      const active = [...this.agents, ...this.residents].filter((agent) => !agent.gone).map((agent) => agent.station.call);
      const crowd = { brief: BRIEF_SHARE[params.tempo], ...params.crowd };
      const persona = this.personas.next({ random, speed: params.speed, weak: params.weak, spread: params.spread, active, crowd });
      const shaped = this.shapeCaller ? this.shapeCaller(persona) : { persona, behaviour };
      this.agents.push(createCaller(shaped.persona, { random, listenRf: rf, now }, shaped.behaviour));
    }
    // Put them on the band before they key anything, so the rig doesn't reshuffle their clocks.
    this.publishStations();
  }

  /** A mode that shapes each caller itself (where it keys, how loud, its manners); omitted: as drawn, with `behaviour`. */
  protected shapeCaller?(persona: StationPersona): { persona: StationPersona; behaviour?: CallerBehaviour };

  /** Tell the rig who is on the air now. */
  protected publishStations() {
    this.lastStations = this.stations;
    this.radio.stationsChanged(this.lastStations);
  }

  /** Still keying, about to key, or on frequency. */
  private onAir(agent: Agent) {
    if (!agent.gone) return true;
    return agent.station.queue.length > 0 || agent.station.busyUntil > this.radio.now();
  }

  /** What the agents said since the last call (for coaching), oldest first. */
  drainNotes(): AgentNote[] {
    return this.notes.splice(0);
  }

  /** A note for the mode (frequency use and the like), before the books take it. */
  protected modeNote?(note: AgentNote): void;

  private onNote(note: AgentNote) {
    this.notes.push(note);
    this.modeNote?.(note);
    if (!(note.agent instanceof CallerAgent)) return;
    const agent = note.agent;
    const now = this.radio.now();
    switch (note.type) {
      case 'selected': {
        this.partner = agent;
        this.closingSent = false;
        if (this.contactOf(agent)) return;
        this.contactList.push({
          id: `qso-${(this.seq += 1)}`,
          stationId: agent.id,
          truth: this.truthOf(agent),
          sentCalls: [],
          sentAt: [],
          doublings: 0,
          corrections: 0,
          partials: this.partialsPending,
          asks: 0,
          qrs: 0,
          txCount: 1,
          busted: false,
          startedAt: now,
          status: 'open',
        });
        this.partialsPending = 0;
        return;
      }
      case 'released': {
        // It answered a call meant for someone else and stood back: its QSO never happened.
        const contact = this.contactOf(agent);
        if (contact) {
          contact.status = 'open';
          delete contact.exchangedAt;
        }
        if (this.partner === agent) {
          this.partner = this.agents.find((other) => other !== agent && (other.state === 'selected' || other.state === 'exchanged')) ?? null;
        }
        return;
      }
      case 'exchanged': {
        const contact = this.contactOf(agent);
        if (contact && contact.status === 'open') {
          contact.status = 'exchanged';
          contact.exchangedAt = now;
        }
        return;
      }
      case 'closed': {
        const contact = this.contactOf(agent);
        if (contact) {
          contact.status = 'closed';
          contact.closedAt = now;
        }
        if (this.partner === agent) this.partner = null;
        return;
      }
      case 'gone': {
        const contact = this.contactOf(agent);
        if (contact && contact.status === 'open') contact.status = 'dropped';
        if (this.partner === agent) this.partner = null;
        return;
      }
      default:
    }
  }

  /** What a station actually is and sends, for its contact (a contest adds its serial). */
  protected truthOf(agent: CallerAgent): LogFields {
    const { persona } = agent;
    return { call: persona.call, rst: persona.rst, name: persona.name, qth: persona.qth };
  }

  private contactOf(agent: Agent) {
    return this.contactList.find((contact) => contact.stationId === agent.id) ?? null;
  }

  /** Live numbers kept on the agent (corrections, calls sent) copied onto the contact. */
  private refresh(contact: RunContact): RunContact {
    const agent = this.agents.find((item) => item.id === contact.stationId);
    if (!agent) return { ...contact };
    return { ...contact, sentCalls: [...agent.addressedAs], sentAt: [...agent.addressedAt], doublings: agent.doublings, corrections: agent.corrections, busted: agent.busted };
  }

  /**
   * The newest contact with its exchange in and no log line yet; failing that, the
   * contact whose call is closest to what was logged (within 2 edits). Null = NIL.
   */
  protected matchContact(call: string, except?: string): string | null {
    const logged = new Set(this.logList.filter((entry) => entry.id !== except && entry.contactId).map((entry) => entry.contactId));
    const fresh = [...this.contactList].reverse().find((contact) => contact.exchangedAt !== undefined && !logged.has(contact.id));
    if (fresh && (fresh.truth.call === call || isNearCall(call, fresh.truth.call) || !this.contactList.some((contact) => contact.truth.call === call))) {
      return fresh.id;
    }
    let best: RunContact | null = null;
    for (const contact of this.contactList) {
      const distance = callDistance(call, contact.truth.call);
      if (distance > 2) continue;
      if (!best || distance < callDistance(call, best.truth.call)) best = contact;
    }
    return best?.id ?? null;
  }
}

function cleanFields(fields: LogFields): LogFields {
  const clean: LogFields = { call: normalizeCall(fields.call), rst: normalizeRst(fields.rst), name: normalizeWord(fields.name), qth: normalizeWord(fields.qth) };
  if (fields.nr !== undefined) clean.nr = normalizeWord(fields.nr);
  return clean;
}

function outcomeOf(contact: RunContact): ContactOutcome {
  if (contact.exchangedAt === undefined) return 'incomplete';
  if (contact.busted) return 'bust';
  return contact.status === 'closed' ? 'complete' : 'no-closing';
}
