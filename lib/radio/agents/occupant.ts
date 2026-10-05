import { makeStation, type Station } from '../band';
import type { AirEvent } from '../air/ether';
import type { StationPersona } from '../air/persona';
import { pick, uniform, type Random } from '../random';
import type { Agent, AgentContext } from './types';

/**
 * Two stations already in a QSO on a frequency: the first residents of the band.
 *
 * They take turns by ear — each over goes out when its station has *heard* the
 * partner's over end on the air — so there are quiet gaps, a lost over gets
 * repeated, and our own carrier can step on them. Nothing is scripted against
 * the operator: they answer whatever reaches them on the shared air (a QRL?, a
 * CQ on top of them), which is exactly how they will behave in free play.
 */

export type OccupantState = 'chatting' | 'done';

/** A missed over is sent again after this much silence. */
export const LOST_OVER_AFTER = 12;
/** They stop asking us to move after this many requests (and just carry on). */
export const MAX_QSY_REQUESTS = 3;
export const MAX_QRL_ANSWERS = 4;
/** Chance the barely audible side is the one answering a QRL? (one-sided placement). */
export const WEAK_ANSWER_RATE = 0.4;
/** Occupants listen wide: anyone within ±250 Hz is "on" their frequency. */
const OCCUPANT_RX_WIDTH = 500;
/** Signal of the side we can hardly hear. */
const FAINT = 0.03;

const QRL_ANSWERS = ['QRL', 'YES', 'C', 'R QRL', 'YES QRL', 'QRL PSE'];
const QSY_REQUESTS = ['QRL QRL PSE QSY', 'QRL PSE QSY', 'PSE QSY QRL'];

export class OccupantAgent implements Agent {
  readonly id: number;
  readonly key: number;
  readonly rxWidth = OCCUPANT_RX_WIDTH;
  /** Something to say off-turn (a QRL? answer), sent when the frequency is quiet. */
  aside: { text: string; at: number } | null = null;

  constructor(readonly pair: OccupantPair, readonly persona: StationPersona, readonly station: Station) {
    this.id = station.id;
    this.key = station.id;
  }

  get state(): OccupantState { return this.pair.done ? 'done' : 'chatting'; }
  get gone() { return this.pair.done; }
  get call() { return this.persona.call; }
  listenRf() { return this.station.rf; }
  sending(now: number) { return this.station.queue.length > 0 || this.station.busyUntil > now; }

  hear(event: AirEvent, ctx: AgentContext) { this.pair.hear(this, event, ctx); }
  tick(now: number, ctx: AgentContext) { this.pair.tick(this, now, ctx); }
  rebase(shift: number) {
    if (this.aside) this.aside.at += shift;
    if (this === this.pair.a) this.pair.rebase(shift);
  }
}

interface Heard { event: AirEvent; kind: 'qrl' | 'qsy'; by: OccupantAgent[] }

export class OccupantPair {
  readonly a: OccupantAgent;
  readonly b: OccupantAgent;
  done = false;
  qrlAnswers = 0;
  qsyRequests = 0;
  /** Who keys the next over, and from when; null while an over is in the air. */
  private turn: OccupantAgent | null;
  private nextAt: number;
  private lastSpeaker: OccupantAgent | null = null;
  private lastOver = '';
  private lastOverEnd = Number.NEGATIVE_INFINITY;
  private overs: string[];
  private sent = 0;
  private heard: Heard[] = [];

  constructor(
    personas: [StationPersona, StationPersona],
    stations: [Station, Station],
    /** The side we hear at a whisper, if any. */
    readonly faint: 'a' | 'b' | null,
    private random: Random,
    now: number,
  ) {
    this.a = new OccupantAgent(this, personas[0], stations[0]);
    this.b = new OccupantAgent(this, personas[1], stations[1]);
    this.overs = oversFor(personas[0], personas[1], random);
    this.turn = this.a;
    this.nextAt = now + uniform(random, [0.3, 2.5]);
  }

