import type { AlphabetType } from './types';
import type { CharacterKind } from './course';
import { artworkFor, type CardRarity, type CardTheme } from './cardArtwork';

export const INTERNATIONAL_MORSE: Record<string, string> = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..',
  J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.',
  S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....',
  6: '-....', 7: '--...', 8: '---..', 9: '----.',
  // 正本: docs/欧文電報送信練習帳.pdf（無線局運用規則 別表第1号）
  '.': '.-.-.-', ',': '--..--', ':': '---...', '?': '..--..', "'": '.----.',
  '-': '-....-', '(': '-.--.', ')': '-.--.-', '/': '-..-.',
  '=': '-...-', '+': '.-.-.', '"': '.-..-.', '@': '.--.-.',
  // 乗算記号×は X と同符号（-..-）。プロサインは括弧トークン
  '[AS]': '.-...', '[CT]': '-.-.-', '[BT]': '-...-', '[AR]': '.-.-.',
};

// 和文正本: docs/exam_wabun_telegram_canon.md / 和文電報練習帳.pdf（別表第1号）
export const WABUN_MORSE: Record<string, string> = {
  イ: '.-', ロ: '.-.-', ハ: '-...', ニ: '-.-.', ホ: '-..', ヘ: '.', ト: '..-..', チ: '..-.',
  リ: '--.', ヌ: '....', ル: '-.--.', ヲ: '.---', ワ: '-.-', カ: '.-..', ヨ: '--', タ: '-.',
  レ: '---', ソ: '---.', ツ: '.--.', ネ: '--.-', ナ: '.-.', ラ: '...', ム: '-', ウ: '..-',
  ヰ: '.-..-', ノ: '..--', オ: '.-...', ク: '...-', ヤ: '.--', マ: '-..-', ケ: '-.--',
  フ: '--..', コ: '----', エ: '-.---', テ: '.-.--', ア: '--.--', サ: '-.-.-', キ: '-.-..',
  ユ: '-..--', メ: '-...-', ミ: '..-.-', シ: '--.-.', ヱ: '.--..', ヒ: '--..-', モ: '-..-.',
  セ: '.---.', ス: '---.-', ン: '.-.-.',
  // 数字（フル）※受付時刻は略体トークン [0]–[9]
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....',
  6: '-....', 7: '--...', 8: '---..', 9: '----.',
  // 記号
  'ー': '.--.-', '、': '.-.-.-', '」': '.-.-..', '┘': '.-.-..',
  '（': '-.--.-', '）': '.-..-.',
  '゛': '..', '゜': '..--.',
  // 手続符号・略体数字
  '[ホレ]': '-..---', '[ラタ]': '...-.',
  '[特]': '-..-..', '[局]': '..-..-',
  '[1]': '.-', '[2]': '..-', '[3]': '...-', '[4]': '....-', '[5]': '.....',
  '[6]': '-....', '[7]': '-...', '[8]': '-..', '[9]': '-.', '[0]': '-',
};

export const alphabetSymbols = (alphabet: AlphabetType) =>
  Object.keys(alphabet === 'wabun' ? WABUN_MORSE : INTERNATIONAL_MORSE).filter((s) => /[A-Z0-9\u30A0-\u30FF]/.test(s));

/** 和文電文中の HRHR 等は欧文符号を使う（告示どおり開始は HRHR）。 */
export const morseFor = (symbol: string, alphabet: AlphabetType): string | undefined => {
  if (alphabet === 'wabun') {
    return WABUN_MORSE[symbol]
      ?? INTERNATIONAL_MORSE[symbol]
      ?? INTERNATIONAL_MORSE[symbol.toUpperCase()];
  }
  return INTERNATIONAL_MORSE[symbol] ?? INTERNATIONAL_MORSE[symbol.toUpperCase()];
};

/**
 * 濁点・半濁点付きカナを「本体＋゛／゜」に展開（和文モールスは分けて送る）。
 * 小書きカナは電信慣例どおり大書きへ（正本例も `ジヨウリク` 型）。
 */
const WABUN_SMALL_KANA: Record<string, string> = {
  ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ',
  ッ: 'ツ', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ヮ: 'ワ',
  ヵ: 'カ', ヶ: 'ケ',
};

