import { JA_PREFIX, RST } from '../qso';
import { randomSuffix } from '../band';
import { fistKindOf, KEY_OF_FIST, makeFist, type FistKind, type WabunFist } from './fist';

/**
 * What a wabun station means to tell us this QSO, decided before a word is sent. The
 * utterance plan and the rendered CW come from this (utterance.ts), so a repeat, a
 * rewording or a later "did you follow it?" check all refer to the same facts.
 *
 * Kept open on purpose: the truth is the facts a QSO can carry, the persona how a
 * station tells them. A station has weather, a station set-up and a bit of news, but a
 * QSO tells only what its level plans (`talk`): the rubber stamp's four, one theme
 * (Level 3), one short everyday topic (Level 4). Later stages add facts and persona
 * traits (topics it likes, a regular's history) beside these.
 */

export type Greeting = 'morning' | 'day' | 'evening';

/**
 * 1: 打ち逃げ — call a CQ ホレ, one short kana phrase of ours, back to Latin, done.
 * 2: 和文ラバースタンプ — greeting, RST, QTH, name and the close, short overs.
 * 3: 実用 QSO — the rubber stamp, then one theme: the weather or the station set-up.
 * 4: 実用 QSO ＋ 近況 — as 3, and one short piece of everyday news.
 * 5: 実用 ragchew — as 4, then a turn more on the same topic: it answers our response
 *    and adds one detail (where, what colour, when). One topic per QSO, a set length; the
 *    station keys with its own fist (fist.ts).
 */
export type WabunLevel = 1 | 2 | 3 | 4 | 5;
export const WABUN_LEVELS: WabunLevel[] = [1, 2, 3, 4, 5];

/** Facts a station can tell. A QSO tells some of them (scenarioFacts). */
export type WabunFact = 'call' | 'rst' | 'name' | 'qth' | 'wx' | 'temp' | 'condx' | 'rig' | 'ant' | 'pwr' | 'key' | 'topic' | 'detail';

/** The facts of the exchange every level from 2 on starts with (the log's fields). */
export const LEVEL_FACTS: Record<WabunLevel, WabunFact[]> = { 1: ['call', 'rst'], 2: ['call', 'rst', 'name', 'qth'], 3: ['call', 'rst', 'name', 'qth'], 4: ['call', 'rst', 'name', 'qth'], 5: ['call', 'rst', 'name', 'qth'] };

export type Sky = 'ハレ' | 'クモリ' | 'アメ' | 'ユキ';
export const SKIES: Sky[] = ['ハレ', 'クモリ', 'アメ', 'ユキ'];
export const CONDX = ['ヨイ', 'マアマア', 'イマイチ'] as const;
/** Rig models go out in Latin, in parentheses (リグハ （ IC7300 ） デス). */
export const RIGS = ['IC7300', 'FT991', 'TS590', 'IC705', 'FT710', 'TS890'] as const;
export const ANTENNAS = ['ダイポール', 'バーチカル', 'ループ', 'ヤギ'] as const;
export const POWERS = [5, 10, 20, 50, 100] as const;
export const KEYS = ['ストレート', 'バグ', 'パドル', 'エレキー'] as const;

/** The station's day and shack: all of it is true, a QSO tells only what `talk` picks. */
export interface WabunWeather { sky: Sky; temp: number; condx: (typeof CONDX)[number] }
export interface WabunShack { rig: string; ant: string; pwr: number; key: string }

/**
 * One piece of everyday news, decided before the QSO. `subject` is the fact a listener
 * should take away (what was bought, where the walk went).
 *
 * `stage` is where the event stands: 'preview' (planned: 来週 旅行), 'result' (done:
 * 昨日 買った), 'ongoing' (育てている). A resident's life later moves one event through
 * event → preview → result → follow-up across QSOs; here a QSO holds one fixed stage.
 */
