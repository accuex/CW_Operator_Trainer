'use client';

import { summary, weakPairs, forWeakAnalysis } from '@/lib/analytics';
import { CARDS } from '@/lib/morse';
import { cardsForPractice, scopeSetLabel } from '@/lib/course';
import type { AnswerLog, SessionRecord, TrainerProfile } from '@/lib/types';
import { type View, cardKey, fmtLatency, isLearned, pct } from '@/app/trainer/shared';
import { DAILY_GOAL, type PlayerStats } from '@/app/trainer/progress';
import { Metric, ProgressBar, Ring } from '@/app/components/ui';
import { Icon, type IconName } from '@/app/components/icons';
import { TradingCard } from '@/app/components/TradingCard';
import Link from 'next/link';

interface Tile { view: View; icon: IconName; title: string; body: string; meta: string; tone: string }

export function Dashboard({ answers, sessions, profile, stats, onNavigate }: { answers: AnswerLog[]; sessions: SessionRecord[]; profile: TrainerProfile; stats: PlayerStats; onNavigate: (view: View) => void }) {
  const copied = forWeakAnalysis(answers);
  const totals = summary(copied);
  const pairs = weakPairs(copied);
  const lastQueue = [...sessions].reverse().find((session) => session.queue)?.queue;
  const courseCards = cardsForPractice(CARDS, profile.unlockedKinds);
  const collectionPool = courseCards.length ? courseCards : CARDS;
  const masteredInPool = collectionPool.filter((card) => profile.cards[cardKey(card)]?.mastered);
  const nextCard = courseCards.find((card) => !profile.cards[cardKey(card)]?.mastered && isLearned(profile.cards[cardKey(card)]))
    ?? courseCards.find((card) => !profile.cards[cardKey(card)]?.mastered);
  const recent = [...masteredInPool]
    .sort((a, b) => (profile.cards[cardKey(b)]?.masteredAt ?? 0) - (profile.cards[cardKey(a)]?.masteredAt ?? 0))
    .slice(0, 6);
  const isNew = answers.length === 0;
  const goalDone = stats.todayAnswers >= DAILY_GOAL;
  const showMnemonics = profile.goal === 'fun';

  const tiles: Tile[] = [
    { view: 'levelup', icon: 'trophy', title: 'レベル試験', body: 'コッホ法。少ない文字から聴き取り、90%で次の文字を解放。', meta: `Lv.${stats.level} / ${stats.maxLevel}`, tone: 'violet' },
    { view: 'learn', icon: 'learn', title: 'おぼえる', body: '語呂とリズムで1文字ずつ。聴く→数える→当てるの3ステップ。', meta: `${stats.mastered} 枚 GET`, tone: 'gold' },
    { view: 'train', icon: 'train', title: '聴きとる', body: '符号を見ずに音だけで即答。コンボを伸ばそう。', meta: totals.answers ? `正答率 ${pct(totals.accuracy)}` : 'まずは10問', tone: 'sky' },
    { view: 'queue', icon: 'queue', title: '遅れ受信', body: '聴きながら覚えて、古い順に書く。実戦の頭を作る。', meta: lastQueue ? `安定深度 ${lastQueue.stableDepth.toFixed(1)}` : '目標 Queue 3', tone: 'violet' },
    { view: 'exam', icon: 'exam', title: '一総通 試験', body: '和文75・欧文暗語80・普通語100字/分の本番形式。', meta: '5分 · 額表つき', tone: 'coral' },
    { view: 'analysis', icon: 'analysis', title: '苦手分析', body: pairs[0] ? `${pairs[0].a} と ${pairs[0].b} を取り違えがち。` : '取り違えの「方向」を見つけます。', meta: pairs.length ? `${pairs.length} ペア検出` : 'データ待ち', tone: 'mint' },
    { view: 'collection', icon: 'collection', title: 'カード図鑑', body: '習得した文字がカードになって集まる。', meta: `${masteredInPool.length} / ${collectionPool.length}`, tone: 'gold' },
  ];

  return <section className="dashboard page-pad">
    <div className="home-hero panel">
      <div className="home-hero-copy">
        {profile.goal === null && (
          <p className="home-hint"><Link href="/#method">学習法（音感／合調）が未選択です。サイトトップで選んでから始めると、カードの合調表示が決まります。</Link></p>
        )}
        <p className="section-kicker"><Icon name="sparkle" size={14} />{isNew ? 'WELCOME' : 'WELCOME BACK'}</p>
        <h1>{isNew ? <>耳で読む。<br /><em>モールスの世界へ。</em></> : <>今日も<em>1文字</em>、<br />耳を育てよう。</>}</h1>
        <p>{scopeSetLabel(profile.unlockedKinds)} を練習中。
          {goalDone ? ' 今日の目標は達成済み！さらに伸ばすならコンボに挑戦。' : ` 今日はあと ${Math.max(0, DAILY_GOAL - stats.todayAnswers)} 問で目標達成。`}</p>
        <div className="home-hero-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => onNavigate('learn')}>
            <Icon name="play" size={18} />{courseCards.length ? '続きから練習' : 'はじめる'}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => onNavigate('train')}>
            <Icon name="train" size={18} />聴きとりへ
          </button>
        </div>
      </div>

      <div className="home-player">
        <div className="player-card">
          <button type="button" className="player-level" onClick={() => onNavigate('levelup')} aria-label={`コッホ Lv.${stats.level}、レベル試験へ`}>
            <Ring value={stats.levelProgress} size={96} stroke={8} tone="url(#lv)">
              <small>Lv.</small><b>{stats.level}</b>
            </Ring>
            <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}><defs><linearGradient id="lv" x1="0" x2="1"><stop offset="0" stopColor="#8c7bff" /><stop offset="1" stopColor="#d0c4ff" /></linearGradient></defs></svg>
            <div>
              <span>コッホ {stats.levelChars} 文字</span>
              <b>{stats.levelBest ? pct(stats.levelBest) : '—'}</b>
              <small>{stats.kochComplete ? '全レベル クリア！' : `90% で「${stats.nextChar}」解放`}</small>
            </div>
          </button>
          <div className="player-row">
            <div className={`player-stat streak ${stats.streakDays ? 'on' : ''}`}>
              <Icon name="flame" size={22} />
              <div><b>{stats.streakDays}</b><span>日連続</span></div>
            </div>
            <div className="player-stat goal">
              <Ring value={stats.dailyProgress} size={44} stroke={5} tone={goalDone ? 'var(--mint)' : 'var(--gold)'}>
                {goalDone ? <Icon name="check" size={18} /> : null}
              </Ring>
              <div><b>{stats.todayAnswers}<small>/{DAILY_GOAL}</small></b><span>今日の問題</span></div>
            </div>
          </div>
        </div>

        {nextCard ? (
          <button type="button" className="next-card" onClick={() => onNavigate('learn')}>
            <div className="next-card-art"><TradingCard card={nextCard} progress={profile.cards[cardKey(nextCard)]} hideMnemonic={!showMnemonics} compact /></div>
            <div className="next-card-copy">
              <span>次のターゲット</span>
              <b>{nextCard.symbol}</b>
              <small>タップして練習</small>
            </div>
          </button>
        ) : (
          <button type="button" className="next-card empty" onClick={() => onNavigate('learn')}>
            <div className="next-card-copy"><span>セットを確認</span><b>?</b><small>おぼえるへ</small></div>
          </button>
        )}
      </div>
    </div>

    <div className="home-section-head">
      <h2>トレーニング</h2>
      <small>目的に合わせて選ぼう</small>
    </div>
    <div className="mode-grid">
      {tiles.map((tile) => (
        <button key={tile.view} type="button" className={`mode-tile tone-${tile.tone} ${tile.view === 'levelup' ? 'featured' : ''}`} onClick={() => onNavigate(tile.view)}>
          <span className="mode-icon"><Icon name={tile.icon} size={26} /></span>
          <h3>{tile.title}</h3>
          <p>{tile.body}</p>
          <span className="mode-meta">{tile.meta}<Icon name="chevron-right" size={16} /></span>
        </button>
      ))}
    </div>

    <div className="home-bottom">
      <div className="panel panel-pad home-collection">
        <div className="panel-head">
          <h3><Icon name="collection" size={18} /> コレクション</h3>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onNavigate('collection')}>図鑑を開く<Icon name="chevron-right" size={14} /></button>
        </div>
        <div className="collection-progress">
          <b>{masteredInPool.length}<small> / {collectionPool.length} 枚</small></b>
          <ProgressBar value={collectionPool.length ? masteredInPool.length / collectionPool.length : 0} tone="gold" label="コレクション進捗" />
        </div>
        {recent.length ? (
          <div className="recent-cards">
            {recent.map((card) => <div key={cardKey(card)} className="recent-card"><TradingCard card={card} progress={profile.cards[cardKey(card)]} compact hideMnemonic={!showMnemonics} /></div>)}
          </div>
        ) : (
          <p className="home-hint">RECALL で連続正解すると、最初のカードが手に入ります。</p>
        )}
      </div>
      <div className="panel panel-pad home-stats">
        <div className="panel-head">
          <h3><Icon name="analysis" size={18} /> これまでの記録</h3>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onNavigate('analysis')}>分析<Icon name="chevron-right" size={14} /></button>
        </div>
        <div className="home-metrics">
          <Metric label="回答数" value={String(totals.answers)} suffix="問" />
          <Metric label="正答率" value={totals.answers ? pct(totals.accuracy) : '—'} />
          <Metric label="反応時間" value={fmtLatency(totals.medianLatency)} />
          <Metric label="安定Queue" value={lastQueue ? lastQueue.stableDepth.toFixed(1) : '—'} />
        </div>
      </div>
    </div>
  </section>;
}
