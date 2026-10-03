'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface FxEvent {
  kind: 'hit' | 'miss';
  token: number;
  /** Floating text, e.g. "+10 XP" or "MISS". */
  label?: string;
}

/**
 * Fire-and-forget feedback burst. Place inside a `position: relative` box;
 * a new token replays the animation.
 */
export function FxBurst({ fx }: { fx: FxEvent | null }) {
  if (!fx) return null;
  return (
    <span key={fx.token} className={`fx-burst ${fx.kind}`} aria-hidden="true">
      <span className="fx-ring" />
      <span className="fx-ring delay" />
      {fx.kind === 'hit' && Array.from({ length: 10 }, (_, index) => <i key={index} className="fx-spark" style={{ '--i': index } as React.CSSProperties} />)}
      {fx.label && <b className="fx-float">{fx.label}</b>}
    </span>
  );
}

export function useFx(durationMs = 900) {
  const [fx, setFx] = useState<FxEvent | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const trigger = useCallback((kind: FxEvent['kind'], label?: string) => {
    const token = performance.now();
    setFx({ kind, token, label });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFx((current) => (current?.token === token ? null : current)), durationMs);
  }, [durationMs]);
  return [fx, trigger] as const;
}

/** Combo counter that pops whenever the value increases. */
export function ComboBadge({ value, min = 2 }: { value: number; min?: number }) {
  if (value < min) return null;
  const tier = value >= 20 ? 'legend' : value >= 10 ? 'hot' : value >= 5 ? 'warm' : '';
  return (
    <span key={value} className={`combo-badge ${tier}`} aria-live="polite">
      <b>{value}</b><small>COMBO</small>
    </span>
  );
}

/** Concentric pulse rings for "signal is playing" states. */
export function SignalPulse({ active }: { active: boolean }) {
  return (
    <span className={`signal-pulse ${active ? 'on' : ''}`} aria-hidden="true">
      <i /><i /><i />
    </span>
  );
}

/** Live equalizer bars. */
export function SignalBars({ active, count = 9 }: { active: boolean; count?: number }) {
  return (
    <span className={`signal-bars ${active ? 'on' : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => <i key={index} style={{ '--i': index } as React.CSSProperties} />)}
    </span>
  );
}
