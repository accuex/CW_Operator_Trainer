/**
 * 和文ランダム本文（練習専用）。本試験の和文は普通語のみで、暗語（ランダム）は出題されない。
 * 文脈で補えない字の聞き取りと、普通語では出にくい字（ヌ・ヘ・゜・数字・記号）の練習用。
 *
 * - 1セットの中で清音カナと記号（ー 、 」 （）) は必ず1回以上出す
 * - 残りは苦手分析と同じ回答記録から、誤りの多い字ほど多く出す
 * - 記号は本文の先頭・末尾に置かず、記号同士を並べない。括弧は対で中身2〜4字
 */
import { forWeakAnalysis } from './analytics';
import type { AnswerLog } from './types';

const KANA = [...'イロハニホヘトチリヌルヲワカヨタレソツネナラムウノオクヤマケフコエテアサキユメミシヒモセスン'];
const WI_WE = ['ヰ', 'ヱ'];
const VOICED = [...'ガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポ'];
const DIGITS = [...'0123456789'];
/** 単独で挟む記号。括弧は BRACKET_PAIR として対で入れる */
const MARKS = ['ー', '、', '」'];
const BRACKET_PAIR = '（）';

/** 字の種類ごとの基本の出やすさ（清音=1） */
const BASE_WEIGHT = { kana: 1, voiced: 0.5, digit: 0.4, mark: 0.35, bracket: 0.25 } as const;
/** 記録の無い字の誤り率の見なし値（少し苦手寄りにして未練習の字も出す） */
const PRIOR_ERROR_RATE = 0.25;
const PRIOR_WEIGHT = 4;

export type WabunWeakness = ReadonlyMap<string, number>;

/** 和文の回答記録から字ごとの誤り率（記録が少ない字は PRIOR_ERROR_RATE に寄せる） */
export function wabunWeakness(logs: AnswerLog[]): WabunWeakness {
  const tally = new Map<string, { attempts: number; errors: number }>();
  for (const log of forWeakAnalysis(logs)) {
    if (log.alphabetType !== 'wabun') continue;
    const entry = tally.get(log.correctSymbol) ?? { attempts: 0, errors: 0 };
    entry.attempts += 1;
    if (!log.isCorrect) entry.errors += 1;
    tally.set(log.correctSymbol, entry);
  }
  const rates = new Map<string, number>();
  for (const [symbol, { attempts, errors }] of tally) {
    rates.set(symbol, (errors + PRIOR_ERROR_RATE * PRIOR_WEIGHT) / (attempts + PRIOR_WEIGHT));
  }
  return rates;
}

/** 苦手度による倍率。誤り率0で0.5倍、見なし値で1.5倍、50%で2.5倍 */
const weaknessFactor = (weakness: WabunWeakness, symbol: string) =>
  0.5 + 4 * (weakness.get(symbol) ?? PRIOR_ERROR_RATE);

type Entry = { symbol: string; weight: number };

const weightedPicker = (entries: Entry[], random: () => number) => {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  return () => {
    let roll = random() * total;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll < 0) return entry.symbol;
    }
    return entries[entries.length - 1].symbol;
  };
};

const shuffle = <T,>(items: T[], random: () => number) => {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
};

export interface RandomWabunOptions {
  weakness: WabunWeakness;
  includeWiWe: boolean;
  random?: () => number;
}

/**
 * 1セット分（通ごとの字数配列）のランダム本文を返す。
 * 必須の字（清音・記号）はセット全体で1回以上、通の字数に比例して振り分ける。
 */
