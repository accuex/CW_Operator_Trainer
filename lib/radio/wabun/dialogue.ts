import { TUNE_TOLERANCE_HZ, type QsoIssue } from '../qso';
import { parseWabunIntent, type CorrectionRead, type ReactKind, type WabunIntent } from './intent';
import type { WabunFact, WabunScenario } from './scenario';
import { keySegments } from './segments';
import { plans, renderOver, type OverPlan, type Utterance } from './utterance';

/**
 * One wabun QSO between a station and us, as a state machine over overs.
 *
 * Level 1 (打ち逃げ):
 *   cq        it loops "CQ … ホレ DE <call> … K". We call it (our call, in Latin) → exchange
 *   exchange  it answered short: report in Latin, a greeting (ホレ … ラタ or Latin + PSE ホレ).
 *             We send our phrase: ホレ <a few kana> ラタ, then 73 TU E E → done
 *   done      it signs off (TU 73 E E).
 *
 * Level 2 (和文ラバースタンプ):
 *   cq        as above → exchange
 *   exchange  it sent "<me> DE <call> ホレ greeting, RST, QTH, name ラタ KN".
 *             We reply (a report, thanks or regards; ホレ … ラタ expected but not required) → closing
 *   closing   it sent thanks and goodbye, ラタ, then TU … E E. We send our TU / E E → done
 *   done      it sends E E.
 *
 * Level 3 / 4 (実用 QSO):
 *   cq, exchange as Level 2, but it wants our report (and, some stations, our name): when
 *             our reply did not carry it, it asks once, kindly (RST? / オナマエ サラオネ)
 *             → talk
 *   talk      it thanked us and told one theme (weather or shack; Level 4: and a piece of
 *             news). We answer anything (あいづち, our own news) → closing
 *   closing, done as Level 2.
 *
 * Level 5 (実用 ragchew): as Level 4 (the news always in the talk over unless it runs
 * long), and then one more turn on the same topic:
 *   talk      we respond (an あいづち, liking it, a question, our own side) → chat
 *   chat      it answers how we took it and tells one detail of the news (where, which
 *             colour, when). We respond again → closing
 *   Our responses are kept (`responses`): what kind each was, and whether it touched the
 *   topic. Any response will do; an over with nothing to take is asked for again.
 *
 * Any time: AGN / ? / サラオネ repeats its last over (QRS: slower); at Level 3 / 4 only the
 * part that carries something (the facts of that over, not the greeting). A field asked
 * for (PSE NAME?, RST AGN?, WX?, リグ サラオネ) gets only that fact again, worded the
 * other way each time. Only what it has already told is said again. The states are named
 * for the QSO, not for who called: an NPC that calls our CQ (later) runs the same plans
 * from the other side.
 */

export type WabunPhase = 'cq' | 'exchange' | 'talk' | 'chat' | 'closing' | 'done';

/** How our over was put together, noted but never failed (people do leave the switches out: docs §1.2). */
export type WabunNote = 'no-hore' | 'no-rata' | 'roman-only';

/**
 * What the station took from our over: only what it could read off the air, the body
 * with our corrections applied. It is kept apart from what we typed and what was keyed
 * (see trace.ts); a slip nobody corrected stays a slip, it is just not understood.
 */
export interface WabunUnderstood {
  /** It heard us at all (on frequency). */
  heard: boolean;
  /** Our call reached it in the Latin part. */
  called: boolean;
  report: string | null;
  thanks: boolean;
  closing: boolean;
  /** Kana it read, corrections applied. */
  body: string;
  corrections: CorrectionRead[];
  asked: WabunFact[];
  repeat: boolean;
  qrs: boolean;
  /** Our name, as it read it (Level 3 / 4 thank us by it). */
  name: string | null;
}

/** We asked for something again, and what it sent back. */
export interface WabunRepeat {
  phase: WabunPhase;
  /** The facts we asked for (null: AGN / サラオネ, everything). */
  asked: WabunFact[] | null;
  /** The facts its answer carried (empty: the whole over again, or nothing it had told). */
  resent: WabunFact[];
  over: Utterance;
}

