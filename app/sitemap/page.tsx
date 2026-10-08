/* eslint-disable @next/next/no-html-link-for-pages -- 本番(vinext)では next/link のクライアント遷移が落ちるため通常の <a> を使う */
import type { Metadata } from 'next';
import { Icon } from '@/app/components/icons';
import { SiteFooter } from '@/app/landing/SiteFooter';
import { SITE_GROUPS } from '@/app/landing/siteLinks';
import { APP_BASE } from '@/lib/appPaths';

export const metadata: Metadata = {
  title: 'サイトマップ — CW Operator Trainer',
  description: 'CW Operator Trainer のページ一覧です。',
};

const PAGE_COUNT = SITE_GROUPS.reduce((sum, group) => sum + group.links.length, 0);

export default function SitemapPage() {
  return (
    <div className="lp-frame">
      <header className="lp-nav">
        <a className="brand lp-brand" href="/" aria-label="CW Operator Trainer">
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
        </a>
        <nav className="lp-nav-links" aria-label="ページ">
          <a href="/">トップ</a>
          <a href="/sitemap" aria-current="page">サイトマップ</a>
        </nav>
        <a className="btn btn-primary" href={APP_BASE}>
          アプリを開く
        </a>
      </header>

      <main className="lp-sitemap">
        <nav className="lp-crumbs" aria-label="パンくずリスト">
          <a href="/">トップ</a>
          <Icon name="chevron-right" size={12} />
          <span aria-current="page">サイトマップ</span>
        </nav>

        <header className="lp-sitemap-head">
          <div>
            <p className="section-kicker">SITEMAP</p>
            <h1>サイトマップ</h1>
            <p>公開ページと、アプリ内の主な画面の一覧です。</p>
          </div>
          <p className="lp-sitemap-count">
            <b>{PAGE_COUNT}</b>
            <small>ページ</small>
          </p>
        </header>

        <div className="lp-sitemap-grid">
          {SITE_GROUPS.map((group) => (
            <section
              key={group.id}
              className={`lp-sitemap-group tone-${group.tone} area-${group.id}`}
              aria-labelledby={`sitemap-${group.id}`}
            >
              <div className="lp-sitemap-group-head">
                <span className="lp-sitemap-group-icon" aria-hidden="true">
                  <Icon name={group.icon} size={20} />
                </span>
                <div>
                  <small>{group.kicker}</small>
                  <h2 id={`sitemap-${group.id}`}>{group.title}</h2>
                </div>
              </div>
              <ul>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>
                      <span className="lp-sitemap-link-icon" aria-hidden="true">
                        <Icon name={link.icon} size={16} />
                      </span>
                      <span className="lp-sitemap-link-text">
                        <b>{link.label}</b>
                        <small>{link.note}</small>
                      </span>
                      <Icon name="chevron-right" size={14} className="lp-sitemap-link-arrow" />
                    </a>
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