export function buildRandomWabunBodies(charsPerTelegram: number[], options: RandomWabunOptions): string[] {
  const random = options.random ?? Math.random;
  const kana = options.includeWiWe ? [...KANA, ...WI_WE] : KANA;
  const letterPick = weightedPicker([
    ...kana.map((symbol) => ({ symbol, weight: BASE_WEIGHT.kana * weaknessFactor(options.weakness, symbol) })),
    ...VOICED.map((symbol) => ({ symbol, weight: BASE_WEIGHT.voiced * weaknessFactor(options.weakness, symbol) })),
    ...DIGITS.map((symbol) => ({ symbol, weight: BASE_WEIGHT.digit * weaknessFactor(options.weakness, symbol) })),
    { symbol: BRACKET_PAIR, weight: BASE_WEIGHT.bracket * weaknessFactor(options.weakness, '（') },
  ], random);
  const markPick = weightedPicker(
    MARKS.map((symbol) => ({ symbol, weight: BASE_WEIGHT.mark * weaknessFactor(options.weakness, symbol) })),
    random,
  );
  const innerPick = weightedPicker(kana.map((symbol) => ({ symbol, weight: weaknessFactor(options.weakness, symbol) })), random);

  const required = shuffle([...kana, ...MARKS, BRACKET_PAIR], random);
  const totalChars = charsPerTelegram.reduce((sum, chars) => sum + chars, 0);
  let cursor = 0;
  return charsPerTelegram.map((chars, index) => {
    const isLast = index === charsPerTelegram.length - 1;
    const share = isLast ? required.length - cursor : Math.round((required.length * chars) / totalChars);
    const mine = required.slice(cursor, cursor + share);
    cursor += share;
    return composeBody(chars, mine, { letterPick, markPick, innerPick, random });
  });
}

/** 記号以外の字（括弧の対を含む）を並べ、記号を間に挟んで chars 字ちょうどにする */
function composeBody(
  chars: number,
  required: string[],
  pickers: { letterPick: () => string; markPick: () => string; innerPick: () => string; random: () => number },
): string {
  const marks = required.filter((token) => MARKS.includes(token));
  const letters = required.filter((token) => !MARKS.includes(token));
  // 記号は全体の1割弱。必須分より少なくはしない
  const markTarget = Math.max(marks.length, Math.round(chars * 0.06));
  while (marks.length < markTarget) marks.push(pickers.markPick());

  const bracketBody = () => {
    const inner = 2 + Math.floor(pickers.random() * 3);
    return `（${Array.from({ length: inner }, () => pickers.innerPick()).join('')}）`;
  };
  const expand = (token: string) => (token === BRACKET_PAIR ? bracketBody() : token);
  const units = letters.map(expand);
  let length = units.reduce((sum, unit) => sum + unit.length, 0) + marks.length;
  while (length < chars) {
    const room = chars - length;
    let token = pickers.letterPick();
    if (token === BRACKET_PAIR && room < 6) token = pickers.innerPick();
    const unit = expand(token);
    if (unit.length > room) continue;
    units.push(unit);
    length += unit.length;
  }
  while (length > chars) {
    const dropAt = units.findIndex((unit) => unit.length === 1 && !required.includes(unit));
    const index = dropAt >= 0 ? dropAt : units.findIndex((unit) => unit.length === 1);
    if (index < 0) break;
    units.splice(index, 1);
    length -= 1;
  }

  const ordered = shuffle(units, pickers.random);
  // 記号を入れる隙間: 先頭・末尾を除き、同じ隙間には1つだけ。ー はカナの直後だけ
  const gaps = shuffle(Array.from({ length: Math.max(0, ordered.length - 1) }, (_, index) => index + 1), pickers.random);
  const placed = new Map<number, string>();
  for (const mark of marks) {
    const gap = gaps.find((candidate) => (
      !placed.has(candidate)
      && !placed.has(candidate - 1)
      && !placed.has(candidate + 1)
      && (mark !== 'ー' || /[ァ-ヶ]$/.test(ordered[candidate - 1]))
    ));
    if (gap == null) continue;
    placed.set(gap, mark);
  }
  const body = ordered.map((unit, index) => `${placed.get(index) ?? ''}${unit}`).join('');
  return padToLength(body, chars, pickers.innerPick);
}

/** 記号を置けなかった分の不足をカナで埋める（字数は必ず合わせる） */
const padToLength = (body: string, chars: number, pick: () => string) => {
  let out = body;
  while (out.length < chars) out += pick();
  return out;
};
