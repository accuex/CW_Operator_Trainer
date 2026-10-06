'use client';
/* eslint-disable react-hooks/purity */

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackHandle } from '@/lib/audio';
import { CARDS, resolveMnemonicSegments, type MorseCard } from '@/lib/morse';
import { PRACTICE_SETS, cardsForPractice, normalizeKinds, practiceSetOn, scopeSetLabel, togglePracticeSet } from '@/lib/course';
import { buildTargetCountRound, isTargetCountSymbol, resolveConfirmDistractors, type TargetCountRound } from '@/lib/targetCount';
import { applyMeterDelta, CONFIRM_METER, RECALL_METER } from '@/lib/progressMeter';
import type { AnswerLog, AudioSettings, CardProgress, TrainerProfile } from '@/lib/types';
import { audioEngine, nowId, cardKey, emptyProgress, mnemonicFor, mnemonicOptionFor, isLearned, LEARN_REPEATS, maybeMaster, masteryFor, cardStatus, CARD_STATUS_LABEL, formatCode, type View } from '@/app/trainer/shared';
import { EmptyState, ProgressBar } from '@/app/components/ui';
import { TradingCard } from '@/app/components/TradingCard';
import { MasteredReveal } from '@/app/components/CardGetReveal';
import { ComboBadge, FxBurst, SignalPulse, useFx } from '@/app/components/fx';
import { Icon, type IconName } from '@/app/components/icons';
import { playSfx } from '@/app/trainer/sfx';

