'use client';

import type { TrainerProfile } from '@/lib/types';
import { Icon, type IconName } from '@/app/components/icons';

const goals: [NonNullable<TrainerProfile['goal']>, IconName, string, string][] = [
  ['fun', 'sparkle', 'まずCWを楽しく覚えたい', '合調法カードからスタート'],
  ['sound', 'ear', '最初から音で覚えたい', '完成したリズムを直接認識'],
  ['experienced', 'bolt', '符号はすでに知っている', '移行診断と高速訓練へ'],
  ['exam', 'exam', '第一級総合無線通信士を目指す', '音感 → Queue 3 → 試験訓練'],
];

export function Onboarding({ onSelect }: { onSelect: (goal: TrainerProfile['goal']) => void }) {
  return (
    <div className="modal-backdrop">
      <section className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="morse-motif" aria-hidden="true">
          <i className="dot" />
          <i className="dash" />
          <i className="dot" />
          <i className="dash" />
          <i className="dot" />
        </div>
        <p className="section-kicker">WELCOME</p>
        <h1 id="onboarding-title">ようこそ、CWの世界へ</h1>
        <p className="onboarding-lead">どっちが正解、はありません。いまの自分に近い入口を選ぶだけ。あとから設定で変えられます。</p>
        <div className="onboard-grid">
          {goals.map(([id, icon, title, description]) => (
            <button key={id} type="button" className="onboard-card" onClick={() => onSelect(id)}>
              <span className="onboard-icon"><Icon name={icon} size={22} /></span>
              <span className="onboard-copy">
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
              <Icon name="chevron-right" size={18} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
