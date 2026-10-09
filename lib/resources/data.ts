export const PHONETIC = [
  ['A', 'Alfa'], ['B', 'Bravo'], ['C', 'Charlie'], ['D', 'Delta'], ['E', 'Echo'], ['F', 'Foxtrot'],
  ['G', 'Golf'], ['H', 'Hotel'], ['I', 'India'], ['J', 'Juliett'], ['K', 'Kilo'], ['L', 'Lima'],
  ['M', 'Mike'], ['N', 'November'], ['O', 'Oscar'], ['P', 'Papa'], ['Q', 'Quebec'], ['R', 'Romeo'],
  ['S', 'Sierra'], ['T', 'Tango'], ['U', 'Uniform'], ['V', 'Victor'], ['W', 'Whiskey'], ['X', 'X-ray'],
  ['Y', 'Yankee'], ['Z', 'Zulu'],
] as const;

/** CW交信での短い参照用説明。国際規則の全文・試験用定義ではない。 */
export const ABBREVIATIONS = [
  ['CQ', '各局への呼びかけ'], ['DE', 'こちらは／〜から（自局のコールサインの前）'],
  ['K', '送信してください'], ['R', '受信しました'], ['BK', '交信への割込み／送受信の切替'],
  ['GM', 'おはよう'], ['GA', 'こんにちは'], ['GE', 'こんばんは'], ['GN', 'おやすみ'],
  ['TNX', 'ありがとう'], ['PSE', 'お願いします'], ['AGN', 'もう一度'], ['UR', 'あなたの'],
  ['ES', 'そして'], ['OM', '男性の無線仲間への呼びかけ'], ['YL', '女性の無線仲間への呼びかけ'],
  ['WX', '天候'], ['ANT', 'アンテナ'], ['RIG', '無線機'], ['RST', '了解度・信号強度・音調のレポート'],
  ['73', 'ごきげんよう（交信の結び）'], ['88', '愛情を込めた挨拶'], ['HI', '笑いを表す'],
] as const;
export const Q_SIGNALS = [
  ['QRL', 'この周波数は使用中ですか？', '使用中です'],
  ['QRM', '混信がありますか？', '他局などによる混信があります'],
  ['QRN', '空電がありますか？', '空電による雑音があります'],
  ['QRS', 'もっとゆっくり送信しましょうか？', 'もっとゆっくり送信してください'],
  ['QRQ', 'もっと速く送信しましょうか？', 'もっと速く送信してください'],
  ['QRT', '送信をやめましょうか？', '送信をやめてください'],
  ['QRV', '準備はできていますか？', '準備ができています'],
  ['QRZ', '誰がこちらを呼んでいますか？', 'あなたは〜から呼ばれています'],
  ['QSL', '受信を確認してもらえますか？', '受信を確認しました'],
  ['QSY', '別の周波数へ移りましょうか？', '別の周波数へ移ってください'],
  ['QTH', 'あなたの位置はどこですか？', 'こちらの位置は〜です'],
] as const;

export const RESOURCE_LINKS = [
  { group: '試験・公式資料', title: '公益財団法人 日本無線協会', url: 'https://www.nichimu.or.jp/denpa/shikaku/sogo/index.html', note: '総合無線通信士の資格・受験案内へ。', kind: '公式' },
  { group: '試験・公式資料', title: '電気通信術の試験の方法の告示', url: 'https://www.tele.soumu.go.jp/horei/law_honbun/72355000.html', note: '総務省の法令・告示ページ。', kind: '公式' },
  { group: '試験・公式資料', title: '電波受験界 — 一総通の過去問と解答', url: 'https://jyukenkai.com/kakomon_sogo/g1/', note: '第一級総合無線通信士の過去問資料。', kind: '過去問' },
  { group: '試験・公式資料', title: '情報通信振興会 オンラインショップ', url: 'https://www.dsk.or.jp/eshop/', note: '無線従事者向けの書籍・教材。', kind: '書籍' },
  { group: '試験・公式資料', title: "kema’s Homepage — 過去問ダウンロード", url: 'https://kemanai.jp/2018/01/01/無線従事者国家試験過去問ダウンロード/', note: '無線従事者国家試験の過去問をまとめたページ。', kind: '個人サイト' },
  { group: 'CWを練習する', title: 'Learn CW Online（LCWO）', url: 'https://lcwo.net/', note: 'ブラウザでモールス符号を練習。', kind: 'Web' },
  { group: 'CWを練習する', title: 'A1A Breaker', url: 'https://www.qsl.net/ja7uhv/JPN/A1A_Breaker_JPN.html', note: 'Windows向けのCW練習アプリ。', kind: 'Windows' },
  { group: 'CWを練習する', title: 'Morse Runner', url: 'https://www.dxatlas.com/MorseRunner/', note: 'コンテスト形式のCW練習アプリ。', kind: 'Windows' },
  { group: 'CWを練習する', title: 'A1Club', url: 'https://a1club.org/index.html', note: 'モールス通信を楽しむ人たちのコミュニティ。', kind: 'コミュニティ' },
  { group: 'みんなの受験記', title: '第一級総合無線通信士（一総通）', url: 'https://web.ji0vwl.net/issou.html', note: 'JI0VWL — 受験と電気通信術の練習を振り返る。', kind: '受験記' },
  { group: 'みんなの受験記', title: '第一級総合無線通信士（1総通）受験体験記', url: 'https://www.kazuno.net/1sou.html', note: 'kazuno.net', kind: '受験記' },
  { group: 'みんなの受験記', title: 'オフィス35の資格挑戦ブログ', url: 'https://ameblo.jp/office-35/entry-12929634092.html', note: '資格挑戦の記録。', kind: '受験記' },
  { group: 'みんなの受験記', title: '一総通の試験対策', url: 'https://ameblo.jp/szjn/entry-12504586158.html', note: '通勤時間の資格取得備忘録', kind: '受験記' },
  { group: 'みんなの受験記', title: '資格試験を受ける（第1級総合無線通信士）。', url: 'https://tekkamaki.exblog.jp/241766170/', note: '食！', kind: '受験記' },
  { group: 'みんなの受験記', title: 'おじさんヒヨコの無線雑記', url: 'https://jh8.seesaa.net/article/201602article_3.html', note: '一総通への挑戦。', kind: '受験記' },
  { group: 'みんなの受験記', title: '第一級総合無線通信士 受験記', url: 'https://cheb.sakura.ne.jp/pyon/1st_rogs_sohei.html', note: 'pyon*web', kind: '受験記' },
  { group: 'みんなの受験記', title: 'モールス符号を覚えないまま挑む第一級総合無線通信士', url: 'https://hermer.hatenablog.com/entry/2020/09/19/174521', note: 'えるまろぐ', kind: '受験記' },
] as const;
export const REFERENCE_SOURCES = {
  phonetic: 'https://www.itu.int/net/ITU-R/terrestrial/res647/docs/Compendium.pdf',
  operating: 'https://www.arrl.org/operating-aids',
  glossary: 'https://www.arrl.org/ham-radio-glossary',
} as const;