  get agents(): [OccupantAgent, OccupantAgent] { return [this.a, this.b]; }
  /** Their frequency (the first station's). */
  get rf() { return this.a.station.rf; }
  /** Overs still to go before they sign. */
  get remaining() { return this.overs.length - this.sent; }

  private partnerOf(agent: OccupantAgent) { return agent === this.a ? this.b : this.a; }

  hear(agent: OccupantAgent, event: AirEvent, ctx: AgentContext) {
    if (this.done) return;
    const partner = this.partnerOf(agent);
    if (event.from === partner.id) {
      // The partner's over is in: our turn.
      if (this.turn === null && this.lastSpeaker === partner) {
        this.turn = agent;
        this.nextAt = event.end + uniform(ctx.random, agent.persona.reaction) + 0.5;
      }
      return;
    }
    if (event.from !== 'me' || !event.intent) return;
    const intent = event.intent;
    const kind = intent.qrl ? 'qrl' : intent.cq || intent.qrz ? 'qsy' : null;
    if (!kind) return;
    const known = this.heard.find((item) => item.event.id === event.id);
    if (known) known.by.push(agent);
    else this.heard.push({ event, kind, by: [agent] });
  }

  /** Runs for each of the two; the first call each tick settles what both heard. */
  tick(agent: OccupantAgent, now: number, ctx: AgentContext) {
    if (this.done) return;
    this.answer(ctx);
    // A short answer goes out over the partner's over (the listening side is the one who heard us), never over us.
    if (agent.aside && now >= agent.aside.at && !agent.sending(now) && !ctx.hearsKeying(agent, 'me')) {
      ctx.send(agent, agent.aside.text, 0.05);
      agent.aside = null;
      return;
    }
    if (agent.aside || this.partnerOf(agent).aside) return;

    // Our over went out but the partner never answered: it was lost, send it again.
    if (this.turn === null && this.lastSpeaker === agent && !agent.sending(now) && !ctx.hearsKeying(agent)
      && now - Math.max(this.lastOverEnd, agent.station.busyUntil) > LOST_OVER_AFTER) {
      this.turn = agent;
      this.sent -= 1;
      this.nextAt = now;
    }
    if (this.turn !== agent || now < this.nextAt || agent.sending(now) || ctx.hearsKeying(agent)) return;

    if (this.sent >= this.overs.length) {
      this.done = true;
      return;
    }
    const text = this.overs[this.sent];
    this.sent += 1;
    this.lastOver = text;
    this.lastSpeaker = agent;
    this.turn = null;
    ctx.send(agent, text, 0.05);
    this.lastOverEnd = now;
    // Last over sent and nobody owes a reply: they are signing.
    if (this.sent >= this.overs.length) this.finishAfter(agent);
  }

  rebase(shift: number) {
    this.nextAt += shift;
    this.lastOverEnd += shift;
  }

  private finishAfter(agent: OccupantAgent) {
    // Stays "chatting" until the final over has gone out; the run drops it once it is off the air.
    this.turn = agent;
    this.nextAt = Number.NEGATIVE_INFINITY;
  }

  /** One answer per transmission of ours, from whichever of the two is best placed to give it. */
  private answer(ctx: AgentContext) {
    if (!this.heard.length) return;
    for (const { event, kind, by } of this.heard.splice(0)) {
      if (kind === 'qrl' ? this.qrlAnswers >= MAX_QRL_ANSWERS : this.qsyRequests >= MAX_QSY_REQUESTS) continue;
      const faint = this.faint ? this[this.faint] : null;
      const responder = faint && by.includes(faint) && (by.length === 1 || ctx.random() < WEAK_ANSWER_RATE)
        ? faint
        : (by.find((agent) => agent !== faint) ?? by[0]);
      const text = kind === 'qrl' ? pick(QRL_ANSWERS, ctx.random) : QSY_REQUESTS[Math.min(this.qsyRequests, QSY_REQUESTS.length - 1)];
      if (kind === 'qrl') this.qrlAnswers += 1;
      else this.qsyRequests += 1;
      const at = event.end + uniform(ctx.random, [0.3, 1.2]);
      responder.aside = { text, at };
      // The over in hand waits for the answer.
      this.nextAt = Math.max(this.nextAt, at + 2);
      ctx.notify({ type: kind === 'qrl' ? 'qrl-answered' : 'qsy-asked', agent: responder });
    }
  }

