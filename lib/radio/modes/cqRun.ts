import type { Station, Transmission } from '../band';
import { Ether, type AirEvent } from '../air/ether';
import { callDistance, isNearCall, normalizeCall, parseIntent, type OperatorIntent } from '../air/intent';
import { RandomPersonaSource, type CrowdTraits, type PersonaSource } from '../air/persona';
import { CallerAgent, createCaller } from '../agents/caller';
import { createOccupantPair, type OccupantPair } from '../agents/occupant';
import type { Agent, AgentContext, AgentMe, AgentNote, GoneReason } from '../agents/types';
import { normalizeRst, normalizeWord } from '../exchange';
import type { MemoryTempo } from '../memories';
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
/**
 * Procedure slips spotted in our own transmission. A CQ on a frequency in use is
 * 'cq-without-qrl' if we never asked, 'busy-frequency' if we asked first (and it was in use all the same).
 * 'qrl-no-listen': a QRL? only checks the frequency once we have listened after it.
 */
export type RunIssue = 'cq-without-call' | 'no-call' | 'cq-without-qrl' | 'busy-frequency' | 'qrl-no-listen';

/** Short exchanges (the standard run tempo) or the long rubber stamp — callers and our memory keys alike. */
export type ExchangeTempo = MemoryTempo;

/**
 * What a frequency check says right now: 'none' — no QRL? pending here; 'listening' — QRL?
 * sent, still inside the listen window; 'busy' — someone was heard; 'clear' — listened, nothing.
 */
export type FrequencyCheck = { state: 'none' } | { state: 'listening'; until: number } | { state: 'busy' } | { state: 'clear' };

export interface RunParams {
  /** Centre speed of callers, WPM. */
  speed: number;
  /**
   * New listeners per minute who find us and call at our next CQ / QRZ? / TU. Per minute,
   * not per CQ: repeating CQ faster doesn't bring more people to the band.
   */
  arrivals: number;
  /** Caller patience, recall and short-exchange share (see CrowdTraits); `brief` follows `tempo` unless given. */
  crowd: Partial<CrowdTraits>;
  tempo: ExchangeTempo;
  /** Callers' transmit offset, ±Hz. */
  spread: number;
  /** 0–1, weaker callers as it rises. */
  weak: number;
  /** Chance a QSO is already going on where we start, 0–0.5. */
  busy: number;
}

export const DEFAULT_RUN_PARAMS: RunParams = { speed: 16, arrivals: 1.5, crowd: {}, tempo: 'short', spread: 80, weak: 0.15, busy: 0.35 };

/** Share of short-exchange callers by tempo. */
export const BRIEF_SHARE: Record<ExchangeTempo, number> = { short: 0.7, long: 0.15 };
/** Listeners who found us this long ago or more have moved on: arrivals count at most this window. */
export const ARRIVAL_WINDOW = 45;
/** Who is already tuned to the frequency when our first CQ goes out (seconds' worth of arrivals). */
const FIRST_WINDOW = 20;

/** "In use": someone else keyed within ±BUSY_HZ of our frequency in the last BUSY_SECONDS. */
export const BUSY_HZ = 250;
export const BUSY_SECONDS = 20;
/** A QRL? counts for a CQ within this many Hz and seconds of it. */
export const QRL_HZ = 100;
export const QRL_VALID = 60;
/** Seconds to listen after QRL? before the frequency counts as checked. */
export const QRL_LISTEN = 3;
/** Callers who still come to a CQ on top of someone else's QSO. */
export const BUSY_ARRIVALS = 0.3;
/** One-sided QSOs (we hear only one of the two) among those placed. */
export const ONE_SIDED_RATE = 0.35;

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

/** A frequency we called CQ on (the record procedure badges will count from). */
export interface FrequencyUse {
  rf: number;
  firstCqAt: number;
  /** We sent QRL? there before the first CQ. */
  qrlFirst: boolean;
  /** Seconds we listened between that QRL? ending and the first CQ (null: no QRL?). */
  qrlListen: number | null;
  lastCqAt: number;
  /** CQs we sent there while it was in use. */
  busyCqs: number;
  /** Times a station there asked us to QSY. */
  qsyAsked: number;
}

/** Where residents go when the run starts. Omitted fields are drawn from `busy`. */
export interface Placement {
  /** A QSO right on our frequency. */
  onFrequency?: boolean;
  /** Further QSOs elsewhere within a few kHz. */
  nearby?: number;
  oneSided?: boolean;
}

