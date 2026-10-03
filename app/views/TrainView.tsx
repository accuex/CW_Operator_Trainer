'use client';

import { useCallback, useRef, useState } from 'react';
import { summary, weakPairs } from '@/lib/analytics';
import { CARDS, alphabetSymbols } from '@/lib/morse';
import { randomCallsign, randomGroup, randomWord } from '@/lib/training';
import type { AlphabetType, AnswerLog, AudioSettings, TrainingMode } from '@/lib/types';
import { audioEngine, nowId, pct, fmtLatency } from '@/app/trainer/shared';
import { Metric, AudioControls, Segmented } from '@/app/components/ui';
import { ComboBadge, FxBurst, SignalBars, SignalPulse, useFx } from '@/app/components/fx';
import { Icon } from '@/app/components/icons';
import { playSfx } from '@/app/trainer/sfx';

const MODES: { id: TrainingMode; title: string; hint: string }[] = [
  { id: 'sound', title: '1文字', hint: '音だけで即答' },
  { id: 'transition', title: '移行', hint: '語呂ヒントつき' },
  { id: 'koch', title: 'コッホ', hint: 'レベル試験の文字' },
  { id: 'reflex', title: '反射', hint: '速さ重視' },
  { id: 'groups', title: '5字暗語', hint: 'ランダム5文字' },
  { id: 'plain', title: '普通語', hint: '3単語の文' },
  { id: 'words', title: '単語', hint: '1単語' },
  { id: 'callsigns', title: 'コールサイン', hint: 'JA1ABC など' },
  { id: 'weak-pair', title: '苦手ペア', hint: '取り違え集中' },
  { id: 'custom', title: 'カスタム', hint: '好きな文' },
];

/** Hiragana typed through an IME is accepted as katakana for Wabun answers. */
const toKatakana = (value: string) => value.replace(/[\u3041-\u3096]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60));

const speedGrade = (ms: number) => (ms < 700 ? 'PERFECT!' : ms < 1400 ? 'GREAT!' : 'GOOD');

