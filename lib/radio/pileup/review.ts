import { HEAD_SECONDS } from '../air/ether';
import { isNearCall, matchesPartial, nearPartial } from '../air/intent';
import type { CallerAgent } from '../agents/caller';
import type { PileupResult } from '../modes/pileupRun';
import type { JudgedContact } from '../modes/runCore';
import type { ActionKind } from './nextAction';

/**
 * The pileup review: after QRT the truth comes out. Each of our messages is kept with who
 * was on the frequency as it went out and who answered it, so the review can show how
 * the operator narrowed the pile down (3A → 3AB → JA3ABC) against who really fit.
 * Nothing here is shown while the run is on.
 */

/** A caller on the frequency as one of our messages went out. */
export interface CallerSnap {
  id: number;
  call: string;
  /** Where it keyed relative to our VFO, Hz. */
  offsetHz: number;
  db: number;
  wpm: number;
  style: string;
  /** eager / lid / tail / deaf (its manners). */
  traits: string[];
  state: string;
}

export interface Responder { id: number; call: string; text: string; at: number }

/** One of our messages, with the frequency around it. */
export interface DeskStep {
  /** On the air from–to (the run's clock, as handed to the session). */
  at: number;
  end: number;
  text: string;
  kind: ActionKind;
  /** The piece or call it was about. */
  subject?: string;
  /** The call we were working when it went out (for AGN? / TU). */
  working: string | null;
  callers: CallerSnap[];
  /** Stations that keyed within RESPONSE_SECONDS of it, before our next message. */
  responders: Responder[];
  /** Stations keying over its start (a doubling): they never copied it. Filled at QRT by withOverlaps. */
  over?: Responder[];
}

/** A caller's message as it went on the air (the rig's clock, as our steps). */
export interface StationTx { id: number; call: string; text: string; start: number; end: number }

/**
 * Who was keying as each of our messages began: as the air has it, a station keying
 * HEAD_SECONDS into our message doesn't hear it (a doubling).
 */
export function withOverlaps(steps: readonly DeskStep[], txs: readonly StationTx[]): DeskStep[] {
  return steps.map((step) => {
    const head = step.at + HEAD_SECONDS;
    const over = new Map<number, Responder>();
    for (const tx of txs) if (tx.start <= head && head < tx.end && !over.has(tx.id)) over.set(tx.id, { id: tx.id, call: tx.call, text: tx.text, at: tx.start });
    return { ...step, over: [...over.values()] };
  });
}

/** A station keying within this long after our message is taken as answering it. */
export const RESPONSE_SECONDS = 8;

const traitsOf = (agent: CallerAgent) => {
  const m = agent.manners;
  return [
    m.answersNearPartial ? 'eager' : '',
    m.callsOnMismatch || m.callsOverQso ? 'lid' : '',
    m.tailEnd ? 'tail' : '',
    m.missesUs ? 'deaf' : '',
  ].filter(Boolean);
};

/** Who is on the frequency as our message goes out (callers not gone and done arriving). */
export const callerSnaps = (agents: readonly CallerAgent[], vfo: number): CallerSnap[] =>
  agents.filter((agent) => !agent.gone && agent.state !== 'arriving').map((agent) => ({
    id: agent.id,
    call: agent.call,
    offsetHz: Math.round(agent.station.rf - vfo),
    db: Math.round(20 * Math.log10(Math.max(1e-6, agent.station.strength))),
    wpm: agent.station.wpm,
    style: agent.persona.style,
    traits: traitsOf(agent),
    state: agent.state,
  }));

/**
 * Keeps the review's record as a run goes — the desk and the headless simulator alike:
 * each of our messages with who was on the frequency, who answered it, and every caller
 * message (to find the doublings at QRT).
 */
export class StepRecorder {
  readonly steps: DeskStep[] = [];
  readonly txs: StationTx[] = [];

  sent(step: Omit<DeskStep, 'responders' | 'over'>) {
    this.steps.push({ ...step, responders: [] });
  }

