import { alphabetSymbols } from './morse';
import {
  type StoredCodesSet,
  type StoredExamSet,
  type StoredPlainSet,
  type StoredWabunSet,
} from './examSets';
import { OUBUN_PLAIN_PASSAGES, WABUN_PLAIN_PASSAGES } from './plainCorpus';
import { buildMorseTimeline } from './timing';
import type { AlphabetType, AudioSettings } from './types';
import { buildRandomWabunBodies, type WabunWeakness } from './wabunRandom';

/** 単語プール（短文ドリル・穴埋め用）。電文本文は plainCorpus を優先。 */
const WORDS = [
  'CAPTAIN', 'VESSEL', 'SHIP', 'MASTER', 'COAST', 'HARBOR', 'PORT', 'ANCHOR', 'BERTH', 'PILOT',
  'COURSE', 'BEARING', 'POSITION', 'LATITUDE', 'LONGITUDE', 'SPEED', 'KNOTS', 'DRAFT', 'CARGO', 'TANKER',
  'WEATHER', 'WIND', 'FOG', 'STORM', 'VISIBILITY', 'SEA', 'SWELL', 'TIDE', 'CURRENT', 'CHANNEL',
  'REQUEST', 'CONFIRM', 'REPORT', 'PLEASE', 'ARRIVAL', 'DEPARTURE', 'ETA', 'ETD', 'DELAY', 'CLEARANCE',
  'SAFETY', 'URGENT', 'ASSIST', 'TOW', 'RESCUE', 'RADIO', 'TRAFFIC', 'MESSAGE', 'REPLY', 'SCHEDULE',
];
const CALL_PREFIX = ['JA1', 'JA2', 'JA3', 'JH1', 'JR2', '7K1', '8J1'];
const CALL_SUFFIX = ['CW', 'QRS', 'DX', 'ABC', 'KTR', 'MOR', 'XYZ'];
const WABUN_WORDS = [
  'センチョウ', 'センパク', 'ホンセン', 'カイガン', 'ミナト', 'イカリ', 'シンニュウ', 'シュッコウ', 'トウチャク', 'リリク',
  'コウロ', 'ホウイ', 'イチ', 'ソクド', 'ノット', 'カモツ', 'ユソウ', 'テンキ', 'カゼ', 'キリ',
  'アラシ', 'シチョウ', 'カカリ', 'アンゼン', 'キュウジョ', 'ツウシン', 'デンポウ', 'ウケツケ', 'レンラク', 'カクニン',
  'ホウコク', 'ヨテイ', 'チエン', 'キョカ', 'ナミ', 'チョウリュウ', 'スイイキ', 'ヒナン', 'ケイカイ', 'ジョウホウ',
];

export function randomGroup(alphabet: AlphabetType, length = 12, source?: string[], options?: { avoidImmediateRepeat?: boolean }) {
  const symbols = source?.length ? source : alphabetSymbols(alphabet).filter((s) => alphabet === 'wabun' || /^[A-Z0-9]$/.test(s));
  if (!symbols.length) return '';
  const avoidRepeat = options?.avoidImmediateRepeat === true && symbols.length > 1;
  const picked: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const previous = picked.at(-1);
    const candidates = avoidRepeat && previous ? symbols.filter((symbol) => symbol !== previous) : symbols;
    picked.push(candidates[Math.floor(Math.random() * candidates.length)]);
  }
  return picked.join('');
}
export const randomWord = (alphabet: AlphabetType) => {
  const pool = alphabet === 'wabun' ? WABUN_WORDS : WORDS;
  return pool[Math.floor(Math.random() * pool.length)];
};
export const randomCallsign = () => `${CALL_PREFIX[Math.floor(Math.random() * CALL_PREFIX.length)]}${CALL_SUFFIX[Math.floor(Math.random() * CALL_SUFFIX.length)]}`;
export const examText = (alphabet: AlphabetType, words = 22) => Array.from({ length: words }, () => randomWord(alphabet)).join(' ');

/** 一総通 モールス受信の速度・総文字数（5分） */
/** 公式CD速度（WPM）。dit 目安: 和文55ms / 暗語59ms / 普通語52ms */
export const EXAM_SUBJECTS = {
  wabun: { id: 'wabun' as const, title: '和文', kindLabel: '和文普通語', alphabet: 'wabun' as AlphabetType, cpm: 75, totalChars: 375, durationSec: 300, wpm: 22 },
  codes: { id: 'codes' as const, title: '欧文暗語', kindLabel: '欧文暗語', alphabet: 'international' as AlphabetType, cpm: 80, totalChars: 400, durationSec: 300, wpm: 21 },
  plain: { id: 'plain' as const, title: '欧文普通語', kindLabel: '欧文普通語', alphabet: 'international' as AlphabetType, cpm: 100, totalChars: 500, durationSec: 300, wpm: 23 },
};

export type ExamSubjectId = keyof typeof EXAM_SUBJECTS;

/** 暗語練習帳（欧文電報送信練習帳）: 本文は 5字グループ × 8語/行 × 5行 = 40語 */
export const CODE_GROUPS_PER_ROW = 8;
export const CODE_ROWS_PER_PAGE = 5;
export const CODE_GROUPS_PER_PAGE = CODE_GROUPS_PER_ROW * CODE_ROWS_PER_PAGE;
export const CODE_BODY_CHARS_PER_PAGE = CODE_GROUPS_PER_PAGE * 5;

/** 和文受信用紙: (5+5)行 × (3+3)列 = 60字/ページ（正本グリッド） */
export const WABUN_ROWS_PER_BLOCK = 5;
export const WABUN_COLS_PER_BLOCK = 3;
export const WABUN_ROWS_PER_PAGE = WABUN_ROWS_PER_BLOCK * 2;
export const WABUN_COLS_PER_PAGE = WABUN_COLS_PER_BLOCK * 2;
export const WABUN_BODY_CHARS_PER_PAGE = WABUN_ROWS_PER_PAGE * WABUN_COLS_PER_PAGE;

