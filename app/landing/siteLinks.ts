import type { IconName } from '@/app/components/icons';
import { viewToPath } from '@/lib/appPaths';

export type SiteLink = {
  href: string;
  label: string;
  note: string;
  icon: IconName;
  /** フッターにも出す */
  footer?: boolean;
};

export type SiteGroup = {
  id: string;
  title: string;
  kicker: string;
  icon: IconName;
  tone: 'sky' | 'gold' | 'violet' | 'mint';
  links: SiteLink[];
};

export const SITE_GROUPS: SiteGroup[] = [
  {
    id: 'practice',
    title: '練習',
    kicker: 'PRACTICE',
    icon: 'train',
    tone: 'sky',
    links: [
      { href: viewToPath('home'), label: 'ホーム', note: '練習の起点', icon: 'home' },
      { href: viewToPath('learn'), label: 'おぼえる', note: '文字とリズム', icon: 'learn', footer: true },
      { href: viewToPath('train'), label: '聴きとる', note: '聞き取り', icon: 'train', footer: true },
      { href: viewToPath('levelup'), label: 'レベル試験', note: '段階の確認', icon: 'trophy' },
      { href: viewToPath('queue'), label: '遅れ受信', note: '聞いてから書く', icon: 'queue' },
      { href: viewToPath('qso'), label: 'QSO 交信', note: '仮想バンド', icon: 'radio', footer: true },
      { href: viewToPath('collection'), label: 'カード図鑑', note: '覚えた符号', icon: 'collection', footer: true },
      { href: viewToPath('analysis'), label: '苦手分析', note: '取り違えの振り返り', icon: 'analysis' },
    ],
  },
  {
    id: 'exam',
    title: '第一級総合無線通信士',
    kicker: 'EXAM',
    icon: 'exam',
    tone: 'gold',
    links: [
      { href: viewToPath('exam'), label: '一総通', note: '教材メニュー', icon: 'exam', footer: true },
      { href: viewToPath('communication'), label: '電気通信術', note: '受信の試験形式', icon: 'key', footer: true },
      { href: viewToPath('geography'), label: '地理', note: '地名を地図で', icon: 'target', footer: true },
      { href: viewToPath('english'), label: '専門英語', note: '場面から読む', icon: 'eye', footer: true },
      { href: viewToPath('houki'), label: '法規', note: '学習句', icon: 'check', footer: true },
    ],
  },
  {
    id: 'account',
    title: 'アカウント',
    kicker: 'ACCOUNT',
    icon: 'account',
    tone: 'violet',
    links: [
      { href: viewToPath('settings'), label: '設定', note: '学習法と表示', icon: 'settings' },
      { href: viewToPath('account'), label: 'マイページ', note: 'ログインと同期', icon: 'account', footer: true },
    ],
  },
  {
    id: 'site',
    title: 'このサイト',
    kicker: 'SITE',
    icon: 'sparkle',
    tone: 'mint',
    links: [
      { href: '/', label: 'トップ', note: 'ランディング', icon: 'home', footer: true },
      { href: '/sitemap', label: 'サイトマップ', note: 'このページ', icon: 'queue', footer: true },
    ],
  },
];
