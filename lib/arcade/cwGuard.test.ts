import { describe, expect, it, vi } from 'vitest';
import { answerAttack, expireAttack, RETRY_SECONDS, createGame, MODES, nextAttack as queueAttack, completeArrival, beginTransmission, squadDrones, squadNumber, nextStage, openAnswer, pauseGame, readBest, resumeAttack, saveBest, signalCode, selectedBattery, formationOffset, movementPose, dronePosition, batteryPosition, missilePosition, type Difficulty } from './cwGuard';
import { buildMorseTimeline } from '../timing';
import { DEFAULT_SETTINGS } from '../storage';

// Existing scoring tests advance presentation phases explicitly.
const nextAttack=(game: ReturnType<typeof createGame>)=>{
  let next=queueAttack(game);
  if(next.phase==='entering') next=completeArrival(next);
  return next.phase==='charging' ? beginTransmission(next,next.attack!.id) : next;
};
describe('CW guard rules', () => {
  it('creates four rows/columns with four distinct hidden letters per row', () => {
    const game=createGame('beginner',true,73);
    expect(game.drones).toHaveLength(16);
    for(let row=0;row<4;row++) expect(new Set(game.drones.filter((d)=>d.row===row).map((d)=>d.symbol)).size).toBe(4);
    expect(createGame('beginner',true,73)).toEqual(game);
  });
  it('gates all four-robot arrivals and preparations before audio, including pause/resume',()=>{
    let g=queueAttack(createGame('beginner',true,73));
    expect(g.phase).toBe('entering'); expect(g.attack).toBeNull();
    expect(squadDrones(g)).toHaveLength(4); expect(squadNumber(g)).toBe(1);
    expect(openAnswer(g,1)).toBe(g); expect(queueAttack(g)).toBe(g);
    expect(resumeAttack(pauseGame(g)).phase).toBe('entering');
    g=completeArrival(g); expect(g.phase).toBe('charging');
    expect(openAnswer(g,g.attack!.id)).toBe(g);
    expect(beginTransmission(g,999)).toBe(g);
    expect(resumeAttack(pauseGame(g)).phase).toBe('charging');
    g=beginTransmission(g,g.attack!.id); expect(g.phase).toBe('sending');
    const firstSet=[...g.attack!.choices].sort();
    for(let i=0;i<4;i++){
      const symbol=g.drones.find(d=>d.id===g.attack!.enemy)!.symbol;
      g=queueAttack(answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,symbol));
      if(i<3){expect(g.phase).toBe('charging');g=beginTransmission(g,g.attack!.id);}
    }
    expect(g.phase).toBe('entering'); expect(squadNumber(g)).toBe(2);
    expect(squadDrones(g).every(d=>d.alive)).toBe(true);
    g=completeArrival(g);expect([...g.attack!.choices].sort()).not.toEqual(firstSet);
    expect(squadDrones(g).every(d=>dronePosition(d,0).y===77)).toBe(true);
  });
  it('offers four unique shuffled choices including the real sender', () => {
    const positions=new Set<number>();
    for(let seed=0;seed<80;seed++) {
      const game=nextAttack(createGame('standard',false,seed));
      const correct=game.drones.find((d)=>d.id===game.attack!.enemy)!.symbol;
      expect(new Set(game.attack!.choices).size).toBe(4);
      positions.add(game.attack!.choices.indexOf(correct));
      expect(answerAttack(game,game.attack!.id,correct)).toBe(game);
    }
    expect(positions.size).toBe(4);
  });
  it('accepts one answer only after the entire transmission and rejects stale callbacks', () => {
    const sending=nextAttack(createGame('beginner',true,1));
    expect(openAnswer(sending,999)).toBe(sending);
    const game=openAnswer(sending,sending.attack!.id);
    const symbol=game.drones.find((d)=>d.id===game.attack!.enemy)!.symbol;
    const hit=answerAttack(game,game.attack!.id,symbol);
    expect(hit.correct).toBe(1); expect(hit.ammo).toBe(game.ammo-1);
    expect(hit.drones.filter((d)=>d.alive)).toHaveLength(15);
    expect(answerAttack(hit,game.attack!.id,symbol)).toBe(hit);
    expect(answerAttack(game,999,symbol)).toBe(game);
    expect(answerAttack(game,game.attack!.id,'NOT_A_CHOICE')).toBe(game);
  });
  it('only transmits from the lowest surviving row and changes its four-letter set after clearing it', () => {
    let g=nextAttack(createGame('beginner',true,22));
    const firstSet=[...g.attack!.choices].sort();
    for(let i=0;i<4;i++) {
      const target=g.drones.find((d)=>d.id===g.attack!.enemy)!; expect(target.row).toBe(3);
      g=nextAttack(answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,target.symbol));
    }
    expect(g.drones.find((d)=>d.id===g.attack!.enemy)!.row).toBe(2);
    expect([...g.attack!.choices].sort()).not.toEqual(firstSet);
  });
  it('resets combo on a wrong answer or timeout and stops before an unwinnable state', () => {
    let g=nextAttack(createGame('beginner',true,3));
    g={...g,combo:5};
    for(let i=0;i<8;i++) {
      expect(g.drones.find((d)=>d.id===g.attack!.enemy)!.row).toBe(3);
      g=answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,null);
      expect(g.combo).toBe(0); g=nextAttack(g);
    }
    expect(g.cityDamage).toEqual([2,2,2,2]);
    expect(g.phase).toBe('over'); expect(g.correct).toBe(0);
    expect(nextAttack(g)).toBe(g);
  });
  it('reaches all three stages with valid play and score increases with combo', () => {
    let g=nextAttack(createGame('standard',false,73)); let previous=0;
    for(let wave=1;wave<=3;wave++) {
      const squads=new Set<number>();
      while(g.phase==='sending') {
        const target=g.drones.find((d)=>d.id===g.attack!.enemy)!;
        squads.add(squadNumber(g));expect(squadDrones(g)).toHaveLength(4);
        expect(target.alive).toBe(true);
        expect(target.row).toBe(Math.max(...g.drones.filter(d=>d.alive).map(d=>d.row)));
        g=answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,target.symbol);
        expect(g.score).toBeGreaterThan(previous); previous=g.score;
        g=nextAttack(g);
      }
      expect(g.phase).toBe('clear'); expect(g.stage).toBe(wave);
      expect(squads.size).toBe(wave===1?4:5);
      if(wave<3) g=nextAttack(nextStage(g));
    }
    expect(g.correct).toBe(56); expect(g.maxCombo).toBe(56);
    expect(nextStage(g)).toBe(g);
  });
  it('has higher scores for speed/difficulty, a hint penalty and varied expert speed', () => {
    const score=(mode:Difficulty,hints:boolean) => {
      let g=nextAttack(createGame(mode,hints,73));g=openAnswer(g,g.attack!.id);
      return answerAttack(g,g.attack!.id,g.drones.find((d)=>d.id===g.attack!.enemy)!.symbol).score;
    };
    expect(score('expert',false)).toBeGreaterThan(score('standard',false));
    expect(score('standard',false)).toBeGreaterThan(score('beginner',false));
    expect(score('beginner',true)).toBeLessThan(score('beginner',false));
    const paused={...nextAttack(createGame('expert',false,1)),phase:'paused' as const,combo:8};
    const resumed=resumeAttack(paused); expect(resumed.phase).toBe('sending'); expect(resumed.combo).toBe(0); expect(resumed.ammo).toBe(paused.ammo);
  });
  it('pausing during hit feedback cannot replay and score an already destroyed enemy', () => {
    let g=nextAttack(createGame('standard',false,73));
    const target=g.drones.find((d)=>d.id===g.attack!.enemy)!;
    g=answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,target.symbol);
    const paused=pauseGame(g); expect(paused.phase).toBe('paused');
    expect(paused.attack!.enemy).not.toBe(target.id);
    expect(paused.drones.find((d)=>d.id===paused.attack!.enemy)!.alive).toBe(true);
    expect(paused.score).toBe(g.score); expect(paused.correct).toBe(1);
    expect(answerAttack(resumeAttack(paused),paused.attack!.id,target.symbol)).toMatchObject({correct:1});
  });
  it('keeps city intact on hits, damages one building on misses, and repairs one level per wave', () => {
    let g=nextAttack(createGame('beginner',true,19));
    const original=g;
    g=answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,g.drones.find(d=>d.id===g.attack!.enemy)!.symbol);
    expect(g.cityDamage).toEqual([0,0,0,0]);
    g=nextAttack(g);
    const sender=g.drones.find(d=>d.id===g.attack!.enemy)!;
    const beforeAmmo=g.ammo;
    g=answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,g.attack!.choices.find(c=>c!==sender.symbol)!);
    expect(g.combo).toBe(0); expect(g.ammo).toBe(beforeAmmo-1);
    expect(g.cityDamage[sender.column]).toBe(0);
    g=expireAttack(g,g.attack!.id);
    expect(g.cityDamage[sender.column]).toBe(1);
    expect(g.drones.find(d=>d.id===sender.id)!.alive).toBe(true);
    expect(g.cityDamage.reduce((a,b)=>a+b,0)).toBe(1);
    expect(original.cityDamage).toEqual([0,0,0,0]);
    expect(nextStage({...g,phase:'clear',cityDamage:[2,1,0,2]}).cityDamage).toEqual([1,0,0,1]);
    expect(nextAttack({...g,ammo:0}).phase).toBe('over');
  });
  it('allows a miss then correct retry, suppresses spam, spends one round per shot, and hides the answer',()=>{
    let g=nextAttack(createGame('beginner',true,73));g=openAnswer(g,g.attack!.id);
    const id=g.attack!.id, answer=g.drones.find(d=>d.id===g.attack!.enemy)!.symbol, wrong=g.attack!.choices.find(c=>c!==answer)!;
    g={...g,combo:5}; const ammo=g.ammo;
    g=answerAttack(g,id,wrong,2);
    expect(g.phase).toBe('answer');expect(g.combo).toBe(0);expect(g.result!.answer).toBe('');expect(g.cityDamage).toEqual([0,0,0,0]);
    expect(answerAttack(g,id,answer,2)).toBe(g);expect(answerAttack(g,id,answer,2+RETRY_SECONDS-.001)).toBe(g);
    g=answerAttack(g,id,answer,2+RETRY_SECONDS);
    expect(g.phase).toBe('feedback');expect(g.ammo).toBe(ammo-2);expect(g.correct).toBe(1);expect(g.combo).toBe(1);expect(g.cityDamage).toEqual([0,0,0,0]);
    expect(expireAttack(g,id)).toBe(g);expect(answerAttack(g,id,answer,9)).toBe(g);
  });
  it('ends at ammo zero or impact, damages town exactly once, and spends nothing on timeout',()=>{
    let g=nextAttack(createGame('beginner',true,73));g=openAnswer(g,g.attack!.id);
    const id=g.attack!.id, answer=g.drones.find(d=>d.id===g.attack!.enemy)!.symbol, wrong=g.attack!.choices.find(c=>c!==answer)!;
    const out=answerAttack({...g,ammo:1},id,wrong,3);
    expect(out.ammo).toBe(0);expect(out.phase).toBe('feedback');expect(out.cityDamage.reduce((a,b)=>a+b)).toBe(1);
    expect(answerAttack(out,id,answer,4)).toBe(out);expect(expireAttack(out,id)).toBe(out);
    const expired=expireAttack(g,id);expect(expired.ammo).toBe(g.ammo);expect(expired.cityDamage.reduce((a,b)=>a+b)).toBe(1);
    const lateHit=answerAttack(g,id,answer,5.79,5.8);expect(expireAttack(lateHit,id)).toBe(lateHit);
    expect(answerAttack(g,id,answer,5.8,5.8).correct).toBe(0);
    expect(answerAttack(g,id,answer,5.81,5.8).phase).toBe('feedback');
  });
  it('fixes four battery keys across misses, hits, pause/resume and duplicate-letter enemies',()=>{
    let g=nextAttack(createGame('beginner',true,73));const choices=[...g.squadChoices];
    for(let i=0;i<4;i++){
      expect(g.attack!.choices).toEqual(choices);
      g=resumeAttack(pauseGame(g));expect(g.squadChoices).toEqual(choices);
      g=openAnswer(g,g.attack!.id);const answer=g.drones.find(d=>d.id===g.attack!.enemy)!.symbol;
      g=answerAttack(g,g.attack!.id,g.attack!.choices.find(c=>c!==answer)!,1);
      expect(g.squadChoices).toEqual(choices);g=answerAttack(g,g.attack!.id,answer,1.3);
      g=nextAttack(g);
    }
    expect(g.squadChoices).not.toEqual(choices);
    let extra=createGame('beginner',true,73);
    extra={...extra,drones:[...extra.drones,{...extra.drones[12],id:99,column:4}]};
    extra=nextAttack(extra);expect(extra.squadChoices).toHaveLength(4);
    const sender=extra.drones.find(d=>d.id===extra.attack!.enemy)!;
    const hit=answerAttack(openAnswer(extra,extra.attack!.id),extra.attack!.id,sender.symbol);
    expect(hit.drones.filter(d=>!d.alive).map(d=>d.id)).toEqual([sender.id]);
  });
  it('moves formation both ways and missiles follow straight paths to a moving target', () => {
    expect(formationOffset(0)).toBe(0);
    expect(movementPose(0)).toBe('right');expect(movementPose(Math.PI/.32)).toBe('left');
    expect(movementPose(Math.PI/2/.32)).toBe('idle');
    expect(formationOffset(5)).toBeGreaterThan(0);
    expect(formationOffset(15)).toBeLessThan(0);
    const drone=createGame('beginner',true,73).drones[12];
    const from=batteryPosition(2), to=dronePosition(drone,formationOffset(5));
    expect(missilePosition(from,to,0)).toEqual(from);
    expect(missilePosition(from,to,1)).toEqual(to);
    expect(missilePosition(from,to,.5)).toEqual({x:(from.x+to.x)/2,y:(from.y+to.y)/2});
    expect(missilePosition(from,dronePosition(drone,20),1).x).toBe(135);
  });
  it('can render a cleared wave with retained feedback and no active attack', () => {
    let game=nextAttack(createGame('beginner',true,73));
    const answer=game.drones.find(d=>d.id===game.attack!.enemy)!.symbol;
    game=answerAttack(openAnswer(game,game.attack!.id),game.attack!.id,answer);
    expect(selectedBattery(game)).toBe(game.attack!.choices.indexOf(answer));
    const clear=nextAttack({...game,drones:game.drones.map(d=>({...d,alive:false}))});
    expect(clear.phase).toBe('clear'); expect(clear.attack).toBeNull();
    expect(clear.result?.selected).toBe(answer);
    expect(selectedBattery(clear)).toBe(-1); expect(selectedBattery(null)).toBe(-1);
  });
  it('reuses the canonical Morse timeline with 1:3 tones and one-unit element gaps', () => {
    for(const mode of Object.keys(MODES) as Difficulty[]) for(const letter of MODES[mode].pool) {
      const timeline=buildMorseTimeline(letter,'international',{...DEFAULT_SETTINGS,characterSpeed:MODES[mode].wpm,effectiveSpeed:MODES[mode].wpm});
      expect(timeline.tones.map((t)=>t.element).join('')).toBe(signalCode(letter));
      timeline.tones.forEach((t,i)=>{
        expect(t.duration).toBeCloseTo(timeline.dit*(t.element==='-'?3:1));
        if(i) expect(t.start-timeline.tones[i-1].start-timeline.tones[i-1].duration).toBeCloseTo(timeline.dit);
      });
    }
  });
  it('stores only separate local scores and survives denied or corrupt storage', () => {
    let raw='broken';vi.stubGlobal('localStorage',{getItem:()=>raw,setItem:(_:string,s:string)=>{raw=s;}});
    expect(readBest('beginner',true)).toBe(0);
    expect(saveBest({...createGame('beginner',true),score:900})).toBe(900);
    expect(readBest('expert',false)).toBe(0);expect(readBest('beginner',true)).toBe(900);
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});
    expect(saveBest(createGame('standard',false))).toBe(0);vi.unstubAllGlobals();
  });
});