/**
 * 電報級別（正本: docs/欧文電報送信練習帳.pdf）
 * - class3: 前編 p1–50 / 12時制 M·S
 * - class1: 後編 p51–100 / 24時制（1・2総通）
 */
export type TelegramExamClass = 'class1' | 'class3';

/** 陸地・都市系発信局（練習帳より） */
const ORIGINS_LAND = [
  'KAGOSHIMA', 'YOKOHAMA', 'KOBE', 'OSAKA', 'NAGOYA', 'HAKODATE', 'AOMORI',
  'MAEBASHI', 'NAGANO', 'SHIMONOSEKI', 'PARIS', 'ROMA',
];
/** 船舶＋コールサイン（練習帳より） */
const ORIGIN_SHIPS = [
  { name: 'ATSUTAMARU', call: 'JEKU' },
  { name: 'ARIAKEMARU', call: 'JCNO' },
  { name: 'ENOSHIMAMARU', call: 'JLLW' },
  { name: 'TOKYOMARU', call: 'JFPN' },
  { name: 'KORYUMARU', call: 'JFKI' },
  { name: 'ZUIYOMARU', call: 'JDRA' },
  { name: 'KISHIEMARU', call: 'JKEE' },
  { name: 'KANDAMARU', call: 'JKAN' },
];
const COAST_STATIONS_JA = [
  'ヨコハマムセン', 'ナガサキムセン', 'コウベムセン', 'トウキヨウムセン', 'オオサカムセン',
  'シミズムセン', 'モジムセン', 'ニイガタムセン', 'クシロムセン', 'ナハムセン',
];
const WABUN_SHIPS = [
  'ハクバサンマル', 'コウヘイマル', 'トウキヨウマル', 'ニホンマル', 'サクラマル', 'アサヒマル',
];
const WABUN_PERSONS = [
  'コタニハルエ', 'ヤマダタロウ', 'サトウハナコ', 'センチョウ', 'ヒサエ', 'タナカ',
];
const WABUN_PLACES = ['トウキヨウ', 'オオサカ', 'コウベ', 'ナガサキ', 'ヨコハマ'];

/** 署名（練習帳: `=HONTEN` のように BT(=) を前置） */
const SIGNATURES = [
  'HONTEN', 'TAYLOR', 'MAYOR', 'KANBE', 'MIYAMOTO', 'HEIWA',
  'CAPTAIN', 'FRANKLIN', 'HARUKO MIYAKE',
];
const ADDRESS_PERSONS = [
  'JAMES', 'SMITH', 'YAMAMOTO', 'YOSHIKAWA', 'MONIN', 'AUGUST CARLOUS',
  'JOHN MUCCIO', 'KK HONDA', 'CAPT OKADA', 'SHIRO HAYASHI', 'KOJIMA', 'SUGIMOTO', 'SUMOTO', 'HASE', 'TOHMEN',
];
const ADDRESS_PLACES = [
  'IMPERIAL HOTEL TOKYO', 'KANAYA HOTEL NIKKO', 'UNZEN HOTEL UNZEN',
  'KUMAMOTO', 'SHANGHAI', 'YUSEN TOKYO', 'MARSEILLE',
];
const SHIP_ADDR = [
  { person: 'CAPTAIN', name: 'KOHEIMARU', call: 'JBAN', via: 'NAGASAKIMUSEN' },
  { person: 'YOSHIKAWA', name: 'TAISEIMARU', call: 'JRCD', via: 'HAKODATEMUSEN' },
  { person: 'CAPTAIN', name: 'HOKUTOMARU', call: 'JLKX', via: 'SYDNEYRADIO' },
  { person: 'CAPT OKADA', name: 'HEIYOMARU', call: 'JACU', via: 'CHOSHIMUSEN' },
  { person: 'YAMAMOTO', name: 'NARITAMARU', call: 'JLFL', via: 'NAPOLIRADIO' },
  { person: 'SHIRO HAYASHI', name: 'TAKUYOMARU', call: 'JDRP', via: 'NAGASAKIMUSEN' },
  { person: 'CAPTAIN', name: 'KAIOMARU', call: 'JEPC', via: 'ANDERADIO' },
  { person: 'SUGIMOTO', name: 'TOKOMARU', call: 'JKOD', via: 'HAVANARADIO' },
  { person: 'SUMOTO', name: 'ASAMARU', call: 'JFSW', via: 'NAPOLIRADIO' },
  { person: 'KOJIMA', name: 'YASUKUNIMARU', call: '', via: 'DARWINRADIO' },
  { person: 'HASE', name: 'TAKUYOMARU', call: 'JNDK', via: 'CHOSHIMUSEN' },
];

const pick = <T,>(pool: T[]) => pool[Math.floor(Math.random() * pool.length)];
const pad2 = (value: number) => String(value).padStart(2, '0');
const compactLen = (text: string) => text.replace(/\s+/g, '').length;

const trimToChars = (text: string, target: number) => {
  let count = 0;
  let out = '';
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (count > 0 && count < target) out += ch;
      continue;
    }
    if (count >= target) break;
    out += ch;
    count += 1;
  }
  return out.trim();
};

const shuffleCopy = <T,>(items: T[]) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
};

/** 正本っぽい普通語本文。コーパスを繋げて目標字数まで詰め、足りなければ単語で補う。 */
const buildPlainBody = (alphabet: AlphabetType, targetChars: number) => {
  const passages = alphabet === 'wabun' ? WABUN_PLAIN_PASSAGES : OUBUN_PLAIN_PASSAGES;
  const joiner = alphabet === 'wabun' ? '、' : ' ';
  const parts: string[] = [];
  for (const passage of shuffleCopy(passages)) {
    if (compactLen(parts.join(joiner)) >= targetChars) break;
    parts.push(passage);
  }
  while (compactLen(parts.join(joiner)) < targetChars) parts.push(randomWord(alphabet));
  return trimToChars(parts.join(joiner), targetChars);
};

