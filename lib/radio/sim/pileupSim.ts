import { fadeAt, isKeyed, type Station } from '../band';
import type { AirEvent } from '../air/ether';
import { matchesPartial, nearPartial } from '../air/intent';
import { CopyMonitor, sampleBand, type CharJudgement, type RxRecord } from '../conditions';
import { keyText } from '../keying';
import { CallerAgent } from '../agents/caller';
import { isDisciplined } from '../agents/manners';
import type { AgentMe, AgentNote } from '../agents/types';
import { pileupLevel, pileupParamsOf, type PileupAxes, type PileupLevelId, type PileupParams } from '../modes/pileupLevels';
import { PileupSession, type PileupResult } from '../modes/pileupRun';
import { BOT_PROFILES, PileupBot, type BotAction, type BotProfileId, type BotSense } from '../pileup/bot';
import { PileupEar, SampledProbe, type Heard } from '../pileup/ear';
import { judgePileup, type PileupAnalysis } from '../pileup/analysis';
import type { ActionKind } from '../pileup/nextAction';
import { callerSnaps, StepRecorder, type DeskStep } from '../pileup/review';
import type { RunScore } from '../runReview';
import { seeded } from '../random';
import { HeadlessRadio, type SimAirEvent, type SimBand } from './runSim';

/**
 * Headless pileup: PileupSession and its callers, the band sampled every 100 ms as the
 * rig does, PileupEar copying each caller's transmission from those samples, and a
 * PileupBot deciding from what it copied. The simulator alone knows who is who: it
 * checks the run's invariants every step and works out the numbers (BUST, partial
 * accuracy, …) against the truth. Nothing of that reaches the bot.
 */

export interface PileupSimOptions {
  seed: number;
  level?: PileupLevelId;
  /** Axes over the level's. */
  axes?: Partial<PileupAxes>;
  params?: Partial<PileupParams>;
  bot?: BotProfileId;
  band?: SimBand;
  duration?: number;
  drain?: number;
  /** Every input the bot got and what it did, in order (replay tests). */
  record?: boolean;
  /** Every transmission on the air, ours ('me') and every station's, as it is keyed (golden tests). */
  onAir?: (event: SimAirEvent) => void;
}

/** One thing the bot was given, or did. */
export type BotTraceItem = { kind: 'heard'; heard: Heard } | { kind: 'act'; sense: BotSense; action: BotAction | null } | { kind: 'keyed'; end: number };

export interface InvariantBreach { t: number; kind: string; detail: string }

export interface PartialRecord { piece: string; at: number; correct: boolean; matches: number; answered: number }
export interface PickRecord { moves: number; seconds: number; via: string }
export interface OverlapTally { chars: number; copied: number }

export interface PileupSimReport {
  result: PileupResult;
  run: PileupSession;
  bot: PileupBot;
  qrtAt: number;
  settled: boolean;
  breaches: InvariantBreach[];
  tx: number;
  moves: Record<string, number>;
  partials: PartialRecord[];
  picks: PickRecord[];
  /** Logged calls not the station's (or contacts played along with a wrong call). */
  busts: number;
  nil: number;
  /** Complete contacts logged with the right call. */
  good: number;
  /** Callers who came before QRT. */
  arrived: number;
  /** …of whom were still on frequency at QRT, unworked (couldn't have been worked). */
  leftAtQrt: number;
  hijacks: number;
  /** Hijacks after which the station whose call it was got worked, or the hijacker stood back. */
  hijacksRecovered: number;
  departures: number;
  waiting: { max: number; mean: number };
  /** Longest stretch before QRT with callers standing by and no contact logged, seconds. */
  longestDry: number;
  /** Bot's copy of each caller character by stations keyed at once (n+1: 1 is in the clear), and overlaps below the QRM threshold. */
  overlap: Record<'1' | '2-3' | '4+' | 'sub', OverlapTally>;
  reactions: Record<string, number>;
  trace: BotTraceItem[];
  /** The review's record (as the desk keeps it), the run scored and its causes. */
  steps: DeskStep[];
  score: RunScore;
  analysis: PileupAnalysis;
  /** What reached the bot's receiver, per transmission, and the band samples behind it. */
  records: RxRecord[];
  monitor: CopyMonitor;
}

/** The bot's move as the desk's action kind. */
const KIND: Record<BotAction['move'], ActionKind> = { cq: 'cq', qrz: 'qrz', call: 'pick', recall: 'pick', correct: 'correct', partial: 'partial', agn: 'agn', tu: 'tu' };

