import { makeStation, type Station } from '../band';
import type { AirEvent } from '../air/ether';
import { isNearCall, matchesPartial, nearPartial, callDistance, type AskField, type OperatorIntent } from '../air/intent';
import type { StationPersona } from '../air/persona';
import { uniform, type Random } from '../random';
import { BASIC_EXCHANGE, needsFrom, type ExchangeSpec } from './exchangeSpec';
import { CQ_PROCEDURE, MAX_CORRECTIONS, mannersOf, type CallerManners, type CallerProcedure } from './manners';
import { askText, callText, confirmText, contestExchangeText, contestFieldsText, correctionText, dxExchangeText, exchangeText, fieldsText, finalText, nudgeText, partialReply, pileupCallText } from './templates';
import type { Agent, AgentContext, GoneReason } from './types';

/**
 * A station answering our CQ.
 *
 *   arriving ─(CQ/QRZ)→ waiting ─(our call / partial match)→ selected ─(our exchange)→ exchanged ─(TU/73)→ done
 *   waiting ─(someone else picked)→ holding ─(QRZ/TU/CQ)→ waiting
 *   waiting ─(a call 1–2 letters off)→ corrects, at most manners.maxCorrections times, then plays along or leaves
 *   waiting/holding ─(patience calls unanswered / waitLimit unpicked)→ gone
 *   any ─(LEAVE_AFTER of silence)→ gone
 *
 * A doubling — we started keying while it was still sending, so each side lost the
 * other's head — is nobody's "no": the call it lost counts only half against patience,
 * a seasoned caller listens a beat longer before calling again, and a station already
 * in QSO with us asks again soon instead of waiting out the silence.
 *
 * How it conducts itself (holding for traffic, listening out a doubling, correcting,
 * and in a pileup: eager answers, lid calls, tail-ending, missing us) comes from its
 * CallerManners; how it reads our procedure from the mode's CallerProcedure; what it
 * exchanges with us from its ExchangeSpec.
 */

export type CallerState = 'arriving' | 'waiting' | 'holding' | 'selected' | 'exchanged' | 'done' | 'gone';

export { MAX_CORRECTIONS };
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
/** A tail-ender comes in this soon after our TU. */
const TAIL_END_DELAY: readonly [number, number] = [0.05, 0.3];

/** Why a caller is standing by: someone else is being worked, a partial didn't fit it, or we said QRX. */
export type StandBy = 'other' | 'partial' | 'qrx';

/**
 * What a caller did that a disciplined one never would, or that a pileup cares about —
 * kept on the agent for checks and the simulator, never shown to the operator's side.
 *   match / near / mismatch: answered a partial that is in its call / one letter off / neither;
 *   over-qso: called while we worked someone else (or after our QRX);
 *   tail-end: called straight after our TU to someone else;
 *   missed: didn't copy a transmission of ours;
 *   hijack: answered a call meant for a closer look-alike.
 */
