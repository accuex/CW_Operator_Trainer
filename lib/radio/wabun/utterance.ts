import { parseSegments, renderSegments, type Segment } from './segments';
import type { ReactKind } from './intent';
import type { Greeting, TopicTruth, WabunFact, WabunPersona, WabunScenario, WabunTruth, WabunWording } from './scenario';

/**
 * scenario truth → utterance plan → rendered CW.
 *
 * A plan says what an over tells (acts that carry facts), with no wording; rendering
 * turns it into segments. The wording is the wabun rubber stamp of the sources
 * (JF0RRH's template, JA3PUA's transcripts: docs/wabun-qso-design.md §1.1, §1.4), a
 * few stock phrasings per station (WabunWording); topics come later on the same plans.
 *
 * Overs are kept short for learners: each fact said once or twice, no greeting or
 * thanks that only lengthens the over, calls in the Latin head only where the sources
 * allow it (KN after ラタ). Shorter text first, not a faster key.
 */

export type Act =
  | { act: 'greet'; greeting: Greeting }
  | { act: 'thanks'; for: 'call' | 'qso' | 'short' | 'brief' }
  /** Thanks for the report they gave us (their RST when we read one). */
  | { act: 'thanks-report'; rst: string | null }
  /** "Here in <city> you are <rst>": the report and our QTH in one sentence (JF0RRH). */
  | { act: 'report'; rst: string; qth: string; qthSuffix: string }
  /** `style` picks the stock phrasing; `ask`: said with "?" then again (JA3PUA's way of making a name stick). */
  | { act: 'name'; name: string; style?: number; ask?: boolean }
  | { act: 'qth'; qth: string; qthSuffix: string; style?: number }
  | { act: 'rst'; rst: string; style?: number }
  | { act: 'regards'; style?: number }
  | { act: 'goodbye'; closing73: WabunPersona['closing73']; style?: number }
  /** Level 3 / 4: one fact of the weather or the shack, said in a short phrase. */
  | { act: 'wx'; sky: string; style?: number }
  | { act: 'temp'; temp: number; style?: number }
  | { act: 'condx'; condx: string; style?: number }
  | { act: 'rig'; rig: string; style?: number }
  | { act: 'ant'; ant: string; style?: number }
  | { act: 'pwr'; pwr: number; style?: number }
  | { act: 'key'; key: string; style?: number }
  /** Level 4: one piece of news, one sentence from the topic truth. */
  | { act: 'topic'; topic: TopicTruth; style?: number }
  /** Level 5: one more thing about the news (topic.detail), in the next over. */
  | { act: 'detail'; topic: TopicTruth; style?: number }
  /** Level 5: its answer to how we took the news (glad we liked it, interested in ours). */
  | { act: 'react'; to: ReactKind }
  /** Thanks to us by the name it read ("ヤマダサン アリガトウ"), or plain thanks. */
  | { act: 'thanks-name'; name: string | null }
  /** It did not get this from us and asks for it (NAME? / レポート サラオネ). */
  | { act: 'ask'; fact: WabunFact }
  /** 」: the paragraph sign between topics. */
  | { act: 'paragraph' };

/** Latin text, or a Latin word that carries a fact (the report in "UR 579 579"). */
export type Roman = string | { text: string; fact: WabunFact; value: string };

/**
 * One over. `kind` names its place in the QSO, not who sends it: an NPC answering us
 * and (later) an NPC calling our CQ plan the same kinds.
 */
export interface OverPlan {
  kind: 'cq' | 'exchange' | 'talk' | 'chat' | 'closing' | 'farewell' | 'fill' | 'ask';
  /** Latin before the body: "<to> DE <from>", or a CQ. */
  head: { to: string; from: string } | { cq: string } | null;
  /** The wabun body between ホレ and ラタ (null: none). */
  body: Act[] | null;
  /** Latin after ラタ (or the whole over without a body). */
  tail: Roman[];
}

/** A fact as it went out: which word of the over carries it (control signs count as words). */
export interface PlacedFact { fact: WabunFact; value: string; word: number }

export interface Utterance {
  plan: OverPlan;
  segments: Segment[];
  /** The notation (segments.ts), what the station's queue holds. */
  text: string;
  facts: PlacedFact[];
}

const GREETING: Record<Greeting, string> = { morning: 'オハヨウゴザイマス', day: 'コンニチハ', evening: 'コンバンハ' };
const LATIN_GREETING: Record<Greeting, string> = { morning: 'GM', day: 'GA', evening: 'GE' };

