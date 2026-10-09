/* eslint-disable @next/next/no-html-link-for-pages -- 本番(vinext)では next/link のクライアント遷移が落ちるため通常の <a> を使う */
import Image from 'next/image';
import { SITE_GROUPS, type SiteLink } from '@/app/landing/siteLinks';

function footerLinks(...ids: string[]): SiteLink[] {
  return ids.flatMap((id) =>
    (SITE_GROUPS.find((group) => group.id === id)?.links ?? []).filter((link) => link.footer),
  );
}

const FOOTER_COLUMNS: { title: string; icon: string; tone: 'sky' | 'gold'; links: SiteLink[] }[] = [
  { title: '練習', icon: 'book', tone: 'sky', links: footerLinks('practice') },
  { title: '一総通 試験対策', icon: 'cap', tone: 'gold', links: footerLinks('exam') },
  { title: 'サイト', icon: 'compass', tone: 'sky', links: footerLinks('site', 'account') },
];

/** 7 = --... / 3 = ...-- */
const SIGN_73 = ['dah', 'dah', 'dit', 'dit', 'dit', null, 'dit', 'dit', 'dit', 'dah', 'dah'] as const;

export function SiteFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot-stage">
        <p className="lp-foot-motto" lang="en">Same Waves, A Brighter Tomorrow.</p>

        <div className="lp-foot-inner">
          <a className="lp-foot-brand" href="/">
            <Image
              src="/landing/academy_footer_logo.webp"
              alt="CWOT Academy CWOT通信アカデミー — 符号でつながる、もっと広い世界へ。"
              width={900}
              height={605}
              sizes="(max-width: 760px) 80vw, 380px"
            />
          </a>

          <nav className="lp-foot-nav" aria-label="サイト内リンク">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title} className={`tone-${column.tone}`}>
                <h2>
                  <Image src={`/landing/footer_icon_${column.icon}.webp`} alt="" width={40} height={30} />
                  {column.title}
                </h2>
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

          <p className="lp-foot-whisper">
            あの電波の先に、
            <br />
            きっと、誰かがいる。
          </p>
        </div>
      </div>

      <div className="lp-foot-bar">
        <p className="lp-foot-copy">© 2026 Int Design LLC. All rights reserved.</p>
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
