import { callDistance, isCallsign, isNearCall } from '../air/intent';
import type { Random } from '../random';
import { EAR_SKILLS, LOST, type EarSkill, type Heard } from './ear';

/**
 * A scripted pileup operator for the headless simulator. It decides from what it
 * copied (PileupEar's Heard — letters, gaps, pitch, loudness), whether anything is
 * keyed in its passband, and its own state; nothing else. It never sees a station, a
 * call it didn't copy, or the run's books, so it can't pick a partial or a station by
 * the right answer.
 *
 *   CQ / QRZ? → listen till the pile has had its say
 *     a call copied whole → "{CALL} 5NN"
 *     only pieces         → "{piece}?"   (a partial)
 *     signals, no letters → "AGN?"
 *     nothing             → "QRZ?"
 *   working: the report back → log it, "TU {MYCALL}"; its call sent back corrected →
 *   resend; nothing copied → "AGN?" twice, the call once more, then on to QRZ?.
 */

export type BotProfileId = 'perfect-ear' | 'skilled' | 'average' | 'novice' | 'loud-first' | 'partial-averse' | 'timing-poor';

export interface BotProfile {
  id: BotProfileId;
  ear: EarSkill;
  /** Seconds it listens at least after its own transmission. */
  minListen: number;
  /** …and how long the passband must then be quiet before it answers (shorter than a word space: it keys into the gaps). */
  quietGap: number;
  /** Calls copied: it picks by then even if the pile is still calling. */
  maxListen: number;
  /** Picks the loudest signal rather than the best-copied call. */
  loudFirst: boolean;
  /** Sends partials at all. */
  partials: boolean;
  /** Chance it notices a reply came from another pitch than the station it called (a hijack) and calls its station again. */
  hijackCheck: number;
  /** Pitch difference it takes for another station, Hz. */
  pitchTolerance: number;
}

const BASE = { minListen: 0.6, quietGap: 1.2, maxListen: 10, loudFirst: false, partials: true, hijackCheck: 0.5, pitchTolerance: 30 };

export const BOT_PROFILES: Record<BotProfileId, BotProfile> = {
  'perfect-ear': { ...BASE, id: 'perfect-ear', ear: EAR_SKILLS.perfect, hijackCheck: 1, pitchTolerance: 12 },
  skilled: { ...BASE, id: 'skilled', ear: EAR_SKILLS.skilled, hijackCheck: 0.9, pitchTolerance: 20 },
  average: { ...BASE, id: 'average', ear: EAR_SKILLS.average },
  novice: { ...BASE, id: 'novice', ear: EAR_SKILLS.novice, minListen: 1, quietGap: 1.6, hijackCheck: 0, pitchTolerance: 60 },
  'loud-first': { ...BASE, id: 'loud-first', ear: EAR_SKILLS.average, loudFirst: true },
  'partial-averse': { ...BASE, id: 'partial-averse', ear: EAR_SKILLS.average, partials: false },
  'timing-poor': { ...BASE, id: 'timing-poor', ear: EAR_SKILLS.average, minListen: 0.25, quietGap: 0.35, maxListen: 3 },
};

export const BOT_IDS = Object.keys(BOT_PROFILES) as BotProfileId[];

/** What the bot can sense at an instant besides what it copied. */
export interface BotSense {
  t: number;
  /** Something is keyed in its passband. */
  carrier: boolean;
  /** Pitches keyed in its passband right now, Hz off its dial (tones it hears — not whose they are). */
  tones?: readonly number[];
  /** Its own transmitter is keyed (or about to be). */
  sending: boolean;
  /** Past the end of the session: finish what is open, start nothing new. */
  qrt: boolean;
}

/** What it decided to do, and why (for the simulator's numbers). */
export type BotMove = 'cq' | 'qrz' | 'call' | 'partial' | 'agn' | 'correct' | 'recall' | 'tu';
export interface BotAction { text: string; move: BotMove; piece?: string; call?: string }
export interface BotLog { call: string; rst: string; at: number }

