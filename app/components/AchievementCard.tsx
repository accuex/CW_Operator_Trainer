'use client';

import { useCallback, useRef, useState } from 'react';
import { CardArtwork } from '@/app/components/CardArtwork';
import { CardBack } from '@/app/components/TradingCard';
import type { AchievementDef } from '@/lib/achievements';

interface AchievementCardProps {
  achievement: AchievementDef;
  unlocked: boolean;
  compact?: boolean;
  interactive?: boolean;
  className?: string;
}

export function AchievementCard({
  achievement,
  unlocked,
  compact = false,
  interactive = false,
  className = '',
}: AchievementCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasArtwork, setHasArtwork] = useState(false);
  const onAvailability = useCallback((value: boolean) => setHasArtwork(value), []);
  const rarity = achievement.rarity.toLowerCase();
  const foil = ['SSR','SSSR'].includes(achievement.rarity);

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

  if (!unlocked) {
    return (
      <div className={`signal-card is-concealed ${compact ? 'compact' : ''} ${className}`}>
        <CardBack compact={compact} mark="－・－" label={compact ? '???' : 'SECRET ACHIEVEMENT'} />
      </div>
    );
  }

  const fallback = (
    <div className="face-inner achievement-face">
      <span className="face-kind">{achievement.game ? 'CW迎撃隊' : '実績'}</span>
      <span className="face-crest"><b>★</b></span>
      <span className="face-code">{achievement.rarity}</span>
      <span className="face-title">{achievement.title}</span>
      {achievement.artworkPending && <small className="achievement-pending-art">カード画像準備中</small>}
    </div>
  );

  return (
    <div
      ref={ref}
      className={`signal-card family-signal rarity-${rarity} ${compact ? 'compact' : ''} ${foil ? 'foil' : ''} ${interactive ? 'interactive' : ''} ${className}`}
      onPointerMove={interactive ? onMove : undefined}
      onPointerLeave={interactive ? onLeave : undefined}
    >
      <div className="signal-card-body">
        <CardArtwork src={achievement.artworkPending ? undefined : achievement.artwork} fallback={fallback} onAvailability={onAvailability} />
        {hasArtwork && <span className="achievement-art-badge" aria-hidden="true">{achievement.rarity}</span>}
        {foil && <span className="foil-layer" aria-hidden="true" />}
        {interactive && <span className="glare-layer" aria-hidden="true" />}
      </div>
    </div>
  );
}