/**
 * 井戸のヰ・カギのあるヱ。
 * ON: イ／エの一部を置換し、本文に両方必ず1字以上。OFF: 万一混入してもイ／エへ戻す。
 */
export function applyWabunWiWe(body: string, enabled: boolean): string {
  if (!enabled) return body.replaceAll('ヰ', 'イ').replaceAll('ヱ', 'エ');
  const chars = Array.from(body);
  for (let index = 0; index < chars.length; index += 1) {
    if (chars[index] === 'イ' && Math.random() < 0.1) chars[index] = 'ヰ';
    if (chars[index] === 'エ' && Math.random() < 0.1) chars[index] = 'ヱ';
  }
  const forceOne = (preferredFrom: string, to: string) => {
    if (chars.includes(to)) return;
    const preferred = chars.indexOf(preferredFrom);
    if (preferred >= 0) {
      chars[preferred] = to;
      return;
    }
    // イ／エが無い本文でも、仮名1字を差し替えて必ず入れる
    const fallback = chars.findIndex((ch) => (
      /[\u30A1-\u30F6]/.test(ch) && ch !== 'ヰ' && ch !== 'ヱ' && ch !== 'ー'
    ));
    if (fallback >= 0) chars[fallback] = to;
  };
  forceOne('イ', 'ヰ');
  forceOne('エ', 'ヱ');
  return chars.join('');
}

const buildWabunBody = (targetChars: number, includeWiWe: boolean) =>
  applyWabunWiWe(buildPlainBody('wabun', targetChars), includeWiWe);

const formatCodeGroups = (groups: string[]) => {
  const lines: string[] = [];
  for (let index = 0; index < groups.length; index += CODE_GROUPS_PER_ROW) {
    lines.push(groups.slice(index, index + CODE_GROUPS_PER_ROW).join(' '));
  }
  return lines.join('\n');
};

const buildCodeBody = (targetChars: number) => {
  const groupCount = Math.max(1, Math.ceil(targetChars / 5));
  const groups = Array.from({ length: groupCount }, () => (
    randomGroup('international', 5, undefined, { avoidImmediateRepeat: true })
  ));
  return formatCodeGroups(groups);
};

const trimCodeBodyToChars = (body: string, targetChars: number) => {
  const groups = body.trim().split(/\s+/).filter(Boolean);
  const keep = Math.max(1, Math.min(groups.length, Math.floor(targetChars / 5)));
  return formatCodeGroups(groups.slice(0, keep));
};

const bodyLooksLikeCodes = (body: string) => {
  const words = body.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => /^[A-Z0-9]{5}$/i.test(word));
};

/**
 * 語数ラベル（NTT 有料語数／H30解説）:
 * - 空白区切の語を「語辞」とし、**10字までごとに1語**（11–20字は2語…）
 * - 超過があるとき `有料語数/語辞数`（例: `48/46`＝語辞46のうち10字超が2語）
 * - 暗語も実録では `33/31` 型あり
 */
const tariffUnitsForWord = (word: string) => {
  const len = word.replace(/\s+/g, '').length;
  return Math.max(1, Math.ceil(len / 10));
};

const wordCountLabel = (
  address: string,
  body: string,
  signature?: string,
) => {
  const words = [address, body, signature ?? '']
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const raw = Math.max(1, words.length);
  const tariff = Math.max(1, words.reduce((sum, word) => sum + tariffUnitsForWord(word), 0));
  if (tariff > raw) return `${tariff}/${raw}`;
  return String(raw);
};

/** 暗語名あて: 正本どおり短い局宛てを多めに（MONIN SHANGHAI 型） */
const buildAddressEnCodes = () => {
  if (Math.random() < 0.75) {
    return `${pick(['YUSEN', 'MONIN', 'TOHMEN', 'KK HONDA'])} ${pick(['TOKYO', 'SHANGHAI', 'MARSEILLE', 'KUMAMOTO'])}`;
  }
  return buildAddressEn();
};

/** 発信局: 陸地名 or 船名/コール */
const buildOriginEn = () => {
  if (Math.random() < 0.45) return pick(ORIGINS_LAND);
  const ship = pick(ORIGIN_SHIPS);
  return `${ship.name}/${ship.call}`;
};

/**
 * 名あて癖（練習帳）:
 * - CARE / HOTEL 付き
 * - 船名/コール + 経由局
 * - 短い局宛て（YUSEN TOKYO 等）
 */
const buildAddressEn = () => {
  const roll = Math.random();
  if (roll < 0.4) {
    const ship = pick(SHIP_ADDR);
    const call = ship.call ? `/${ship.call}` : '';
    return `${ship.person} ${ship.name}${call} ${ship.via}`;
  }
  if (roll < 0.7) {
    return `${pick(ADDRESS_PERSONS)} CARE ${pick(ADDRESS_PLACES)}`;
  }
  if (roll < 0.85) {
    return `${pick(ADDRESS_PERSONS)} ${pick(ADDRESS_PLACES)}`;
  }
  return `${pick(['YUSEN', 'MONIN', 'TOHMEN'])} ${pick(['TOKYO', 'SHANGHAI', 'MARSEILLE', 'KUMAMOTO'])}`;
};

/**
 * 受付時刻
 * - class1（後編 p51〜）: 24時制 HHMM
 * - class3（前編）: 12時制。印刷は `45M`/`32S`/`3M` 等。告示では時と分の間を語間隔。
 */
const buildFilingTime = (examClass: TelegramExamClass) => {
  if (examClass === 'class1') {
    const hour = Math.floor(Math.random() * 24);
    const minute = Math.floor(Math.random() * 60);
    return `${pad2(hour)}${pad2(minute)}`;
  }
  const hour = 1 + Math.floor(Math.random() * 12);
  const minute = Math.floor(Math.random() * 60);
  const meridiem = Math.random() < 0.5 ? 'M' : 'S';
  // 時と分の間は語間隔（点7個分）→ 空白で表現。分0のときは時のみ+ M/S（帳の `3M` 形）
  if (minute === 0) return `${hour}${meridiem}`;
  return `${hour} ${pad2(minute)}${meridiem}`;
};

