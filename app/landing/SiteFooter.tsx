/* eslint-disable @next/next/no-html-link-for-pages -- 本番(vinext)では next/link のクライアント遷移が落ちるため通常の <a> を使う */
import { APP_BASE } from '@/lib/appPaths';
import { SITE_GROUPS, type SiteLink } from '@/app/landing/siteLinks';

function footerLinks(...ids: string[]): SiteLink[] {
  return ids.flatMap((id) =>
    (SITE_GROUPS.find((group) => group.id === id)?.links ?? []).filter((link) => link.footer),
  );
}

const FOOTER_COLUMNS: { title: string; links: SiteLink[] }[] = [
  { title: '練習', links: footerLinks('practice') },
  { title: '一総通 試験対策', links: footerLinks('exam') },
  { title: 'サイト', links: footerLinks('site', 'account') },
];

/** 7 = --... / 3 = ...-- */
const SIGN_73 = ['dah', 'dah', 'dit', 'dit', 'dit', null, 'dit', 'dit', 'dit', 'dah', 'dah'] as const;

export function SiteFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot-inner">
        <div className="lp-foot-brand">
          <a className="brand lp-brand" href="/" aria-label="CW Operator Trainer トップ">
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
          <p>
            耳で読む、モールスの世界へ。
            <br />
            ブラウザだけで始められるCWトレーナーです。
          </p>
          <a className="btn btn-primary btn-sm" href={APP_BASE}>
            アプリを開く
          </a>
        </div>

        <nav className="lp-foot-nav" aria-label="サイト内リンク">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>{link.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="lp-foot-bar">
        <p className="app-credit">(C) 2026 Int Design LLC.</p>
        <p className="lp-foot-sign" title="73 — Best regards">
          <span className="lp-foot-morse" aria-hidden="true">
            {SIGN_73.map((mark, i) =>
              mark ? <i key={i} className={mark} /> : <b key={i} />,
            )}
          </span>
          73
        </p>
      </div>
    </footer>
  );
}
