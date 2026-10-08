'use client';

import GeographyLoading from './views/geography/GeographyLoading';
import Link from 'next/link';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { applyAchievements, achievementById } from '@/lib/achievements';
import { examMaterialOf, readExamMaterial, rememberExamMaterial, type ExamMaterial } from '@/lib/examMaterial';
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
import { DEFAULT_PROFILE, DEFAULT_SETTINGS, addAnswer, addSession, getAnswers, getProfile, getSessions, loadSettings, markTrainerStarted, normalizeProfile, saveDataMeta, saveProfile, saveSettings } from '@/lib/storage';
import type { AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from '@/lib/types';
import { type View, views, viewMeta, audioEngine, goalLabel, scopeLabel, pathToView, viewToPath } from '@/app/trainer/shared';
import { playerStats, DAILY_GOAL } from '@/app/trainer/progress';
import { kochChars, kochProgressOf } from '@/lib/koch';
import { Ring, SpeedPairControls } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';
import { Dashboard } from '@/app/views/Dashboard';
import { LearnView } from '@/app/views/LearnView';
import { TrainView } from '@/app/views/TrainView';
import { LevelUpView } from '@/app/views/LevelUpView';
import { QueueView } from '@/app/views/QueueView';
import { AnalysisView } from '@/app/views/AnalysisView';
import { ExamView } from '@/app/views/ExamView';
import { QsoView } from '@/app/views/QsoView';
import { CollectionView } from '@/app/views/CollectionView';
import { SettingsView } from '@/app/views/SettingsView';
import { AccountView } from '@/app/views/AccountView';
import { trackPageView } from '@/app/components/GoogleAnalytics';
import { markSfxBackground, unlockSfx, wakeSfx } from '@/app/trainer/sfx';

const ExamMenuView = lazy(() => import('@/app/views/ExamMenuView'));
const EnglishView = lazy(() => import('@/app/views/EnglishView'));
const HoukiView = lazy(() => import('@/app/views/HoukiTrainerView'));
const GeographyView = lazy(() => import('@/app/views/GeographyView'));

// The geography view has an in-memory fallback. A blocked browser store must
// not prevent its shared shell from mounting before that fallback can run.
const readShellSettings = () => {
  try { return loadSettings(); } catch { return DEFAULT_SETTINGS; }
};

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
  const initialExam = examMaterialOf(initialView);
  const [lastExamMaterial, setLastExamMaterial] = useState<ExamMaterial>(initialExam ?? 'exam');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount (SSR markup must match)
    if (!initialExam) setLastExamMaterial(readExamMaterial());
  }, [initialExam]);
  const examMaterial = examMaterialOf(view);
  const [examMaterialSeen, setExamMaterialSeen] = useState(examMaterial);
  if (examMaterial !== examMaterialSeen) {
    setExamMaterialSeen(examMaterial);
    if (examMaterial) setLastExamMaterial(examMaterial);
  }
  useEffect(() => { rememberExamMaterial(view); }, [view]);
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [profile, setProfile] = useState<TrainerProfile>(DEFAULT_PROFILE);
  const [answers, setAnswers] = useState<AnswerLog[]>([]);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [audioStatus, setAudioStatus] = useState('READY');
  const [toast, setToast] = useState('');
  const [stopEpoch, setStopEpoch] = useState(0);
  /** 一総通ナビを同じ画面でもう一度押したら科目選択へ戻す */
  const [speedOpen, setSpeedOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
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
    if (snap.profile.goal) markTrainerStarted();
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the auth session lives in localStorage, only readable after mount
    setSignedIn(Boolean(loadAuthSession()));
    Promise.all([getProfile(), getAnswers(), getSessions()]).then(async ([savedProfile, savedAnswers, savedSessions]) => {
      const next = normalizeProfile(savedProfile);
      setProfile(next); setAnswers(savedAnswers); setSessions(savedSessions); setSettings(readShellSettings()); setReady(true);
      if (next.goal) markTrainerStarted();
      void saveDataMeta();
      if (loadAuthSession()) await pullCloudPreferred();
    }).catch(() => { setSettings(readShellSettings()); setReady(true); });
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
    try { saveSettings(settings); } catch { /* Keep the shell usable when browser storage is blocked. */ }
    saveProfile(profile).catch(() => undefined);
    schedulePushState(profile, settings);
  }, [settings, profile, ready]);
  useEffect(() => {
    const onPop = () => {
      // ブラウザ戻るも navigate と同様に音を止める（再生ループが残ると止まらない）
      audioEngine.stop();
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      setStopEpoch((value) => value + 1);
      setAudioStatus('READY');
      setView(pathToView(location.pathname));
      setSpeedOpen(false);
    };
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
    if ((next === 'geography' || next === 'english' || next === 'houki') && next === view) return;
    audioEngine.stop();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    setStopEpoch((value) => value + 1);
    setAudioStatus('READY'); setView(next); setSpeedOpen(false);
    const path = viewToPath(next);
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

  const recordMany = useCallback((list: AnswerLog[]) => {
    if (!list.length) return;
    setAnswers((old) => [...old, ...list]);
    for (const answer of list) addAnswer(answer).catch(() => undefined);
    void pushAnswers(list);
  }, []);

  useEffect(() => {
    if (!ready) return;
    const { profile: next, unlocked } = applyAchievements(profile, answers, sessions);
    if (unlocked.length === 0) return;
    queueMicrotask(() => {
      setProfile(next);
      const first = achievementById(unlocked[0])?.title ?? unlocked[0];
      announce(unlocked.length === 1 ? `実績GET: ${first}` : `実績GET: ${first} ほか${unlocked.length - 1}`);
    });
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
  const kochPools = useMemo(() => ({
    international: kochChars(kochProgressOf(profile, 'international').level, 'international'),
    wabun: kochChars(kochProgressOf(profile, 'wabun').level, 'wabun'),
  }), [profile]);
  const current = viewMeta(view);
  const live = audioStatus === 'PLAYING' || audioStatus === 'ANNOUNCE';

  const content = {
    home: <Dashboard answers={answers} sessions={sessions} profile={profile} stats={stats} onNavigate={navigate} />,
    learn: <LearnView settings={settings} profile={profile} setProfile={setProfile} record={record} setAudioStatus={setAudioStatus} announce={announce} onNavigate={navigate} />,
    train: <TrainView settings={settings} setSettings={setSettings} record={record} setAudioStatus={setAudioStatus} answers={answers} kochPool={kochPools} />,
    levelup: <LevelUpView settings={settings} setSettings={setSettings} profile={profile} setProfile={setProfile} record={record} setAudioStatus={setAudioStatus} onSession={onSession} />,
    queue: <QueueView settings={settings} setSettings={setSettings} record={record} setAudioStatus={setAudioStatus} stopEpoch={stopEpoch} onSession={onSession} />,
    analysis: <AnalysisView answers={answers} sessions={sessions} onNavigate={navigate} />,
    exam: <Suspense fallback={<p className="page-pad" role="status">教材メニューを読み込んでいます…</p>}><ExamMenuView lastMaterial={lastExamMaterial} onNavigate={navigate} /></Suspense>,
    communication: <ExamView settings={settings} setSettings={setSettings} record={record} answers={answers} setAudioStatus={setAudioStatus} stopEpoch={stopEpoch} announce={announce} onBack={() => navigate('exam')} />,
    english: ready ? <Suspense fallback={<p className="page-pad" role="status">専門英語教材を読み込んでいます…</p>}><EnglishView onBack={() => navigate('exam')} /></Suspense> : null,
    houki: ready ? <Suspense fallback={<p className="page-pad" role="status">法規の教材を読み込んでいます…</p>}><HoukiView onBack={() => navigate('exam')} /></Suspense> : null,
    geography: ready ? <Suspense fallback={<GeographyLoading onBack={() => navigate('exam')} />}><GeographyView onBack={() => navigate('exam')} /></Suspense> : null,
    // Client-only: canvas, Web Audio and localStorage prefs.
    qso: ready ? <QsoView settings={settings} stopEpoch={stopEpoch} profile={profile} setProfile={setProfile} sessions={sessions} recordMany={recordMany} onSession={onSession} /> : null,
    collection: <CollectionView settings={settings} profile={profile} setProfile={setProfile} setAudioStatus={setAudioStatus} />,
    settings: <SettingsView settings={settings} setSettings={setSettings} profile={profile} setProfile={setProfile} onImported={async () => { setProfile(normalizeProfile(await getProfile())); setAnswers(await getAnswers()); setSessions(await getSessions()); announce('バックアップを読み込みました'); }} announce={announce} onNavigate={navigate} />,
    account: <AccountView announce={announce} onNavigate={navigate} />,
  }[view];

  return (
    <div className={`app-frame view-${view}`}>
      <aside className="sidebar" aria-label="メインナビゲーション">
        <Link
          className="brand"
          href="/"
          prefetch={false}
          aria-label="サイトトップへ"
          onClick={(event) => {
            event.preventDefault();
            audioEngine.stop();
            if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
            // Client router keeps /app SPA history; hard leave to the landing page.
            window.location.assign('/');
          }}
        >
          <span className="brand-mark" aria-hidden="true"><i /><i className="dah" /><i /><i className="dah" /></span>
          <span className="brand-text">
            <b>CW Operator</b>
            <small className="brand-sub">
              <span>TRAINER</span>
              <span className="brand-ver">v{APP_VERSION}</span>
            </small>
          </span>
        </Link>
        <nav className="nav">
          {views.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${(view === item.id || (view === 'communication' || view === 'geography' || view === 'english' || view === 'houki') && item.id === 'exam') ? 'active' : ''} ${item.primary ? 'primary' : 'secondary'}`}
              onClick={() => navigate(item.id)}
              aria-current={(view === item.id || (view === 'communication' || view === 'geography' || view === 'english' || view === 'houki') && item.id === 'exam') ? 'page' : undefined}
              title={item.title}
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
          <Link
            className="sidebar-site"
            href="/"
            prefetch={false}
            onClick={(event) => {
              event.preventDefault();
              audioEngine.stop();
              if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
              window.location.assign('/');
            }}
          >
            サイトトップ
          </Link>
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
              <span className="profile-text"><b>{scopeLabel(profile)}</b><small>{goalLabel(profile.goal)}</small></span>
            </button>
          </div>
        </header>
        <div className="view-stage" key={view}>{content}</div>
      </main>
      <div className="toast" role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
