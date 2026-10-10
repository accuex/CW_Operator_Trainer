import type { Metadata } from 'next';
import Image from 'next/image';
import { SubpageHeader } from '@/app/landing/SubpageHeader';
import { SiteFooter } from '@/app/landing/SiteFooter';
import { APP_BASE, viewToPath } from '@/lib/appPaths';
import './about.css';

const title = '学園案内 — CWOT通信アカデミー';
const description = '電波でつながる、学びが広がる。通信科・航空科・海洋科からなる架空の学園、CWOT通信アカデミーの世界観と、仲間と楽しく無線通信を学ぶ理念を紹介します。';
export const metadata: Metadata = { title, description, alternates: { canonical: '/about' }, openGraph: { title, description, url: '/about', type: 'website', images: [{ url: '/assets/about/academy_tushin.webp', width: 1024, height: 1536, alt: 'CWOT通信アカデミー 通信科の学園案内' }] } };
const departments = [
  { id: 'radio', number: '01', name: '通信科', english: 'RADIO COMMUNICATIONS', image: 'academy_tushin', alt: '桜の咲く通信科の校舎で、無線機と電鍵を前にマイクを持つみおり。通信科の学科紹介イラスト。', catch: '音でつながる、\n世界が広がる。', paragraphs: ['CWOTアカデミーの原点となる学科。', 'モールス通信（CW）を中心に、無線工学、法規、通信運用などを学びます。', '符号を覚えるところから、音を直接理解できるようになるまで。少しずつ成長する楽しさを大切にしています。'], offering: 'いま学べること', status: '欧文・和文CWの練習、コッホ法、遅れ受信、仮想QSO、一総通の電気通信術・法規・地理・専門英語を提供しています。無線工学の体系的な教材は今後の構想です。' },
  { id: 'aviation', number: '02', name: '航空科', english: 'AVIATION COMMUNICATIONS', image: 'academy_sora', alt: '青空と旅客機、管制塔を背景に、航空科の制服でヘッドセットをつけたみおり。航空科の学科紹介イラスト。', catch: '空をつなぐ、\nその声の先へ。', paragraphs: ['航空無線や航空英語など、空の通信をテーマにした学科。', '航空機と地上を結ぶ通信の世界を通じて、正確に聞き、理解し、伝えることの大切さを学びます。', '青空と航空機を背景に、通信の新しい可能性を感じられる学科です。'], offering: '学園設定・これからの構想', status: '航空科の専用コースは、まだ提供していません。現在の専門英語・法規教材では、一総通の過去問に基づく限定的な航空通信の表現・規定を扱っています。' },
  { id: 'marine', number: '03', name: '海洋科', english: 'MARINE COMMUNICATIONS', image: 'academy_umi', alt: '船舶と灯台のある海辺で敬礼するみおり。海上無線や海事英語をテーマにした海洋科の学科紹介イラスト。', catch: '海を越えて、\n電波でつながる。', paragraphs: ['船舶と陸上を結ぶ海上通信をテーマにした学科。', '海上無線、GMDSS、遭難・安全通信など、海の安全を支える通信の世界を紹介します。', '広い海の向こうにも、電波でつながる仲間がいます。'], offering: '学園設定と、いま触れられる世界', status: '海洋科の専用コースは今後の構想です。現在は一総通の法規・地理・専門英語教材で、海事や遭難・安全通信に関する確認済みの範囲を学べます。' },
];
export default function AboutPage() {
  return <div className="lp-frame academy-about"><SubpageHeader /><main id="academy-main">
    <section className="academy-intro academy-width" aria-labelledby="academy-title">
      <p className="academy-eyebrow">CWOT ACADEMY · 学園案内</p>
      <h1 id="academy-title">電波でつながる、<br />学びが広がる。</h1>
      <div className="academy-welcome"><h2>ようこそ、CWOT通信アカデミーへ。</h2><p>ここは、無線通信を楽しく学ぶ架空の学園。</p><p>通信科・航空科・海洋科の3つの学科を舞台に、仲間たちと一緒に新しい知識や技術を身につけていきます。</p><p>学ぶ楽しさと、できるようになる喜びを。<br />CWOTアカデミーで、あなたの新しい学園生活を始めましょう。</p></div>
      <nav className="academy-department-nav" aria-label="学科案内"><span>3つの学科</span>{departments.map(d => <a key={d.id} href={`#${d.id}`}>{d.name}<span aria-hidden="true"> ↓</span></a>)}</nav>
    </section>
    <section aria-labelledby="departments-title" className="academy-departments">
      <div className="academy-width academy-departments-heading"><p className="academy-eyebrow">THREE DEPARTMENTS</p><h2 id="departments-title">通信から、空へ、海へ。</h2><p>3つの学科は、学園の世界観を形づくる設定です。提供中の教材は、各学科の紹介でご案内しています。</p></div>
      {departments.map(d => <article key={d.id} id={d.id} className={`academy-department academy-${d.id}`} aria-labelledby={`${d.id}-title`}><div className="academy-width academy-department-layout">
        <figure className="academy-poster"><a href={`/assets/about/${d.image}.webp`} aria-label={`${d.name}の紹介イラストを大きく見る`}><Image src={`/assets/about/${d.image}.webp`} alt={d.alt} width={1024} height={1536} sizes="(max-width: 760px) calc(100vw - 32px), (max-width: 1200px) 52vw, 642px" loading="lazy" /></a><figcaption>学科紹介イラスト · タップして大きく表示</figcaption></figure>
        <div className="academy-department-copy"><p className="academy-eyebrow">{d.number} / {d.english}</p><h3 id={`${d.id}-title`}>{d.name}</h3><p className="academy-catch">{d.catch}</p>{d.paragraphs.map(p => <p key={p}>{p}</p>)}<div className="academy-offering"><h4>{d.offering}</h4><p>{d.status}</p></div></div>
      </div></article>)}
    </section>
    <section className="academy-life academy-width" aria-labelledby="academy-values-title">
      <div><p className="academy-eyebrow">OUR PHILOSOPHY</p><h2 id="academy-values-title">楽しいから、<br />続けられる。</h2><p>無線通信の学習には、地道な反復練習が欠かせません。</p><p>けれど、ただ問題を解くだけではなく、少しずつ成長する喜びや、次の目標へ進む楽しさがあれば、学習はもっと続けやすくなるはずです。</p><p>キャラクター、コレクションカード、レベル、アチーブメント。CWOTアカデミーは、学習そのものを楽しめる体験を目指しています。</p><p>かわいらしい学園の世界観と、本格的な無線通信の学習。その両方を大切にしています。</p></div>
      <div><p className="academy-eyebrow">CAMPUS LIFE</p><h2>ここには、<br />学ぶ仲間がいる。</h2><p>みおりをはじめとする、個性豊かなキャラクターたち。学ぶ場所は違っても、通信への好奇心は同じです。</p><p>普段の授業だけでなく、学園行事や課外活動へ。架空の学園生活を通じて、世界観はこれからも広がっていきます。</p><p className="academy-future-note">学園行事や課外活動は世界観上の構想です。現在遊べるイベント機能ではありません。</p><a className="academy-text-link" href={viewToPath('collection')}>いまのカード図鑑を見る <span aria-hidden="true">→</span></a></div>
    </section>
    <section className="academy-finale" aria-labelledby="academy-finale-title"><div className="academy-width"><p className="academy-eyebrow">YOUR NEXT SIGNAL</p><h2 id="academy-finale-title">続けることが、<br />いつか大きな交信につながる。</h2><p className="academy-motto" lang="en">Same Waves, A Brighter Tomorrow.</p><p>学習を始める人にも、すでに無線を楽しんでいる人にも。<br />CWOTアカデミーが、新しい一歩を踏み出すきっかけになれば幸いです。</p><a className="btn btn-primary btn-lg" href={APP_BASE}>学習トップへ <span aria-hidden="true">→</span></a></div></section>
  </main><SiteFooter /></div>;
}
