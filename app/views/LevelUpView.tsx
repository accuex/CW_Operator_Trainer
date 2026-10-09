'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlaybackHandle } from '@/lib/audio';
import {
  KOCH_DURATIONS, KOCH_PASS_ACCURACY, applyKochResult, buildKochText, isKochCleared,
  kochBest, kochChars, kochMaxLesson, kochNewChars, kochOrder, kochProgressKey, kochProgressOf, scoreKochCopy,
  type KochDuration, type KochScore,
} from '@/lib/koch';
import { SR_EFFECTIVE_WPM, SSR_EFFECTIVE_WPM, promoteCardsForKochPass, type CardPromotion } from '@/lib/cardRarity';
import { morseFor } from '@/lib/morse';
import { romajiToWabun } from '@/lib/wabunInput';
import type { AlphabetType, AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from '@/lib/types';
import { primaryKochAlphabet } from '@/app/trainer/progress';
import { audioEngine, formatCode, nowId, pct } from '@/app/trainer/shared';
import { playSfx } from '@/app/trainer/sfx';
import { AudioControls, ProgressBar, Ring, Segmented } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';
import { Mp3Download } from '@/app/components/Mp3Download';
import { LevelUpReveal } from '@/app/components/LevelUpReveal';

type Mode = 'practice' | 'test';
type Phase = 'setup' | 'running' | 'result';
type ResultMeta = {
  lesson: number;
  isTest: boolean;
  leveledUp: boolean;
  minutes: number;
  alphabet: AlphabetType;
  promoted: CardPromotion[];
  effectiveWpm: number;
};
type Reveal = { from: number; to: number; unlocked: string[]; complete: boolean };

/** Event-handler clock; keeps Date.now out of the component body for the purity lint. */
const clock = () => Date.now();

/** 和文の記号は字面だけだと分かりにくいので名前を添える。 */
const SIGN_NAME: Record<string, string> = { '゛': '濁点', '゜': '半濁点', '、': '区切', '」': '段落', 'ー': '長音' };
const charLabel = (symbol: string) => (SIGN_NAME[symbol] ? `${symbol}（${SIGN_NAME[symbol]}）` : symbol);
const lessonLabel = (lesson: number, alphabet: AlphabetType) => kochNewChars(lesson, alphabet).map(charLabel).join(', ');

const TRACK_COPY: Record<AlphabetType, { kicker: string; title: string; lead: string; placeholder: string }> = {
  international: {
    kicker: 'Koch Method · Level Up',
    title: 'コッホ法 レベル試験',
    lead: '少ない文字から、完成した速さの音で聴き取る。',
    placeholder: '聞こえた文字をそのまま入力。区切りの空白は自由（採点では無視）。',
  },
  wabun: {
    kicker: 'Wabun Koch · Level Up',
    title: '和文コッホ レベル試験',
    lead: 'よく使う字から、まぎらわしい字を離して 1 字ずつ増やす和文版コッホ法。゛ も 1 字として聴き取る。',
    placeholder: 'ローマ字でそのまま入力（ka→カ、ga→カ゛）。@ = ゛、[ = ゜、, = 、、] = 」。かな入力も可。',
  },
};

export function LevelUpView({ settings, setSettings, profile, setProfile, record, setAudioStatus, onSession }: {
  settings: AudioSettings;
  setSettings: (settings: AudioSettings) => void;
  profile: TrainerProfile;
  setProfile: React.Dispatch<React.SetStateAction<TrainerProfile>>;
  record: (answer: AnswerLog) => void;
  setAudioStatus: (status: string) => void;
  onSession: (session: SessionRecord) => void;
}) {
  /** null = follow the course (profile loads asynchronously). */
  const [track, setTrack] = useState<AlphabetType | null>(null);
  const alphabet = track ?? primaryKochAlphabet(profile);
  const koch = kochProgressOf(profile, alphabet);
  const order = kochOrder(alphabet);
  const maxLesson = kochMaxLesson(alphabet);
  const copyText = TRACK_COPY[alphabet];
  const [mode, setMode] = useState<Mode>('test');
  /** null = follow the current level (profile loads asynchronously). */
  const [practiceLesson, setPracticeLesson] = useState<number | null>(null);
  const [minutes, setMinutes] = useState<KochDuration>(1);
  const [phase, setPhase] = useState<Phase>('setup');
  const [text, setText] = useState('');
  const [practiceAudioSettings, setPracticeAudioSettings] = useState(settings);
  const [copy, setCopy] = useState('');
  const [playProgress, setPlayProgress] = useState(0);
  const [audioDone, setAudioDone] = useState(false);
  const [score, setScore] = useState<KochScore | null>(null);
  const [resultMeta, setResultMeta] = useState<ResultMeta | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const timerRef = useRef<number | null>(null);
  const runRef = useRef(0);
  const startedAtRef = useRef(0);

  const lesson = mode === 'test' ? koch.level : Math.min(practiceLesson ?? koch.level, koch.level);
  const chars = kochChars(lesson, alphabet);
  const fresh = kochNewChars(lesson, alphabet);
  const levelBest = kochBest(koch, koch.level);
  const allCleared = isKochCleared(koch, maxLesson);

  const clearTimer = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => () => {
    runRef.current += 1;
    if (timerRef.current) window.clearInterval(timerRef.current);
    playbackRef.current?.stop();
  }, []);

  const preview = async (symbol: string) => {
    if (phase === 'running') return;
    const code = morseFor(symbol, alphabet);
    if (!code) return;
    setAudioStatus('PLAYING');
    const handle = await audioEngine.playSymbol(symbol, code, settings, 3);
    handle.finished.then(() => setAudioStatus('READY'));
  };

  const start = async () => {
    const run = runRef.current + 1;
    runRef.current = run;
    clearTimer();
    audioEngine.stop();
    const nextText = buildKochText(lesson, minutes, settings, Math.random, alphabet);
    setText(nextText);
    setPracticeAudioSettings({ ...settings });
    setCopy('');
    setScore(null);
    setResultMeta(null);
    setPlayProgress(0);
    setAudioDone(false);
    setPhase('running');
    startedAtRef.current = clock();
    setAudioStatus('PLAYING');
    try {
      const handle = await audioEngine.play(nextText, alphabet, settings);
      if (runRef.current !== run) { handle.stop(); return; }
      playbackRef.current = handle;
      const duration = Math.max(0.1, handle.timeline.duration);
      timerRef.current = window.setInterval(() => {
        setPlayProgress(Math.min(1, handle.currentTime() / duration));
      }, 200);
      handle.finished.then(() => {
        if (runRef.current !== run) return;
        clearTimer();
        setPlayProgress(1);
        setAudioDone(true);
        setAudioStatus('READY');
      });
    } catch (error) {
      console.error('Koch playback failed', error);
      setAudioStatus('ERROR');
      setAudioDone(true);
    }
  };

  const stopPlayback = () => {
    clearTimer();
    playbackRef.current?.stop();
    playbackRef.current = null;
  };

  const abort = () => {
    runRef.current += 1;
    stopPlayback();
    setAudioStatus('READY');
    setPhase('setup');
  };

  const finish = () => {
    if (phase !== 'running') return;
    runRef.current += 1;
    stopPlayback();
    setAudioStatus('READY');
    const scored = scoreKochCopy(text, copy, alphabet);
    const isTest = mode === 'test';
    const before = koch.level;
    const key = kochProgressKey(alphabet);
    const result = { lesson, accuracy: scored.accuracy, isTest };
    const now = clock();
    const pool = kochChars(lesson, alphabet);
    const effectiveWpm = Math.min(settings.effectiveSpeed, settings.characterSpeed);
    const applied = applyKochResult(profile[key], result, now, alphabet);
    const promoted = applied.cleared
      ? promoteCardsForKochPass(profile.cards, pool, alphabet, effectiveWpm, now).promoted
      : [];
    setProfile((old) => {
      const next = applyKochResult(old[key], result, now, alphabet);
      if (!next.cleared) return { ...old, [key]: next.progress };
      const { cards } = promoteCardsForKochPass(old.cards, pool, alphabet, effectiveWpm, now);
      return { ...old, [key]: next.progress, cards };
    });
    setScore(scored);
    setResultMeta({ lesson, isTest, leveledUp: applied.leveledUp, minutes, alphabet, promoted, effectiveWpm });
    setPhase('result');

    const sessionId = `koch-${nowId()}`;
    scored.cells.forEach((cell) => {
      if (cell.op === 'ins') return;
      record({
        id: nowId(), timestamp: now, alphabetType: alphabet, correctSymbol: cell.expected, inputSymbol: cell.input,
        characterSpeed: settings.characterSpeed, effectiveSpeed: settings.effectiveSpeed, queueTarget: 0, actualQueueDepth: 0,
        stimulusTime: now, inputTime: now, responseLatency: 0, mode: 'koch', isCorrect: cell.op === 'match', isEarly: false, sessionId,
      });
    });
    onSession({
      id: sessionId, startedAt: startedAtRef.current || now, endedAt: now, mode: 'koch', alphabetType: alphabet,
      answers: scored.total, accuracy: scored.accuracy,
    });

    const firstFullClear = applied.cleared && before === maxLesson && !allCleared;
    if (applied.leveledUp || firstFullClear) {
      setReveal({ from: before, to: applied.progress.level, unlocked: firstFullClear ? [] : kochNewChars(applied.progress.level, alphabet), complete: firstFullClear });
    } else {
      playSfx(scored.passed ? 'reveal' : 'miss', settings.volume);
    }
  };

  const continueAfterLevelUp = () => {
    const unlocked = reveal?.unlocked ?? [];
    setReveal(null);
    setPhase('setup');
    setMode('test');
    if (unlocked[0]) void preview(unlocked[0]);
  };

  const switchTrack = (next: AlphabetType) => {
    if (phase === 'running' || next === alphabet) return;
    setTrack(next);
    setPracticeLesson(null);
    setMode('test');
    setScore(null);
    setResultMeta(null);
    setPhase('setup');
  };

  const onCopyChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const composing = (event.nativeEvent as InputEvent).isComposing;
    setCopy(alphabet === 'wabun' && !composing ? romajiToWabun(value) : value);
  };

  const passLine = Math.round(KOCH_PASS_ACCURACY * 100);
  const perCharRows = score
    ? Object.entries(score.perChar).sort(([, a], [, b]) => b.miss / b.total - a.miss / a.total || b.total - a.total)
    : [];
  const missChars = perCharRows.filter(([, entry]) => entry.miss > 0);

  const expectedPositions: number[] = [];
  score?.cells.forEach((cell, index) => {
    const previous = index ? expectedPositions[index - 1] : 0;
    expectedPositions.push(cell.op === 'ins' ? previous : previous + 1);
  });
  const alignedCells = score?.cells.map((cell, index) => {
    const breakAfter = cell.op !== 'ins' && expectedPositions[index] % 5 === 0;
    return (
      <span key={index} className={`koch-cell ${cell.op}${breakAfter ? ' group-end' : ''}`} title={cell.op === 'match' ? undefined : `正: ${cell.expected || '—'} / 入力: ${cell.input || '—'}`}>
        <b>{cell.expected || '+'}</b>
        <small>{cell.op === 'match' ? '' : cell.input || '·'}</small>
      </span>
    );
  });

  return <section className="page-pad koch-page">
    <div className="page-title">
      <div>
        <p className="section-kicker">{copyText.kicker}</p>
        <h1>{copyText.title}</h1>
        <p>{copyText.lead}昇級試験で {passLine}% 以上なら次の文字が解放されます。実効速度は自由。</p>
      </div>
      <Segmented
        label="文字種"
        value={alphabet}
        onChange={(value) => switchTrack(value as AlphabetType)}
        options={[['international', '欧文'], ['wabun', '和文']]}
      />
    </div>

    <div className="koch-hero panel">
      <div className="koch-level">
        <Ring value={allCleared ? 1 : Math.min(1, levelBest / KOCH_PASS_ACCURACY)} size={112} stroke={9} tone={allCleared ? 'var(--mint)' : 'var(--violet)'}>
          <small>Lv.</small><b>{koch.level}</b>
        </Ring>
        <div className="koch-level-text">
          <span>{kochChars(koch.level, alphabet).length} 文字を聴き取り中 · 全 {maxLesson} レベル</span>
          <b>{allCleared ? '全レベル クリア！' : `次は「${lessonLabel(Math.min(maxLesson, koch.level + 1), alphabet)}」`}</b>
          <small>このレベルのベスト {levelBest ? pct(levelBest) : '—'} / 合格 {passLine}%</small>
        </div>
      </div>
      <ol className="koch-ladder" aria-label="解放済みの文字">
        {order.map((symbol, index) => {
          const unlockedAt = Math.max(1, index);
          const state = unlockedAt < koch.level ? 'unlocked' : unlockedAt === koch.level ? 'current' : unlockedAt === koch.level + 1 ? 'next' : 'locked';
          return (
            <li key={symbol} className={`koch-char ${state}`} title={`Lv.${unlockedAt}`}>
              {state === 'locked' ? '·' : symbol}
            </li>
          );
        })}
      </ol>
    </div>

    <div className="koch-grid">
      <div className="koch-main">
        {phase === 'setup' && (
          <div className="panel panel-pad koch-setup">
            <div className="koch-setup-row">
              <span className="koch-field-label">モード</span>
              <Segmented label="モード" value={mode} onChange={(value) => setMode(value as Mode)} options={[['test', '昇級試験'], ['practice', '練習']]} />
            </div>
            {mode === 'practice' ? (
              <label className="koch-setup-row">
                <span className="koch-field-label">レベル</span>
                <select value={lesson} onChange={(event) => setPracticeLesson(Number(event.target.value))} aria-label="練習するレベル">
                  {Array.from({ length: koch.level }, (_, index) => index + 1).map((value) => (
                    <option key={value} value={value}>Lv.{value} · {lessonLabel(value, alphabet)}（{kochChars(value, alphabet).length}文字）</option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="koch-test-note">
                <Icon name="trophy" size={16} />
                {allCleared ? '全レベル合格済み。腕試しにもう一度どうぞ。' : `Lv.${koch.level} の昇級試験。${passLine}% 以上で「${lessonLabel(koch.level + 1, alphabet)}」が解放されます。`}
                {` 合格すると出題文字のカードが R に。実効 ${SR_EFFECTIVE_WPM} WPM 以上なら SR、${SSR_EFFECTIVE_WPM} WPM 以上なら SSR へ昇格（降格なし）。`}
              </p>
            )}
            <div className="koch-setup-row">
              <span className="koch-field-label">時間</span>
              <Segmented label="時間" value={String(minutes)} onChange={(value) => setMinutes(Number(value) as KochDuration)} options={KOCH_DURATIONS.map((value) => [String(value), `${value} 分`])} />
            </div>

            <div className="koch-new">
              <span className="koch-field-label">{lesson === koch.level ? 'このレベルの新しい文字' : 'このレベルで加わった文字'}</span>
              <div className="koch-new-chars">
                {fresh.map((symbol) => (
                  <button key={symbol} type="button" className="koch-new-char" onClick={() => void preview(symbol)} aria-label={`${charLabel(symbol)} を聴く`}>
                    <b>{symbol}</b>
                    <em>{formatCode(morseFor(symbol, alphabet) ?? '')}</em>
                    <small><Icon name="volume" size={13} />聴く</small>
                  </button>
                ))}
              </div>
              <p className="koch-pool">出題: {chars.join(' ')}</p>
            </div>

            <details className="disclosure">
              <summary>速度・音の設定（文字 {settings.characterSpeed} / 実効 {settings.effectiveSpeed} WPM）</summary>
              <div><AudioControls settings={settings} setSettings={setSettings} /></div>
            </details>

            <button type="button" className="btn btn-primary btn-lg btn-block koch-start" onClick={() => void start()}>
              <Icon name="play" size={18} />{mode === 'test' ? '昇級試験をはじめる' : '練習をはじめる'}
            </button>
          </div>
        )}

        {phase === 'running' && (
          <div className="panel panel-pad koch-run">
            <div className="koch-run-head">
              <span className={`chip ${mode === 'test' ? 'koch-chip-test' : ''}`}>{mode === 'test' ? '昇級試験' : '練習'} · Lv.{lesson}</span>
              <span className={`koch-run-status ${audioDone ? 'done' : ''}`}>{audioDone ? '再生終了 — 入力を見直して採点' : `受信中 · ${minutes} 分`}</span>
            </div>
            <ProgressBar value={playProgress} tone={audioDone ? 'mint' : 'sky'} label="再生の進み具合" />
            <textarea
              className="koch-copy"
              value={copy}
              onChange={onCopyChange}
              onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); finish(); } }}
              placeholder={copyText.placeholder}
              aria-label="受信した文字"
              autoFocus
              autoCapitalize={alphabet === 'wabun' ? 'off' : 'characters'}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="koch-run-actions">
              <button type="button" className="btn btn-ghost" onClick={abort}><Icon name="x" size={16} />中止</button>
              <button type="button" className="btn btn-primary btn-lg" onClick={finish}>
                <Icon name="check" size={18} />採点する<span className="kbd">⌘/Ctrl + Enter</span>
              </button>
            </div>
          </div>
        )}

        {phase === 'result' && score && resultMeta && (
          <div className={`panel panel-pad koch-result ${score.passed ? 'pass' : 'fail'} ${resultMeta.leveledUp ? 'leveled' : ''}`}>
            <div className="koch-result-head">
              <Ring value={score.accuracy} size={120} stroke={10} tone={score.passed ? 'var(--mint)' : 'var(--coral)'}>
                <b>{Math.round(score.accuracy * 100)}</b><small>%</small>
              </Ring>
              <div className="koch-result-copy">
                <p className="section-kicker">{resultMeta.isTest ? '昇級試験' : '練習'} · Lv.{resultMeta.lesson} · {resultMeta.minutes} 分</p>
                <h2>
                  {resultMeta.leveledUp ? 'レベルアップ！'
                    : score.passed ? (resultMeta.isTest ? '合格！' : `練習で ${passLine}% 突破！`)
                    : `あと ${Math.max(1, Math.ceil((KOCH_PASS_ACCURACY - score.accuracy) * 100))}%`}
                </h2>
                <p>
                  {score.passed && !resultMeta.isTest && resultMeta.lesson === koch.level
                    ? '実力は十分。昇級試験に挑戦して、次の文字を解放しよう。'
                    : score.passed ? 'この調子で次の文字へ。'
                    : `合格ラインは ${passLine}%。ミスの多い文字を聴き直してから、もう一度。`}
                </p>
                <div className="koch-result-stats">
                  <span className="chip">正解 {score.matches} / {score.total}</span>
                  <span className="chip">誤字 {score.substitutions}</span>
                  <span className="chip">脱字 {score.deletions}</span>
                  <span className="chip">冗字 {score.insertions}</span>
                </div>
              </div>
            </div>

            {resultMeta.promoted.length > 0 && (
              <div className="koch-promoted">
                <span className="koch-field-label">カード昇格 · 実効 {resultMeta.effectiveWpm} WPM</span>
                <div className="koch-promoted-list">
                  {resultMeta.promoted.map((item) => (
                    <span key={item.key} className="koch-promoted-card" title={`${item.from ?? '未取得'} → ${item.to}`}>
                      <b>{item.symbol}</b>
                      <span className={`rarity-badge ${item.to.toLowerCase()}`}>{item.to}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {missChars.length > 0 && (
              <div className="koch-miss">
                <span className="koch-field-label">ミスの多い文字（タップで聴く）</span>
                <div className="koch-miss-list">
                  {missChars.map(([symbol, entry]) => (
                    <button key={symbol} type="button" className="koch-miss-char" onClick={() => void preview(symbol)}>
                      <b>{symbol}</b><small>{entry.miss}/{entry.total}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="koch-align" aria-label="採点の詳細">{alignedCells}</div>
            <p className="koch-legend"><i className="match" />正解 <i className="sub" />誤字 <i className="del" />脱字 <i className="ins" />冗字</p>

            <div className="koch-result-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setPhase('setup')}><Icon name="chevron-left" size={16} />設定に戻る</button>
              <button type="button" className="btn btn-primary btn-lg" onClick={() => void start()}>
                <Icon name="repeat" size={18} />{resultMeta.leveledUp ? `Lv.${koch.level} に挑戦` : 'もう一度'}
              </button>
            </div>
          </div>
        )}
      </div>

      <aside className="panel panel-pad koch-side">
        <h3><Icon name="target" size={18} /> レベル一覧</h3>
        <ol className="koch-lessons">
          {Array.from({ length: koch.level }, (_, index) => koch.level - index).map((value) => {
            const best = kochBest(koch, value);
            const cleared = isKochCleared(koch, value);
            return (
              <li key={value} className={`koch-lesson ${cleared ? 'cleared' : ''} ${value === koch.level ? 'current' : ''}`}>
                <button
                  type="button"
                  disabled={phase === 'running'}
                  onClick={() => { setMode(value === koch.level && !cleared ? 'test' : 'practice'); setPracticeLesson(value); setPhase('setup'); }}
                >
                  <span className="koch-lesson-no">Lv.{value}</span>
                  <b>{lessonLabel(value, alphabet)}</b>
                  <span className="koch-lesson-best">{best ? pct(best) : '—'}</span>
                  {cleared ? <Icon name="check" size={16} /> : <span className="koch-lesson-dot" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
    </div>

    {mode === 'practice' && <div className="koch-mp3">
      <Mp3Download label={phase === 'setup' ? '練習用MP3を作成' : 'この練習のMP3保存'} settings={phase === 'setup' ? settings : practiceAudioSettings} filename={`CWOT-Koch-${alphabet}-Lv${lesson}-${minutes}min-${(phase === 'setup' ? settings : practiceAudioSettings).effectiveSpeed}wpm`} segments={() => [{ text: phase === 'setup' ? buildKochText(lesson, minutes, settings, Math.random, alphabet) : text, alphabet }]} />
      <p>選択した文字・時間・速度で保存します。練習前は新しい問題、練習後は同じ問題の音声です。</p>
    </div>}
    {reveal && (
      <LevelUpReveal
        from={reveal.from}
        to={reveal.to}
        unlocked={reveal.unlocked}
        complete={reveal.complete}
        alphabet={alphabet}
        totalChars={order.length}
        volume={settings.volume}
        onClose={() => setReveal(null)}
        onContinue={continueAfterLevelUp}
      />
    )}
  </section>;
}
