import { normalizeRst } from '../exchange';
import { parseIntent, type OperatorIntent } from '../air/intent';
import { expandWabunVoicing } from '../../morse';
import { composeVoicing, parseSegments, textOf, type Segment } from './segments';
import { TOPIC_DETAILS, TOPIC_SUBJECTS, type WabunFact } from './scenario';

/**
 * What we meant by a wabun-QSO transmission. The Latin words (calls, RST, AGN, QRS, TU,
 * 73) are read by the shared parseIntent; the kana body by a few words and nothing
 * more: no free-text understanding. Leaving out ホレ or ラタ is read leniently (people
 * do: docs §1.2) and only noted.
 */
export interface WabunIntent {
  segments: Segment[];
  roman: OperatorIntent;
  /** Kana of the body as read, corrections applied, spaces dropped. */
  wabun: string;
  /** The body as read (corrections applied), words kept. What we sent stays as sent elsewhere. */
  body: string;
  /** Each ラタ correction: what it took back and what replaced it. */
  corrections: CorrectionRead[];
  /** A ホレ that switched into wabun. */
  opened: boolean;
  /** A ラタ that switched back. */
  closed: boolean;
  /** Kana sent with no ホレ before it (the switch was left out). */
  unopened: boolean;
  /** Report sent (Latin or in the body), normalised. */
  report: string | null;
  /** Thanks / regards / roger: the other side's over was taken. */
  ack: boolean;
  /** TU / 73 / VA / E E, or サヨウナラ. */
  closing: boolean;
  /** Everything again (AGN, ?, サラオネ). */
  repeat: boolean;
  /** Only these facts again (PSE NAME?, RST AGN?, WX?, テンキ サラオネ). */
  asks: WabunFact[];
  /** Our name as sent: the word after ナマエハ in the body, or NAME / OP in Latin. */
  name: string | null;
  qrs: boolean;
  /**
   * How the over takes what the station told (Level 5's "a conversation"): an あいづち
   * (ナルホド, R), liking it (イイデスネ, FB, タノシソウ), thanks, a question back (ドコデスカ?),
   * our own side (コチラモ ハレ, リグハ …). Read off a few words, never grammar.
   */
  reacts: ReactKind[];
}

export type ReactKind = 'ack' | 'praise' | 'thanks' | 'question' | 'own';

const REACT_KANA: [ReactKind, RegExp][] = [
  ['ack', /ナルホド|リヨウカイ|ソウデスカ|ハイ|ヘエ|ホウ/],
  ['praise', /イイデスネ|ヨイデスネ|イイネ|スバラシイ|タノシソウ|タノシミ|ウラヤマシイ|キレイ|ステキ|スゴイ|オイシソウ|イイナ|ヨカツタ/],
  ['thanks', /アリガトウ|アリ$|サンキユ/],
  ['question', /ドコ|ナニ|イツ|ドンナ|ドウデスカ|デスカ\?|カ\?$/],
  ['own', /コチラモ|コチラハ|ワタシモ|ワタシハ|ウチモ|ウチハ|ハレ|クモリ|アメ|ユキ|リグハ|アンテナハ|キーハ|パワーハ|[0-9]+ド/],
];
const REACT_LATIN: [ReactKind, RegExp][] = [['ack', /^(R|RR|OK)$/], ['praise', /^(FB|FINE|NICE|GUD)$/], ['thanks', /^(TNX|TKS|THX)$/]];

/** What kinds of response the words carry (an ask for a repeat is not a response). */
function reactsOf(kana: string[], tokens: string[]): ReactKind[] {
  const found = new Set<ReactKind>();
  for (const word of kana) for (const [kind, pattern] of REACT_KANA) if (pattern.test(word)) found.add(kind);
  for (const token of tokens) for (const [kind, pattern] of REACT_LATIN) if (pattern.test(token)) found.add(kind);
  return [...found];
}

/**
 * Level 5: a word that names the news (its subject, … ノハナシ, キンキヨウ) or its detail,
 * asked back ("ナス サラオネ", "ナス?", "ニワノハナシ サラオネ", "ナス ラタ AGN?"). The
 * words are the lists every station draws from, never this station's truth.
 */
const SUBJECTS = Object.values(TOPIC_SUBJECTS).flat();
const DETAILS = Object.values(TOPIC_DETAILS).flat();
const nearly = (word: string, kana: string) => word === kana || (word.startsWith(kana) && word.length <= kana.length + 2);
function topicFactOf(word: string): WabunFact | undefined {
  const bare = word.replace(/\?+$/, '');
  if (!bare) return undefined;
  if (/(ハナシ|キンキヨウ|ワダイ)$/.test(bare) || SUBJECTS.some((kana) => nearly(bare, kana))) return 'topic';
  if (DETAILS.some((kana) => nearly(bare, kana))) return 'detail';
  return undefined;
}
function topicAsks(words: string[]): WabunFact[] {
  const asked: WabunFact[] = [];
  words.forEach((word, index) => {
    const fact = topicFactOf(word);
    const next = words[index + 1] ?? '';
    if (fact && (word.endsWith('?') || next.startsWith('サラオネ') || next.startsWith('AGN') || next === '?') && !asked.includes(fact)) asked.push(fact);
  });
  return asked;
}