/** It asked us for something it did not get. */
export interface WabunRequest { phase: WabunPhase; facts: WabunFact[]; over: Utterance }

/**
 * Level 3 on: our answer to its talk (and at Level 5 to the chat). `kinds`: how we took
 * it (intent.reacts); `topical`: we touched the news itself (liked it, asked about it,
 * told ours, or named its subject); `ok`: it was a response at all (the conversation
 * went on), not only a sign-off.
 */
export interface WabunResponse { phase: 'talk' | 'chat'; kinds: ReactKind[]; topical: boolean; ok: boolean; body: string }

export interface WabunTxResult {
  phase: WabunPhase;
  /** What the station sends back (null: silence). */
  reply: Utterance | null;
  heard: boolean;
  /** It slows down by this many WPM before replying. */
  slower: number;
  hint: string;
  issue?: QsoIssue;
  notes: WabunNote[];
  intent: WabunIntent;
  understood: WabunUnderstood;
  /** It asked us for these (Level 3 / 4). */
  request: WabunFact[];
  /** Our ask for a repeat, answered (null: we asked nothing). */
  repeat: WabunRepeat | null;
}

export const WABUN_QRS_STEP = 3;
export const WABUN_MIN_WPM = 8;

/** How often it asks again for our report before it goes on without it. */
const RST_ASKS = 2;

/**
 * A Level 4 talk over longer than this (seconds at the station's speed) leaves its news
 * for the closing over: two overs of something to follow rather than one long one. Most
 * talk overs stay whole; the QSO is no longer for it (the closing is sent anyway).
 */
export const TALK_SPLIT_SECONDS = 100;

export class WabunDialogue {
  phase: WabunPhase = 'cq';
  /** Every over the station planned, in order (the CQ once). */
  readonly overs: Utterance[] = [];
  /** The report we gave it, as it read it. */
  theirRst: string | null = null;
  /** Our name as it read it. */
  theirName: string | null = null;
  readonly repeats: WabunRepeat[] = [];
  readonly requests: WabunRequest[] = [];
  /** Level 4: the news was held back from a long talk over and goes in the closing. */
  newsInClosing = false;
  /** Level 5: the same, but it goes in the chat over. */
  newsInChat = false;
  /** Our answers to its talk / chat. */
  readonly responses: WabunResponse[] = [];
  private last: Utterance;
  /** The last over that told something (a repeat refers to it, not to a fill or an ask). */
  private lastContent: Utterance;

  constructor(readonly scenario: WabunScenario, readonly me: string) {
    this.last = renderOver(plans.cq(scenario.truth, scenario.persona.wording));
    this.lastContent = this.last;
    this.overs.push(this.last);
  }

  get truth() { return this.scenario.truth; }
  get level() { return this.scenario.level; }
  /** Level 3 / 4: a practical QSO (a talk over, it asks back). */
  get practical() { return this.level >= 3; }
  /** What it loops while nobody has answered. */
  cqText() { return this.last.plan.kind === 'cq' ? this.last.text : renderOver(plans.cq(this.truth, this.scenario.persona.wording)).text; }

  /** Facts it has sent so far (the only ones it says again). */
  told(): WabunFact[] {
    return [...new Set(this.overs.flatMap((over) => over.facts.map((fact) => fact.fact)))];
  }

  private say(plan: OverPlan) {
    this.last = renderOver(plan);
    this.overs.push(this.last);
    if (plan.kind !== 'fill' && plan.kind !== 'ask') this.lastContent = this.last;
    return this.last;
  }