/** Words that are procedure, not a call or a piece of one. */
const PROCEDURE = new Set(['CQ', 'DE', 'K', 'KN', 'BK', 'R', 'RR', 'TU', 'TNX', '73', 'EE', 'UR', 'NAME', 'QTH', 'PSE', 'RST', 'AGN', 'QRZ', '?', 'GM']);
const RST = /^[1-5][1-9N][1-9N]$/;
/** Seconds of silence after our transmission before it takes the frequency for empty. */
const SILENCE = 5;
/** Seconds it waits for anything at all before asking again. */
const GIVE_UP = 60;
/** Characters a long answer may run to ("R JS2WDR DE JA1ABC UR 579 579 NAME KEN K"), for how long to wait for it. */
const ANSWER_CHARS = 40;
/** Seconds it waits for the station it called once nothing is keyed near that station's pitch. */
const PARTNER_WAIT = 6;
/** Shortest piece worth a partial: two letters fit half the pile. */
const MIN_PIECE = 3;
/** A whole call copied this fresh is answered at once: its sender is listening right now (a pileup never goes quiet). */
const POUNCE = 0.8;
/** A reply may start this much before our transmission ended (we heard its carrier only once we stopped). */
const REPLY_SLACK = 0.3;

/**
 * `charTime`: seconds a character took in the call it sent — how slow a hand it is, and so
 * how long its answer may take (measured per character: a short call says nothing of a long answer).
 */
export interface Partner { call: string; pitch: number; level: number; charTime: number; agn: number; recalls: number; corrections: number }

export class PileupBot {
  readonly logs: BotLog[] = [];
  protected inbox: Heard[] = [];
  protected partner: Partner | null = null;
  protected listenFrom = 0;
  protected lastCarrier = Number.NEGATIVE_INFINITY;
  /** Last time a tone was keyed near the pitch of the station it is working. */
  private lastPartnerTone = Number.NEGATIVE_INFINITY;
  private started = false;
  /** Consecutive transmissions in the pick without progress. */
  protected blind = 0;
  protected partialsInRow = 0;
  protected worked = new Set<string>();

  constructor(readonly profile: BotProfile, protected me: string, protected random: Random) {}

  /** A transmission it copied (as copied). */
  hear(heard: Heard) { this.inbox.push(heard); }

  /** Its own transmission is keyed from `start` to `end`. */
  keyed(end: number) {
    this.listenFrom = end;
    this.inbox = [];
  }

  get working() { return this.partner?.call ?? null; }

  /** What to send now, if anything. */
  act(sense: BotSense): BotAction | null {
    if (sense.carrier) this.lastCarrier = sense.t;
    if (sense.sending) return null;
    if (!this.started) {
      if (sense.qrt) return null;
      this.started = true;
      return { text: this.cqText(), move: 'cq' };
    }
    const { minListen, quietGap, maxListen } = this.profile;
    const since = sense.t - this.listenFrom;
    if (since < minListen) return null;
    const copied = this.inbox.length > 0;
    const quiet = !sense.carrier && sense.t - this.lastCarrier >= quietGap;
    // Nothing copied: wait for the air to go quiet (and a moment more if nothing ever came), or give up waiting.
    const waited = since >= GIVE_UP || (quiet && since >= SILENCE);
    if (this.partner) {
      const { pitch } = this.partner;
      if (sense.tones?.some((tone) => Math.abs(tone - pitch) <= this.profile.pitchTolerance)) this.lastPartnerTone = sense.t;
      // Its answer is in (whoever else is still calling over it).
      const replied = this.inbox.some((item) => this.fromPartner(item, this.partner!));
      // Or nothing has come from its pitch for a while, or for longer than a hand that slow
      // takes to answer: it didn't hear us (or is gone).
      const silent = since >= PARTNER_WAIT && sense.t - this.lastPartnerTone >= quietGap;
      const overdue = since >= Math.min(GIVE_UP, ANSWER_CHARS * this.partner.charTime + PARTNER_WAIT);
      if (!replied && !waited && !silent && !overdue) return null;
    } else if (copied ? !quiet && since < maxListen && !this.pounce(sense.t) : !waited) return null;
    return this.partner ? this.work(this.partner, sense) : this.pick(sense);
  }

