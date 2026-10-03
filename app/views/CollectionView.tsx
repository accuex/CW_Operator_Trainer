'use client';

import { useEffect, useState } from 'react';
import { CARDS, type MorseCard } from '@/lib/morse';
import { KIND_LABEL, cardsForCourse, courseMeta, type CharacterKind } from '@/lib/course';
import { readProgressMeter } from '@/lib/progressMeter';
import type { AudioSettings, CardProgress, TrainerProfile } from '@/lib/types';
import { audioEngine, cardKey, cardStatus, CARD_STATUS_LABEL, emptyProgress, formatCode, mnemonicFor, mnemonicCategoryFor, masteryFor } from '@/app/trainer/shared';
import { TradingCard } from '@/app/components/TradingCard';
import { ProgressBar, Ring, Segmented } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';

const cardNumber = (card: MorseCard) => `No.${String(CARDS.indexOf(card) + 1).padStart(3, '0')}`;
const CATEGORY_LABEL: Record<string, string> = { Recommended: 'おすすめ', Classic: '定番', Funny: 'おもしろ', Custom: '自作' };

export function CollectionView({ settings, profile, setProfile, setAudioStatus }: { settings: AudioSettings; profile: TrainerProfile; setProfile: React.Dispatch<React.SetStateAction<TrainerProfile>>; setAudioStatus: (status: string) => void }) {
  const course = profile.learnCourse ?? null;
  const unlockedKinds = profile.unlockedKinds ?? [];
  const courseCards = cardsForCourse(CARDS, course, unlockedKinds);
  const [kindFilter, setKindFilter] = useState<CharacterKind | 'all'>('all');
  const [selected, setSelected] = useState<MorseCard | null>(null);
  const [debugRevealAll, setDebugRevealAll] = useState(false);
  const sourceCards = debugRevealAll ? CARDS : courseCards;
  const kinds = [...new Set(sourceCards.map((card) => card.kind))];
  const cards = kindFilter === 'all' ? sourceCards : sourceCards.filter((card) => card.kind === kindFilter);
  const masteredCount = cards.filter((card) => profile.cards[cardKey(card)]?.mastered).length;
  const learningCount = cards.filter((card) => {
    const progress = profile.cards[cardKey(card)];
    return !progress?.mastered && readProgressMeter(progress) > 0;
  }).length;
  const revealCard = (progress?: CardProgress) => debugRevealAll || Boolean(progress?.mastered);
  const play = async (card: MorseCard) => {
    setAudioStatus('PLAYING');
    const handle = await audioEngine.playSymbol(card.symbol, card.code, settings, 1);
    handle.finished.then(() => setAudioStatus('READY'));
  };
  const chooseMnemonic = (card: MorseCard, value: string) => {
    const progress = profile.cards[cardKey(card)] ?? emptyProgress();
    setProfile((old) => ({ ...old, cards: { ...old.cards, [cardKey(card)]: { ...progress, selectedMnemonic: value, customMnemonic: value === progress.customMnemonic ? progress.customMnemonic : undefined } } }));
  };
  const selectedProgress = selected ? profile.cards[cardKey(selected)] ?? emptyProgress() : undefined;
  const showMnemonics = profile.goal === 'fun' || debugRevealAll;
  const selectedRevealed = selected ? revealCard(selectedProgress) : false;
  const selectedIndex = selected ? cards.indexOf(selected) : -1;

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'ArrowRight' && selectedIndex >= 0) setSelected(cards[(selectedIndex + 1) % cards.length]);
      if (event.key === 'ArrowLeft' && selectedIndex >= 0) setSelected(cards[(selectedIndex - 1 + cards.length) % cards.length]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, selectedIndex, cards]);

  const debugToggle = (
    <button
      type="button"
      className={`scope-toggle collection-debug-toggle ${debugRevealAll ? 'on' : ''}`}
      aria-pressed={debugRevealAll}
      onClick={() => {
        setDebugRevealAll((value) => !value);
        setSelected(null);
        setKindFilter('all');
      }}
    >
      <i>{debugRevealAll ? <Icon name="check" size={12} /> : null}</i>
      DEBUG 全表示
    </button>
  );

  if (!course && !debugRevealAll) {
    return <section className="page-pad collection-page">
      <div className="page-title">
        <div>
          <p className="section-kicker"><Icon name="collection" size={14} />CARD ARCHIVE</p>
          <h1>カード図鑑</h1>
          <p>「おぼえる」でコースを選ぶと、その範囲のカードがここに並びます。学習記録は消えません。</p>
        </div>
        {debugToggle}
      </div>
    </section>;
  }

  return <section className="page-pad collection-page">
    <div className="collection-hero panel">
      <div className="collection-hero-copy">
        <p className="section-kicker"><Icon name="collection" size={14} />CARD ARCHIVE · {debugRevealAll ? 'DEBUG ALL' : courseMeta(course)?.short}</p>
        <h1>カード図鑑</h1>
        <p>{debugRevealAll
          ? 'DEBUG：全カードをコース・習得状況に関係なく表示しています。進捗は書き換えません。'
          : '「当てる」で連続正解した文字がカードになります。全部そろえてコンプリートを目指そう。'}</p>
        <div className="collection-tally">
          <span className="tally gold"><b>{masteredCount}</b>GET</span>
          <span className="tally sky"><b>{learningCount}</b>練習中</span>
          <span className="tally"><b>{cards.length - masteredCount - learningCount}</b>未発見</span>
        </div>
      </div>
      <div className="collection-hero-ring">
        <Ring value={cards.length ? masteredCount / cards.length : 0} size={150} stroke={12}>
          <b>{cards.length ? Math.round((masteredCount / cards.length) * 100) : 0}<small>%</small></b>
          <span>COMPLETE</span>
        </Ring>
        {debugToggle}
      </div>
    </div>

    <div className="collection-toolbar">
      <Segmented
        label="文字種"
        value={kindFilter}
        options={[['all', 'すべて'], ...kinds.map((kind) => [kind, KIND_LABEL[kind]] as [string, string])]}
        onChange={(value) => { setKindFilter(value as CharacterKind | 'all'); setSelected(null); }}
      />
    </div>

    <div className="card-grid">{cards.map((card, cardIndex) => {
      const progress = profile.cards[cardKey(card)];
      const acquired = revealCard(progress);
      const meter = masteryFor(progress);
      const status = cardStatus(progress);
      return (
        <button
          key={cardKey(card)}
          type="button"
          className={`collection-item status-${status.toLowerCase()} ${acquired ? 'acquired' : 'locked'}${debugRevealAll && !progress?.mastered ? ' debug-revealed' : ''}`}
          style={{ '--delay': `${Math.min(cardIndex, 30) * 18}ms` } as React.CSSProperties}
          onClick={() => setSelected(card)}
          aria-label={`${acquired ? card.symbol : '未取得'}のカード詳細`}
        >
          <TradingCard card={card} progress={progress} compact concealed={!acquired} hideMnemonic={!showMnemonics} />
          <span className="collection-item-meta">
            <small>{cardNumber(card)}</small>
            <b>{acquired || status !== 'UNFOUND' ? card.symbol : '???'}</b>
          </span>
          {!progress?.mastered && <span className="collection-item-meter"><i style={{ width: `${meter}%` }} /></span>}
        </button>
      );
    })}</div>

    {selected && selectedProgress && <div className="card-drawer-backdrop" onClick={() => setSelected(null)}>
      <div className="card-drawer" role="dialog" aria-modal="true" aria-label={`${selected.symbol}のカード詳細`} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="drawer-close" onClick={() => setSelected(null)} aria-label="詳細を閉じる"><Icon name="x" size={22} /></button>
        <div className="drawer-artwork">
          <TradingCard key={cardKey(selected)} card={selected} progress={selectedProgress} concealed={!selectedRevealed} hideMnemonic={!showMnemonics} interactive={selectedRevealed} />
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
            {selectedRevealed && <span className={`rarity-badge ${selected.rarity.toLowerCase()}`}>{selected.rarity}</span>}
            <span className={`chip ${selectedProgress.mastered ? 'gold' : ''}`}>{debugRevealAll && !selectedProgress.mastered ? 'DEBUG表示' : CARD_STATUS_LABEL[cardStatus(selectedProgress)]}</span>
          </div>
          <div className="detail-heading">
            <h2>{selectedRevealed ? selected.symbol : '???'}</h2>
            <div>
              <span className="detail-code">{selectedRevealed ? formatCode(selected.code) : '・・・'}</span>
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
  </section>;
}