  /** A caller's message as it goes on the air: it answered our last one if it came right after. */
  heard(caller: { id: number; call: string }, tx: { text: string; start: number; length: number }) {
    this.txs.push({ id: caller.id, call: caller.call, text: tx.text, start: tx.start, end: tx.start + tx.length });
    const last = this.steps[this.steps.length - 1];
    if (last && tx.start >= last.end - 0.5 && tx.start - last.end <= RESPONSE_SECONDS && !last.responders.some((item) => item.id === caller.id)) {
      last.responders.push({ id: caller.id, call: caller.call, text: tx.text, at: tx.start });
    }
  }

  /** The steps for the review, doublings marked. */
  finish(): DeskStep[] { return withOverlaps(this.steps, this.txs); }
}

/** Who a responder was to the message: it fit (match), it was the one we called (partner), a look-alike (near: eager on a partial, a correction or a hijack on a call), or unrelated (off). */
export type ResponderRole = 'match' | 'partner' | 'near' | 'off' | 'call';

/**
 * `before`: the pick's earlier messages. A station keyed over our message's start never
 * copied it, and a bare AGN? is a call to all from one that never heard us name the
 * station we were after: either way it is calling on, not out of turn.
 */
export function responderRole(step: Pick<DeskStep, 'kind' | 'subject' | 'working' | 'over'>, call: string, id?: number, before?: readonly DeskStep[]): ResponderRole {
  if (id !== undefined && step.over?.some((station) => station.id === id)) return 'call';
  if (id !== undefined && before && step.kind === 'agn' && step.working && call !== step.working && !before.some((earlier) => heardNaming(earlier, step.working!, id))) return 'call';
  const about = step.kind === 'partial' || step.kind === 'pick' || step.kind === 'correct' ? step.subject : step.kind === 'agn' ? step.working ?? undefined : undefined;
  if (!about) return 'call';
  if (step.kind === 'partial') return matchesPartial(call, about) ? 'match' : nearPartial(call, about) ? 'near' : 'off';
  if (call === about) return 'partner';
  return isNearCall(about, call) || nearPartial(call, about) || nearPartial(about, call) ? 'near' : 'off';
}

/** Station `id` was on the frequency for our message naming `call` and copied it. */
const heardNaming = (step: DeskStep, call: string, id: number) =>
  (step.kind === 'pick' || step.kind === 'correct') && step.subject === call && step.callers.some((caller) => caller.id === id) && !step.over?.some((station) => station.id === id);

/** Which callers on the frequency fit a partial (null: not a partial). */
export const fitting = (step: DeskStep) => (step.kind === 'partial' && step.subject ? step.callers.filter((caller) => matchesPartial(caller.call, step.subject!)) : null);

export type GroupOutcome = JudgedContact['outcome'] | 'dropped' | 'nothing';

/** One pick: from calling the pile to the TU (or giving up on it). */
export interface PickGroup {
  steps: DeskStep[];
  contacts: JudgedContact[];
  outcome: GroupOutcome;
  /** Seconds from its first message to our first call with the report. */
  toPick: number | null;
  partials: number;
  /** Our messages from calling the pile to the pick, the pick included. */
  moves: number | null;
}

const opens = (kind: ActionKind) => kind === 'cq' || kind === 'qrz';
const picks = (kind: ActionKind) => kind === 'pick' || kind === 'correct';

