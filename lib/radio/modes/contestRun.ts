import { isCallsign, normalizeCall, parseIntent, type OperatorIntent } from '../air/intent';
import type { StationPersona } from '../air/persona';
import type { CallerAgent, CallerBehaviour } from '../agents/caller';
import { CONTEST_EXCHANGE } from '../agents/exchangeSpec';
import { CONTEST_PROCEDURE } from '../agents/manners';
import type { AgentMe, AgentNote } from '../agents/types';
import { normalizeRst } from '../exchange';
import type { Random } from '../random';
import { ContestField } from '../contest/field';
import { contestIntent } from '../contest/intent';
import type { ContestParams } from '../contest/levels';
import { bestRate, blockFor, crossCheck, liveScore, rateBlocks, type ContestLogLine, type ContestScore, type CrossCheck, type RateBlock, type TheirLine } from '../contest/log';
import { SPRINT_RULES, type ContestRules } from '../contest/rules';
import { CqArrivals } from './arrivals';
import { pileupManners, shapePileupPersona } from './pileupLevels';
import { RunCore, type LogFields, type RadioPort, type RunBooks } from './runCore';

export { bestRate, currentRate } from '../contest/log';

/**
 * A contest run: we hold a frequency and call CQ TEST; stations of the field find us
 * at the contest's pace (density a minute), call, and we work them with the report and
 * our serial — "JA1ABC 5NN 023" / "R 5NN 104" / "TU JS2WDR".
 *
 * The callers are the pileup's (manners, timing, stack, look-alikes) with a contest
 * exchange and procedure. Each is a station of the ContestField: it gives us its own
 * serial and keeps its own log of us, which our log is checked against at the end.
 *
 * Run only for v1; S&P will be another session on the same field, rules and log check.
 */

export interface ContestConfig {
  random: Random;
  me: AgentMe;
  params: ContestParams;
  rules?: ContestRules;
}

export interface ContestTxResult { intent: OperatorIntent }

/** What our log line holds: the call, the report and the serial as typed. */
export interface ContestEntry { call: string; rst: string; nr: string }

export interface ContestResult extends RunBooks {
  rules: ContestRules;
  /** The run's clock at the start and at QRT (the books' times are on it). */
  clock: { start: number; end: number };
  /** Our log as written, with the serial we sent each. */
  qsos: ContestLogLine[];
  check: CrossCheck;
  /** Contacts by time block, checked-good ones and all logged. */
  blocks: { logged: RateBlock[]; good: RateBlock[]; size: number };
  stats: RunBooks['stats'] & {
    /** Callers who were stations we had worked already. */
    dupeCallers: number;
    /** Callers we told QSO B4. */
    b4: number;
    /** Highest ten-minute rate (logged), contacts an hour. */
    bestRate: number;
  };
  /**
   * Who each caller was, by station id: its call, its serial as it keyed it ("1T5") and
   * its speed. Known only after QRT — what the review and the analysis place received
   * messages and score serials with. Absent on runs stored before Stage 4.
   */
  roster?: Record<number, { call: string; nr: string; wpm: number }>;
}

export class ContestRunSession extends RunCore<ContestParams> {
  readonly field: ContestField;
  readonly rules: ContestRules;
  private readonly arrivalModel: CqArrivals;
  private qsoList: ContestLogLine[] = [];
  /** Callers that came back after working us. */
  private returning = 0;

  constructor(config: ContestConfig, radio: RadioPort) {
    const field = new ContestField({ similar: config.params.similar, serial: config.params.serial, dupes: config.params.dupes }, config.me.call);
    super({ random: config.random, me: config.me, params: config.params, personas: field }, radio);
    this.field = field;
    this.rules = config.rules ?? SPRINT_RULES;
    this.arrivalModel = new CqArrivals(config.random, () => this.params.density);
  }

  /** Our serial for the next contact: one past the lines in our log. */
  get nextNr() { return this.qsoList.length + 1; }
  get qsos(): readonly ContestLogLine[] { return this.qsoList; }

  /** Callers on frequency not being worked: arriving, calling or standing by. */
  standing() {
    return this.agents.filter((agent) => agent.state === 'arriving' || agent.state === 'waiting' || agent.state === 'holding');
  }

  /** We key `text` on `rf` from `start` to `end`. */
  transmit(text: string, { start, end, rf }: { start: number; end: number; rf: number }): ContestTxResult {
    const { intent } = this.beginTransmit(text, start);
    this.spawn(this.arrivalModel.arrivals(intent, start, false), rf, end);
    this.emitOurs(text, intent, { start, end, rf });
    return { intent };
  }

  /** Log a contact: it takes the next serial (the one we should have sent it). */
  logQso(entry: ContestEntry, at: number): ContestLogLine {
    const fields = this.fieldsOf(entry);
    const book = this.logEntry(fields, at);
    const line: ContestLogLine = { id: book.id, at, call: book.fields.call, rst: book.fields.rst, nr: book.fields.nr ?? '', sentNr: this.nextNr };
    this.qsoList.push(line);
    return line;
  }