type Word = [string, (WabunFact | null)?, string?];
const pickOf = <T,>(list: T[], style = 0) => list[style % list.length];

/** Words of one act; a fact's word is marked. */
function wordsOf(act: Act): Word[] {
  switch (act.act) {
    case 'greet': return [[GREETING[act.greeting]]];
    case 'thanks': return act.for === 'call' ? [['コール'], ['アリガトウ']]
      : act.for === 'qso' ? [['コウシン'], ['アリガトウゴザイマシタ']] : act.for === 'short' ? [['アリガトウゴザイマシタ']] : [['アリガトウ']];
    case 'thanks-report': return act.rst ? [[act.rst], ['アリガトウ']] : [['レポート'], ['アリガトウ']];
    case 'report': return [['コチラ'], [`${act.qth}${act.qthSuffix}`, 'qth', act.qth], ['ニ'], [act.rst, 'rst', act.rst], [act.rst, 'rst', act.rst], ['デ'], ['キテイマス']];
    case 'name': {
      const name: Word = [act.ask ? `${act.name}?` : act.name, 'name', act.name];
      const again: Word = [act.name, 'name', act.name];
      return pickOf<Word[]>([[['ナマエハ'], name, again], [name, again, ['デス']]], act.style);
    }
    case 'qth': {
      const city: Word = [`${act.qth}${act.qthSuffix}`, 'qth', act.qth];
      return pickOf<Word[]>([[['コチラハ'], city], [['コチラ'], city, ['デス']], [city, ['カラ'], ['デス']]], act.style);
    }
    case 'rst': {
      const rst: Word = [act.rst, 'rst', act.rst];
      return pickOf<Word[]>([[['レポート'], rst, [act.rst, 'rst', act.rst]], [rst, [act.rst, 'rst', act.rst], ['デス']]], act.style);
    }
    case 'regards': return pickOf<Word[]>([[], [['ヨロシク']]], act.style);
    case 'goodbye': {
      const again = pickOf<Word[]>([[], [['マタ'], ['ヨロシク']]], act.style);
      return act.closing73 === 'inside' ? [...again, ['デハ'], ['73']] : [...again, ['サヨウナラ']];
    }
    case 'wx': return pickOf<Word[]>([[['テンキハ'], [act.sky, 'wx', act.sky]], [['コチラハ'], [act.sky, 'wx', act.sky], ['デス']]], act.style);
    case 'temp': return pickOf<Word[]>([[['キオンハ'], [`${act.temp}ド`, 'temp', `${act.temp}`]], [['キオン'], [`${act.temp}ド`, 'temp', `${act.temp}`], ['クライ']]], act.style);
    case 'condx': return pickOf<Word[]>([[['コンデイシヨンハ'], [act.condx, 'condx', act.condx], ['デス']], [['バンドノ'], ['コンデイシヨン'], [act.condx, 'condx', act.condx]]], act.style);
    // A model name goes out in Latin between parentheses (each parenthesis a word of its own).
    case 'rig': return pickOf<Word[]>([[['リグハ'], ['（'], [act.rig, 'rig', act.rig], ['）'], ['デス']], [['リグ'], ['（'], [act.rig, 'rig', act.rig], ['）'], ['ヲ'], ['ツカツテイマス']]], act.style);
    case 'ant': return pickOf<Word[]>([[['アンテナハ'], [act.ant, 'ant', act.ant], ['デス']], [['アンテナ'], [act.ant, 'ant', act.ant]]], act.style);
    case 'pwr': return pickOf<Word[]>([[['パワーハ'], [`${act.pwr}`, 'pwr', `${act.pwr}`], ['ワツト']], [['パワー'], ['（'], [`${act.pwr}W`, 'pwr', `${act.pwr}`], ['）'], ['デス']]], act.style);
    case 'key': return pickOf<Word[]>([[['キーハ'], [act.key, 'key', act.key], ['デス']], [['キー'], [act.key, 'key', act.key], ['ヲ'], ['ツカツテイマス']]], act.style);
    case 'topic': return topicWords(act.topic, act.style);
    case 'detail': return detailWords(act.topic, act.style);
    case 'react': return REACT_WORDS[act.to];
    case 'thanks-name': return act.name ? [[`${act.name}サン`], ['アリガトウ']] : [['アリガトウ']];
    case 'ask': return askWords(act.fact);
    case 'paragraph': return [['」']];
  }
}

/**
 * One piece of news as a sentence, the subject in a word of its own (with its particle).
 * Two phrasings per kind; the stage decides the tense (planned, done, going on).
 */