export interface RunResult {
  contacts: (RunContact & { outcome: ContactOutcome; logIds: string[] })[];
  log: (RunLogEntry & { verdict: LogVerdict })[];
  /** Contacts made on the air but never logged. */
  unlogged: string[];
  missed: MissedCaller[];
  frequencies: FrequencyUse[];
  tempo: ExchangeTempo;
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
    /** CQs sent on a frequency in use. */
    busyCqs: number;
    /** First CQs sent before listening out a QRL?. */
    qrlNoListen: number;
    /** Callers who came to the frequency. */
    callers: number;
    /** Doublings between us and callers. */
    doublings: number;
  };
}

/** A bare QRZ? (no call of ours) is found by half as many. */
const QRZ_ARRIVALS = 0.5;

export class RunSession {
  readonly ether = new Ether();
  readonly agents: CallerAgent[] = [];
  /** Stations living on the band regardless of us (QSOs in progress); free play adds more kinds. */
  readonly residents: Agent[] = [];
  readonly occupants: OccupantPair[] = [];
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
  private qrls: { rf: number; at: number; end: number }[] = [];
  /** Start of the transmission that last let new listeners find us. */
  private foundAt: number | null = null;
  private frequencyList: FrequencyUse[] = [];
  private qrlNoListen = 0;
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
  get frequencies(): readonly FrequencyUse[] { return this.frequencyList; }

  /** Our transmitter is keyed at `now` — read from the air, not from what the UI has queued. */
  keying(now: number) { return this.ether.transmittingAt('me', now); }
  /** When our latest transmission ends (−∞ if none on the air recently). */
  get keyedUntil() { return this.ether.keyedUntil('me'); }

  /** Is `rf` in use by someone other than us and our callers, as heard on the air by `at`? */
  frequencyBusy(rf: number, at: number) {
    const ours = new Set<number>(this.agents.map((agent) => agent.id));
    return this.ether.activeNear(rf, BUSY_HZ, at - BUSY_SECONDS, (party) => party === 'me' || ours.has(party), at);
  }

  /**
   * When the last caller we can hear on `rf` stopped (or stops) keying, as of `now` — CQ
   * repeat listens from here, so it doesn't step on someone calling. Other stations'
   * QRM doesn't hold it.
   */
  callersQuietFrom(rf: number, now: number) {
    const ours = new Set<number>(this.agents.map((agent) => agent.id));
    return this.ether.lastNear(rf, BUSY_HZ, (party) => party !== 'me' && ours.has(party), now);
  }

  /** The QRL? on `rf` not yet followed by a CQ there, if it is recent enough to count. */
  private pendingQrl(rf: number, at: number) {
    const qrl = [...this.qrls].reverse().find((item) => Math.abs(item.rf - rf) <= QRL_HZ && item.at < at && at - item.end <= QRL_VALID);
    if (!qrl) return null;
    const use = this.frequencyList.find((item) => Math.abs(item.rf - rf) <= QRL_HZ);
    return use && use.lastCqAt > qrl.at ? null : qrl;
  }

  /**
   * Where the check of `rf` stands at `now`, read from the air: after a QRL? we listen
   * QRL_LISTEN seconds, and anyone heard near the frequency meanwhile makes it busy.
   * A UI may hold a CQ on this; it never decides it from its own queue.
   */
  frequencyCheck(rf: number, now: number): FrequencyCheck {
    const qrl = this.pendingQrl(rf, now);
    if (!qrl) return { state: 'none' };
    if (this.frequencyBusy(rf, now)) return { state: 'busy' };
    const until = qrl.end + QRL_LISTEN;
    return now < until ? { state: 'listening', until } : { state: 'clear' };
  }

  /** Change how new callers behave from here on (tempo, crowd); those already here stay as they are. */
  setParams(change: Partial<RunParams>) {
    this.config = { ...this.config, params: { ...this.config.params, ...change } };
  }
  get params(): Readonly<RunParams> { return this.config.params; }

