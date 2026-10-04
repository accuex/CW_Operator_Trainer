'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { COURSES, courseMeta, selectCourseDefaults, type LearnCourse } from '@/lib/course';
import { loadAuthSession } from '@/lib/api/authSession';
import { AUTH_SYNC_EVENT } from '@/lib/api/cloudSync';
import { exportAllData, importAllData } from '@/lib/storage';
import { SPEED_WPM_MAX, SPEED_WPM_MIN } from '@/lib/speed';
import type { AudioSettings, TrainerProfile } from '@/lib/types';
import { audioEngine, type View } from '@/app/trainer/shared';
import { AudioControls } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';

export function SettingsView({ settings, setSettings, profile, setProfile, onImported, announce, onNavigate }: { settings: AudioSettings; setSettings: (settings: AudioSettings) => void; profile: TrainerProfile; setProfile: Dispatch<SetStateAction<TrainerProfile>>; onImported: () => void; announce: (message: string) => void; onNavigate?: (view: View) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [signedIn, setSignedIn] = useState(() => Boolean(loadAuthSession()));

  useEffect(() => {
    const sync = () => setSignedIn(Boolean(loadAuthSession()));
    sync();
    window.addEventListener(AUTH_SYNC_EVENT, sync);
    return () => window.removeEventListener(AUTH_SYNC_EVENT, sync);
  }, []);

  const download = async () => {
    const data = await exportAllData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cw-operator-trainer-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    announce('学習データを書き出しました');
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      await importAllData(JSON.parse(await file.text()));
      onImported();
    } catch (error) {
      announce(error instanceof Error ? error.message : '読み込みに失敗しました');
    }
  };
  const changeCourse = (course: LearnCourse) => {
    const defaults = selectCourseDefaults(course);
    setProfile((old) => ({ ...old, ...defaults }));
    announce(`${courseMeta(course)?.label ?? course} に切り替えました（学習履歴は保持）`);
  };
  const goals: [NonNullable<TrainerProfile['goal']>, string, string][] = [
    ['fun', 'まずCWを楽しく覚えたい', '合調法カードから'],
    ['sound', '最初から音で覚えたい', '音感法コース'],
    ['experienced', '符号はすでに知っている', '高速訓練へ'],
    ['exam', '第一級総合無線通信士を目指す', '音感 → Queue → 試験'],
  ];
  return (
    <section className="page-pad settings-page">
      <div className="page-title">
        <div>
          <p className="section-kicker">SETTINGS</p>
          <h1>練習の環境を整える</h1>
          <p>音・目的・コース・データ。いつでも変えられます。学習の記録は消えません。</p>
        </div>
      </div>
      <div className="settings-grid">
        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="volume" size={22} /></span>
            <div>
              <p className="section-kicker">AUDIO ENGINE</p>
              <h2>音の出方</h2>
              <p>文字速度と実効速度は同じ目盛り（{SPEED_WPM_MIN}–{SPEED_WPM_MAX} WPM）。実効を文字より下げると間隔だけ延び、文字速度の位置を超えて上げると文字速度も一緒に上がります。</p>
            </div>
          </div>
          <AudioControls settings={settings} setSettings={setSettings} />
          <label>音量 <b>{Math.round(settings.volume * 100)}%</b><input type="range" min="0" max="0.6" step="0.01" value={settings.volume} onChange={(event) => setSettings({ ...settings, volume: Number(event.target.value) })} /></label>
          <label>
            波形
            <select value={settings.waveform} onChange={(event) => setSettings({ ...settings, waveform: event.target.value as OscillatorType })}>
              <option value="sine">サイン波</option>
              <option value="triangle">三角波</option>
              <option value="square">矩形波</option>
              <option value="sawtooth">鋸歯状波</option>
            </select>
          </label>
          <label className={`settings-switch${settings.reverb ? ' on' : ''}`}>
            <span className="settings-switch-copy">
              <strong>反響</strong>
              <small>少し広い部屋くらいの余韻</small>
            </span>
            <span className="settings-switch-ui">
              <input
                type="checkbox"
                checked={settings.reverb}
                onChange={(event) => setSettings({ ...settings, reverb: event.target.checked })}
                aria-label="反響のオンオフ"
              />
              <i aria-hidden="true" />
            </span>
          </label>
          <button type="button" className="btn btn-ghost" onClick={async () => { const handle = await audioEngine.play('VVV', 'international', settings); handle.finished.catch(() => undefined); }}>テスト信号 VVV</button>
        </div>
        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="target" size={22} /></span>
            <div>
              <p className="section-kicker">GOAL</p>
              <h2>学習の目的</h2>
              <p>最初に選んだルートです。いつでも変更できます。学習履歴は消えません。</p>
            </div>
          </div>
          <div className="choice-list">
            {goals.map(([id, title, description]) => (
              <button key={id} type="button" className={profile.goal === id ? 'choice-card active' : 'choice-card'} aria-pressed={profile.goal === id} onClick={() => { setProfile((old) => ({ ...old, goal: id })); announce('学習の目的を更新しました'); }}>
                <span className="choice-copy"><strong>{title}</strong><small>{description}</small></span>
                <span className="choice-check" aria-hidden="true">{profile.goal === id && <Icon name="check" size={18} />}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="learn" size={22} /></span>
            <div>
              <p className="section-kicker">LEARN COURSE</p>
              <h2>学ぶ範囲</h2>
              <p>符号を覚える範囲のフィルターです。変更しても習熟度やカード取得は消えません。</p>
            </div>
          </div>
          <div className="choice-list">
            {COURSES.map((item) => (
              <button key={item.id} type="button" className={profile.learnCourse === item.id ? 'choice-card active' : 'choice-card'} aria-pressed={profile.learnCourse === item.id} onClick={() => changeCourse(item.id)}>
                <span className="choice-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                <span className="choice-check" aria-hidden="true">{profile.learnCourse === item.id && <Icon name="check" size={18} />}</span>
              </button>
            ))}
          </div>
          <p className="exposure-note">いまのコース: {courseMeta(profile.learnCourse)?.label ?? '未選択'}</p>
        </div>
        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="collection" size={22} /></span>
            <div>
              <p className="section-kicker">ARCHIVE PREVIEW</p>
              <h2>図鑑プレビュー</h2>
              <p>ONの間だけ全カード・実績が見られます。図鑑で R / SR / SSR を切り替え可能。OFFにすると本当の進捗に戻ります。記録は増えません。</p>
            </div>
          </div>
          <label className={`settings-switch${profile.revealAll ? ' on' : ''}`}>
            <span className="settings-switch-copy">
              <strong>全解放表示</strong>
              <small>解放状況を無視して図鑑を全部見る（進捗非破壊）</small>
            </span>
            <span className="settings-switch-ui">
              <input
                type="checkbox"
                checked={Boolean(profile.revealAll)}
                onChange={(event) => {
                  const next = event.target.checked;
                  setProfile((old) => ({ ...old, revealAll: next }));
                  announce(next ? '図鑑を全解放表示にしました' : '図鑑を通常表示に戻しました');
                }}
                aria-label="全解放表示のオンオフ"
              />
              <i aria-hidden="true" />
            </span>
          </label>
        </div>
        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="account" size={22} /></span>
            <div>
              <p className="section-kicker">ACCOUNT</p>
              <h2>マイページ</h2>
              <p>ログイン・パスキーの追加/削除はマイページで行います。</p>
            </div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onNavigate?.('account')}>
            <Icon name="key" size={16} />マイページを開く
          </button>
        </div>
        <div className="panel panel-pad settings-panel">
          <div className="settings-card-head">
            <span className="settings-icon" aria-hidden="true"><Icon name="lock" size={22} /></span>
            <div>
              <p className="section-kicker">DATA VAULT</p>
              <h2>データの保管</h2>
              <p>
                {signedIn
                  ? 'ログイン中は回答・カード進捗・統計をサーバー（クラウド）に保存し、他の端末でも使えます。このブラウザにも控えを残します。'
                  : '未ログインでは回答・カード進捗・統計をこのブラウザの中だけに保存します。ログインするとサーバー同期に切り替わります。'}
              </p>
            </div>
          </div>
          <div className="vault-actions">
            <button type="button" className="btn btn-primary" onClick={download}>JSONを書き出す</button>
            <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>JSONを読み込む</button>
          </div>
          <input ref={fileRef} hidden type="file" accept="application/json" onChange={(event) => importFile(event.target.files?.[0])} />
          <div className={`storage-note ${signedIn ? 'cloud' : 'local'}`}>
            {signedIn ? (
              <>
                <b>サーバーに保存中</b>
                <span>ログイン中の学習データはクラウドが優先です。</span>
                <small>端末には同期用の控えも残ります</small>
              </>
            ) : (
              <>
                <b>この端末に保存</b>
                <span>サーバーには保存されていません。</span>
                <small>ログインするとサーバー保存に切り替わります</small>
              </>
            )}
          </div>
        </div>
      </div>
      <p className="settings-credit">(C) 2026 Int Design LLC.</p>
    </section>
  );
}
