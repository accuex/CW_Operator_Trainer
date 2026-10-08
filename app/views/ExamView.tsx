'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExamGakuForm, countPlaySymbols, highlightPlayText } from '@/app/components/ExamGakuForm';
import { DEFAULT_EXAM_PREFS, loadExamPrefs, saveExamPrefs } from '@/lib/examPrefs';
import { EXAM_SHEET_GAP_SEC, EXAM_SUBJECTS, buildExamSession, examSheetGapSec, type ExamSession, type ExamSubjectId } from '@/lib/training';
import { pickStoredExamSet, prefetchStoredExamSet } from '@/lib/examSets';
import { wabunWeakness } from '@/lib/wabunRandom';
import { EXAM_PENALTY, scoreExamCopy, stripExamProcedureMarks, type ExamScore } from '@/lib/examScore';
import type { PlaybackHandle } from '@/lib/audio';
import type { AnswerLog, AudioSettings } from '@/lib/types';
import { audioEngine, nowId, pct } from '@/app/trainer/shared';
import { AudioControls, ProgressBar, Ring } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';
import { playSfx } from '@/app/trainer/sfx';

const wallTime = () => Date.now();
/** 視聴中に手でスクロールしたら、この間は行追従を止める（通の切替時は必ず追従） */
const MANUAL_SCROLL_HOLD_MS = 4000;
/** 前半と後半が同一（-50% 送りで継ぎ目なくループ） */
const WARNING_MARQUEE = 'WARNING　試験開始　'.repeat(8);

const SUBJECT_IDS = Object.keys(EXAM_SUBJECTS) as ExamSubjectId[];
const RANDOM_WABUN_NOTE = '本試験の和文は普通語のみで、ランダムな本文（暗語）は出題されません。文脈に頼らず全部の字を書き取る練習用です。苦手な字ほど多く出し、採点は表示のみで記録しません。';

function initialExamUi() {
  const prefs = loadExamPrefs();
  const selected = Math.max(0, SUBJECT_IDS.indexOf(prefs.subjectId));
  return { prefs, selected };
}