const buildDate = () => String(1 + Math.floor(Math.random() * 28));

/**
 * 欧文電報の送信文（正本どおり）:
 * [HRHR] NR {番号} {発信局} {語数} [{日}] {時刻} = {名あて} = {本文}[ =署名] [+]
 *
 * **1通目のみ HRHR**。2通目以降は通間5秒のあと **NR から**（H30.9実録／解説）。
 * BT は `=`、AR は `+`。`[BT]` / `[AR]` 表記でも再生可。
 * **最終通の最終ページは AR なし**（次がないため）。
 */
export function formatTelegramPlayText(parts: {
  number: string;
  office: string;
  count: string;
  date?: string;
  time: string;
  address: string;
  body: string;
  signature?: string;
  /** false で2通目以降（既定 true） */
  includeHrhr?: boolean;
  /** false で末尾の AR(+) を付けない（最終通の最終ページ。既定 true） */
  includeAr?: boolean;
}): string {
  const preamble = [
    parts.includeHrhr === false ? '' : 'HRHR',
    'NR',
    parts.number,
    parts.office,
    parts.count,
    parts.date,
    parts.time,
  ].filter(Boolean).join(' ');
  const sig = parts.signature ? ` =${parts.signature}` : '';
  const ar = parts.includeAr === false ? '' : ' +';
  return `${preamble} = ${parts.address} = ${parts.body}${sig}${ar}`;
}

/** 略体数字トークン（受付時刻用） */
const toCutDigits = (value: number | string) =>
  Array.from(String(value)).map((digit) => `[${digit}]`).join('');

/**
 * 和文受付時刻の送信形（H30.9実録）:
 * `セ`/`コ` + 時(1–12・略体) + `、` + 分(2桁略体)
 * セ＝午前、コ＝午後。時はゼロ埋めしない（例: 午後5時38分 → `コ [5]、[3][8]`）。
 */
export function formatWabunFilingTimePlay(hour24: number, minute: number): string {
  const meridiem = hour24 < 12 ? 'セ' : 'コ';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${meridiem} ${toCutDigits(hour12)}、${toCutDigits(pad2(minute))}`;
}

/** 額表印刷用: `セ 5字38分` */
export function formatWabunFilingTimeLabel(hour24: number, minute: number): string {
  const meridiem = hour24 < 12 ? 'セ' : 'コ';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${meridiem} ${hour12}字${pad2(minute)}分`;
}

/**
 * 和文電報の送信文（正本: docs/exam_wabun_telegram_canon.md / 告示721号 / H30.9実録）:
 * [HRHR] 、 {字数} [{ハツ}局] [{タナ}番号] {セ|コ}{時}、{分} 、 {名あて} [ホレ] {本文} [ラタ]
 * **1通目のみ HRHR**。2通目以降は休止なしで続けて `、` から（欧文の通間休止とは異なる）。
 */
export function formatWabunTelegramPlayText(parts: {
  number: string;
  office: string;
  officeNumeric?: boolean;
  count: string;
  hour: number;
  minute: number;
  address: string;
  body: string;
  special?: string;
  officeNote?: string;
  /** false で2通目以降（既定 true） */
  includeHrhr?: boolean;
}): string {
  const office = parts.officeNumeric ? `ハツ${parts.office}` : parts.office;
  const serial = parts.officeNumeric ? `タナ${parts.number}` : parts.number;
  const time = formatWabunFilingTimePlay(parts.hour, parts.minute);
  const special = parts.special ? ` [特] ${parts.special}` : '';
  const note = parts.officeNote ? ` [局] ${parts.officeNote}` : '';
  return [
    parts.includeHrhr === false ? '' : 'HRHR',
    '、',
    parts.count,
    office,
    serial,
    time,
    `${special}${note}`.trim(),
    '、',
    parts.address,
    '[ホレ]',
    parts.body,
    '[ラタ]',
  ].filter((part) => part !== '').join(' ').replace(/\s+/g, ' ').trim();
}

const buildAddressJa = () => {
  const station = pick(COAST_STATIONS_JA);
  const roll = Math.random();
  if (roll < 0.5) {
    return `${station}」${pick(WABUN_SHIPS)}」${pick(WABUN_PERSONS)}`;
  }
  if (roll < 0.8) {
    return `${station}」${pick(WABUN_PLACES)}」${pick(WABUN_PERSONS)}`;
  }
  return `${pick(WABUN_PERSONS)}」${pick(WABUN_PLACES)}`;
};

export type ExamLedger = {
  sheet: number;
  kind: string;
  count: string;
  office: string;
  number: string;
  receivedAt: string;
  address: string;
  body: string;
  playText: string;
  signature?: string;
  date?: string;
  /** 和文2枚目以降: 額表ヘッダ・名あて無しの本文グリッドのみ */
  continuation?: boolean;
};

export type ExamSession = {
  subjectId: ExamSubjectId;
  telegram: boolean;
  examClass: TelegramExamClass;
  sheets: ExamLedger[];
  playText: string;
  totalChars: number;
  targetChars: number;
  /** 試験開始アナウンス（H30.9実録: `シケン シケン`）。採点本文には含めない */
  announcement?: string;
  /** 和文ランダム本文（練習専用・本試験には無い形式）。採点はするが記録しない */
  practiceRandom?: boolean;
};

/** 試験直前の呼称（実録どおり。和文符号で送る） */
export const EXAM_ANNOUNCEMENT = 'シケン シケン';

