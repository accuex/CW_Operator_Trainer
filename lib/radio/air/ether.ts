import type { OperatorIntent } from './intent';

/**
 * The shared air. Every transmission — ours and every station's — becomes an event
 * here and reaches whoever could hear it: within their receive passband and not
 * keying their own transmitter when it began. Stations hear each other the same
 * way, which is what free play builds on.
 *
 * Events are delivered once they end (a message is understood when it is over).
 */

/** 'me' is the operator; numbers are station ids. */
export type AirParty = 'me' | number;

export interface AirEvent {
  id: number;
  from: AirParty;
  text: string;
  /** Parsed operator intent (our own transmissions only). */
  intent: OperatorIntent | null;
  /** Transmit frequency, Hz. */
  rf: number;
  start: number;
  end: number;
  epoch: number;
}

export interface AirListener {
  readonly key: AirParty;
  /** Where the receiver is tuned. */
  listenRf(): number;
  /** Receive passband, Hz. */
  readonly rxWidth: number;
}

/** A transmission whose first half second overlaps your own keying is lost on you. */
export const HEAD_SECONDS = 0.5;
/** How long the air remembers transmissions (for "is this frequency in use?"). */
export const AIR_MEMORY_SECONDS = 60;

export class Ether {
  epoch = 0;
  private log: AirEvent[] = [];
  private pending: AirEvent[] = [];
  private seq = 0;

  emit(event: Omit<AirEvent, 'id' | 'epoch'> & { epoch?: number }): AirEvent {
    const full: AirEvent = { ...event, id: (this.seq += 1), epoch: event.epoch ?? this.epoch };
    if (full.epoch !== this.epoch) return full;
    this.log.push(full);
    this.pending.push(full);
    return full;
  }

  /** Events that have ended by `now`, oldest end first. Each is returned once. */
  deliver(now: number): AirEvent[] {
    const due = this.pending.filter((event) => event.end <= now).sort((a, b) => a.end - b.end || a.id - b.id);
    if (due.length) this.pending = this.pending.filter((event) => event.end > now);
    this.log = this.log.filter((event) => event.end > now - AIR_MEMORY_SECONDS);
    return due;
  }

  transmittingAt(party: AirParty, t: number) {
    return this.log.some((event) => event.from === party && event.start <= t && t < event.end);
  }

  hears(listener: AirListener, event: AirEvent) {
    if (listener.key === event.from || event.epoch !== this.epoch) return false;
    if (Math.abs(event.rf - listener.listenRf()) > listener.rxWidth / 2) return false;
    return !this.transmittingAt(listener.key, event.start + HEAD_SECONDS);
  }

  /** `party` (anyone but the listener if omitted) is keying at `t` where `listener` would hear it — a carrier is audible before the message is understood. */
  hearsKeying(listener: AirListener, party: AirParty | undefined, t: number) {
    return this.log.some((event) => (party === undefined || event.from === party) && event.from !== listener.key && event.epoch === this.epoch
      && event.start <= t && t < event.end && Math.abs(event.rf - listener.listenRf()) <= listener.rxWidth / 2);
  }

  /**
   * Someone keyed within ±`within` Hz of `rf` between `since` and `until` — the frequency is in use.
   * `except` names who doesn't count (a party, or a test: our own callers aren't "someone else").
   * `until` keeps out what is scheduled but not yet on the air.
   */
  activeNear(rf: number, within: number, since: number, except: AirParty | ((party: AirParty) => boolean) = 'me', until = Number.POSITIVE_INFINITY) {
    const ignored = typeof except === 'function' ? except : (party: AirParty) => party === except;
    return this.log.some((event) => !ignored(event.from) && event.end >= since && event.start <= until && Math.abs(event.rf - rf) <= within);
  }

  /** When the transmission of `party` that `listener` hears keying at `t` began (null: none). */
  keyingSince(listener: AirListener, party: AirParty, t: number): number | null {
    const event = this.log.find((item) => item.from === party && item.from !== listener.key && item.epoch === this.epoch
      && item.start <= t && t < item.end && Math.abs(item.rf - listener.listenRf()) <= listener.rxWidth / 2);
    return event ? event.start : null;
  }

  /** When the latest transmission from someone `who` accepts, near `rf` and begun by `until`, ends (−∞ if none). */
  lastNear(rf: number, within: number, who: (party: AirParty) => boolean, until: number) {
    return this.log.reduce((latest, event) => (who(event.from) && event.start <= until && Math.abs(event.rf - rf) <= within
      ? Math.max(latest, event.end) : latest), Number.NEGATIVE_INFINITY);
  }

  /** When `party`'s latest transmission on the air ends (−∞ if none this epoch, or long ago). The air, not a UI flag, says who is keying. */
  keyedUntil(party: AirParty) {
    return this.log.reduce((latest, event) => (event.from === party ? Math.max(latest, event.end) : latest), Number.NEGATIVE_INFINITY);
  }

  /** New clock (rig power cycled): nothing from before compares any more. */
  setEpoch(epoch: number) {
    this.epoch = epoch;
    this.log = [];
    this.pending = [];
  }
}