export type CallerReaction = 'match' | 'near' | 'mismatch' | 'over-qso' | 'tail-end' | 'missed' | 'hijack';
export interface CallerReactionNote { at: number; kind: CallerReaction; partial?: string; sent?: string }

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
  /** When each of those started on the air (what we could have heard of it before sending is what counts). */
  readonly addressedAt: number[] = [];
  goneReason: GoneReason | null = null;
  /** When it left the frequency or finished with us (null: still here). */
  goneAt: number | null = null;
  arrivedAt: number;
  private got: Record<AskField, boolean> = { RST: false, NAME: false, QTH: false, NR: false, CALL: false };
  /** A contest: the serial it gives us (fixed while it is on frequency) and how it keys it; null elsewhere. */
  readonly contest: CallerContest | null;
  /** A contest: our serial as it copied it (what goes in its log). */
  heardNr: number | null = null;
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
  /** Start of the message of ours being heard. */
  private hearingFrom = 0;
  /** Why it is standing by (state 'holding'). */
  standBy: StandBy = 'other';
  /** Took a call meant for someone else (a hijack) and hasn't been called by its own since. */
  hijacked = false;
  /** Pileup reactions, oldest first (see CallerReaction). */
  readonly reactions: CallerReactionNote[] = [];
  /** Our transmissions by start time: whether it failed to copy each (missesUs). */
  private missedTx = new Map<number, boolean>();

  readonly manners: CallerManners;
  readonly exchange: ExchangeSpec;
  readonly procedure: CallerProcedure;
  readonly calling: NonNullable<CallerBehaviour['calling']>;

  constructor(readonly persona: StationPersona, readonly station: Station, private listenAt: number, now: number, behaviour: CallerBehaviour = {}) {
    this.manners = behaviour.manners ?? mannersOf(persona.style);
    this.exchange = behaviour.exchange ?? BASIC_EXCHANGE;
    this.procedure = behaviour.procedure ?? CQ_PROCEDURE;
    this.calling = behaviour.calling ?? 'run';
    this.contest = behaviour.contest ?? null;
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
    // It never copied this one: as far as it knows, nothing was said.
    if (this.missed(event.start, ctx)) return;
    const intent = event.intent;
    if (intent.b4 && this.contest && this.toldB4(intent)) {
      // We had it in the log already: it leaves without a word.
      this.lastHeard = Math.max(this.lastHeard, event.end);
      return this.leave('b4', ctx);
    }
    this.lastHeard = Math.max(this.lastHeard, event.end);
    this.hearingFrom = event.start;
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
    const ours = ctx.keyingSince(this, 'me');
    // A station that fails to copy our transmission doesn't know we are on: it neither waits for us nor sees the doubling.
    const deaf = ours !== null && this.missed(ours, ctx);
    const hearsUs = !deaf && ctx.hearsKeying(this, 'me');
    if (this.firstCallAt !== null) this.waited += dt * (this.state === 'holding' || hearsUs ? HEARD_WAIT : 1);
    if (ours !== null && ours !== this.checkedTx) {
      this.checkedTx = ours;
      if (this.station.busyUntil > ours + DOUBLE_HEAD && !deaf) this.onDoubled(now, ctx);
    }
    if (hearsUs) {
      // We are on the air: nobody calls over us, and the frequency is plainly alive.
      this.lastHeard = Math.max(this.lastHeard, now);
      if (this.state === 'waiting') this.retryAt = null;
      return;
    }
    // Someone answering us (or calling): the frequency is alive, worth waiting on.
    // Patience still bounds callers who only hear each other.
    const hearsTraffic = deaf ? ctx.hearsKeying(this, undefined, 'me') : ctx.hearsKeying(this);
    if (hearsTraffic) this.lastHeard = Math.max(this.lastHeard, now);
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
        if (this.manners.holdsForTraffic && hearsTraffic) {
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
        else if (!sending && this.manners.callsOverQso > 0) this.callOverQso(now, ctx);
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
    if (this.goneAt !== null) this.goneAt += shift;
  }

  /** Whether it failed to copy our transmission that began at `start` (decided once per transmission). */
  private missed(start: number, ctx: AgentContext) {
    if (this.manners.missesUs <= 0) return false;
    let missed = this.missedTx.get(start);
    if (missed === undefined) {
      missed = ctx.random() < this.manners.missesUs;
      this.missedTx.set(start, missed);
      if (missed) this.react(ctx, 'missed');
      for (const key of this.missedTx.keys()) if (key < start - 120) this.missedTx.delete(key);
    }
    return missed;
  }

  private react(ctx: AgentContext, kind: CallerReaction, detail: { partial?: string; sent?: string } = {}) {
    this.reactions.push({ at: ctx.now(), kind, ...detail });
  }

  /** A lid standing by calls anyway, at its own retry pace, while someone else is worked. */
  private callOverQso(now: number, ctx: AgentContext) {
    if (this.retryAt === null) {
      this.retryAt = Math.max(now, this.station.busyUntil) + uniform(ctx.random, this.persona.retry);
      return;
    }
    if (now < this.retryAt) return;
    this.retryAt = null;
    if (ctx.random() >= this.manners.callsOverQso) return;
    this.react(ctx, 'over-qso');
    this.callAgain(ctx, 0.1);
  }

  private addressed(sent: string) {
    this.addressedAs.push(sent);
    this.addressedAt.push(this.hearingFrom);
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
      const listenOut = this.manners.doubleListenOut;
      this.listenOut = listenOut ? uniform(ctx.random, listenOut) : 0;
      return;
    }
    if ((this.state === 'selected' || this.state === 'exchanged') && this.nudges < MAX_NUDGES) {
      this.nudges += 1;
      this.nudged = false;
      // Asks once our carrier is gone; a slower hand takes longer about it.
      this.askAt = now + uniform(ctx.random, this.persona.retry) + this.manners.askLag;
    }
  }

  private hearWhileCalling(intent: OperatorIntent, ctx: AgentContext) {
    const { call } = this;
    if (intent.calls.includes(call)) {
      this.addressed(call);
      return this.select(ctx, 'call', intent);
    }
    const near = intent.calls.find((sent) => isNearCall(sent, call) && this.isClosestTo(sent, ctx));
    if (near) {
      this.addressed(near);
      if (this.corrections < this.manners.maxCorrections) {
        this.corrections += 1;
        ctx.notify({ type: 'corrected', agent: this, heard: near });
        this.say(ctx, this.calling === 'pileup' ? pileupCallText(this.persona, 'answer', this.station.wpm) : correctionText(this.persona));
        this.state = 'waiting';
        this.retryAt = null;
        return;
      }
      if (ctx.random() < this.manners.bustChance) {
        this.busted = true;
        return this.select(ctx, 'bust', intent);
      }
      return this.leave('ignored-correction', ctx);
    }
    // eager: a call near its own but meant for a closer look-alike — it answers all the same.
    const taken = this.manners.answersNearPartial > 0 && this.state !== 'arriving'
      ? intent.calls.find((sent) => isNearCall(sent, call)) : undefined;
    if (taken && ctx.random() < this.manners.answersNearPartial) {
      this.addressed(taken);
      this.hijacked = true;
      this.react(ctx, 'hijack', { sent: taken });
      return this.select(ctx, 'hijack', intent);
    }
    if (intent.calls.length) {
      // Someone else got picked: stand by. A call that fits nobody: keep waiting.
      if (this.othersAddressed(intent, ctx)) this.standByFor('other');
      return;
    }
    if (intent.partial) {
      if (this.state === 'arriving') return;
      const { partial } = intent;
      if (matchesPartial(call, partial)) {
        this.react(ctx, 'match', { partial });
        this.answerPartial(ctx);
      } else if (this.manners.answersNearPartial > 0 && nearPartial(call, partial) && ctx.random() < this.manners.answersNearPartial) {
        this.react(ctx, 'near', { partial });
        this.answerPartial(ctx);
      } else if (this.manners.callsOnMismatch > 0 && ctx.random() < this.manners.callsOnMismatch) {
        this.react(ctx, 'mismatch', { partial });
        this.callAgain(ctx, this.cueDelay(ctx));
      } else {
        this.standByFor('partial');
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
      if (cq || intent.qrz) this.callAgain(ctx, this.cueDelay(ctx));
      return;
    }
    if (intent.qrx) {
      // Stand by until we ask again (a lid may not: callsOverQso).
      this.standByFor('qrx');
      return;
    }
    const { procedure } = this;
    const holding = this.state === 'holding';
    const again = intent.agn || intent.qrs;
    const cue = holding
      ? cq || intent.qrz || (procedure.closingWakes && intent.closing) || (procedure.agnWakesStandby && this.standBy !== 'other' && again)
      : cq || intent.qrz || again;
    if (holding && intent.closing && this.standBy === 'other' && this.manners.tailEnd > 0 && ctx.random() < this.manners.tailEnd) {
      // Straight in on the TU, before QRZ? and before anyone else.
      this.react(ctx, 'tail-end');
      return this.callAgain(ctx, uniform(ctx.random, TAIL_END_DELAY));
    }
    if (!cue) return;
    if (intent.qrs) this.slowDown();
    if (ctx.random() >= this.persona.recall) {
      // Sits this one out and listens for the next (or calls late if nothing comes).
      this.state = 'waiting';
      this.retryAt = ctx.now() + uniform(ctx.random, this.persona.retry) * 3;
      return;
    }
    this.callAgain(ctx, this.cueDelay(ctx));
  }

  /** Its full call back to a partial it takes for itself; it stays waiting to be called. */
  private answerPartial(ctx: AgentContext) {
    this.say(ctx, this.calling === 'pileup' ? pileupCallText(this.persona, 'answer', this.station.wpm) : partialReply(this.persona), this.cueDelay(ctx));
    this.state = 'waiting';
    this.retryAt = null;
  }

  /** Its retry clock is left alone: a CQ run's callers have always kept it while standing by. */
  private standByFor(reason: StandBy) {
    if (this.state === 'arriving') return;
    this.state = 'holding';
    this.standBy = reason;
  }

  /** How soon it answers a cue: its manners' timing if set, else its persona's reaction (drawn in say). */
  private cueDelay(ctx: AgentContext) {
    return this.manners.timing ? uniform(ctx.random, this.manners.timing) : undefined;
  }

  private hearAsPartner(intent: OperatorIntent, ctx: AgentContext) {
    const { call } = this;
    if (this.hijacked && intent.calls.length) {
      // It took a call that wasn't its own: called by its own call now, the QSO is real; anyone else's, it stands back.
      if (!intent.calls.includes(call)) return this.release(ctx);
      this.hijacked = false;
    }
    const meant = (sent: string) => isNearCall(sent, call) && (!this.procedure.partnerChecksPeers || !this.peerHas(sent, ctx));
    const forUs = intent.calls.includes(call) || intent.calls.some(meant);
    if (this.procedure.requeueOnCue && this.state === 'selected' && !forUs && (intent.qrz || intent.cq || intent.partial)) {
      // We moved on before its report went out: it is one of the pile again.
      this.release(ctx);
      return this.hearWhileCalling(intent, ctx);
    }
    if (intent.calls.length && !forUs) return this.leave('dropped', ctx);
    if (forUs) this.addressed(intent.calls.find((sent) => sent === call || meant(sent))!);
    this.nudged = false;

    if (this.state === 'selected') {
      if ((intent.agn || intent.qrs) && this.lastTx) {
        if (intent.qrs) this.slowDown();
        return this.say(ctx, this.lastTx);
      }
      return this.takeExchange(intent, ctx);
    }

    // exchanged: our exchange is out, waiting for TU / 73.
    if (this.contest && forUs && intent.serial !== undefined) this.heardNr = intent.serial;
    if (intent.ask.length) {
      const fields = this.exchange.sends.filter((field) => intent.ask.includes(field));
      return this.say(ctx, this.contest ? contestFieldsText(this.persona, fields, this.contest.nr) : fieldsText(this.persona, fields));
    }
    if (intent.agn || intent.qrs) {
      if (intent.qrs) this.slowDown();
      return this.say(ctx, this.exchangeTextFor(ctx));
    }
    if (intent.closing) {
      // DX and contest style: our TU ends it, and the frequency is left to the next caller.
      if (this.exchange.style !== 'dx' && this.exchange.style !== 'contest') this.say(ctx, finalText(this.persona, ctx.me));
      this.state = 'done';
      this.goneAt = ctx.now();
      ctx.notify({ type: 'closed', agent: this });
      return;
    }
    if (intent.qrz || intent.cq) {
      // Moved on without a TU: the QSO stands, unacknowledged.
      this.state = 'done';
      this.goneAt = ctx.now();
      return;
    }
    if (forUs && intent.report) this.say(ctx, this.exchangeTextFor(ctx));
  }

  private exchangeTextFor(ctx: AgentContext) {
    if (this.contest) return contestExchangeText(this.persona, ctx.me, this.contest.nr);
    return this.exchange.style === 'dx' ? dxExchangeText(this.persona, ctx.me, this.exchange.sends) : exchangeText(this.persona, ctx.me, this.heardName);
  }

  /** Its QSO undone (it took someone else's call, or we moved on before it began): back to standing by. */
  private release(ctx: AgentContext) {
    this.hijacked = false;
    this.got = { RST: false, NAME: false, QTH: false, NR: false, CALL: false };
    this.heardName = false;
    this.askAt = null;
    this.state = 'holding';
    this.standBy = 'other';
    this.retryAt = null;
    ctx.notify({ type: 'released', agent: this });
  }

  private select(ctx: AgentContext, via: 'call' | 'single' | 'bust' | 'hijack', intent: OperatorIntent) {
    this.state = 'selected';
    this.nudged = false;
    ctx.notify({ type: 'selected', agent: this, via });
    this.takeExchange(intent, ctx);
  }

  /** Collect what the exchange wants from us (RST / our name / our QTH); answer with ours once it is all in. */
  private takeExchange(intent: OperatorIntent, ctx: AgentContext) {
    const { me } = ctx;
    const named = intent.fields.name !== undefined || (me.name !== '' && intent.tokens.includes(me.name));
    const placed = intent.fields.qth !== undefined || (me.qth !== '' && intent.tokens.includes(me.qth));
    const fresh = Boolean(intent.report) || named || placed || intent.serial !== undefined;
    const heard: Record<AskField, boolean> = { RST: Boolean(intent.report), NAME: named, QTH: placed, NR: intent.serial !== undefined, CALL: false };
    if (this.contest && intent.serial !== undefined) this.heardNr = intent.serial;
    for (const field of ASK_FIELDS) this.got[field] ||= heard[field] || !needsFrom(this.exchange, field, me);
    this.heardName ||= named;
    const missing = this.exchange.wants.filter((field) => !this.got[field]);
    if (!missing.length) {
      this.say(ctx, this.exchangeTextFor(ctx));
      this.state = 'exchanged';
      ctx.notify({ type: 'exchanged', agent: this });
    } else if (fresh || this.exchange.wants.some((field) => this.got[field])) {
      this.say(ctx, askText(this.persona, missing));
      ctx.notify({ type: 'asked', agent: this, fields: missing });
    } else if (this.contest) {
      // Called with nothing else: its call once, and it waits for the exchange.
      this.say(ctx, this.persona.call);
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
    const text = this.calling === 'pileup'
      ? pileupCallText(this.persona, 'call', this.station.wpm, this.manners.repeat)
      : callText(this.persona, ctx.me.call, this.manners.repeat);
    this.say(ctx, text, delay);
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
    this.station.wpm = this.procedure.qrsToFloor ? Math.min(this.station.wpm, this.persona.qrsFloor) : Math.max(this.persona.qrsFloor, this.station.wpm - QRS_STEP);
  }

  private leave(reason: GoneReason, ctx: AgentContext) {
    this.state = 'gone';
    this.goneReason = reason;
    this.goneAt = ctx.now();
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

  /** "QSO B4" meant for it: with its call (or near it), or with none while it is the one we are working. */
  private toldB4(intent: OperatorIntent) {
    if (intent.calls.includes(this.call) || intent.calls.some((sent) => isNearCall(sent, this.call))) return true;
    return !intent.calls.length && (this.state === 'selected' || this.state === 'exchanged');
  }

  /** Someone else on frequency has exactly this call. */
  private peerHas(sent: string, ctx: AgentContext) {
    return ctx.peers().some((peer) => peer !== this && peer instanceof CallerAgent && !peer.gone && peer.call === sent);
  }

  private othersAddressed(intent: OperatorIntent, ctx: AgentContext) {
    return ctx.peers().some((peer) => peer !== this && peer instanceof CallerAgent && !peer.gone
      && intent.calls.some((sent) => sent === peer.call || isNearCall(sent, peer.call)));
  }
}

const ASK_FIELDS: AskField[] = ['RST', 'NAME', 'QTH', 'NR', 'CALL'];

/** A contest caller's serial: the number, and the text it keys for it ("023", "T23", "23"). */
export interface CallerContest { serial: number; nr: string }

/** What a mode gives its callers beyond their persona; omitted parts take the CQ run's defaults. */
export interface CallerBehaviour {
  manners?: CallerManners;
  exchange?: ExchangeSpec;
  procedure?: CallerProcedure;
  /** How it sends its call: as on a CQ run (default), or the pileup's short form (pileupCallText). */
  calling?: 'run' | 'pileup';
  /** A contest: its serial for us (with CONTEST_EXCHANGE). */
  contest?: CallerContest;
}

/** A caller tuned to our CQ at `listenRf`, keying `offsetHz` off it. */
export function createCaller(persona: StationPersona, { random, listenRf, now }: { random: Random; listenRf: number; now: number }, behaviour?: CallerBehaviour) {
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
  return new CallerAgent(persona, station, listenRf, now, behaviour);
}
