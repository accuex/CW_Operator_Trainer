import type { Metadata } from 'next';
import { GoogleAnalytics } from '@/app/components/GoogleAnalytics';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://cwot.jp'),
  title: 'CW Operator Trainer — 聞こえる、溜められる、書ける。',
  description: '欧文・和文モールスを、音感法・遅れ受信・試験形式まで訓練できるブラウザアプリ。',
  applicationName: 'CW Operator Trainer',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icons/icon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'CW Operator Trainer',
    description: 'HEAR · HOLD · COPY — CW受信を実戦のオペレータースキルへ。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CW Operator Trainer radio console' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CW Operator Trainer',
    description: 'HEAR · HOLD · COPY — CW受信を実戦のオペレータースキルへ。',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        {children}
        <GoogleAnalytics />
      </body>
    </html>
  );
}
