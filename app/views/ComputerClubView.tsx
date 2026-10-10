'use client';
import { useCallback, useEffect, useMemo, useLayoutEffect, useRef, useState } from 'react';
import { MorseAudioEngine, type PlaybackHandle } from '@/lib/audio';
import { EnemyLaser } from './EnemyLaser';
import { BossEnemy, BOSS_MUZZLE_Y } from './BossEnemy';
import { RobotEnemy, ROBOT_MUZZLE_Y, type RobotPose } from './RobotEnemy';
import { PRESETS, type Preset } from '@/lib/arcade/presets';
import { GameMusic } from '@/lib/arcade/music';
import { recordGameTransition } from '@/lib/arcade/gameAchievements';
import { LASER_IMPACT_Y } from '@/lib/arcade/laser';
import type { AudioSettings } from '@/lib/types';
import { BOSS_BONUS, bossDrone, enemyPosition, livePhase, answerAttack, advanceGame, beginTransmission, canAnswer, cityHp, cityMaxHp, createGame, nextAttack, oldestAttack, pauseGame, readBest, resumeAttack, saveBest, signalCode, movementPose, batteryPosition, missilePosition, squadDrones, squadNumber, transmittingAttack, ARRIVAL_MS, type Difficulty, type GuardGame } from '@/lib/arcade/cwGuard';

