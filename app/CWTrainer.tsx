'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { courseMeta } from '@/lib/course';
import { applyAchievements, achievementById } from '@/lib/achievements';
import { APP_VERSION } from '@/lib/appMeta';
import { loadAuthSession } from '@/lib/api/authSession';
import {
  AUTH_SYNC_EVENT,
  clearSyncRevision,
  notifyAuthSync,
  pushAnswers,
  pushSessions,
  schedulePushState,
  syncPreferCloud,
  type CloudSnapshot,
} from '@/lib/api/cloudSync';
import { logout } from '@/lib/api/client';
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, addAnswer, addSession, getAnswers, getProfile, getSessions, loadSettings, normalizeProfile, saveDataMeta, saveProfile, saveSettings } from '@/lib/storage';
import type { AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from '@/lib/types';
import { type View, views, viewMeta, audioEngine, goalLabel, scopeLabel, pathToView } from '@/app/trainer/shared';
import { playerStats, DAILY_GOAL } from '@/app/trainer/progress';
import { kochChars } from '@/lib/koch';
import { Ring, SpeedPairControls } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';
import { Dashboard } from '@/app/views/Dashboard';
import { LearnView } from '@/app/views/LearnView';
import { TrainView } from '@/app/views/TrainView';
import { LevelUpView } from '@/app/views/LevelUpView';
import { QueueView } from '@/app/views/QueueView';
import { AnalysisView } from '@/app/views/AnalysisView';
import { ExamView } from '@/app/views/ExamView';
import { CollectionView } from '@/app/views/CollectionView';
import { SettingsView } from '@/app/views/SettingsView';
import { AccountView } from '@/app/views/AccountView';
import { Onboarding } from '@/app/views/Onboarding';
import { trackPageView } from '@/app/components/GoogleAnalytics';
import { markSfxBackground, unlockSfx, wakeSfx } from '@/app/trainer/sfx';

const AUDIO_STATUS_LABEL: Record<string, string> = {
  READY: '待機中',
  PLAYING: '再生中',
  STOPPED: '停止',
  PAUSED: '一時停止',
  ANNOUNCE: '呼称中',
  PREPARE: '心構え',
  'SHEET GAP': '通間休止',
  'BUFFER DRAIN': '残り消化',
  'TIME UP': '時間切れ',
  ERROR: 'エラー',
};

export default function CWTrainer({ initialView = 'home' }: { initialView?: View }) {
  const [view, setView] = useState<View>(initialView);
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<TrainerProfile>(DEFAULT_PROFILE);
  const [answers, setAnswers] = useState<AnswerLog[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [audioStatus, setAudioStatus] = useState('READY');
  const [toast, setToast] = useState('');
  const [stopEpoch, setStopEpoch] = useState(0);
  /** 一総通ナビを同じ画面でもう一度押したら科目選択へ戻す */
  const [examDeskResetEpoch, setExamDeskResetEpoch] = useState(0);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(() => Boolean(loadAuthSession()));
  const speedWrapRef = useRef<HTMLDivElement>(null);
  const applyingCloudRef = useRef(false);

  const announce = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2600);
  }, []);

  const applyCloudSnapshot = useCallback((snap: CloudSnapshot) => {
    applyingCloudRef.current = true;
    setProfile(snap.profile);
    setSettings(snap.settings);
    setAnswers(snap.answers);
    setSessions(snap.sessions);
    window.setTimeout(() => { applyingCloudRef.current = false; }, 0);
  }, []);

  const pullCloudPreferred = useCallback(async (announceMessage?: string) => {
    if (!loadAuthSession()) return;
    try {
      const snap = await syncPreferCloud();
      if (!snap) return;
      if (!snap.seededFromLocal) applyCloudSnapshot(snap);
      if (announceMessage) announce(announceMessage);
      else if (!snap.seededFromLocal) announce('クラウドの学習データを読み込みました');
      else announce('この端末のデータをクラウドへ保存しました');
    } catch {
      // オフライン等は端末データを継続
    }
  }, [announce, applyCloudSnapshot]);

  useEffect(() => {
    Promise.all([getProfile(), getAnswers(), getSessions()]).then(async ([savedProfile, savedAnswers, savedSessions]) => {
      setProfile(normalizeProfile(savedProfile)); setAnswers(savedAnswers); setSessions(savedSessions); setSettings(loadSettings()); setReady(true);
      void saveDataMeta();
      if (loadAuthSession()) await pullCloudPreferred();
    }).catch(() => { setSettings(loadSettings()); setReady(true); });
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    return () => audioEngine.stop();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onAuthSync = (event: Event) => {
      const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason;
      if (reason === 'logout') {
        clearSyncRevision();
        setSignedIn(false);
        return;
      }
      setSignedIn(Boolean(loadAuthSession()));
      void pullCloudPreferred(reason === 'login' ? 'ログイン同期しました（クラウド優先）' : undefined);
    };
    window.addEventListener(AUTH_SYNC_EVENT, onAuthSync);
    return () => window.removeEventListener(AUTH_SYNC_EVENT, onAuthSync);
  }, [pullCloudPreferred]);

  // YouTube 等で音声セッションを奪われたあと: Context を捨て、次のタップで作り直す
  useEffect(() => {
    let needsGestureUnlock = false;
    const onBackground = () => {
      needsGestureUnlock = true;
      audioEngine.markBackground();
      markSfxBackground();
    };
    const onForeground = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      // soft wake は残すが、dirty なら次の gesture まで触らない
      void audioEngine.wake();
      void wakeSfx();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onBackground();
      else onForeground();
    };
    const unlockFromGesture = () => {
      if (!needsGestureUnlock && !audioEngine.isDirty) return;
      needsGestureUnlock = false;
      void audioEngine.unlock();
      void unlockSfx();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onBackground);
    window.addEventListener('pageshow', onForeground);
    document.addEventListener('pointerdown', unlockFromGesture, true);
    document.addEventListener('touchstart', unlockFromGesture, { capture: true, passive: true });
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onBackground);
      window.removeEventListener('pageshow', onForeground);
      document.removeEventListener('pointerdown', unlockFromGesture, true);
      document.removeEventListener('touchstart', unlockFromGesture, true);
    };
  }, []);

  useEffect(() => {
    if (!ready || applyingCloudRef.current) return;
    saveSettings(settings);
    saveProfile(profile).catch(() => undefined);
    schedulePushState(profile, settings);
  }, [settings, profile, ready]);
  useEffect(() => {
    const onPop = () => setView(pathToView(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // 速度ポップアップ: 外側クリック / Esc で閉じる（トグルボタン以外の画面どこでも）
  useEffect(() => {
    if (!speedOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const wrap = speedWrapRef.current;
      if (wrap?.contains(event.target as Node)) return;
      setSpeedOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSpeedOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [speedOpen]);

  const navigate = (next: View) => {
    audioEngine.stop();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setStopEpoch((value) => value + 1);
    setAudioStatus('READY'); setView(next); setSpeedOpen(false);
    const path = next === 'home' ? '/' : `/${next}`;
    history.pushState(null, '', path);
    trackPageView(path);
    setProfile((old) => ({ ...old, lastMode: next }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const record = useCallback((answer: AnswerLog) => {
    setAnswers((old) => [...old, answer]);
    addAnswer(answer).catch(() => undefined);
    void pushAnswers(answer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const { profile: next, unlocked } = applyAchievements(profile, answers, sessions);
    if (unlocked.length === 0) return;
    setProfile(next);
    const first = achievementById(unlocked[0])?.title ?? unlocked[0];
    announce(unlocked.length === 1 ? `実績GET: ${first}` : `実績GET: ${first} ほか${unlocked.length - 1}`);
    // 進捗系だけ再評価（ナビの lastMode では回さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, answers, sessions, profile.cards, profile.koch, profile.achievements]);

  const stopAudio = () => {
    audioEngine.stop();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setStopEpoch((value) => value + 1);
    setAudioStatus('STOPPED');
  };

  const onSession = useCallback((session: SessionRecord) => {
    setSessions((old) => [...old, session]);
    addSession(session).catch(() => undefined);
    void pushSessions(session);
  }, []);

  const stats = useMemo(() => playerStats(profile, answers), [profile, answers]);
  const current = viewMeta(view);
  const live = audioStatus === 'PLAYING' || audioStatus === 'ANNOUNCE';

  const content = {
    home: <Dashboard answers={answers} sessions={sessions} profile={profile} stats={stats} onNavigate={navigate} />,
    learn: <LearnView settings={settings} profile={profile} setProfile={setProfile} record={record} setAudioStatus={setAudioStatus} announce={announce} onNavigate={navigate} />,
    train: <TrainView settings={settings} setSettings={setSettings} record={record} setAudioStatus={setAudioStatus} answers={answers} kochPool={kochChars(stats.level)} />,
    levelup: <LevelUpView settings={settings} setSettings={setSettings} profile={profile} setProfile={setProfile} record={record} setAudioStatus={setAudioStatus} onSession={onSession} />,
    queue: <QueueView settings={settings} setSettings={setSettings} record={record} setAudioStatus={setAudioStatus} stopEpoch={stopEpoch} onSession={onSession} />,
    analysis: <AnalysisView answers={answers} sessions={sessions} onNavigate={navigate} />,
    exam: <ExamView key={`exam-${examDeskResetEpoch}`} settings={settings} setSettings={setSettings} record={record} setAudioStatus={setAudioStatus} stopEpoch={stopEpoch} />,
    collection: <CollectionView settings={settings} profile={profile} setProfile={setProfile} setAudioStatus={setAudioStatus} />,
    settings: <SettingsView settings={settings} setSettings={setSettings} profile={profile} setProfile={setProfile} onImported={async () => { setProfile(normalizeProfile(await getProfile())); setAnswers(await getAnswers()); setSessions(await getSessions()); announce('バックアップを読み込みました'); }} announce={announce} onNavigate={navigate} />,
    account: <AccountView announce={announce} onNavigate={navigate} />,
  }[view];

  return (
    <div className={`app-frame view-${view}`}>
      <aside className="sidebar" aria-label="メインナビゲーション">
        <button type="button" className="brand" onClick={() => navigate('home')} aria-label="ホームへ">
          <span className="brand-mark" aria-hidden="true"><i /><i className="dah" /><i /><i className="dah" /></span>
          <span className="brand-text">
            <b>CW Operator</b>
            <small className="brand-sub">
              <span>TRAINER</span>
              <span className="brand-ver">v{APP_VERSION}</span>
            </small>
          </span>
        </button>
        <nav className="nav">
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${view === item.id ? 'active' : ''} ${item.primary ? 'primary' : 'secondary'}`}
              onClick={() => {
                if (item.id === 'exam' && view === 'exam') setExamDeskResetEpoch((value) => value + 1);
                navigate(item.id);
              }}
              aria-current={view === item.id ? 'page' : undefined}
              title={item.id === 'exam' && view === 'exam' ? '科目選択に戻る' : item.title}
            >
              <Icon name={item.icon} size={22} />
              <span className="nav-label">{item.title}</span>
            </button>
          ))}
          {signedIn && (
            <button
              type="button"
              className="nav-item secondary sidebar-logout"
              onClick={() => {
                logout();
                setSignedIn(false);
                notifyAuthSync('logout');
                navigate('account');
                announce('ログアウトしました');
              }}
              title="ログアウト"
            >
              <Icon name="logout" size={22} />
              <span className="nav-label">ログアウト</span>
            </button>
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-goal">
            <Ring value={stats.dailyProgress} size={58} stroke={6} tone={stats.dailyProgress >= 1 ? 'var(--mint)' : 'var(--gold)'}>
              <b>{Math.min(stats.todayAnswers, DAILY_GOAL)}</b>
            </Ring>
            <div className="sidebar-goal-text">
              <span>今日の目標</span>
              <b>{stats.todayAnswers} / {DAILY_GOAL} 問</b>
              <small><Icon name="flame" size={13} /> {stats.streakDays}日連続</small>
            </div>
          </div>
          <p className="app-credit">(C) 2026 Int Design LLC.</p>
        </div>
      </aside>

      <main className="app-main">
        <header className="app-header">
          <div className="header-title">
            <span className="header-icon"><Icon name={current.icon} size={20} /></span>
            <div>
              <small>{current.label}</small>
              <b>{current.title}</b>
            </div>
          </div>
          <div className="header-tools">
            <button type="button" className="level-chip" onClick={() => navigate('levelup')} title={`コッホ Lv.${stats.level}（${stats.levelChars}文字）・XP ${stats.xp}`} aria-label={`レベル試験 Lv.${stats.level}`}>
              <span className="level-badge">Lv.{stats.level}</span>
              <span className="level-track" aria-hidden="true"><i style={{ width: `${stats.levelProgress * 100}%` }} /></span>
            </button>
            <span className={`streak-chip ${stats.streakDays > 0 ? 'on' : ''}`} title="連続学習日数">
              <Icon name="flame" size={16} />{stats.streakDays}
            </span>
            {speedOpen && (
              <button
                type="button"
                className="header-speed-backdrop"
                aria-label="速度設定を閉じる"
                onClick={() => setSpeedOpen(false)}
              />
            )}
            <div ref={speedWrapRef} className={`header-speed-wrap ${speedOpen ? 'open' : ''}`}>
              <button type="button" className="speed-toggle" onClick={() => setSpeedOpen((value) => !value)} aria-expanded={speedOpen} aria-label="速度設定">
                <Icon name="bolt" size={15} /><b>{settings.characterSpeed}</b><small>/{settings.effectiveSpeed} WPM</small>
              </button>
              <div className="header-speed-panel" role="dialog" aria-label="速度設定">
                <SpeedPairControls settings={settings} setSettings={setSettings} compact />
              </div>
            </div>
            <button type="button" onClick={stopAudio} className={`stop-button ${live ? 'live' : ''}`} aria-label="音声を停止">
              <Icon name="stop" size={14} /><span>{AUDIO_STATUS_LABEL[audioStatus] ?? audioStatus}</span>
            </button>
            <button type="button" className="profile-button" onClick={() => navigate('account')} title={`マイページ / 目的: ${goalLabel(profile.goal)} / 範囲: ${scopeLabel(profile)}`} aria-label="マイページ">
              <span className="profile-avatar" aria-hidden="true"><Icon name="account" size={18} /></span>
              <span className="profile-text"><b>{courseMeta(profile.learnCourse)?.label ?? 'コース未選択'}</b><small>{goalLabel(profile.goal)}</small></span>
            </button>
          </div>
        </header>
        <div className="view-stage" key={view}>{content}</div>
      </main>
      {ready && profile.goal === null && <Onboarding onSelect={(goal) => setProfile((old) => ({ ...old, goal }))} />}
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