  protected pick(sense: BotSense): BotAction | null {
    if (sense.qrt) return null;
    const heard = this.inbox;
    const calls = this.callsIn(heard);
    if (calls.length) {
      const best = calls[0];
      this.partner = { call: best.call, pitch: best.pitch, level: best.level, charTime: best.charTime, agn: 0, recalls: 0, corrections: 0 };
      this.blind = 0;
      this.partialsInRow = 0;
      return { text: this.callText(best.call), move: 'call', call: best.call };
    }
    const pieces = this.piecesIn(heard);
    if (pieces.length && this.profile.partials && this.partialsInRow < 3) {
      this.partialsInRow += 1;
      this.blind = 0;
      return { text: `${pieces[0].piece}?`, move: 'partial', piece: pieces[0].piece };
    }
    this.partialsInRow = 0;
    const something = heard.length > 0 || this.lastCarrier >= this.listenFrom;
    if (something && this.blind < 2) {
      this.blind += 1;
      return { text: 'AGN?', move: 'agn' };
    }
    this.blind = 0;
    return { text: 'QRZ?', move: 'qrz' };
  }

  protected work(partner: Partner, sense: BotSense): BotAction | null {
    const heard = this.inbox;
    const tolerance = this.profile.pitchTolerance;
    const fromPartner = heard.filter((item) => this.fromPartner(item, partner));
    const elsewhere = heard.filter((item) => !fromPartner.includes(item));
    const report = fromPartner.flatMap((item) => item.words).find((word) => RST.test(word));
    // Its call sent back to us, not quite what we sent: a correction (with or without its report).
    const corrected = this.callsIn(fromPartner).find((item) => item.call !== partner.call && isNearCall(partner.call, item.call));
    if (corrected && partner.corrections < 2) {
      partner.corrections += 1;
      partner.call = corrected.call;
      return { text: this.callText(partner.call), move: 'correct', call: partner.call };
    }
    const reportElsewhere = elsewhere.find((item) => item.words.some((word) => RST.test(word)));
    if (!report && reportElsewhere) {
      if (partner.recalls < 1 && this.random() < this.profile.hijackCheck) {
        // A report back from another pitch than the one we called: someone took the call. Call ours again.
        partner.recalls += 1;
        return { text: this.callText(partner.call), move: 'recall', call: partner.call };
      }
    }
    const taken = report ?? (reportElsewhere && this.profile.hijackCheck < 1 ? reportElsewhere.words.find((word) => RST.test(word)) : undefined);
    if (taken) {
      this.logs.push({ call: partner.call, rst: taken.replace(/N/g, '9'), at: sense.t });
      this.worked.add(partner.call);
      this.partner = null;
      return { text: `TU ${this.me}`, move: 'tu', call: partner.call };
    }
    // Its call again and nothing else: it never heard us call it. Call it again.
    const stillCalling = this.callsIn(fromPartner).some((item) => item.call === partner.call);
    if (stillCalling && partner.recalls < 2) {
      partner.recalls += 1;
      return { text: this.callText(partner.call), move: 'recall', call: partner.call };
    }
    if (partner.agn < 2) {
      partner.agn += 1;
      return { text: 'AGN?', move: 'agn' };
    }
    if (partner.recalls < 1) {
      partner.recalls += 1;
      return { text: this.callText(partner.call), move: 'recall', call: partner.call };
    }
    this.partner = null;
    if (sense.qrt) return null;
    return { text: 'QRZ?', move: 'qrz' };
  }

  /** Our CQ. */
  protected cqText() { return `CQ DE ${this.me} ${this.me} K`; }

  /** Calling a station (and sending it our exchange). */
  protected callText(call: string) { return `${call} 5NN`; }

