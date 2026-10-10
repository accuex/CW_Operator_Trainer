'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MorseAudioEngine, type PlaybackHandle } from '@/lib/audio';
import { EnemyLaser } from './EnemyLaser';
import { RobotEnemy, ROBOT_MUZZLE_Y, type RobotPose } from './RobotEnemy';
import { LASER_IMPACT_Y } from '@/lib/arcade/laser';
import type { AudioSettings } from '@/lib/types';
import { answerAttack, advanceGame, beginTransmission, canAnswer, cityHp, cityMaxHp, createGame, MODES, nextAttack, nextStage, oldestAttack, pauseGame, readBest, resumeAttack, saveBest, signalCode, formationOffset, movementPose, dronePosition, batteryPosition, missilePosition, squadDrones, squadNumber, transmittingAttack, ARRIVAL_MS, type Difficulty, type GuardGame } from '@/lib/arcade/cwGuard';

export function ComputerClubView({settings,stopEpoch,setAudioStatus}:{settings:AudioSettings;stopEpoch:number;setAudioStatus:(status:string)=>void}) {
  const boardRef=useRef<HTMLDivElement>(null);
  const [layout,setLayout]=useState({wide:false,width:960,height:900});
  useEffect(()=>{
    const update=()=>{const size={wide:window.innerWidth>=900,width:boardRef.current?.clientWidth??960,height:window.innerHeight};setLayout(old=>old.wide===size.wide&&old.width===size.width&&old.height===size.height?old:size);};
    const observer=new ResizeObserver(update);if(boardRef.current) observer.observe(boardRef.current);
    window.addEventListener('resize',update);update();return()=>{observer.disconnect();window.removeEventListener('resize',update);};
  },[]);
  const fieldWidth=layout.wide?Math.max(960,layout.width*390/Math.max(260,Math.min(440,layout.height-450))):600;
  const screenX=(x:number)=>x*fieldWidth/600;
  const engine=useMemo(()=>new MorseAudioEngine(),[]);
  const [mode,setMode]=useState<Difficulty>('beginner'),[hints,setHints]=useState(true);
  const [game,setGame]=useState<GuardGame|null>(null),[best,setBest]=useState(0),[message,setMessage]=useState('');
  const state=useRef(game);state.current=game;
  const settingsRef=useRef(settings);settingsRef.current=settings;
  const clock=useRef({time:0,wall:0});
  const playback=useRef<{id:number;base:number;handle:PlaybackHandle}|null>(null);
  const live=game?.phase==='active'||game?.phase==='entering';
  const currentTime=useCallback(()=>{
    if(!['active','entering'].includes(state.current?.phase??'')) return clock.current.time;
    const audio=playback.current;
    return audio?Math.max(clock.current.time,audio.base+audio.handle.currentTime()):clock.current.time+Math.max(0,(performance.now()-clock.current.wall)/1000);
  },[]);
  useEffect(()=>{
    if(!live) return;
    let frame=0;
    clock.current.wall=performance.now();
    const tick=()=>{
      if(playback.current && engine.state!=='running'){
        engine.stop();playback.current=null;setMessage('音声が中断されました。再開すると送信中の信号を再送します。');setGame(g=>g?pauseGame(g):g);return;
      }
      const now=currentTime();clock.current={time:now,wall:performance.now()};
      setGame(g=>g?advanceGame(g,now):g);frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[live,currentTime,engine]);
  const pause=useCallback(()=>{
    const now=currentTime();engine.stop();playback.current=null;clock.current={time:now,wall:performance.now()};
    setGame(g=>g?pauseGame(advanceGame(g,now)):g);
  },[engine,currentTime]);
  useEffect(()=>{
    const hidden=()=>{if(document.hidden) pause();};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('blur',pause);
    return()=>{document.removeEventListener('visibilitychange',hidden);window.removeEventListener('blur',pause);engine.markBackground();};
  },[engine,pause]);
  useEffect(()=>{pause();},[stopEpoch,pause]);
  const tx=transmittingAttack(game),head=oldestAttack(game);
  // Preparation is visual only; exactly one engine playback owns this key.
  const audioKey=game?.phase==='active'&&tx&&(tx.status==='sending'||game.time>=tx.readyAt)?tx.id:null;
  useEffect(()=>{
    if(audioKey===null) return;
    const initial=state.current,attack=transmittingAttack(initial);
    if(!initial||!attack||attack.status!=='preparing') return;
    let cancelled=false;
    const audio={...settingsRef.current,characterSpeed:attack.wpm,effectiveSpeed:attack.wpm,reverb:false};
    void engine.play(attack.symbol,'international',audio).then(handle=>{
      if(cancelled){handle.stop();return;}
      const now=currentTime(),base=now-handle.currentTime();
      const sender=initial.drones.find(d=>d.id===attack.enemy)!;
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const origin=dronePosition(sender,reduced?0:formationOffset(now),now);
      playback.current={id:attack.id,base,handle};
      setGame(g=>g?beginTransmission(g,attack.id,handle.timeline,base,origin.x,origin.y+ROBOT_MUZZLE_Y):g);
    }).catch(()=>{if(!cancelled){setMessage('CW音が中断されました。再開すると送信中の信号を再送します。');pause();}});
    return()=>{cancelled=true;if(playback.current?.id===attack.id){engine.stop();playback.current=null;}};
  },[audioKey,engine,currentTime,pause]);
  useEffect(()=>{setAudioStatus(tx?.status==='sending'?'PLAYING':game?.phase==='paused'?'STOPPED':'READY');},[tx?.status,game?.phase,setAudioStatus]);
  useEffect(()=>{setBest(readBest(mode,hints));},[mode,hints]);
  useEffect(()=>{if(game&&['clear','over'].includes(game.phase)) setBest(saveBest(game));},[game?.phase,game?.score]);
  async function start(resume=false){
    setMessage('');
    try{
      await engine.unlock();
      const next=resume&&state.current?resumeAttack(state.current):nextAttack(createGame(mode,hints));
      clock.current={time:next.time,wall:performance.now()};setGame(next);
    }catch{setMessage('音声を有効にして、開始をもう一度押してください。');}
  }
  const choose=useCallback((index:number)=>{
    const observed=oldestAttack(state.current),letter=state.current?.squadChoices[index],now=currentTime();
    if(!observed||!letter) return;
    setGame(g=>g?answerAttack(g,observed.id,letter,now):g);
  },[currentTime]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.repeat){if(/^[1-4]$/.test(event.key)||(['Enter',' '].includes(event.key)&&(event.target as HTMLElement)?.closest('.guard-choices'))) event.preventDefault();return;}
      if(event.ctrlKey||event.altKey||event.metaKey||/^(INPUT|SELECT|TEXTAREA)$/.test((event.target as HTMLElement)?.tagName??'')) return;
      if(/^[1-4]$/.test(event.key)&&canAnswer(state.current)){event.preventDefault();choose(Number(event.key)-1);}
      if(event.key==='Escape') pause();
    };
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[choose,pause]);
  const preview=game??createGame('beginner',true,73),time=preview.time;
  const reduced=typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const offset=reduced?0:formationOffset(time),drones=squadDrones(preview),squad=squadNumber(preview),squads=preview.stage===1?4:5;
  const remaining=preview.drones.filter(d=>d.alive).length;
  const arrival=game?.phase==='entering'?Math.max(0,Math.min(1,1-(game.arrivalUntil-time)/(ARRIVAL_MS/1000))):1;
  const result=game?.result&&time-game.result.at<1.1?game.result:null;
  const label=game?.phase==='entering'?'新部隊が降下中…砲台の4文字を確認！':canAnswer(game)?`迎撃せよ！ #${head!.id} · 1–4 / タップ`:game?.phase==='active'?(time<game.retryUntil?'再装填中…':tx?.status==='sending'?'CW受信中…発射順を覚えよう':head?'次のCW送信を待とう':'次の攻撃を待とう'):'音で守る、放課後の防衛線。';
  return <section className="page-pad computer-club">
    <header className="club-heading"><div><p className="section-kicker">AFTER SCHOOL COMPUTER CLUB / GAME 01</p><h1>放課後パソコン部</h1><p>聞き取れた、その一音が迎撃になる。</p></div><span className="club-label">CW迎撃隊 <small>都市防衛 / 欧文CW</small></span></header>
    <div className="guard-console">
      <div className="guard-hud" aria-label="ゲーム状況"><span>SCORE<b>{preview.score.toLocaleString()}</b></span><span>COMBO<b className={preview.combo>=4?'guard-hot':''}>{preview.combo}<small> ×{(1+Math.min(4,Math.floor(preview.combo/4))*.25).toFixed(2)}</small></b></span><span>AMMO<b>{game?.ammo??'—'}<small> / 残敵{remaining}</small></b></span><span>WAVE<b>{preview.stage}<small> / 3 · 部隊 {squad}/{squads}</small></b></span></div>
      <div ref={boardRef} className={`guard-board ${result?.correct?'guard-hit':result?.answer?'guard-miss':''}`}>
        <svg viewBox={`0 0 ${fieldWidth} 390`} role="img" aria-label="CWOTロボット部隊、独立した街並みと4基の迎撃砲台。発射順にレーザーを迎撃します。">
          <defs><linearGradient id="guard-sky" x2="0" y2="1"><stop stopColor="#122953"/><stop offset="1" stopColor="#071427"/></linearGradient><pattern id="guard-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#537cbc" strokeOpacity=".14"/></pattern></defs>
          <rect width={fieldWidth} height="390" fill="url(#guard-sky)"/><rect width={fieldWidth} height="390" fill="url(#guard-grid)"/>
          <g className="guard-formation" data-squad={squad} data-squad-count={squads} data-arriving={game?.phase==='entering'}>{drones.map(d=>{
            const hit=preview.resolved.find(r=>r.attack.enemy===d.id&&r.status==='intercepted'),age=hit?time-hit.at:0;
            if(!d.alive&&!hit) return null;
            const p=dronePosition(d,offset,time),drop=-150*Math.pow(1-arrival,3);
            const pose:RobotPose=hit&&age>=.55?age<.75?'hit':'defeat':tx?.enemy===d.id?tx.status==='preparing'?'charge':'send':game?.phase==='entering'?'enter':movementPose(time);
            return <g key={`${preview.stage}:${d.id}`} data-enemy-id={d.id} data-enemy-alive={d.alive} transform={`translate(${screenX(p.x)} ${p.y+drop})`}>
              <RobotEnemy pose={pose} frame={Math.floor(time*8)} progress={hit?Math.min(1,Math.max(0,(age-.75)/.35)):0}/>
              {head?.enemy===d.id&&<circle className="guard-fifo-target" cy="8" r="53" fill="none" stroke="#ffd56f" strokeWidth="1.5" strokeDasharray="6 6"/>}
            </g>;
          })}</g>
          {preview.attacks.filter(a=>a.timeline&&a.startedAt!==null).map(a=><g key={a.id} data-attack-id={a.id} data-attack-state={a.status} data-head={a.id===head?.id}>
            <EnemyLaser x={screenX(a.x)} y={a.y} timeline={a.timeline!} elapsed={Math.max(0,time-a.startedAt!)} window={a.window} hints={preview.hints} phase={a.status==='sending'?'sending':'answer'} correct={false} impactProgress={0}/>
            <text x={screenX(a.x)+8} y={a.y+8} fill={a.id===head?.id?'#ffe18d':'#a9bed8'} fontSize="10">#{a.id}{a.id===head?.id?' 迎撃対象':''}</text>
          </g>)}
          <g aria-hidden="true" className="guard-city" transform={`translate(0 ${LASER_IMPACT_Y}) scale(${fieldWidth/600} 1)`}>{preview.buildings.map(b=><g key={b.id} data-building-id={b.id} data-building-hp={b.hp} transform={`translate(${b.x} 0)`}>
            <path d={b.hp===0?`M0 0V-4L${b.width*.2} -9 ${b.width*.45} -3 ${b.width*.7} -8 ${b.width} -4V0Z`:b.hp===1?`M0 0V-${b.height*.6}H${b.width*.35}L${b.width*.48} -${b.height*.35} ${b.width*.65} -${b.height*.55}H${b.width}V0Z`:`M0 0V-${b.height*.78}H${b.width*.18}V-${b.height}H${b.width*.7}V-${b.height*.85}H${b.width}V0Z`} fill={b.hp===0?'#58485a':b.hp===1?'#806477':'#275275'} stroke="#84b2ce"/>
            {b.hp>0&&<path d={`M${b.width*.15} -12h5M${b.width*.38} -${Math.min(25,b.height*.4)}h5M${b.width*.72} -14h5`} stroke={b.hp===1?'#ffac69':'#91e3ee'} strokeWidth="3"/>}
          </g>)}</g>
          <path d={`M0 ${LASER_IMPACT_Y}H${fieldWidth}`} stroke="#67abc1"/>
          {preview.resolved.filter(r=>r.status==='impacted'&&time-r.at<.65).map(r=><g key={r.attack.id} className="guard-ground-impact"><path d={`M${screenX(r.attack.x)-8} ${LASER_IMPACT_Y+5}l8-10 8 10 M${screenX(r.attack.x)-8} ${LASER_IMPACT_Y-5}l16 10`} stroke="#ffd266" strokeWidth="3" fill="none"/></g>)}
          <g className="guard-batteries" aria-hidden="true">{[0,1,2,3].map(i=><g key={i} transform={`translate(${screenX(batteryPosition(i).x)} 370)`}>
            <path d="M-24 10V-3L-14-12H14L24-3V10Z" fill="#235475" stroke="#91dbec" strokeWidth="2"/><path d="M-4-12V-27H4V-12" fill="#d2eaff"/><text textAnchor="middle" y="5" fill="#e9faff" fontSize="12">{i+1}</text>
          </g>)}</g>
          {preview.shots.map(shot=>{
            const age=time-shot.at,enemy=preview.drones.find(d=>d.id===shot.enemy),index=preview.squadChoices.indexOf(shot.selected);
            if(!enemy||index<0) return null;
            const target=dronePosition(enemy,offset,time),from={...batteryPosition(index),y:343};
            const p=missilePosition(from,{x:target.x+(shot.correct?0:42),y:target.y},Math.min(1,age/.55));
            return age<.55?<g key={shot.id} className="guard-missile" data-battery={index+1} data-shot-attack={shot.attackId}><path d={`M${screenX(from.x)} ${from.y}L${screenX(p.x)} ${p.y}`} stroke="#7cf4ff" strokeWidth="2" opacity=".6"/><circle cx={screenX(p.x)} cy={p.y} r="5" fill="#e7ffff"/></g>:shot.correct&&age<.8?<circle key={shot.id} className="guard-impact" cx={screenX(target.x)} cy={target.y} r="25" fill="none" stroke="#fff2a5" strokeWidth="3"/>:null;
          })}
        </svg>
        {(!game||['paused','clear','over'].includes(game.phase))&&<div className="guard-overlay">
          <p className="guard-overlay-kicker">{game?.phase==='clear'?'WAVE CLEAR':game?.phase==='over'?'MISSION END':game?.phase==='paused'?'PAUSED':'CW迎撃隊'}</p>
          <h2>{game?.phase==='clear'?game.stage===3?'全編隊、迎撃完了！':'編隊を突破！':game?.phase==='over'?cityHp(game)===0?'街を守りきれませんでした':'弾切れになりました':game?.phase==='paused'?'ひと休みしよう':'音を聴いて、街を守れ。'}</h2>
          <p>{game?.phase==='paused'?'飛行中のレーザーも停止。再開すると送信中だった信号だけを再送します。':'レーザーは発射順に迎撃。誤答後も着弾前なら再射撃できます。'}</p>
          {game?.phase==='clear'&&game.stage<3?<button className="btn btn-primary" onClick={()=>{void engine.unlock().then(()=>{const g=state.current;if(g){const next=nextAttack(nextStage(g));clock.current={time:next.time,wall:performance.now()};setGame(next);}}).catch(()=>setMessage('音声を有効にしてください。'));}}>次のステージへ →</button>:<button className="btn btn-primary" onClick={()=>void start(game?.phase==='paused')}>{game?.phase==='paused'?'再開する':game?'もう一度遊ぶ':'音を有効にして開始'}</button>}
          {game&&['clear','over'].includes(game.phase)&&<p>{game.correct}/{game.attempts}迎撃成功 · 最大COMBO {game.maxCombo} · BEST {best.toLocaleString()}</p>}
        </div>}
      </div>
      <div className="guard-city-status" aria-label="街の防衛状況">CITY {cityHp(preview)}/{cityMaxHp(preview)} · {preview.buildings.filter(b=>b.hp>0).length}/{preview.buildings.length}棟 · 第{squad}/{squads}部隊 <span>飛行中 {preview.attacks.filter(a=>a.startedAt!==null).length} · {head?`迎撃対象 #${head.id}`:'攻撃待ち'}</span></div>
      <div className="guard-signal"><p role="status" aria-live="polite">{label}</p><span>{tx?.wpm??head?.wpm??MODES[mode].wpm} WPM {hints?'・符号ヒントあり':'・音だけ'}</span></div>
      <div className="guard-choices" aria-label="迎撃する文字を選択">{(preview.squadChoices.length?preview.squadChoices:['E','T','A','N']).map((letter,i)=><button type="button" key={`${preview.stage}-${preview.squadRow}-${i}`} disabled={!canAnswer(game)} onClick={()=>choose(i)} aria-label={`${i+1}: ${letter}で迎撃`}><small>第{i+1}砲台 · {i+1}</small>{letter}</button>)}</div>
      <div className="guard-feedback" aria-live="polite">{result&&<span>{result.correct?`迎撃成功 +${result.points} · COMBO ${preview.combo}！`:result.answer?`#${result.attackId}着弾 · 正解 ${result.answer} ${signalCode(result.answer).replaceAll('.','・').replaceAll('-','－')}`:'誤答。再装填後に同じレーザーへ再射撃できます。'}</span>}{message&&<p role="alert">{message}</p>}</div>
      <div className="guard-controls"><label>難易度<select aria-label="難易度" value={mode} disabled={live||game?.phase==='paused'} onChange={e=>{const m=e.target.value as Difficulty;setMode(m);setHints(MODES[m].hints);setGame(null);}}>{(Object.keys(MODES) as Difficulty[]).map(m=><option key={m} value={m}>{MODES[m].label} · {m==='expert'?'22–30':`${MODES[m].wpm}–${MODES[m].wpm+4}`} WPM</option>)}</select></label><label className="guard-toggle"><input type="checkbox" checked={hints} disabled={live||game?.phase==='paused'} onChange={e=>{setHints(e.target.checked);setGame(null);}}/>符号ヒント</label><span>BEST {best.toLocaleString()}</span>{live&&<button type="button" className="btn btn-secondary" onClick={pause}>一時停止</button>}{game&&<button type="button" className="btn btn-secondary" onClick={()=>{engine.stop();playback.current=null;saveBest(game);setGame(null);setMessage('ゲームを終了しました。');}}>終了</button>}</div>
    </div>
    <details className="guard-guide"><summary>遊び方・スコアのしくみ</summary><p>4機ずつ順に登場する3ステージ。砲台の文字配置は部隊内で固定し、次部隊の登場時だけ更新します。PCは1〜4キー、スマホはタップ。TabとEnterでも操作できます。Esc・別タブへの移動で一時停止します。</p><p>CW音声は1件ずつ順番に送信します。共通送信枠が終わると次の敵が準備でき、発射済みのレーザーは同時に下降します。必ず発射番号の小さい未解決攻撃から迎撃してください。黄色い輪と「迎撃対象」が先頭の目印です。後続の文字を入力しても、判定するのは先頭です。</p><p>正解・誤答の射撃ごとに1発消費し、誤答でCOMBOがリセット。0.3秒後に再射撃できます。レーザーが街に届く前に正解すると攻撃元の敵だけを撃破します。9棟の建物はそれぞれHP2。着弾位置の建物だけが損傷し、隙間・倒壊済みの場所への着弾では他の建物を傷つけません。弾切れ、または街の全壊で終了。ウェーブ突破時は各棟のHPを1回復します。</p><p>短点・長点・空白は音声タイムライン通りの1:3:1、レーザー速度は全WPM・端末で一定です。ヒントなしでは切れ目のないビームを照射します。初級は送信枠後1.8秒、中級0.7秒、上級0.18秒を空けて次の攻撃を準備します。同じ敵は未解決攻撃を同時に2件持ちません。部隊の全滅後も未解決攻撃の処理が終わるまで次部隊は攻撃しません。</p><p>4連続正解ごとに倍率が0.25上がり、最大2倍。高速CWほど高得点、ヒントありは75%。スコアはブラウザ内に保存し、既存学習進捗・アチーブ・公開ログに加算や投稿はしません。</p></details>
  </section>;
}
