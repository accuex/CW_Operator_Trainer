'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { APP_BASE, APP_VIEWS, viewToPath, type AppView } from '@/lib/appPaths';
import { DEFAULT_UNLOCK } from '@/lib/course';
import { getProfile, isLandingReturning, markTrainerStarted, normalizeProfile, saveProfile } from '@/lib/storage';
import type { TrainerProfile } from '@/lib/types';
import { Icon } from '@/app/components/icons';
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
    alt: '和文受信用紙を書きながら和文CWの交信を体験する',
    label: 'CW交信を体験する',
    href: viewToPath('qso'),
    tone: 'wabun',
  },
  {
    src: '/landing/1sotu_tiri.png',
    alt: '第一級総合無線通信士（1総通）の試験対策をする勉強机',
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

const ABOUT_ITEMS: { title: string; body: string; view: AppView }[] = [
  {
    title: '欧文・和文CWを覚える',
    body: '欧文・数字・記号に加えて、和文モールス（和文CW）にも対応。音のかたまりで覚える音感法と、語呂で覚える合調法から選べます。',
    view: 'learn',
  },
  {
    title: 'コッホ法で聞き取る',
    body: '聞き取る文字を少しずつ増やすコッホ法で受信力を育て、遅れ受信やレベル試験で実戦的なCW受信へつなげます。',
    view: 'train',
  },
  {
    title: '仮想バンドでQSO交信',
    body: '7MHzの仮想バンドでCQを出し、相手局とのCW QSOを体験。ブラウザで動く受信機で信号を探して交信します。',
    view: 'qso',
  },
  {
    title: '1総通の試験対策',
    body: '第一級総合無線通信士（1総通）の電気通信術を試験形式で練習。法規・地理・英語もまとめて学べます。',
    view: 'exam',
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
      <header className="lp-masthead">
        <div className="lp-banner">
          <Link className="lp-banner-logo" href="/">
            <Image
              src="/landing/academy_header_logo.webp"
              alt="CWOT Academy CWOT通信アカデミー — 符号でつながる、もっと広い世界へ。"
              width={1600}
              height={376}
              sizes="(max-width: 760px) 92vw, 760px"
              priority
            />
          </Link>
        </div>

        <div className="lp-menu">
          <nav className="lp-menu-links" aria-label="サイト">
            <Link className="lp-menu-home" href="/" aria-current="page">
              <Icon name="home" size={22} />
              <span className="sr-only">トップ</span>
            </Link>
            <a href={viewToPath('learn')}>学ぶ</a>
            <a href={viewToPath('levelup')}>練習する</a>
            <a href={viewToPath('qso')}>交信する</a>
            <a href="#demo">受信機</a>
            <a href={ready && returning ? APP_BASE : '#method'}>アプリへ</a>
          </nav>

          {ready && primaryHref && (
            <a className="lp-menu-cta" href={primaryHref}>
              {primaryLabel}
              <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </header>

      <main>
        <section className="lp-hero" aria-labelledby="lp-hero-title">
          <figure className="lp-hero-visual">
            <Image
              src="/landing/hero_bg.webp"
              alt="桜と富士山が見える窓辺で、ヘッドホンをつけた5人の生徒が無線機と電鍵を囲んでいる"
              width={1677}
              height={938}
              sizes="100vw"
              priority
            />
          </figure>

          <div className="lp-hero-copy">
            <p className="lp-hero-kicker">CW × RADIO × PEOPLE × TOMORROW</p>

            <h1 id="lp-hero-title">
              電波で、
              <br />
              もっとつながる
              <br />
              <em>世界へ。</em>
            </h1>

            <p className="lp-hero-lead">
              聞いて、覚えて、打って、交信する。
              <br />
              ここから広がる、無線の世界。
            </p>

            <p className="lp-hero-motto" lang="en">
              Same Waves,{' '}
              <br />
              A Brighter Tomorrow.
            </p>
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

              <h2>ブラウザで動く無線機</h2>

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

                <h2>自分に合った覚え方から</h2>

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

        <section className="page-pad lp-section" aria-labelledby="lp-about-title">
          <div className="page-title">
            <div>
              <p className="section-kicker">ABOUT</p>

              <h2 id="lp-about-title">モールス符号（CW）を、覚えて・聞いて・交信する</h2>

              <p>
                CWOT Academy は、ブラウザだけで使えるモールス符号の練習サイトです。
                はじめての符号から和文CW、QSO、1総通（第一級総合無線通信士）の試験対策まで、ひとつの場所で続けられます。
              </p>
            </div>
          </div>

          <ul className="lp-about">
            {ABOUT_ITEMS.map((item) => (
              <li key={item.view} className="panel panel-pad">
                <h3>
                  <a href={viewToPath(item.view)}>{item.title}</a>
                </h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

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
