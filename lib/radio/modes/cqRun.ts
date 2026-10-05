import { type OperatorIntent } from '../air/intent';
import type { PersonaSource } from '../air/persona';
import { createOccupantPair, type OccupantPair } from '../agents/occupant';
import type { AgentMe, AgentNote } from '../agents/types';
import type { Random } from '../random';
import { CqArrivals } from './arrivals';
import { BUSY_HZ, FrequencyKeeper, type FrequencyCheck, type FrequencyUse } from './frequencyKeeper';
import { RunCore, type CallerParams, type ExchangeTempo, type JudgedContact, type JudgedLogEntry, type MissedCaller, type RadioPort } from './runCore';

/**
 * A CQ run: we hold a frequency, call CQ and work whoever answers, one after
 * another, until QRT. The shared part of any run (air, callers, books) is RunCore;
 * a CQ run adds listeners finding us (CqArrivals), keeping a frequency (QRL?, in use —
 * FrequencyKeeper) and the residents already on the band where we start.
 */

export { ARRIVAL_WINDOW, BUSY_ARRIVALS } from './arrivals';
export { BUSY_HZ, BUSY_SECONDS, QRL_HZ, QRL_LISTEN, QRL_VALID, type FrequencyCheck, type FrequencyUse } from './frequencyKeeper';
export {
  BRIEF_SHARE, type ContactOutcome, type ContactStatus, type ExchangeTempo, type LogFields, type LogVerdict, type MissedCaller,
  type RadioPort, type RunContact, type RunLogEntry, type RunPhase,
} from './runCore';

/**
 * Procedure slips spotted in our own transmission. A CQ on a frequency in use is
 * 'cq-without-qrl' if we never asked, 'busy-frequency' if we asked first (and it was in use all the same).
 * 'qrl-no-listen': a QRL? only checks the frequency once we have listened after it.
 */
export type RunIssue = 'cq-without-call' | 'no-call' | 'cq-without-qrl' | 'busy-frequency' | 'qrl-no-listen';

export interface RunParams extends CallerParams {
  /**
   * New listeners per minute who find us and call at our next CQ / QRZ? / TU. Per minute,
   * not per CQ: repeating CQ faster doesn't bring more people to the band.
   */
  arrivals: number;
  /** Chance a QSO is already going on where we start, 0–0.5. */
  busy: number;
}

export const DEFAULT_RUN_PARAMS: RunParams = { speed: 16, arrivals: 1.5, crowd: {}, tempo: 'short', spread: 80, weak: 0.15, busy: 0.35 };

/** One-sided QSOs (we hear only one of the two) among those placed. */
export const ONE_SIDED_RATE = 0.35;

export interface RunConfig {
  random: Random;
  me: AgentMe;
  params: RunParams;
  personas?: PersonaSource;
}

export interface RunTxResult { intent: OperatorIntent; issues: RunIssue[] }

/** Where residents go when the run starts. Omitted fields are drawn from `busy`. */
export interface Placement {
  /** A QSO right on our frequency. */
  onFrequency?: boolean;
  /** Further QSOs elsewhere within a few kHz. */
  nearby?: number;
  oneSided?: boolean;
}

export interface RunResult {
  contacts: JudgedContact[];
  log: JudgedLogEntry[];
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
    /**
     * Frequencies checked as they should be: QRL?, listened QRL_LISTEN s or more, nobody
     * there, then CQ (never in use while we called there).
     */
    frequencyChecks: number;
    /** Frequencies a QRL? found in use (answered, or heard busy) that we left without a CQ. */
    busyAvoided: number;
  };
}

export class RunSession extends RunCore<RunParams> {
  readonly occupants: OccupantPair[] = [];
  private readonly keeper = new FrequencyKeeper({ ether: this.ether, callers: () => this.agents, residents: () => this.residents });
  private readonly arrivalModel: CqArrivals;

