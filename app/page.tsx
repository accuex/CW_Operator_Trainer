import type { Metadata } from 'next';
import { LandingPage } from '@/app/landing/LandingPage';

const SITE_ORIGIN = process.env.SITE_URL ?? 'https://cwot.jp';

const TITLE = 'CWOT Academy｜モールス符号（CW）・和文CW・QSO練習と1総通（第一級総合無線通信士）試験対策';
const DESCRIPTION =
  'ブラウザで使えるモールス符号（CW）の練習サイト。欧文・和文CWを音感法やコッホ法で覚え、遅れ受信、7MHzの仮想バンドでのQSO交信まで練習できます。1総通（第一級総合無線通信士）の電気通信術・法規・地理・英語の試験対策にも対応。';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'CW',
    'モールス符号',
    'モールス信号',
    '和文CW',
    '和文モールス',
    'QSO',
    'アマチュア無線',
    '1総通',
    '一総通',
    '第一級総合無線通信士',
    '電気通信術',
    'コッホ法',
    '音感法',
  ],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    url: '/',
    siteName: 'CWOT Academy',
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'CWOT Academy — モールス符号（CW）練習と1総通試験対策' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og.png'],
  },
};

const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITE_ORIGIN}/#website`,
      url: `${SITE_ORIGIN}/`,
      name: 'CWOT Academy',
      alternateName: ['CWOT通信アカデミー', 'CW Operator Trainer'],
      inLanguage: 'ja',
    },
    {
      '@type': 'WebApplication',
      name: 'CW Operator Trainer',
      url: `${SITE_ORIGIN}/`,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web browser',
      inLanguage: 'ja',
      description: DESCRIPTION,
      isPartOf: { '@id': `${SITE_ORIGIN}/#website` },
      about: ['モールス符号（CW）', '和文CW', 'QSO', '第一級総合無線通信士'],
    },
  ],
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
      />
      <LandingPage />
    </>
  );
}