function buildOneSheet(options: {
  sheet: number;
  subjectId: ExamSubjectId;
  telegram: boolean;
  bodyChars: number;
  examClass: TelegramExamClass;
  /** 2通目以降は false（欧文は NR から） */
  includeHrhr?: boolean;
  /** false で末尾 AR(+) なし（最終通。既定 true） */
  includeAr?: boolean;
  /** 和文本文に ヰ・ヱ を含める */
  includeWiWe?: boolean;
}): ExamLedger {
  const subject = EXAM_SUBJECTS[options.subjectId];
  const number = String(1 + Math.floor(Math.random() * 80));
  const receivedAt = buildFilingTime(options.examClass);
  // 1総通は日付省略例あり。3総通は日付付きが基本。
  const date = options.examClass === 'class3' || Math.random() < 0.65 ? buildDate() : undefined;
  const includeHrhr = options.includeHrhr !== false;
  const includeAr = options.includeAr !== false;
  const includeWiWe = options.includeWiWe === true;

  if (options.subjectId === 'codes') {
    const body = buildCodeBody(options.bodyChars);
    if (!options.telegram) {
      return {
        sheet: options.sheet,
        kind: subject.kindLabel,
        count: String(compactLen(body)),
        office: buildOriginEn(),
        number,
        receivedAt,
        address: '—',
        body,
        playText: body,
        date,
      };
    }
    const office = buildOriginEn();
    const address = buildAddressEnCodes();
    // 暗語正本ページに署名はほぼ無い
    const signature = undefined;
    const count = wordCountLabel(address, body, signature);
    const playText = formatTelegramPlayText({
      number, office, count, date, time: receivedAt, address, body, signature, includeHrhr, includeAr,
    });
    return {
      sheet: options.sheet,
      kind: 'ORDINARY',
      count,
      office,
      number,
      receivedAt,
      address,
      body,
      playText,
      signature,
      date,
    };
  }

  if (options.telegram) {
    if (subject.alphabet === 'wabun') {
      const officeNumeric = Math.random() < 0.45;
      const office = officeNumeric ? String(1 + Math.floor(Math.random() * 80)) : pick(COAST_STATIONS_JA);
      const address = buildAddressJa();
      const body = buildWabunBody(options.bodyChars, includeWiWe);
      const count = String(compactLen(body));
      const hour = Math.floor(Math.random() * 24);
      const minute = Math.floor(Math.random() * 60);
      const playText = formatWabunTelegramPlayText({
        number,
        office,
        officeNumeric,
        count,
        hour,
        minute,
        address,
        body,
        includeHrhr,
      });
      return {
        sheet: options.sheet,
        kind: '和文電報',
        count,
        office: officeNumeric ? `ハツ${office}` : office,
        number: officeNumeric ? `タナ${number}` : number,
        receivedAt: `${pad2(hour)}${pad2(minute)}`,
        address,
        body,
        playText,
      };
    }

    const office = buildOriginEn();
    const address = buildAddressEn();
    const body = buildPlainBody('international', options.bodyChars);
    const signature = Math.random() < 0.55 ? pick(SIGNATURES) : undefined;
    const count = wordCountLabel(address, body, signature);
    const playText = formatTelegramPlayText({
      number, office, count, date, time: receivedAt, address, body, signature, includeHrhr, includeAr,
    });
    return {
      sheet: options.sheet,
      kind: 'ORDINARY',
      count,
      office,
      number,
      receivedAt,
      address,
      body,
      playText,
      signature,
      date,
    };
  }

  const body = subject.alphabet === 'wabun'
    ? buildWabunBody(options.bodyChars, includeWiWe)
    : buildPlainBody(subject.alphabet, options.bodyChars);
  return {
    sheet: options.sheet,
    kind: subject.kindLabel,
    count: String(compactLen(body)),
    office: subject.alphabet === 'wabun' ? pick(COAST_STATIONS_JA) : buildOriginEn(),
    number,
    receivedAt,
    address: '—',
    body,
    playText: body,
    date,
  };
}

/** 本文をページサイズで分割（空白除去後） */
function chunkWabunBody(body: string, pageSize = WABUN_BODY_CHARS_PER_PAGE): string[] {
  const compact = body.replace(/\s+/g, '');
  if (!compact) return [''];
  const chunks: string[] = [];
  for (let index = 0; index < compact.length; index += pageSize) {
    chunks.push(compact.slice(index, index + pageSize));
  }
  return chunks;
}

/** 1通分の和文額表ページ（1枚〜複数枚。続きは本文のみ）を作る */
function buildOneWabunTelegram(options: {
  bodyChars: number;
  startSheet: number;
  examClass: TelegramExamClass;
  includeHrhr?: boolean;
  includeWiWe?: boolean;
  /** 本文を外から渡す（ランダム本文）。無ければ普通語コーパスから作る */
  body?: string;
}): ExamLedger[] {
  const number = String(1 + Math.floor(Math.random() * 80));
  const officeNumeric = Math.random() < 0.45;
  const officeRaw = officeNumeric ? String(1 + Math.floor(Math.random() * 80)) : pick(COAST_STATIONS_JA);
  const office = officeNumeric ? `ハツ${officeRaw}` : officeRaw;
  const serial = officeNumeric ? `タナ${number}` : number;
  const address = buildAddressJa();
  const fullBody = options.body ?? buildWabunBody(options.bodyChars, options.includeWiWe === true);
  const chunks = chunkWabunBody(fullBody, WABUN_BODY_CHARS_PER_PAGE);
  const totalCount = String(compactLen(fullBody));
  const hour = Math.floor(Math.random() * 24);
  const minute = Math.floor(Math.random() * 60);
  const receivedAt = `${pad2(hour)}${pad2(minute)}`;
  const includeHrhr = options.includeHrhr !== false;

  return chunks.map((chunk, index) => {
    const continuation = index > 0;
    const isLast = index === chunks.length - 1;
    let playText: string;
    if (!continuation) {
      playText = formatWabunTelegramPlayText({
        number: officeNumeric ? number : serial,
        office: officeNumeric ? officeRaw : office,
        officeNumeric,
        count: totalCount,
        hour,
        minute,
        address,
        body: chunk,
        includeHrhr,
      });
      if (!isLast) playText = playText.replace(/ \[ラタ\]$/, ' ウホ');
    } else {
      playText = isLast ? `${chunk} [ラタ]` : `${chunk} ウホ`;
    }
    return {
      sheet: options.startSheet + index,
      kind: '和文電報',
      count: totalCount,
      office,
      number: serial,
      receivedAt,
      address: continuation ? '—' : address,
      body: chunk,
      playText,
      continuation,
    };
  });
}