const ME: AgentMe = { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };
const VFO = 7_012_000;
const FILTER = 500;
const BOT_WPM = 24;
/** The bot's own random numbers (a hijack check) are drawn from `seed + BOT_SEED`; the ear's from `seed + EAR_SEED`. */
export const BOT_SEED = 15485863;
export const EAR_SEED = 104729;

export const PILEUP_BAND: SimBand = { noise: 0.2, qsb: 0, qrn: 0, qrm: 0 };

/** Total stations keyed on a character (the copied one plus `n` others) as the analysis buckets them. */
const bucketOf = (n: number) => (n + 1 >= 4 ? '4+' : n + 1 >= 2 ? '2-3' : '1');

export function runPileupSim({ seed, level = 'intermediate', axes, params, bot: botId = 'average', band = PILEUP_BAND, duration = 300, drain = 1500, record = false, onAir }: PileupSimOptions): PileupSimReport {
  const random = seeded(seed);
  const radio = new HeadlessRadio(random);
  const sessionParams = { ...pileupParamsOf({ ...pileupLevel(level).axes, ...axes }), ...params };
  const run = new PileupSession({ random, me: ME, params: sessionParams }, radio);
  const monitor = new CopyMonitor();
  const profile = BOT_PROFILES[botId];
  const overlap: PileupSimReport['overlap'] = { '1': { chars: 0, copied: 0 }, '2-3': { chars: 0, copied: 0 }, '4+': { chars: 0, copied: 0 }, sub: { chars: 0, copied: 0 } };
  const probe = new SampledProbe(monitor);
  // The ear's own stream: what it copies never shifts the callers' draws.
  const ear = new PileupEar({
    judge(rec, span, now) {
      const judged: CharJudgement = probe.judge(rec, span, now);
      pendingJudgements.push(judged);
      return judged;
    },
  }, profile.ear, seeded(seed + EAR_SEED));
  const bot = new PileupBot(profile, ME.call, seeded(seed + BOT_SEED));
  const trace: BotTraceItem[] = [];
  let pendingJudgements: CharJudgement[] = [];

  radio.stationsChanged([]);
  /** Caller transmissions not yet over, to be copied once they are. */
  let receiving: { record: RxRecord; station: Station; end: number }[] = [];
  /** Who sent what the bot copied — the simulator's books, never the bot's. */
  const sourceOf = new Map<Heard, number>();
  const recorder = new StepRecorder();
  const records: RxRecord[] = [];
  radio.onTransmission = (station, tx) => {
    onAir?.({ from: station.id, text: tx.text, rf: station.rf, start: tx.start, end: tx.start + tx.length, wpm: station.wpm });
    run.onStationTransmission(station, tx);
    const agent = run.agents.find((item) => item.id === station.id);
    if (agent) recorder.heard(agent, tx);
    if (station.role !== 'caller' || Math.abs(station.rf - VFO) > FILTER / 2) return;
    const record: RxRecord = { tx, station: station.id, epoch: 0, cutAt: null };
    records.push(record);
    receiving.push({ record, station, end: tx.start + tx.length });
  };

  const breaches: InvariantBreach[] = [];
  const breach = (t: number, kind: string, detail: string) => { if (breaches.length < 50) breaches.push({ t, kind, detail }); };
  const agentOf = (id: number) => run.agents.find((agent) => agent.id === id);
  // Disciplined callers never decide to key while they hear us.
  const send = radio.send.bind(radio);
  radio.send = (station, text, delay) => {
    const agent = agentOf(station.id);
    if (agent && isDisciplined(agent.manners) && run.ether.hearsKeying(agent, 'me', radio.t)) breach(radio.t, 'keyed-over-us', `${agent.call}: ${text}`);
    send(station, text, delay);
  };

  let busyUntil = 0;
  let tx = 0;
  const moves: Record<string, number> = {};
  const partials: PartialRecord[] = [];
  const picks: PickRecord[] = [];
  /** The pick under way: transmissions since the cue, and when the cue ended. */
  let cycle = { moves: 0, from: 0 };
  let lastPartial = null as PartialRecord | null;
  const standing = () => run.agents.filter((agent) => agent.state === 'arriving' || agent.state === 'waiting' || agent.state === 'holding');

  const transmit = (action: BotAction, t: number, working: string | null) => {
    const start = t + 0.05;
    const end = start + keyText(action.text, { wpm: BOT_WPM }).length;
    busyUntil = end;
    tx += 1;
    moves[action.move] = (moves[action.move] ?? 0) + 1;
    if (action.move === 'cq' || action.move === 'qrz' || action.move === 'tu') cycle = { moves: 0, from: end };
    else cycle.moves += 1;
    if (action.move === 'partial' && action.piece) {
      const piece = action.piece;
      const on = standing().map((agent) => agent.call);
      lastPartial = {
        piece,
        at: start,
        correct: false,
        matches: on.filter((call) => matchesPartial(call, piece)).length,
        answered: 0,
      };
      partials.push(lastPartial);
    }
    if (action.move === 'call') {
      picks.push({ moves: cycle.moves, seconds: Math.max(0, start - cycle.from), via: lastPartial && cycle.moves > 1 ? 'partial' : 'direct' });
    }
    onAir?.({ from: 'me', text: action.text, rf: VFO, start, end });
    run.transmit(action.text, { start, end, rf: VFO });
    recorder.sent({ at: start, end, text: action.text, kind: KIND[action.move], subject: action.piece ?? action.call, working, callers: callerSnaps(run.agents, VFO) });
    bot.keyed(end);
    if (record) trace.push({ kind: 'keyed', end });
  };

  const qrtAt = duration;
  const end = duration + drain;
  const waitSamples: number[] = [];
  let lastLogAt = 0;
  let longestDry = 0;
  const reactions: Record<string, number> = {};
  let pickHeardBy = new Set<number>();
  let t = 0;
  const step = 0.05;
  for (; t <= end; t = Math.round((t + step) * 1000) / 1000) {
    radio.advance(t);
    const sending = t < busyUntil;
    if (Math.abs(t * 10 - Math.round(t * 10)) < 1e-6) {
      for (const station of radio.stations) station.fade = fadeAt(station, t, band.qsb);
      for (const target of radio.stations) {
        if (target.role !== 'caller' || Math.abs(target.rf - VFO) > FILTER / 2) continue;
        monitor.push(sampleBand({ t, epoch: 0, listening: !sending, vfo: VFO, filter: FILTER, noise: band.noise, target, stations: radio.stations, crash: 0 }));
      }
    }
    // Copy what has ended (and been sampled to its end).
    const due = receiving.filter((item) => item.end + 0.1 <= t);
    if (due.length) {
      receiving = receiving.filter((item) => item.end + 0.1 > t);
      for (const item of due) {
        pendingJudgements = [];
        const heard = ear.hear(item.record, { rf: item.station.rf, level: item.station.strength }, VFO, { t, epoch: 0 });
        tallyOverlap(item.record, heard, pendingJudgements, overlap);
        sourceOf.set(heard, item.station.id);
        // Was it an answer to our partial? (The simulator's books.)
        if (lastPartial && item.record.tx.start > lastPartial.at && item.record.tx.start - lastPartial.at < 8) {
          const sourceCall = agentOf(item.station.id)?.call;
          if (sourceCall && item.record.tx.text.includes(sourceCall)) lastPartial.answered += 1;
        }
        bot.hear(heard);
        if (record) trace.push({ kind: 'heard', heard });
      }
    }
    if (t < qrtAt && Math.abs(t - Math.round(t)) < step / 2) {
      const count = standing().length;
      waitSamples.push(count);
      if (count === 0) lastLogAt = t;
      longestDry = Math.max(longestDry, t - Math.max(lastLogAt, 10));
    }
    const before = new Map(run.agents.map((agent) => [agent.id, agent.state === 'holding' ? agent.standBy : null]));
    const delivered = run.tick(t);
    for (const event of delivered) {
      // Who heard us pick someone (and so knows a QSO is on).
      if (event.from === 'me' && event.intent?.calls.length) pickHeardBy = new Set(run.agents.filter((agent) => run.ether.hears(agent, event)).map((agent) => agent.id));
      if (event.from === 'me' && event.intent && (event.intent.qrz || event.intent.cq || event.intent.partial)) pickHeardBy = new Set();
    }
    checkNotes(run.drainNotes(), delivered, run, t, pickHeardBy, before, breach);
    if (bot.logs.length && bot.logs[bot.logs.length - 1].at === t) lastLogAt = t;
    if (t >= qrtAt && t >= busyUntil && !bot.working && run.agents.every((agent) => agent.gone)) break;

    const keyed = radio.stations.filter((station) => Math.abs(station.rf - VFO) <= FILTER / 2 && isKeyed(station, t));
    const carrier = keyed.length > 0;
    const sense: BotSense = { t, carrier, tones: keyed.map((station) => Math.round(station.rf - VFO)), sending, qrt: t >= qrtAt };
    const logsBefore = bot.logs.length;
    const working = bot.working;
    const action = bot.act(sense);
    if (record) trace.push({ kind: 'act', sense, action });
    if (bot.logs.length > logsBefore) {
      const entry = bot.logs[bot.logs.length - 1];
      run.logEntry({ call: entry.call, rst: entry.rst, name: '', qth: '' }, t);
      lastLogAt = t;
    }
    if (action) transmit(action, t, working);
  }
  // Partial accuracy against the truth: was the piece in the call of a station it was copied from?
  for (const partial of partials) {
    partial.correct = run.agents.some((agent) => matchesPartial(agent.call, partial.piece) && [...sourceOf.entries()].some(([heard, id]) => id === agent.id && heard.end <= partial.at && heard.end > partial.at - 10));
  }

  for (const agent of run.agents) {
    for (const reaction of agent.reactions) reactions[reaction.kind] = (reactions[reaction.kind] ?? 0) + 1;
    checkReactions(agent, breach);
  }
  const settled = run.agents.every((agent) => agent.gone);
  if (!settled) breach(t, 'unsettled', run.agents.filter((agent) => !agent.gone).map((agent) => `${agent.call}:${agent.state}`).join(' '));
  const result = run.finish(t);
  const steps = recorder.finish();
  const { score, analysis } = judgePileup({ result, steps, recordsOf: (id) => records.filter((item) => item.station === id), monitor, now: { t, epoch: 0 } });
  const contactOf = new Map(result.contacts.map((contact) => [contact.id, contact]));
  let busts = result.contacts.filter((contact) => contact.outcome === 'bust').length;
  let good = 0;
  for (const entry of result.log) {
    const contact = entry.contactId ? contactOf.get(entry.contactId) : undefined;
    if (!contact) continue;
    if (contact.truth.call !== entry.fields.call) busts += contact.outcome === 'bust' ? 0 : 1;
    else if (contact.outcome === 'complete' && entry.verdict === 'ok') good += 1;
  }
  const hijackers = run.agents.filter((agent) => agent.reactions.some((reaction) => reaction.kind === 'hijack'));
  const hijacksRecovered = hijackers.filter((agent) => {
    const taken = agent.reactions.find((reaction) => reaction.kind === 'hijack')?.sent;
    const owner = run.agents.find((other) => other.call === taken);
    const ownerWorked = owner && result.contacts.some((contact) => contact.stationId === owner.id && contact.outcome === 'complete');
    return !agent.hijacked || ownerWorked;
  }).length;
  const qrtStanding = run.agents.filter((agent) => agent.arrivedAt <= qrtAt && !result.contacts.some((contact) => contact.stationId === agent.id && contact.outcome !== 'incomplete')
    && !(agent.goneReason && ['patience', 'waited', 'timeout', 'ignored-correction', 'dropped'].includes(agent.goneReason) && departedBefore(agent, qrtAt)));
  return {
    result,
    run,
    bot,
    qrtAt,
    settled,
    breaches,
    tx,
    moves,
    partials,
    picks,
    busts,
    nil: result.stats.nil,
    good,
    arrived: run.agents.filter((agent) => agent.arrivedAt <= qrtAt).length,
    leftAtQrt: qrtStanding.length,
    hijacks: hijackers.reduce((sum, agent) => sum + agent.reactions.filter((reaction) => reaction.kind === 'hijack').length, 0),
    hijacksRecovered,
    departures: run.agents.filter((agent) => agent.goneReason && agent.goneReason !== 'never-called' && departedBefore(agent, qrtAt) && !result.contacts.some((contact) => contact.stationId === agent.id && contact.outcome !== 'incomplete')).length,
    waiting: { max: Math.max(0, ...waitSamples), mean: waitSamples.length ? waitSamples.reduce((sum, value) => sum + value, 0) / waitSamples.length : 0 },
    longestDry,
    overlap,
    reactions,
    trace,
    steps,
    score,
    analysis,
    records,
    monitor,
  };
}

