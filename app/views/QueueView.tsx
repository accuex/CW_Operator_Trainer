'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PlaybackHandle } from '@/lib/audio';
import { alphabetSymbols } from '@/lib/morse';
import { QueueEvaluator, scoreQueue } from '@/lib/queue';
import { randomGroup } from '@/lib/training';
import type { AlphabetType, AnswerLog, AudioSettings, QueueInputResult, QueueMetrics, SessionRecord } from '@/lib/types';
import { type QueueSource, audioEngine, nowId, pct } from '@/app/trainer/shared';
import { playSfx } from '@/app/trainer/sfx';
import { AudioControls, Metric } from '@/app/components/ui';
import { ComboBadge, FxBurst, SignalPulse, useFx } from '@/app/components/fx';
import { Icon } from '@/app/components/icons';

export const QUEUE_CAP = 8;
export type QueuePad = { left: string; up: string; right: string; down: string };
export const queuePadList = (pad: QueuePad) => [pad.left, pad.up, pad.right, pad.down];
export const queueUniverse = (source: QueueSource) => {
  if (source === 'digits') return '0123456789'.split('');
  if (source === 'wabun' || source === 'kana') return alphabetSymbols('wabun');
  return alphabetSymbols('international').filter((symbol) => /^[A-Z]$/.test(symbol));
};
export const pickRandomQueuePad = (source: QueueSource): QueuePad => {
  const universe = [...queueUniverse(source)];
  for (let index = universe.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [universe[index], universe[swap]] = [universe[swap], universe[index]];
  }
  const [left, up, right, down] = universe.slice(0, 4);
  return { left, up, right, down };
};

