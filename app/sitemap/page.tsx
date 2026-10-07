import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter } from '@/app/landing/SiteFooter';
import { viewToPath } from '@/lib/appPaths';

export const metadata: Metadata = {
  title: 'サイトマップ — CW Operator Trainer',
  description: 'CW Operator Trainer のページ一覧です。',
};

const GROUPS: { title: string; links: { href: string; label: string; note: string }[] }[] = [
  {
    title: 'このサイト',
    links: [
      { href: '/', label: 'トップ', note: 'ランディング' },
      { href: '/sitemap', label: 'サイトマップ', note: 'このページ' },
    ],
  },
  {
    title: '練習',
    links: [
      { href: viewToPath('home'), label: 'ホーム', note: '練習の起点' },
      { href: viewToPath('learn'), label: 'おぼえる', note: '文字とリズム' },
      { href: viewToPath('train'), label: '聴きとる', note: '聞き取り' },
      { href: viewToPath('levelup'), label: 'レベル試験', note: '段階の確認' },
      { href: viewToPath('queue'), label: '遅れ受信', note: '聞いてから書く' },
      { href: viewToPath('qso'), label: 'QSO 交信', note: '仮想バンド' },
      { href: viewToPath('collection'), label: 'カード図鑑', note: '覚えた符号' },
      { href: viewToPath('analysis'), label: '苦手分析', note: '取り違えの振り返り' },
    ],
  },
  {
    title: '第一級総合無線通信士',
    links: [
      { href: viewToPath('exam'), label: '一総通', note: '教材メニュー' },
      { href: viewToPath('communication'), label: '電気通信術', note: '受信の試験形式' },
      { href: viewToPath('geography'), label: '地理', note: '地名を地図で' },
      { href: viewToPath('english'), label: '専門英語', note: '場面から読む' },
      { href: viewToPath('houki'), label: '法規', note: '学習句' },
    ],
  },
  {
    title: 'アカウント',
    links: [
      { href: viewToPath('settings'), label: '設定', note: '学習法と表示' },
      { href: viewToPath('account'), label: 'マイページ', note: 'ログインと同期' },
    ],
  },
];

export default function SitemapPage() {
  return (
    <div className="lp-frame">
      <header className="lp-nav">
        <Link className="brand lp-brand" href="/" aria-label="CW Operator Trainer">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i className="dah" />
            <i />
            <i className="dah" />
          </span>
          <span className="brand-text">
            <b>CW Operator</b>
            <small className="brand-sub">
              <span>TRAINER</span>
            </small>
          </span>
        </Link>
        <nav className="lp-nav-links" aria-label="ページ">
          <Link href="/">トップ</Link>
          <Link href="/app">アプリへ</Link>
        </nav>
      </header>

      <main className="lp-sitemap">
        <p className="section-kicker">SITEMAP</p>
        <h1>サイトマップ</h1>
        <p>公開ページと、アプリ内の主な画面です。</p>
        <div className="lp-sitemap-grid">
          {GROUPS.map((group) => (
            <section key={group.title} aria-labelledby={`sitemap-${group.title}`}>
              <h2 id={`sitemap-${group.title}`}>{group.title}</h2>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>
                      <b>{link.label}</b>
                      <small>{link.note}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