function topicWords({ kind, subject }: TopicTruth, style = 0): Word[] {
  const s = (suffix = ''): Word => [`${subject}${suffix}`, 'topic', subject];
  const sentences: Record<TopicTruth['kind'], Word[][]> = {
    walk: [[['ケサハ'], s('マデ'), ['サンポ'], ['シマシタ']], [['キノウ'], s('ヲ'), ['アルキマシタ']]],
    shopping: [[['キノウ'], s('ヲ'), ['カイマシタ']], [['アタラシイ'], s('ヲ'), ['カイマシタ']]],
    garden: [[['ニワデ'], s('ヲ'), ['ソダテテイマス']], [['コトシモ'], s('ヲ'), ['ウエマシタ']]],
    trip: [[['ライシユウ'], s('ヘ'), ['リヨコウデス']], [['コンド'], s('ニ'), ['イキマス']]],
    family: [[['ニチヨウハ'], s('ト'), ['シヨクジデス']], [['コンシユウ'], s('ガ'), ['キマス']]],
    season: [[['コチラハ'], s('ガ'), ['キレイデス']], [['イマ'], s('ガ'), ['ミゴロデス']]],
    hobby: [[['サイキン'], s('ヲ'), ['ハジメマシタ']], [s('ヲ'), ['ハジメテ'], ['タノシイデス']]],
  };
  return pickOf(sentences[kind], style);
}

/**
 * Level 5: the detail of the news in a sentence, the detail in a word of its own (with
 * its particle), two phrasings per kind.
 */
function detailWords({ kind, detail = '' }: TopicTruth, style = 0): Word[] {
  const d = (suffix = ''): Word => [`${detail}${suffix}`, 'detail', detail];
  const sentences: Record<TopicTruth['kind'], Word[][]> = {
    walk: [[['トチユウデ'], d('ヲ'), ['ミマシタ']], [['ミチデ'], d('ヲ'), ['ミカケマシタ']]],
    shopping: [[['イロハ'], d(), ['デス']], [d('イロヲ'), ['エラビマシタ']]],
    garden: [[d('ゴロ'), ['シユウカク'], ['デス']], [['シユウカクハ'], d(), ['デス']]],
    trip: [[d('デ'), ['イキマス']], [['イキハ'], d(), ['デス']]],
    family: [[['ミンナデ'], d('ヲ'), ['タベマス']], [['ヨルハ'], d(), ['ノ'], ['ヨテイ']]],
    season: [[d('デ'), ['ミラレマス']], [['バシヨハ'], d(), ['デス']]],
    hobby: [[d('ニ'), ['ヤツテイマス']], [['イツモ'], d(), ['デス']]],
  };
  return pickOf(sentences[kind], style);
}

/** How it takes our response to its news: short, and nothing at all for a plain あいづち. */
const REACT_WORDS: Record<ReactKind, Word[]> = {
  praise: [['アリガトウ'], ['ウレシイデス']],
  own: [['ソウデスカ'], ['イイデスネ']],
  question: [['ハイ']],
  thanks: [],
  ack: [],
};

/** It asks for one fact it did not get from us, in kana (QTH in Latin between parentheses). */
function askWords(fact: WabunFact): Word[] {
  return fact === 'name' ? [['オナマエ'], ['サラオネ']] : fact === 'qth' ? [['（'], ['QTH'], ['）'], ['サラオネ']] : [['レポート'], ['サラオネ']];
}

/** A fact said again on request, in the style given (it alternates on each repeat). */
export function factActs(truth: WabunTruth, fact: WabunFact, style = 0): Act[] {
  const { weather, shack } = truth;
  switch (fact) {
    case 'name': return [{ act: 'name', name: truth.name, ask: style % 2 === 0, style }];
    case 'qth': return [{ act: 'qth', qth: truth.qth, qthSuffix: truth.qthSuffix, style: style % 2 === 0 ? 0 : 2 }];
    case 'rst': return [{ act: 'rst', rst: truth.rst, style }];
    case 'wx': return [{ act: 'wx', sky: weather.sky, style }];
    case 'temp': return [{ act: 'temp', temp: weather.temp, style }];
    case 'condx': return [{ act: 'condx', condx: weather.condx, style }];
    case 'rig': return [{ act: 'rig', rig: shack.rig, style }];
    case 'ant': return [{ act: 'ant', ant: shack.ant, style }];
    case 'pwr': return [{ act: 'pwr', pwr: shack.pwr, style }];
    case 'key': return [{ act: 'key', key: shack.key, style }];
    case 'topic': return [{ act: 'topic', topic: truth.topic, style }];
    case 'detail': return truth.topic.detail ? [{ act: 'detail', topic: truth.topic, style }] : [];
    case 'call': return [];
  }
}

