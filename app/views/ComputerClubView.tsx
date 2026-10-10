'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MorseAudioEngine, type PlaybackHandle } from '@/lib/audio';
import type { AudioSettings } from '@/lib/types';
import { answerAttack, answerSeconds, createGame, MODES, nextAttack, nextStage, openAnswer, pauseGame, readBest, resumeAttack, saveBest, signalCode, type Difficulty, type GuardGame } from '@/lib/arcade/cwGuard';

export function ComputerClubView({ settings, stopEpoch, setAudioStatus }: { settings: AudioSettings; stopEpoch: number; setAudioStatus: (status: string) => void }) {
  const engine = useMemo(() => new MorseAudioEngine(), []);
  const [mode, setMode] = useState<Difficulty>('beginner');
  const [hints, setHints] = useState(true);
  const [game, setGame] = useState<GuardGame | null>(null);
  const [best, setBest] = useState(0);
  const [clock, setClock] = useState(0);
  const [message, setMessage] = useState('');
  const handle = useRef<PlaybackHandle | null>(null);
  const state = useRef(game); state.current = game;
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const error = useRef('');
  const live = Boolean(game && ['sending','answer','feedback'].includes(game.phase));
  useEffect(() => { setBest(readBest(mode,hints)); }, [mode,hints]);
  const pause = useCallback(() => {
    engine.stop(); handle.current = null;
    setGame((g) => g ? pauseGame(g) : g);
  }, [engine]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', pause);
    return () => { document.removeEventListener('visibilitychange', hidden); window.removeEventListener('blur', pause); engine.markBackground(); };
  }, [engine,pause]);
  useEffect(() => { pause(); }, [stopEpoch, pause]);
  useEffect(() => { setAudioStatus(game?.phase === 'sending' ? 'PLAYING' : game?.phase === 'paused' ? 'STOPPED' : 'READY'); }, [game?.phase, setAudioStatus]);
  async function start(resume = false) {
    setMessage('');
    try {
      await engine.unlock();
      if (resume) setGame((g) => g ? resumeAttack(g) : g);
      else setGame(nextAttack(createGame(mode,hints)));
    } catch { setMessage('音を再生できませんでした。音声を有効にして、開始をもう一度押してください。'); }
  }
  useEffect(() => {
    if (!game || game.phase !== 'sending' || !game.attack) return;
    let cancelled = false, frame = 0;
    const id = game.attack.id;
    const symbol = game.drones.find((d) => d.id === game.attack!.enemy)!.symbol;
    handle.current = null; setClock(0);
    const audio = { ...settingsRef.current, characterSpeed: game.attack.wpm, effectiveSpeed: game.attack.wpm, reverb: false };
    void engine.play(symbol,'international',audio).then((playback) => {
      if (cancelled) { playback.stop(); return; }
      handle.current = playback;
      const tick = () => {
        if (cancelled) return;
        if (engine.state !== 'running') { setMessage('音声が中断されました。再開すると同じ信号を再送します。'); pause(); return; }
        const t = playback.currentTime(); setClock(t);
        if (t >= playback.timeline.duration) setGame((g) => g ? openAnswer(g,id) : g);
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }).catch(() => { if (!cancelled) { error.current = 'CW音を再生できませんでした。再開すると同じ信号を再送します。'; setMessage(error.current); pause(); } });
    return () => { cancelled = true; cancelAnimationFrame(frame); engine.stop(); };
  }, [engine, pause, game?.phase, game?.attack?.id, game?.stage]); // Clock advances from Web Audio, never animation timing.
  useEffect(() => {
    if (!game || game.phase !== 'answer' || !game.attack) return;
    const id = game.attack.id, start = performance.now(), duration = answerSeconds(game);
    let frame = 0;
    const tick = () => {
      const elapsed = (performance.now()-start)/1000; setClock(elapsed);
      if (elapsed >= duration) setGame((g) => g ? answerAttack(g,id,null) : g);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [game?.phase, game?.attack?.id, game?.stage]);
  useEffect(() => {
    if (game?.phase !== 'feedback') return;
    // A short custom acknowledgement, separate from the CW attack.
    const s = settingsRef.current;
    void engine.playSymbol('fx','.',{ ...s, pitch: game.result?.correct ? 1150 : 170, waveform: 'sine', characterSpeed: 60, effectiveSpeed: 60, reverb: false }).catch(() => undefined);
    const timer = setTimeout(() => setGame((g) => g ? nextAttack(g) : g), game.result?.correct ? 700 : game.mode === 'beginner' ? 1600 : 1100);
    return () => { clearTimeout(timer); engine.stop(); };
  }, [engine,game?.phase,game?.attack?.id]);
  useEffect(() => { if (game && ['clear','over'].includes(game.phase)) setBest(saveBest(game)); }, [game?.phase,game?.score]);
  const choose = useCallback((index: number) => {
    setGame((g) => g?.attack && g.phase === 'answer' ? answerAttack(g,g.attack.id,g.attack.choices[index]) : g);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.repeat || event.ctrlKey || event.altKey || event.metaKey || /^(INPUT|SELECT|TEXTAREA)$/.test((event.target as HTMLElement)?.tagName ?? '')) return;
      if (/^[1-4]$/.test(event.key) && state.current?.phase === 'answer') { event.preventDefault(); choose(Number(event.key)-1); }
      if (event.key === 'Escape') pause();
    };
    window.addEventListener('keydown',key); return () => window.removeEventListener('keydown',key);
  }, [choose,pause]);
  const target = game?.attack ? game.drones.find((d) => d.id === game.attack!.enemy) : undefined;
  const tx = target ? 115 + target.column * 122 : 300, ty = target ? 65 + target.row * 47 : 80;
  const tone = hints && game?.phase === 'sending' && handle.current ? handle.current.timeline.tones.findIndex((t) => clock >= t.start && clock < t.start+t.duration) : -1;
  const remaining = game?.drones.filter((d) => d.alive).length ?? 16;
  const phaseLabel = game?.phase === 'sending' ? 'CW受信中…最後まで聴こう' : game?.phase === 'answer' ? '迎撃せよ！ 1–4 / タップ' : game?.phase === 'feedback' ? game.result?.correct ? `迎撃成功 +${game.result.points}` : game.result?.selected ? 'ミス！ 正しい信号を確認しよう' : '時間切れ！ 信号を確認しよう' : '音で守る、放課後の防衛線。';
  const boardDrones = game?.drones ?? createGame('beginner',true,73).drones;
  return <section className="page-pad computer-club">
    <header className="club-heading"><div><p className="section-kicker">AFTER SCHOOL COMPUTER CLUB / GAME 01</p><h1>放課後パソコン部</h1><p>聞き取れた、その一音が迎撃になる。</p></div><span className="club-label">CW迎撃部 <small>仮タイトル / 欧文CW</small></span></header>
    <div className="guard-console">
      <div className="guard-hud" aria-label="ゲーム状況"><span>SCORE<b>{game?.score.toLocaleString() ?? '0'}</b></span><span>COMBO<b className={game && game.combo >= 4 ? 'guard-hot' : ''}>{game?.combo ?? 0}<small> ×{(1+Math.min(4,Math.floor((game?.combo ?? 0)/4))*.25).toFixed(2)}</small></b></span><span>AMMO<b>{game?.ammo ?? '—'}<small> / 残敵{remaining}</small></b></span><span>WAVE<b>{game?.stage ?? 1}<small> / 3</small></b></span></div>
      <div className={`guard-board ${game?.phase === 'feedback' ? game.result?.correct ? 'guard-hit' : 'guard-miss' : ''}`}>
        <svg viewBox="0 0 600 390" role="img" aria-label="光輪型通信ドローン編隊と迎撃機。敵の文字は表示しません。">
          <defs><linearGradient id="guard-sky" x2="0" y2="1"><stop stopColor="#122953"/><stop offset="1" stopColor="#071427"/></linearGradient><pattern id="guard-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#537cbc" strokeOpacity=".14"/></pattern></defs>
          <rect width="600" height="390" fill="url(#guard-sky)"/><rect width="600" height="390" fill="url(#guard-grid)"/>
          <g className={live ? 'guard-formation moving' : 'guard-formation'}>{boardDrones.map((d) => {
            const active = d.id === target?.id && (game?.phase === 'sending' || game?.phase === 'answer');
            return <g key={d.id} transform={`translate(${115+d.column*122} ${65+d.row*47})`} opacity={d.alive ? 1 : .12} className={active ? 'guard-transmitter' : ''}>
              <ellipse rx="27" ry="10" fill="none" stroke={active ? '#ffd16b' : '#62d8ed'} strokeWidth="2"/><path d="M-16 0 0-15 16 0 0 15Z" fill={active ? '#e2ae3c' : '#1c6b91'} stroke="#9debff"/><circle r="5" fill={active ? '#fff2b1' : '#9debff'}/><path d="M-23-10-28-18M23-10 28-18" stroke="#70bcde" strokeWidth="2"/>
              {active && <circle r="32" fill="none" stroke="#ffd16b" strokeDasharray="3 8" className="guard-lock"/>}
            </g>;
          })}</g>
          {(game?.phase === 'sending' || game?.phase === 'answer') && <g>
            <path d={`M${tx} ${ty+20} L300 332`} stroke={game.phase === 'answer' ? '#fe8c9c' : '#ffd16b'} strokeWidth="2" opacity=".3"/>
            {!hints && <path d={`M${tx} ${ty+20} L300 332`} stroke="#ffe092" strokeWidth="3" opacity=".6"/>}
            {game.phase === 'answer' && <circle cx={tx+(300-tx)*Math.min(1,clock/answerSeconds(game))} cy={ty+20+(312-ty)*Math.min(1,clock/answerSeconds(game))} r="8" fill="#ff8a9f" className="guard-projectile"/>}
            {hints && game.phase === 'sending' && handle.current && <g transform="translate(300 278)">{handle.current.timeline.tones.map((t,i) => <rect key={i} x={(i-(handle.current!.timeline.tones.length-1)/2)*34-8} y="0" width={t.element === '-' ? 25 : 9} height="9" rx="4" fill={i===tone ? '#ffffff' : clock >= t.start ? '#ffd16b' : '#335272'}/>)}</g>}
          </g>}
          {game?.phase === 'feedback' && game.result?.correct && <g className="guard-burst"><path d={`M300 332 L${tx} ${ty}`} stroke="#a9ffff" strokeWidth="5"/><circle cx={tx} cy={ty} r="34" fill="none" stroke="#fff2a5" strokeWidth="5"/><circle cx={tx} cy={ty} r="18" fill="#d8ffff"/></g>}
          <g transform="translate(300 343)" className="guard-ship"><path d="M0-22 23 15 8 10 0 16-8 10-23 15Z" fill="#cfedff" stroke="#5abef9" strokeWidth="2"/><path d="M-6 18 0 31 6 18" fill="#67dfff" className="guard-thrust"/><circle cy="-1" r="5" fill="#248bcf"/></g>
        </svg>
        {(!game || ['paused','clear','over'].includes(game.phase)) && <div className="guard-overlay">
          <p className="guard-overlay-kicker">{game?.phase === 'clear' ? 'WAVE CLEAR' : game?.phase === 'over' ? 'MISSION END' : game?.phase === 'paused' ? 'PAUSED' : 'CW迎撃部'}</p>
          <h2>{game?.phase === 'clear' ? game.stage===3 ? '全編隊、迎撃完了！' : '編隊を突破！' : game?.phase === 'over' ? '残弾が不足しました' : game?.phase === 'paused' ? 'ひと休みしよう' : '音を聴いて、光を放て。'}</h2>
          <p>{game?.phase === 'paused' ? '再開で同じ信号を再送。COMBOはリセットします。' : game?.phase === 'over' ? '残敵を倒す弾が足りません。受信を磨いて、もう一度。' : '正解で敵を迎撃。誤答・時間切れは弾を失います。'}</p>
          {game?.phase === 'clear' && game.stage < 3 ? <button className="btn btn-primary" onClick={() => { void engine.unlock().then(() => setGame((g) => g ? nextAttack(nextStage(g)) : g)).catch(() => setMessage('音声を有効にして再度押してください。')); }}>次のステージへ →</button> : <button className="btn btn-primary" onClick={() => void start(game?.phase === 'paused')}>{game?.phase === 'paused' ? '再開する' : game ? 'もう一度遊ぶ' : '音を有効にして開始'}</button>}
          {game && ['clear','over'].includes(game.phase) && <p>{game.correct}/{game.attempts}迎撃成功 · 最大COMBO {game.maxCombo} · BEST {best.toLocaleString()}</p>}
        </div>}
      </div>
      <div className="guard-signal"><p role="status" aria-live="polite">{phaseLabel}</p><span>{game?.attack?.wpm ?? MODES[mode].wpm} WPM {hints ? '・符号ヒントあり' : '・音だけ'}</span></div>
      <div className="guard-choices" aria-label="迎撃する文字を選択">{(game?.attack?.choices ?? ['E','T','A','N']).map((letter,i) => <button type="button" key={`${game?.attack?.id}-${i}`} disabled={game?.phase !== 'answer'} onClick={() => choose(i)} aria-label={`${i+1}: ${letter}で迎撃`}><small>{i+1}</small>{letter}</button>)}</div>
      <div className="guard-feedback" aria-live="polite">{game?.phase === 'feedback' && game.result && <span>{game.result.correct ? `COMBO ${game.combo}！` : `${game.result.selected ? `選択 ${game.result.selected} → ` : ''}正解 ${game.result.answer}　${signalCode(game.result.answer).replaceAll('.', '・').replaceAll('-', '－')}`}</span>}{message && <p role="alert">{message}</p>}</div>
      <div className="guard-controls"><label>難易度<select aria-label="難易度" value={mode} disabled={live || game?.phase === 'paused'} onChange={(e) => { const m=e.target.value as Difficulty; setMode(m); setHints(MODES[m].hints); setGame(null); }}>{(Object.keys(MODES) as Difficulty[]).map((m) => <option key={m} value={m}>{MODES[m].label} · {m === 'expert' ? '22–30' : `${MODES[m].wpm}–${MODES[m].wpm+4}`} WPM</option>)}</select></label><label className="guard-toggle"><input type="checkbox" checked={hints} disabled={live || game?.phase === 'paused'} onChange={(e) => { setHints(e.target.checked); setGame(null); }}/>符号ヒント</label><span>BEST {best.toLocaleString()}</span>{live && <button type="button" className="btn btn-secondary" onClick={pause}>一時停止</button>}{game && <button type="button" className="btn btn-secondary" onClick={() => { engine.stop(); saveBest(game); setGame(null); setMessage('ゲームを終了しました。'); }}>終了</button>}</div>
    </div>
    <details className="guard-guide"><summary>遊び方・スコアのしくみ</summary><p>敵の攻撃を最後まで聴き、4つの文字から1つを選んで迎撃。PCは1〜4キー、スマホはタップ。TabとEnterでも操作できます。Esc・別タブへの移動で一時停止します。</p><p>16体→20体→20体の3編隊。各ステージは敵の数＋8発で開始し、正解・誤答・時間切れで1発消費。4連続正解ごとに倍率が0.25上がり、最大2倍。速い信号ほど高得点、符号ヒントありは75%の得点です。ヒント別・難易度別に自己ベストを保存します。</p><p>ミスの後に正しい文字と符号を確認できます。上級は攻撃ごとに速度が変化します。重ね打ち・パイルアップは今後の拡張候補で、今回のモードには含みません。スコアはこのブラウザ専用で、学習進捗・アチーブ・公開ログへ加算や投稿はしません。</p></details>
  </section>;
}
