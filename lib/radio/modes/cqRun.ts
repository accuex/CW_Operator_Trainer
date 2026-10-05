import type { Station, Transmission } from '../band';
import { Ether, type AirEvent } from '../air/ether';
import { callDistance, isNearCall, normalizeCall, parseIntent, type OperatorIntent } from '../air/intent';
import { RandomPersonaSource, type PersonaSource } from '../air/persona';
import { CallerAgent, createCaller } from '../agents/caller';
import type { Agent, AgentContext, AgentMe, AgentNote, GoneReason } from '../agents/types';
import { normalizeRst, normalizeWord } from '../exchange';
import { poisson, type Random } from '../random';

/**
 * A CQ run: we hold a frequency, call CQ and work whoever answers, one after
 * another, until QRT. Pure and clock-agnostic — the rig (or the headless simulator)
 * feeds it transmissions and ticks, and it answers through a RadioPort.
 *
 * The run keeps the books (contacts, log, missed callers); the callers themselves
 * are agents on the shared air and decide on their own.
 */

export type RunPhase = 'setup' | 'cq' | 'pick' | 'exchange' | 'closing';
export type ContactStatus = 'open' | 'exchanged' | 'closed' | 'dropped';
/** How a contact ended, judged at QRT. */
export type ContactOutcome = 'complete' | 'no-closing' | 'incomplete' | 'bust';
export type LogVerdict = 'ok' | 'nil' | 'dupe';
/** Procedure slips spotted in our own transmission. */
export type RunIssue = 'cq-without-call' | 'no-call';

export interface RunParams {
  /** Centre speed of callers, WPM. */
  speed: number;
  /** Mean new callers per CQ. */
  callers: number;
  /** Callers' transmit offset, ±Hz. */
  spread: number;
  /** 0–1, weaker callers as it rises. */
  weak: number;
}

export const DEFAULT_RUN_PARAMS: RunParams = { speed: 16, callers: 0.8, spread: 80, weak: 0.15 };

/** What the rig does for the run. */
export interface RadioPort {
  now(): number;
  /** Queue a message on a station's transmitter. */
  send(station: Station, text: string, delay: number): void;
  /** The run's stations changed (callers arrived or left). */
  stationsChanged(stations: Station[]): void;
}

export interface RunConfig {
  random: Random;
  me: AgentMe;
  params: RunParams;
  personas?: PersonaSource;
}

export interface LogFields { call: string; rst: string; name: string; qth: string }

export interface RunContact {
  id: string;
  stationId: number;
  /** What the station actually is and sent. */
  truth: LogFields;
  /** Calls we sent meant for it, first = our first copy. */
  sentCalls: string[];
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

export interface RunTxResult { intent: OperatorIntent; issues: RunIssue[] }

export interface RunResult {
  contacts: (RunContact & { outcome: ContactOutcome; logIds: string[] })[];
  log: (RunLogEntry & { verdict: LogVerdict })[];
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
  };
}

/** Our CQ reaches this many new callers on average; a QRZ? or TU only half as many. */
const QRZ_ARRIVALS = 0.5;

export class RunSession {
  readonly ether = new Ether();
  readonly agents: CallerAgent[] = [];
  private contactList: RunContact[] = [];
  private logList: RunLogEntry[] = [];
  private partner: CallerAgent | null = null;
  private closingSent = false;
  private started: number | null = null;
  private txRf: number | null = null;
  private partialsPending = 0;
  private partialsTotal = 0;
  private seq = 0;
  private notes: AgentNote[] = [];
  private readonly personas: PersonaSource;
  private readonly ctx: AgentContext;

  constructor(private config: RunConfig, private radio: RadioPort) {
    this.personas = config.personas ?? new RandomPersonaSource();
    this.ctx = {
      now: () => radio.now(),
      random: config.random,
      send: (agent, text, delay) => radio.send(agent.station, text, delay),
      me: config.me,
      peers: () => this.agents.filter((agent) => !agent.gone),
      notify: (note) => this.onNote(note),
      hearsKeying: (agent, party) => this.ether.hearsKeying(agent, party, radio.now()),
    };
  }

  get phase(): RunPhase {
    if (this.started === null) return 'setup';
    if (this.partner && !this.partner.gone) return this.closingSent ? 'closing' : 'exchange';
    return this.agents.some((agent) => agent.state === 'waiting' || agent.state === 'holding') ? 'pick' : 'cq';
  }

  get partnerCall() { return this.partner && !this.partner.gone ? this.partner.call : null; }
  get stations(): Station[] { return this.agents.filter((agent) => this.onAir(agent)).map((agent) => agent.station); }
  get contacts(): readonly RunContact[] { return this.contactList.map((contact) => this.refresh(contact)); }
  get log(): readonly RunLogEntry[] { return this.logList; }

  /** A station's message went on the air (rig scheduler). */
  onStationTransmission(station: Station, tx: Transmission, epoch?: number) {
    this.ether.emit({ from: station.id, text: tx.text, intent: null, rf: station.rf, start: tx.start, end: tx.start + tx.length, epoch });
  }

