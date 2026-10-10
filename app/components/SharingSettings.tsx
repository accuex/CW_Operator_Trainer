'use client';
import { useEffect, useState } from 'react';
import { EMPTY_SHARING, LOCAL_ACTIVITY_PREVIEW, readSharing, retryWithdrawal, SHARING_CHANGED, syncSharedAvatar, updateSharing } from '@/lib/activity';

export function SharingSettings({ avatarId, onOpenLog }: { avatarId?: string | null; onOpenLog: () => void }) {
  const [settings, setSettings] = useState(EMPTY_SHARING);
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const refresh = () => { const value = readSharing(); setSettings(value); setNickname(value.nickname); };
    Promise.resolve().then(refresh);
    window.addEventListener(SHARING_CHANGED, refresh);
    window.addEventListener('storage', refresh);
    void retryWithdrawal().catch(() => setMessage('共有は停止中です。掲載ログの取り下げは、通信回復後に再試行してください。'));
    return () => { window.removeEventListener(SHARING_CHANGED, refresh); window.removeEventListener('storage', refresh); };
  }, []);
  async function save(enabled: boolean) {
    setBusy(true); setMessage('');
    try {
      const result = await updateSharing(enabled, nickname, avatarId);
      if (result.enabled !== enabled || result.pendingWithdrawal) { setMessage('共有設定が別の操作で変更されました。現在の設定を確認してください。'); return; }
      setMessage(enabled ? '共有設定を保存しました。これからの学習開始・達成を共有します。' : '共有を停止し、掲載ログを取り下げました。');
    } catch {
      setMessage(enabled ? '変更を保存できませんでした。共有設定は変更されていません。通信を確認してください。' : 'この端末からの共有は停止しました。掲載ログの取り下げは通信回復後に再試行してください。');
    } finally { setBusy(false); }
  }
  return <section className="sharing-settings" aria-labelledby="sharing-title">
    <h2 id="sharing-title">仲間と学習状況を共有</h2>
    {LOCAL_ACTIVITY_PREVIEW && <p className="account-note">開発プレビュー：このブラウザ内だけで動作します。ほかの利用者には送信されません。</p>}
    <label className="sharing-toggle"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void save(event.target.checked)} /><span>学習状況を共有する</span></label>
    <p className="account-note">オンにすると、名前・アバター・学習開始・新しいアチーブ達成が、誰でも見られる学習ログに表示されます。メール、回答内容、正答率は公開しません。</p>
    {settings.enabled && <div className="sharing-name"><label className="account-field">ニックネーム（任意・24文字まで）<input value={nickname} maxLength={24} onChange={(event) => setNickname(event.target.value)} placeholder="未入力なら自動IDで表示" autoComplete="off" /></label><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setBusy(true); void syncSharedAvatar(avatarId, nickname).then(() => setMessage('名前の更新を確認しました。共有設定は変更していません。')).catch(() => setMessage('名前を保存できませんでした。')).finally(() => setBusy(false)); }}>名前を保存</button><small>未入力時：学習者-{settings.publicId}</small></div>}
    <p className="account-note">掲載は直近30日・最新100件。オフにすると、自分の掲載ログを取り下げます。設定はこのブラウザ専用です。ログインの有無にかかわらず、ブラウザのデータを消すと取り下げ操作を復元できません。名前・アバターは90日間更新がなければ消去します。</p>
    {settings.pendingWithdrawal && <p role="status">掲載ログの取り下げは未完了です。通信復帰時に自動再試行します。</p>}
    {settings.pendingWithdrawal && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save(false)}>取り下げを再試行</button>}
    <p role="status">{busy ? '保存しています…' : message}</p>
    <button type="button" className="account-switch-link" onClick={onOpenLog}>みんなの学習ログを見る →</button>
  </section>;
}
