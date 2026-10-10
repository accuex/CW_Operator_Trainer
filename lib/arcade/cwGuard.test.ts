import { describe, expect, it, vi } from 'vitest';
import { answerAttack, createGame, MODES, nextAttack, nextStage, openAnswer, pauseGame, readBest, resumeAttack, saveBest, signalCode, type Difficulty } from './cwGuard';
import { buildMorseTimeline } from '../timing';
import { DEFAULT_SETTINGS } from '../storage';

describe('CW guard rules', () => {
  it('creates four rows/columns with four distinct hidden letters per row', () => {
    const game=createGame('beginner',true,73);
    expect(game.drones).toHaveLength(16);
    for(let row=0;row<4;row++) expect(new Set(game.drones.filter((d)=>d.row===row).map((d)=>d.symbol)).size).toBe(4);
    expect(createGame('beginner',true,73)).toEqual(game);
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
  it('keeps transmitting down one column and changes column after clearing it', () => {
    let g=nextAttack(createGame('beginner',true,22));
    for(let i=0;i<4;i++) {
      const target=g.drones.find((d)=>d.id===g.attack!.enemy)!; expect(target.column).toBe(0);
      g=nextAttack(answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,target.symbol));
    }
    expect(g.drones.find((d)=>d.id===g.attack!.enemy)!.column).toBe(1);
  });
  it('resets combo on a wrong answer or timeout and stops before an unwinnable state', () => {
    let g=nextAttack(createGame('beginner',true,3));
    g={...g,combo:5};
    for(let i=0;i<9;i++) {
      g=answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,null);
      expect(g.combo).toBe(0); g=nextAttack(g);
    }
    expect(g.phase).toBe('over'); expect(g.correct).toBe(0);
    expect(nextAttack(g)).toBe(g);
  });
  it('reaches all three stages with valid play and score increases with combo', () => {
    let g=nextAttack(createGame('standard',false,73)); let previous=0;
    for(let wave=1;wave<=3;wave++) {
      while(g.phase==='sending') {
        const target=g.drones.find((d)=>d.id===g.attack!.enemy)!;
        g=answerAttack(openAnswer(g,g.attack!.id),g.attack!.id,target.symbol);
        expect(g.score).toBeGreaterThan(previous); previous=g.score;
        g=nextAttack(g);
      }
      expect(g.phase).toBe('clear'); expect(g.stage).toBe(wave);
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