/** A correction as read: the slip taken back (from where the retyping starts) and the retyped text. */
export interface CorrectionRead { before: string; erased: string; retyped: string; after: string }

/** How far back (kana units) a retyping may start: "2〜3文字前から" with room for a word. */
const CORRECTION_REACH = 10;
/** Beyond the reach, a match must be this long (units) to be trusted. */
const FAR_MATCH = 3;

/**
 * Apply one ラタ correction. The retyping starts a little before the slip, so it is
 * placed where its first units match the text already sent and then part from it (at
 * the slip): the longest such match within reach, the latest on a tie. A match that
 * runs to the end without parting is only used when nothing parts.
 *
 * Further back than the reach (a long body, the retyping started a word or two
 * early), only a match of FAR_MATCH units or more that parts at the slip is taken: long
 * enough not to be a chance hit. With no match at all, the retyping replaces the last word.
 */
export function applyCorrection(before: string, retyped: string): CorrectionRead {
  const units = (text: string) => [...text].flatMap((char) => (char === ' ' ? [' '] : expandWabunVoicing(char)));
  const b = units(before.trim());
  const a = units(retyped.trim());
  const matchAt = (p: number) => {
    let m = 0;
    while (m < a.length && p + m < b.length && a[m] === b[p + m]) m += 1;
    return m;
  };
  // [position, match length, parts at the slip]
  let best: [number, number, boolean] | null = null;
  let reach = 0;
  let p = b.length - 1;
  for (; p >= 0 && reach < CORRECTION_REACH; p -= 1) {
    if (b[p] === ' ') continue;
    reach += 1;
    const m = matchAt(p);
    if (!m) continue;
    const parts = p + m < b.length;
    if (!best || (parts && !best[2]) || (parts === best[2] && m > best[1])) best = [p, m, parts];
  }
  for (; !best && p >= 0; p -= 1) {
    if (b[p] === ' ') continue;
    const m = matchAt(p);
    if (m >= FAR_MATCH && p + m < b.length) best = [p, m, true];
  }
  const start = best ? best[0] : b.lastIndexOf(' ') + 1;
  const kept = b.slice(0, start).join('');
  const erased = composeVoicing(b.slice(start).join('')).trim();
  const text = composeVoicing(`${kept}${a.join('')}`).replace(/\s+/g, ' ').trim();
  return { before: composeVoicing(b.join('')), erased, retyped: composeVoicing(a.join('')), after: text };
}

/** The body as the other side reads it: wabun segments in order, each correction applied. */
export function readBody(segments: Segment[]): { body: string; corrections: CorrectionRead[] } {
  let body = '';
  let correcting = false;
  const corrections: CorrectionRead[] = [];
  for (const segment of segments) {
    if (segment.kind === 'control') {
      if (segment.correction && body) correcting = true;
      continue;
    }
    if (segment.kind !== 'wabun') continue;
    if (correcting) {
      const read = applyCorrection(body, segment.text);
      corrections.push(read);
      body = read.after;
      correcting = false;
    } else body = body ? `${body} ${segment.text}` : segment.text;
  }
  return { body, corrections };
}

const ACK_WORDS = ['アリガトウ', 'アリ', 'ヨロシク', 'リヨウカイ', 'ヨロ', 'オネ'];
/** Kana that name a fact before サラオネ (or with ?). */
const ASK_WORDS: [string, WabunFact][] = [
  ['ナマエ', 'name'], ['オナマエ', 'name'], ['レポート', 'rst'], ['コチラ', 'qth'], ['QTH', 'qth'],
  ['テンキ', 'wx'], ['オテンキ', 'wx'], ['キオン', 'temp'], ['コンデイシヨン', 'condx'], ['リグ', 'rig'], ['アンテナ', 'ant'], ['パワー', 'pwr'], ['キー', 'key'],
];
/** Latin field words: asked when followed by ?, by "?" or by AGN ("RST AGN?", "WX?", "PSE NAME?"). */
const LATIN_ASKS: Record<string, WabunFact> = {
  NAME: 'name', OP: 'name', QTH: 'qth', RST: 'rst', RPRT: 'rst', WX: 'wx', TEMP: 'temp', TMP: 'temp',
  CONDX: 'condx', CONDS: 'condx', RIG: 'rig', ANT: 'ant', PWR: 'pwr', KEY: 'key',
};

/** Fact words asked in Latin. */
function latinAsks(tokens: string[]): WabunFact[] {
  const asked: WabunFact[] = [];
  tokens.forEach((token, index) => {
    const word = token.replace(/\?+$/, '');
    const fact = LATIN_ASKS[word];
    const next = tokens[index + 1]?.replace(/\?+$/, '');
    if (fact && (token.endsWith('?') || tokens[index + 1] === '?' || next === 'AGN') && !asked.includes(fact)) asked.push(fact);
  });
  return asked;
}