  /** For tests and the sim: what they last sent each other. */
  get lastText() { return this.lastOver; }
}

/** The QSO they are in the middle of: a few rag-chew overs and the sign-off. */
function oversFor(a: StationPersona, b: StationPersona, random: Random): string[] {
  const head = (from: StationPersona, to: StationPersona) => `${to.call} DE ${from.call}`;
  const tail = (from: StationPersona, to: StationPersona) => `${to.call} DE ${from.call} KN`;
  // Short overs, so the gaps between them come often (a real rag-chew over runs longer).
  const filler = [
    (f: StationPersona, t: StationPersona) => `R FB ${t.name} RIG 100W ANT DP = WX FINE ${tail(f, t)}`,
    (f: StationPersona, t: StationPersona) => `R TNX ${t.name} = WX CLOUDY TEMP ${15 + Math.floor(random() * 15)}C ${tail(f, t)}`,
    (f: StationPersona, t: StationPersona) => `R OK ${t.name} = QSB HR BUT OK = HW WX? ${tail(f, t)}`,
    (f: StationPersona, t: StationPersona) => `R FB = AGE ${30 + Math.floor(random() * 45)} = HAM SINCE ${1965 + Math.floor(random() * 55)} ${tail(f, t)}`,
  ];
  const overs = [
    `${head(a, b)} GM UR ${a.rst} ${a.rst} NAME ${a.name} QTH ${a.qth} HW? KN`,
    `R ${a.name} UR ${b.rst} ${b.rst} NAME ${b.name} QTH ${b.qth} ${tail(b, a)}`,
  ];
  const body = 2 + Math.floor(random() * 4);
  for (let index = 0; index < body; index += 1) {
    const [from, to] = index % 2 === 0 ? [a, b] : [b, a];
    overs.push(pick(filler, random)(from, to));
  }
  const [from, to] = body % 2 === 0 ? [a, b] : [b, a];
  overs.push(`TNX FER QSO ${to.name} 73 ${to.call} DE ${from.call} SK`);
  overs.push(`R TNX ${from.name} 73 TU EE`);
  return overs;
}

export interface OccupantPlacement {
  /** Their frequency, Hz. */
  rf: number;
  /** One side we can barely hear. */
  oneSided?: boolean;
  now: number;
}

/** A QSO in progress at `rf`. Returns the pair; its two stations go on the band. */
export function createOccupantPair(personas: [StationPersona, StationPersona], random: Random, { rf, oneSided = false, now }: OccupantPlacement) {
  const faint: 'a' | 'b' | null = oneSided ? (random() < 0.5 ? 'a' : 'b') : null;
  const stations = personas.map((persona, index) => makeStation(random, {
    role: 'occupant',
    call: persona.call,
    // Zero-beat to a few Hz, as two stations in QSO are.
    rf: Math.round(rf + (index === 0 ? 0 : (random() - 0.5) * 30)),
    wpm: persona.wpm,
    strength: faint === (index === 0 ? 'a' : 'b') ? FAINT : persona.strength,
    jitter: persona.jitter,
    drift: 0,
    chirp: 0,
    gap: [1, 2],
    loop: null,
    nextAt: Number.POSITIVE_INFINITY,
  })) as [Station, Station];
  return new OccupantPair(personas, stations, faint, random, now);
}
