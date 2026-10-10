'use client';
import { useCallback, useEffect, useState } from 'react';
import { activityMessage, fetchActivity, LOCAL_ACTIVITY_PREVIEW, type ActivityItem } from '@/lib/activity';
import { AvatarPortrait } from '@/app/components/AvatarPicker';

export function ActivityView({ onAccount }: { onAccount: () => void }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems(await fetchActivity()); } catch { setError('学習ログを読み込めませんでした。時間をおいて再度お試しください。'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  return <section className="page-pad activity-page">
    <div className="page-title"><div><p className="section-kicker">ACADEMY LOG</p><h1>みんなの学習ログ</h1><p>仲間の小さな一歩や、新しい達成を見てみよう。</p></div><button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void refresh()}>更新</button></div>
    <div className="activity-intro"><p>共有を選んだ人の記録だけを表示します。自分の共有設定はマイページで変更できます。</p><button type="button" className="account-switch-link" onClick={onAccount}>共有設定へ →</button></div>
    {LOCAL_ACTIVITY_PREVIEW && <p className="activity-local-note">開発プレビュー：このブラウザ内の記録です。実際の公開ログには送信していません。</p>}
    {loading && <p role="status">学習ログを読み込んでいます…</p>}
    {error && <p role="alert">{error}</p>}
    {!loading && !error && items.length === 0 && <p className="activity-empty">まだ学習ログはありません。共有をオンにして学習すると、ここに記録が表示されます。</p>}
    <ol className="activity-list">{items.map((item) => <li key={item.id}><span className="activity-avatar" aria-hidden="true"><AvatarPortrait avatarId={item.avatarId} size={48} /></span><div><p><strong>{item.nickname}</strong>さんが{activityMessage(item)}</p><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time><span className="activity-kind">{item.kind === 'achievement' ? 'アチーブ達成' : '学習開始'}</span></div></li>)}</ol>
    <p className="account-note">直近30日・最新100件。学習開始は学習画面を開いたときに記録します。同じ人の開始記録は30分に1回まで。利用者からの学習記録であり、技能や合格を認定するものではありません。</p>
  </section>;
}