/**
 * 和文額表セッション:
 * 本試験は **2通・合計5枚** 固定。
 * 枚数の割り振りは (2+3) または (3+2)。各通の最終ページだけ字数端数あり。
 * `practiceBodyChars` 指定時は練習用の単通（枚数は字数次第）。
 */
function bodyCharsForWabunPages(pages: number): number {
  if (pages <= 1) return 40 + Math.floor(Math.random() * 21); // 40–60 → 1枚
  // H30.9実録: 138=60+60+18（3枚）、87=60+27（2枚）。最終ページは短め。
  const lastMin = pages >= 3 ? 15 : 20;
  const lastMax = pages >= 3 ? 40 : 40;
  const last = lastMin + Math.floor(Math.random() * (lastMax - lastMin + 1));
  return (pages - 1) * WABUN_BODY_CHARS_PER_PAGE + last;
}

function buildWabunTelegramSheets(options: {
  examClass: TelegramExamClass;
  /** 練習用の本文総字数上書き（単通） */
  practiceBodyChars?: number;
  includeWiWe?: boolean;
}): ExamLedger[] {
  const appendTelegram = (bodyChars: number, startSheet: number, includeHrhr: boolean) =>
    buildOneWabunTelegram({
      bodyChars,
      startSheet,
      examClass: options.examClass,
      includeHrhr,
      includeWiWe: options.includeWiWe,
    });

  if (options.practiceBodyChars != null) {
    return appendTelegram(Math.max(1, options.practiceBodyChars), 1, true);
  }

  // 本試験: 2通・5枚。よくある (2+3)/(3+2)。2通目は HRHR なし
  const firstPages = Math.random() < 0.5 ? 2 : 3;
  const secondPages = 5 - firstPages;
  const first = appendTelegram(bodyCharsForWabunPages(firstPages), 1, true);
  const second = appendTelegram(bodyCharsForWabunPages(secondPages), 1 + first.length, false);
  return [...first, ...second];
}

/** ランダム本文は普通語より符号が長いので、作るたびに測って5分に収める */
const RANDOM_WABUN_MAX_SEC = 290;
/** 字数を詰めても各通の最終ページに残す字数 */
const RANDOM_WABUN_LAST_PAGE_MIN = 10;

/** 和文ランダム本文の額表（2通・5枚）。苦手な字ほど多く出る */
function buildRandomWabunSheets(options: {
  examClass: TelegramExamClass;
  weakness: WabunWeakness;
  includeWiWe: boolean;
}): ExamLedger[] {
  const firstPages = Math.random() < 0.5 ? 2 : 3;
  const pages = [firstPages, 5 - firstPages];
  const chars = pages.map(bodyCharsForWabunPages);
  const floor = pages.map((count) => (count - 1) * WABUN_BODY_CHARS_PER_PAGE + RANDOM_WABUN_LAST_PAGE_MIN);
  const wpm = EXAM_SUBJECTS.wabun.wpm;
  let sheets: ExamLedger[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bodies = buildRandomWabunBodies(chars, { weakness: options.weakness, includeWiWe: options.includeWiWe });
    const first = buildOneWabunTelegram({ bodyChars: chars[0], startSheet: 1, examClass: options.examClass, body: bodies[0] });
    const second = buildOneWabunTelegram({
      bodyChars: chars[1],
      startSheet: 1 + first.length,
      examClass: options.examClass,
      includeHrhr: false,
      body: bodies[1],
    });
    sheets = [...first, ...second];
    if (measureExamAudioSec(sheets, 'wabun', wpm) <= RANDOM_WABUN_MAX_SEC) break;
    chars.forEach((count, index) => { chars[index] = Math.max(floor[index], count - 8); });
  }
  return sheets;
}

function sheetsFromStoredWabun(set: StoredWabunSet, includeWiWe: boolean): ExamLedger[] {
  const sheets: ExamLedger[] = [];
  let sheetNo = 1;
  set.telegrams.forEach((telegram, telegramIndex) => {
    const fullBody = applyWabunWiWe(telegram.body, includeWiWe);
    const chunks = chunkWabunBody(fullBody);
    const totalCount = String(compactLen(fullBody));
    const office = telegram.officeNumeric ? `ハツ${telegram.office}` : telegram.office;
    const serial = telegram.officeNumeric ? `タナ${telegram.number}` : telegram.number;
    const receivedAt = `${pad2(telegram.hour)}${pad2(telegram.minute)}`;
    chunks.forEach((chunk, index) => {
      const continuation = index > 0;
      const isLast = index === chunks.length - 1;
      let playText: string;
      if (!continuation) {
        playText = formatWabunTelegramPlayText({
          number: telegram.officeNumeric ? telegram.number : serial,
          office: telegram.officeNumeric ? telegram.office : office,
          officeNumeric: telegram.officeNumeric,
          count: totalCount,
          hour: telegram.hour,
          minute: telegram.minute,
          address: telegram.address,
          body: chunk,
          includeHrhr: telegramIndex === 0,
        });
        if (!isLast) playText = playText.replace(/ \[ラタ\]$/, ' ウホ');
      } else {
        playText = isLast ? `${chunk} [ラタ]` : `${chunk} ウホ`;
      }
      sheets.push({
        sheet: sheetNo,
        kind: '和文電報',
        count: totalCount,
        office,
        number: serial,
        receivedAt,
        address: continuation ? '—' : telegram.address,
        body: chunk,
        playText,
        continuation,
      });
      sheetNo += 1;
    });
  });
  return sheets;
}