  /** Our transmission went out; the station answers. */
  onTransmit(text: string, { offsetHz }: { offsetHz: number }): WabunTxResult {
    const intent = parseWabunIntent(text, this.me);
    const notes = notesOf(intent, this.phase, this.level);
    const understood: WabunUnderstood = {
      heard: false, called: intent.roman.mentionsMe, report: intent.report, thanks: intent.ack, closing: intent.closing,
      body: intent.body, corrections: intent.corrections, asked: intent.asks, repeat: intent.repeat, qrs: intent.qrs, name: intent.name,
    };
    const base = { phase: this.phase, reply: null, heard: false, slower: 0, notes, intent, understood, request: [], repeat: null };
    if (!intent.segments.length) return { ...base, notes: [], hint: '送信する文を入れてください' };
    if (Math.abs(offsetHz) > TUNE_TOLERANCE_HZ) {
      return { ...base, issue: 'off-frequency', hint: this.phase === 'cq' ? '応答がありません。相手の信号にぴったり同調してから呼びましょう' : '応答がありません。周波数がずれたようです' };
    }
    const heard: WabunTxResult = { ...base, heard: true, understood: { ...understood, heard: true }, hint: '' };
    const { truth, scenario } = this;
    if (this.phase === 'cq') {
      if (intent.roman.mentionsMe) {
        this.phase = 'exchange';
        if (this.level === 1) {
          return { ...heard, phase: this.phase, reply: this.say(plans.answer(truth, scenario.persona, this.me)), hint: '応答あり。コールと RST を聴いたら、短い和文を送ってみましょう（ホレ … ラタ 73 TU E E）' };
        }
        return { ...heard, phase: this.phase, reply: this.say(plans.exchange(truth, scenario.persona, this.me)), hint: '応答あり。ホレの後が和文です。RST・名前・QTH を聴き取りましょう' };
      }
      if (intent.repeat || intent.qrs) return { ...heard, reply: this.last, hint: 'もう一度 CQ を出してくれます' };
      return { ...heard, issue: 'missing-call', reply: renderOver({ kind: 'cq', head: null, body: null, tail: [`QRZ? DE ${truth.call} K`] }), hint: '自分のコールサインを欧文で入れて呼びましょう（例: 相手 DE 自分 K）' };
    }
    if (this.phase === 'done') return { ...heard, hint: '交信は終わっています。ログを確定しましょう' };
    // Whatever else the over asks for, what it told us of ours is kept.
    if (intent.report) this.theirRst = intent.report;
    if (intent.name) this.theirName = intent.name;
    const slower = intent.qrs ? WABUN_QRS_STEP : 0;
    if (intent.asks.length) {
      const told = this.told();
      const resent = intent.asks.filter((fact) => fact !== 'call' && told.includes(fact));
      if (resent.length) {
        const reply = this.say(plans.fill(truth, this.me, resent, scenario.persona.wording.fill + this.repeats.length));
        return { ...heard, reply, slower, repeat: this.noteRepeat(intent.asks, resent, reply), hint: '聞いたところだけ、もう一度送ってくれます' };
      }
      // Asked for something it never said: the last over again (Level 1 / 2) or its content.
    }
    if (intent.asks.length || intent.repeat || intent.qrs) {
      const content = this.lastContent.facts.map((fact) => fact.fact).filter((fact) => fact !== 'call');
      // Level 3 / 4: the part that carries something; a CQ, an ask or a closing whole.
      const short = this.practical && (['exchange', 'talk', 'chat', 'fill'] as OverPlan['kind'][]).includes(this.last.plan.kind) && content.length > 0;
      const reply = short ? this.say(plans.fill(truth, this.me, [...new Set(content)], scenario.persona.wording.fill + this.repeats.length)) : this.last;
      return {
        ...heard, reply, slower, repeat: this.noteRepeat(intent.asks.length ? intent.asks : null, short ? [...new Set(content)] : [], reply),
        hint: intent.qrs ? '少しゆっくり、もう一度送ってくれます' : short ? '内容のところだけ、もう一度送ってくれます' : 'もう一度送ってくれます',
      };
    }
    if (this.phase === 'exchange' && this.level === 1) {
      // Our phrase (or at least a report / thanks / sign-off): it closes with us.
      if (intent.wabun || intent.unopened || intent.report || intent.ack || intent.closing) {
        this.phase = 'done';
        return { ...heard, phase: this.phase, reply: this.say(plans.farewell1(scenario.persona)), hint: '交信成立。相手の E E を聴いたら、ログを確定しましょう' };
      }
      return { ...heard, issue: 'missing-report', hint: '短い和文を送ってみましょう（例: ホレ アリガトウゴザイマシタ ラタ 73 TU E E）' };
    }
    if (this.phase === 'exchange' && this.practical) {
      // It needs our report; some stations also want our name. Asked kindly, a limited number of times.
      const askedRst = this.requests.filter((request) => request.facts.includes('rst')).length;
      const want: WabunFact[] = !this.theirRst && askedRst < RST_ASKS ? ['rst']
        : !this.theirName && scenario.persona.asksName && !this.requests.some((request) => request.facts.includes('name')) ? ['name'] : [];
      if (want.length) {
        const reply = this.say(plans.ask(truth, this.me, want, scenario.persona.wording.talk + this.requests.length));
        this.requests.push({ phase: this.phase, facts: want, over: reply });
        return {
          ...heard, reply, request: want,
          hint: want[0] === 'rst' ? 'こちらのレポートが届かなかったようです。もう一度 RST を送りましょう' : '名前を聞かれました。ホレ ナマエハ … ラタ で答えましょう',
        };
      }
      this.phase = 'talk';
      const whole = plans.talk(scenario, this.me, this.theirName);
      const split = Boolean(scenario.talk?.topic) && keySegments(renderOver(whole).text, { wpm: scenario.persona.wpm }).length > TALK_SPLIT_SECONDS;
      if (this.level >= 5) this.newsInChat = split;
      else this.newsInClosing = split;
      return {
        ...heard, phase: this.phase, reply: this.say(split ? plans.talk(scenario, this.me, this.theirName, false) : whole),
        hint: this.level >= 5
          ? split
            ? 'お礼のあと、天気か設備の話が来ます（近況は次の電文で来ます）。話題に反応を返しましょう（ナルホド・イイデスネ・FB・コチラモ …）。聞き取れなければ WX AGN? / サラオネ'
            : 'お礼のあと、天気か設備の話と近況が来ます。話題に反応を返しましょう（ナルホド・イイデスネ・タノシソウデスネ・コチラモ …）。聞き取れなければ ナス サラオネ のように聞き返せます'
          : this.level >= 4
          ? this.newsInClosing
            ? 'お礼のあと、天気か設備の話が来ます（近況のひとことは次の締めの電文で来ます）。聞き取れなかった項目は WX AGN? / RIG AGN? / サラオネ で聞き返せます。最後はあいづちを返しましょう'
            : 'お礼のあと、天気か設備の話と、近況のひとことが来ます。聞き取れなかった項目は WX AGN? / RIG AGN? / サラオネ で聞き返せます。最後はあいづちを返しましょう'
          : 'お礼のあと、天気か設備の話が来ます。聞き取れなかった項目は WX AGN? / RIG AGN? / サラオネ で聞き返せます。最後はあいづちを返しましょう',
      };
    }
    if (this.phase === 'exchange') {
      if (intent.report || intent.ack) {
        this.phase = 'closing';
        return { ...heard, phase: this.phase, reply: this.say(plans.closing(truth, scenario.persona, this.me, this.theirRst)), hint: '締めの和文が来ます。ラタの後の TU・E E を聴いたら、こちらも TU E E で終わりましょう' };
      }
      return { ...heard, issue: 'missing-report', hint: 'こちらのレポートを送りましょう（例: ホレ … 599 デス … ラタ）' };
    }
    if ((this.phase === 'talk' || this.phase === 'chat') && this.level >= 5) {
      const responded = intent.ack || Boolean(intent.wabun) || intent.unopened || Boolean(intent.report) || intent.reacts.length > 0;
      if (responded || intent.closing) this.noteResponse(this.phase, intent, responded);
      // Straight to TU / E E: it closes with us (the detail stays untold).
      if (this.phase === 'talk' && responded && !intent.closing) {
        this.phase = 'chat';
        return {
          ...heard, phase: this.phase, reply: this.say(plans.chat(scenario, this.me, reactionTo(intent.reacts), this.newsInChat)),
          hint: 'こちらの反応への返事と、同じ話題のもうひとこと（場所・色・時期など）が来ます。聞き取れなければ サラオネ。最後にもう一度反応を返しましょう',
        };
      }
      if (responded || intent.closing) {
        this.phase = 'closing';
        return { ...heard, phase: this.phase, reply: this.say(plans.closing(truth, scenario.persona, this.me, this.theirRst)), hint: '締めの和文が来ます。ラタの後の TU・E E を聴いたら、こちらも TU E E で終わりましょう' };
      }
      return { ...heard, hint: '話題にひとこと返しましょう（例: ホレ ナルホド タノシソウデスネ ラタ KN）' };
    }
    if (this.phase === 'talk') {
      // Anything that answers it: あいづち, our own news, a report, even straight to TU.
      if (intent.ack || intent.wabun || intent.unopened || intent.report || intent.closing) {
        this.noteResponse('talk', intent, intent.ack || intent.wabun.length > 0 || intent.unopened || Boolean(intent.report) || intent.reacts.length > 0);
        this.phase = 'closing';
        return {
          ...heard, phase: this.phase, reply: this.say(plans.closing(truth, scenario.persona, this.me, this.theirRst, this.newsInClosing)),
          hint: this.newsInClosing
            ? '近況のひとことと締めの和文が来ます。聞き取れなければ サラオネ で締めごともう一度。ラタの後の TU・E E を聴いたら、こちらも TU E E で終わりましょう'
            : '締めの和文が来ます。ラタの後の TU・E E を聴いたら、こちらも TU E E で終わりましょう',
        };
      }
      return { ...heard, hint: 'ひとこと返しましょう（例: ホレ ナルホド イイデスネ ラタ KN）' };
    }
    // closing
    if (intent.closing) {
      this.phase = 'done';
      return { ...heard, phase: this.phase, reply: this.say(plans.farewell()), hint: '交信成立。E E を聴いたら、ログを確定しましょう' };
    }
    return { ...heard, issue: 'missing-report', hint: '最後は TU E E（または TU VA E E）で締めましょう' };
  }

