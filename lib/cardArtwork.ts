import type { AlphabetType, CardRarityOwned } from './types';

export type CardRarity = 'N' | 'R' | 'SR' | 'SSR';
export type CardTheme = 'signal' | 'amber' | 'violet' | 'ocean';

export interface CardArtworkEntry {
  /** R artwork path (`/cards/{family}/r/{id}.webp`). SR/SSR are derived via `artworkUrlForRarity`. */
  artwork: string;
  rarity?: CardRarity;
  cardTheme?: CardTheme;
  foil?: boolean;
}

/**
 * Card artwork manifest.
 *
 * Layout: `public/cards/{international|wabun|kigo}/{r|sr|ssr}/{id}.webp`
 * Manifest entries point at R. Higher rarities reuse the same asset id under sr/ssr.
 * Missing files are safe: CardArtwork preloads and keeps the CSS fallback on error.
 *
 * Wabun asset IDs are lowercase Hepburn romanization (ツ→tsu, シ→shi, ヰ→wi, ヱ→we, ン→n).
 */
export const CARD_ARTWORK: Record<string, CardArtworkEntry> = {
  // International A–Z
  'international:A': { artwork: '/cards/international/r/A.webp' },
  'international:B': { artwork: '/cards/international/r/B.webp' },
  'international:C': { artwork: '/cards/international/r/C.webp', cardTheme: 'ocean' },
  'international:D': { artwork: '/cards/international/r/D.webp' },
  'international:E': { artwork: '/cards/international/r/E.webp' },
  'international:F': { artwork: '/cards/international/r/F.webp', foil: true },
  'international:G': { artwork: '/cards/international/r/G.webp' },
  'international:H': { artwork: '/cards/international/r/H.webp' },
  'international:I': { artwork: '/cards/international/r/I.webp' },
  'international:J': { artwork: '/cards/international/r/J.webp' },
  'international:K': { artwork: '/cards/international/r/K.webp' },
  'international:L': { artwork: '/cards/international/r/L.webp' },
  'international:M': { artwork: '/cards/international/r/M.webp' },
  'international:N': { artwork: '/cards/international/r/N.webp' },
  'international:O': { artwork: '/cards/international/r/O.webp' },
  'international:P': { artwork: '/cards/international/r/P.webp', foil: true },
  'international:Q': { artwork: '/cards/international/r/Q.webp', cardTheme: 'violet', foil: true },
  'international:R': { artwork: '/cards/international/r/R.webp' },
  'international:S': { artwork: '/cards/international/r/S.webp' },
  'international:T': { artwork: '/cards/international/r/T.webp' },
  'international:U': { artwork: '/cards/international/r/U.webp' },
  'international:V': { artwork: '/cards/international/r/V.webp' },
  'international:W': { artwork: '/cards/international/r/W.webp', cardTheme: 'amber' },
  'international:X': { artwork: '/cards/international/r/X.webp' },
  'international:Y': { artwork: '/cards/international/r/Y.webp' },
  'international:Z': { artwork: '/cards/international/r/Z.webp' },

  // Wabun 48 kana
  'wabun:ア': { artwork: '/cards/wabun/r/a.webp', foil: true },
  'wabun:イ': { artwork: '/cards/wabun/r/i.webp' },
  'wabun:ウ': { artwork: '/cards/wabun/r/u.webp' },
  'wabun:エ': { artwork: '/cards/wabun/r/e.webp' },
  'wabun:オ': { artwork: '/cards/wabun/r/o.webp' },
  'wabun:カ': { artwork: '/cards/wabun/r/ka.webp' },
  'wabun:キ': { artwork: '/cards/wabun/r/ki.webp' },
  'wabun:ク': { artwork: '/cards/wabun/r/ku.webp' },
  'wabun:ケ': { artwork: '/cards/wabun/r/ke.webp' },
  'wabun:コ': { artwork: '/cards/wabun/r/ko.webp', cardTheme: 'amber' },
  'wabun:サ': { artwork: '/cards/wabun/r/sa.webp' },
  'wabun:シ': { artwork: '/cards/wabun/r/shi.webp' },
  'wabun:ス': { artwork: '/cards/wabun/r/su.webp' },
  'wabun:セ': { artwork: '/cards/wabun/r/se.webp' },
  'wabun:ソ': { artwork: '/cards/wabun/r/so.webp' },
  'wabun:タ': { artwork: '/cards/wabun/r/ta.webp' },
  'wabun:チ': { artwork: '/cards/wabun/r/chi.webp' },
  'wabun:ツ': { artwork: '/cards/wabun/r/tsu.webp', cardTheme: 'violet', foil: true },
  'wabun:テ': { artwork: '/cards/wabun/r/te.webp' },
  'wabun:ト': { artwork: '/cards/wabun/r/to.webp' },
  'wabun:ナ': { artwork: '/cards/wabun/r/na.webp' },
  'wabun:ニ': { artwork: '/cards/wabun/r/ni.webp' },
  'wabun:ヌ': { artwork: '/cards/wabun/r/nu.webp' },
  'wabun:ネ': { artwork: '/cards/wabun/r/ne.webp' },
  'wabun:ノ': { artwork: '/cards/wabun/r/no.webp' },
  'wabun:ハ': { artwork: '/cards/wabun/r/ha.webp' },
  'wabun:ヒ': { artwork: '/cards/wabun/r/hi.webp' },
  'wabun:フ': { artwork: '/cards/wabun/r/fu.webp' },
  'wabun:ヘ': { artwork: '/cards/wabun/r/he.webp' },
  'wabun:ホ': { artwork: '/cards/wabun/r/ho.webp' },
  'wabun:マ': { artwork: '/cards/wabun/r/ma.webp' },
  'wabun:ミ': { artwork: '/cards/wabun/r/mi.webp' },
  'wabun:ム': { artwork: '/cards/wabun/r/mu.webp' },
  'wabun:メ': { artwork: '/cards/wabun/r/me.webp' },
  'wabun:モ': { artwork: '/cards/wabun/r/mo.webp', cardTheme: 'ocean' },
  'wabun:ヤ': { artwork: '/cards/wabun/r/ya.webp' },
  'wabun:ユ': { artwork: '/cards/wabun/r/yu.webp' },
  'wabun:ヨ': { artwork: '/cards/wabun/r/yo.webp' },
  'wabun:ラ': { artwork: '/cards/wabun/r/ra.webp' },
  'wabun:リ': { artwork: '/cards/wabun/r/ri.webp' },
  'wabun:ル': { artwork: '/cards/wabun/r/ru.webp' },
  'wabun:レ': { artwork: '/cards/wabun/r/re.webp' },
  'wabun:ロ': { artwork: '/cards/wabun/r/ro.webp' },
  'wabun:ワ': { artwork: '/cards/wabun/r/wa.webp' },
  'wabun:ヰ': { artwork: '/cards/wabun/r/wi.webp' },
  'wabun:ヱ': { artwork: '/cards/wabun/r/we.webp' },
  'wabun:ヲ': { artwork: '/cards/wabun/r/wo.webp' },
  'wabun:ン': { artwork: '/cards/wabun/r/n.webp' },

  // Blue series: digits / punctuation / prosigns (ASCII asset IDs under /cards/kigo/r/)
  'international:0': { artwork: '/cards/kigo/r/0.webp', cardTheme: 'ocean' },
  'international:1': { artwork: '/cards/kigo/r/1.webp', cardTheme: 'ocean' },
  'international:2': { artwork: '/cards/kigo/r/2.webp', cardTheme: 'ocean' },
  'international:3': { artwork: '/cards/kigo/r/3.webp', cardTheme: 'ocean' },
  'international:4': { artwork: '/cards/kigo/r/4.webp', cardTheme: 'ocean' },
  'international:5': { artwork: '/cards/kigo/r/5.webp', cardTheme: 'ocean' },
  'international:6': { artwork: '/cards/kigo/r/6.webp', cardTheme: 'ocean' },
  'international:7': { artwork: '/cards/kigo/r/7.webp', cardTheme: 'ocean' },
  'international:8': { artwork: '/cards/kigo/r/8.webp', cardTheme: 'ocean' },
  'international:9': { artwork: '/cards/kigo/r/9.webp', cardTheme: 'ocean' },
  'international:/': { artwork: '/cards/kigo/r/slash.webp', cardTheme: 'ocean' },
  'international:=': { artwork: '/cards/kigo/r/equal.webp', cardTheme: 'ocean' },
  'international:+': { artwork: '/cards/kigo/r/plus.webp', cardTheme: 'ocean' },
  'international:.': { artwork: '/cards/kigo/r/dot.webp', cardTheme: 'ocean' },
  'international:[AS]': { artwork: '/cards/kigo/r/as.webp', cardTheme: 'ocean' },
  'international:[CT]': { artwork: '/cards/kigo/r/ct.webp', cardTheme: 'ocean' },
  'international:[BT]': { artwork: '/cards/kigo/r/bt.webp', cardTheme: 'ocean' },
  'international:[AR]': { artwork: '/cards/kigo/r/ar.webp', cardTheme: 'ocean' },

  'wabun:ー': { artwork: '/cards/kigo/r/choon.webp', cardTheme: 'ocean' },
  'wabun:、': { artwork: '/cards/kigo/r/touten.webp', cardTheme: 'ocean' },
  'wabun:」': { artwork: '/cards/kigo/r/kakkotoji.webp', cardTheme: 'ocean' },
  'wabun:（': { artwork: '/cards/kigo/r/kakko-open.webp', cardTheme: 'ocean' },
  'wabun:）': { artwork: '/cards/kigo/r/kakko-close.webp', cardTheme: 'ocean' },
  'wabun:゛': { artwork: '/cards/kigo/r/dakuten.webp', cardTheme: 'ocean' },
  'wabun:゜': { artwork: '/cards/kigo/r/handakuten.webp', cardTheme: 'ocean' },
  'wabun:[ホレ]': { artwork: '/cards/kigo/r/hore.webp', cardTheme: 'ocean' },
  'wabun:[ラタ]': { artwork: '/cards/kigo/r/rata.webp', cardTheme: 'ocean' },
  'wabun:[特]': { artwork: '/cards/kigo/r/toku.webp', cardTheme: 'ocean' },
  'wabun:[局]': { artwork: '/cards/kigo/r/kyoku.webp', cardTheme: 'ocean' },
  'wabun:[0]': { artwork: '/cards/kigo/r/abbr0.webp', cardTheme: 'ocean' },
  'wabun:[1]': { artwork: '/cards/kigo/r/abbr1.webp', cardTheme: 'ocean' },
  'wabun:[2]': { artwork: '/cards/kigo/r/abbr2.webp', cardTheme: 'ocean' },
  'wabun:[3]': { artwork: '/cards/kigo/r/abbr3.webp', cardTheme: 'ocean' },
  'wabun:[4]': { artwork: '/cards/kigo/r/abbr4.webp', cardTheme: 'ocean' },
  'wabun:[5]': { artwork: '/cards/kigo/r/abbr5.webp', cardTheme: 'ocean' },
  'wabun:[6]': { artwork: '/cards/kigo/r/abbr6.webp', cardTheme: 'ocean' },
  'wabun:[7]': { artwork: '/cards/kigo/r/abbr7.webp', cardTheme: 'ocean' },
  'wabun:[8]': { artwork: '/cards/kigo/r/abbr8.webp', cardTheme: 'ocean' },
  'wabun:[9]': { artwork: '/cards/kigo/r/abbr9.webp', cardTheme: 'ocean' },
};

export const artworkKey = (alphabet: AlphabetType, symbol: string) => `${alphabet}:${symbol}`;
export const artworkFor = (alphabet: AlphabetType, symbol: string) => CARD_ARTWORK[artworkKey(alphabet, symbol)];

/** Map R path → SR/SSR. Non-`/r/` paths (or R itself) are returned unchanged. */
export function artworkUrlForRarity(
  artwork: string | undefined,
  rarity?: CardRarityOwned | CardRarity | null,
): string | undefined {
  if (!artwork) return undefined;
  if (!rarity || rarity === 'R' || rarity === 'N') return artwork;
  const folder = rarity.toLowerCase();
  if (!artwork.includes('/r/')) return artwork;
  return artwork.replace('/r/', `/${folder}/`);
}
