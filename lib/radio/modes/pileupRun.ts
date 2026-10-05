import { isCallsign, parseIntent, type OperatorIntent } from '../air/intent';
import { RandomPersonaSource, type PersonaSource, type StationPersona } from '../air/persona';
import type { CallerBehaviour } from '../agents/caller';
import { RST_EXCHANGE, RST_NAME_EXCHANGE } from '../agents/exchangeSpec';
import { PILEUP_PROCEDURE } from '../agents/manners';
import type { AgentMe } from '../agents/types';
import type { Random } from '../random';
import { PileupArrivals } from './pileupArrivals';
import { pileupManners, shapePileupPersona, type PileupParams } from './pileupLevels';
import { RunCore, type RadioPort, type RunBooks } from './runCore';

/**
 * A pileup: everyone is already calling. We hold the frequency from the start (no
 * QRL? — it is ours), pull one call at a time out of the pile with partials, QRZ? and
 * AGN?, work it with the report and TU, and the pile keeps coming (PileupArrivals).
 * The shared part (air, callers, books) is RunCore, as for a CQ run.
 *
 * A pileup reads some of our words its own way (pileupIntent): "JA3AB?" and
 * "3AB AGN?" are partials, our call alone or "TU JS2WDR" are QRZ?.
 */

export interface PileupConfig {
  random: Random;
  me: AgentMe;
  params: PileupParams;
  personas?: PersonaSource;
}

export interface PileupTxResult { intent: OperatorIntent }

export interface PileupResult extends RunBooks {
  stats: RunBooks['stats'] & {
    /** Rounds handed out (continuous: 1). */
    rounds: number;
    /** Calls answered by a look-alike they weren't meant for. */
    hijacks: number;
    /** …of which the look-alike stood back once we called the right station. */
    released: number;
  };
}

/**
 * How a pileup hears our transmission:
 *   "JA3AB?" (a call asked about) and "3AB AGN?" / "JA3ABC AGN?" are partials — whoever
 *   they fit answers, nobody is being worked yet;
 *   our call alone, or TU with our call ("TU JS2WDR"), is a QRZ?.
 */
export function pileupIntent(intent: OperatorIntent): OperatorIntent {
  const partial = intent.partial ?? intent.queried?.[0] ?? intent.agnFor ?? null;
  const calls = partial ? intent.calls.filter((call) => call !== partial) : intent.calls;
  const content = calls.length || partial || intent.report || intent.ask.length || intent.fields.name || intent.fields.qth || intent.agn || intent.qrs || intent.qrx;
  const qrz = intent.qrz || (intent.mentionsMe && !content && (intent.closing || !intent.cq));
  if (partial === intent.partial && calls === intent.calls && qrz === intent.qrz) return intent;
  return { ...intent, partial, calls, qrz };
}

export class PileupSession extends RunCore<PileupParams> {
  private readonly arrivalModel: PileupArrivals;

  constructor(config: PileupConfig, radio: RadioPort) {
    super({ ...config, personas: config.personas ?? new RandomPersonaSource(config.params.similar) }, radio);
    this.arrivalModel = new PileupArrivals(config.random, () => ({
      pile: this.params.pile,
      rounds: this.params.rounds,
      refill: Math.max(2, Math.ceil(this.params.pile * 0.3)),
    }), () => this.standing().length);
  }

  /** Rounds handed out so far (continuous: 1). */
  get rounds() { return this.arrivalModel.rounds; }

  /** Callers on frequency not being worked: arriving, calling or standing by. */
  standing() {
    return this.agents.filter((agent) => agent.state === 'arriving' || agent.state === 'waiting' || agent.state === 'holding');
  }

  /** We key `text` on `rf` from `start` to `end` (reported as keying starts, like a CQ run). */
  transmit(text: string, { start, end, rf }: { start: number; end: number; rf: number }): PileupTxResult {
    const { intent } = this.beginTransmit(text, start);
    this.spawn(this.arrivalModel.arrivals(intent), rf, end);
    this.emitOurs(text, intent, { start, end, rf });
    return { intent };
  }

  finish(now: number): PileupResult {
    const books = this.closeBooks(now);
    const hijackers = this.agents.filter((agent) => agent.reactions.some((reaction) => reaction.kind === 'hijack'));
    return {
      ...books,
      stats: {
        ...books.stats,
        rounds: this.arrivalModel.rounds,
        hijacks: this.agents.reduce((sum, agent) => sum + agent.reactions.filter((reaction) => reaction.kind === 'hijack').length, 0),
        released: hijackers.filter((agent) => !agent.hijacked).length,
      },
    };
  }

  protected readIntent(text: string) {
    return pileupIntent(parseIntent(text, this.config.me.call));
  }

  protected shapeCaller(persona: StationPersona): { persona: StationPersona; behaviour: CallerBehaviour } {
    const { random, params } = this.config;
    const shaped = shapePileupPersona(persona, params, random);
    return {
      persona: shaped,
      behaviour: {
        manners: pileupManners(shaped.style, params, random),
        exchange: params.exchange === 'rst-name' ? RST_NAME_EXCHANGE : RST_EXCHANGE,
        procedure: PILEUP_PROCEDURE,
        calling: 'pileup',
      },
    };
  }

  /**
   * Two stations may answer one call at once (a look-alike hijacking it): a log line goes
   * to the contact with exactly that call first, then as a CQ run matches.
   */
  protected matchContact(call: string, except?: string) {
    if (isCallsign(call)) {
      const logged = new Set(this.logList.filter((entry) => entry.id !== except && entry.contactId).map((entry) => entry.contactId));
      const exact = [...this.contactList].reverse().find((contact) => contact.truth.call === call && contact.exchangedAt !== undefined && !logged.has(contact.id));
      if (exact) return exact.id;
    }
    return super.matchContact(call, except);
  }
}
