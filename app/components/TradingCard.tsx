'use client';

import { useCallback, useRef, useState } from 'react';
import { CardArtwork } from '@/app/components/CardArtwork';
import type { MorseCard } from '@/lib/morse';
import { KIND_LABEL } from '@/lib/course';
import type { CardProgress } from '@/lib/types';
import { cardFamily, formatCode, mnemonicFor } from '@/app/trainer/shared';

interface TradingCardProps {
  card: MorseCard;
  progress?: CardProgress;
  compact?: boolean;
  concealed?: boolean;
  /** Sound-first courses: hide mnemonic text (also masks it on painted artwork). */
  hideMnemonic?: boolean;
  /** Pointer-driven 3D tilt and glare. */
  interactive?: boolean;
  className?: string;
}

export function CardBack({ compact = false, label = 'CW SIGNAL', className = '' }: { compact?: boolean; label?: string; className?: string }) {
  return (
    <div className={`card-back ${compact ? 'compact' : ''} ${className}`} aria-hidden="true">
      <div className="card-back-emblem"><b>－・－</b><small>{label}</small></div>
    </div>
  );
}

export function TradingCard({ card, progress, compact = false, concealed = false, hideMnemonic = false, interactive = false, className = '' }: TradingCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasArtwork, setHasArtwork] = useState(false);
  const onAvailability = useCallback((value: boolean) => setHasArtwork(value), []);
  const family = cardFamily(card);
  const rarity = card.rarity.toLowerCase();
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
    return (
      <div className={`signal-card is-concealed ${compact ? 'compact' : ''} ${className}`}>
        <CardBack compact={compact} label={compact ? '???' : 'NOT YET ACQUIRED'} />
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
      className={`signal-card family-${family} rarity-${rarity} ${compact ? 'compact' : ''} ${card.foil ? 'foil' : ''} ${interactive ? 'interactive' : ''} ${className}`}
      onPointerMove={interactive ? onMove : undefined}
      onPointerLeave={interactive ? onLeave : undefined}
    >
      <div className="signal-card-body">
        <CardArtwork card={card} fallback={fallback} onAvailability={onAvailability} />
        {hasArtwork && card.hasMnemonic && hideMnemonic && (
          <div className="sound-mask">
            <b>{card.symbol}</b>
            <span>{code}</span>
          </div>
        )}
        {card.foil && <span className="foil-layer" aria-hidden="true" />}
        {interactive && <span className="glare-layer" aria-hidden="true" />}
      </div>
    </div>
  );
}
