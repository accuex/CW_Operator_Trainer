/* eslint-disable @next/next/no-html-link-for-pages -- 本番(vinext)では next/link のクライアント遷移が落ちるため通常の <a> を使う */
import type { Metadata } from 'next';
import { Icon } from '@/app/components/icons';
import { SiteFooter } from '@/app/landing/SiteFooter';
import { SubpageHeader } from '@/app/landing/SubpageHeader';
import { viewToPath } from '@/lib/appPaths';

export const metadata: Metadata = {
  title: 'よくある質問 — CWOT Academy',
  description: 'CWOT Academy（モールス符号・和文CW・QSO練習、1総通対策）のよくある質問です。',
  alternates: { canonical: '/faq' },
};

type Faq = { q: string; a: React.ReactNode };

// MOCK: 内容は仮。公開前に文面を確認する。
const FAQ_GROUPS: { id: string; title: string; items: Faq[] }[] = [
  {
    id: 'start',
    title: 'はじめに',
    items: [
      {
        q: '何を用意すれば始められますか？',
        a: <>パソコンかスマートフォンのブラウザと、スピーカーまたはイヤホンがあれば始められます。アプリのインストールは不要です。</>,
      },
      {
        q: '音が鳴りません。',
        a: <>端末の音量、ブラウザのタブのミュート、スマートフォンのマナーモード（iPhoneは消音スイッチ）を確認してください。最初の再生は、画面のボタンを押したときに始まります。</>,
      },
      {
        q: '音感法と合調法のどちらで覚えればいいですか？',
        a: <>どちらでも始められます。リズムそのものを覚えるなら音感法、語呂で覚えたいなら合調法がおすすめです。あとから<a href={viewToPath('settings')}>設定</a>で切り替えられます。</>,
      },
    ],
  },
  {
    id: 'practice',
    title: '練習',
    items: [
      {
        q: '和文（和文CW）も練習できますか？',
        a: <>できます。<a href={viewToPath('learn')}>おぼえる</a>のセットで「和文」をONにすると、和文の符号が練習に加わります。</>,
      },
      {
        q: '符号の速度を変えたい。',
        a: <>アプリ上部の「文字速度」と「実効速度」で調整できます。文字速度を保ったまま実効速度を下げると、文字と文字の間だけが広がります（ファーンズワース方式）。</>,
      },
      {
        q: 'QSO（交信）の練習はどうやるのですか？',
        a: <><a href={viewToPath('qso')}>QSO交信</a>で、7MHzの仮想バンドに出てくる相手局と交信の流れを練習できます。</>,
      },
    ],
  },
  {
    id: 'exam',
    title: '1総通（第一級総合無線通信士）',
    items: [
      {
        q: 'どの科目に対応していますか？',
        a: <>電気通信術・法規・地理・英語の教材があります。<a href={viewToPath('exam')}>一総通</a>のメニューから選べます。</>,
      },
    ],
  },
  {
    id: 'account',
    title: 'アカウント・データ',
    items: [
      {
        q: '学習の記録はどこに保存されますか？',
        a: <>お使いのブラウザに保存されます。<a href={viewToPath('account')}>マイページ</a>からログインすると、ほかの端末と同期できます。</>,
      },
      {
        q: 'ブラウザのデータを消したら記録も消えますか？',
        a: <>ログインしていない場合は消えます。残しておきたい場合は、ログインして同期しておいてください。</>,
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="lp-frame">
      <SubpageHeader />

      <main className="lp-sitemap lp-support">
        <nav className="lp-crumbs" aria-label="パンくずリスト">
          <a href="/">トップ</a>
          <Icon name="chevron-right" size={12} />
          <span aria-current="page">よくある質問</span>
        </nav>

        <header className="lp-sitemap-head">
          <div>
            <p className="section-kicker">FAQ</p>
            <h1>よくある質問</h1>
            <p>使い方や練習のしかたについて、よくいただく質問をまとめました。</p>
          </div>
          <p className="lp-sub-motto" lang="en">Same Waves,<br />A Brighter Tomorrow.</p>
        </header>

        <div className="faq-groups">
          {FAQ_GROUPS.map((group) => (
            <section key={group.id} className="faq-group" aria-labelledby={`faq-${group.id}`}>
              <h2 id={`faq-${group.id}`}>{group.title}</h2>
              {group.items.map((item) => (
                <details key={item.q} className="faq-item">
                  <summary><span className="faq-mark" aria-hidden="true">Q</span>{item.q}</summary>
                  <div><span className="faq-mark answer" aria-hidden="true">A</span><p>{item.a}</p></div>
                </details>
              ))}
            </section>
          ))}
        </div>

        <aside className="support-cta panel panel-pad">
          <div>
            <b>解決しないときは</b>
            <p>不具合の報告やご要望は、お問い合わせフォームからお送りください。</p>
          </div>
          <a className="btn btn-primary" href="/contact">お問い合わせ<Icon name="chevron-right" size={16} /></a>
        </aside>
      </main>

      <SiteFooter />
    </div>
  );
}