export function QueueView({ settings, setSettings, record, setAudioStatus, stopEpoch, onSession }: { settings: AudioSettings; setSettings: (settings: AudioSettings) => void; record: (answer: AnswerLog) => void; setAudioStatus: (status: string) => void; stopEpoch: number; onSession: (session: SessionRecord) => void }) {
  const [depth, setDepth] = useState(2);
  const [source, setSource] = useState<QueueSource>('international');
  const [pad, setPad] = useState<QueuePad>({ left: 'E', up: 'T', right: 'A', down: 'N' });
  const [sequence, setSequence] = useState('');
  const [received, setReceived] = useState(0);
  const [results, setResults] = useState<QueueInputResult[]>([]);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [active, setActive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [lastResult, setLastResult] = useState<QueueInputResult | null>(null);
  const [exitFx, setExitFx] = useState<{ symbol: string; ok: boolean; token: number; at: number } | null>(null);
  const [padFlash, setPadFlash] = useState<{ symbol: string; ok: boolean; token: number; all?: boolean } | null>(null);
  const [padNote, setPadNote] = useState<{ text: string; kind: 'miss' | 'out'; token: number } | null>(null);
  const [showHeldSymbols, setShowHeldSymbols] = useState(true);
  const [combo, setCombo] = useState(0);
  const [fx, triggerFx] = useFx();
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const evaluatorRef = useRef<QueueEvaluator | null>(null);
  const timerRef = useRef<number | null>(null);
  const stimulusTimesRef = useRef<number[]>([]);
  const sessionIdRef = useRef('');
  const activeRef = useRef(false);
  const startedAtRef = useRef(0);
  const receivedRef = useRef(0);
  const depthRef = useRef(depth);
  const failedRef = useRef(false);
  const sequenceRef = useRef('');
  const padRef = useRef(pad);
  const comboRef = useRef(0);
  const choices = queuePadList(pad);

  useEffect(() => () => { if (timerRef.current) window.clearInterval(timerRef.current); playbackRef.current?.stop(); audioEngine.stop(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }, []);
  const finish = useCallback((opts?: { failed?: boolean }) => {
    if (!evaluatorRef.current || !activeRef.current) return;
    activeRef.current = false;
    playbackRef.current?.stop();
    playbackRef.current = null;
    audioEngine.stop();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (opts?.failed) { setFailed(true); failedRef.current = true; }
    const finalMetrics = evaluatorRef.current.metrics();
    setMetrics(finalMetrics);
    onSession({ id: sessionIdRef.current || nowId(), startedAt: startedAtRef.current || Date.now(), endedAt: Date.now(), mode: 'queue', alphabetType: source === 'wabun' || source === 'kana' ? 'wabun' : 'international', answers: finalMetrics.answered, accuracy: finalMetrics.answered ? finalMetrics.correct / finalMetrics.answered : 0, queue: finalMetrics });
    setActive(false); setAudioStatus('READY');
    const nextPad = pickRandomQueuePad(source);
    padRef.current = nextPad;
    setPad(nextPad);
    const history = evaluatorRef.current.history;
    const last = history[history.length - 1];
    if (opts?.failed || (last && !last.isCorrect)) playSfx('miss', settings.volume);
    else if (comboRef.current >= 2) playSfx('combo', settings.volume);
  }, [onSession, setAudioStatus, source, settings.volume]);
  const finishRef = useRef(finish);

  useLayoutEffect(() => {
    depthRef.current = depth;
    failedRef.current = failed;
    sequenceRef.current = sequence;
    padRef.current = pad;
    finishRef.current = finish;
  }, [depth, failed, sequence, pad, finish]);

  useEffect(() => {
    if (stopEpoch === 0) return;
    if (!activeRef.current) {
      playbackRef.current?.stop();
      playbackRef.current = null;
      audioEngine.stop();
      if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
      return;
    }
    finishRef.current();
  }, [stopEpoch]);

  const syncReceived = (count: number) => {
    receivedRef.current = count;
    setReceived(count);
    evaluatorRef.current?.registerProgress(count);
    setMetrics(evaluatorRef.current?.metrics() ?? null);
    const answered = evaluatorRef.current?.answered ?? 0;
    if (count - answered > QUEUE_CAP) finishRef.current({ failed: true });
  };

  const beginQueue = async () => {
    const sessionStartedAt = Date.now();
    setActive(true); activeRef.current = true; startedAtRef.current = sessionStartedAt; setFailed(false); failedRef.current = false;
    comboRef.current = 0; setCombo(0);
    try {
      playbackRef.current?.stop(); if (timerRef.current) window.clearInterval(timerRef.current);
      const alphabet: AlphabetType = source === 'wabun' || source === 'kana' ? 'wabun' : 'international';
      const nextPad = pickRandomQueuePad(source);
      setPad(nextPad);
      padRef.current = nextPad;
      const pool = queuePadList(nextPad);
      const next = randomGroup(alphabet, 18, pool, { avoidImmediateRepeat: true });
      receivedRef.current = 0;
      setSequence(next); sequenceRef.current = next; setReceived(0); setResults([]); setMetrics(null); setLastResult(null); setExitFx(null); setPadFlash(null); setPadNote(null);
      sessionIdRef.current = nowId(); evaluatorRef.current = new QueueEvaluator(Array.from(next), depthRef.current);
      const isCw = source === 'international' || source === 'wabun';
      if (isCw) {
        setAudioStatus('PLAYING');
        const handle = await audioEngine.play(next, alphabet, { ...settings, effectiveSpeed: Math.min(settings.effectiveSpeed, 14) });
        if (!activeRef.current) { handle.stop(); return; }
        playbackRef.current = handle; stimulusTimesRef.current = handle.timeline.characters.map((character) => character.end);
        timerRef.current = window.setInterval(() => {
          syncReceived(handle.receivedCount());
          if (handle.receivedCount() >= next.length && handle.currentTime() > handle.timeline.duration + 1.2) finishRef.current();
        }, 50);
        handle.finished.then(() => { if (activeRef.current) setAudioStatus('BUFFER DRAIN'); });
      } else {
        const step = 0.85; stimulusTimesRef.current = Array.from({ length: next.length }, (_, index) => (index + 1) * step);
        let count = 0;
        timerRef.current = window.setInterval(() => {
          if (!activeRef.current) return;
          if (count >= next.length) { finishRef.current(); return; }
          const symbol = next[count]; count += 1; syncReceived(count);
          if (source !== 'visual' && 'speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(source === 'phonetic' ? phonetic(symbol) : symbol); utterance.rate = 1.2; utterance.lang = source === 'kana' ? 'ja-JP' : 'en-US'; speechSynthesis.speak(utterance);
          }
        }, step * 1000);
      }
    } catch (error) {
      activeRef.current = false; setActive(false); setAudioStatus('ERROR');
      const nextPad = pickRandomQueuePad(source);
      padRef.current = nextPad;
      setPad(nextPad);
      console.error('Queue start failed', error);
    }
  };

  const acceptInput = useCallback((raw: string) => {
    if (!activeRef.current || failedRef.current) return;
    const currentPad = padRef.current;
    const pool = queuePadList(currentPad);
    const symbol = raw.slice(-1).toUpperCase();
    const inPool = pool.includes(raw) ? raw : pool.includes(symbol) ? symbol : '';
    const typed = inPool || symbol || raw;
    if (!typed.trim()) return;
    const playback = playbackRef.current;
    const liveCount = playback ? playback.receivedCount() : 0;
    const count = Math.max(liveCount, receivedRef.current);
    const answered = evaluatorRef.current?.answered ?? 0;
    const heldCount = Math.max(0, count - answered);
    if (heldCount < 1) return;
    const oldest = sequenceRef.current[answered] ?? '';
    const time = playback ? playback.currentTime() : (Date.now() - startedAtRef.current) / 1000;
    const result = evaluatorRef.current?.input(typed, count, time, stimulusTimesRef.current);
    if (!result) return;
    const token = Date.now();
    setExitFx({ symbol: oldest || result.expected, ok: result.isCorrect, token, at: heldCount - 1 });
    setPadFlash({ symbol: typed, ok: result.isCorrect, token, all: !inPool && !result.isCorrect });
    if (result.isCorrect) {
      const nextCombo = comboRef.current + 1;
      comboRef.current = nextCombo;
      setCombo(nextCombo);
      setPadNote(null);
      triggerFx('hit', `QUEUE ${result.actualDepth}`);
    } else {
      comboRef.current = 0;
      setCombo(0);
      setPadNote({ text: `×${result.input} → ${result.expected}`, kind: 'miss', token });
      triggerFx('miss', 'MISS');
    }
    window.setTimeout(() => {
      setPadFlash((current) => (current?.token === token ? null : current));
      setExitFx((current) => (current?.token === token ? null : current));
      setPadNote((current) => (current?.token === token ? null : current));
    }, result.isCorrect ? 380 : 800);
    setResults(evaluatorRef.current!.history);
    setMetrics(evaluatorRef.current!.metrics());
    setLastResult(result);
    const alphabet: AlphabetType = source === 'wabun' || source === 'kana' ? 'wabun' : 'international';
    record({
      id: nowId(), timestamp: Date.now(), alphabetType: alphabet, correctSymbol: result.expected, inputSymbol: result.input,
      characterSpeed: settings.characterSpeed, effectiveSpeed: settings.effectiveSpeed, queueTarget: depthRef.current, actualQueueDepth: result.actualDepth,
      stimulusTime: Date.now() - result.responseLatency * 1000, inputTime: Date.now(), responseLatency: result.responseLatency,
      mode: 'queue', isCorrect: result.isCorrect, isEarly: result.isEarly, sessionId: sessionIdRef.current,
    });
  }, [record, settings.characterSpeed, settings.effectiveSpeed, source, triggerFx]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const current = padRef.current;
      if (event.key === 'ArrowLeft') { event.preventDefault(); acceptInput(current.left); return; }
      if (event.key === 'ArrowUp') { event.preventDefault(); acceptInput(current.up); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); acceptInput(current.right); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); acceptInput(current.down); return; }
      if (event.key.length !== 1 || event.key === ' ') return;
      event.preventDefault();
      acceptInput(event.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, acceptInput]);

  // Held queue advances only on correct answers (misses stay on the same FIFO slot).
  const heldStart = results.reduce((count, result) => count + (result.isCorrect ? 1 : 0), 0);
  const held = Array.from(sequence).slice(heldStart, received);
  const incoming = sequence[received] ?? '—';
  const canDigest = held.length > 0;
  const overTarget = held.length > depth;
  const heldSlots = Array.from({ length: QUEUE_CAP }, (_, index) => {
    if (index >= held.length) return null;
    return held[held.length - 1 - index] ?? null;
  });
  const oldestIndex = held.length > 0 ? held.length - 1 : -1;
  const padFlashClass = (symbol: string) => {
    if (!padFlash) return '';
    if (padFlash.ok) return padFlash.symbol === symbol ? 'flash-hit' : '';
    if (padFlash.all || padFlash.symbol === symbol) return 'flash-miss';
    return '';
  };
  const heldLabel = (symbol: string) => (showHeldSymbols ? symbol : '?');
  const scoreText = metrics ? scoreQueue(metrics).toLocaleString() : '0';
  const padLocked = !active || !canDigest || failed;
  const choice = (dir: keyof QueuePad, arrow: string, label: string) => {
    const symbol = pad[dir];
    return (
      <button
        type="button"
        className={`queue-choice ${padLocked ? 'disabled' : ''} ${padFlashClass(symbol)}`}
        disabled={padLocked}
        onClick={() => acceptInput(symbol)}
        aria-label={`${label} ${symbol}`}
      >
        <small>{arrow}</small>
        <b>{symbol}</b>
      </button>
    );
  };

  return <section className="page-pad queue-page">
    <div className="page-title">
      <div>
        <p className="section-kicker">Delayed Copy</p>
        <h1>遅れ受信トレーニング</h1>
        <p>文字が次々届きます。頭の中に置いて、いちばん古いものから答えてください。{QUEUE_CAP}文字を超えると失敗です。</p>
        <ol className="queue-steps">
          <li><span className="queue-step"><Icon name="ear" size={16} />聴く</span></li>
          <li><span className="queue-step"><Icon name="queue" size={16} />覚えておく</span></li>
          <li><span className="queue-step"><Icon name="check" size={16} />古い順に答える</span></li>
        </ol>
      </div>
      <div className="queue-score">
        <span>セッション得点</span>
        <b>{scoreText}</b>
        <ComboBadge value={combo} />
      </div>
    </div>

    <div className="panel panel-pad queue-config">
      <div className="queue-field queue-field-depth">
        <span>目標の深さ <i>Goal</i></span>
        <div className="depth-buttons" role="group" aria-label="目標のキュー深さ">
          {[0, 1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              className={`${depth === value ? 'active' : ''} ${value === 3 ? 'goal' : ''}`}
              onClick={() => setDepth(value)}
              disabled={active}
              aria-pressed={depth === value}
            >
              {value}
              {value === 3 && <small>目標</small>}
            </button>
          ))}
        </div>
      </div>
      <label className="queue-field">
        <span>入力ソース</span>
        <select
          value={source}
          disabled={active}
          aria-label="入力ソース"
          onChange={(event) => {
            if (active) return;
            const nextSource = event.target.value as QueueSource;
            setSource(nextSource);
            const nextPad = pickRandomQueuePad(nextSource);
            padRef.current = nextPad;
            setPad(nextPad);
          }}
        >
          <option value="international">国際モールス · ランダム4</option>
          <option value="wabun">和文モールス · ランダム4</option>
          <option value="visual">画面表示 · ランダム4</option>
          <option value="phonetic">フォネティック · ランダム4</option>
          <option value="digits">数字 · ランダム4</option>
          <option value="kana">かな音声 · ランダム4</option>
        </select>
      </label>
      <div className="queue-field">
        <span>保持中の文字</span>
        <button type="button" className={`queue-reveal-toggle ${showHeldSymbols ? 'on' : 'off'}`} onClick={() => setShowHeldSymbols((value) => !value)} aria-pressed={showHeldSymbols}>
          {showHeldSymbols ? '表示する' : '隠す'}
        </button>
      </div>
      <button type="button" className={`btn btn-lg queue-start ${active ? 'btn-danger' : 'btn-primary'}`} onClick={() => { if (active) finish(); else void beginQueue(); }}>
        <Icon name={active ? 'stop' : 'play'} size={18} />
        {active ? 'セッション終了' : 'スタート'}
      </button>
    </div>

    {failed && (
      <div className="queue-fail" role="alert">
        <span className="queue-fail-mark" aria-hidden="true"><Icon name="x" size={20} /></span>
        <div>
          <strong>キューがあふれました</strong>
          <p>頭の中が {QUEUE_CAP} 文字を超えました。このセッションは失敗です。古いものから、もう一度やってみましょう。</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { void beginQueue(); }}>
          <Icon name="repeat" size={16} />もう一度
        </button>
      </div>
    )}

    <div className="fifo-stage">
      <div className={`fifo-column incoming ${active ? 'is-live' : ''}`}>
        <span className="fifo-label">受信<small>Incoming</small></span>
        <strong>
          <SignalPulse active={active} />
          <em className={source === 'visual' && active ? 'is-char' : ''}>{source === 'visual' ? incoming : active ? '♪' : '—'}</em>
        </strong>
        <small>{received} / {sequence.length || 18}</small>
      </div>
      <div className="fifo-arrow" aria-hidden="true">→</div>
      <div className="fifo-memory">
        <div className="fifo-memory-head">
          <span className="fifo-label">頭の中<small>Held</small></span>
          <em>{held.length}<span>/{QUEUE_CAP}</span></em>
        </div>
        <div className="fifo-slots">
          {Array.from({ length: QUEUE_CAP }, (_, index) => {
            const symbol = heldSlots[index];
            const inTarget = index < depth;
            const zone = inTarget ? 'target-zone' : 'cap-zone';
            const showExit = exitFx && index === exitFx.at;
            if (showExit && exitFx) {
              return (
                <b
                  key={`exit-${exitFx.token}`}
                  className={`filled exit-fx ${exitFx.ok ? 'ok' : 'ng fx-shake'} ${zone}`}
                >
                  {heldLabel(exitFx.symbol)}
                </b>
              );
            }
            return (
              <b
                key={index === 0 ? `arrive-${received}` : `slot-${index}`}
                className={`${symbol ? 'filled' : ''} ${index === 0 && symbol ? 'fx-pop' : ''} ${zone}`}
              >
                {symbol ? heldLabel(symbol) : '·'}
                {index === oldestIndex && symbol ? <i className="slot-next">次</i> : null}
              </b>
            );
          })}
        </div>
        <small>目標 {depth} 文字{overTarget ? ' · 超え気味。古いものから出して' : ' · 金色が目標、うしろは危険ゾーン'}{showHeldSymbols ? '' : ' · 文字は非表示'}</small>
      </div>
      <div className="fifo-arrow" aria-hidden="true">→</div>
      <div className={`fifo-column output ${canDigest && !lastResult ? 'ready' : ''} ${lastResult && !lastResult.isCorrect ? 'miss' : ''} ${lastResult?.isCorrect ? 'hit' : ''}`}>
        <span className="fifo-label">解答<small>Output</small></span>
        <strong className={lastResult ? (lastResult.isCorrect ? 'flash-hit' : 'flash-miss') : ''}>
          <FxBurst fx={fx} />
          <em>{lastResult ? lastResult.input : canDigest ? '?' : '—'}</em>
        </strong>
        <small>
          {lastResult && !lastResult.isCorrect
            ? `正解 ${lastResult.expected}`
            : canDigest
              ? (overTarget ? '急いで出そう' : lastResult?.isEarly ? '早めに出した' : 'いちばん古い文字')
              : '到着を待つ'}
        </small>
      </div>
    </div>

    <div className="queue-choice-pad" role="group" aria-label="十字キーで最古を消化">
      <span className="queue-pad-spacer" aria-hidden="true" />
      {choice('up', '↑', '上')}
      <span className="queue-pad-spacer" aria-hidden="true" />
      {choice('left', '←', '左')}
      {choice('down', '↓', '下')}
      {choice('right', '→', '右')}
    </div>
    <p className={`queue-choice-hint ${padNote ? `note-${padNote.kind}` : ''}`}>
      {padNote ? padNote.text : `矢印キー、または ${choices.join(' / ')} で、いちばん古い文字を答える`}
    </p>
    <div className={`timing-verdict ${lastResult?.isEarly && lastResult.isCorrect ? 'early' : ''} ${lastResult?.isCorrect ? 'ok' : ''} ${lastResult && !lastResult.isCorrect ? 'wrong' : ''}`}>
      {lastResult
        ? lastResult.isCorrect
          ? <><span>{lastResult.input} を出した</span><b>{lastResult.isEarly ? '早め' : `深さ ${lastResult.actualDepth}`}</b></>
          : <><span>ミス {lastResult.input}</span><b>正解 {lastResult.expected}</b></>
        : <><span>いまの状態</span><b>{failed ? '失敗' : '待機'}</b></>}
    </div>
    <div className="queue-metrics">
      <Metric label="安定深度 Stable Depth" value={metrics ? metrics.stableDepth.toFixed(1) : '—'} />
      <Metric label="安定率 Stable Rate" value={metrics ? pct(metrics.stableRate) : '—'} />
      <Metric label="早出し Early Copy" value={String(metrics?.earlyCopies ?? 0)} />
      <Metric label="取りこぼし Queue Drop" value={String(metrics?.queueDrops ?? 0)} />
      <Metric label="連打 Burst Output" value={String(metrics?.burstOutputs ?? 0)} />
      <Metric label="最長安定 Longest" value={String(metrics?.longestStableRun ?? 0)} />
    </div>
    <details className="disclosure">
      <summary>音声・間隔の設定</summary>
      <div><AudioControls settings={settings} setSettings={setSettings} /></div>
    </details>
  </section>;
}

export function phonetic(symbol: string) {
  const words: Record<string, string> = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
  return words[symbol] ?? symbol;
}