export type TopicKind = 'walk' | 'shopping' | 'garden' | 'trip' | 'family' | 'season' | 'hobby';
export interface TopicTruth {
  kind: TopicKind;
  subject: string;
  stage: 'preview' | 'result' | 'ongoing';
  /** Level 5: one more thing about it, told in the next over (what it saw on the walk, the colour, when …). */
  detail?: string;
}

/** Subjects per topic kind (fictional, everyday; no real person or place beyond a region name). */
export const TOPIC_SUBJECTS: Record<TopicKind, string[]> = {
  walk: ['カワラ', 'コウエン', 'ウミベ', 'ヤマミチ'],
  shopping: ['クツ', 'ホンダナ', 'ジテンシヤ', 'フライパン'],
  garden: ['トマト', 'ナス', 'キユウリ', 'バラ'],
  trip: ['オンセン', 'オキナワ', 'ナガサキ', 'ホツカイドウ'],
  family: ['ムスメ', 'ムスコ', 'アニ', 'イモウト'],
  season: ['サクラ', 'モミジ', 'アジサイ', 'ツツジ'],
  hobby: ['シヤシン', 'ギター', 'ツリ', 'ソバウチ'],
};
/**
 * Level 5: the detail per topic kind (utterance.ts says it in a sentence). No word is
 * also a subject or another kind's detail, so a word asked back names one fact.
 */
export const TOPIC_DETAILS: Record<TopicKind, string[]> = {
  walk: ['トリ', 'イヌ', 'ネコ', 'ハナ'],
  shopping: ['アカ', 'アオ', 'クロ', 'シロ'],
  garden: ['ライゲツ', 'コンゲツ', 'ナツ', 'アキ'],
  trip: ['クルマ', 'デンシヤ', 'ヒコウキ', 'フネ'],
  family: ['スシ', 'ヤキニク', 'ウドン', 'カレー'],
  season: ['ジンジヤ', 'テラ', 'ヤマ', 'カワベ'],
  hobby: ['マイニチ', 'シユウマツ', 'ヨル', 'アサ'],
};
export const TOPIC_STAGE: Record<TopicKind, TopicTruth['stage']> = {
  walk: 'result', shopping: 'result', garden: 'ongoing', trip: 'preview', family: 'preview', season: 'ongoing', hobby: 'result',
};
export const TOPIC_KINDS = Object.keys(TOPIC_SUBJECTS) as TopicKind[];

/** Level 3–5: what the talk over is about (one theme; Level 4 a topic too; Level 5 a detail of it in the next over). */
export interface WabunTalk { theme: 'wx' | 'shack'; facts: WabunFact[]; topic: boolean; detail?: boolean }

/**
 * How much the talk carries (おまかせ's load axis, Level 3 on): 0 one fact of the theme,
 * 1 two (Stage 4, the default), 2 three. Never more topics: one topic per QSO.
 */
export type WabunLoad = 0 | 1 | 2;

export interface WabunTruth {
  call: string;
  /** The report it gives us. */
  rst: string;
  /** Surname in kana (in wabun most operators give their surname: docs §1.4). */
  name: string;
  /** City in kana, without the 市 / 都 it is sent with. */
  qth: string;
  /** シ (市) or ト (都), sent after the city. */
  qthSuffix: string;
  greeting: Greeting;
  weather: WabunWeather;
  shack: WabunShack;
  topic: TopicTruth;
}

/**
 * Which of the stock phrasings a station uses (an index per slot; utterance.ts has the
 * lists). Fixed per station, so a repeat says it the same way again.
 */
export interface WabunWording {
  cq: number;
  /** Level 1: the greeting in a short body, or in Latin with an invitation to ホレ. */
  answer: number;
  /** Level 2: the order and wording of RST / QTH / name in the first over. */
  exchange: number;
  regards: number;
  closing: number;
  /** Level 1: how it signs off after our phrase. */
  farewell: number;
  /** Level 3 / 4: the phrasing of the theme and the topic. */
  talk: number;
  /** How it says a fact again when asked (it alternates on each repeat). */
  fill: number;
}