/** Left before `at` (from its last 'gone' time, kept as the agent's last activity). */
function departedBefore(agent: CallerAgent, at: number) {
  return agent.goneAt !== null && agent.goneAt <= at;
}

export function tallyOverlap(record: RxRecord, heard: Heard, judged: CharJudgement[], overlap: PileupSimReport['overlap']) {
  const copied = heard.words.join('');
  const spans = record.tx.chars;
  if (copied.length !== spans.reduce((sum, span) => sum + span.char.length, 0)) return;
  // The ear writes each character as one of the same length (a prosign whole), so they line up.
  let at = 0;
  judged.forEach(({ condition, env }, index) => {
    const sent = spans[index].char;
    const right = copied.slice(at, at + sent.length) === sent;
    at += sent.length;
    if (condition === 'muted' || condition === 'unheard') return;
    const bucket = overlap[env.overlap ? bucketOf(env.overlap.n) : '1'];
    bucket.chars += 1;
    bucket.copied += right ? 1 : 0;
    if (env.overlap && condition !== 'qrm') {
      overlap.sub.chars += 1;
      overlap.sub.copied += right ? 1 : 0;
    }
  });
}

/**
 * Every 'selected' follows a transmission of ours delivered this tick that could pick it.
 * A disciplined caller standing by (for a QSO, a partial or our QRX) calls only on our cue;
 * one that also holds for traffic and heard the pick doesn't call into the QSO at all.
 * (A novice-style caller doesn't hold for traffic: a pick that fit nobody it knows of
 * leaves it calling.)
 */
