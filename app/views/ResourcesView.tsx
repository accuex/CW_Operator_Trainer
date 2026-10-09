'use client';

import { useState, type ReactNode } from 'react';
import { INTERNATIONAL_MORSE, WABUN_MORSE } from '@/lib/morse';
import { ABBREVIATIONS, PHONETIC, Q_SIGNALS, REFERENCE_SOURCES, RESOURCE_LINKS } from '@/lib/resources/data';

const SECTIONS = [['morse', '符号表'], ['phonetic', 'フォネティック'], ['terms', '略語・Q符号'], ['links', 'リンク集']] as const;
type Section = typeof SECTIONS[number][0];
const codeLabel = (code: string) => [...code].map((char) => char === '.' ? '短点' : '長点').join(' ');
function External({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}<span aria-hidden="true"> ↗</span><span className="sr-only">（新しいタブで開きます）</span></a>;
}

export function ResourcesView({ onBack }: { onBack: () => void }) {
  const [section, setSection] = useState<Section>('morse');
  const [alphabet, setAlphabet] = useState<'latin' | 'wabun'>('latin');
  const [query, setQuery] = useState('');
  const matches = (...values: string[]) => values.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const symbolGroup = (symbol: string) => (alphabet === 'latin' ? /^[A-Z]$/ : /^[イ-ンヰヱ]$/).test(symbol) ? 0 : /^[0-9]$/.test(symbol) ? 1 : 2;
  const symbols = Object.entries(alphabet === 'latin' ? INTERNATIONAL_MORSE : WABUN_MORSE).sort(([a], [b]) => symbolGroup(a) - symbolGroup(b)).filter(([symbol]) => matches(symbol));
  return <section className="resources page-pad" aria-label="資料">
    <header className="resources-head"><div><p className="section-kicker">REFERENCE</p><h1>資料</h1><p>符号を確かめる。言葉を調べる。次の学びを見つける。</p></div><button type="button" className="btn btn-ghost" onClick={onBack}>ホームへ</button></header>
    <nav className="resources-nav" aria-label="資料の種類">{SECTIONS.map(([id, title]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => { setSection(id); setQuery(''); }}>{title}</button>)}</nav>
    <label className="resources-search">この資料から探す<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={section === 'morse' ? 'A、イ、[AR] など' : '言葉やサイト名を入力'} /></label>
    <section className="resources-body" aria-label={SECTIONS.find(([id]) => id === section)?.[1]}>
      {section === 'morse' && <><div className="resources-title"><h2>モールス符号表</h2><div className="resources-switch" role="group" aria-label="符号の種類"><button type="button" aria-pressed={alphabet === 'latin'} onClick={() => setAlphabet('latin')}>欧文</button><button type="button" aria-pressed={alphabet === 'wabun'} onClick={() => setAlphabet('wabun')}>和文</button></div></div><p>アプリの練習と同じ符号です。短点は「・」、長点は「━」。角括弧は手続符号や略体数字を表します。</p><div className="resources-code-grid">{symbols.map(([symbol, code]) => <div key={symbol} className="resources-code"><b>{symbol}</b><span className="resources-morse-glyphs" role="img" aria-label={codeLabel(code)}>{[...code].map((char, index) => <i key={index} aria-hidden="true" className={char === '.' ? 'dot' : 'dash'} />)}</span></div>)}</div>{!symbols.length && <p role="status">該当する符号がありません。</p>}<p className="resources-footnote">和文の濁点・半濁点は別符号です。手続符号は文字間を空けず、ひと続きに送ります。</p></>}
      {section === 'phonetic' && <><h2>フォネティックアルファベット</h2><p>聞き違えやすい文字を、決まった言葉に置き換えて伝えます。Aは <strong>Alfa</strong>、Jは <strong>Juliett</strong> と綴ります。</p><div className="resources-code-grid">{PHONETIC.filter((row) => matches(...row)).map(([letter, word]) => <div className="resources-code resources-phonetic" key={letter}><b>{letter}</b><span lang="en">{word}</span></div>)}</div>{!PHONETIC.some((row) => matches(...row)) && <p role="status">該当する項目がありません。</p>}<p className="resources-footnote">参照：<External href={REFERENCE_SOURCES.phonetic}>ITU フォネティックアルファベット（PDF）</External></p></>}
      {section === 'terms' && <><h2>CW交信でよく使う略語</h2><p>アマチュア無線での使い方を、短くまとめました。</p><dl className="resources-terms">{ABBREVIATIONS.filter((row) => matches(...row)).map(([term, meaning]) => <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>)}</dl><h2>Q符号</h2><p>「?」を付けると質問になります。ここでは交信で使う代表的な意味を紹介します。</p><div className="resources-q-grid">{Q_SIGNALS.filter((row) => matches(...row)).map(([term, question, response]) => <article key={term}><h3>{term}</h3><p><b>{term}?</b> {question}</p><p><b>{term}</b> {response}</p></article>)}</div>{!ABBREVIATIONS.some((row) => matches(...row)) && !Q_SIGNALS.some((row) => matches(...row)) && <p role="status">該当する項目がありません。</p>}<p className="resources-footnote">参照：<External href={REFERENCE_SOURCES.operating}>ARRL Operating Aids</External> / <External href={REFERENCE_SOURCES.glossary}>Ham Radio Glossary</External>。試験の定義や業務通信の手順を網羅した表ではありません。</p></>}
      {section === 'links' && <><h2>お役立ちリンク集</h2><p>受験の準備、CWの練習、先輩たちの体験談。気になるところからどうぞ。</p>{['試験・公式資料', 'CWを練習する', 'みんなの受験記'].map((group) => { const links = RESOURCE_LINKS.filter((link) => link.group === group && matches(link.title, link.note, link.kind)); return links.length ? <section className="resources-link-group" key={group}><h3>{group}</h3><div className="resources-link-grid">{links.map((link) => <article key={link.url}><span className="resources-tag">{link.kind}</span><h4><External href={link.url}>{link.title}</External></h4><p>{link.note}</p><small>{new URL(link.url).hostname}</small></article>)}</div></section> : null; })}{!RESOURCE_LINKS.some((link) => matches(link.title, link.note, link.kind)) && <p role="status">該当するリンクがありません。</p>}<p className="resources-footnote">リンク先は外部サイトです。受験記は執筆当時の体験談として、最新の制度・試験案内は公式情報で確認してください。</p></>}
    </section>
  </section>;
}
