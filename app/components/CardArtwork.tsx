'use client';

import { useEffect, useState } from 'react';

interface CardArtworkProps {
  /** Artwork URL. When missing or failing to load, fallback stays visible. */
  src?: string;
  /**
   * Optional second URL tried when `src` fails (e.g. SR missing → R).
   * Still falls through to the CSS face if both fail.
   */
  fallbackSrc?: string;
  /** Rendered underneath the image; visible while loading and when the asset is missing. */
  fallback: React.ReactNode;
  onAvailability?: (hasArtwork: boolean) => void;
  className?: string;
}

/**
 * Preloads artwork before inserting an img into the DOM. A missing path never
 * produces a broken-image glyph; the designed fallback face remains underneath.
 */
export function CardArtwork({ src, fallbackSrc, fallback, onAvailability, className = '' }: CardArtworkProps) {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!src) {
      setLoadedSource(null);
      onAvailability?.(false);
      return () => { active = false; };
    }
    const tryLoad = (url: string, next?: string) => {
      const preload = new Image();
      preload.onload = () => { if (!active) return; setLoadedSource(url); onAvailability?.(true); };
      preload.onerror = () => {
        if (!active) return;
        if (next && next !== url) tryLoad(next);
        else {
          setLoadedSource(null);
          onAvailability?.(false);
        }
      };
      preload.src = url;
    };
    const secondary = fallbackSrc && fallbackSrc !== src ? fallbackSrc : undefined;
    tryLoad(src, secondary);
    return () => { active = false; };
  }, [src, fallbackSrc, onAvailability]);

  const visibleSource = loadedSource && (loadedSource === src || loadedSource === fallbackSrc) ? loadedSource : null;

  return (
    <div className={`artwork-frame ${visibleSource ? 'has-artwork' : 'fallback-artwork'} ${className}`}>
      <div className="fallback-face">{fallback}</div>
      {/* eslint-disable-next-line @next/next/no-img-element -- only mounted after a successful preload; failure must keep the CSS fallback */}
      {visibleSource && <img src={visibleSource} alt="" draggable={false} onError={() => setLoadedSource(null)} />}
    </div>
  );
}
