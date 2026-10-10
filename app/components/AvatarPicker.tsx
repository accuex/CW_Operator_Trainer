'use client';

import Image from 'next/image';
import { AVATARS, getAvatar } from '@/lib/avatars';
import { Icon } from './icons';

export function AvatarPortrait({ avatarId, size = 64 }: { avatarId?: string | null; size?: number }) {
  const avatar = getAvatar(avatarId);
  return avatar
    ? <Image src={avatar.src} alt="" width={size} height={size} unoptimized className="avatar-portrait" />
    : <Icon name="account" size={Math.round(size * 0.6)} />;
}

export function AvatarPicker({ avatarId, onSelect }: { avatarId?: string | null; onSelect: (id: string | null) => void }) {
  const selected = getAvatar(avatarId);
  return (
    <section className="account-avatar-picker" aria-labelledby="account-avatar-title">
      <div className="account-avatar-preview">
        <span className="account-avatar-current" aria-hidden="true"><AvatarPortrait avatarId={avatarId} /></span>
        <div><h2 id="account-avatar-title">アバター</h2><p>{selected?.label ?? '標準アイコン'}</p><small>選んだアバターが画面右上に表示されます。</small></div>
      </div>
      <details className="account-avatar-options">
        <summary>アバターを選ぶ・変更する</summary>
        <div className="account-avatar-grid" role="group" aria-label="アバター一覧">
          <button type="button" className="account-avatar-option" aria-label="標準アイコン" aria-pressed={!selected} onClick={() => onSelect(null)}><Icon name="account" size={28} /></button>
          {AVATARS.map((avatar) => <button key={avatar.id} type="button" className="account-avatar-option" aria-label={avatar.label} title={avatar.label} aria-pressed={selected?.id === avatar.id} onClick={() => onSelect(avatar.id)}><Image src={avatar.src} alt="" width={64} height={64} unoptimized loading="lazy" /></button>)}
        </div>
      </details>
      <p className="account-note">ログインなしでも、このブラウザに保存できます。</p>
    </section>
  );
}