const WABUN_VOICE_EXPAND: Record<string, [string, string]> = {
  ガ: ['カ', '゛'], ギ: ['キ', '゛'], グ: ['ク', '゛'], ゲ: ['ケ', '゛'], ゴ: ['コ', '゛'],
  ザ: ['サ', '゛'], ジ: ['シ', '゛'], ズ: ['ス', '゛'], ゼ: ['セ', '゛'], ゾ: ['ソ', '゛'],
  ダ: ['タ', '゛'], ヂ: ['チ', '゛'], ヅ: ['ツ', '゛'], デ: ['テ', '゛'], ド: ['ト', '゛'],
  バ: ['ハ', '゛'], ビ: ['ヒ', '゛'], ブ: ['フ', '゛'], ベ: ['ヘ', '゛'], ボ: ['ホ', '゛'],
  パ: ['ハ', '゜'], ピ: ['ヒ', '゜'], プ: ['フ', '゜'], ペ: ['ヘ', '゜'], ポ: ['ホ', '゜'],
  ヴ: ['ウ', '゛'],
};

export function expandWabunVoicing(symbol: string): string[] {
  const full = WABUN_SMALL_KANA[symbol] ?? symbol;
  const pair = WABUN_VOICE_EXPAND[full];
  return pair ? [...pair] : [full];
}

/**
 * 送信テキストを符号単位に分割する。
 * `[BT]` `[ホレ]` `[9]` など括弧トークンは1単位。
 * 和文は大文字化しない（カナ・記号を壊さない）。濁音は本体＋゛／゜に展開。
 * 欧文は A–Z へ。全角斜線 `／` は `/` に正規化。空白は語間隔マーカー1個に畳む。
 */
export function tokenizeMorseInput(text: string, alphabet: AlphabetType): string[] {
  const source = (alphabet === 'wabun' ? text : text.toUpperCase()).replace(/／/g, '/');
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      if (tokens.at(-1) !== ' ') tokens.push(' ');
      index += 1;
      continue;
    }
    if (char === '[') {
      const close = source.indexOf(']', index + 1);
      if (close !== -1) {
        const token = source.slice(index, close + 1);
        if (morseFor(token, alphabet)) {
          tokens.push(token);
          index = close + 1;
          continue;
        }
      }
    }
    const units = alphabet === 'wabun' ? expandWabunVoicing(char) : [char];
    for (const unit of units) {
      if (morseFor(unit, alphabet)) tokens.push(unit);
    }
    index += 1;
  }
  return tokens;
}

export const normalizeText = (text: string, alphabet: AlphabetType): string =>
  tokenizeMorseInput(text, alphabet).join('');

export interface MnemonicOption {
  label: string;
  category: 'Recommended' | 'Classic' | 'Funny' | 'Custom';
  /** One segment per Morse element. Prefer data over automatic splitting. */
  segments?: string[];
}

export interface MorseCard {
  symbol: string;
  alphabet: AlphabetType;
  code: string;
  title: string;
  kind: CharacterKind;
  /** False when the card has no mnemonic teaching content (digits / symbols / prosigns). */
  hasMnemonic: boolean;
  mnemonics: MnemonicOption[];
  artwork?: string;
  rarity: CardRarity;
  cardTheme?: CardTheme;
  foil?: boolean;
}

interface MnemonicDef {
  label: string;
  segments: string[];
}

