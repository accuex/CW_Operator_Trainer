'use client';

import { useEffect, useState } from 'react';
import { ACHIEVEMENTS, type AchievementDef } from '@/lib/achievements';
import { effectiveDisplayRarity } from '@/lib/collectionReveal';
import { CARDS, type MorseCard } from '@/lib/morse';
import { COURSE_CATALOG, KIND_LABEL, cardsForCourse, courseMeta, type CharacterKind } from '@/lib/course';
import { readProgressMeter } from '@/lib/progressMeter';
import type { AudioSettings, CardProgress, CardRarityOwned, TrainerProfile } from '@/lib/types';
import { audioEngine, cardKey, cardStatus, CARD_STATUS_LABEL, emptyProgress, formatCode, mnemonicFor, mnemonicCategoryFor, masteryFor } from '@/app/trainer/shared';
import { AchievementCard } from '@/app/components/AchievementCard';
import { TradingCard } from '@/app/components/TradingCard';
import { ProgressBar, Ring, Segmented } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';

const cardNumber = (card: MorseCard) => `No.${String(CARDS.indexOf(card) + 1).padStart(3, '0')}`;
const achievementNumber = (item: AchievementDef) => `Ach.${String(ACHIEVEMENTS.indexOf(item) + 1).padStart(2, '0')}`;
const CATEGORY_LABEL: Record<string, string> = { Recommended: 'おすすめ', Classic: '定番', Funny: 'おもしろ', Custom: '自作' };

type ArchiveTab = 'chars' | 'achievements';

