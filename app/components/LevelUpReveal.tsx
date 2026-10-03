'use client';

import { useEffect } from 'react';
import { INTERNATIONAL_MORSE } from '@/lib/morse';
import { Icon } from '@/app/components/icons';
import { formatCode } from '@/app/trainer/shared';
import { playSfx } from '@/app/trainer/sfx';

const SPARKS = Array.from({ length: 18 }, (_, index) => index);

export function LevelUpReveal({ from, to, unlocked, complete = false, volume, onClose, onContinue }: {
  from: number;
  to: number;
  /** Characters added by the new level. Empty when the final lesson is cleared. */
  unlocked: string[];
  complete?: boolean;
  volume: number;
  onClose: () => void;
  onContinue?: () => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => playSfx('rare', volume), 450);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKey); };
    // Sound fires once per reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`levelup-reveal ${complete ? 'complete' : ''}`} role="dialog" aria-modal="true" aria-label={complete ? '全レベルクリア' : `レベルアップ Lv.${to}`}>
      <div className="levelup-rays" aria-hidden="true" />
      <div className="levelup-sparks" aria-hidden="true">
        {SPARKS.map((index) => <i key={index} style={{ '--i': index } as React.CSSProperties} />)}
      </div>
      <div className="levelup-body">
        <p className="levelup-kicker">{complete ? 'ALL CLEAR' : 'LEVEL UP'}</p>
        <div className="levelup-levels" aria-hidden="true">
          <span className="levelup-from">Lv.{from}</span>
          <Icon name="chevron-right" size={28} />
          <span className="levelup-to">{complete ? 'MASTER' : `Lv.${to}`}</span>
        </div>
        <h2 className="levelup-title">{complete ? 'コッホ 全41文字 制覇！' : '昇級試験 合格！'}</h2>
        {unlocked.length > 0 && (
          <div className="levelup-unlock">
            <small>新しい文字</small>
            <div className="levelup-chars">
              {unlocked.map((symbol) => (
                <span key={symbol} className="levelup-char">
                  <b>{symbol}</b>
                  <em>{formatCode(INTERNATIONAL_MORSE[symbol] ?? '')}</em>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="levelup-actions">
          {onContinue && !complete && (
            <button type="button" className="btn btn-primary btn-lg" onClick={onContinue} autoFocus>
              <Icon name="play" size={18} />新しい文字を聴く
            </button>
          )}
          <button type="button" className={`btn btn-lg ${onContinue && !complete ? 'btn-ghost' : 'btn-primary'}`} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
