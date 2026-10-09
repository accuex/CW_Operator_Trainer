'use client';

import type { CSSProperties } from 'react';
import Image from 'next/image';
import { summary, weakPairs, forWeakAnalysis } from '@/lib/analytics';
import { CARDS } from '@/lib/morse';
import { cardsForPractice, scopeSetLabel } from '@/lib/course';
import type { AnswerLog, SessionRecord, TrainerProfile } from '@/lib/types';
import { type View, cardKey, isLearned, pct } from '@/app/trainer/shared';
import { DAILY_GOAL, type PlayerStats } from '@/app/trainer/progress';
import { ProgressBar, Ring } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';
import { TradingCard } from '@/app/components/TradingCard';
import Link from 'next/link';

/** `art` indexes the portrait / icon cut from assets/top (card_N, icon_N). */
interface Tile { view: View; art: number; title: string; body: string; meta: string; tone: string }

const NEWS: { date: string; text: string }[] = [
  { date: '2026.10.09', text: 'CWOTアカデミーを公開しました！' },
];

export function Dashboard({ answers, sessions, profile, stats, onNavigate }: { answers: AnswerLog[]; sessions: SessionRecord[]; profile: TrainerProfile; stats: PlayerStats; onNavigate: (view: View) => void }) {
  const copied = forWeakAnalysis(answers);
  const totals = summary(copied);
  const pairs = weakPairs(copied);
  const lastQueue = [...sessions].reverse().find((session) => session.queue)?.queue;
  const courseCards = cardsForPractice(CARDS, profile.unlockedKinds);
  const nextCard = courseCards.find((card) => !profile.cards[cardKey(card)]?.mastered && isLearned(profile.cards[cardKey(card)]))
    ?? courseCards.find((card) => !profile.cards[cardKey(card)]?.mastered);
  const isNew = answers.length === 0;
  const goalDone = stats.todayAnswers >= DAILY_GOAL;
  const showMnemonics = profile.goal === 'fun';

  const tiles: Tile[] = [
    { view: 'learn', art: 0, title: 'おぼえる', body: '語呂とリズムで1文字ずつ。聴く→数える→当てるの3ステップ。', meta: `${stats.mastered} 枚 GET`, tone: 'gold' },
    { view: 'train', art: 1, title: '聴きとる', body: '符号を見ずに音だけで即答。コッホ法で受信力を育てよう。', meta: totals.answers ? `正答率 ${pct(totals.accuracy)}` : 'まずは10問', tone: 'sky' },
    { view: 'queue', art: 2, title: '遅れ受信', body: '聴きながら覚えて、古い順に書く。実戦の頭を作ろう。', meta: lastQueue ? `安定深度 ${lastQueue.stableDepth.toFixed(1)}` : '目標 Queue 3', tone: 'violet' },
    { view: 'exam', art: 3, title: '一総通', body: '電気通信術・地理・専門英語・法規。取り組みたい教材を選ぼう。', meta: '4つの教材', tone: 'coral' },
    { view: 'resources', art: 4, title: '資料', body: '符号表・フォネティック・略語集・お役立ちリンク。', meta: '練習のおともに', tone: 'sky' },
    { view: 'analysis', art: 5, title: '苦手分析', body: pairs[0] ? `${pairs[0].a} と ${pairs[0].b} を取り違えがち。弱点を克服して次のステップへ。` : '取り違えの「方向」を見つけよう。弱点を克服して、次のステップへ。', meta: pairs.length ? `${pairs.length} ペア検出` : 'データ待ち', tone: 'mint' },
  ];

  return <section className="dashboard">
    <div className="home-stage">
      <figure className="home-stage-art">
        <Image src="/assets/top/top_hero.webp" alt="" width={1600} height={900} sizes="(max-width: 760px) 100vw, 80vw" priority />
      </figure>
      <h1 className="sr-only">ホーム</h1>

      <div className="home-bubble">
        <b>みおり</b>
        {isNew ? (
          <p>CWOTアカデミーへようこそ！<br />少しずつでいいよ。<br />続けることが、きっと力になる！</p>
        ) : (
          <p>おかえり！{scopeSetLabel(profile.unlockedKinds)} を練習中。<br />
            {goalDone ? '今日の目標は達成済み！さらに伸ばすならコンボに挑戦。' : `今日はあと ${Math.max(0, DAILY_GOAL - stats.todayAnswers)} 問で目標達成だよ。`}</p>
        )}
        {profile.goal === null && (
          <Link className="home-bubble-hint" href="/#method">学習法（音感／合調）が未選択です。サイトトップで選んでから始めると、カードの合調表示が決まります。</Link>
        )}
      </div>

      <div className="home-status">
        <div className="home-status-head">
          <h2>学習ステータス</h2>
          <button type="button" className="home-status-more" onClick={() => onNavigate('levelup')}>詳しく見る</button>
        </div>
        <button type="button" className="player-level" onClick={() => onNavigate('levelup')} aria-label={`コッホ Lv.${stats.level}、レベル試験へ`}>
          <Ring value={stats.levelProgress} size={78} stroke={7} tone="url(#lv)">
            <small>Lv.</small><b>{stats.level}</b>
          </Ring>
          <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}><defs><linearGradient id="lv" x1="0" x2="1"><stop offset="0" stopColor="#5f8dff" /><stop offset="1" stopColor="#a9c6ff" /></linearGradient></defs></svg>
          <div>
            <span>コッホ {stats.levelChars} 文字</span>
            <ProgressBar value={stats.levelProgress} tone="sky" label="現レベルの進捗" />
            <b>ベスト {stats.levelBest ? pct(stats.levelBest) : '—'}</b>
            <small>{stats.kochComplete ? '全レベル クリア！' : `90% で「${stats.nextChar}」解放`}</small>
          </div>
        </button>
        <div className="home-status-row">
          <div className={`player-stat streak ${stats.streakDays ? 'on' : ''}`}>
            <Icon name="flame" size={22} />
            <div><b>{stats.streakDays}</b><span>日連続</span></div>
          </div>
          <div className="player-stat goal">
            <Ring value={stats.dailyProgress} size={40} stroke={5} tone={goalDone ? 'var(--mint)' : 'var(--gold)'}>
              {goalDone ? <Icon name="check" size={16} /> : null}
            </Ring>
            <div><b>{stats.todayAnswers}<small>/{DAILY_GOAL}</small></b><span>今日の目標</span></div>
          </div>
          {nextCard ? (
            <button type="button" className="next-card" onClick={() => onNavigate('learn')}>
              <span className="next-card-label">次のカード</span>
              <div className="next-card-art"><TradingCard card={nextCard} progress={profile.cards[cardKey(nextCard)]} hideMnemonic={!showMnemonics} compact /></div>
              <small>タップして練習</small>
            </button>
          ) : (
            <button type="button" className="next-card empty" onClick={() => onNavigate('learn')}>
              <span className="next-card-label">セットを確認</span>
              <b>?</b>
              <small>おぼえるへ</small>
            </button>
          )}
        </div>
      </div>
    </div>

    <div className="home-body">
      <div className="home-section-head">
        <h2>トレーニング</h2>
        <small>目的に合わせて、今日やることを選ぼう</small>
        <span className="home-section-motto" lang="en">Morse × Learning × A Brighter Tomorrow.</span>
      </div>
      <div className="home-cards">
        {tiles.map((tile) => (
          <button
            key={tile.view}
            type="button"
            className={`home-card tone-${tile.tone}`}
            style={{ '--art': `url(/assets/top/card_${tile.art}.webp)` } as CSSProperties}
            onClick={() => onNavigate(tile.view)}
          >
            <span className="home-card-title">
              <Image src={`/assets/top/icon_${tile.art}.webp`} alt="" width={34} height={34} />
              <h3>{tile.title}</h3>
            </span>
            <p>{tile.body}</p>
            <span className="home-card-meta">{tile.meta}<Icon name="chevron-right" size={16} /></span>
          </button>
        ))}
      </div>

      <div className="home-lower">
        <div className="home-qso">
          <div className="home-qso-copy">
            <small>実際に交信してみよう</small>
            <h2>仮想バンドでQSO体験</h2>
            <p>7MHzの仮想バンドで、世界中の仲間とつながる。<br />聞こえた符号を拾って、最初のQSOを目指そう。</p>
            <button type="button" className="btn btn-primary" onClick={() => onNavigate('qso')}>QSO交信へ<Icon name="chevron-right" size={16} /></button>
          </div>
          <p className="home-qso-quote">聞こえたか？<br />それが、世界につながる瞬間じゃ。<span>— 源さん</span></p>
        </div>

        <div className="home-news">
          <h2><Icon name="sparkle" size={16} />お知らせ</h2>
          <ul>
            {NEWS.map((item) => (
              <li key={item.date + item.text}><time dateTime={item.date.replaceAll('.', '-')}>{item.date}</time>{item.text}</li>
            ))}
          </ul>
        </div>
      </div>

      <p className="home-sign" lang="en">Same Waves, A Brighter Tomorrow.</p>
    </div>
  </section>;
}