/**
 * How the station runs its QSO: the same truth told differently. Where sources differ
 * both forms exist (docs §1.2: 73 inside the body before ラタ, or Latin after it).
 */
export interface WabunPersona {
  wpm: number;
  closing73: 'inside' | 'after';
  wording: WabunWording;
  /** Asks our name when our reply did not carry it (Level 3 / 4; not every station bothers). */
  asksName: boolean;
  /** Level 5: how its hand keys (fist.ts); null below Level 5, keyed by the book. */
  fist?: WabunFist | null;
}

export interface WabunScenario { level: WabunLevel; truth: WabunTruth; persona: WabunPersona; talk: WabunTalk | null }

/** Fictional surnames (common ones, several voiced: ワタナベ, ヤマダ …). No real station is meant. */
export const WABUN_NAMES = ['タナカ', 'スズキ', 'サトウ', 'ヤマモト', 'ナカムラ', 'コバヤシ', 'カトウ', 'ヨシダ', 'ヤマダ', 'ワタナベ', 'イシイ', 'モリ', 'ハセガワ', 'オガワ', 'フジタ', 'ノグチ'];

/** City → call area digit (the call and QTH agree, as in qso.ts). Small kana written full-size (キヨウト). */
export const WABUN_QTH: [string, number, string][] = [
  ['トウキヨウ', 1, 'ト'], ['ヨコハマ', 1, 'シ'], ['チバ', 1, 'シ'], ['ナゴヤ', 2, 'シ'], ['シズオカ', 2, 'シ'], ['オオサカ', 3, 'シ'], ['キヨウト', 3, 'シ'],
  ['コウベ', 3, 'シ'], ['ヒロシマ', 4, 'シ'], ['オカヤマ', 4, 'シ'], ['マツヤマ', 5, 'シ'], ['コウチ', 5, 'シ'], ['フクオカ', 6, 'シ'], ['クマモト', 6, 'シ'],
  ['センダイ', 7, 'シ'], ['アオモリ', 7, 'シ'], ['サツポロ', 8, 'シ'], ['ハコダテ', 8, 'シ'], ['カナザワ', 9, 'シ'], ['トヤマ', 9, 'シ'], ['ニイガタ', 0, 'シ'], ['ナガノ', 0, 'シ'],
];

/** Level 5 presets and おまかせ: the fist's kind (the station then says it uses that key), how much of it shows, tired or not. */
export interface FistOptions { kind?: FistKind; strength?: number; fatigue?: boolean }

const pick = <T,>(list: readonly T[], random: () => number) => list[Math.floor(random() * list.length)];
const variant = (random: () => number, count: number) => Math.floor(random() * count);

export const greetingAt = (hour: number): Greeting => (hour >= 4 && hour < 11 ? 'morning' : hour >= 18 || hour < 4 ? 'evening' : 'day');

/** Stock phrasings per slot (utterance.ts renders index % count). */
export const WORDING_COUNT: WabunWording = { cq: 2, answer: 2, exchange: 3, regards: 2, closing: 2, farewell: 2, talk: 2, fill: 2 };

/** The facts a scenario's QSO tells, in the order they come. */
export const scenarioFacts = (scenario: Pick<WabunScenario, 'level' | 'talk'>): WabunFact[] =>
  [...LEVEL_FACTS[scenario.level], ...(scenario.talk?.facts ?? []), ...(scenario.talk?.topic ? ['topic' as const] : []), ...(scenario.talk?.detail ? ['detail' as const] : [])];

function makeWeather(random: () => number): WabunWeather {
  const sky = pick(SKIES, random);
  // Snow only when it is cold; the rest anywhere from chilly to hot.
  const temp = sky === 'ユキ' ? Math.floor(random() * 4) : 5 + Math.floor(random() * 28);
  return { sky, temp, condx: pick(CONDX, random) };
}

