/* eslint-disable @next/next/no-html-link-for-pages -- 本番(vinext)では next/link のクライアント遷移が落ちるため通常の <a> を使う */
import type { Metadata } from 'next';
import { Icon } from '@/app/components/icons';
import { SiteFooter } from '@/app/landing/SiteFooter';
import { SubpageHeader } from '@/app/landing/SubpageHeader';
import { ContactForm } from './ContactForm';

export const metadata: Metadata = {
  title: 'お問い合わせ — CWOT Academy',
  description: 'CWOT Academy へのご質問・不具合の報告・ご要望はこちらからお送りください。',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return (
    <div className="lp-frame">
      <SubpageHeader />

      <main className="lp-sitemap lp-support">
        <nav className="lp-crumbs" aria-label="パンくずリスト">
          <a href="/">トップ</a>
          <Icon name="chevron-right" size={12} />
          <span aria-current="page">お問い合わせ</span>
        </nav>

        <header className="lp-sitemap-head">
          <div>
            <p className="section-kicker">CONTACT</p>
            <h1>お問い合わせ</h1>
            <p>ご質問・不具合の報告・ご要望をお送りください。内容を確認のうえ、必要に応じてメールでご返信します。</p>
          </div>
          <p className="lp-sub-motto" lang="en">Same Waves,<br />A Brighter Tomorrow.</p>
        </header>

        <div className="contact-layout">
          <ContactForm />
          <aside className="contact-side">
            <div className="panel panel-pad">
              <b>送信の前に</b>
              <p>使い方のご質問は、<a href="/faq">よくある質問</a>で解決できることがあります。</p>
            </div>
            <div className="panel panel-pad">
              <b>不具合を報告するときは</b>
              <p>お使いの端末・ブラウザと、どの画面で何をしたときに起きたかを書いていただけると助かります。</p>
            </div>
          </aside>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