  constructor(config: RunConfig, radio: RadioPort) {
    super(config, radio);
    this.arrivalModel = new CqArrivals(config.random, () => this.params.arrivals);
  }

  get frequencies(): readonly FrequencyUse[] { return this.keeper.frequencies; }

  /** Is `rf` in use by someone other than us and our callers, as heard on the air by `at`? */
  frequencyBusy(rf: number, at: number, held = false) {
    return this.keeper.busy(rf, at, held);
  }

  /**
   * When the last caller we can hear on `rf` stopped (or stops) keying, as of `now` — CQ
   * repeat listens from here, so it doesn't step on someone calling. Other stations'
   * QRM doesn't hold it.
   */
  callersQuietFrom(rf: number, now: number) {
    return this.callersQuietNear(rf, BUSY_HZ, now);
  }

  /**
   * Where the check of `rf` stands at `now`, read from the air: after a QRL? we listen
   * QRL_LISTEN seconds, and anyone heard near the frequency meanwhile makes it busy.
   * A UI may hold a CQ on this; it never decides it from its own queue.
   */
  frequencyCheck(rf: number, now: number): FrequencyCheck {
    return this.keeper.check(rf, now);
  }

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
      const active = [...this.agents, ...this.residents].map((agent) => agent.station.call);
      const request = { random, speed: params.speed, weak: params.weak * 0.5, spread: 0, active };
      const pair = createOccupantPair([this.personas.next(request), this.personas.next(request)], random, {
        rf: spot, now, oneSided: placement.oneSided ?? random() < ONE_SIDED_RATE,
      });
      this.occupants.push(pair);
      this.residents.push(...pair.agents);
    }
    this.publishStations();
    return this.occupants;
  }

  /**
   * We key `text` on `rf` from `start` to `end`. Report it as keying starts (the length is
   * known up front): callers then hear the carrier and hold off. Reporting it after it
   * ended still works, but callers will have called over us.
   */
  transmit(text: string, { start, end, rf }: { start: number; end: number; rf: number }): RunTxResult {
    const { intent, partner } = this.beginTransmit(text, start);
    const issues: RunIssue[] = [];
    if (intent.cq && !intent.mentionsMe) issues.push('cq-without-call');
    let busy = false;
    if (intent.cq) {
      const cq = this.keeper.onCq(rf, start);
      busy = cq.busy;
      if (cq.issue) issues.push(cq.issue);
    }
    if (intent.qrl) this.keeper.onQrl(rf, start, end);
    if (this.sentToNobody(intent, partner)) issues.push('no-call');
    this.spawn(this.arrivalModel.arrivals(intent, start, busy), rf, end);
    this.emitOurs(text, intent, { start, end, rf });
    return { intent, issues };
  }

  /** QRT: judge every contact and log line. */
  finish(now: number): RunResult {
    const { contacts, log, unlogged, missed, stats } = this.closeBooks(now);
    const keeper = this.keeper.stats(now);
    return {
      contacts,
      log,
      unlogged,
      missed,
      frequencies: this.keeper.frequencies.map((use) => ({ ...use })),
      tempo: this.config.params.tempo,
      stats: {
        seconds: stats.seconds,
        contacts: stats.contacts,
        rate: stats.rate,
        firstCallAccuracy: stats.firstCallAccuracy,
        partials: stats.partials,
        corrections: stats.corrections,
        busts: stats.busts,
        nil: stats.nil,
        unlogged: stats.unlogged,
        dupes: stats.dupes,
        busyCqs: keeper.busyCqs,
        qrlNoListen: keeper.qrlNoListen,
        callers: stats.callers,
        doublings: stats.doublings,
        frequencyChecks: keeper.frequencyChecks,
        busyAvoided: keeper.busyAvoided,
      },
    };
  }

  protected afterAgents(now: number) {
    this.keeper.judge(now);
  }

  protected modeNote(note: AgentNote) {
    this.keeper.onNote(note);
  }
}