/** Fact words asked in kana: "<word> サラオネ" or "<word>?" (a word ending in the word: "オテンキ"). */
function kanaAsks(words: string[]): WabunFact[] {
  const asked: WabunFact[] = [];
  const factOf = (word: string) => ASK_WORDS.find(([kana]) => word === kana || (word.endsWith(kana) && word.length <= kana.length + 1))?.[1];
  words.forEach((word, index) => {
    const bare = word.replace(/\?+$/, '');
    const fact = factOf(bare) ?? factOf(bare.replace(/ハ$/, ''));
    if (fact && (word.endsWith('?') || words[index + 1]?.startsWith('サラオネ')) && !asked.includes(fact)) asked.push(fact);
  });
  return asked;
}

export function parseWabunIntent(text: string, myCall: string): WabunIntent {
  const segments = parseSegments(text);
  const roman = parseIntent(textOf(segments, 'roman'), myCall);
  const { body: read, corrections } = readBody(segments);
  const body = read ? [read] : [];
  const wabun = read.replace(/\s+/g, '');
  const opened = segments.some((segment) => segment.kind === 'control' && segment.sign === 'ホレ' && segment.to === 'wabun');
  const closed = segments.some((segment) => segment.kind === 'control' && segment.sign === 'ラタ' && segment.to === 'roman');
  // Kana typed without ホレ lands in roman text; parseIntent drops it, so look for it here.
  const unopened = segments.some((segment) => segment.kind === 'roman' && /[゠-ヿ]/.test(segment.text));
  const kana = wabun + segments.filter((segment) => segment.kind === 'roman').map((segment) => segment.text.replace(/[^゠-ヿ]/g, '')).join('');
  const bodyRst = body.join(' ').split(/\s+/).map((word) => normalizeRst(word.replace(/[^0-9N]/gi, ''))).find((value) => /^[1-5][1-9][1-9]$/.test(value)) ?? null;
  const report = roman.report ?? bodyRst;
  const sarao = kana.indexOf('サラオネ');
  // Words as sent across the body and any kana typed without ホレ, in order (サラオネ may be glued on: "ナマエサラオネ").
  const kanaWords = [read, ...segments.filter((segment) => segment.kind === 'roman').map((segment) => segment.text.replace(/[^゠-ヿ?\s]/g, ' '))]
    .join(' ').split(/\s+/).filter(Boolean).flatMap((word) => (word.length > 4 && word.endsWith('サラオネ') ? [word.slice(0, -4), 'サラオネ'] : [word]));
  // Every word in sending order, Latin and kana (a kana word asked with AGN after ラタ).
  const allWords = segments.flatMap((segment) => (segment.kind === 'control' ? [] : segment.text.split(/\s+/).filter(Boolean)))
    .flatMap((word) => (word.length > 4 && word.endsWith('サラオネ') ? [word.slice(0, -4), 'サラオネ'] : [word]));
  const asks: WabunFact[] = [];
  for (const fact of [...kanaAsks(kanaWords), ...latinAsks(roman.tokens), ...topicAsks(allWords)]) if (!asks.includes(fact)) asks.push(fact);
  const nameAt = kanaWords.findIndex((word) => /^(ナマエハ?|オペハ?)$/.test(word));
  const kanaName = nameAt >= 0 ? kanaWords[nameAt + 1]?.replace(/\?+$/, '') : undefined;
  return {
    segments,
    roman,
    wabun,
    body: read,
    corrections,
    opened,
    closed,
    unopened,
    report,
    // サラオネ (please send again) is an ask, not the オネ of a greeting.
    ack: roman.roger || ACK_WORDS.some((word) => kana.replace(/サラオネ/g, '').includes(word)),
    closing: roman.closing || roman.tokens.includes('VA') || roman.tokens.filter((token) => token === 'E').length >= 2
      || kana.includes('サヨウナラ') || /73/.test(wabun),
    repeat: !asks.length && (roman.agn || sarao >= 0),
    asks,
    name: kanaName && /^[゠-ヿ]+$/.test(kanaName) ? kanaName : roman.fields.name ?? null,
    qrs: roman.qrs,
    // An over that only asks for a repeat responds to nothing.
    reacts: reactsOf(kanaWords.filter((word) => !word.startsWith('サラオネ') && !topicFactOf(word)), roman.tokens),
  };
}

/**
 * The station's call as we have it: the log's call field, else the call we sent it
 * ("<call> DE <me>"). Operator state only (what we wrote or keyed), never the truth and
 * never the receiver's decoding: the macro must not copy the call for us.
 */
export function operatorCall(logged: string, sent: string[]): string {
  const call = logged.trim().toUpperCase();
  if (/^[A-Z0-9/]{3,}$/.test(call)) return call;
  for (const line of [...sent].reverse()) {
    const match = /^([A-Z0-9/]{3,}) DE /.exec(line.trim());
    if (match && /[0-9]/.test(match[1]) && /[A-Z]/.test(match[1])) return match[1];
  }
  return '';
}
