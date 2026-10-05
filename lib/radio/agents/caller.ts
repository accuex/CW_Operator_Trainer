import { makeStation, type Station } from '../band';
import type { AirEvent } from '../air/ether';
import { isNearCall, matchesPartial, callDistance, type AskField, type OperatorIntent } from '../air/intent';
import type { StationPersona } from '../air/persona';
import { uniform, type Random } from '../random';
import { askText, callText, confirmText, correctionText, exchangeText, fieldsText, finalText, nudgeText, partialReply } from './templates';
import type { Agent, AgentContext, GoneReason } from './types';

/**
 * A station answering our CQ.
 *
 *   arriving ─(CQ/QRZ)→ waiting ─(our call / partial match)→ selected ─(our exchange)→ exchanged ─(TU/73)→ done
 *   waiting ─(someone else picked)→ holding ─(QRZ/TU/CQ)→ waiting
 *   waiting ─(a call 1–2 letters off)→ corrects, at most MAX_CORRECTIONS times, then plays along or leaves
 *   waiting/holding ─(patience calls unanswered / waitLimit unpicked)→ gone
 *   any ─(LEAVE_AFTER of silence)→ gone
 *
 * A doubling — we started keying while it was still sending, so each side lost the
 * other's head — is nobody's "no": the call it lost counts only half against patience,
 * a seasoned caller listens a beat longer before calling again, and a station already
 * in QSO with us asks again soon instead of waiting out the silence.
 */

export type CallerState = 'arriving' | 'waiting' | 'holding' | 'selected' | 'exchanged' | 'done' | 'gone';

export const MAX_CORRECTIONS = 2;
export const NUDGE_AFTER = 15;
export const LEAVE_AFTER = 30;
/** Spawned but never heard a CQ to answer. */
export const ARRIVE_TIMEOUT = 10;
export const QRS_STEP = 4;
/** A call lost in a doubling counts this much against patience (it wasn't a "no", but it wears). */
export const DOUBLED_WEIGHT = 0.5;
/** A station in QSO with us asks again ("?") at most this many times after doublings. */
/** How fast waiting wears on a caller while it hears the run going (us keying, or holding), against otherwise. */
export const HEARD_WAIT = 0.5;
export const MAX_NUDGES = 2;
/** Our message starting within this long before a caller stops keying is lost on it (the ether's head rule). */
const DOUBLE_HEAD = 0.5;

const FIELD_ORDER: AskField[] = ['RST', 'NAME', 'QTH'];

export class CallerAgent implements Agent {
  readonly id: number;
  readonly key: number;
  readonly rxWidth: number;
  state: CallerState = 'arriving';
  callsMade = 0;
  /** Calls that went unanswered (doubled ones count DOUBLED_WEIGHT) — what patience counts. */
  attempts = 0;
  /** Doublings with us while calling or in QSO. */
  doublings = 0;
  corrections = 0;
  /** Played along with a wrong call. */
  busted = false;
  /** Calls we sent that were meant for this station, in order (first = our first copy). */
  readonly addressedAs: string[] = [];
  goneReason: GoneReason | null = null;
  arrivedAt: number;
  private got: Record<AskField, boolean> = { RST: false, NAME: false, QTH: false };
  private heardName = false;
  private lastTx: string | null = null;
  private retryAt: number | null = null;
  private lastHeard: number;
  private nudged = false;
  private nudges = 0;
  private firstCallAt: number | null = null;
  /** Seconds of waiting to be picked, as the caller feels them (see HEARD_WAIT). */
  private waited = 0;
  private lastTick: number | null = null;
  /** The last call was lost in a doubling: the next one is a repeat, not another try. */
  private doubled = false;
  /** Start of the transmission of ours we last checked for a doubling. */
  private checkedTx = Number.NEGATIVE_INFINITY;
  /** In QSO and our message was lost: ask again from here. */
  private askAt: number | null = null;
  /** Extra listening before the next call after a doubling. */
  private listenOut = 0;

  constructor(readonly persona: StationPersona, readonly station: Station, private listenAt: number, now: number) {
    this.id = station.id;
    this.key = station.id;
    this.rxWidth = persona.rxWidth;
    this.arrivedAt = now;
    this.lastHeard = now;
  }

  get gone() { return this.state === 'done' || this.state === 'gone'; }
  get call() { return this.persona.call; }
  listenRf() { return this.listenAt; }