export function checkNotes(notes: AgentNote[], delivered: AirEvent[], run: { agents: readonly CallerAgent[] }, t: number, pickHeardBy: Set<number>, standingBy: Map<number, string | null>, breach: (t: number, kind: string, detail: string) => void) {
  const ours = delivered.filter((event) => event.from === 'me' && event.intent);
  const cue = ours.some((event) => event.intent!.cq || event.intent!.qrz || event.intent!.agn || event.intent!.qrs || event.intent!.partial);
  for (const note of notes) {
    if (!(note.agent instanceof CallerAgent)) continue;
    const agent = note.agent;
    if (note.type === 'selected') {
      const trigger = ours.some((event) => (note.via === 'single' ? Boolean(event.intent!.report) : event.intent!.calls.length > 0));
      if (!trigger) breach(t, 'selected-without-trigger', `${agent.call} via ${note.via}`);
    }
    if (note.type === 'called' && !cue && isDisciplined(agent.manners) && standingBy.get(agent.id) && ours.length === 0) {
      breach(t, 'called-while-standing-by', `${agent.call} (${standingBy.get(agent.id)})`);
    }
    if (note.type === 'called' && !cue && isDisciplined(agent.manners) && agent.manners.holdsForTraffic) {
      const working = run.agents.some((other) => other !== agent && (other.state === 'selected' || other.state === 'exchanged'));
      // (One that never heard the pick — keying at the time — doesn't know of the QSO.)
      if (working && ours.length === 0 && pickHeardBy.has(agent.id)) breach(t, 'called-over-qso', agent.call);
    }
  }
}

/** Reactions only from callers whose manners allow them, and each the kind it claims to be. */
export function checkReactions(agent: CallerAgent, breach: (t: number, kind: string, detail: string) => void) {
  const m = agent.manners;
  for (const reaction of agent.reactions) {
    const { kind, partial } = reaction;
    const allowed = {
      match: true,
      near: m.answersNearPartial > 0,
      hijack: m.answersNearPartial > 0,
      mismatch: m.callsOnMismatch > 0,
      'over-qso': m.callsOverQso > 0,
      'tail-end': m.tailEnd > 0,
      missed: m.missesUs > 0,
    }[kind];
    if (!allowed) breach(reaction.at, 'reaction-not-allowed', `${agent.call} ${kind}`);
    if (kind === 'match' && partial && !matchesPartial(agent.call, partial)) breach(reaction.at, 'match-misclassified', `${agent.call} ${partial}`);
    if (kind === 'near' && partial && !nearPartial(agent.call, partial)) breach(reaction.at, 'near-misclassified', `${agent.call} ${partial}`);
    if (kind === 'mismatch' && partial && matchesPartial(agent.call, partial)) breach(reaction.at, 'mismatch-misclassified', `${agent.call} ${partial}`);
  }
}