export function TrainView({ settings, setSettings, record, setAudioStatus, answers, kochPool }: { settings: AudioSettings; setSettings: (settings: AudioSettings) => void; record: (answer: AnswerLog) => void; setAudioStatus: (status: string) => void; answers: AnswerLog[]; kochPool: string[] }) {
  const [alphabet, setAlphabet] = useState<AlphabetType>('international');
  const [mode, setMode] = useState<TrainingMode>('sound');
  const [symbol, setSymbol] = useState('K');
  const [input, setInput] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null);
  const [resultLatency, setResultLatency] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [sessionAnswers, setSessionAnswers] = useState<AnswerLog[]>([]);
  const [customText, setCustomText] = useState('CQ CQ DE JA1CW');
  const [hintVisible, setHintVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [fx, triggerFx] = useFx();
  const inputRef = useRef<HTMLInputElement>(null);

  const nextSymbol = useCallback(() => {
    const symbols = alphabetSymbols(alphabet).filter((item) => alphabet === 'wabun' || /^[A-Z0-9]$/.test(item));
    return symbols[Math.floor(Math.random() * symbols.length)];
  }, [alphabet]);
  const play = async (chosen = nextSymbol()) => {
    setSymbol(chosen); setInput(''); setResult(null); setHintVisible(false); setStartedAt(performance.now()); setAudioStatus('PLAYING');
    setPlaying(true); setHasPlayed(true);
    const handle = await audioEngine.play(chosen, alphabet, settings);
    handle.finished.then(() => { setPlaying(false); setAudioStatus('READY'); inputRef.current?.focus(); });
  };
  const submit = () => {
    if (!input.trim()) return;
    const correct = input.trim().toUpperCase() === symbol;
    const latencyMs = performance.now() - startedAt;
    const timestamp = Date.now();
    const log: AnswerLog = { id: nowId(), timestamp, alphabetType: alphabet, correctSymbol: symbol, inputSymbol: input.trim().toUpperCase(), characterSpeed: settings.characterSpeed, effectiveSpeed: settings.effectiveSpeed, queueTarget: 0, actualQueueDepth: 0, stimulusTime: timestamp - latencyMs, inputTime: timestamp, responseLatency: latencyMs / 1000, mode, isCorrect: correct, isEarly: false, sessionId: 'sound-live' };
    record(log); setSessionAnswers((old) => [...old, log]); setResult(correct ? 'correct' : 'wrong'); setResultLatency(latencyMs); setStreak((old) => correct ? old + 1 : 0);
    const nextStreak = correct ? streak + 1 : 0;
    if (nextStreak > bestStreak) setBestStreak(nextStreak);
    if (correct) {
      triggerFx('hit', speedGrade(latencyMs));
    } else {
      triggerFx('miss', 'MISS');
    }
    if (!playing) playSfx(correct ? (nextStreak >= 5 && nextStreak % 5 === 0 ? 'combo' : 'hit') : 'miss', settings.volume);
  };
  const stats = summary(sessionAnswers);
  const pair = weakPairs(answers.filter((answer) => answer.alphabetType === alphabet))[0];
  const promptForMode = () => {
    if (mode === 'groups') return randomGroup(alphabet, 5);
    if (mode === 'plain') return Array.from({ length: 3 }, () => randomWord(alphabet)).join(' ');
    if (mode === 'words') return randomWord(alphabet);
    if (mode === 'callsigns') return randomCallsign();
    if (mode === 'custom') return customText || 'CQ';
    if (mode === 'weak-pair' && pair) return Math.random() < .8 ? (Math.random() < .5 ? pair.a : pair.b) : nextSymbol();
    if (mode === 'koch') return randomGroup(alphabet, 1, alphabet === 'wabun' ? ['イ','ロ','ハ','ニ','ホ','ヘ'] : kochPool);
    return nextSymbol();
  };
  const longAnswer = ['groups','plain','words','callsigns','custom'].includes(mode);
  const hintCard = CARDS.find((card) => card.alphabet === alphabet && card.symbol === symbol);
  const onInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = alphabet === 'wabun' ? toKatakana(event.target.value) : event.target.value;
    const composing = (event.nativeEvent as InputEvent).isComposing;
    setInput(longAnswer ? raw.toUpperCase() : composing ? raw : raw.slice(-1));
  };

  return <section className="page-pad train-page">
    <div className="page-title">
      <div>
        <p className="section-kicker"><Icon name="ear" size={14} />SOUND TRAINING</p>
        <h1>音から、直接文字へ。</h1>
        <p>符号は見せません。完成したリズムを聴いて、頭に浮かんだ文字をすぐ入力しよう。</p>
      </div>
      <Segmented label="文字種" value={alphabet} options={[['international', '欧文'], ['wabun', '和文']]} onChange={(value) => { setAlphabet(value as AlphabetType); setSymbol(value === 'wabun' ? 'イ' : 'K'); }} />
    </div>

    <div className="train-modes" role="group" aria-label="練習モード">
      {MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`train-mode ${mode === item.id ? 'active' : ''}`}
          aria-pressed={mode === item.id}
          onClick={() => { setMode(item.id); setResult(null); setHintVisible(false); }}
        >
          <b>{item.title}</b><small>{item.hint}</small>
        </button>
      ))}
    </div>
    {mode === 'custom' && <div className="custom-source"><label>練習する文<input value={customText} onChange={(event) => setCustomText(event.target.value.toUpperCase())} /></label></div>}

    <div className="train-workspace">
      <div className="train-stage panel">
        <div className="train-stage-top">
          <span className="chip sky"><SignalBars active={playing} count={7} />{settings.characterSpeed} WPM</span>
          <ComboBadge value={streak} />
        </div>

        <div className={`train-orb ${result ?? ''} ${playing ? 'playing' : ''}`}>
          <SignalPulse active={playing} />
          <FxBurst fx={fx} />
          <span className="train-orb-face" key={`${symbol}-${result}`}>
            {result ? <b className={longAnswer ? 'long' : ''}>{symbol}</b> : playing ? <Icon name="ear" size={56} /> : <Icon name="volume" size={52} />}
          </span>
        </div>

        <p className="train-status">
          {playing ? '聴いて…' : result === 'correct' ? `せいかい！ ${Math.round(resultLatency)} ms` : result === 'wrong' ? `正解は「${symbol}」` : hasPlayed ? '聞こえた文字を入力' : '再生ボタンでスタート'}
        </p>

        <form onSubmit={(event) => { event.preventDefault(); if (result && !input.trim()) { void play(promptForMode()); return; } submit(); }} className={`answer-form ${longAnswer ? 'long' : ''}`}>
          <input
            ref={inputRef}
            value={input}
            onChange={onInput}
            aria-label="聞こえた文字"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={longAnswer ? '聞こえた文を入力' : '文字'}
          />
          <button type="submit" className="btn btn-success">{result && !input.trim() ? '次へ' : '答える'}<span className="kbd">Enter</span></button>
        </form>

        <div className="train-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={() => { void play(promptForMode()); }} disabled={playing}>
            <Icon name="play" size={18} />{hasPlayed ? '次の問題' : 'スタート'}
          </button>
          {mode === 'transition' && !result && hasPlayed && <button type="button" className="btn btn-ghost" onClick={() => setHintVisible(true)}><Icon name="sparkle" size={16} />語呂ヒント</button>}
        </div>
        {mode === 'transition' && hintVisible && hintCard && <div className="transition-hint"><Icon name="sparkle" size={16} />{hintCard.title}<small>音を聴いた後だけ表示しています</small></div>}
        <p className="train-keys">回答後に <span className="kbd">Enter</span> で次の問題へ</p>
      </div>

      <aside className="train-side">
        <div className="panel panel-pad">
          <div className="panel-head"><h3>このセッション</h3><small>{sessionAnswers.length} 問</small></div>
          <div className="train-metrics">
            <Metric label="正答率" value={sessionAnswers.length ? pct(stats.accuracy) : '—'} />
            <Metric label="反応時間" value={fmtLatency(stats.medianLatency)} />
            <Metric label="コンボ" value={String(streak)} />
            <Metric label="ベスト" value={String(bestStreak)} />
          </div>
        </div>
        <div className="panel panel-pad">
          <div className="panel-head"><h3>音の設定</h3></div>
          <AudioControls settings={settings} setSettings={setSettings} />
        </div>
      </aside>
    </div>
  </section>;
}