/** Our messages in picks: a QRZ?/CQ starts one unless nothing was asked yet, TU ends it. */
export function pickGroups(steps: readonly DeskStep[], result: Pick<PileupResult, 'contacts'>): PickGroup[] {
  const runs: DeskStep[][] = [];
  let current: DeskStep[] = [];
  const asked = () => current.some((step) => step.kind === 'partial' || picks(step.kind));
  for (const step of steps) {
    if (opens(step.kind) && asked()) {
      runs.push(current);
      current = [];
    }
    current.push(step);
    if (step.kind === 'tu') {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs.map((run) => {
    const pickAts = new Set(run.filter((step) => picks(step.kind)).map((step) => step.at));
    const contacts = result.contacts.filter((contact) => contact.sentAt.some((at) => pickAts.has(at)));
    const firstPick = run.findIndex((step) => picks(step.kind));
    const outcome: GroupOutcome = contacts.length
      ? contacts.find((contact) => contact.outcome === 'complete')?.outcome ?? contacts[contacts.length - 1].outcome
      : firstPick >= 0 || run.some((step) => step.kind === 'partial') ? 'dropped' : 'nothing';
    return {
      steps: run,
      contacts,
      outcome,
      toPick: firstPick >= 0 ? run[firstPick].at - run[0].at : null,
      partials: run.filter((step) => step.kind === 'partial').length,
      moves: firstPick >= 0 ? firstPick + 1 : null,
    };
  });
}

export interface PileupReviewStats {
  contacts: number;
  rate: number;
  busts: number;
  nil: number;
  /** Picks made (a call sent with the report). */
  picks: number;
  /** Mean messages per pick, from calling the pile to the call with the report. */
  movesPerPick: number | null;
  /** Mean seconds to a pick. */
  secondsToPick: number | null;
  /** Share of picks that used a partial first. */
  partialShare: number | null;
  partials: number;
  /** Partials that nobody on the frequency fit. */
  emptyPartials: number;
  /** Partials more than one station fit. */
  crowdedPartials: number;
  hijacks: number;
  missed: number;
  /** Calls sent (pick, correction) that the station called was keying over — it never heard them. */
  doubledPicks: number;
}

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

export function reviewStats(groups: readonly PickGroup[], result: PileupResult): PileupReviewStats {
  const picked = groups.filter((group) => group.moves !== null);
  const partialSteps = groups.flatMap((group) => group.steps).filter((step) => step.kind === 'partial');
  return {
    contacts: result.stats.contacts,
    rate: result.stats.rate,
    busts: result.stats.busts,
    nil: result.stats.nil,
    picks: picked.length,
    movesPerPick: mean(picked.map((group) => group.moves!)),
    secondsToPick: mean(picked.map((group) => group.toPick!)),
    partialShare: picked.length ? picked.filter((group) => group.partials > 0).length / picked.length : null,
    partials: partialSteps.length,
    emptyPartials: partialSteps.filter((step) => fitting(step)!.length === 0).length,
    crowdedPartials: partialSteps.filter((step) => fitting(step)!.length > 1).length,
    hijacks: result.stats.hijacks,
    missed: result.missed.length,
    doubledPicks: groups.flatMap((group) => group.steps).filter((step) => picks(step.kind) && step.over?.some((tx) => tx.call === step.subject)).length,
  };
}

/** What to practise next, from the numbers alone. */
export function nextPractice(stats: PileupReviewStats, level: string): string {
  if (!stats.picks) return 'まずは CQ のあと、聞こえた 2〜3 文字だけ入れて Enter。1 局を浮かせるところから始めましょう';
  if (stats.busts + stats.nil > Math.max(1, stats.contacts / 3)) return 'BUST・NIL が目立ちます。フルコールに自信がないときは、もう一度 partial で確かめてから 5NN を送りましょう';
  if (stats.doubledPicks >= 2) return '呼んだ局がまだ送信中で、こちらのコールが届かなかったことが何度かあります。相手が呼び終わるのを聞いてから送りましょう';
  if (stats.emptyPartials > stats.partials / 3 && stats.partials >= 3) return '誰にも当てはまらない partial が多めです。確実に聞こえた文字だけを送る練習をしましょう';
  if ((level === 'advanced' || level === 'dx') && (stats.partialShare ?? 0) < 0.3) return 'この難しさでは、最初から全部を取るより partial で 1 局を浮かせる方が速くなります。partial を主に使ってみましょう';
  if ((stats.secondsToPick ?? 0) > 25) return '選局までに時間がかかっています。強い局やピッチのずれた局に耳を絞り、早めに partial を送りましょう';
  if (stats.crowdedPartials > stats.partials / 2 && stats.partials >= 3) return '複数局が当てはまる partial が多めです。2 文字より 3 文字、プリフィックスよりサフィックスを狙うと 1 局に絞りやすくなります';
  return 'いい流れです。次は 1 つ上のレベルか、自局の速さを少し上げて試しましょう';
}
