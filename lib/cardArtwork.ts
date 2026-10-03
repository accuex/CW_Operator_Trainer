import type { AlphabetType } from './types';

export type CardRarity = 'N' | 'R' | 'SR' | 'SSR';
export type CardTheme = 'signal' | 'amber' | 'violet' | 'ocean';

export interface CardArtworkEntry {
  artwork: string;
  rarity?: CardRarity;
  cardTheme?: CardTheme;
  foil?: boolean;
}

/**
 * Card artwork manifest.
 *
 * Adding an illustration is intentionally a two-step operation: place the
 * asset below public/cards, then add or update its entry here. Missing files
 * are safe: CardArtwork preloads the URL and keeps the CSS fallback on error.
 *
 * Wabun asset IDs are lowercase Hepburn romanization (ツ→tsu, シ→shi, ヰ→wi, ヱ→we, ン→n).
 */
export const CARD_ARTWORK: Record<string, CardArtworkEntry> = {
  // International A–Z
  'international:A': { artwork: '/cards/international/A.webp' },
  'international:B': { artwork: '/cards/international/B.webp' },
  'international:C': { artwork: '/cards/international/C.webp', cardTheme: 'ocean' },
  'international:D': { artwork: '/cards/international/D.webp' },
  'international:E': { artwork: '/cards/international/E.webp' },
  'international:F': { artwork: '/cards/international/F.webp', foil: true },
  'international:G': { artwork: '/cards/international/G.webp' },
  'international:H': { artwork: '/cards/international/H.webp' },
  'international:I': { artwork: '/cards/international/I.webp' },
  'international:J': { artwork: '/cards/international/J.webp' },
  'international:K': { artwork: '/cards/international/K.webp' },
  'international:L': { artwork: '/cards/international/L.webp' },
  'international:M': { artwork: '/cards/international/M.webp' },
  'international:N': { artwork: '/cards/international/N.webp' },
  'international:O': { artwork: '/cards/international/O.webp' },
  'international:P': { artwork: '/cards/international/P.webp', foil: true },
  'international:Q': { artwork: '/cards/international/Q.webp', cardTheme: 'violet', foil: true },
  'international:R': { artwork: '/cards/international/R.webp' },
  'international:S': { artwork: '/cards/international/S.webp' },
  'international:T': { artwork: '/cards/international/T.webp' },
  'international:U': { artwork: '/cards/international/U.webp' },
  'international:V': { artwork: '/cards/international/V.webp' },
  'international:W': { artwork: '/cards/international/W.webp', cardTheme: 'amber' },
  'international:X': { artwork: '/cards/international/X.webp' },
  'international:Y': { artwork: '/cards/international/Y.webp' },
  'international:Z': { artwork: '/cards/international/Z.webp' },

  // Wabun 48 kana
  'wabun:ア': { artwork: '/cards/wabun/a.webp', foil: true },
  'wabun:イ': { artwork: '/cards/wabun/i.webp' },
  'wabun:ウ': { artwork: '/cards/wabun/u.webp' },
  'wabun:エ': { artwork: '/cards/wabun/e.webp' },
  'wabun:オ': { artwork: '/cards/wabun/o.webp' },
  'wabun:カ': { artwork: '/cards/wabun/ka.webp' },
  'wabun:キ': { artwork: '/cards/wabun/ki.webp' },
  'wabun:ク': { artwork: '/cards/wabun/ku.webp' },
  'wabun:ケ': { artwork: '/cards/wabun/ke.webp' },
  'wabun:コ': { artwork: '/cards/wabun/ko.webp', cardTheme: 'amber' },
  'wabun:サ': { artwork: '/cards/wabun/sa.webp' },
  'wabun:シ': { artwork: '/cards/wabun/shi.webp' },
  'wabun:ス': { artwork: '/cards/wabun/su.webp' },
  'wabun:セ': { artwork: '/cards/wabun/se.webp' },
  'wabun:ソ': { artwork: '/cards/wabun/so.webp' },
  'wabun:タ': { artwork: '/cards/wabun/ta.webp' },
  'wabun:チ': { artwork: '/cards/wabun/chi.webp' },
  'wabun:ツ': { artwork: '/cards/wabun/tsu.webp', cardTheme: 'violet', foil: true },
  'wabun:テ': { artwork: '/cards/wabun/te.webp' },
  'wabun:ト': { artwork: '/cards/wabun/to.webp' },
  'wabun:ナ': { artwork: '/cards/wabun/na.webp' },
  'wabun:ニ': { artwork: '/cards/wabun/ni.webp' },
  'wabun:ヌ': { artwork: '/cards/wabun/nu.webp' },
  'wabun:ネ': { artwork: '/cards/wabun/ne.webp' },
  'wabun:ノ': { artwork: '/cards/wabun/no.webp' },
  'wabun:ハ': { artwork: '/cards/wabun/ha.webp' },
  'wabun:ヒ': { artwork: '/cards/wabun/hi.webp' },
  'wabun:フ': { artwork: '/cards/wabun/fu.webp' },
  'wabun:ヘ': { artwork: '/cards/wabun/he.webp' },
  'wabun:ホ': { artwork: '/cards/wabun/ho.webp' },
  'wabun:マ': { artwork: '/cards/wabun/ma.webp' },
  'wabun:ミ': { artwork: '/cards/wabun/mi.webp' },
  'wabun:ム': { artwork: '/cards/wabun/mu.webp' },
  'wabun:メ': { artwork: '/cards/wabun/me.webp' },
  'wabun:モ': { artwork: '/cards/wabun/mo.webp', cardTheme: 'ocean' },
  'wabun:ヤ': { artwork: '/cards/wabun/ya.webp' },
  'wabun:ユ': { artwork: '/cards/wabun/yu.webp' },
  'wabun:ヨ': { artwork: '/cards/wabun/yo.webp' },
  'wabun:ラ': { artwork: '/cards/wabun/ra.webp' },
  'wabun:リ': { artwork: '/cards/wabun/ri.webp' },
  'wabun:ル': { artwork: '/cards/wabun/ru.webp' },
  'wabun:レ': { artwork: '/cards/wabun/re.webp' },
  'wabun:ロ': { artwork: '/cards/wabun/ro.webp' },
  'wabun:ワ': { artwork: '/cards/wabun/wa.webp' },
  'wabun:ヰ': { artwork: '/cards/wabun/wi.webp' },
  'wabun:ヱ': { artwork: '/cards/wabun/we.webp' },
  'wabun:ヲ': { artwork: '/cards/wabun/wo.webp' },
  'wabun:ン': { artwork: '/cards/wabun/n.webp' },

  // Blue series: digits / punctuation / prosigns (ASCII asset IDs under /cards/kigo/)
  'international:0': { artwork: '/cards/kigo/0.webp', cardTheme: 'ocean' },
  'international:1': { artwork: '/cards/kigo/1.webp', cardTheme: 'ocean' },
  'international:2': { artwork: '/cards/kigo/2.webp', cardTheme: 'ocean' },
  'international:3': { artwork: '/cards/kigo/3.webp', cardTheme: 'ocean' },
  'international:4': { artwork: '/cards/kigo/4.webp', cardTheme: 'ocean' },
  'international:5': { artwork: '/cards/kigo/5.webp', cardTheme: 'ocean' },
  'international:6': { artwork: '/cards/kigo/6.webp', cardTheme: 'ocean' },
  'international:7': { artwork: '/cards/kigo/7.webp', cardTheme: 'ocean' },
  'international:8': { artwork: '/cards/kigo/8.webp', cardTheme: 'ocean' },
  'international:9': { artwork: '/cards/kigo/9.webp', cardTheme: 'ocean' },
  'international:/': { artwork: '/cards/kigo/slash.webp', cardTheme: 'ocean' },
  'international:=': { artwork: '/cards/kigo/equal.webp', cardTheme: 'ocean' },
  'international:+': { artwork: '/cards/kigo/plus.webp', cardTheme: 'ocean' },
  'international:.': { artwork: '/cards/kigo/dot.webp', cardTheme: 'ocean' },
  'international:[AS]': { artwork: '/cards/kigo/as.webp', cardTheme: 'ocean' },
  'international:[CT]': { artwork: '/cards/kigo/ct.webp', cardTheme: 'ocean' },
  'international:[BT]': { artwork: '/cards/kigo/bt.webp', cardTheme: 'ocean' },
  'international:[AR]': { artwork: '/cards/kigo/ar.webp', cardTheme: 'ocean' },

  'wabun:ー': { artwork: '/cards/kigo/choon.webp', cardTheme: 'ocean' },
  'wabun:、': { artwork: '/cards/kigo/touten.webp', cardTheme: 'ocean' },
  'wabun:」': { artwork: '/cards/kigo/kakkotoji.webp', cardTheme: 'ocean' },
  'wabun:（': { artwork: '/cards/kigo/kakko-open.webp', cardTheme: 'ocean' },
  'wabun:）': { artwork: '/cards/kigo/kakko-close.webp', cardTheme: 'ocean' },
  'wabun:゛': { artwork: '/cards/kigo/dakuten.webp', cardTheme: 'ocean' },
  'wabun:゜': { artwork: '/cards/kigo/handakuten.webp', cardTheme: 'ocean' },
  'wabun:[ホレ]': { artwork: '/cards/kigo/hore.webp', cardTheme: 'ocean' },
  'wabun:[ラタ]': { artwork: '/cards/kigo/rata.webp', cardTheme: 'ocean' },
  'wabun:[特]': { artwork: '/cards/kigo/toku.webp', cardTheme: 'ocean' },
  'wabun:[局]': { artwork: '/cards/kigo/kyoku.webp', cardTheme: 'ocean' },
  'wabun:[0]': { artwork: '/cards/kigo/abbr0.webp', cardTheme: 'ocean' },
  'wabun:[1]': { artwork: '/cards/kigo/abbr1.webp', cardTheme: 'ocean' },
  'wabun:[2]': { artwork: '/cards/kigo/abbr2.webp', cardTheme: 'ocean' },
  'wabun:[3]': { artwork: '/cards/kigo/abbr3.webp', cardTheme: 'ocean' },
  'wabun:[4]': { artwork: '/cards/kigo/abbr4.webp', cardTheme: 'ocean' },
  'wabun:[5]': { artwork: '/cards/kigo/abbr5.webp', cardTheme: 'ocean' },
  'wabun:[6]': { artwork: '/cards/kigo/abbr6.webp', cardTheme: 'ocean' },
  'wabun:[7]': { artwork: '/cards/kigo/abbr7.webp', cardTheme: 'ocean' },
  'wabun:[8]': { artwork: '/cards/kigo/abbr8.webp', cardTheme: 'ocean' },
  'wabun:[9]': { artwork: '/cards/kigo/abbr9.webp', cardTheme: 'ocean' },
};

export const artworkKey = (alphabet: AlphabetType, symbol: string) => `${alphabet}:${symbol}`;
export const artworkFor = (alphabet: AlphabetType, symbol: string) => CARD_ARTWORK[artworkKey(alphabet, symbol)];