export function ExamView({
  settings,
  setSettings,
  record,
  answers,
  setAudioStatus,
  stopEpoch,
  announce,
  onBack,
}: {
  settings: AudioSettings;
  setSettings: (settings: AudioSettings) => void;
  record: (answer: AnswerLog) => void;
  /** 和文ランダム本文で苦手な字を多めに出すための回答記録 */
  answers: AnswerLog[];
  setAudioStatus: (status: string) => void;
  stopEpoch: number;
  announce: (message: string) => void;
  onBack?: () => void;
}) {
  const presets = SUBJECT_IDS.map((id) => EXAM_SUBJECTS[id]);
  const defaultSelected = Math.max(0, SUBJECT_IDS.indexOf(DEFAULT_EXAM_PREFS.subjectId));
  const [selected, setSelected] = useState(defaultSelected);
  const [telegram, setTelegram] = useState(DEFAULT_EXAM_PREFS.telegram);
  /** 和文本文に井戸のヰ・カギのあるヱを含める */
  const [includeWiWe, setIncludeWiWe] = useState(DEFAULT_EXAM_PREFS.includeWiWe);
  /** 視聴モード: 正解を見ながら追従再生（採点なし） */
  const [listenMode, setListenMode] = useState(DEFAULT_EXAM_PREFS.listenMode);
  /** 視聴: セット終了後に次問題を自動再生（ひたすら聞く） */
  const [autoContinueListen, setAutoContinueListen] = useState(DEFAULT_EXAM_PREFS.autoContinueListen);
  /** 和文額表の本文をランダムに（練習専用。採点は表示のみで記録しない） */
  const [randomWabunBody, setRandomWabunBody] = useState(DEFAULT_EXAM_PREFS.randomWabunBody);
  const [prefsReady, setPrefsReady] = useState(false);
  /** 開始時に固定（途中でトグルしても表示が壊れない） */
  const [sessionListenMode, setSessionListenMode] = useState(false);
  /** setup | ready | playing | paused | review — ready は出題済み・再生待ち、review は答え合わせ */
  const [phase, setPhase] = useState<'setup' | 'ready' | 'playing' | 'paused' | 'review'>('setup');
  const [sourceText, setSourceText] = useState('');
  const [session, setSession] = useState<ExamSession | null>(null);
  const [examScore, setExamScore] = useState<ExamScore | null>(null);
  const [copy, setCopy] = useState('');
  const [correctedChars, setCorrectedChars] = useState(0);
  const correctedCharsRef = useRef(0);
  const [remaining, setRemaining] = useState(300);
  const [heardCount, setHeardCount] = useState(0);
  const [sheetIndex, setSheetIndex] = useState(0);
  /** 試験呼称のあと第1通までの残り秒（呼称中・それ以外は null） */
  const [announceCountdown, setAnnounceCountdown] = useState<number | null>(null);
  /** 入力試験: 呼称後〜第1通前の心構え中（WARNINGなし・入力フォーム表示） */
  const [isPreparing, setIsPreparing] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  /** 他アプリに奪われて再生が止まった（スタートで再開） */
  const [audioInterrupted, setAudioInterrupted] = useState(false);
  const listenModeRef = useRef(DEFAULT_EXAM_PREFS.listenMode);
  const autoContinueListenRef = useRef(DEFAULT_EXAM_PREFS.autoContinueListen);
  const phaseRef = useRef(phase);
  useLayoutEffect(() => { phaseRef.current = phase; }, [phase]);

  useEffect(() => {
    const boot = initialExamUi();
    // 保存済み設定は localStorage にしか無いので、SSR と同じ既定値で描画してから反映する
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(boot.selected);
    setTelegram(boot.prefs.telegram);
    setIncludeWiWe(boot.prefs.includeWiWe);
    setListenMode(boot.prefs.listenMode);
    setAutoContinueListen(boot.prefs.autoContinueListen);
    setRandomWabunBody(boot.prefs.randomWabunBody);
    listenModeRef.current = boot.prefs.listenMode;
    autoContinueListenRef.current = boot.prefs.autoContinueListen;
    setPrefsReady(true);
  }, []);

  // 科目・視聴・電報トグルは画面を離れても維持（初回は SSR と揃えてから書く）
  useEffect(() => {
    if (!prefsReady) return;
    saveExamPrefs({
      subjectId: SUBJECT_IDS[selected] ?? 'plain',
      telegram,
      includeWiWe,
      listenMode,
      autoContinueListen,
      randomWabunBody,
    });
  }, [prefsReady, selected, telegram, includeWiWe, listenMode, autoContinueListen, randomWabunBody]);
  const timer = useRef<number | null>(null);
  const activeRef = useRef(false);
  const pausedRef = useRef(false);
  const runIdRef = useRef(0);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const sessionRef = useRef<ExamSession | null>(null);
  const sourceTextRef = useRef('');
  const revealedRef = useRef(false);
  const gakuStackRef = useRef<HTMLDivElement>(null);
  const followedSheetRef = useRef(-1);
  const manualScrollAtRef = useRef(0);
  const preset = presets[selected];
  const randomWabunActive = preset.id === 'wabun' && telegram && randomWabunBody;
  useEffect(() => {
    if (telegram && !randomWabunActive) prefetchStoredExamSet(preset.id);
  }, [preset.id, telegram, randomWabunActive]);
  const nextExamSession = async () => buildExamSession({
    subjectId: preset.id,
    telegram,
    includeWiWe: preset.id === 'wabun' && includeWiWe,
    randomWabun: randomWabunActive ? { weakness: wabunWeakness(answers) } : undefined,
    stored: telegram && !randomWabunActive ? await pickStoredExamSet(preset.id) : null,
  });
  const inSession = phase === 'ready' || phase === 'playing' || phase === 'paused' || phase === 'review';
  const trafficLabel = preset.id === 'wabun' && telegram ? '2通・5枚' : '2通';

  const clearTimer = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  /** 再生ループ・エンジン・タイマーを同期で殺す（遷移・戻る・アンマウント用） */
  const killPlaybackEngine = useCallback(() => {
    runIdRef.current += 1;
    pausedRef.current = false;
    activeRef.current = false;
    playbackRef.current?.stop();
    playbackRef.current = null;
    audioEngine.stop();
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const haltPlayback = useCallback(() => {
    killPlaybackEngine();
    setAnnounceCountdown(null);
    setIsPreparing(false);
  }, [killPlaybackEngine]);

  /** 本試験時計。呼称・心構えでは動かさず、第1通 HRHR から開始する */
  const startTimer = () => {
    clearTimer();
    setTimeUp(false);
    setRemaining(preset.durationSec);
    timer.current = window.setInterval(() => {
      if (pausedRef.current) return;
      setRemaining((value) => {
        if (value <= 1) {
          if (listenModeRef.current) {
            // 視聴: 時計は止めるが答え合わせへは行かず、再生は継続
            window.setTimeout(() => clearTimer(), 0);
            setTimeUp(true);
            setAudioStatus('TIME UP');
            return 0;
          }
          window.setTimeout(() => finishRef.current(sourceTextRef.current), 0);
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  };

  // アンマウント時も runId を上げる。play() 待ちの非同期が stop 後に音を立て直さないようにする
  useEffect(() => () => { killPlaybackEngine(); }, [killPlaybackEngine]);

  // 再生中に YouTube 等へ行くと AudioContext が死ぬ。ループを止め、スタート待ちに戻す。
  useEffect(() => {
    const interruptPlayback = () => {
      audioEngine.markBackground();
      const current = phaseRef.current;
      if (current !== 'playing' && current !== 'paused') return;
      if (!sessionRef.current) return;
      runIdRef.current += 1;
      activeRef.current = false;
      pausedRef.current = false;
      playbackRef.current?.stop();
      playbackRef.current = null;
      clearTimer();
      audioEngine.stop();
      setAnnounceCountdown(null);
      setIsPreparing(false);
      setPhase('ready');
      setAudioStatus('READY');
      setAudioInterrupted(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') interruptPlayback();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', interruptPlayback);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', interruptPlayback);
    };
  }, [setAudioStatus]);

  // 視聴モード: 通（ページ）が替わったら用紙の頭へ、同じ用紙内では「今ここ」が画面外に出たら追従
  useEffect(() => {
    if (!sessionListenMode || phase !== 'playing' || sheetIndex < 0) return;
    const stack = gakuStackRef.current;
    const sheet = stack?.children[sheetIndex] as HTMLElement | undefined;
    if (!stack || !sheet) return;
    const status = document.querySelector<HTMLElement>('.exam-status');
    // sticky 実測の下端。CSS top+height より正確（半升隠れ防止）
    const stickyBottom = status
      ? Math.max(status.getBoundingClientRect().bottom, (parseFloat(getComputedStyle(status).top) || 0) + status.offsetHeight)
      : 0;
    const mobileNav = document.querySelector<HTMLElement>('.mobile-nav');
    const bottomInset = (mobileNav?.offsetHeight ?? 48) + 12;
    const behavior: ScrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (followedSheetRef.current !== sheetIndex) {
      followedSheetRef.current = sheetIndex;
      window.scrollTo({ top: sheet.getBoundingClientRect().top + window.scrollY - stickyBottom - 16, behavior });
      return;
    }
    if (wallTime() - manualScrollAtRef.current < MANUAL_SCROLL_HOLD_MS) return;
    const now = sheet.querySelector<HTMLElement>('.listen-now');
    if (!now) return;
    const rect = now.getBoundingClientRect();
    // 1枠分先に追従して、sticky 直下で半升隠れしないようにする
    const lead = Math.max(rect.height, 36) + 12;
    const topLimit = stickyBottom + lead;
    const bottomLimit = window.innerHeight - bottomInset - lead;
    if (rect.top >= topLimit && rect.bottom <= bottomLimit) return;
    window.scrollTo({ top: rect.top + window.scrollY - topLimit, behavior });
  }, [heardCount, sheetIndex, sessionListenMode, phase]);

  useEffect(() => {
    if (!sessionListenMode) return;
    const markManual = () => { manualScrollAtRef.current = wallTime(); };
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markManual();
    };
    window.addEventListener('wheel', markManual, { passive: true });
    window.addEventListener('touchmove', markManual, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', markManual);
      window.removeEventListener('touchmove', markManual);
      window.removeEventListener('keydown', onKey);
    };
  }, [sessionListenMode]);

  /** 視聴: 再生を止めて額表を全開示したまま答え合わせ（セットアップ／ログへは戻さない） */
  const enterListenReview = useCallback(() => {
    pausedRef.current = false;
    playbackRef.current?.stop();
    playbackRef.current = null;
    audioEngine.stop();
    clearTimer();
    activeRef.current = false;
    setAnnounceCountdown(null);
    setIsPreparing(false);
    setExamScore(null);
    const current = sessionRef.current;
    const announce = current?.announcement ? countPlaySymbols(current.announcement, 'wabun') : 0;
    const total = current
      ? announce + current.sheets.reduce((sum, sheet) => sum + countPlaySymbols(sheet.playText, preset.alphabet), 0)
      : 0;
    setHeardCount(total);
    setSheetIndex((current?.sheets.length ?? 1) > 0 ? 0 : -1);
    setAudioStatus('READY');
    setPhase('review');
  }, [preset.alphabet, setAudioStatus]);

  const finish = useCallback((text = sourceTextRef.current || sourceText) => {
    pausedRef.current = false;
    runIdRef.current += 1;
    playbackRef.current?.stop();
    playbackRef.current = null;
    audioEngine.stop();
    clearTimer();
    activeRef.current = false;
    setAnnounceCountdown(null);
    setIsPreparing(false);
    if (listenModeRef.current) {
      enterListenReview();
      return;
    }
    // 入力試験: 科目選択へ戻さず、デスク上で採点結果を出す（視聴の答え合わせと同じ）
    setAudioStatus('READY');
    setPhase('review');
    const fullText = text || sourceTextRef.current || sourceText;
    // 手続符号（HRHR / NR / BT / AR など）は額表に書かないので採点対象外
    const expected = stripExamProcedureMarks(fullText, preset.alphabet);
    const scored = scoreExamCopy(expected, copy, preset.alphabet, correctedCharsRef.current);
    setExamScore(scored);
    if (!revealedRef.current) {
      revealedRef.current = true;
      playSfx('reveal', settings.volume);
    }
    window.setTimeout(() => {
      document.querySelector('.exam-result-inline')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    // ランダム本文は本試験に無い形式。苦手分析・履歴に混ぜない
    if (sessionRef.current?.practiceRandom) return;
    const sessionId = `exam-${nowId()}`;
    scored.cells.forEach((cell) => {
      if (cell.op === 'ins') return;
      record({
        id: nowId(), timestamp: Date.now(), alphabetType: preset.alphabet,
        correctSymbol: cell.expected, inputSymbol: cell.input,
        characterSpeed: settings.characterSpeed, effectiveSpeed: settings.effectiveSpeed, queueTarget: 0, actualQueueDepth: 0,
        stimulusTime: Date.now(), inputTime: Date.now(), responseLatency: 0, mode: 'exam',
        isCorrect: cell.op === 'match', isEarly: false, sessionId,
      });
    });
  }, [copy, enterListenReview, preset.alphabet, record, setAudioStatus, settings.characterSpeed, settings.effectiveSpeed, settings.volume, sourceText]);
  const finishRef = useRef(finish);
  useLayoutEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  useEffect(() => {
    if (stopEpoch === 0 || !activeRef.current) return;
    finishRef.current();
  }, [stopEpoch]);

  const waitWhilePaused = async (runId: number) => {
    while (pausedRef.current && activeRef.current && runIdRef.current === runId) {
      await new Promise<void>((resolve) => { window.setTimeout(resolve, 80); });
    }
  };

  /** 一時停止中は経過に数えない。onTick には残り秒（切り上げ）を渡す */
  const waitGap = async (seconds: number, runId: number, onTick?: (remainingSec: number) => void) => {
    let elapsed = 0;
    let last = performance.now();
    let shown = -1;
    while (elapsed < seconds * 1000) {
      if (!activeRef.current || runIdRef.current !== runId) return;
      if (pausedRef.current) {
        await waitWhilePaused(runId);
        last = performance.now();
        continue;
      }
      const remaining = Math.ceil((seconds * 1000 - elapsed) / 1000);
      if (onTick && remaining !== shown) {
        shown = remaining;
        onTick(remaining);
      }
      await new Promise<void>((resolve) => { window.setTimeout(resolve, 50); });
      const now = performance.now();
      if (!pausedRef.current) elapsed += now - last;
      last = now;
    }
  };

  const playSession = async (next: ExamSession, runId: number) => {
    const examSettings = {
      ...settings,
      characterSpeed: settings.characterSpeed,
      effectiveSpeed: Math.min(settings.effectiveSpeed, settings.characterSpeed),
    };
    let heardBase = 0;
    try {
      if (next.announcement) {
        if (!activeRef.current || runIdRef.current !== runId) return;
        await waitWhilePaused(runId);
        if (!activeRef.current || runIdRef.current !== runId) return;
        setSheetIndex(-1);
        setAudioStatus('ANNOUNCE');
        const announceHandle = await audioEngine.play(next.announcement, 'wabun', examSettings);
        playbackRef.current = announceHandle;
        if (runIdRef.current !== runId) {
          announceHandle.stop();
          playbackRef.current = null;
          return;
        }
        if (pausedRef.current) await audioEngine.pause();
        const announceMonitor = window.setInterval(() => {
          if (runIdRef.current !== runId) return;
          setHeardCount(announceHandle.receivedCount());
        }, 40);
        await announceHandle.finished;
        window.clearInterval(announceMonitor);
        if (playbackRef.current === announceHandle) playbackRef.current = null;
        heardBase = announceHandle.timeline.characters.length;
        setHeardCount(heardBase);
        if (!activeRef.current || runIdRef.current !== runId) return;
        await waitWhilePaused(runId);
        if (!activeRef.current || runIdRef.current !== runId) return;
        if (listenModeRef.current) {
          // 視聴: WARNING のままカウントダウン → 額表追従へ
          setAudioStatus('SHEET GAP');
          await waitGap(EXAM_SHEET_GAP_SEC, runId, (remaining) => {
            if (runIdRef.current === runId) setAnnounceCountdown(remaining);
          });
          if (runIdRef.current === runId) setAnnounceCountdown(null);
        } else {
          // 入力試験: WARNING を閉じて受信控えへ戻し、無音で心構え（カウントダウンなし）
          setAnnounceCountdown(null);
          setSheetIndex(0);
          setIsPreparing(true);
          setAudioStatus('PREPARE');
          window.setTimeout(() => {
            document.querySelector<HTMLTextAreaElement>('.exam-copy textarea')?.focus();
          }, 0);
          await waitGap(EXAM_SHEET_GAP_SEC, runId);
          if (runIdRef.current === runId) setIsPreparing(false);
        }
        if (activeRef.current && runIdRef.current === runId && !pausedRef.current) setAudioStatus('PLAYING');
      }
      for (let index = 0; index < next.sheets.length; index += 1) {
        if (!activeRef.current || runIdRef.current !== runId) return;
        await waitWhilePaused(runId);
        if (!activeRef.current || runIdRef.current !== runId) return;
        // 5分時計は第1通の先頭（HRHR / NR / 、）から。シケン・心構えは含めない
        if (index === 0) startTimer();
        setSheetIndex(index);
        const handle = await audioEngine.play(next.sheets[index].playText, preset.alphabet, examSettings);
        playbackRef.current = handle;
        if (runIdRef.current !== runId) {
          handle.stop();
          playbackRef.current = null;
          return;
        }
        if (pausedRef.current) await audioEngine.pause();
        const monitor = window.setInterval(() => {
          if (runIdRef.current !== runId) return;
          setHeardCount(heardBase + handle.receivedCount());
        }, 40);
        await handle.finished;
        window.clearInterval(monitor);
        if (playbackRef.current === handle) playbackRef.current = null;
        heardBase += handle.timeline.characters.length;
        setHeardCount(heardBase);
        if (!activeRef.current || runIdRef.current !== runId) return;
        await waitWhilePaused(runId);
        if (!activeRef.current || runIdRef.current !== runId) return;
        if (index < next.sheets.length - 1) {
          const gapSec = examSheetGapSec(preset.alphabet);
          if (gapSec > 0) {
            setAudioStatus('SHEET GAP');
            await waitGap(gapSec, runId);
            if (activeRef.current && runIdRef.current === runId && !pausedRef.current) setAudioStatus('PLAYING');
          }
        }
      }
      if (activeRef.current && runIdRef.current === runId) {
        if (listenModeRef.current && autoContinueListenRef.current) {
          // ひたすら聞く: 次の出題をそのまま再生（答え合わせに落とさない）
          const continued = await nextExamSession();
          if (!activeRef.current || runIdRef.current !== runId) return;
          clearTimer();
          setTimeUp(false);
          setHeardCount(0);
          setSheetIndex(0);
          setAnnounceCountdown(null);
          setIsPreparing(false);
          followedSheetRef.current = -1;
          sessionRef.current = continued;
          setSession(continued);
          sourceTextRef.current = continued.playText;
          setSourceText(continued.playText);
          setRemaining(preset.durationSec);
          setPhase('playing');
          setAudioStatus('PLAYING');
          await playSession(continued, runId);
          return;
        }
        if (listenModeRef.current) {
          // 視聴は最後まで聴いたら答え合わせ（額表を残す）
          finishRef.current();
        } else {
          setAudioStatus('READY');
        }
      }
    } catch (error) {
      console.error('Exam playback failed', error);
      if (activeRef.current && runIdRef.current === runId) setAudioStatus('ERROR');
    }
  };

  /** 視聴: 出題だけ用意して再生待ち（いきなり鳴らさない） */
  const prepareListenDesk = (next: ExamSession) => {
    runIdRef.current += 1;
    pausedRef.current = false;
    playbackRef.current?.stop();
    playbackRef.current = null;
    audioEngine.stop();
    clearTimer();
    activeRef.current = false;
    listenModeRef.current = true;
    setListenMode(true);
    setSessionListenMode(true);
    sessionRef.current = next;
    setSession(next);
    setExamScore(null);
    // 未到達扱いにして追従ハイライトを消す（内容は薄い色で見える）
    setHeardCount(-1_000_000);
    setSheetIndex(0);
    setAnnounceCountdown(null);
    setIsPreparing(false);
    setTimeUp(false);
    revealedRef.current = false;
    followedSheetRef.current = -1;
    sourceTextRef.current = next.playText;
    setSourceText(next.playText);
    setRemaining(preset.durationSec);
    setAudioStatus('READY');
    setPhase('ready');
  };

  const beginSession = async (next: ExamSession, options?: { keepCopy?: boolean }) => {
    const text = next.playText;
    const listening = listenModeRef.current || listenMode;
    listenModeRef.current = listening;
    setSessionListenMode(listening);
    sessionRef.current = next;
    setSession(next);
    setExamScore(null);
    setHeardCount(0);
    setSheetIndex(0);
    setAnnounceCountdown(null);
    setIsPreparing(false);
    setTimeUp(false);
    revealedRef.current = false;
    followedSheetRef.current = -1;
    if (!options?.keepCopy) {
      setCorrectedChars(0);
      correctedCharsRef.current = 0;
      setCopy('');
    }
    sourceTextRef.current = text;
    setSourceText(text);
    setRemaining(preset.durationSec);
    pausedRef.current = false;
    activeRef.current = true;
    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    playbackRef.current?.stop();
    playbackRef.current = null;
    audioEngine.stop();
    clearTimer();
    setPhase('playing');
    setAudioStatus('PLAYING');
    await playSession(next, runId);
  };

  /** 入力試験: 出題だけ用意してスタート待ち */
  const prepareInputDesk = (next: ExamSession) => {
    runIdRef.current += 1;
    pausedRef.current = false;
    playbackRef.current?.stop();
    playbackRef.current = null;
    audioEngine.stop();
    clearTimer();
    activeRef.current = false;
    listenModeRef.current = false;
    setListenMode(false);
    setSessionListenMode(false);
    sessionRef.current = next;
    setSession(next);
    setExamScore(null);
    setHeardCount(0);
    setSheetIndex(0);
    setAnnounceCountdown(null);
    setIsPreparing(false);
    setCorrectedChars(0);
    correctedCharsRef.current = 0;
    setCopy('');
    revealedRef.current = false;
    followedSheetRef.current = -1;
    sourceTextRef.current = next.playText;
    setSourceText(next.playText);
    setRemaining(preset.durationSec);
    setAudioStatus('READY');
    setPhase('ready');
  };

  const preparingRef = useRef(false);
  const start = async () => {
    if (preparingRef.current) return;
    preparingRef.current = true;
    const next = await nextExamSession().finally(() => { preparingRef.current = false; });
    if (listenMode) {
      prepareListenDesk(next);
      return;
    }
    // 入力も視聴と同じく、まず用意 → スタート
    prepareInputDesk(next);
  };

  /** 新しい出題を用意（再生はスタート押し待ち） */
  const renewProblem = async () => {
    if (preparingRef.current) return;
    preparingRef.current = true;
    const next = await nextExamSession().finally(() => { preparingRef.current = false; });
    if (sessionListenMode || listenModeRef.current || listenMode) {
      prepareListenDesk(next);
      return;
    }
    prepareInputDesk(next);
  };

  /** 用意済みの出題を再生開始 */
  const startDeskPlayback = async () => {
    const current = sessionRef.current ?? session;
    if (!current || (phase !== 'ready' && phase !== 'review')) return;
    setAudioInterrupted(false);
    await audioEngine.unlock();
    if (sessionListenMode || listenModeRef.current) listenModeRef.current = true;
    else listenModeRef.current = false;
    await beginSession(current);
  };

  const restartFromStart = async () => {
    const current = sessionRef.current ?? session;
    if (!current || !inSession) return;
    if (sessionListenMode || listenModeRef.current) {
      prepareListenDesk(current);
      return;
    }
    if (phase === 'ready' || phase === 'review') {
      prepareInputDesk(current);
      return;
    }
    await audioEngine.unlock();
    await beginSession(current);
  };

  /** デスクを閉じて科目選択へ（視聴ログは出さない） */
  const exitToSetup = useCallback((options?: { listenMode?: boolean }) => {
    haltPlayback();
    sessionRef.current = null;
    setSession(null);
    setSessionListenMode(false);
    setHeardCount(0);
    setExamScore(null);
    setCopy('');
    setCorrectedChars(0);
    correctedCharsRef.current = 0;
    if (options && 'listenMode' in options) {
      listenModeRef.current = Boolean(options.listenMode);
      setListenMode(Boolean(options.listenMode));
    }
    setPhase('setup');
    setAudioStatus('READY');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [haltPlayback, setAudioStatus]);

  const exitListenDesk = () => exitToSetup();

  /** 教材メニューへ戻る前に再生を止める（navigate の stop だけでは play() 待ちが生き残る） */
  const leaveToExamMenu = () => {
    haltPlayback();
    setAudioStatus('READY');
    onBack?.();
  };

  /** ステータスの「視聴」チップ: オフにして科目選択へ戻る */
  const toggleListenChip = () => {
    if (sessionListenMode || inSession) {
      exitToSetup({ listenMode: false });
      return;
    }
    setListenMode((value) => !value);
  };

  /** 額表は画面と同じ DOM/CSS を使う（再現度優先）。ダイアログで「PDFに保存」。 */
  const saveGakuPdf = () => {
    if (!session) {
      announce('先に問題を用意してください');
      return;
    }
    const previousTitle = document.title;
    const stamp = new Date().toISOString().slice(0, 10);
    const kind = sessionListenMode || listenModeRef.current ? '視聴' : '試験';
    document.title = `CWOT-額表-${preset.title}-${kind}-${stamp}`;
    document.body.classList.add('print-gaku');
    const restore = () => {
      document.title = previousTitle;
      document.body.classList.remove('print-gaku');
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    announce('印刷ダイアログで「PDFに保存」を選んでください');
    window.setTimeout(() => {
      window.print();
      // afterprint が来ない環境向けの保険
      window.setTimeout(restore, 60_000);
    }, 50);
  };

  const stopPlayback = async () => {
    if (phase !== 'playing') return;
    pausedRef.current = true;
    setPhase('paused');
    setAudioStatus('PAUSED');
    await audioEngine.pause();
  };

  const continuePlayback = async () => {
    if (phase !== 'paused') return;
    // 他アプリ復帰後は suspend 済みオシレータが蘇生しない → 最初から再生し直す
    if (audioEngine.isDirty) {
      const current = sessionRef.current ?? session;
      if (!current) return;
      pausedRef.current = false;
      setAudioInterrupted(false);
      await audioEngine.unlock();
      if (sessionListenMode || listenModeRef.current) listenModeRef.current = true;
      await beginSession(current);
      return;
    }
    pausedRef.current = false;
    setPhase('playing');
    setAudioStatus('PLAYING');
    await audioEngine.resume();
  };

  const onCopyChange = (next: string) => {
    const removed = Math.max(0, copy.length - next.length);
    if (removed > 0) {
      const total = correctedCharsRef.current + removed;
      correctedCharsRef.current = total;
      setCorrectedChars(total);
    }
    setCopy(next);
  };
  const clock = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  const clockUrgent = remaining <= 30;
  const announceSymbols = session?.announcement
    ? countPlaySymbols(session.announcement, 'wabun')
    : 0;
  const listenTotal = session
    ? announceSymbols + session.sheets.reduce((sum, sheet) => sum + countPlaySymbols(sheet.playText, preset.alphabet), 0)
    : countPlaySymbols(sourceText, preset.alphabet);
  const sheetHeardOffsets = (() => {
    if (!session) return [0];
    const offsets = [announceSymbols];
    for (let index = 0; index < session.sheets.length - 1; index += 1) {
      offsets.push(offsets[index] + countPlaySymbols(session.sheets[index].playText, preset.alphabet));
    }
    return offsets;
  })();
  const sheetProgress = sheetIndex < 0
    ? 'シケン'
    : `第${sheetIndex + 1}/${session?.sheets.length ?? '—'}枚`;
  const passing = Boolean(examScore && examScore.accuracy >= 0.9);
  return <section className="exam-page page-pad">
    {onBack && <button id="communication-back" className="btn btn-secondary exam-menu-return" onClick={leaveToExamMenu}>一総通の教材メニューへ</button>}
    {!inSession ? (
      <div className="exam-setup">
        <div className="page-title">
          <div>
            <p className="section-kicker">Receiving Exam</p>
            <h1>第1級総合無線通信士 電気通信術（受信）</h1>
            <p>5分間の音響受信です。科目を選んで、額表に書き取る練習をします。</p>
          </div>
          <div className="exam-brief-chips">
            <span className="chip gold">5分</span>
            <span className="chip">約{preset.totalChars}字</span>
            <span className="chip">{trafficLabel}</span>
          </div>
        </div>

        <div>
          <p className="section-kicker">Subject</p>
          <div className="preset-grid" role="radiogroup" aria-label="試験科目">
            {presets.map((item, index) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected === index}
                className={`preset-card ${item.id}${selected === index ? ' active' : ''}`}
                onClick={() => setSelected(index)}
              >
                <span className="preset-top">
                  <span>科目 {index + 1}</span>
                  {selected === index && <Icon name="check" size={18} />}
                </span>
                <strong>{item.title}</strong>
                <span className="preset-stats">
                  <em>{item.cpm}<small>字／分</small></em>
                  <em>約{item.totalChars}<small>字</small></em>
                  <em>{item.wpm}<small>WPM</small></em>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="exam-switches">
          <label className={`exam-switch${telegram ? ' on' : ''}`}>
            <span className="exam-switch-copy">
              <strong>額表・電報形式</strong>
              <small>
                {preset.id === 'wabun'
                  ? '本試験どおり2通・5枚（2+3 または 3+2）'
                  : '2通構成'}
              </small>
            </span>
            <span className="exam-switch-ui">
              <input
                type="checkbox"
                role="switch"
                checked={telegram}
                onChange={(event) => setTelegram(event.target.checked)}
              />
              <i aria-hidden="true" />
            </span>
          </label>
          <label className={`exam-switch${listenMode ? ' on' : ''}`}>
            <span className="exam-switch-copy">
              <strong>視聴モード</strong>
              <small>正解を見ながら追従・採点なし</small>
            </span>
            <span className="exam-switch-ui">
              <input
                type="checkbox"
                role="switch"
                checked={listenMode}
                onChange={(event) => {
                  const next = event.target.checked;
                  listenModeRef.current = next;
                  setListenMode(next);
                }}
              />
              <i aria-hidden="true" />
            </span>
          </label>
          {listenMode && (
            <label className={`exam-switch${autoContinueListen ? ' on' : ''}`}>
              <span className="exam-switch-copy">
                <strong>自動連続再生</strong>
                <small>1セット終わったら次の問題を自動で再生（BGM用）</small>
              </span>
              <span className="exam-switch-ui">
                <input
                  type="checkbox"
                  role="switch"
                  checked={autoContinueListen}
                  onChange={(event) => {
                    const next = event.target.checked;
                    autoContinueListenRef.current = next;
                    setAutoContinueListen(next);
                  }}
                />
                <i aria-hidden="true" />
              </span>
            </label>
          )}
          {preset.id === 'wabun' && (
            <label className={`exam-switch${includeWiWe ? ' on' : ''}`}>
              <span className="exam-switch-copy">
                <strong>ヰ・ヱを含める</strong>
                <small>井戸のヰ・カギのあるヱを本文に混ぜる</small>
              </span>
              <span className="exam-switch-ui">
                <input
                  type="checkbox"
                  role="switch"
                  checked={includeWiWe}
                  onChange={(event) => setIncludeWiWe(event.target.checked)}
                />
                <i aria-hidden="true" />
              </span>
            </label>
          )}
          {preset.id === 'wabun' && telegram && (
            <label className={`exam-switch${randomWabunBody ? ' on' : ''}`}>
              <span className="exam-switch-copy">
                <strong>本文をランダムにする（練習用）</strong>
                <small>{RANDOM_WABUN_NOTE}</small>
              </span>
              <span className="exam-switch-ui">
                <input
                  type="checkbox"
                  role="switch"
                  checked={randomWabunBody}
                  onChange={(event) => setRandomWabunBody(event.target.checked)}
                />
                <i aria-hidden="true" />
              </span>
            </label>
          )}
        </div>

        <div className="panel panel-pad exam-speed-bar">
          <div className="panel-head">
            <h2>速度</h2>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={settings.characterSpeed === preset.wpm && settings.effectiveSpeed === preset.wpm}
              onClick={() => setSettings({ ...settings, characterSpeed: preset.wpm, effectiveSpeed: preset.wpm })}
              title={`公式CD速度に合わせる（和文22 / 暗語21 / 普通語23）。いまの科目: ${preset.wpm} WPM`}
            >
              規定値に戻す <b>{preset.wpm} WPM</b>
            </button>
          </div>
          <AudioControls settings={settings} setSettings={setSettings} />
        </div>

        <button type="button" className="btn btn-primary btn-lg exam-start" onClick={start}>
          <Icon name={listenMode ? 'ear' : 'play'} size={18} />
          問題を用意
        </button>

        <div className="exam-score-note panel panel-pad">
          <p className="section-kicker">Rules</p>
          <p>
            {listenMode
              ? autoContinueListen
                ? '視聴＋自動連続再生は、モールスをひたすら流すモードです。スタート後はセットが終わるたびに次の出題へ進みます。止めるときは「答え合わせ」か一時停止。採点・視聴ログはありません。'
                : '視聴は手書き練習と答え合わせ用です。まず問題を用意し、準備できたらスタートで再生します。筆記して額表で照合し、「次の問題」でこのまま続けられます。採点・視聴ログはありません。'
              : preset.id === 'wabun'
                ? '出題量の目安は公式どおり（和文375字・5分）。問題を用意→スタート。終了後もこの画面に残り、受信控えの下に採点と正解の額表が出ます。額表ON時は2通・5枚（枚間・通間の休止なし）。'
                : `出題量は公式どおり（和文375 / 欧文暗語400 / 欧文普通語500字・5分）。問題を用意→スタート。終了後もこの画面で採点します。2通に分け、通間 ${EXAM_SHEET_GAP_SEC} 秒休止（和文は休止なし）。`}
          </p>
          {(preset.id === 'wabun' || !listenMode) && (
            <ul>
              {preset.id === 'wabun' && (
                <li>受付時刻：セ（午前）／コ（午後）に続けて、時・分は数字の略体で送る（例: 午後5時38分 → コ [5]、[3][8]）</li>
              )}
              {!listenMode && (
                <>
                  <li>誤字・冗字：1字につき {EXAM_PENALTY.sub}点</li>
                  <li>脱字：1字につき {EXAM_PENALTY.del}点</li>
                  <li>抹消・訂正：{EXAM_PENALTY.correctionUnit}字までごとに {EXAM_PENALTY.correctionPoints}点（Backspace等）</li>
                </>
              )}
            </ul>
          )}
        </div>
      </div>
    ) : (
      <div className={`exam-terminal${sessionListenMode || phase === 'review' ? ' listen-mode' : ''}`}>
        <div className="exam-status">
          <div className="exam-status-row">
            <div className="exam-status-meta">
              <span className="chip gold">{preset.title}</span>
              {session?.practiceRandom && (
                <span className="chip" title="本試験には無い形式です（記録しません）">ランダム練習</span>
              )}
              {sessionListenMode ? (
                <button
                  type="button"
                  className="chip sky exam-mode-chip"
                  onClick={toggleListenChip}
                  title="視聴を終了して科目選択に戻る"
                  aria-label="視聴を終了して科目選択に戻る"
                >
                  視聴
                  <small>戻る</small>
                </button>
              ) : (
                <button
                  type="button"
                  className="chip exam-mode-chip"
                  onClick={() => exitToSetup({ listenMode: false })}
                  title="科目選択に戻る"
                  aria-label="科目選択に戻る"
                >
                  試験
                  <small>戻る</small>
                </button>
              )}
              <span className="exam-status-detail">
                {sheetProgress}
                {' · '}目標 {preset.totalChars}字
                {' · '}{preset.cpm}字／分
                {phase === 'ready' ? ' · スタート待ち' : ''}
                {phase === 'paused' ? ' · 一時停止中' : ''}
                {phase === 'review' ? (sessionListenMode ? ' · 答え合わせ' : ' · 採点結果') : ''}
                {isPreparing ? ' · 心構え' : ''}
                {timeUp && phase !== 'review' && phase !== 'ready' ? ' · 時間切れ（再生継続）' : ''}
                {sessionListenMode && autoContinueListen && phase !== 'review' ? ' · 連続再生' : ''}
              </span>
              {!sessionListenMode && phase !== 'review' && <span className="chip">訂正 {correctedChars}字</span>}
            </div>
            {phase === 'review' ? (
              <strong className="exam-clock exam-clock-done" aria-label={sessionListenMode ? '答え合わせ' : '採点結果'}>DONE</strong>
            ) : phase === 'ready' ? (
              <strong className="exam-clock" aria-label="スタート待ち">READY</strong>
            ) : (
              <strong className={`exam-clock${clockUrgent ? ' is-urgent' : ''}`} aria-label={`残り ${clock}`}>{clock}</strong>
            )}
            <div className="exam-transport">
              {phase === 'ready' || phase === 'review' ? (
                <>
                  <button type="button" className="btn btn-primary btn-sm" onClick={startDeskPlayback} title={phase === 'ready' ? '試験呼称から再生開始' : '同じ出題を再生'}>
                    <Icon name="play" size={16} />スタート
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={renewProblem} title="新しい出題を用意（再生はスタート押し待ち）">
                    <Icon name="sparkle" size={16} />次の問題
                  </button>
                  {phase === 'review' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={restartFromStart} title="同じ出題をスタート待ちに戻す">
                      <Icon name="repeat" size={16} />もう一度
                    </button>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={saveGakuPdf} title="額表をPDF保存（印刷ダイアログ）">
                    <Icon name="printer" size={16} />PDF保存
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={exitListenDesk} title="科目選択画面に戻る">
                    戻る
                  </button>
                </>
              ) : (
                <>
                  {sessionListenMode && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={renewProblem} title="新しい出題に差し替え（再生はスタート押し待ち）">
                        <Icon name="sparkle" size={16} />次の問題
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={saveGakuPdf} title="いまの額表をPDF保存（印刷ダイアログ）">
                        <Icon name="printer" size={16} />PDF保存
                      </button>
                    </>
                  )}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={restartFromStart} title="同じ出題を最初から">
                    <Icon name="repeat" size={16} />最初から
                  </button>
                  {phase === 'playing' ? (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={stopPlayback}>
                      <Icon name="pause" size={16} />一時停止
                    </button>
                  ) : (
                    <button type="button" className="btn btn-primary btn-sm" onClick={continuePlayback}>
                      <Icon name="play" size={16} />再開
                    </button>
                  )}
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => finish()} title={sessionListenMode ? '再生を止めて答え合わせ' : '採点して終了'}>
                    <Icon name="stop" size={16} />{sessionListenMode ? '答え合わせ' : '終了'}
                  </button>
                </>
              )}
            </div>
          </div>
          {sessionListenMode && (phase === 'playing' || phase === 'paused' || phase === 'ready' || phase === 'review') && (
            <div className="exam-listen-progress">
              {(phase === 'playing' || phase === 'paused') ? (
                <>
                  <span>追従 {Math.min(Math.max(0, heardCount), listenTotal)} / {listenTotal}</span>
                  <ProgressBar
                    tone="sky"
                    label="視聴の追従"
                    value={listenTotal ? Math.min(Math.max(0, heardCount), listenTotal) / listenTotal : 0}
                  />
                </>
              ) : (
                <span className="exam-listen-loop-hint">
                  {autoContinueListen ? '連続再生オン · スタート後は次セットへ自動進行' : '1セット再生'}
                </span>
              )}
              <label className={`exam-loop-toggle${autoContinueListen ? ' on' : ''}`}>
                <input
                  type="checkbox"
                  checked={autoContinueListen}
                  onChange={(event) => {
                    const next = event.target.checked;
                    autoContinueListenRef.current = next;
                    setAutoContinueListen(next);
                  }}
                />
                <span>自動連続再生</span>
              </label>
            </div>
          )}
          {phase === 'ready' && (
            <div className={audioInterrupted ? 'exam-audio-interrupt-bar' : 'exam-listen-review-bar'} role="status">
              <span>
                {audioInterrupted
                  ? '他のアプリで音声が中断されました。「スタート」を押すと最初から再生します。'
                  : sessionListenMode
                    ? autoContinueListen
                      ? '問題を用意しました。「スタート」で再生。終わると次の出題へ自動で進みます。'
                      : '問題を用意しました。筆記の準備ができたら「スタート」で再生します。'
                    : '問題を用意しました。心の準備ができたら「スタート」で試験を始めます。'}
              </span>
            </div>
          )}
          {phase === 'review' && (
            <div className="exam-listen-review-bar" role="status">
              <span>
                {sessionListenMode
                  ? autoContinueListen
                    ? '額表を見て答え合わせ。連続再生オンのまま「スタート」すると、そのあとセット終了ごとに次問題へ進みます。'
                    : '額表を見て答え合わせ。「スタート」で同じ問題、「次の問題」で新しい出題。戻るときは「視聴」か左の一総通メニュー。'
                  : '下に採点結果と正解の額表があります。「スタート」で同じ問題、「次の問題」で新しい出題。戻るときは「試験」か左の一総通メニュー。'}
              </span>
            </div>
          )}
        </div>
        {session?.announcement && sheetIndex < 0 && !isPreparing && phase !== 'review' && phase !== 'ready' && (
          <div
            className={`exam-warning${announceCountdown !== null ? ' is-countdown' : ''}${phase === 'paused' ? ' is-paused' : ''}`}
            role="status"
            aria-live="assertive"
          >
            <div className="exam-warning-band top" aria-hidden="true"><span>{WARNING_MARQUEE}</span></div>
            <div className="exam-warning-core">
              <p className="exam-warning-kicker">
                <Icon name="bolt" size={16} />
                {preset.title} · 第1級総合無線通信士
              </p>
              <h2 className="exam-warning-call" aria-label={session.announcement}>
                {highlightPlayText(session.announcement, 'wabun', heardCount, 'announce')}
              </h2>
              {announceCountdown !== null ? (
                <div className="exam-warning-count" key={announceCountdown}>
                  <strong>{announceCountdown}</strong>
                  <span>第1通まで</span>
                </div>
              ) : (
                <p className="exam-warning-sub">試験呼称を送信中…</p>
              )}
              {phase === 'paused' && <p className="exam-warning-paused">一時停止中</p>}
            </div>
            <div className="exam-warning-band bottom" aria-hidden="true"><span>{WARNING_MARQUEE}</span></div>
          </div>
        )}
        {sessionListenMode ? (
          <div className={`exam-listen-panel${phase === 'review' ? ' is-review' : ''}`}>
            <div className="gaku-stack" aria-label="額表視聴" ref={gakuStackRef}>
              {(session?.sheets ?? []).map((sheet, index) => {
                const offset = sheetHeardOffsets[index] ?? 0;
                const localHeard = heardCount - offset;
                return (
                  <ExamGakuForm
                    key={`gaku-${session?.playText.length}-${sheet.sheet}-${index}`}
                    ledger={sheet}
                    alphabet={preset.alphabet}
                    localHeard={localHeard}
                    active={phase !== 'review' && index === sheetIndex}
                    plainOnly={!telegram}
                  />
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div className={`exam-copy${preset.alphabet === 'wabun' ? ' wabun' : ''}${phase === 'review' ? ' is-review' : ''}`}>
              <div className="exam-copy-head">
                <b>受信控え</b>
                <span>{preset.title} · 2通分{phase === 'ready' ? ' · スタート待ち' : ''}</span>
              </div>
              <textarea
                autoFocus={phase === 'playing' || phase === 'ready'}
                value={copy}
                onChange={(event) => onCopyChange(event.target.value)}
                readOnly={phase === 'review' || phase === 'ready'}
                spellCheck={false}
                aria-label="受信内容を入力"
                placeholder={phase === 'ready' ? 'スタート後にここに記入します…' : '受信した内容をここに記入（2通分）…'}
              />
            </div>
            {phase === 'review' && examScore && session && (
              <div className="exam-result exam-result-inline has-gaku">
                <div className="exam-result-hero">
                  <div className="exam-ring">
                    <Ring
                      value={examScore.accuracy}
                      size={156}
                      stroke={12}
                      tone={passing ? 'var(--mint)' : 'var(--gold)'}
                    >
                      <strong>{pct(examScore.accuracy)}</strong>
                      <small>減点換算</small>
                    </Ring>
                  </div>
                  <div>
                    <p className="section-kicker">Score Sheet</p>
                    <h2>採点結果</h2>
                    {passing ? (
                      <span className="chip mint"><Icon name="check" size={14} />合格圏</span>
                    ) : (
                      <p className="exam-encourage">減点の出どころが見えています。もう一通で、そこを拾いましょう。</p>
                    )}
                    <p className="exam-result-meta">
                      実字数 {session.totalChars} / 目標 {session.targetChars}
                      {' · '}全{session.sheets.length}枚
                    </p>
                  </div>
                </div>
                <div className="exam-score-breakdown">
                  <span className="chip mint">一致 {examScore.matches}</span>
                  <span className="chip coral">誤字 ×{EXAM_PENALTY.sub} · {examScore.substitutions}</span>
                  <span className="chip gold">冗字 ×{EXAM_PENALTY.ins} · {examScore.insertions}</span>
                  <span className="chip">脱字 ×{EXAM_PENALTY.del} · {examScore.deletions}</span>
                  <span className="chip">抹消・訂正 {examScore.corrections}字 → {examScore.correctionPenalty}点</span>
                  <span className="chip coral">減点合計 {examScore.penalty}</span>
                  <span className="chip sky">一致率 {pct(examScore.hitRate)}</span>
                  <span className="chip">出題 {examScore.expected.length}字</span>
                </div>
                {examScore.cells.length > 0 && (
                  <div className="exam-align">
                    <p className="section-kicker">Alignment</p>
                    <ul className="exam-legend">
                      <li><i className="op-match" aria-hidden="true" />一致</li>
                      <li><i className="op-sub" aria-hidden="true" />誤字</li>
                      <li><i className="op-del" aria-hidden="true" />脱字</li>
                      <li><i className="op-ins" aria-hidden="true" />冗字</li>
                    </ul>
                    <p className="exam-align-caption">上段が正解、下段が受信控え</p>
                    <div className="exam-align-row" aria-label="正解側">
                      {examScore.cells.map((cell, index) => (
                        <i key={`e-${index}`} className={`op-${cell.op}`}>{cell.expected || '·'}</i>
                      ))}
                    </div>
                    <div className="exam-align-row" aria-label="入力側">
                      {examScore.cells.map((cell, index) => (
                        <i key={`i-${index}`} className={`op-${cell.op}`}>{cell.input || '·'}</i>
                      ))}
                    </div>
                  </div>
                )}
                <div className="exam-result-gaku">
                  <p className="section-kicker">Answer Forms</p>
                  <h3 className="exam-result-gaku-title">正解の額表（全{session.sheets.length}枚）</h3>
                  <div className="exam-listen-panel is-review">
                    <div className="gaku-stack" aria-label="正解の額表">
                      {session.sheets.map((sheet, index) => (
                        <ExamGakuForm
                          key={`result-gaku-${sheet.sheet}-${index}`}
                          ledger={sheet}
                          alphabet={preset.alphabet}
                          localHeard={1_000_000}
                          active={false}
                          plainOnly={!telegram}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )}
  </section>;
}