export function makeWabunScenario(
  random: () => number,
  { wpm, hour, level = 2, load = 1, fist: fistOptions = {} }: { wpm: number; hour: number; level?: WabunLevel; load?: WabunLoad; fist?: FistOptions },
): WabunScenario {
  const [qth, area, qthSuffix] = pick(WABUN_QTH, random);
  const scenario: WabunScenario = {
    level,
    truth: {
      call: `${pick(JA_PREFIX, random)}${area}${randomSuffix(random)}`,
      rst: pick(RST, random),
      name: pick(WABUN_NAMES, random),
      qth,
      qthSuffix,
      greeting: greetingAt(hour),
      // Filled in below (after the Stage 2 draws).
      weather: { sky: 'ハレ', temp: 20, condx: 'ヨイ' },
      shack: { rig: RIGS[0], ant: ANTENNAS[0], pwr: 10, key: KEYS[0] },
      topic: { kind: 'walk', subject: TOPIC_SUBJECTS.walk[0], stage: 'result' },
    },
    persona: {
      wpm: Math.max(8, Math.round(wpm)),
      closing73: random() < 0.5 ? 'inside' : 'after',
      wording: {
        cq: variant(random, WORDING_COUNT.cq),
        answer: variant(random, WORDING_COUNT.answer),
        exchange: variant(random, WORDING_COUNT.exchange),
        regards: variant(random, WORDING_COUNT.regards),
        closing: variant(random, WORDING_COUNT.closing),
        farewell: variant(random, WORDING_COUNT.farewell),
        talk: 0,
        fill: 0,
      },
      asksName: false,
      fist: null,
    },
    talk: null,
  };
  // Drawn after everything above, so a seed gives Level 1 / 2 the station it always did.
  const { truth, persona } = scenario;
  truth.weather = makeWeather(random);
  truth.shack = { rig: pick(RIGS, random), ant: pick(ANTENNAS, random), pwr: pick(POWERS, random), key: pick(KEYS, random) };
  const kind = pick(TOPIC_KINDS, random);
  truth.topic = { kind, subject: pick(TOPIC_SUBJECTS[kind], random), stage: TOPIC_STAGE[kind] };
  persona.wording.talk = variant(random, WORDING_COUNT.talk);
  persona.wording.fill = variant(random, WORDING_COUNT.fill);
  persona.asksName = random() < 0.35;
  const theme = random() < 0.5 ? 'wx' : 'shack';
  // One theme, two facts of it: the weather and the temperature or the band; the rig and one more thing of the shack.
  const second = theme === 'wx' ? pick(['temp', 'condx'] as const, random) : pick(['ant', 'pwr', 'key'] as const, random);
  if (level >= 3) scenario.talk = { theme, facts: [theme === 'wx' ? 'wx' : 'rig', second], topic: level >= 4 };
  // Everything below draws only when asked for, so the default load and Levels 1–4 keep their seeds' stations.
  if (scenario.talk && load === 0) scenario.talk.facts = scenario.talk.facts.slice(0, 1);
  if (scenario.talk && load === 2) {
    const third = theme === 'wx' ? (second === 'temp' ? 'condx' : 'temp') : pick((['ant', 'pwr', 'key'] as const).filter((fact) => fact !== second), random);
    scenario.talk.facts = [...scenario.talk.facts, third];
  }
  if (level === 5 && scenario.talk) {
    scenario.talk.detail = true;
    truth.topic.detail = pick(TOPIC_DETAILS[truth.topic.kind], random);
    // The key it tells us about is the key it keys with.
    if (fistOptions.kind) truth.shack.key = KEY_OF_FIST[fistOptions.kind];
    persona.fist = makeFist(random, fistOptions.kind ?? fistKindOf(truth.shack.key), { strength: fistOptions.strength, fatigue: fistOptions.fatigue });
  }
  return scenario;
}