const robotScale=(count:number)=>Math.min(.8,(400/(count-1)-12)/112);
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
  const [wpm,setWpm]=useState(8),[preset,setPreset]=useState<Preset>('letters'),[hints,setHints]=useState(true);
  const mode:Difficulty=wpm<15?'beginner':wpm<22?'standard':'expert';
  const [cwVolume,setCwVolume]=useState(1),[musicVolume,setMusicVolume]=useState(.08);
  const audioElement=useRef<HTMLAudioElement>(null);
  const music=useMemo(()=>new GameMusic(),[]);
  const [game,setGame]=useState<GuardGame|null>(null),[best,setBest]=useState(0),[message,setMessage]=useState('');
  useEffect(()=>{music.attach(audioElement.current);},[music]);
  const previousGame=useRef<GuardGame|null>(null);
  useEffect(()=>{recordGameTransition(previousGame.current,game);previousGame.current=game;},[game]);
  useEffect(()=>{if(game?.phase==='warning')music.warning();},[game?.phase,music]);
  const musicPaused=game?.phase==='paused';
  const musicPlaying=Boolean(game&&(game.boss||game.phase==='warning')&&livePhase(game.phase)&&game.phase!=='defeating');
  useEffect(()=>{
    if(musicPaused){music.pause();return;}
    if(musicPlaying)void music.play(musicVolume).catch(()=>setMessage('BGMを再生できませんでした。「BGM再生」で再試行できます。'));
    else music.stop();
  },[musicPlaying,musicPaused,music,musicVolume]);
  useEffect(()=>()=>music.dispose(),[music]);
  const state=useRef(game);
  useLayoutEffect(()=>{state.current=game;},[game]);
  const settingsRef=useRef(settings);
  useLayoutEffect(()=>{settingsRef.current={...settings,volume:settings.volume*cwVolume};},[settings,cwVolume]);
  const clock=useRef({time:0,wall:0});
  const playback=useRef<{id:number;base:number;handle:PlaybackHandle}|null>(null);
  const live=livePhase(game?.phase);
  const currentTime=useCallback(()=>{
    if(!livePhase(state.current?.phase)) return clock.current.time;
    const audio=playback.current;
    return audio?Math.max(clock.current.time,audio.base+(audio.handle.timelineTime?.()??audio.handle.currentTime())):clock.current.time+Math.max(0,(performance.now()-clock.current.wall)/1000);
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
  const seenStopEpoch=useRef(stopEpoch);
  useEffect(()=>{if(seenStopEpoch.current===stopEpoch)return;seenStopEpoch.current=stopEpoch;const frame=requestAnimationFrame(pause);return()=>cancelAnimationFrame(frame);},[stopEpoch,pause]);
  const tx=transmittingAttack(game),head=oldestAttack(game);
  // Preparation is visual only; exactly one engine playback owns this key.
  const audioKey=game?.phase==='active'&&tx&&(tx.status==='sending'||game.time>=tx.readyAt)?tx.id:null;
  useEffect(()=>{
    if(audioKey===null) return;
    const initial=state.current,attack=transmittingAttack(initial);
    if(!initial||!attack||attack.status!=='preparing') return;
    let cancelled=false;
    const audio={...settingsRef.current,characterSpeed:attack.wpm,effectiveSpeed:attack.wpm,reverb:false};
    void engine.play(attack.symbol,PRESETS[initial.preset].alphabet,audio).then(handle=>{
      if(cancelled){handle.stop();return;}
      const now=currentTime(),base=now-(handle.timelineTime?.()??handle.currentTime());
      const sender=initial.drones.find(d=>d.id===attack.enemy)!;
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const origin=enemyPosition(initial,sender,now,reduced);
      playback.current={id:attack.id,base,handle};
      setGame(g=>g?beginTransmission(g,attack.id,handle.timeline,base,origin.x,origin.y+(initial.boss?BOSS_MUZZLE_Y:ROBOT_MUZZLE_Y*robotScale(initial.enemiesPerSquad))):g);
    }).catch(()=>{if(!cancelled){setMessage('CW音が中断されました。再開すると送信中の信号を再送します。');pause();}});
    return()=>{cancelled=true;if(playback.current?.id===attack.id){engine.stop();playback.current=null;}};
  },[audioKey,engine,currentTime,pause]);
  useEffect(()=>{setAudioStatus(tx?.status==='sending'?'PLAYING':game?.phase==='paused'?'STOPPED':'READY');},[tx?.status,game?.phase,setAudioStatus]);
  const recordPhase=game?.phase,recordScore=game?.score,practice=game?.bossOnly??false;
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>{
      const current=state.current;
      setBest(current&&['clear','over'].includes(current.phase)?saveBest(current):readBest(mode,practice?false:hints,practice,{wpm,preset}));
    });return()=>cancelAnimationFrame(frame);
  },[mode,hints,wpm,preset,practice,recordPhase,recordScore]);
  async function start(resume=false,bossOnly=false){
    setMessage('');
    try{
      // Prime the element within the actual start gesture; failure never blocks CW.
      if(!resume)void music.unlock().catch(()=>{});
      await engine.unlock();
      const next=resume&&state.current?resumeAttack(state.current):bossOnly?{...createGame(mode,hints,undefined,{wpm,preset}),stage:3,phase:'warning' as const,transitionUntil:2.6,bossOnly:true,drones:[],attacks:[]}:nextAttack(createGame(mode,hints,undefined,{wpm,preset}));
      clock.current={time:next.time,wall:performance.now()};setGame(next);
    }catch{setMessage('音声を有効にして、開始をもう一度押してください。');}
  }
  const lastInput=useRef(-Infinity);
  const choose=useCallback((index:number)=>{
    // Suppress duplicated pointer/key events, without waiting for missile arrival.
    const wall=performance.now();if(wall-lastInput.current<65)return;lastInput.current=wall;
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
  const preview=game??createGame(mode,hints,73,{wpm,preset}),time=preview.time;
  const patternLabel={single:'単発',double:'2連送',triple:'3連送',spread:'拡散（1回答）',charge:'チャージ',rapid:'高速3連送'};
  const reduced=typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const drones=squadDrones(preview),squad=squadNumber(preview),squads=preview.stage===1?4:5;
  const remaining=preview.drones.filter(d=>d.alive).length,boss=preview.boss,bossUnit=boss?bossDrone(preview)!:null;
  const defeatAge=boss?.defeatedAt!==null&&boss?.defeatedAt!==undefined?time-boss.defeatedAt:0;
  const arrival=game?.phase==='entering'?Math.max(0,Math.min(1,1-(game.arrivalUntil-time)/(ARRIVAL_MS/1000))):1;
  const result=game?.result&&time-game.result.at<1.1?game.result:null;
  const label=game?.phase==='warning'?'WARNING · BOSS APPROACHING':game?.phase==='intermission'?`STAGE ${game.stage} CLEAR · 次のSTAGEへ`:game?.phase==='awakening'?'SIGNAL OVERDRIVE · 弾薬補給 +10':game?.phase==='rekeying'?'新しい4文字へ切替中…':game?.phase==='defeating'?'BOSS DEFEATED · +5,000':game?.phase==='entering'?(boss?'大型ボス接近中…4文字を確認！':'新部隊が降下中…砲台の4文字を確認！'):canAnswer(game)?`迎撃せよ！ #${head!.id} · 1–4 / タップ`:game?.phase==='active'?(time<game.retryUntil?'再装填中…':tx?.status==='sending'?'CW受信中…発射順を覚えよう':head?'次のCW送信を待とう':'次の攻撃を待とう'):'音で守る、放課後の防衛線。';
  return <section className="page-pad computer-club">
    <header className="club-heading"><div><p className="section-kicker">AFTER SCHOOL COMPUTER CLUB / GAME 01</p><h1>放課後パソコン部</h1><p>聞き取れた、その一音が迎撃になる。</p></div><span className="club-label">CW迎撃隊 <small>都市防衛 / {PRESETS[preset].label}</small></span></header>
    <div className="guard-console">
      <div className="guard-hud" aria-label="ゲーム状況"><span>SCORE<b>{preview.score.toLocaleString()}</b></span><span>COMBO<b className={preview.combo>=4?'guard-hot':''}>{preview.combo}<small> ×{(1+Math.min(4,Math.floor(preview.combo/4))*.25).toFixed(2)}</small></b></span><span>AMMO<b>{game?.ammo??'—'}<small> / 残敵{remaining}</small></b></span><span>{boss?'BOSS':'STAGE'}<b>{boss?bossUnit!.hp:preview.stage}<small>{boss?' / 100':` / 3 · 部隊 ${squad}/${squads}`}</small></b></span></div>
      <div ref={boardRef} className={`guard-board ${result?.correct?'guard-hit':result?.answer?'guard-miss':''}`}>
        <svg viewBox={`0 0 ${fieldWidth} 390`} role="img" aria-label="CWOTロボット部隊、独立した街並みと4基の迎撃砲台。発射順にレーザーを迎撃します。">
          <defs><linearGradient id="guard-sky" x2="0" y2="1"><stop stopColor="#122953"/><stop offset="1" stopColor="#071427"/></linearGradient><pattern id="guard-grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#537cbc" strokeOpacity=".14"/></pattern></defs>
          <rect width={fieldWidth} height="390" fill="url(#guard-sky)"/><rect width={fieldWidth} height="390" fill="url(#guard-grid)"/>
          <g className="guard-formation" data-squad={squad} data-squad-count={boss?1:squads} data-arriving={game?.phase==='entering'}>{drones.map(d=>{
            const hit=preview.resolved.findLast(r=>r.attack.enemy===d.id&&r.status==='intercepted'),age=hit?time-hit.at:0;
            if(!d.alive&&!hit&&!(boss&&game?.phase==='defeating')) return null;
            const p=enemyPosition(preview,d,time,reduced),drop=-150*Math.pow(1-arrival,3);
            const pose:RobotPose=hit&&age>=.55?(d.alive?'hit':age<.75?'hit':'defeat'):tx?.enemy===d.id?tx.status==='preparing'?'charge':'send':game?.phase==='entering'?'enter':movementPose(time);
            return <g key={`${preview.stage}:${d.id}`} data-enemy-id={d.id} data-enemy-alive={d.alive} data-enemy-hp={d.hp} data-enemy-max-hp={d.maxHp} transform={`translate(${screenX(p.x)} ${p.y+drop})`}>
              {boss?<BossEnemy form={boss.form} frame={Math.floor(time*6)} pose={game?.phase==='defeating'?'defeat':game?.phase==='awakening'?'awakening':hit&&age>=.55?'hit':tx?.enemy===d.id?tx.status==='preparing'?'charge':'send':'idle'} age={game?.phase==='defeating'?defeatAge:age}/>:<g transform={hit&&d.alive&&age>=.55?`translate(${Math.sin(age*60)*3} 0)`:undefined}><g transform={`scale(${robotScale(preview.enemiesPerSquad)})`}><RobotEnemy pose={pose} frame={Math.floor(time*8)+d.column} progress={hit?Math.min(1,Math.max(0,(age-.75)/.35)):0}/></g></g>}
              {!boss&&d.alive&&d.hp<d.maxHp&&<g aria-hidden="true" opacity=".35"><ellipse cx="-16" cy="-38" rx="6" ry="9" fill="#b5bfd4"/><ellipse cx="-19" cy="-51" rx="8" ry="6" fill="#9eacc2"/></g>}
              {!boss&&d.maxHp>1&&<g className={hit?'guard-hp-hit':''} transform="translate(-24 -52)" aria-label={`敵HP ${d.hp}/${d.maxHp}`}><rect width="48" height="5" rx="2" fill="#071427" stroke="#91bddd"/><rect width={48*d.hp/d.maxHp} height="5" rx="2" fill={d.hp/d.maxHp>.5?'#7be5e1':'#ffbf68'}/></g>}
              {!boss&&head?.enemy===d.id&&<circle className="guard-fifo-target" cy="8" r={53*robotScale(preview.enemiesPerSquad)} fill="none" stroke="#ffd56f" strokeWidth="1.5" strokeDasharray="6 6"/>}
            </g>;
          })}</g>
          {boss&&<g className="guard-boss-health" role="img" aria-label={`ボスHP ${bossUnit!.hp}/100、${boss.form==='normal'?'第1形態':boss.form==='final'?'最終局面':'覚醒形態'}`}>
            <text x="20" y="15" fill="#ffbcb2" fontSize="11">SIGNAL MASTER · {boss.form==='normal'?'PHASE 1':boss.form==='final'?'FINAL':'OVERDRIVE'} · {bossUnit!.hp}/100</text>
            <rect x="20" y="21" width={fieldWidth-40} height="6" rx="2" fill="#3c283d"/>
            <rect x="20" y="21" width={(fieldWidth-40)*bossUnit!.hp/100} height="6" rx="2" fill={boss.form==='normal'?'#82d7ff':'#ff6654'}/>
          </g>}
          {preview.attacks.filter(a=>a.timeline&&a.startedAt!==null).map(a=><g key={a.id} data-attack-id={a.id} data-attack-state={a.status} data-head={a.id===head?.id}>
            {a.beamOffsets.map((dx,i)=><EnemyLaser key={i} x={screenX(a.x+dx)} y={a.y} timeline={a.timeline!} elapsed={Math.max(0,time-a.startedAt!)} window={a.window} hints={boss?false:preview.hints} tone={boss?'red':'gold'} phase={a.status==='sending'?'sending':'answer'} correct={false} impactProgress={0}/>)}
            <text x={screenX(a.x)+8} y={a.y+8} fill={a.id===head?.id?'#ffe18d':'#a9bed8'} fontSize="10">#{a.id}{a.id===head?.id?' 迎撃対象':''}</text>
          </g>)}
          {game?.phase==='warning'&&<g className="guard-warning"><rect width={fieldWidth} height="390" fill="#170814" opacity=".85"/><path d={`M0 165H${fieldWidth}M0 244H${fieldWidth}`} stroke="#ff6257" strokeWidth="3"/><text x={fieldWidth/2} y="195" textAnchor="middle" fill="#ff8075" fontSize="30" fontWeight="900">WARNING</text><text x={fieldWidth/2} y="224" textAnchor="middle" fill="#fff2ed" fontSize="16">BOSS APPROACHING</text></g>}
          {game?.phase==='intermission'&&<text x={fieldWidth/2} y="220" textAnchor="middle" fill="#a7e9ff" fontSize="26">STAGE {game.stage} CLEAR</text>}
          {game?.phase==='awakening'&&<g className="guard-overdrive"><rect width={fieldWidth} height="390" fill="#090a22" opacity=".5"/><text x={fieldWidth/2} y="205" textAnchor="middle" fill="#ff8c82" fontSize="24" fontWeight="800">SIGNAL OVERDRIVE</text><text x={fieldWidth/2} y="226" textAnchor="middle" fill="#ffffff" fontSize="13">装甲展開中 · 弾薬 +10</text></g>}
          {game?.phase==='rekeying'&&<text x={fieldWidth/2} y="220" textAnchor="middle" fill="#ffe18d" fontSize="20">KEY SET UPDATE</text>}
          {game?.phase==='defeating'&&<text x={fieldWidth/2} y="248" textAnchor="middle" fill="#ffe18d" fontSize="24" fontWeight="800">BOSS DEFEATED</text>}
          <g aria-hidden="true" className="guard-city" transform={`translate(0 ${LASER_IMPACT_Y}) scale(${fieldWidth/600} 1)`}>{preview.buildings.map(b=><g key={b.id} data-building-id={b.id} data-building-hp={b.hp} transform={`translate(${b.x} 0)`}>
            <path d={b.hp===0?`M0 0V-4L${b.width*.2} -9 ${b.width*.45} -3 ${b.width*.7} -8 ${b.width} -4V0Z`:b.hp<b.maxHp?`M0 0V-${b.height*.6}H${b.width*.35}L${b.width*.48} -${b.height*.35} ${b.width*.65} -${b.height*.55}H${b.width}V0Z`:`M0 0V-${b.height*.78}H${b.width*.18}V-${b.height}H${b.width*.7}V-${b.height*.85}H${b.width}V0Z`} fill={b.hp===0?'#58485a':b.hp<b.maxHp?'#806477':'#275275'} stroke="#84b2ce"/>
            {b.hp>0&&<path d={`M${b.width*.15} -12h5M${b.width*.38} -${Math.min(25,b.height*.4)}h5M${b.width*.72} -14h5`} stroke={b.hp<b.maxHp?'#ffac69':'#91e3ee'} strokeWidth="3"/>}
          </g>)}</g>
          <path d={`M0 ${LASER_IMPACT_Y}H${fieldWidth}`} stroke="#67abc1"/>
          {preview.resolved.filter(r=>r.status==='impacted'&&time-r.at<.65).flatMap(r=>r.attack.beamOffsets.map((dx,i)=><g key={`${r.attack.id}-${i}`} className="guard-ground-impact"><path d={`M${screenX(r.attack.x+dx)-8} ${LASER_IMPACT_Y+5}l8-10 8 10 M${screenX(r.attack.x+dx)-8} ${LASER_IMPACT_Y-5}l16 10`} stroke="#ffd266" strokeWidth="3" fill="none"/></g>))}
          <g className="guard-batteries" aria-hidden="true">{[0,1,2,3].map(i=><g key={i} transform={`translate(${screenX(batteryPosition(i).x)} 370)`}>
            <path d="M-24 10V-3L-14-12H14L24-3V10Z" fill="#235475" stroke="#91dbec" strokeWidth="2"/><path d="M-4-12V-27H4V-12" fill="#d2eaff"/><text textAnchor="middle" y="5" fill="#e9faff" fontSize="12">{i+1}</text>
          </g>)}</g>
          {preview.shots.map(shot=>{
            const age=time-shot.at,enemy=preview.drones.find(d=>d.id===shot.enemy),index=preview.squadChoices.indexOf(shot.selected);
            if(!enemy||index<0) return null;
            const target=enemyPosition(preview,enemy,time,reduced),from={...batteryPosition(index),y:343};
            const p=missilePosition(from,{x:target.x+(shot.correct?0:42),y:target.y},Math.min(1,age/.55));
            return age<.55?<g key={shot.id} className="guard-missile" data-battery={index+1} data-shot-attack={shot.attackId}><path d={`M${screenX(from.x)} ${from.y}L${screenX(p.x)} ${p.y}`} stroke="#7cf4ff" strokeWidth="2" opacity=".6"/><circle cx={screenX(p.x)} cy={p.y} r="5" fill="#e7ffff"/></g>:shot.correct&&age<.8?<circle key={shot.id} className="guard-impact" cx={screenX(target.x)} cy={target.y} r="25" fill="none" stroke="#fff2a5" strokeWidth="3"/>:null;
          })}
        </svg>
        {(!game||['paused','clear','over'].includes(game.phase))&&<div className="guard-overlay">
          <p className="guard-overlay-kicker">{game?.phase==='clear'?'MISSION COMPLETE':game?.phase==='over'?'MISSION END':game?.phase==='paused'?'PAUSED':'CW迎撃隊'}</p>
          <h2>{game?.phase==='clear'?boss?'シグナル・マスター、撃破！':game.stage===3?'最終WAVE突破！':'編隊を突破！':game?.phase==='over'?cityHp(game)===0?'街を守りきれませんでした':'弾切れになりました':game?.phase==='paused'?'ひと休みしよう':'音を聴いて、街を守れ。'}</h2>
          <p>{game?.phase==='paused'?'飛行中のレーザーも停止。再開すると送信中だった信号だけを再送します。':'レーザーは発射順に迎撃。誤答後も着弾前なら再射撃できます。'}</p>
          <button className="btn btn-primary" onClick={()=>void start(game?.phase==='paused',game?.bossOnly??false)}>{game?.phase==='paused'?'再開する':game?'もう一度遊ぶ':'音を有効にして開始'}</button>
          {process.env.NODE_ENV==='development'&&!game&&<button className="btn btn-secondary guard-boss-practice" onClick={()=>void start(false,true)}>開発確認：WARNINGから再生</button>}
          {game?.phase==='clear'&&boss&&<p>撃破ボーナス +{BOSS_BONUS.toLocaleString()} · {game.bossOnly?'ボス練習の記録':'全STAGE・ボス戦クリア'}</p>}
          {game&&['clear','over'].includes(game.phase)&&<p>{game.correct}/{game.attempts}迎撃成功 · 最大COMBO {game.maxCombo} · BEST {best.toLocaleString()}</p>}
        </div>}
      </div>
      <div className="guard-city-status" aria-label="街の防衛状況">CITY {cityHp(preview)}/{cityMaxHp(preview)} · {preview.buildings.filter(b=>b.hp>0).length}/{preview.buildings.length}棟 · {boss?'ボス戦':`第${squad}/${squads}部隊`} <span>飛行中 {preview.attacks.filter(a=>a.startedAt!==null).length} · {head?`迎撃対象 #${head.id}`:'攻撃待ち'}</span></div>
      <div className="guard-signal"><p role="status" aria-live="polite">{label}</p><span>{tx?.wpm??head?.wpm??wpm} WPM {preview.hints?'・符号ヒントあり':'・音だけ'}{boss&&tx?` · ${patternLabel[tx.pattern]}`:''}</span></div>
      {game&&time<game.keyNoticeUntil&&<p className="guard-key-notice" role="status">4文字を更新しました：{game.squadChoices.join(' / ')}</p>}
      <div className="guard-choices" aria-label="迎撃する文字を選択">{(preview.squadChoices.length?preview.squadChoices:PRESETS[preset].symbols.slice(0,4)).map((letter,i)=><button type="button" key={`${preview.stage}-${preview.squadRow}-${i}`} disabled={!canAnswer(game)} onClick={()=>choose(i)} aria-label={`${i+1}: ${letter}で迎撃`}><small>第{i+1}砲台 · {i+1}</small>{letter}</button>)}</div>
      <div className="guard-feedback" aria-live="polite">{result&&<span>{result.correct?`迎撃成功 +${result.points} · COMBO ${preview.combo}！`:result.answer?`#${result.attackId}着弾 · 正解 ${result.answer} ${signalCode(result.answer,preview.preset).replaceAll('.','・').replaceAll('-','－')}`:'誤答。再装填後に同じレーザーへ再射撃できます。'}</span>}{message&&<p role="alert">{message}</p>}</div>
      <div className="guard-controls">
        <label>CW速度<input aria-label="CW速度 WPM" type="number" min="8" max="40" value={wpm} disabled={live||game?.phase==='paused'} onChange={e=>{setWpm(Math.max(8,Math.min(40,Number(e.target.value)||8)));setGame(null);}}/> WPM</label>
        <label>文字範囲<select aria-label="文字範囲" value={preset} disabled={live||game?.phase==='paused'} onChange={e=>{setPreset(e.target.value as Preset);setGame(null);}}>{Object.entries(PRESETS).map(([id,p])=><option key={id} value={id}>{p.label}</option>)}</select></label>
        <label className="guard-toggle"><input type="checkbox" checked={hints} disabled={live||game?.phase==='paused'} onChange={e=>{setHints(e.target.checked);setGame(null);}}/>符号ヒント（通常敵）</label>
        <span>BEST {best.toLocaleString()}</span>{live&&<button type="button" className="btn btn-secondary" onClick={pause}>一時停止</button>}{game&&<button type="button" className="btn btn-secondary" onClick={()=>{engine.stop();music.stop();playback.current=null;saveBest(game);setGame(null);setMessage('ゲームを終了しました。');}}>終了</button>}
        <details className="guard-audio"><summary>音量</summary><label>CW<input aria-label="CW音量" type="range" min="0" max="1" step=".05" value={cwVolume} onChange={e=>setCwVolume(Number(e.target.value))}/></label><label>BGM<input aria-label="BGM音量" type="range" min="0" max=".2" step=".01" value={musicVolume} onChange={e=>setMusicVolume(Number(e.target.value))}/></label>{musicPlaying&&<button className="btn btn-secondary" onClick={()=>void music.play(musicVolume).then(()=>setMessage('')).catch(()=>setMessage('BGMを再生できませんでした。'))}>BGM再生</button>}</details>
        <audio ref={audioElement} src="/assets/pcclub/robot/boss_bgm.mp3" loop preload="none" aria-hidden="true"/>
      </div>
    </div>
    <details className="guard-guide"><summary>遊び方・スコアのしくみ</summary>
      <p>5機ずつの部隊を突破し、STAGE 1・2・3からWARNINGを経てHP100のボス戦へ進みます。通常敵HPはSTAGE順に1・2・3。CW速度（8〜40 WPM）と文字範囲は開始前に選び、最後まで維持します。和文はカナ・和文記号の既存符号表を使用します。</p>
      <p>PCは1〜4キー、スマホはタップ。砲台の4文字は部隊中固定。最後の短点・長点が鳴り始めた瞬間から回答できます。必ず発射順の「迎撃対象」から回答。正解すると即座に次の攻撃へ進み、ミサイルの到着を待ちません。誤答時は0.3秒の再装填後、着弾前なら再射撃できます。キー押しっぱなしでは連射しません。</p>
      <p>正解・誤答とも弾薬1発を消費。正解で攻撃元に1ダメージ、COMBO増加。誤答・着弾・一時停止でCOMBOリセット。4連続ごとに倍率が0.25上がり最大2倍。高速CWほど高得点、符号ヒントありは75%。STAGE別の送信枠後の間隔は1.8・0.7・0.18秒です。</p>
      <p>音声は順番に送信し、複数レーザーは同時に下降します。短点・長点・空白は1:3:1、下降速度はWPMと無関係。9棟の建物は着弾X座標で損傷し、隙間には建物ダメージなし。全壊・補給不能な弾切れで終了。STAGE突破時は建物HPを1回復、ボス登場時はHP3へ全回復・弾薬140発を補給します。</p>
      <p>ボスは赤い直線レーザーと連送・拡散・チャージ攻撃を使用。拡散も正解1回で全ビームを無効化。HP50で一度だけ覚醒、HP10で最終局面へ入り、各10発補給。HP75・50・25の文字切替は全攻撃を解決してから行います。ボスを倒すとボーナス5,000点で最終クリアです。</p>
      <p>Esc・タブ移動で一時停止し、再開時は送信中の信号だけを再送します。ボスBGMとCWの音量は別々に調整できます。記録はこのブラウザ内に保存。既存の学習進捗・カード・公開ログには加算や投稿しません。ゲーム実績は将来の導入に備えた記録のみで、カード報酬は未実装です。</p>
    </details>
  </section>;
}