export function LearnView({ settings, profile, setProfile, record, setAudioStatus, announce }: { settings: AudioSettings; profile: TrainerProfile; setProfile: React.Dispatch<React.SetStateAction<TrainerProfile>>; record: (answer: AnswerLog) => void; setAudioStatus: (status: string) => void; announce: (message: string) => void; onNavigate?: (view: View) => void }) {
  const [phase, setPhase] = useState<'discover' | 'confirm' | 'recall'>('discover');
  const [fx, triggerFx] = useFx();
  const [fxKey, setFxKey] = useState(0);
  const [combo, setCombo] = useState(0);
  const [recallPick, setRecallPick] = useState<string | null>(null);
  const unlockedKinds = normalizeKinds(profile.unlockedKinds);
  const cards = cardsForPractice(CARDS, unlockedKinds);
  const [index, setIndex] = useState(0);
  const [listenStep, setListenStep] = useState(0);
  const [activeElement, setActiveElement] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [confirmRound, setConfirmRound] = useState<TargetCountRound | null>(null);
  const [confirmGuess, setConfirmGuess] = useState<number | null>(null);
  const [confirmRevealed, setConfirmRevealed] = useState(false);
  const [recallTarget, setRecallTarget] = useState<MorseCard | null>(null);
  const [recallChoices, setRecallChoices] = useState<MorseCard[]>([]);
  const [recallRevealed, setRecallRevealed] = useState(false);
  const [masteredReveal, setMasteredReveal] = useState<{ card: MorseCard; progress: CardProgress } | null>(null);
  const playbackRef = useRef<PlaybackHandle | null>(null);
  const rafRef = useRef<number | null>(null);
  const safeIndex = cards.length ? index % cards.length : 0;
  const card = cards[safeIndex];
  const progress = card ? profile.cards[cardKey(card)] ?? emptyProgress() : emptyProgress();
  const selectedMnemonic = card ? mnemonicFor(card, progress) : '';
  const mnemonicSegments = card ? resolveMnemonicSegments(mnemonicOptionFor(card, progress), card.code) : [];
  const showMnemonics = profile.goal === 'fun';
  const showMnemonicRhythm = Boolean(showMnemonics && card?.hasMnemonic && mnemonicOptionFor(card, progress).segments?.length);
  const learnedCards = cards.filter((item) => isLearned(profile.cards[cardKey(item)]));
  const confirmDistractors = card
    ? resolveConfirmDistractors({
      target: card.symbol,
      alphabet: card.alphabet,
      learnedSymbols: learnedCards.map((item) => item.symbol),
      availableSymbols: cards.map((item) => item.symbol),
    })
    : [];
  const canConfirm = Boolean(card && isTargetCountSymbol(card.symbol) && confirmDistractors.length > 0);

  const resetConfirm = () => {
    setConfirmRound(null);
    setConfirmGuess(null);
    setConfirmRevealed(false);
  };

  const clearPlaybackMonitor = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    clearPlaybackMonitor();
    playbackRef.current?.stop();
    playbackRef.current = null;
  }, [clearPlaybackMonitor]);

  const toggleSet = (setId: (typeof PRACTICE_SETS)[number]['id']) => {
    const next = togglePracticeSet(unlockedKinds, setId);
    if (!next) {
      announce('少なくとも1つの範囲はONにしてください');
      return;
    }
    setProfile((old) => ({ ...old, unlockedKinds: next }));
    setIndex(0);
    const set = PRACTICE_SETS.find((item) => item.id === setId);
    const nowOn = set ? practiceSetOn(next, set) : false;
    announce(`${set?.label ?? setId} を${nowOn ? 'ON' : 'OFF'}にしました`);
  };

  const monitorPlayback = (handle: PlaybackHandle, repeatLimit: number, onComplete: () => void) => {
    clearPlaybackMonitor();
    playbackRef.current = handle;
    setPlaying(true);
    setAudioStatus('PLAYING');
    const tick = () => {
      const time = handle.currentTime();
      const characters = handle.timeline.characters;
      let step = 0;
      for (const character of characters) {
        if (time >= character.start) step = character.index + 1;
      }
      setListenStep(Math.min(repeatLimit, step));

      const currentCharacter = characters.find((character) => time >= character.start && time < character.end)
        ?? [...characters].reverse().find((character) => time >= character.start);
      if (currentCharacter) {
        const tonesInCharacter = handle.timeline.tones.filter((tone) => tone.start >= currentCharacter.start && tone.start < currentCharacter.end);
        const activeTone = tonesInCharacter.find((tone) => time >= tone.start && time < tone.start + tone.duration);
        setActiveElement(activeTone ? tonesInCharacter.indexOf(activeTone) : -1);
      } else {
        setActiveElement(-1);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    handle.finished.then(() => {
      clearPlaybackMonitor();
      playbackRef.current = null;
      setPlaying(false);
      setActiveElement(-1);
      setAudioStatus('READY');
      const completed = handle.currentTime() >= handle.timeline.duration - 0.05;
      if (completed) onComplete();
    });
  };

  const playDiscover = async () => {
    if (!card) return;
    const targetKey = cardKey(card);
    setListenStep(0);
    setActiveElement(-1);
    await audioEngine.unlock();
    const handle = await audioEngine.playSymbol(card.symbol, card.code, settings, LEARN_REPEATS);
    monitorPlayback(handle, LEARN_REPEATS, () => {
      setListenStep(LEARN_REPEATS);
      setProfile((old) => {
        const current = old.cards[targetKey] ?? emptyProgress();
        return {
          ...old,
          cards: {
            ...old.cards,
            [targetKey]: { ...current, exposures: (current.exposures ?? 0) + 1, reviewed: true },
          },
        };
      });
    });
  };

  const goNextCard = () => {
    if (!cards.length) return;
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setListenStep(0);
    setActiveElement(-1);
    setAudioStatus('READY');
    resetConfirm();
    setPhase('discover');
    setIndex((old) => (old + 1) % cards.length);
  };

  const goPrevCard = () => {
    if (!cards.length) return;
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setListenStep(0);
    setActiveElement(-1);
    setAudioStatus('READY');
    resetConfirm();
    setPhase('discover');
    setIndex((old) => (old - 1 + cards.length) % cards.length);
  };

  const beginConfirmRound = () => {
    if (!card || !canConfirm) return;
    const round = buildTargetCountRound({
      target: card.symbol,
      distractors: confirmDistractors,
    });
    if (!round) {
      announce('確認問題を作れません。他の文字を先に聴いてください。');
      return;
    }
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setAudioStatus('READY');
    setListenStep(0);
    setActiveElement(-1);
    setConfirmRound(round);
    setConfirmGuess(null);
    setConfirmRevealed(false);
  };

  const enterConfirm = () => {
    if (!canConfirm) {
      announce('確認問題には妨害文字が必要です。他の文字も聴いてから試してください。');
      return;
    }
    setPhase('confirm');
    beginConfirmRound();
  };

  const playConfirm = async () => {
    if (!card || !confirmRound || confirmRevealed) return;
    setListenStep(0);
    const handle = await audioEngine.play(confirmRound.text, card.alphabet, settings);
    monitorPlayback(handle, confirmRound.symbols.length, () => setListenStep(confirmRound.symbols.length));
  };

  const chooseConfirm = (guess: number) => {
    if (!card || !confirmRound || confirmRevealed) return;
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setAudioStatus('READY');
    const correct = guess === confirmRound.count;
    setConfirmGuess(guess);
    setConfirmRevealed(true);
    const targetKey = cardKey(card);
    setProfile((old) => {
      const current = old.cards[targetKey] ?? emptyProgress();
      const withMeter = applyMeterDelta(current, correct ? CONFIRM_METER.hit : CONFIRM_METER.miss);
      return {
        ...old,
        cards: {
          ...old.cards,
          [targetKey]: {
            ...withMeter,
            confirmCorrect: correct ? (current.confirmCorrect ?? 0) + 1 : current.confirmCorrect,
            reviewed: current.reviewed || (current.exposures ?? 0) > 0,
          },
        },
      };
    });
    record({
      id: nowId(), timestamp: Date.now(), alphabetType: card.alphabet,
      correctSymbol: String(confirmRound.count), inputSymbol: String(guess),
      characterSpeed: settings.characterSpeed, effectiveSpeed: settings.effectiveSpeed,
      queueTarget: 0, actualQueueDepth: 0, stimulusTime: Date.now(), inputTime: Date.now(),
      responseLatency: 0, mode: 'sound', isCorrect: correct, isEarly: false, sessionId: 'learn-confirm',
    });
    setFxKey((value) => value + 1);
    triggerFx(correct ? 'hit' : 'miss', correct ? `+${CONFIRM_METER.hit} 習得度` : 'MISS');
    playSfx(correct ? 'hit' : 'miss', settings.volume);
  };

  const beginRecallRound = () => {
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setAudioStatus('READY');
    setRecallRevealed(false);
    setRecallPick(null);
    setActiveElement(-1);
    setListenStep(0);
    if (!learnedCards.length) {
      setRecallTarget(null);
      setRecallChoices([]);
      return;
    }
    const pool = learnedCards;
    const target = pool[Math.floor(Math.random() * pool.length)];
    const distractorCount = Math.min(3, Math.max(1, pool.length - 1));
    const preferred = pool.filter((item) => item.symbol !== target.symbol);
    const filler = cards.filter((item) => item.symbol !== target.symbol && !preferred.includes(item));
    const picks = [...preferred.sort(() => Math.random() - 0.5), ...filler.sort(() => Math.random() - 0.5)].slice(0, distractorCount);
    setRecallTarget(target);
    setRecallChoices([target, ...picks].sort(() => Math.random() - 0.5));
  };

  const playRecall = async () => {
    if (!recallTarget || recallRevealed) return;
    setListenStep(0);
    const handle = await audioEngine.playSymbol(recallTarget.symbol, recallTarget.code, settings, 1);
    monitorPlayback(handle, 1, () => setListenStep(1));
  };

  const chooseRecall = (choice: MorseCard) => {
    if (!recallTarget || recallRevealed) return;
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setAudioStatus('READY');
    const target = recallTarget;
    const correct = choice.symbol === target.symbol;
    const current = profile.cards[cardKey(target)] ?? emptyProgress();
    const withMeter = applyMeterDelta(current, correct ? RECALL_METER.hit : RECALL_METER.miss);
    const updated = maybeMaster({
      ...withMeter,
      attempts: withMeter.attempts + 1,
      correct: withMeter.correct + Number(correct),
      streak: correct ? withMeter.streak + 1 : 0,
      reviewed: withMeter.reviewed || (withMeter.exposures ?? 0) > 0,
    });
    setProfile((old) => ({ ...old, cards: { ...old.cards, [cardKey(target)]: updated } }));
    record({
      id: nowId(), timestamp: Date.now(), alphabetType: target.alphabet, correctSymbol: target.symbol, inputSymbol: choice.symbol,
      characterSpeed: settings.characterSpeed, effectiveSpeed: settings.effectiveSpeed, queueTarget: 0, actualQueueDepth: 0,
      stimulusTime: Date.now(), inputTime: Date.now(), responseLatency: 0, mode: 'mnemonic', isCorrect: correct, isEarly: false, sessionId: 'learn-recall',
    });
    setRecallRevealed(true);
    setRecallPick(choice.symbol);
    setFxKey((value) => value + 1);
    const nextCombo = correct ? combo + 1 : 0;
    setCombo(nextCombo);
    triggerFx(correct ? 'hit' : 'miss', correct ? `+${RECALL_METER.hit} XP` : 'MISS');
    if (updated.mastered && !current.mastered) {
      setMasteredReveal({ card: target, progress: updated });
    } else {
      playSfx(correct ? (nextCombo >= 5 && nextCombo % 5 === 0 ? 'combo' : 'hit') : 'miss', settings.volume);
    }
  };

  const enterRecall = () => {
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setAudioStatus('READY');
    setListenStep(0);
    resetConfirm();
    setPhase('recall');
    beginRecallRound();
  };

  const backToDiscover = () => {
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setAudioStatus('READY');
    setListenStep(0);
    resetConfirm();
    setRecallTarget(null);
    setRecallChoices([]);
    setRecallRevealed(false);
    setPhase('discover');
  };

  const goToCard = (next: number) => {
    if (!cards.length) return;
    audioEngine.stop();
    clearPlaybackMonitor();
    setPlaying(false);
    setListenStep(0);
    setActiveElement(-1);
    setAudioStatus('READY');
    resetConfirm();
    setPhase('discover');
    setIndex(next);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (masteredReveal || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (phase === 'discover') {
        if (event.key === ' ' && !playing) { event.preventDefault(); void playDiscover(); }
        else if (event.key === 'ArrowRight') { event.preventDefault(); goNextCard(); }
        else if (event.key === 'ArrowLeft') { event.preventDefault(); goPrevCard(); }
      } else if (phase === 'confirm' && confirmRound) {
        if (event.key === ' ' && !playing && !confirmRevealed) { event.preventDefault(); void playConfirm(); }
        else if (/^[1-6]$/.test(event.key) && !confirmRevealed) { event.preventDefault(); chooseConfirm(Number(event.key)); }
        else if (event.key === 'Enter' && confirmRevealed) { event.preventDefault(); beginConfirmRound(); }
      } else if (phase === 'recall' && recallTarget) {
        if (event.key === ' ' && !playing && !recallRevealed) { event.preventDefault(); void playRecall(); }
        else if (/^[1-4]$/.test(event.key) && !recallRevealed) {
          const choice = recallChoices[Number(event.key) - 1];
          if (choice) { event.preventDefault(); chooseRecall(choice); }
        } else if (event.key === 'Enter' && recallRevealed) { event.preventDefault(); beginRecallRound(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const phaseIndex = phase === 'discover' ? 0 : phase === 'confirm' ? 1 : 2;
  const meter = masteryFor(progress);
  const listenRatio = (value: number, total: number) => (total ? value / total : 0);

  const steps: { id: typeof phase; title: string; hint: string; icon: IconName; disabled?: boolean }[] = [
    { id: 'discover', title: '聴く', hint: '語呂とリズム', icon: 'ear' },
    { id: 'confirm', title: '数える', hint: '混ざっても気付ける？', icon: 'target', disabled: !canConfirm },
    { id: 'recall', title: '当てる', hint: 'CARD GET 判定', icon: 'trophy' },
  ];
  const goStep = (id: typeof phase) => {
    if (id === 'discover') backToDiscover();
    else if (id === 'confirm') enterConfirm();
    else enterRecall();
  };

  const stage = !card ? null : phase === 'discover' ? (
    <div className="lesson-panel panel">
      <div className="lesson-head">
        <div>
          <p className="section-kicker">STEP 1 · LISTEN</p>
          <h2>{showMnemonics && card.hasMnemonic ? '音と語呂を結びつけよう' : '符号のリズムを体で覚えよう'}</h2>
        </div>
        <span className="chip">×{LEARN_REPEATS} 回</span>
      </div>

      <div className="lesson-symbol">
        <b>{card.symbol}</b>
        <span className="lesson-code" aria-label={`モールス符号 ${card.code}`}>
          {Array.from(card.code).map((element, elementIndex) => (
            <i key={elementIndex} className={`${element === '-' ? 'dah' : 'dit'} ${elementIndex === activeElement ? 'on' : ''}`} />
          ))}
        </span>
      </div>

      {showMnemonicRhythm && (
        <div className="mnemonic-rhythm" aria-label={`合調語 ${selectedMnemonic}`}>
          {mnemonicSegments.map((segment, segmentIndex) => (
            <b key={`${segment}-${segmentIndex}`} className={`${segmentIndex === activeElement ? 'active' : ''} ${card.code[segmentIndex] === '-' ? 'long' : 'short'}`}>{segment}</b>
          ))}
        </div>
      )}

      <div className="play-zone">
        <button type="button" className={`play-orb ${playing ? 'playing' : ''}`} onClick={() => { void playDiscover(); }} disabled={playing} aria-label="符号を再生">
          <SignalPulse active={playing} />
          <Icon name="play" size={34} />
        </button>
        <div className="play-zone-copy">
          <b>{playing ? '聴いています…' : listenStep >= LEARN_REPEATS ? 'もう一度聴く' : '再生して聴く'}</b>
          <small>{settings.pitch} Hz · 文字 {settings.characterSpeed} / 実効 {settings.effectiveSpeed} WPM · <span className="kbd">Space</span></small>
          <div className="listen-pips" aria-label={`${listenStep} / ${LEARN_REPEATS} 回`}>
            {Array.from({ length: LEARN_REPEATS }, (_, pip) => <i key={pip} className={pip < listenStep ? 'on' : ''} />)}
          </div>
        </div>
      </div>

      <div className="lesson-actions">
        <button type="button" className="btn btn-ghost" onClick={goPrevCard}><Icon name="chevron-left" size={18} />前へ</button>
        <button type="button" className="btn btn-ghost" onClick={goNextCard}>次へ<Icon name="chevron-right" size={18} /></button>
        <button type="button" className="btn btn-primary lesson-next" onClick={enterConfirm} disabled={!canConfirm}>
          確認テストへ<Icon name="chevron-right" size={18} />
        </button>
      </div>
      {!canConfirm && <p className="lesson-note">確認テストには、他の文字も少し必要です。もう何文字か聴いてから挑戦しよう。</p>}

      {showMnemonics && card.hasMnemonic && <details className="disclosure">
        <summary>語呂を選び直す</summary>
        <div className="mnemonic-options">{card.mnemonics.map((option) => (
          <button key={option.label} type="button" className={selectedMnemonic === option.label ? 'active' : ''} onClick={() => setProfile((old) => ({ ...old, cards: { ...old.cards, [cardKey(card)]: { ...progress, selectedMnemonic: option.label } } }))}>
            <span>{option.category}</span>{option.label}
          </button>
        ))}</div>
      </details>}
    </div>
  ) : phase === 'confirm' ? (
    <div className="lesson-panel panel">
      <div className="lesson-head">
        <div>
          <p className="section-kicker">STEP 2 · COUNT</p>
          <h2>「{card.symbol}」は何回聞こえた？</h2>
        </div>
        <span className="chip sky">5文字 × 2組</span>
      </div>
      <p className="lesson-lead">暗語のように5文字ずつ流れます。いま覚えた「{card.symbol}」だけを数えよう。</p>
      {!confirmRound ? (
        <EmptyState title="確認問題を作れません" body="妨害用の文字が足りません。他の文字も聴いてから戻ってきてください。" action="聴くに戻る" onClick={backToDiscover} icon="ear" />
      ) : (
        <>
          <div className="play-zone">
            <button type="button" className={`play-orb ${playing ? 'playing' : ''}`} onClick={() => { void playConfirm(); }} disabled={playing || confirmRevealed} aria-label="問題を再生">
              <SignalPulse active={playing} />
              <Icon name="play" size={34} />
            </button>
            <div className="play-zone-copy">
              <b>{playing ? '数えています…' : confirmRevealed ? '答え合わせ' : '再生して数える'}</b>
              <small>{settings.pitch} Hz · 文字 {settings.characterSpeed} / 実効 {settings.effectiveSpeed} WPM</small>
              <ProgressBar value={listenRatio(listenStep, confirmRound.symbols.length)} tone="sky" label="再生位置" />
            </div>
          </div>
          <div className="answer-zone">
            <FxBurst fx={fx} />
            <div className="count-grid" key={`count-${fxKey}`}>
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => chooseConfirm(value)}
                  disabled={confirmRevealed}
                  className={`answer-key ${confirmRevealed ? (value === confirmRound.count ? 'correct' : value === confirmGuess ? 'wrong fx-shake' : 'dim') : ''}`}
                >
                  <b>{value}</b><small>{value}</small>
                </button>
              ))}
            </div>
          </div>
          {confirmRevealed && (
            <div className={`result-card ${confirmGuess === confirmRound.count ? 'hit' : 'miss'}`} aria-live="polite">
              <div className="result-card-head">
                <span className="result-icon"><Icon name={confirmGuess === confirmRound.count ? 'check' : 'x'} size={22} /></span>
                <div>
                  <b>{confirmGuess === confirmRound.count ? 'せいかい！' : 'おしい！'}</b>
                  <small>「{confirmRound.target}」は {confirmRound.count} 回でした</small>
                </div>
              </div>
              <div className="confirm-sequence">
                {confirmRound.groups.map((group, groupIndex) => (
                  <Fragment key={`g-${groupIndex}`}>
                    {groupIndex > 0 ? <span className="confirm-gap" /> : null}
                    {group.map((symbol, symbolIndex) => (
                      <b key={`${groupIndex}-${symbolIndex}`} className={symbol === confirmRound.target ? 'target' : ''}>{symbol}</b>
                    ))}
                  </Fragment>
                ))}
              </div>
              <div className="lesson-actions">
                <button type="button" className="btn btn-ghost" onClick={beginConfirmRound}><Icon name="repeat" size={16} />もう一回</button>
                <button type="button" className="btn btn-ghost" onClick={goNextCard}>次の文字</button>
                <button type="button" className="btn btn-primary lesson-next" onClick={enterRecall}>当てるへ<Icon name="chevron-right" size={18} /></button>
              </div>
            </div>
          )}
          {!confirmRevealed && <p className="lesson-note">キーボード：<span className="kbd">Space</span> 再生 · <span className="kbd">1</span>〜<span className="kbd">6</span> で回答</p>}
        </>
      )}
    </div>
  ) : (
    <div className="lesson-panel panel">
      <div className="lesson-head">
        <div>
          <p className="section-kicker">STEP 3 · RECALL</p>
          <h2>この音は、どの文字？</h2>
        </div>
        <ComboBadge value={combo} />
      </div>
      <p className="lesson-lead">覚えた文字の中から抜き打ちで出題。連続正解でカードがGETできます。</p>
      {!learnedCards.length ? (
        <EmptyState title="まだ当てられる文字がありません" body="「聴く」→「数える」で正解すると、ここに出題されるようになります。" action="聴くに戻る" onClick={backToDiscover} icon="ear" />
      ) : (
        <>
          <div className="play-zone">
            <button type="button" className={`play-orb ${playing ? 'playing' : ''}`} onClick={() => { void playRecall(); }} disabled={playing || !recallTarget || recallRevealed} aria-label="問題を再生">
              <SignalPulse active={playing} />
              <Icon name="play" size={34} />
            </button>
            <div className="play-zone-copy">
              <b>{playing ? '聴いています…' : recallRevealed ? '答え合わせ' : '再生して当てる'}</b>
              <small>{settings.pitch} Hz · {settings.characterSpeed} WPM · <span className="kbd">Space</span> 再生 · <span className="kbd">1</span>〜<span className="kbd">4</span> 回答</small>
            </div>
          </div>
          <div className="answer-zone">
            <FxBurst fx={fx} />
            <div className="choice-grid" key={`choice-${fxKey}`}>
              {recallChoices.map((choice, choiceIndex) => (
                <button
                  key={choice.symbol}
                  type="button"
                  onClick={() => chooseRecall(choice)}
                  disabled={recallRevealed}
                  className={`answer-key big ${recallRevealed ? (choice.symbol === recallTarget?.symbol ? 'correct' : choice.symbol === recallPick ? 'wrong fx-shake' : 'dim') : ''}`}
                >
                  <b>{choice.symbol}</b><small>{choiceIndex + 1}</small>
                </button>
              ))}
            </div>
          </div>
          {recallRevealed && recallTarget && (
            <div className={`result-card ${recallPick === recallTarget.symbol ? 'hit' : 'miss'}`} aria-live="polite">
              <div className="result-card-head">
                <span className="result-icon"><Icon name={recallPick === recallTarget.symbol ? 'check' : 'x'} size={22} /></span>
                <div>
                  <b>{recallPick === recallTarget.symbol ? 'せいかい！' : `正解は「${recallTarget.symbol}」`}</b>
                  <small>{formatCode(recallTarget.code)}{showMnemonics ? `　${recallTarget.hasMnemonic ? mnemonicFor(recallTarget, profile.cards[cardKey(recallTarget)]) : recallTarget.title}` : ''}</small>
                </div>
              </div>
              <div className="recall-meter">
                <span>{recallTarget.symbol} の習得度</span>
                <ProgressBar value={masteryFor(profile.cards[cardKey(recallTarget)]) / 100} tone="gold" label="習得度" />
                <b>{masteryFor(profile.cards[cardKey(recallTarget)])}%</b>
              </div>
              <div className="lesson-actions">
                <button type="button" className="btn btn-primary lesson-next" onClick={beginRecallRound} autoFocus>次の問題<Icon name="chevron-right" size={18} /><span className="kbd">Enter</span></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );

  const shownCard = phase === 'recall' ? (recallTarget ?? card) : card;
  const shownProgress = phase === 'recall' && recallTarget ? profile.cards[cardKey(recallTarget)] : progress;

  return <section className="page-pad learn-page">
    <div className="learn-top">
      <div className="learn-course">
        <p className="section-kicker">PRACTICE SET</p>
        <h1>おぼえる</h1>
        <small>{scopeSetLabel(unlockedKinds)} · {cards.length} 文字 · {learnedCards.length} 文字 練習中</small>
      </div>
      <ol className="phase-stepper" aria-label="学習ステップ">
        {steps.map((step, stepIndex) => (
          <li key={step.id} className={`${stepIndex === phaseIndex ? 'current' : ''} ${stepIndex < phaseIndex ? 'done' : ''}`}>
            <button type="button" onClick={() => goStep(step.id)} disabled={step.disabled} aria-current={stepIndex === phaseIndex ? 'step' : undefined}>
              <span className="phase-dot"><Icon name={stepIndex < phaseIndex ? 'check' : step.icon} size={18} /></span>
              <span className="phase-text"><b>{step.title}</b><small>{step.hint}</small></span>
            </button>
          </li>
        ))}
      </ol>
    </div>

    <div className="scope-strip" role="group" aria-label="覚えるセット">
      <span>セット</span>
      {PRACTICE_SETS.map((set) => {
        const on = practiceSetOn(unlockedKinds, set);
        return (
          <button key={set.id} type="button" className={`scope-toggle ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleSet(set.id)}>
            <i>{on ? <Icon name="check" size={12} /> : null}</i>{set.label}
          </button>
        );
      })}
    </div>

    {!card ? (
      <EmptyState title="表示できるカードがありません" body="欧文・数字・記号・和文のどれかをONにしてください。" action="欧文をON" onClick={() => setProfile((old) => ({ ...old, unlockedKinds: ['latinLetter'] }))} />
    ) : (
      <>
        <div className="lesson-grid">
          <div className="lesson-card-col">
            <div className={`lesson-card-wrap ${playing ? 'playing' : ''}`}>
              <TradingCard
                key={cardKey(shownCard)}
                card={shownCard}
                progress={shownProgress}
                concealed={phase === 'recall' && !recallRevealed}
                hideMnemonic={!showMnemonics}
                interactive
                className="lesson-card"
              />
            </div>
            {phase !== 'recall' && (
              <div className="lesson-card-stats">
                <div className="meter-row">
                  <span>習得度</span>
                  <ProgressBar value={meter / 100} tone="gold" label="習得度" />
                  <b>{meter}%</b>
                </div>
                <div className="stat-chips">
                  <span className="chip"><Icon name="ear" size={14} />聴いた {progress.exposures ?? 0}</span>
                  <span className="chip"><Icon name="trophy" size={14} />当てた {progress.correct}/{progress.attempts || 0}</span>
                  <span className={`chip ${progress.mastered ? 'gold' : ''}`}>{CARD_STATUS_LABEL[cardStatus(progress)]}</span>
                </div>
              </div>
            )}
          </div>
          {stage}
        </div>

        <div className="card-strip" aria-label="カード一覧">
          {cards.map((item, itemIndex) => {
            const itemProgress = profile.cards[cardKey(item)];
            const status = cardStatus(itemProgress);
            return (
              <button
                key={cardKey(item)}
                type="button"
                className={`strip-item status-${status.toLowerCase()} ${itemIndex === safeIndex ? 'current' : ''}`}
                onClick={() => goToCard(itemIndex)}
                aria-label={`${item.symbol}（${CARD_STATUS_LABEL[status]}）`}
                aria-current={itemIndex === safeIndex ? 'true' : undefined}
              >
                <b>{item.symbol}</b>
                <i style={{ '--meter': `${masteryFor(itemProgress)}%` } as React.CSSProperties} />
              </button>
            );
          })}
        </div>
      </>
    )}
    {masteredReveal && (
      <MasteredReveal
        card={masteredReveal.card}
        progress={masteredReveal.progress}
        hideMnemonic={!showMnemonics}
        volume={settings.volume}
        onClose={() => setMasteredReveal(null)}
        onPractice={() => { void audioEngine.playSymbol(masteredReveal.card.symbol, masteredReveal.card.code, settings, 1); }}
      />
    )}
  </section>;
}

