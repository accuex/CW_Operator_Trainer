'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { APP_BASE, APP_VIEWS, viewToPath, type AppView } from '@/lib/appPaths';
import { DEFAULT_UNLOCK } from '@/lib/course';
import { getProfile, isLandingReturning, markTrainerStarted, normalizeProfile, saveProfile } from '@/lib/storage';
import type { TrainerProfile } from '@/lib/types';
import { Icon, type IconName } from '@/app/components/icons';
import { SiteFooter } from '@/app/landing/SiteFooter';

const LandingRigDemo = dynamic(
  () => import('./LandingRigDemo').then((mod) => mod.LandingRigDemo),
  { ssr: false },
);

function RigDemoPlaceholder() {
  return (
    <div className="lp-rig-placeholder panel">
      受信機を起動しています…
    </div>
  );
}

const subscribeNever = () => () => {};

/** dynamic(ssr:false) は戻るナビでモジュールキャッシュ済みだと即本体描画され、SSRプレースホルダと食い違う */
function RigDemoSlot() {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  if (!mounted) return <RigDemoPlaceholder />;
  return <LandingRigDemo />;
}

const HERO_PILLS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'learn', title: '基礎から実践まで', body: 'コッホ法・聞き取り・QSOを、ブラウザだけで通して練習できます' },
  { icon: 'radio', title: 'リアルな無線の体験', body: 'ウォーターフォールとリグ操作。7MHz帯の仮想バンドです' },
  { icon: 'collection', title: '楽しみながら続ける', body: '符号を覚えるほどカードが増え、学習の記録が残ります' },
  { icon: 'exam', title: '国家試験対策まで', body: '第一級総合無線通信士の試験形式まで、同じアプリで進められます' },
];

const FRESH_START = 'さっそく始める';

const FEATURE_CARDS: {
  src: string;
  alt: string;
  label: string;
  href: string;
  tone: 'wabun' | 'exam';
}[] = [
  {
    src: '/landing/wabun_qso.png',
    alt: '和文受信用紙を書きながらCWを体験する',
    label: 'CW交信を体験する',
    href: viewToPath('qso'),
    tone: 'wabun',
  },
  {
    src: '/landing/1sotu_tiri.png',
    alt: '第一級総合無線通信士の試験対策の勉強机',
    label: '第一級総合無線通信士の試験対策',
    href: viewToPath('exam'),
    tone: 'exam',
  },
];

const PATH_CARDS: {
  src: string;
  alt: string;
  kicker: string;
  title: string;
  body: string;
  view: AppView;
  tone: string;
}[] = [
  {
    src: '/landing/top1.png',
    alt: 'ヘッドフォンで電鍵を打つ',
    kicker: 'はじめてのCW',
    title: 'おぼえる',
    body: '文字とリズムを楽しく覚える最初の一歩はこちら',
    view: 'learn',
    tone: 'learn',
  },
  {
    src: '/landing/top2.png',
    alt: 'ウォーターフォールを見ながら受信する',
    kicker: '聴き取る力をつける',
    title: '聴きとる',
    body: 'コッホ法で段階的に聞き取り力を育てます',
    view: 'levelup',
    tone: 'copy',
  },
  {
    src: '/landing/top3.png',
    alt: 'CQを出して交信する',
    kicker: '実際に交信してみる',
    title: 'QSO 交信',
    body: '7MHzの仮想バンドでリアルなQSOを体験',
    view: 'qso',
    tone: 'qso',
  },
  {
    src: '/landing/top4.png',
    alt: '集めた符号カードを見る',
    kicker: 'カードを集めて学ぶ',
    title: 'カード図鑑',
    body: '覚えた符号がカードにコレクションで楽しく続ける',
    view: 'collection',
    tone: 'cards',
  },
];

function continueHref(profile: TrainerProfile | null): string {
  if (!profile) return APP_BASE;
  const last = profile.lastMode;
  if (
    last &&
    (APP_VIEWS as readonly string[]).includes(last) &&
    last !== 'settings' &&
    last !== 'account'
  ) {
    return viewToPath(last as AppView);
  }
  return APP_BASE;
}