  /** Near enough the pitch of the station we called to be it — and not plainly someone else calling. */
  protected fromPartner(item: Heard, partner: Partner) {
    // An answer starts after we stopped; whatever began before is someone still calling.
    if (item.start < this.listenFrom - REPLY_SLACK || Math.abs(item.pitch - partner.pitch) > this.profile.pitchTolerance) return false;
    // A whole call that isn't ours, the partner's or near it: another station on that pitch.
    return !mergeRepeats(item.words).some((word) => !word.includes(LOST) && this.isCall(word) && !this.isMine(word) && word !== partner.call && !isNearCall(partner.call, word));
  }

  /** A whole call has just ended: answer before its sender calls again. */
  private pounce(t: number) {
    return this.callsIn(this.inbox.filter((item) => t - item.end <= POUNCE)).length > 0;
  }

  /** Whole calls copied (none of ours, none worked already), best first. */
  protected callsIn(heard: readonly Heard[]) {
    const found = new Map<string, { call: string; copies: number; pitch: number; level: number; charTime: number }>();
    for (const item of heard) {
      for (const word of mergeRepeats(item.words)) {
        if (word.includes(LOST) || !this.isCall(word) || this.isMine(word) || this.worked.has(word)) continue;
        const entry = found.get(word);
        if (entry) {
          entry.copies += 1;
          entry.level = Math.max(entry.level, item.level);
        } else found.set(word, { call: word, copies: 1, pitch: item.pitch, level: item.level, charTime: (item.end - item.start) / Math.max(1, item.words.join(' ').length) });
      }
    }
    return [...found.values()].sort((a, b) => (this.profile.loudFirst ? b.level - a.level : b.copies - a.copies || b.level - a.level));
  }

  /** Copied pieces of calls (MIN_PIECE+ letters in a row), longest first (loud-first: from the loudest). */
  protected piecesIn(heard: readonly Heard[]) {
    const pieces: { piece: string; level: number; score: number }[] = [];
    for (const item of heard) {
      for (const word of mergeRepeats(item.words)) {
        if (PROCEDURE.has(word) || RST.test(word) || word.startsWith('[') || this.isMine(word)) continue;
        for (const run of word.split(LOST)) {
          if (run.length < MIN_PIECE || PROCEDURE.has(run) || RST.test(run) || this.isMine(run)) continue;
          // A piece with the area digit narrows a pile best.
          pieces.push({ piece: run, level: item.level, score: run.length + (/[0-9]/.test(run) ? 1 : 0) });
        }
      }
    }
    return pieces.sort((a, b) => (this.profile.loudFirst ? b.level - a.level || b.score - a.score : b.score - a.score || b.level - a.level));
  }

  /** A word that is a call (a mode may read some call-shaped words as something else). */
  protected isCall(word: string) { return isCallsign(word); }

  /** Our own call, or near enough that it is ours miscopied (callers send it). */
  protected isMine(word: string) {
    if (word === this.me) return true;
    if (word.length >= 4 && Math.abs(word.length - this.me.length) <= 1 && callDistance(word.replaceAll(LOST, '?'), this.me) <= 2) return true;
    return word.length >= 3 && this.me.includes(word);
  }
}

/**
 * A call sent twice in one go, copied twice: letters one copy lost the other may have.
 * Where both copies have a letter and they differ, it is lost (we can't tell which is right).
 */
export function mergeRepeats(words: readonly string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const next = words[index + 1];
    if (next && next.length === word.length && word.length >= 3 && compatible(word, next)) {
      out.push([...word].map((char, at) => {
        const other = next[at];
        if (char === LOST) return other;
        if (other === LOST || other === char) return char;
        return LOST;
      }).join(''));
      index += 1;
    } else out.push(word);
  }
  return out;
}

/** Two copies of the same word: where both have a letter they mostly agree. */
function compatible(a: string, b: string) {
  let both = 0;
  let same = 0;
  for (let at = 0; at < a.length; at += 1) {
    if (a[at] === LOST || b[at] === LOST) continue;
    both += 1;
    if (a[at] === b[at]) same += 1;
  }
  return both === 0 ? true : same / both >= 0.6;
}