const latinMnemonic: Record<string, MnemonicDef[]> = {
  A: [{ label: 'ア・ロー', segments: ['ア', 'ロー'] }],
  B: [{ label: 'ビートルズ', segments: ['ビー', 'ト', 'ル', 'ズ'] }],
  C: [{ label: 'チーズケーキ', segments: ['チー', 'ズ', 'ケー', 'キ'] }],
  D: [{ label: 'D組', segments: ['ディー', 'ぐ', 'み'] }],
  E: [{ label: '絵', segments: ['え'] }],
  F: [{ label: 'フルチート', segments: ['フ', 'ル', 'チー', 'ト'] }],
  G: [{ label: 'ゴーカート', segments: ['ゴー', 'カー', 'ト'] }],
  H: [
    { label: '越後屋', segments: ['え', 'ち', 'ご', 'や'] },
    { label: 'はなくそ', segments: ['は', 'な', 'く', 'そ'] },
  ],
  I: [{ label: '愛', segments: ['あ', 'い'] }],
  J: [{ label: '自動走行', segments: ['じ', 'ドー', 'ソー', 'コー'] }],
  K: [{ label: '警視庁', segments: ['ケー', 'シ', 'チョー'] }],
  L: [{ label: 'レバー串', segments: ['レ', 'バー', 'く', 'し'] }],
  M: [{ label: 'メー・ター', segments: ['メー', 'ター'] }],
  N: [{ label: 'ノー・ト', segments: ['ノー', 'ト'] }],
  O: [{ label: 'オーダー票', segments: ['オー', 'ダー', 'ひょう'] }],
  P: [{ label: 'ポニーテール', segments: ['ポ', 'ニー', 'テー', 'ル'] }],
  Q: [{ label: 'キューティーハニー', segments: ['キュー', 'ティー', 'ハ', 'ニー'] }],
  R: [{ label: 'レ・コー・ド', segments: ['レ', 'コー', 'ド'] }],
  S: [{ label: 'スマホ', segments: ['ス', 'マ', 'ホ'] }],
  T: [{ label: 'ティー', segments: ['ティー'] }],
  U: [
    { label: 'うまそー', segments: ['う', 'ま', 'そー'] },
    { label: 'うるせー', segments: ['う', 'る', 'せー'] },
  ],
  V: [{ label: 'ビクトリー', segments: ['ビ', 'ク', 'ト', 'リー'] }],
  W: [{ label: '和洋中', segments: ['わ', 'ヨー', 'チュー'] }],
  X: [{ label: 'えー・く・す・でー', segments: ['えー', 'く', 'す', 'でー'] }],
  Y: [{ label: 'よーし GO! GO!', segments: ['よー', 'し', 'ゴー', 'ゴー'] }],
  Z: [{ label: 'ざーざー雨', segments: ['ざー', 'ざー', 'あ', 'め'] }],
};