export function LandingPage() {
  const [profile, setLocalProfile] = useState<TrainerProfile | null>(null);
  const [returning, setReturning] = useState(false);
  const [ready, setReady] = useState(false);
  const [goal, setGoal] = useState<'sound' | 'fun'>('sound');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const next = normalizeProfile(await getProfile());
        setLocalProfile(next);
        setReturning(isLandingReturning(next));
      } catch {
        setReturning(false);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const start = async () => {
    setSaving(true);

    try {
      const current = normalizeProfile(profile ?? (await getProfile()));

      const next = {
        ...current,
        goal,
        lastMode: 'home' as const,
        unlockedKinds: current.unlockedKinds?.length
          ? current.unlockedKinds
          : [...DEFAULT_UNLOCK],
      };

      await saveProfile(next);
      markTrainerStarted();
      window.location.assign(APP_BASE);
    } catch {
      setSaving(false);
    }
  };

  const primaryHref = !ready ? undefined : returning ? continueHref(profile) : '#method';
  const primaryLabel = returning ? '続きから' : FRESH_START;

  return (
    <div className="lp-frame">
      <header className="lp-nav">
        <Link
          className="brand lp-brand"
          href="/"
          aria-label="CW Operator Trainer"
        >
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
        </Link>

        <nav className="lp-nav-links" aria-label="ページ内">
          <a href="#demo">受信機</a>
          {ready && !returning && <a href="#method">学習法</a>}
          <a href={ready && returning ? APP_BASE : '#method'}>アプリへ</a>
        </nav>

        {ready && primaryHref && (
          <a className="btn btn-primary" href={primaryHref}>
            {primaryLabel}
          </a>
        )}
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-stage">
            <figure className="lp-hero-visual">
              <Image
                src="/landing/night-desk.png"
                alt="夜のアマチュア無線デスク。モニターにCW受信機、手前に電鍵"
                fill
                priority
                sizes="100vw"
              />
            </figure>

            <div className="lp-hero-copy">
              <p className="section-kicker">
                LISTEN · LEARN · KEY · QSO
              </p>

              <h1>
                耳で読む。
                <br />
                <em>モールスの世界へ。</em>
              </h1>

              <p>
                聞いて、覚えて、打って、交信する。
                ブラウザだけで始められる、本格的なCWトレーナーです。
              </p>

              <ul className="lp-hero-pills">
                {HERO_PILLS.map((pill) => (
                  <li key={pill.title}>
                    <span className="lp-hero-pill-icon" aria-hidden="true">
                      <Icon name={pill.icon} size={18} />
                    </span>
                    <div>
                      <strong>{pill.title}</strong>
                      <small>{pill.body}</small>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="lp-hero-actions">
                {ready && primaryHref && (
                  <a className="btn btn-primary btn-lg lp-hero-cta" href={primaryHref}>
                    {returning ? '続きから始める' : FRESH_START}
                    <small>{returning ? 'ホームを開く' : 'コースを選ぶ'}</small>
                  </a>
                )}

                <a className="btn btn-ghost btn-lg lp-hero-cta" href="#demo">
                  まずは見てみる
                  <small>受信機デモへ</small>
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-paths-wrap" aria-label="学びの入り口">
          <div className="lp-paths">
            {PATH_CARDS.map((card) => (
              <a key={card.view} className={`lp-path tone-${card.tone}`} href={viewToPath(card.view)}>
                <span className="lp-path-visual">
                  <Image src={card.src} alt={card.alt} fill sizes="(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 25vw" />
                </span>
                <strong className="lp-path-kicker">{card.kicker}</strong>
                <span className="lp-path-foot">
                  <b>{card.title}<i aria-hidden="true">→</i></b>
                  <small>{card.body}</small>
                </span>
              </a>
            ))}
          </div>
        </section>

        <section id="demo" className="page-pad lp-section">
          <div className="page-title">
            <div>
              <p className="section-kicker">RIG</p>

              <h1>ブラウザで動く無線機</h1>

              <p>
                周波数を合わせ、信号を探し、フィルターを絞る。
                実際のQSO練習で使う受信機を、そのまま体験できます。
              </p>
            </div>
          </div>

          <RigDemoSlot />
        </section>

        {ready && !returning && (
          <section id="method" className="page-pad lp-section">
            <div className="page-title">
              <div>
                <p className="section-kicker">COURSE</p>

                <h1>自分に合った覚え方から</h1>

                <p>
                  音そのものを覚える「音感法」と、
                  日本語の語呂を手がかりにする「合調法」。
                  目標や始めやすさに合わせて選べます。
                </p>
              </div>
            </div>

            <div
              className="lp-compare"
              role="radiogroup"
              aria-label="学習法"
            >
              <button
                type="button"
                role="radio"
                aria-checked={goal === 'sound'}
                className={`panel panel-pad lp-compare-card ${
                  goal === 'sound' ? 'active' : ''
                }`}
                onClick={() => setGoal('sound')}
              >
                <p className="section-kicker">
                  QSO・高速受信を目指すなら
                </p>

                <span className={goal === 'sound' ? 'lp-badge' : 'lp-badge lp-badge-quiet'}>
                  おすすめ
                </span>

                <h2>音感法</h2>

                <p>
                  モールス符号を「音のかたまり」として覚える方法です。
                  慣れてくると、符号を頭の中で変換せず、
                  音から直接文字を読み取れるようになります。
                </p>

                <ul>
                  <li>
                    向いている人：
                    QSO・高速受信・資格試験を目指したい
                  </li>
                  <li>
                    特徴：
                    最初は少し難しくても、実践的な受信へそのままつながります
                  </li>
                </ul>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={goal === 'fun'}
                className={`panel panel-pad lp-compare-card ${
                  goal === 'fun' ? 'active' : ''
                }`}
                onClick={() => setGoal('fun')}
              >
                <p className="section-kicker">
                  楽しく符号を覚えるなら
                </p>

                {goal === 'fun' ? (
                  <span className="lp-badge">選択中</span>
                ) : null}

                <h2>合調法</h2>

                <p>
                  モールスの長短を日本語の語呂に置き換えて覚える方法です。
                  「まずはモールスを覚えてみたい」という人でも、
                  気軽に始められます。
                </p>

                <ul>
                  <li>
                    向いている人：
                    モールスを初めて覚える・楽しみながら始めたい
                  </li>
                  <li>
                    特徴：
                    符号を覚えたあと、音感法へ移るための練習もできます
                    <div className="lp-method-note mt-4">
                      ※ より速い受信を目指して音感法へ移る際、覚えた語呂が少し邪魔になり、結果的に遠回りになることもあります。
                    </div>
                  </li>
                </ul>
              </button>
            </div>

            <p className="lp-method-foot">
              学習法は、アプリの設定からいつでも変更できます。これまでの履歴はそのまま引き継がれます。
              迷ったら音感法がおすすめです。欧文・数字・記号・和文にも対応しています。
            </p>

            <div className="lp-start">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                disabled={saving}
                onClick={() => void start()}
              >
                <Icon name="play" size={18} />
                {saving ? '保存中…' : goal === 'fun' ? '合調法で始める' : '音感法で始める'}
              </button>
            </div>
          </section>
        )}

        <section className="lp-features-wrap" aria-label="体験と試験対策">
          <div className="lp-features">
            {FEATURE_CARDS.map((card) => (
              <a
                key={card.tone}
                className={`lp-feature tone-${card.tone}`}
                href={card.href}
              >
                <span className="lp-feature-visual">
                  <Image
                    src={card.src}
                    alt={card.alt}
                    fill
                    sizes="(max-width: 760px) 100vw, 50vw"
                  />
                </span>
                <span className="lp-feature-cta">
                  {card.label}
                  <i aria-hidden="true">→</i>
                </span>
              </a>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