function sheetsFromStoredOubun(
  set: StoredPlainSet | StoredCodesSet,
  examClass: TelegramExamClass,
): ExamLedger[] {
  const kind = set.subjectId === 'codes' ? EXAM_SUBJECTS.codes.kindLabel : 'ORDINARY';
  return set.telegrams.map((telegram, index) => {
    const signature = set.subjectId === 'plain' ? telegram.signature : undefined;
    const count = wordCountLabel(telegram.address, telegram.body, signature);
    const date = telegram.date ?? (examClass === 'class3' ? buildDate() : undefined);
    const playText = formatTelegramPlayText({
      number: telegram.number,
      office: telegram.office,
      count,
      date,
      time: telegram.receivedAt,
      address: telegram.address,
      body: telegram.body,
      signature,
      includeHrhr: index === 0,
      includeAr: index < set.telegrams.length - 1,
    });
    return {
      sheet: index + 1,
      kind: set.subjectId === 'codes' ? 'ORDINARY' : kind,
      count,
      office: telegram.office,
      number: telegram.number,
      receivedAt: telegram.receivedAt,
      address: telegram.address,
      body: telegram.body,
      playText,
      signature,
      date,
    };
  });
}

function sessionFromStoredSet(
  stored: StoredExamSet,
  options: { examClass: TelegramExamClass; includeWiWe: boolean; telegram: boolean },
): ExamSession {
  const sheets = stored.subjectId === 'wabun'
    ? sheetsFromStoredWabun(stored, options.includeWiWe)
    : sheetsFromStoredOubun(stored, options.examClass);
  const playText = sheets.map((sheet) => sheet.playText).join('\n\n');
  const bodyTotal = sheets.reduce((sum, sheet) => sum + compactLen(sheet.body), 0);
  return {
    subjectId: stored.subjectId,
    telegram: options.telegram,
    examClass: options.examClass,
    sheets,
    playText,
    totalChars: compactLen(playText),
    targetChars: bodyTotal,
    announcement: EXAM_ANNOUNCEMENT,
  };
}

/** 公式総文字数を目安に出題。欧文・和文額表とも2通構成（和文額表は5枚）。 */
export function buildExamSession(options: {
  subjectId: ExamSubjectId;
  telegram: boolean;
  /** 省略時は1・2総通（後編・24時制） */
  examClass?: TelegramExamClass;
  /** 和文額表の本文総字数上書き（例: 100字練習） */
  wabunBodyChars?: number;
  /** 和文本文に井戸のヰ・カギのあるヱを含める（既定 false） */
  includeWiWe?: boolean;
  /** true で事前JSONセットを使わず従来のその場生成 */
  procedural?: boolean;
  /** 事前セット（lib/examSets の pickStoredExamSet で取得）。無ければその場生成 */
  stored?: StoredExamSet | null;
  /** 和文額表をランダム本文で出す（練習専用）。苦手度は wabunWeakness で作る */
  randomWabun?: { weakness: WabunWeakness };
}): ExamSession {
  const subject = EXAM_SUBJECTS[options.subjectId];
  const examClass = options.examClass ?? 'class1';
  const target = subject.totalChars;
  const headerBudget = options.telegram ? (options.subjectId === 'wabun' ? 40 : 70) : 0;
  const includeWiWe = options.subjectId === 'wabun' && options.includeWiWe === true;

  if (options.subjectId === 'wabun' && options.telegram && options.randomWabun) {
    const sheets = buildRandomWabunSheets({ examClass, weakness: options.randomWabun.weakness, includeWiWe });
    const playText = sheets.map((sheet) => sheet.playText).join('\n\n');
    return {
      subjectId: options.subjectId,
      telegram: true,
      examClass,
      sheets,
      playText,
      totalChars: compactLen(playText),
      targetChars: sheets.reduce((sum, sheet) => sum + compactLen(sheet.body), 0),
      announcement: EXAM_ANNOUNCEMENT,
      practiceRandom: true,
    };
  }

  // 本試験（電報）は事前作文セットを優先。練習用字数上書き時のみ従来生成。
  const stored = options.stored;
  if (options.telegram && !options.procedural && options.wabunBodyChars == null && stored?.subjectId === options.subjectId) {
    return sessionFromStoredSet(stored, { examClass, includeWiWe, telegram: true });
  }

  if (options.subjectId === 'wabun' && options.telegram) {
    const sheets = buildWabunTelegramSheets({
      examClass,
      practiceBodyChars: options.wabunBodyChars,
      includeWiWe,
    });
    const playText = sheets.map((sheet) => sheet.playText).join('\n\n');
    const bodyTotal = sheets.reduce((sum, sheet) => sum + compactLen(sheet.body), 0);
    return {
      subjectId: options.subjectId,
      telegram: options.telegram,
      examClass,
      sheets,
      playText,
      totalChars: compactLen(playText),
      targetChars: options.wabunBodyChars ?? bodyTotal,
      announcement: EXAM_ANNOUNCEMENT,
    };
  }

  const pageBodyChars = options.telegram && options.subjectId === 'codes'
    ? CODE_BODY_CHARS_PER_PAGE
    : null;

  let bodyTargets: number[];
  if (pageBodyChars != null) {
    bodyTargets = [pageBodyChars, pageBodyChars];
  } else {
    const first = Math.ceil(target / 2);
    const second = Math.max(1, target - first);
    bodyTargets = [Math.max(40, first - headerBudget), Math.max(40, second - headerBudget)];
  }

  const sheets = bodyTargets.map((bodyChars, index) => buildOneSheet({
    sheet: index + 1,
    subjectId: options.subjectId,
    telegram: options.telegram,
    bodyChars,
    examClass,
    includeHrhr: index === 0,
    // 最終通は次がないので AR なし
    includeAr: index < bodyTargets.length - 1,
    includeWiWe,
  }));

  let playText = sheets.map((sheet) => sheet.playText).join('\n\n');
  let totalChars = compactLen(playText);
  if (options.telegram && pageBodyChars == null && totalChars < target - 40) {
    const deficit = Math.min(40, target - 30 - totalChars);
    if (deficit > 0) {
      const pad = subject.alphabet === 'wabun'
        ? buildWabunBody(deficit, includeWiWe)
        : buildPlainBody(subject.alphabet, deficit);
      const last = sheets[sheets.length - 1];
      last.body = alphabetJoin(subject.alphabet, last.body, pad);
      rebuildTelegramPlayText(last, subject.alphabet);
    }
  }
  if (pageBodyChars == null) {
    const minBody = options.subjectId === 'codes' ? 80 : 36;
    fitSheetsToDuration(sheets, subject.alphabet, subject.wpm, subject.durationSec - 1, minBody);
  }
  playText = sheets.map((sheet) => sheet.playText).join('\n\n');
  totalChars = compactLen(playText);
  return {
    subjectId: options.subjectId,
    telegram: options.telegram,
    examClass,
    sheets,
    playText,
    totalChars,
    targetChars: target,
    announcement: EXAM_ANNOUNCEMENT,
  };
}

