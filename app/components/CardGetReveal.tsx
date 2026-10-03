'use client';

import { useEffect, useState } from 'react';
import type { MorseCard } from '@/lib/morse';
import { KIND_LABEL } from '@/lib/course';
import type { CardProgress } from '@/lib/types';
import { CardBack, TradingCard } from '@/app/components/TradingCard';
import { Icon } from '@/app/components/icons';
import { formatCode, mnemonicFor } from '@/app/trainer/shared';
import { playSfx } from '@/app/trainer/sfx';

const CONFETTI_COLORS = ['var(--gold)', 'var(--mint)', 'var(--sky)', 'var(--coral)', 'var(--violet)', '#fff'];
const confetti = Array.from({ length: 28 }, (_, index) => ({
  index,
  color: CONFETTI_COLORS[(index * 7) % CONFETTI_COLORS.length],
  delay: `${((index * 37) % 10) * 0.025}s`,
}));

const RARITY_COPY: Record<MorseCard['rarity'], string> = {
  N: 'NEW CARD',
  R: 'NEW CARD',
  SR: 'SUPER RARE',
  SSR: 'SUPER SPECIAL RARE',
};

export function MasteredReveal({ card, progress, hideMnemonic = false, volume = 0.25, onClose, onPractice }: {
  card: MorseCard;
  progress: CardProgress;
  hideMnemonic?: boolean;
  volume?: number;
  onClose: () => void;
  onPractice?: () => void;
}) {
  const [skipped, setSkipped] = useState(false);
  const rarity = card.rarity.toLowerCase();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const timer = window.setTimeout(() => playSfx(card.rarity === 'SSR' || card.rarity === 'SR' ? 'rare' : 'reveal', volume), skipped ? 0 : 1000);
    return () => window.clearTimeout(timer);
    // Sound fires once per reveal; skipping only shortens the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  return (
    <div
      className={`get-reveal rarity-${rarity} ${skipped ? 'skipped' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${card.symbol} のカードを獲得`}
      onClick={() => setSkipped(true)}
    >
      <div className="get-rays" aria-hidden="true" />
      <div className="get-flash" aria-hidden="true" />
      <span className="get-shock" aria-hidden="true" />
      <span className="get-shock second" aria-hidden="true" />
      <div className="get-confetti" aria-hidden="true">
        {confetti.map((piece) => <i key={piece.index} style={{ '--i': piece.index, '--c': piece.color, '--d': piece.delay } as React.CSSProperties} />)}
      </div>

      <div className="get-layout">
        <div className="get-stage">
          <div className="get-flip">
            <div className="get-face front">
              <div className="get-float">
                <TradingCard card={card} progress={progress} hideMnemonic={hideMnemonic} />
              </div>
              <span className="get-sheen" aria-hidden="true" />
            </div>
            <div className="get-face back"><CardBack /></div>
          </div>
        </div>

        <div className="get-copy" onClick={(event) => event.stopPropagation()}>
          <span className={`rarity-badge ${rarity}`}>{card.rarity}</span>
          <p className="get-kicker">{RARITY_COPY[card.rarity]}</p>
          <h2 className="get-title">GET!</h2>
          <p className="get-sub">
            <b>{card.symbol}</b>　{formatCode(card.code)}
            {card.hasMnemonic && !hideMnemonic ? `　「${mnemonicFor(card, progress)}」` : `　${KIND_LABEL[card.kind]}`}
          </p>
          <div className="get-actions">
            {onPractice && <button type="button" className="btn btn-ghost" onClick={onPractice}><Icon name="play" size={16} />音を聴く</button>}
            <button type="button" className="btn btn-primary btn-lg" onClick={onClose} autoFocus>
              図鑑に登録<Icon name="chevron-right" size={18} />
            </button>
          </div>
        </div>
      </div>
      {!skipped && <span className="get-skip">タップでスキップ</span>}
    </div>
  );
}