const wabunMnemonic: Record<string, MnemonicDef[]> = {
  イ: [{ label: '伊藤', segments: ['い', 'とう'] }],
  ロ: [{ label: '路上歩行', segments: ['ろ', 'じょう', 'ほ', 'こう'] }],
  ハ: [{ label: 'ハーモニカ', segments: ['ハー', 'モ', 'ニ', 'カ'] }],
  ニ: [{ label: 'NISA投資', segments: ['ニー', 'サ', 'トー', 'シ'] }],
  ホ: [{ label: '報告', segments: ['ホー', 'こ', 'く'] }],
  ヘ: [{ label: '屁', segments: ['へ'] }],
  ト: [{ label: '特等席', segments: ['と', 'く', 'トー', 'せ', 'き'] }],
  チ: [{ label: 'チョコレート', segments: ['チョ', 'コ', 'レー', 'ト'] }],
  リ: [{ label: 'リーダーだ', segments: ['リー', 'ダー', 'だ'] }],
  ヌ: [{ label: 'ぬくもり', segments: ['ぬ', 'く', 'も', 'り'] }],
  ル: [{ label: 'ルームヒーターだ', segments: ['ルー', 'ム', 'ヒー', 'ター', 'だ'] }],
  ヲ: [{ label: '和尚焼香', segments: ['お', 'ショー', 'ショー', 'コー'] }],
  ワ: [{ label: 'ワークデー', segments: ['ワー', 'ク', 'デー'] }],
  カ: [{ label: 'カレー飯', segments: ['カ', 'レー', 'め', 'し'] }],
  ヨ: [{ label: 'ヨーヨー', segments: ['ヨー', 'ヨー'] }],
  タ: [{ label: 'タール', segments: ['ター', 'ル'] }],
  レ: [{ label: 'レーザー砲', segments: ['レー', 'ザー', 'ほう'] }],
  ソ: [{ label: '相当高価', segments: ['ソー', 'トー', 'コー', 'か'] }],
  ツ: [{ label: 'つえーカード', segments: ['つ', 'えー', 'カー', 'ド'] }],
  ネ: [{ label: 'ネイビーブルー', segments: ['ネー', 'ビー', 'ブ', 'ルー'] }],
  ナ: [{ label: 'なげーよ', segments: ['な', 'げー', 'よ'] }],
  ラ: [{ label: 'ラムネ', segments: ['ラ', 'ム', 'ネ'] }],
  ム: [{ label: 'ムー', segments: ['ムー'] }],
  ウ: [{ label: 'うまそー', segments: ['う', 'ま', 'そー'] }],
  ヰ: [{ label: 'イメージカラー', segments: ['イ', 'メー', 'ジ', 'カ', 'ラー'] }],
  ノ: [{ label: 'ノリいいぞー', segments: ['ノ', 'リ', 'いー', 'ぞー'] }],
  オ: [{ label: 'おめーやばい', segments: ['お', 'めー', 'や', 'ば', 'い'] }],
  ク: [{ label: '苦しそう', segments: ['く', 'る', 'し', 'ソー'] }],
  ヤ: [{ label: '野球場', segments: ['や', 'キュー', 'ジョー'] }],
  マ: [{ label: 'まーだだよー', segments: ['まー', 'だ', 'だ', 'よー'] }],
  ケ: [{ label: '経過良好', segments: ['ケー', 'か', 'リョー', 'コー'] }],
  フ: [{ label: '封筒貼る', segments: ['フー', 'トー', 'は', 'る'] }],
  コ: [{ label: 'コーヒーメーカー', segments: ['コー', 'ヒー', 'メー', 'カー'] }],
  エ: [{ label: '英語YouTuber', segments: ['えー', 'ご', 'ユー', 'チュー', 'バー'] }],
  テ: [{ label: 'テキーラパーティー', segments: ['テ', 'キー', 'ラ', 'パー', 'ティー'] }],
  ア: [{ label: 'アーケードGO! GO!', segments: ['アー', 'ケー', 'ド', 'ゴー', 'ゴー'] }],
  サ: [{ label: 'サーブエースだー', segments: ['サー', 'ブ', 'エー', 'ス', 'だー'] }],
  キ: [{ label: '聞いて報告', segments: ['きい', 'て', 'ホー', 'こ', 'く'] }],
  ユ: [{ label: '勇者がGO! GO!', segments: ['ゆー', 'しゃ', 'が', 'ゴー', 'ゴー'] }],
  メ: [{ label: '名月だろう', segments: ['めい', 'げ', 'つ', 'だ', 'ろう'] }],
  ミ: [{ label: '見せよう見よう', segments: ['み', 'せ', 'よー', 'み', 'よー'] }],
  シ: [{ label: 'シーフードスープ', segments: ['シー', 'フー', 'ド', 'スー', 'プ'] }],
  ヱ: [{ label: 'えらーこーどだ', segments: ['え', 'らー', 'こー', 'ど', 'だ'] }],
  ヒ: [{ label: 'ヒーター消すなー', segments: ['ヒー', 'ター', 'け', 'す', 'なー'] }],
  モ: [{ label: 'モールスコード', segments: ['モー', 'ル', 'ス', 'コー', 'ド'] }],
  セ: [{ label: 'セラーオーナーだ', segments: ['セ', 'ラー', 'オー', 'ナー', 'だ'] }],
  ス: [{ label: 'スーパーセールデー', segments: ['スー', 'パー', 'セー', 'ル', 'デー'] }],
  ン: [{ label: 'う（ん）まーいソース', segments: ['う', 'まー', 'い', 'ソー', 'ス'] }],
};

/** JARL amateur occidental punctuation (no mnemonic required). */
const latinPunctuation: { symbol: string; title: string }[] = [
  { symbol: '/', title: '斜線 /' },
  { symbol: '=', title: '分離符 =' },
  { symbol: '+', title: '終了符 +' },
  { symbol: '.', title: '終点 .' },
];

const latinProsigns: { symbol: string; title: string }[] = [
  { symbol: '[AS]', title: '[AS] / WAIT' },
  { symbol: '[CT]', title: '[CT] / START' },
  { symbol: '[BT]', title: '[BT] / =' },
  { symbol: '[AR]', title: '[AR] / +' },
];

/** Wabun punctuation / procedural tokens for blue-series cards. */
const wabunPunctuation: { symbol: string; title: string }[] = [
  { symbol: 'ー', title: '長音' },
  { symbol: '、', title: '区切' },
  { symbol: '」', title: '段落' },
  { symbol: '（', title: '始め括弧' },
  { symbol: '）', title: '終わり括弧' },
  { symbol: '゛', title: '濁点' },
  { symbol: '゜', title: '半濁点' },
];