  private noteResponse(phase: 'talk' | 'chat', intent: WabunIntent, ok: boolean) {
    const { topic } = this.truth;
    const named = [topic.subject, topic.detail].some((word) => word && intent.wabun.includes(word));
    const topical = named || intent.reacts.some((kind) => kind === 'praise' || kind === 'question' || kind === 'own');
    this.responses.push({ phase, kinds: intent.reacts, topical, ok, body: intent.body });
  }

  private noteRepeat(asked: WabunFact[] | null, resent: WabunFact[], over: Utterance) {
    const repeat: WabunRepeat = { phase: this.phase, asked, resent, over };
    this.repeats.push(repeat);
    return repeat;
  }
}

/** The response it answers in the chat over: liking it first, then a question, our side, plain thanks / あいづち. */
function reactionTo(kinds: ReactKind[]): ReactKind | null {
  return (['praise', 'question', 'own', 'thanks', 'ack'] as ReactKind[]).find((kind) => kinds.includes(kind)) ?? null;
}

/** Switches left out or never used (advice only). */
function notesOf(intent: WabunIntent, phase: WabunPhase, level: number): WabunNote[] {
  const notes: WabunNote[] = [];
  if (intent.unopened) notes.push('no-hore');
  if (intent.opened && !intent.closed) notes.push('no-rata');
  const taking = level === 1 ? intent.report || intent.ack || intent.closing : intent.report || intent.ack;
  // AGN? / RIG AGN? / QRS in Latin is how one asks: not a reply left in Latin.
  const asking = !intent.wabun && !intent.report && !intent.ack && (intent.repeat || intent.asks.length > 0 || intent.qrs);
  if ((phase === 'exchange' || phase === 'talk' || phase === 'chat') && !intent.opened && !intent.unopened && !asking && (taking || phase === 'talk')) notes.push('roman-only');
  return notes;
}
