#!/usr/bin/env node
/**
 * 和文コッホ順の再計算と検証（docs/wabun_koch_method.md）。
 *
 *   node scripts/wabunKochOrder.mjs
 *
 * 1. data/exam/sets.json の和文普通語（宛先＋本文）から出現頻度を数える。濁音・半濁音は本体＋゛／゜に分ける。
 * 2. 先頭（カ・タ・゛）を固定し、残りを「直前 3 字と符号の編集距離 ≥ 2 の字の中で最も頻度の高い字」から順に選ぶ。
 * 3. lib/koch.ts の WABUN_KOCH_ORDER と比べ、N 字習得時点の文字カバー率をイロハ順と並べて出す。
 */
import { readFileSync } from 'node:fs';

const CODE = {
  イ: '.-', ロ: '.-.-', ハ: '-...', ニ: '-.-.', ホ: '-..', ヘ: '.', ト: '..-..', チ: '..-.', リ: '--.', ヌ: '....',
  ル: '-.--.', ヲ: '.---', ワ: '-.-', カ: '.-..', ヨ: '--', タ: '-.', レ: '---', ソ: '---.', ツ: '.--.', ネ: '--.-',
  ナ: '.-.', ラ: '...', ム: '-', ウ: '..-', ヰ: '.-..-', ノ: '..--', オ: '.-...', ク: '...-', ヤ: '.--', マ: '-..-',
  ケ: '-.--', フ: '--..', コ: '----', エ: '-.---', テ: '.-.--', ア: '--.--', サ: '-.-.-', キ: '-.-..', ユ: '-..--',
  メ: '-...-', ミ: '..-.-', シ: '--.-.', ヱ: '.--..', ヒ: '--..-', モ: '-..-.', セ: '.---.', ス: '---.-', ン: '.-.-.',
  'ー': '.--.-', '、': '.-.-.-', '」': '.-.-..', '゛': '..', '゜': '..--.',
};
const PREFIX = ['カ', 'タ', '゛'];
const WINDOW = 3;
const SMALL = { ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ', ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ', ヵ: 'カ', ヶ: 'ケ' };

const levenshtein = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
};

const sets = JSON.parse(readFileSync(new URL('../data/exam/sets.json', import.meta.url), 'utf8'));
const freq = Object.fromEntries(Object.keys(CODE).map((k) => [k, 0]));
for (const set of sets.wabun) {
  for (const telegram of set.telegrams) {
    for (const char of `${telegram.address}${telegram.body}`.normalize('NFD')) {
      const unit = char === '゙' ? '゛' : char === '゚' ? '゜' : SMALL[char] ?? char;
      if (unit in freq) freq[unit] += 1;
    }
  }
}
const total = Object.values(freq).reduce((a, b) => a + b, 0);

const order = [...PREFIX];
const rest = Object.keys(CODE).filter((k) => !order.includes(k));
while (rest.length) {
  rest.sort((a, b) => {
    const ok = (c) => Math.min(...order.slice(-WINDOW).map((r) => levenshtein(CODE[c], CODE[r]))) >= 2;
    return Number(ok(b)) - Number(ok(a)) || freq[b] - freq[a];
  });
  order.push(rest.shift());
}

const iroha = [...'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセスン', '゛', '゜', 'ー', '、', '」'];
const coverage = (list, n) => ((100 * list.slice(0, n).reduce((sum, c) => sum + freq[c], 0)) / total).toFixed(0);

const current = readFileSync(new URL('../lib/koch.ts', import.meta.url), 'utf8')
  .match(/WABUN_KOCH_ORDER = \[([\s\S]*?)\] as const/)?.[1]
  .match(/'([^']+)'/g)
  ?.map((s) => s.slice(1, -1)) ?? [];

console.log('頻度上位:', Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12)
  .map(([k, v]) => `${k} ${((100 * v) / total).toFixed(1)}%`).join('  '));
console.log('計算した順:', order.join(' '));
console.log('lib/koch.ts:', current.join(' '));
console.log(current.join() === order.join() ? '一致' : '※ lib/koch.ts と違います');
for (const n of [5, 10, 15, 20, 30]) console.log(`${n} 字: イロハ ${coverage(iroha, n)}% / 和文コッホ ${coverage(order, n)}%`);