const alphabetJoin = (alphabet: AlphabetType, left: string, right: string) => (
  alphabet === 'wabun' ? `${left}、${right}` : `${left} ${right}`
).trim();

export function buildExamLedger(options: {
  alphabet: AlphabetType;
  telegram: boolean;
  words?: number;
  examClass?: TelegramExamClass;
}): ExamLedger {
  const subjectId: ExamSubjectId = options.alphabet === 'wabun' ? 'wabun' : 'plain';
  const target = options.words ? Math.max(40, options.words * 5) : EXAM_SUBJECTS[subjectId].totalChars / 2;
  return buildOneSheet({
    sheet: 1,
    subjectId,
    telegram: options.telegram,
    bodyChars: target,
    examClass: options.examClass ?? 'class1',
  });
}

export const telegramText = () => buildExamSession({ subjectId: 'plain', telegram: true }).sheets[0].playText;

/** 欧文の通間／枚間休止（秒）。和文は休止なしで続ける */
export const EXAM_SHEET_GAP_SEC = 5;

/** 欧文のみ通間休止。和文は 0（続けて送る） */
export function examSheetGapSec(alphabet: AlphabetType): number {
  return alphabet === 'wabun' ? 0 : EXAM_SHEET_GAP_SEC;
}

const examAudioSettings = (wpm: number): AudioSettings => ({
  pitch: 770,
  volume: 0.2,
  characterSpeed: wpm,
  effectiveSpeed: wpm,
  waveform: 'sawtooth',
  attack: 0.005,
  release: 0.005,
  reverb: false,
});

function rebuildTelegramPlayText(sheet: ExamLedger, alphabet: AlphabetType): void {
  if (sheet.continuation || sheet.address === '—') {
    const end = sheet.playText.trim().endsWith('[ラタ]')
      ? ' [ラタ]'
      : sheet.playText.trim().endsWith('ウホ')
        ? ' ウホ'
        : '';
    sheet.playText = `${sheet.body}${end}`.trim();
    return;
  }
  if (alphabet === 'wabun') {
    const hour = Number(sheet.receivedAt.slice(0, 2));
    const minute = Number(sheet.receivedAt.slice(2, 4));
    const officeNumeric = sheet.office.startsWith('ハツ');
    const office = officeNumeric ? sheet.office.replace(/^ハツ/, '') : sheet.office;
    const serial = officeNumeric ? sheet.number.replace(/^タナ/, '') : sheet.number;
    sheet.playText = formatWabunTelegramPlayText({
      number: serial,
      office,
      officeNumeric,
      count: sheet.count,
      hour,
      minute,
      address: sheet.address,
      body: sheet.body,
      includeHrhr: sheet.playText.startsWith('HRHR'),
    });
    return;
  }
  sheet.count = wordCountLabel(
    sheet.address,
    sheet.body,
    sheet.signature,
  );
  sheet.playText = formatTelegramPlayText({
    number: sheet.number,
    office: sheet.office,
    count: sheet.count,
    date: sheet.date,
    time: sheet.receivedAt,
    address: sheet.address,
    body: sheet.body,
    signature: sheet.signature,
    includeHrhr: sheet.playText.startsWith('HRHR'),
    includeAr: /\+\s*$/.test(sheet.playText),
  });
}

export function measureExamAudioSec(
  sheets: ExamLedger[],
  alphabet: AlphabetType,
  wpm: number,
  announcement?: string,
): number {
  const settings = examAudioSettings(wpm);
  let audio = 0;
  const sheetGap = examSheetGapSec(alphabet);
  if (announcement) {
    // シケンは和文符号。呼称→第1通の間は科目共通で欧文と同じ休止（WARNING 演出用）
    audio += buildMorseTimeline(announcement, 'wabun', settings).duration + EXAM_SHEET_GAP_SEC;
  }
  for (const sheet of sheets) {
    audio += buildMorseTimeline(sheet.playText, alphabet, settings).duration;
  }
  if (sheets.length > 1) audio += sheetGap * (sheets.length - 1);
  return audio;
}

/** 実再生が制限時間を超えないよう本文を削る（語間隔込みの壁時計） */
function fitSheetsToDuration(
  sheets: ExamLedger[],
  alphabet: AlphabetType,
  wpm: number,
  budgetSec: number,
  minBodyChars = 48,
) {
  let guard = 0;
  while (guard < 100) {
    const audio = measureExamAudioSec(sheets, alphabet, wpm);
    if (audio <= budgetSec) break;
    const candidate = [...sheets].sort((left, right) => compactLen(right.body) - compactLen(left.body))[0];
    const bodyLen = compactLen(candidate.body);
    if (bodyLen <= minBodyChars) break;
    const overSec = audio - budgetSec;
    const trimBy = Math.min(bodyLen - minBodyChars, Math.max(12, Math.ceil(overSec * 3)));
    candidate.body = bodyLooksLikeCodes(candidate.body)
      ? trimCodeBodyToChars(candidate.body, bodyLen - trimBy)
      : trimToChars(candidate.body, bodyLen - trimBy);
    rebuildTelegramPlayText(candidate, alphabet);
    guard += 1;
  }
}