/** Plan → segments, notation and where each fact went. */
export function renderOver(plan: OverPlan): Utterance {
  const notation: string[] = [];
  const facts: PlacedFact[] = [];
  let word = 0;
  const roman = (part: Roman) => {
    const text = typeof part === 'string' ? part : part.text;
    const words = text.split(/\s+/).filter(Boolean);
    if (typeof part !== 'string') words.forEach((_, index) => facts.push({ fact: part.fact, value: part.value, word: word + index }));
    notation.push(...words);
    word += words.length;
  };
  if (plan.head) roman('cq' in plan.head ? plan.head.cq : `${plan.head.to} DE ${plan.head.from}`);
  if (plan.body) {
    notation.push('[ホレ]');
    word += 1;
    for (const act of plan.body) {
      for (const [text, fact, value] of wordsOf(act)) {
        if (fact && value) facts.push({ fact, value, word });
        notation.push(text);
        word += 1;
      }
    }
    notation.push('[ラタ]');
    word += 1;
  }
  for (const part of plan.tail) roman(part);
  const text = notation.join(' ');
  const segments = parseSegments(text);
  return { plan, segments, text: renderSegments(segments), facts };
}

const rstWord = (rst: string): Roman => ({ text: rst, fact: 'rst', value: rst });

/** The station's overs, planned from its truth and persona. `me` is whoever it is talking to. */
export const plans = {
  cq: (truth: WabunTruth, wording?: WabunWording): OverPlan => ({
    kind: 'cq', head: { cq: wording?.cq ? 'CQ CQ CQ' : 'CQ' }, body: null,
    // "CQ CQ CQ ホレ DE …" (JA3PUA), "CQ ホレ DE … PSE ホレ K" (JF0RRH): ホレ here asks for wabun, it switches nothing.
    tail: [wording?.cq ? `<ホレ> DE ${truth.call} ${truth.call} K` : `<ホレ> DE ${truth.call} ${truth.call} PSE <ホレ> K`],
  }),

  /**
   * Level 1, its answer to our call: the report in Latin and a greeting, short. Either a
   * one-word body (ホレ コンニチハ ラタ, the switch heard once before we try it) or Latin
   * only with an invitation (PSE ホレ).
   */
  answer: (truth: WabunTruth, persona: WabunPersona, me: string): OverPlan => (persona.wording.answer % 2 === 0
    ? { kind: 'exchange', head: { to: me, from: truth.call }, body: [{ act: 'greet', greeting: truth.greeting }], tail: ['UR', rstWord(truth.rst), rstWord(truth.rst), 'BK'] }
    : { kind: 'exchange', head: { to: me, from: truth.call }, body: null, tail: [LATIN_GREETING[truth.greeting], 'UR', rstWord(truth.rst), rstWord(truth.rst), 'PSE <ホレ> BK'] }),

  /** Level 1, after our phrase: thanks and E E (in Latin, or a word of kana first). */
  farewell1: (persona: WabunPersona): OverPlan => (persona.wording.farewell % 2 === 0
    ? { kind: 'farewell', head: null, body: null, tail: ['TU 73 E E'] }
    : { kind: 'farewell', head: null, body: [{ act: 'thanks', for: 'brief' }], tail: ['TU E E'] }),

  /** Level 2, its first over: greeting, RST, QTH, name; KN after ラタ (the head carries the calls). */
  exchange: (truth: WabunTruth, persona: WabunPersona, me: string): OverPlan => {
    const { wording } = persona;
    const greet: Act = { act: 'greet', greeting: truth.greeting };
    const regards: Act = { act: 'regards', style: wording.regards };
    const qth = { qth: truth.qth, qthSuffix: truth.qthSuffix };
    const body: Act[] = [
      // JF0RRH: "コチラ ○○シ ニ 599 デ キテイマス ナマエハ …"
      [greet, { act: 'paragraph' }, { act: 'report', rst: truth.rst, ...qth }, { act: 'name', name: truth.name }],
      // JA3PUA: the name with "?" and again.
      [greet, { act: 'paragraph' }, { act: 'rst', rst: truth.rst, style: 1 }, { act: 'qth', ...qth }, { act: 'name', name: truth.name, style: 1, ask: true }, regards],
      [greet, { act: 'paragraph' }, { act: 'rst', rst: truth.rst }, { act: 'name', name: truth.name }, { act: 'qth', ...qth, style: 2 }, regards],
    ][wording.exchange % 3] as Act[];
    return { kind: 'exchange', head: { to: me, from: truth.call }, body, tail: ['KN'] };
  },

  /**
   * Level 2, its last over: thanks, goodbye, ラタ, TU … E E (73 inside or after, by
   * persona). `news`: Level 4 news held back from a talk over that would have run long,
   * told first here and set off with 」 (the talk over and this one carry it in two).
   */
  closing: (truth: WabunTruth, persona: WabunPersona, me: string, theirRst: string | null, news = false): OverPlan => ({
    kind: 'closing', head: { to: me, from: truth.call },
    body: [
      ...(news ? [...factActs(truth, 'topic', persona.wording.talk), { act: 'paragraph' } as Act] : []),
      ...(persona.wording.closing % 2 === 0
        ? [{ act: 'thanks-report', rst: theirRst }, { act: 'goodbye', closing73: persona.closing73 }] as Act[]
        : [{ act: 'thanks', for: 'brief' }, { act: 'goodbye', closing73: persona.closing73, style: 1 }] as Act[]),
    ],
    // JF0RRH: "… デハ 73 ラタ … TU VA E E"; JA3PUA: "… サヨウナラ ラタ … 73 TU TU VA E E" (shortened to one TU).
    tail: [persona.closing73 === 'inside' ? 'TU VA E E' : '73 TU E E'],
  }),
  farewell: (): OverPlan => ({ kind: 'farewell', head: null, body: null, tail: ['E E'] }),
  /**
   * Level 3 / 4, its second over: thanks (by our name if it read one), then the theme in
   * two short phrases, and at Level 4 one sentence of news after a 」. No greeting again,
   * no padding: content to follow, not text to memorise. `news: false` leaves the news
   * for the closing over (a long one split in two).
   */
  talk: (scenario: WabunScenario, me: string, ourName: string | null, news = true): OverPlan => {
    const { truth, persona, talk } = scenario;
    const style = persona.wording.talk;
    const body: Act[] = [{ act: 'thanks-name', name: ourName }, { act: 'paragraph' }];
    for (const fact of talk?.facts ?? []) body.push(...factActs(truth, fact, style));
    if (talk?.topic && news) body.push({ act: 'paragraph' }, ...factActs(truth, 'topic', style));
    return { kind: 'talk', head: { to: me, from: truth.call }, body, tail: ['KN'] };
  },

  /**
   * Level 5, the turn after our response: its answer to how we took the news (one of
   * REACT_WORDS, or nothing for a plain あいづち), then one detail of the same topic. The
   * news itself comes here first when the talk over held it back (`news`). One topic,
   * one more over: not a conversation without end.
   */
  chat: (scenario: WabunScenario, me: string, reaction: ReactKind | null, news = false): OverPlan => {
    const { truth, persona } = scenario;
    const style = persona.wording.talk;
    const react: Act[] = reaction && REACT_WORDS[reaction].length ? [{ act: 'react', to: reaction }, { act: 'paragraph' }] : [];
    const body: Act[] = [...react, ...(news ? factActs(truth, 'topic', style) : []), ...factActs(truth, 'detail', style)];
    return { kind: 'chat', head: { to: me, from: truth.call }, body, tail: ['KN'] };
  },

  /**
   * Just the facts asked for, again: the short phrase that carries each, worded the
   * other way on each repeat (`style`). Style 0 is the Stage 2 wording.
   */
  fill: (truth: WabunTruth, me: string, asked: WabunFact[], style = 0): OverPlan => ({
    kind: 'fill', head: { to: me, from: truth.call },
    body: asked.flatMap((fact) => factActs(truth, fact, style)),
    tail: ['KN'],
  }),

  /**
   * It asks us for what it did not get (Level 3 / 4, kindly and once per fact): in kana
   * ("オナマエ サラオネ") or in Latin ("PSE NAME? KN"), by its persona.
   */
  ask: (truth: WabunTruth, me: string, facts: WabunFact[], style = 0): OverPlan => (style % 2 === 0
    ? { kind: 'ask', head: { to: me, from: truth.call }, body: facts.map((fact): Act => ({ act: 'ask', fact })), tail: ['KN'] }
    : { kind: 'ask', head: { to: me, from: truth.call }, body: null, tail: [`PSE ${facts.map((fact) => `${fact === 'name' ? 'NAME' : fact === 'qth' ? 'QTH' : 'RST'}?`).join(' ')} KN`] }),
};