  hear(event: AirEvent, ctx: AgentContext) {
    if (this.gone || event.from !== 'me' || !event.intent) return;
    const intent = event.intent;
    this.lastHeard = Math.max(this.lastHeard, event.end);
    if (this.retryAt !== null) this.retryAt = Math.max(this.retryAt, event.end + uniform(ctx.random, this.persona.retry));
    if (this.state === 'selected' || this.state === 'exchanged') this.hearAsPartner(intent, ctx);
    else this.hearWhileCalling(intent, ctx);
  }

  tick(now: number, ctx: AgentContext) {
    if (this.gone) return;
    const dt = this.lastTick === null ? 0 : Math.min(1, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    // Hearing us at work (or someone else being worked) makes the wait easier to bear than
    // calling into silence or against other callers.
    if (this.firstCallAt !== null) this.waited += dt * (this.state === 'holding' || ctx.hearsKeying(this, 'me') ? HEARD_WAIT : 1);
    const ours = ctx.keyingSince(this, 'me');
    if (ours !== null && ours !== this.checkedTx) {
      this.checkedTx = ours;
      if (this.station.busyUntil > ours + DOUBLE_HEAD) this.onDoubled(now, ctx);
    }
    if (ctx.hearsKeying(this, 'me')) {
      // We are on the air: nobody calls over us, and the frequency is plainly alive.
      this.lastHeard = Math.max(this.lastHeard, now);
      if (this.state === 'waiting') this.retryAt = null;
      return;
    }
    // Someone answering us (or calling): the frequency is alive, worth waiting on.
    // Patience still bounds callers who only hear each other.
    if (ctx.hearsKeying(this)) this.lastHeard = Math.max(this.lastHeard, now);
    const sending = this.station.queue.length > 0 || this.station.busyUntil > now;
    // Silence counts from whichever came last: hearing us, or finishing our own message.
    const quiet = sending ? 0 : now - Math.max(this.lastHeard, this.station.busyUntil);
    switch (this.state) {
      case 'arriving':
        if (now - this.arrivedAt > ARRIVE_TIMEOUT) this.leave('never-called', ctx);
        return;
      case 'waiting':
        if (quiet > LEAVE_AFTER) return this.leave('timeout', ctx);
        if (sending) return;
        // A seasoned caller doesn't time a call over someone else on the air — it may be a
        // QSO it missed the start of (a doubling). A novice calls regardless.
        if (this.persona.style !== 'novice' && ctx.hearsKeying(this)) {
          this.retryAt = null;
          return;
        }
        if (this.retryAt === null) {
          this.retryAt = Math.max(now, this.station.busyUntil) + uniform(ctx.random, this.persona.retry) + this.listenOut;
          this.listenOut = 0;
        }
        if (now < this.retryAt) return;
        this.callAgain(ctx, 0.1);
        return;
      case 'holding':
        if (quiet > LEAVE_AFTER) this.leave('timeout', ctx);
        // Someone else is being worked; it gives up on the wait, though not mid-call or just after one.
        else if (!sending && now - this.station.busyUntil > this.persona.retry[1] && this.waitedOut()) this.leave('waited', ctx);
        return;
      case 'selected':
      case 'exchanged': {
        if (sending) return;
        if (quiet > LEAVE_AFTER) this.leave('timeout', ctx);
        else if (this.askAt !== null && now >= this.askAt) {
          // Our message went under its own: ask for it rather than sit in the silence.
          this.askAt = null;
          this.nudged = true;
          this.say(ctx, nudgeText(this.persona, ctx.me.call), 0.1);
        } else if (quiet > NUDGE_AFTER && !this.nudged) {
          this.nudged = true;
          this.say(ctx, nudgeText(this.persona, ctx.me.call), 0.1);
        }
      }
    }
  }

  rebase(shift: number) {
    if (this.retryAt !== null) this.retryAt += shift;
    if (this.firstCallAt !== null) this.firstCallAt += shift;
    if (this.lastTick !== null) this.lastTick += shift;
    if (this.askAt !== null) this.askAt += shift;
    this.checkedTx += shift;
    this.lastHeard += shift;
    this.arrivedAt += shift;
  }

  /** Waiting to be picked longer than it is willing to. */
  private waitedOut() {
    return this.waited > this.persona.waitLimit;
  }

  private onDoubled(now: number, ctx: AgentContext) {
    this.doublings += 1;
    if (this.state === 'waiting' || this.state === 'holding') {
      this.doubled = true;
      // A seasoned caller listens a beat longer before calling again; a novice comes straight back.
      this.listenOut = this.persona.style === 'novice' ? 0 : uniform(ctx.random, [1, 2.5]);
      return;
    }
    if ((this.state === 'selected' || this.state === 'exchanged') && this.nudges < MAX_NUDGES) {
      this.nudges += 1;
      this.nudged = false;
      // Asks once our carrier is gone; a slower hand takes longer about it.
      this.askAt = now + uniform(ctx.random, this.persona.retry) + (this.persona.style === 'novice' ? 2 : 0);
    }
  }

  private hearWhileCalling(intent: OperatorIntent, ctx: AgentContext) {
    const { call } = this;
    if (intent.calls.includes(call)) {
      this.addressedAs.push(call);
      return this.select(ctx, 'call', intent);
    }
    const near = intent.calls.find((sent) => isNearCall(sent, call) && this.isClosestTo(sent, ctx));
    if (near) {
      this.addressedAs.push(near);
      if (this.corrections < MAX_CORRECTIONS) {
        this.corrections += 1;
        ctx.notify({ type: 'corrected', agent: this, heard: near });
        this.say(ctx, correctionText(this.persona));
        this.state = 'waiting';
        this.retryAt = null;
        return;
      }
      if (ctx.random() < 0.5) {
        this.busted = true;
        return this.select(ctx, 'bust', intent);
      }
      return this.leave('ignored-correction', ctx);
    }
    if (intent.calls.length) {
      // Someone else got picked: stand by. A call that fits nobody: keep waiting.
      if (this.othersAddressed(intent, ctx)) this.state = this.state === 'arriving' ? 'arriving' : 'holding';
      return;
    }
    if (intent.partial) {
      if (this.state === 'arriving') return;
      if (matchesPartial(call, intent.partial)) {
        this.say(ctx, partialReply(this.persona));
        this.state = 'waiting';
        this.retryAt = null;
      } else {
        this.state = 'holding';
      }
      return;
    }
    if (intent.report || intent.fields.name || intent.fields.qth) {
      // An exchange with no call: whoever is the only one calling takes it.
      const calling = ctx.peers().filter((peer) => peer.state === 'waiting');
      if (this.state === 'waiting' && calling.length === 1 && calling[0] === this) this.select(ctx, 'single', intent);
      return;
    }
    const cq = intent.cq && intent.mentionsMe;
    if (this.state === 'arriving') {
      if (cq || intent.qrz) this.callAgain(ctx);
      return;
    }
    const cue = this.state === 'holding' ? cq || intent.qrz || intent.closing : cq || intent.qrz || intent.agn || intent.qrs;
    if (!cue) return;
    if (intent.qrs) this.slowDown();
    if (ctx.random() >= this.persona.recall) {
      // Sits this one out and listens for the next (or calls late if nothing comes).
      this.state = 'waiting';
      this.retryAt = ctx.now() + uniform(ctx.random, this.persona.retry) * 3;
      return;
    }
    this.callAgain(ctx);
  }

  private hearAsPartner(intent: OperatorIntent, ctx: AgentContext) {
    const { call } = this;
    const forUs = intent.calls.includes(call) || intent.calls.some((sent) => isNearCall(sent, call));
    if (intent.calls.length && !forUs) return this.leave('dropped', ctx);
    if (forUs) this.addressedAs.push(intent.calls.find((sent) => sent === call || isNearCall(sent, call))!);
    this.nudged = false;

    if (this.state === 'selected') {
      if ((intent.agn || intent.qrs) && this.lastTx) {
        if (intent.qrs) this.slowDown();
        return this.say(ctx, this.lastTx);
      }
      return this.takeExchange(intent, ctx);
    }

    // exchanged: our exchange is out, waiting for TU / 73.
    if (intent.ask.length) return this.say(ctx, fieldsText(this.persona, FIELD_ORDER.filter((field) => intent.ask.includes(field))));
    if (intent.agn || intent.qrs) {
      if (intent.qrs) this.slowDown();
      return this.say(ctx, exchangeText(this.persona, ctx.me, this.heardName));
    }
    if (intent.closing) {
      this.say(ctx, finalText(this.persona, ctx.me));
      this.state = 'done';
      ctx.notify({ type: 'closed', agent: this });
      return;
    }
    if (intent.qrz || intent.cq) {
      // Moved on without a TU: the QSO stands, unacknowledged.
      this.state = 'done';
      return;
    }
    if (forUs && intent.report) this.say(ctx, exchangeText(this.persona, ctx.me, this.heardName));
  }

  private select(ctx: AgentContext, via: 'call' | 'single' | 'bust', intent: OperatorIntent) {
    this.state = 'selected';
    this.nudged = false;
    ctx.notify({ type: 'selected', agent: this, via });
    this.takeExchange(intent, ctx);
  }

  /** Collect RST / our name / our QTH; answer with our exchange once all three are in. */
  private takeExchange(intent: OperatorIntent, ctx: AgentContext) {
    const { me } = ctx;
    const named = intent.fields.name !== undefined || (me.name !== '' && intent.tokens.includes(me.name));
    const placed = intent.fields.qth !== undefined || (me.qth !== '' && intent.tokens.includes(me.qth));
    const fresh = Boolean(intent.report) || named || placed;
    this.got.RST ||= Boolean(intent.report);
    this.got.NAME ||= named || me.name === '';
    this.got.QTH ||= placed || me.qth === '';
    this.heardName ||= named;
    const missing = FIELD_ORDER.filter((field) => !this.got[field]);
    if (!missing.length) {
      this.say(ctx, exchangeText(this.persona, me, this.heardName));
      this.state = 'exchanged';
      ctx.notify({ type: 'exchanged', agent: this });
    } else if (fresh || this.got.RST || this.got.NAME || this.got.QTH) {
      this.say(ctx, askText(this.persona, missing));
      ctx.notify({ type: 'asked', agent: this, fields: missing });
    } else {
      this.say(ctx, confirmText(this.persona));
    }
  }

  /** Call (again). The call before went unanswered (or half, if a doubling took it); patience counts those. */
  private callAgain(ctx: AgentContext, delay?: number) {
    if (this.callsMade > 0) this.attempts += this.doubled ? DOUBLED_WEIGHT : 1;
    this.doubled = false;
    if (this.attempts >= this.persona.patience) return this.leave('patience', ctx);
    // Waited long enough: it gives up when it would call again, never straight after a call it made.
    if (this.waitedOut()) return this.leave('waited', ctx);
    this.firstCallAt ??= ctx.now();
    this.say(ctx, callText(this.persona, ctx.me.call), delay);
    this.callsMade += 1;
    this.state = 'waiting';
    this.retryAt = null;
    ctx.notify({ type: 'called', agent: this });
  }

  private say(ctx: AgentContext, text: string, delay = uniform(ctx.random, this.persona.reaction)) {
    this.lastTx = text;
    ctx.send(this, text, delay);
  }

  private slowDown() {
    this.station.wpm = Math.max(this.persona.qrsFloor, this.station.wpm - QRS_STEP);
  }

  private leave(reason: GoneReason, ctx: AgentContext) {
    this.state = 'gone';
    this.goneReason = reason;
    ctx.notify({ type: 'gone', agent: this, reason });
  }

  /** Of everyone on frequency, this call is the one `sent` most likely meant (nobody has it exactly). */
  private isClosestTo(sent: string, ctx: AgentContext) {
    const rivals = ctx.peers().filter((peer): peer is CallerAgent => peer instanceof CallerAgent && !peer.gone && peer !== this);
    if (rivals.some((peer) => peer.call === sent)) return false;
    const mine = callDistance(sent, this.call);
    return rivals.every((peer) => {
      if (!isNearCall(sent, peer.call)) return true;
      const theirs = callDistance(sent, peer.call);
      return mine < theirs || (mine === theirs && this.id < peer.id);
    });
  }

  private othersAddressed(intent: OperatorIntent, ctx: AgentContext) {
    return ctx.peers().some((peer) => peer !== this && peer instanceof CallerAgent && !peer.gone
      && intent.calls.some((sent) => sent === peer.call || isNearCall(sent, peer.call)));
  }
}

/** A caller tuned to our CQ at `listenRf`, keying `offsetHz` off it. */
export function createCaller(persona: StationPersona, { random, listenRf, now }: { random: Random; listenRf: number; now: number }) {
  const station = makeStation(random, {
    role: 'caller',
    call: persona.call,
    rf: Math.round(listenRf + persona.offsetHz),
    wpm: persona.wpm,
    strength: persona.strength,
    jitter: persona.jitter,
    drift: 0,
    chirp: 0,
    gap: [1, 2],
    loop: null,
    nextAt: Number.POSITIVE_INFINITY,
  });
  return new CallerAgent(persona, station, listenRf, now);
}
