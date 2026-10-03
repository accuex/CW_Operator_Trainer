import type { Metadata } from 'next';
import { GoogleAnalytics } from '@/app/components/GoogleAnalytics';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://cw-operator-trainer.sacred-charm-9370.chatgpt.site'),
  title: 'CW Operator Trainer — 聞こえる、溜められる、書ける。',
  description: '欧文・和文モールスを、音感法・遅れ受信・試験形式まで訓練できるブラウザアプリ。',
  applicationName: 'CW Operator Trainer',
  manifest: '/manifest.webmanifest',
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