  /**
   * We key `text` on `rf` from `start` to `end`. Report it as keying starts (the length is
   * known up front): callers then hear the carrier and hold off. Reporting it after it
   * ended still works, but callers will have called over us.
   */
  transmit(text: string, { start, end, rf }: { start: number; end: number; rf: number }): RunTxResult {
    const { me, params, random } = this.config;
    const intent = parseIntent(text, me.call);
    const issues: RunIssue[] = [];
    this.started ??= start;
    this.txRf = rf;

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
    if (intent.cq && !intent.mentionsMe) issues.push('cq-without-call');
    const exchangeOnly = (intent.report || intent.fields.name) && !intent.calls.length;
    if (exchangeOnly && !partner && this.agents.filter((agent) => agent.state === 'waiting').length > 1) issues.push('no-call');

    const arrivals = intent.cq && intent.mentionsMe ? params.callers
      : (intent.qrz || (intent.closing && intent.mentionsMe)) ? params.callers * QRZ_ARRIVALS : 0;
    this.spawn(poisson(random, arrivals), rf, end);

    this.ether.emit({ from: 'me', text, intent, rf, start, end });
    return { intent, issues };
  }

  /** Deliver what has ended on the air, run every agent's clock, drop stations that left. Returns delivered events. */
  tick(now: number): AirEvent[] {
    const due = this.ether.deliver(now);
    for (const event of due) {
      for (const agent of this.agents) {
        if (!agent.gone && this.ether.hears(agent, event)) agent.hear(event, this.ctx);
      }
    }
    for (const agent of this.agents) agent.tick(now, this.ctx);
    const before = this.lastStations;
    const after = this.stations;
    if (after.length !== before.length || after.some((station, index) => station !== before[index])) {
      this.lastStations = after;
      this.radio.stationsChanged(after);
    }
    return due;
  }

  /** Clock moved to a new epoch (rig power cycled) shifted by `shift` seconds. */
  rebase(epoch: number, shift: number) {
    this.ether.setEpoch(epoch);
    for (const agent of this.agents) agent.rebase(shift);
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
  finish(now: number): RunResult {
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
      },
    };
  }

  private lastStations: Station[] = [];

  /** New callers tune in to `rf`; they arrive as our message ends at `at`. */
  private spawn(count: number, rf: number, at: number) {
    if (!count) return;
    const { random, params } = this.config;
    const now = Math.max(at, this.radio.now());
    for (let index = 0; index < count; index += 1) {
      const active = this.agents.filter((agent) => !agent.gone).map((agent) => agent.call);
      const persona = this.personas.next({ random, speed: params.speed, weak: params.weak, spread: params.spread, active });
      this.agents.push(createCaller(persona, { random, listenRf: rf, now }));
    }
    // Put them on the band before they key anything, so the rig doesn't reshuffle their clocks.
    this.lastStations = this.stations;
    this.radio.stationsChanged(this.lastStations);
  }

  /** Still keying, about to key, or on frequency. */
  private onAir(agent: CallerAgent) {
    if (!agent.gone) return true;
    return agent.station.queue.length > 0 || agent.station.busyUntil > this.radio.now();
  }

  /** What the agents said since the last call (for coaching), oldest first. */
  drainNotes(): AgentNote[] {
    return this.notes.splice(0);
  }

  private onNote(note: AgentNote) {
    this.notes.push(note);
    const agent = note.agent as CallerAgent;
    const now = this.radio.now();
    switch (note.type) {
      case 'selected': {
        this.partner = agent;
        this.closingSent = false;
        if (this.contactOf(agent)) return;
        const { persona } = agent;
        this.contactList.push({
          id: `qso-${(this.seq += 1)}`,
          stationId: agent.id,
          truth: { call: persona.call, rst: persona.rst, name: persona.name, qth: persona.qth },
          sentCalls: [],
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

  private contactOf(agent: Agent) {
    return this.contactList.find((contact) => contact.stationId === agent.id) ?? null;
  }

  /** Live numbers kept on the agent (corrections, calls sent) copied onto the contact. */
  private refresh(contact: RunContact): RunContact {
    const agent = this.agents.find((item) => item.id === contact.stationId);
    if (!agent) return { ...contact };
    return { ...contact, sentCalls: [...agent.addressedAs], corrections: agent.corrections, busted: agent.busted };
  }

  /**
   * The newest contact with its exchange in and no log line yet; failing that, the
   * contact whose call is closest to what was logged (within 2 edits). Null = NIL.
   */
  private matchContact(call: string, except?: string): string | null {
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
  return { call: normalizeCall(fields.call), rst: normalizeRst(fields.rst), name: normalizeWord(fields.name), qth: normalizeWord(fields.qth) };
}

function outcomeOf(contact: RunContact): ContactOutcome {
  if (contact.exchangedAt === undefined) return 'incomplete';
  if (contact.busted) return 'bust';
  return contact.status === 'closed' ? 'complete' : 'no-closing';
}