export function CollectionView({ settings, profile, setProfile, setAudioStatus }: { settings: AudioSettings; profile: TrainerProfile; setProfile: React.Dispatch<React.SetStateAction<TrainerProfile>>; setAudioStatus: (status: string) => void }) {
  const course = profile.learnCourse ?? null;
  const revealAll = Boolean(profile.revealAll);
  const unlockedKinds = revealAll && course
    ? COURSE_CATALOG[course]
    : (profile.unlockedKinds ?? []);
  const courseCards = cardsForCourse(CARDS, course, unlockedKinds);
  const [archiveTab, setArchiveTab] = useState<ArchiveTab>('chars');
  const [kindFilter, setKindFilter] = useState<CharacterKind | 'all'>('all');
  const [previewRarity, setPreviewRarity] = useState<CardRarityOwned>('SSR');
  const [selected, setSelected] = useState<MorseCard | null>(null);
  const [selectedAchievement, setSelectedAchievement] = useState<AchievementDef | null>(null);
  const kinds = [...new Set(courseCards.map((card) => card.kind))];
  const cards = kindFilter === 'all' ? courseCards : courseCards.filter((card) => card.kind === kindFilter);
  const masteredCount = cards.filter((card) => profile.cards[cardKey(card)]?.mastered).length;
  const learningCount = cards.filter((card) => {
    const progress = profile.cards[cardKey(card)];
    return !progress?.mastered && readProgressMeter(progress) > 0;
  }).length;
  const achievementUnlocked = ACHIEVEMENTS.filter((item) => profile.achievements?.[item.id]?.unlockedAt).length;
  const revealCard = (progress?: CardProgress) => Boolean(progress?.mastered) || revealAll;
  const revealAchievement = (id: AchievementDef['id']) => Boolean(profile.achievements?.[id]?.unlockedAt) || revealAll;
  const play = async (card: MorseCard) => {
    setAudioStatus('PLAYING');
    try {
      // Gesture 内で先に unlock（他アプリ音のあとの iOS interrupted 対策）
      await audioEngine.unlock();
      const handle = await audioEngine.playSymbol(card.symbol, card.code, settings, 1);
      await handle.finished;
    } catch {
      /* playback aborted / audio blocked */
    } finally {
      setAudioStatus('READY');
    }
  };
  const chooseMnemonic = (card: MorseCard, value: string) => {
    const progress = profile.cards[cardKey(card)] ?? emptyProgress();
    setProfile((old) => ({ ...old, cards: { ...old.cards, [cardKey(card)]: { ...progress, selectedMnemonic: value, customMnemonic: value === progress.customMnemonic ? progress.customMnemonic : undefined } } }));
  };
  const selectedProgress = selected ? profile.cards[cardKey(selected)] ?? emptyProgress() : undefined;
  const showMnemonics = profile.goal === 'fun' || revealAll;
  const selectedRevealed = selected ? revealCard(selectedProgress) : false;
  const selectedDisplayRarity = selected
    ? effectiveDisplayRarity(selectedProgress, revealAll, previewRarity)
    : null;
  const selectedIndex = selected ? cards.indexOf(selected) : -1;
  const selectedAchievementUnlocked = selectedAchievement
    ? revealAchievement(selectedAchievement.id)
    : false;
  const selectedAchievementIndex = selectedAchievement ? ACHIEVEMENTS.indexOf(selectedAchievement) : -1;
  const cardPreviewRarity = revealAll ? previewRarity : undefined;

  useEffect(() => {
    if (!selected && !selectedAchievement) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (event.key === 'Escape') {
        setSelected(null);
        setSelectedAchievement(null);
      }
      if (selected && event.key === 'ArrowRight' && selectedIndex >= 0) setSelected(cards[(selectedIndex + 1) % cards.length]);
      if (selected && event.key === 'ArrowLeft' && selectedIndex >= 0) setSelected(cards[(selectedIndex - 1 + cards.length) % cards.length]);
      if (selectedAchievement && event.key === 'ArrowRight' && selectedAchievementIndex >= 0) {
        setSelectedAchievement(ACHIEVEMENTS[(selectedAchievementIndex + 1) % ACHIEVEMENTS.length]);
      }
      if (selectedAchievement && event.key === 'ArrowLeft' && selectedAchievementIndex >= 0) {
        setSelectedAchievement(ACHIEVEMENTS[(selectedAchievementIndex - 1 + ACHIEVEMENTS.length) % ACHIEVEMENTS.length]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectedIndex, cards, selectedAchievement, selectedAchievementIndex]);

  const switchTab = (tab: ArchiveTab) => {
    setArchiveTab(tab);
    setSelected(null);
    setSelectedAchievement(null);
  };

  const heroComplete = archiveTab === 'achievements'
    ? (ACHIEVEMENTS.length ? achievementUnlocked / ACHIEVEMENTS.length : 0)
    : (cards.length ? masteredCount / cards.length : 0);

  return <section className="page-pad collection-page">
    <div className="collection-hero panel">
      <div className="collection-hero-copy">
        <p className="section-kicker"><Icon name="collection" size={14} />CARD ARCHIVE{course ? ` · ${courseMeta(course)?.short}` : ''}</p>
        <h1>カード図鑑</h1>
        <p>{revealAll
          ? '全解放表示中（プレビュー）。下のレア切替で R / SR / SSR を見られます。GET数は本物の進捗のまま。'
          : archiveTab === 'achievements'
            ? '条件を満たすと実績カードが解禁。未取得は中身シークレット（???）。'
            : course
              ? 'コース内の文字は最初から見えます。カード絵は「当てる」やコッホ昇級でGETして集めよう。'
              : '「おぼえる」でコースを選ぶと、その範囲のカードがここに並びます。学習記録は消えません。'}</p>
        <div className="collection-tally">
          {archiveTab === 'achievements' ? (
            <>
              <span className="tally gold"><b>{achievementUnlocked}</b>GET</span>
              <span className="tally"><b>{ACHIEVEMENTS.length - achievementUnlocked}</b>未解禁</span>
            </>
          ) : (
            <>
              <span className="tally gold"><b>{masteredCount}</b>GET</span>
              <span className="tally sky"><b>{learningCount}</b>練習中</span>
              <span className="tally"><b>{Math.max(0, cards.length - masteredCount - learningCount)}</b>未発見</span>
            </>
          )}
        </div>
      </div>
      <div className="collection-hero-ring">
        <Ring value={heroComplete} size={150} stroke={12}>
          <b>{Math.round(heroComplete * 100)}<small>%</small></b>
          <span>COMPLETE</span>
        </Ring>
      </div>
    </div>

    <div className="collection-toolbar">
      <Segmented
        label="図鑑"
        value={archiveTab}
        options={[['chars', '文字カード'], ['achievements', '実績']]}
        onChange={(value) => switchTab(value as ArchiveTab)}
      />
      {archiveTab === 'chars' && course && (
        <Segmented
          label="文字種"
          value={kindFilter}
          options={[['all', 'すべて'], ...kinds.map((kind) => [kind, KIND_LABEL[kind]] as [string, string])]}
          onChange={(value) => { setKindFilter(value as CharacterKind | 'all'); setSelected(null); }}
        />
      )}
      {revealAll && archiveTab === 'chars' && course && (
        <Segmented
          label="プレビューレア"
          value={previewRarity}
          options={[['R', 'R'], ['SR', 'SR'], ['SSR', 'SSR']]}
          onChange={(value) => setPreviewRarity(value as CardRarityOwned)}
        />
      )}
    </div>

    {archiveTab === 'chars' && !course && (
      <div className="collection-empty panel">
        <p>コース未選択です。「おぼえる」でコースを選ぶと文字カードが並びます。実績タブはコースなしでも開けます。</p>
      </div>
    )}

    {archiveTab === 'chars' && course && (
      <div className="card-grid">{cards.map((card, cardIndex) => {
        const progress = profile.cards[cardKey(card)];
        const acquired = revealCard(progress);
        const meter = masteryFor(progress);
        const status = cardStatus(progress);
        return (
          <button
            key={cardKey(card)}
            type="button"
            className={`collection-item status-${status.toLowerCase()} ${acquired ? 'acquired' : 'locked'}`}
            style={{ '--delay': `${Math.min(cardIndex, 30) * 18}ms` } as React.CSSProperties}
            onClick={() => setSelected(card)}
            aria-label={`${card.symbol}のカード詳細${acquired ? '' : '（未取得）'}`}
          >
            <TradingCard key={`${cardKey(card)}-${cardPreviewRarity ?? 'owned'}`} card={card} progress={progress} compact concealed={!acquired} concealedMark={card.symbol} hideMnemonic={!showMnemonics} previewRarity={cardPreviewRarity} />
            <span className="collection-item-meta">
              <small>{cardNumber(card)}</small>
              <b>{card.symbol}</b>
            </span>
            {!progress?.mastered && !revealAll && <span className="collection-item-meter"><i style={{ width: `${meter}%` }} /></span>}
          </button>
        );
      })}</div>
    )}

    {archiveTab === 'achievements' && (
      <div className="card-grid">{ACHIEVEMENTS.map((item, index) => {
        const unlocked = revealAchievement(item.id);
        return (
          <button
            key={item.id}
            type="button"
            className={`collection-item ${unlocked ? 'acquired' : 'locked'} achievement-item`}
            style={{ '--delay': `${Math.min(index, 30) * 18}ms` } as React.CSSProperties}
            onClick={() => setSelectedAchievement(item)}
            aria-label={`${item.title}の実績詳細${unlocked ? '' : '（未解禁）'}`}
          >
            <AchievementCard achievement={item} unlocked={unlocked} compact />
            <span className="collection-item-meta">
              <small>{achievementNumber(item)}</small>
              <b>{unlocked ? item.title : '???'}</b>
            </span>
          </button>
        );
      })}</div>
    )}

    {selected && selectedProgress && <div className="card-drawer-backdrop" onClick={() => setSelected(null)}>
      <div className="card-drawer" role="dialog" aria-modal="true" aria-label={`${selected.symbol}のカード詳細`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="drawer-close" onClick={() => setSelected(null)} aria-label="詳細を閉じる"><Icon name="x" size={22} /></button>
        <div className="drawer-artwork">
          <TradingCard key={`${cardKey(selected)}-${cardPreviewRarity ?? 'owned'}`} card={selected} progress={selectedProgress} concealed={!selectedRevealed} concealedMark={selected.symbol} hideMnemonic={!showMnemonics} interactive={selectedRevealed} previewRarity={cardPreviewRarity} />
          <div className="drawer-nav">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(cards[(selectedIndex - 1 + cards.length) % cards.length])} aria-label="前のカード"><Icon name="chevron-left" size={16} /></button>
            <span>{selectedIndex + 1} / {cards.length}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(cards[(selectedIndex + 1) % cards.length])} aria-label="次のカード"><Icon name="chevron-right" size={16} /></button>
          </div>
        </div>
        <div className="card-detail">
          <div className="detail-tags">
            <span className="chip">{cardNumber(selected)}</span>
            <span className="chip">{KIND_LABEL[selected.kind]}</span>
            {selectedRevealed && selectedDisplayRarity && (
              <span className={`rarity-badge ${selectedDisplayRarity.toLowerCase()}`}>
                {selectedDisplayRarity}{revealAll ? ' · プレビュー' : ''}
              </span>
            )}
            <span className={`chip ${selectedProgress.mastered ? 'gold' : ''}`}>{CARD_STATUS_LABEL[cardStatus(selectedProgress)]}</span>
          </div>
          <div className="detail-heading">
            <h2>{selected.symbol}</h2>
            <div>
              <span className="detail-code">{formatCode(selected.code)}</span>
              <button type="button" className="btn btn-primary" onClick={() => play(selected)}><Icon name="play" size={16} />音を聴く</button>
            </div>
          </div>
          <div className="detail-meter">
            <span>習得度</span>
            <ProgressBar value={masteryFor(selectedProgress) / 100} tone="gold" label="習得度" />
            <b>{masteryFor(selectedProgress)}%</b>
          </div>
          <dl className="card-stats">
            <div><dt>当てた回数</dt><dd>{selectedProgress.correct}<small> / {selectedProgress.attempts}</small></dd></div>
            <div><dt>正答率</dt><dd>{selectedProgress.attempts ? Math.round(selectedProgress.correct / selectedProgress.attempts * 100) : 0}<small>%</small></dd></div>
            <div><dt>連続正解</dt><dd>{selectedProgress.streak}</dd></div>
            <div><dt>聴いた回数</dt><dd>{selectedProgress.exposures ?? 0}</dd></div>
            <div><dt>分類</dt><dd className="small">{showMnemonics && selected.hasMnemonic ? (CATEGORY_LABEL[mnemonicCategoryFor(selected, selectedProgress)] ?? mnemonicCategoryFor(selected, selectedProgress)) : KIND_LABEL[selected.kind]}</dd></div>
            <div><dt>GET日</dt><dd className="small">{selectedProgress.masteredAt ? new Date(selectedProgress.masteredAt).toLocaleDateString('ja-JP') : '—'}</dd></div>
          </dl>
          {!selectedRevealed && <p className="detail-locked"><Icon name="lock" size={16} />「当てる」で10回以上・正答率90%以上・5連続正解でGET！</p>}
          {showMnemonics && selected.hasMnemonic && selectedRevealed && <div className="detail-mnemonic">
            <p className="section-kicker">語呂（合調語）</p>
            <h3>{mnemonicFor(selected, selectedProgress)}</h3>
            <div className="mnemonic-list">{selected.mnemonics.map((option) => (
              <button key={option.label} type="button" className={mnemonicFor(selected, selectedProgress) === option.label ? 'active' : ''} onClick={() => chooseMnemonic(selected, option.label)}>
                <span>{CATEGORY_LABEL[option.category] ?? option.category}</span><b>{option.label}</b>
              </button>
            ))}</div>
            <label className="custom-mnemonic">自分で作る<input placeholder="自分の合調語を入力" value={selectedProgress.customMnemonic ?? ''} onChange={(event) => { const value = event.target.value; const progress = profile.cards[cardKey(selected)] ?? emptyProgress(); setProfile((old) => ({ ...old, cards: { ...old.cards, [cardKey(selected)]: { ...progress, customMnemonic: value, selectedMnemonic: value || selected.title } } })); }} /></label>
          </div>}
        </div>
      </div>
    </div>}

    {selectedAchievement && <div className="card-drawer-backdrop" onClick={() => setSelectedAchievement(null)}>
      <div className="card-drawer" role="dialog" aria-modal="true" aria-label={`${selectedAchievementUnlocked ? selectedAchievement.title : '未解禁実績'}の詳細`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="drawer-close" onClick={() => setSelectedAchievement(null)} aria-label="詳細を閉じる"><Icon name="x" size={22} /></button>
        <div className="drawer-artwork">
          <AchievementCard
            key={selectedAchievement.id}
            achievement={selectedAchievement}
            unlocked={selectedAchievementUnlocked}
            interactive={selectedAchievementUnlocked}
          />
          <div className="drawer-nav">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedAchievement(ACHIEVEMENTS[(selectedAchievementIndex - 1 + ACHIEVEMENTS.length) % ACHIEVEMENTS.length])} aria-label="前の実績"><Icon name="chevron-left" size={16} /></button>
            <span>{selectedAchievementIndex + 1} / {ACHIEVEMENTS.length}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelectedAchievement(ACHIEVEMENTS[(selectedAchievementIndex + 1) % ACHIEVEMENTS.length])} aria-label="次の実績"><Icon name="chevron-right" size={16} /></button>
          </div>
        </div>
        <div className="card-detail">
          <div className="detail-tags">
            <span className="chip">{achievementNumber(selectedAchievement)}</span>
            <span className="chip">実績</span>
            {selectedAchievementUnlocked
              ? <span className={`rarity-badge ${selectedAchievement.rarity.toLowerCase()}`}>{selectedAchievement.rarity}</span>
              : <span className="chip">SECRET</span>}
          </div>
          <div className="detail-heading">
            <h2>{selectedAchievementUnlocked ? selectedAchievement.title : '???'}</h2>
          </div>
          {selectedAchievementUnlocked ? (
            <>
              <p className="achievement-blurb">{selectedAchievement.description}</p>
              <dl className="card-stats">
                <div><dt>条件</dt><dd className="small">{selectedAchievement.condition}</dd></div>
                <div>
                  <dt>GET日</dt>
                  <dd className="small">
                    {profile.achievements?.[selectedAchievement.id]?.unlockedAt
                      ? new Date(profile.achievements[selectedAchievement.id].unlockedAt).toLocaleDateString('ja-JP')
                      : revealAll
                        ? 'プレビュー'
                        : '—'}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="detail-locked"><Icon name="lock" size={16} />条件を満たすと解禁。タイトルも絵も、解禁までシークレット。</p>
          )}
        </div>
      </div>
    </div>}
  </section>;
}
