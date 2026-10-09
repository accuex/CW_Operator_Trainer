/* eslint-disable @next/next/no-html-link-for-pages -- 本番(vinext)では next/link のクライアント遷移が落ちるため通常の <a> を使う */
import Image from 'next/image';
import { Icon } from '@/app/components/icons';
import { APP_BASE, viewToPath } from '@/lib/appPaths';

/** Masthead for the small public pages (FAQ, contact, sitemap) — the landing banner, shorter. */
export function SubpageHeader() {
  return (
    <header className="lp-masthead lp-masthead-sub">
      <div className="lp-banner">
        <a className="lp-banner-logo" href="/">
          <Image
            src="/landing/academy_header_logo.webp"
            alt="CWOT Academy CWOT通信アカデミー — 符号でつながる、もっと広い世界へ。"
            width={1600}
            height={376}
            sizes="(max-width: 760px) 92vw, 560px"
            priority
          />
        </a>
      </div>

      <div className="lp-menu">
        <nav className="lp-menu-links" aria-label="サイト">
          <a className="lp-menu-home" href="/">
            <Icon name="home" size={22} />
            <span className="sr-only">トップ</span>
          </a>
          <a href={viewToPath('learn')}>学ぶ</a>
          <a href={viewToPath('levelup')}>練習する</a>
          <a href={viewToPath('qso')}>交信する</a>
          <a href="/#demo">受信機</a>
        </nav>
        <a className="lp-menu-cta" href={APP_BASE}>
          アプリを開く
          <span aria-hidden="true">→</span>
        </a>
      </div>
    </header>
  );
}