  /** Fix a line; its serial sent stays as it was. */
  editQso(id: string, entry: ContestEntry) {
    const book = this.editLog(id, this.fieldsOf(entry));
    const line = this.qsoList.find((item) => item.id === id);
    if (!book || !line) return null;
    Object.assign(line, { call: book.fields.call, rst: book.fields.rst, nr: book.fields.nr ?? '' });
    return line;
  }

  /** `call` is in our log already (what a logger shows as DUPE — our own log only). */
  isDupe(call: string) {
    const wanted = normalizeCall(call);
    return isCallsign(wanted) && this.qsoList.some((line) => line.call === wanted);
  }

  /** `call` would be a new multiplier (from our own log only). */
  isNewMult(call: string) {
    const wanted = normalizeCall(call);
    if (!isCallsign(wanted)) return false;
    const mult = this.rules.multOf(wanted);
    return !this.qsoList.some((line) => this.rules.multOf(line.call) === mult);
  }

  /** Our log's score as it stands (claimed, unchecked). */
  get score(): ContestScore { return liveScore(this.qsoList, this.rules); }

  finish(now: number): ContestResult {
    const books = this.closeBooks(now);
    const check = crossCheck(this.qsoList, this.theirLines(), this.rules);
    const start = now - books.stats.seconds;
    const size = blockFor(books.stats.seconds);
    const good = new Set(check.lines.filter((line) => line.verdict === 'ok').map((line) => line.id));
    const times = this.qsoList.map((line) => line.at);
    return {
      ...books,
      rules: this.rules,
      clock: { start, end: now },
      qsos: this.qsoList.map((line) => ({ ...line })),
      check,
      blocks: {
        size,
        logged: rateBlocks(times, start, now, size),
        good: rateBlocks(this.qsoList.filter((line) => good.has(line.id)).map((line) => line.at), start, now, size),
      },
      stats: {
        ...books.stats,
        dupeCallers: this.returning,
        b4: this.agents.filter((agent) => agent.goneReason === 'b4').length,
        bestRate: bestRate(times, start, now),
      },
      roster: Object.fromEntries(this.agents.map((agent) => [agent.id, { call: agent.call, nr: agent.contest?.nr ?? '', wpm: agent.station.wpm }])),
    };
  }

  /** Every field station's log of us. */
  theirLines(): TheirLine[] {
    return this.field.all.flatMap((station) => station.log.map((line) => ({ station: station.persona.call, at: line.at, nr: line.nr, sent: line.sent })));
  }

  protected readIntent(text: string) {
    return contestIntent(parseIntent(text, this.config.me.call));
  }

  protected shapeCaller(persona: StationPersona): { persona: StationPersona; behaviour: CallerBehaviour } {
    const { random, params } = this.config;
    const shaped = shapePileupPersona(persona, params, random);
    if (this.field.station(persona.call)?.log.length) this.returning += 1;
    const serial = this.field.serialFor(persona.call, this.radio.now());
    return {
      persona: shaped,
      behaviour: {
        manners: pileupManners(shaped.style, params, random),
        exchange: CONTEST_EXCHANGE,
        procedure: CONTEST_PROCEDURE,
        calling: 'pileup',
        contest: { serial, nr: this.field.serialText(persona.call, serial) },
      },
    };
  }

  protected truthOf(agent: CallerAgent): LogFields {
    return { ...super.truthOf(agent), nr: String(agent.contest?.serial ?? '') };
  }

  /** A station logs us once it has our exchange (and sent its own); it takes it back if it stood back or heard QSO B4. */
  protected modeNote(note: AgentNote) {
    const agent = this.agents.find((item) => item === note.agent);
    if (!agent?.contest) return;
    if (note.type === 'exchanged') this.field.record(agent.call, { agentId: agent.id, at: this.radio.now(), nr: agent.heardNr, sent: agent.contest.serial });
    else if (note.type === 'released' || (note.type === 'gone' && note.reason === 'b4')) this.field.unrecord(agent.call, agent.id);
  }

  protected afterAgents() {
    // Our serial copied again (we sent it once more): the station's log follows.
    for (const agent of this.agents) {
      if (agent.contest && agent.state === 'exchanged') this.field.update(agent.call, agent.id, agent.heardNr);
    }
  }

  /** As a pileup: a log line goes to the contact with exactly that call first. */
  protected matchContact(call: string, except?: string) {
    if (isCallsign(call)) {
      const logged = new Set(this.logList.filter((entry) => entry.id !== except && entry.contactId).map((entry) => entry.contactId));
      const exact = [...this.contactList].reverse().find((contact) => contact.truth.call === call && contact.exchangedAt !== undefined && !logged.has(contact.id));
      if (exact) return exact.id;
    }
    return super.matchContact(call, except);
  }

  private fieldsOf(entry: ContestEntry): LogFields {
    return { call: entry.call, rst: normalizeRst(entry.rst || '599'), name: '', qth: '', nr: entry.nr };
  }
}
