'use client';

import { useCallback, useRef, useState } from 'react';
import { CardArtwork } from '@/app/components/CardArtwork';
import { ownedCardRarity } from '@/lib/achievements';
import { artworkUrlForRarity } from '@/lib/cardArtwork';
import type { MorseCard } from '@/lib/morse';
import { KIND_LABEL } from '@/lib/course';
import type { CardProgress, CardRarityOwned } from '@/lib/types';
import { cardFamily, formatCode, mnemonicFor } from '@/app/trainer/shared';

interface TradingCardProps {
  card: MorseCard;
  progress?: CardProgress;
  compact?: boolean;
  concealed?: boolean;
  /**
   * When concealed: big mark on the card back.
   * Character cards pass the symbol (図鑑で何が空席か分かるように)。
   * Achievement-style secrets can omit this and keep "???" / default mark.
   */
  concealedMark?: string;
  /** Sound-first courses: hide mnemonic text (also masks it on painted artwork). */
  hideMnemonic?: boolean;
  /** Pointer-driven 3D tilt and glare. */
  interactive?: boolean;
  /** Archive preview: force display rarity (e.g. SSR) without mutating progress. */
  previewRarity?: CardRarityOwned;
  className?: string;
}

export function CardBack({
  compact = false,
  mark = '－・－',
  label = 'CW SIGNAL',
  className = '',
}: {
  compact?: boolean;
  mark?: string;
  label?: string;
  className?: string;
}) {
  return (
    <div className={`card-back ${compact ? 'compact' : ''} ${className}`} aria-hidden="true">
      <div className="card-back-emblem"><b>{mark}</b><small>{label}</small></div>
    </div>
  );
}

export function TradingCard({ card, progress, compact = false, concealed = false, concealedMark, hideMnemonic = false, interactive = false, previewRarity, className = '' }: TradingCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasArtwork, setHasArtwork] = useState(false);
  const onAvailability = useCallback((value: boolean) => setHasArtwork(value), []);
  const family = cardFamily(card);
  const ownedRarity = ownedCardRarity(progress);
  const displayRarity = previewRarity ?? ownedRarity;
  const rarity = (displayRarity ?? card.rarity).toLowerCase();
  const artworkSrc = artworkUrlForRarity(card.artwork, displayRarity ?? 'R');
  const artworkFallback = displayRarity === 'SR' || displayRarity === 'SSR'
    ? artworkUrlForRarity(card.artwork, 'R')
    : undefined;
  const foil = displayRarity === 'SSR' || ((!displayRarity || displayRarity === 'R') && Boolean(card.foil));
  const showMnemonic = card.hasMnemonic && !hideMnemonic;
  const code = formatCode(card.code);

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node || !interactive) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    node.style.setProperty('--rx', `${(0.5 - y) * 14}deg`);
    node.style.setProperty('--ry', `${(x - 0.5) * 18}deg`);
    node.style.setProperty('--gx', `${x * 100}%`);
    node.style.setProperty('--gy', `${y * 100}%`);
  };
  const onLeave = () => {
    const node = ref.current;
    if (!node) return;
    node.style.setProperty('--rx', '0deg');
    node.style.setProperty('--ry', '0deg');
  };

  if (concealed) {
    const known = Boolean(concealedMark);
    return (
      <div className={`signal-card is-concealed ${known ? 'known-slot' : ''} ${compact ? 'compact' : ''} ${className}`}>
        <CardBack
          compact={compact}
          mark={known ? concealedMark : '－・－'}
          label={known ? (compact ? '未取得' : 'NOT YET ACQUIRED') : (compact ? '???' : 'NOT YET ACQUIRED')}
        />
      </div>
    );
  }

  const fallback = (
    <div className="face-inner">
      <span className="face-kind">{KIND_LABEL[card.kind]}</span>
      <span className="face-crest"><b>{card.symbol}</b></span>
      <span className="face-code">{code}</span>
      <span className="face-title">{showMnemonic ? mnemonicFor(card, progress) : card.title}</span>
    </div>
  );

  return (
    <div
      ref={ref}
      className={`signal-card family-${family} rarity-${rarity} ${compact ? 'compact' : ''} ${foil ? 'foil' : ''} ${interactive ? 'interactive' : ''} ${className}`}
      onPointerMove={interactive ? onMove : undefined}
      onPointerLeave={interactive ? onLeave : undefined}
    >
      <div className="signal-card-body">
        <CardArtwork src={artworkSrc} fallbackSrc={artworkFallback} fallback={fallback} onAvailability={onAvailability} />
        {hasArtwork && card.hasMnemonic && hideMnemonic && (
          <div className="sound-mask">
            <b>{card.symbol}</b>
            <span>{code}</span>
          </div>
        )}
        {foil && <span className="foil-layer" aria-hidden="true" />}
        {interactive && <span className="glare-layer" aria-hidden="true" />}
      </div>
    </div>
  );
}