const wabunProsigns: { symbol: string; title: string }[] = [
  { symbol: '[ホレ]', title: '[ホレ]' },
  { symbol: '[ラタ]', title: '[ラタ]' },
  { symbol: '[特]', title: '[特]' },
  { symbol: '[局]', title: '[局]' },
];

function toMnemonicOptions(entries: MnemonicDef[]): MnemonicOption[] {
  return [
    ...entries.map((entry, index) => ({
      label: entry.label,
      segments: entry.segments,
      category: (index ? 'Funny' : 'Recommended') as MnemonicOption['category'],
    })),
    { label: '自分で作る', category: 'Custom' },
  ];
}

function bareCard(symbol: string, alphabet: AlphabetType, kind: CharacterKind, title: string): MorseCard {
  const code = morseFor(symbol, alphabet) ?? '';
  const metadata = artworkFor(alphabet, symbol);
  return {
    symbol,
    alphabet,
    code,
    title,
    kind,
    hasMnemonic: false,
    rarity: metadata?.rarity ?? 'N',
    artwork: metadata?.artwork,
    cardTheme: metadata?.cardTheme,
    foil: metadata?.foil,
    mnemonics: [{ label: title, category: 'Recommended' }],
  };
}

export const CARDS: MorseCard[] = [
  ...Object.entries(latinMnemonic).map(([symbol, entries]) => {
    const metadata = artworkFor('international', symbol);
    return {
      symbol, alphabet: 'international' as const, code: INTERNATIONAL_MORSE[symbol], title: entries[0].label,
      kind: 'latinLetter' as const, hasMnemonic: true,
      rarity: metadata?.rarity ?? (['F', 'P', 'Q'].includes(symbol) ? 'SSR' : ['C', 'J', 'L', 'O'].includes(symbol) ? 'SR' : 'R'),
      artwork: metadata?.artwork, cardTheme: metadata?.cardTheme, foil: metadata?.foil,
      mnemonics: toMnemonicOptions(entries),
    };
  }),
  ...Array.from({ length: 10 }, (_, digit) => bareCard(String(digit), 'international', 'digit', String(digit))),
  ...Array.from({ length: 10 }, (_, digit) => bareCard(`[${digit}]`, 'wabun', 'digit', `略${digit}`)),
  ...latinPunctuation.map((item) => bareCard(item.symbol, 'international', 'punctuation', item.title)),
  ...wabunPunctuation.map((item) => bareCard(item.symbol, 'wabun', 'punctuation', item.title)),
  ...latinProsigns.map((item) => bareCard(item.symbol, 'international', 'prosign', item.title)),
  ...wabunProsigns.map((item) => bareCard(item.symbol, 'wabun', 'prosign', item.title)),
  ...Object.entries(wabunMnemonic).map(([symbol, entries]) => {
    const metadata = artworkFor('wabun', symbol);
    return {
      symbol, alphabet: 'wabun' as const, code: WABUN_MORSE[symbol], title: entries[0].label,
      kind: 'wabun' as const, hasMnemonic: true,
      rarity: metadata?.rarity ?? (symbol === 'ツ' ? 'SSR' : ['ア', 'エ', 'テ', 'シ'].includes(symbol) ? 'SR' : 'R'),
      artwork: metadata?.artwork, cardTheme: metadata?.cardTheme, foil: metadata?.foil,
      mnemonics: toMnemonicOptions(entries),
    };
  }),
];

/**
 * Resolve rhythm segments for UI highlight.
 * Prefer explicit `segments` data. Fallback only to `・` / `｜` separators.
 * Never auto-slice graphemes — wrong rhythm is worse than no highlight.
 */
export function resolveMnemonicSegments(
  option: Pick<MnemonicOption, 'label' | 'segments'> | undefined,
  code: string,
): string[] {
  const n = Math.max(1, code.length);
  if (option?.segments && option.segments.length === n) return option.segments;

  const marked = (option?.label ?? '').split(/[・｜|]/u).map((part) => part.trim()).filter(Boolean);
  if (marked.length === n) return marked;

  return Array.from({ length: n }, () => '·');
}
