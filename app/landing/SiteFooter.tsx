import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-foot-inner">
        <nav aria-label="フッター">
          <Link href="/">トップ</Link>
          <Link href="/app">アプリ</Link>
          <Link href="/sitemap">サイトマップ</Link>
        </nav>
        <p className="app-credit">(C) 2026 Int Design LLC.</p>
      </div>
    </footer>
  );
}