  /**
   * Put the band's residents around where we start at `rf`: maybe a QSO right on it
   * (chance `busy`), and a couple more within a few kHz so a QSY can land on one too.
   */
  populate(rf: number, now: number, placement: Placement = {}) {
    const { random, params } = this.config;
    const onFrequency = placement.onFrequency ?? random() < params.busy;
    const nearby = placement.nearby ?? 1 + Math.floor(random() * 2);
    const spots: number[] = [];
    if (onFrequency) spots.push(rf + Math.round((random() - 0.5) * 2 * 150));
    for (let guard = 0; spots.length < nearby + (onFrequency ? 1 : 0) && guard < 50; guard += 1) {
      const spot = Math.round(rf + (random() < 0.5 ? -1 : 1) * (700 + random() * 2300));
      if (spots.every((other) => Math.abs(other - spot) > 600) && Math.abs(spot - rf) > 600) spots.push(spot);
    }
    for (const spot of spots) {
      const active = [...this.agents, ...this.residents].map((agent) => (agent as CallerAgent).station.call);
      const request = { random, speed: params.speed, weak: params.weak * 0.5, spread: 0, active };
      const pair = createOccupantPair([this.personas.next(request), this.personas.next(request)], random, {
        rf: spot, now, oneSided: placement.oneSided ?? random() < ONE_SIDED_RATE,
      });
      this.occupants.push(pair);
      this.residents.push(...pair.agents);
    }
    this.lastStations = this.stations;
    this.radio.stationsChanged(this.lastStations);
    return this.occupants;
  }
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
    let busy = false;
    if (intent.cq) {
      busy = this.frequencyBusy(rf, start);
      const qrl = this.pendingQrl(rf, start);
      const asked = qrl !== null || this.qrls.some((item) => Math.abs(item.rf - rf) <= QRL_HZ && item.at < start && start - item.end <= QRL_VALID);
      const listened = qrl ? Math.max(0, start - qrl.end) : null;
      let use = this.frequencyList.find((item) => Math.abs(item.rf - rf) <= QRL_HZ);
      if (!use) {
        use = { rf, firstCqAt: start, qrlFirst: asked, qrlListen: listened, lastCqAt: start, busyCqs: 0, qsyAsked: 0 };
        this.frequencyList.push(use);
      }
      use.lastCqAt = start;
      if (busy) {
        use.busyCqs += 1;
        issues.push(asked ? 'busy-frequency' : 'cq-without-qrl');
      } else if (listened !== null && listened < QRL_LISTEN) {
        issues.push('qrl-no-listen');
        this.qrlNoListen += 1;
      }
    }
    if (intent.qrl) this.qrls.push({ rf, at: start, end });
    const exchangeOnly = (intent.report || intent.fields.name) && !intent.calls.length;
    if (exchangeOnly && !partner && this.agents.filter((agent) => agent.state === 'waiting').length > 1) issues.push('no-call');

    // Listeners tune in at a steady rate and call when they hear who we are; patience and
    // re-calls live on the callers. Together they settle the crowd — nothing caps it.
    const found = intent.mentionsMe && (intent.cq || intent.qrz || intent.closing);
    if (found || intent.qrz) {
      const window = Math.min(ARRIVAL_WINDOW, start - (this.foundAt ?? start - FIRST_WINDOW));
      this.foundAt = start;
      const mean = (params.arrivals / 60) * window * (found ? 1 : QRZ_ARRIVALS) * (busy ? BUSY_ARRIVALS : 1);
      this.spawn(poisson(random, mean), rf, end);
    }

    this.ether.emit({ from: 'me', text, intent, rf, start, end });
    return { intent, issues };
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
      frequencies: this.frequencyList.map((use) => ({ ...use })),
      tempo: this.config.params.tempo,
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
        busyCqs: this.frequencyList.reduce((sum, use) => sum + use.busyCqs, 0),
        qrlNoListen: this.qrlNoListen,
        callers: this.agents.length,
        doublings: this.agents.reduce((sum, agent) => sum + agent.doublings, 0),
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
      const active = [...this.agents, ...this.residents].filter((agent) => !agent.gone).map((agent) => agent.station.call);
      const crowd = { brief: BRIEF_SHARE[params.tempo], ...params.crowd };
      const persona = this.personas.next({ random, speed: params.speed, weak: params.weak, spread: params.spread, active, crowd });
      this.agents.push(createCaller(persona, { random, listenRf: rf, now }));
    }
    // Put them on the band before they key anything, so the rig doesn't reshuffle their clocks.
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

  private onNote(note: AgentNote) {
    this.notes.push(note);
    if (note.type === 'qsy-asked') {
      const rf = note.agent.station.rf;
      const use = [...this.frequencyList].reverse().find((item) => Math.abs(item.rf - rf) <= BUSY_HZ);
      if (use) use.qsyAsked += 1;
    }
    if (!(note.agent instanceof CallerAgent)) return;
    const agent = note.agent;
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
