'use client';

import { useEffect, useState } from 'react';
import type { MorseCard } from '@/lib/morse';

interface CardArtworkProps {
  card: MorseCard;
  /** Rendered underneath the image; visible while loading and when the asset is missing. */
  fallback: React.ReactNode;
  onAvailability?: (hasArtwork: boolean) => void;
  className?: string;
}

/**
 * Preloads artwork before inserting an img into the DOM. A missing path never
 * produces a broken-image glyph; the designed fallback face remains underneath.
 */
export function CardArtwork({ card, fallback, onAvailability, className = '' }: CardArtworkProps) {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!card.artwork) {
      onAvailability?.(false);
      return () => { active = false; };
    }
    const preload = new Image();
    preload.onload = () => { if (!active) return; setLoadedSource(card.artwork ?? null); onAvailability?.(true); };
    preload.onerror = () => { if (!active) return; setLoadedSource(null); onAvailability?.(false); };
    preload.src = card.artwork;
    return () => { active = false; };
  }, [card.artwork, onAvailability]);

  const visibleSource = loadedSource === card.artwork ? loadedSource : null;

  return (
    <div className={`artwork-frame ${visibleSource ? 'has-artwork' : 'fallback-artwork'} ${className}`}>
      <div className="fallback-face">{fallback}</div>
      {/* eslint-disable-next-line @next/next/no-img-element -- only mounted after a successful preload; failure must keep the CSS fallback */}
      {visibleSource && <img src={visibleSource} alt="" draggable={false} onError={() => setLoadedSource(null)} />}
    </div>
  );
}
