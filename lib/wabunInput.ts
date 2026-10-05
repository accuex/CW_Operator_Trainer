import { WABUN_MORSE, expandWabunVoicing } from './morse';

/**
 * 和文受信の入力補助。
 * IME を使わずに直接ローマ字で打てるようにし、採点前に電信表記（大書きカナ＋゛／゜分離）へそろえる。
 * 拗音・促音は電信慣例どおり大書き（kya → キヤ、tta → ツタ）。
 */

const VOWELS: Record<string, string> = { a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ' };

const ROWS: Record<string, string> = {
  k: 'カキクケコ', s: 'サシスセソ', t: 'タチツテト', n: 'ナニヌネノ', h: 'ハヒフヘホ',
  m: 'マミムメモ', r: 'ラリルレロ', g: 'ガギグゲゴ', z: 'ザジズゼゾ', d: 'ダヂヅデド',
  b: 'バビブベボ', p: 'パピプペポ',
};

const ROMAJI: Record<string, string> = (() => {
  const table: Record<string, string> = { ...VOWELS };
  for (const [consonant, kana] of Object.entries(ROWS)) {
    [...'aiueo'].forEach((vowel, index) => { table[consonant + vowel] = kana[index]; });
  }
  Object.assign(table, {
    ya: 'ヤ', yu: 'ユ', yo: 'ヨ', wa: 'ワ', wo: 'ヲ', wi: 'ヰ', we: 'ヱ',
    shi: 'シ', chi: 'チ', tsu: 'ツ', fu: 'フ', ji: 'ジ', si: 'シ', ti: 'チ', tu: 'ツ', hu: 'フ', zi: 'ジ',
    di: 'ヂ', du: 'ヅ', vu: 'ヴ',
    sha: 'シヤ', shu: 'シユ', sho: 'シヨ', she: 'シエ',
    cha: 'チヤ', chu: 'チユ', cho: 'チヨ', che: 'チエ',
    ja: 'ジヤ', ju: 'ジユ', jo: 'ジヨ', je: 'ジエ',
    fa: 'フア', fi: 'フイ', fe: 'フエ', fo: 'フオ',
    nn: 'ン', "n'": 'ン',
    xtu: 'ツ', ltu: 'ツ', xya: 'ヤ', xyu: 'ユ', xyo: 'ヨ',
  });
  for (const consonant of ['k', 's', 't', 'n', 'h', 'm', 'r', 'g', 'z', 'd', 'b', 'p']) {
    const base = ROWS[consonant][1];
    table[`${consonant}ya`] = `${base}ヤ`;
    table[`${consonant}yu`] = `${base}ユ`;
    table[`${consonant}yo`] = `${base}ヨ`;
  }
  return table;
})();

const KEYS_BY_LENGTH = [3, 2, 1];
const PREFIXES = new Set(Object.keys(ROMAJI).flatMap((key) => Array.from({ length: key.length - 1 }, (_, i) => key.slice(0, i + 1))));

/** 記号キー。@ ゛ と [ ゜ は JIS かな配列の位置にそろえる。 */
const PUNCTUATION: Record<string, string> = {
  '@': '゛', '[': '゜', ']': '」', ',': '、', '、': '、', '-': 'ー', 'ー': 'ー', '」': '」', '。': '」',
};

export const toKatakana = (value: string) =>
  value.replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));

/**
 * 入力欄用のライブ変換。確定したローマ字だけカナにし、打ちかけ（末尾の k, sh など）は残す。
 */
export function romajiToWabun(raw: string): string {
  const text = toKatakana(raw);
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const lower = char.toLowerCase();
    if (PUNCTUATION[char]) { out += PUNCTUATION[char]; index += 1; continue; }
    if (!/[a-z']/.test(lower)) { out += char; index += 1; continue; }

    const next = text[index + 1]?.toLowerCase();
    // nn: 後ろが母音・y なら「ン＋な行」（kanna → カンナ）、それ以外は ン
    if (lower === 'n' && next === 'n') {
      const after = text[index + 2]?.toLowerCase();
      if (!after) { out += text.slice(index); break; } // 打ちかけ（kann → kanna かもしれない）
      out += 'ン';
      index += after && /[aiueoy]/.test(after) ? 1 : 2;
      continue;
    }
    // 促音: 同じ子音の重ね（n 以外）→ ツ
    if (next === lower && lower !== 'n' && /[bcdfghjkmprstvwz]/.test(lower)) { out += 'ツ'; index += 1; continue; }

    let matched = false;
    for (const length of KEYS_BY_LENGTH) {
      const chunk = text.slice(index, index + length).toLowerCase();
      if (chunk.length === length && ROMAJI[chunk]) {
        out += ROMAJI[chunk];
        index += length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // n の直後が母音・y 以外 → ン
    if (lower === 'n' && next && !/[aiueoy']/.test(next)) { out += 'ン'; index += 1; continue; }

    const rest = text.slice(index).toLowerCase();
    if (PREFIXES.has(rest)) { out += text.slice(index); break; } // 打ちかけ
    out += char; // 変換できない文字はそのまま（採点では無視）
    index += 1;
  }
  return out;
}

/** 採点用。和文符号のある単位だけを残し、濁音・半濁音を本体＋゛／゜に分ける。 */
export function normalizeWabunCopy(raw: string): string {
  const text = romajiToWabun(raw).replace(/n{1,2}$/i, 'ン');
  return [...text]
    .flatMap((char) => expandWabunVoicing(char))
    .filter((unit) => Boolean(WABUN_MORSE[unit]) && !/^[0-9]$/.test(unit))
    .join('');
}
