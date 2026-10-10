import { describe,expect,it,vi } from 'vitest';
import { advanceGame,answerAttack,beginTransmission,buildingAt,canAnswer,cityHp,cityMaxHp,createCity,createGame,MODES,nextAttack,nextStage,oldestAttack,pauseGame,readBest,resumeAttack,saveBest,signalCode,squadDrones,squadNumber,transmittingAttack,formationOffset,movementPose,dronePosition,batteryPosition,missilePosition,RETRY_SECONDS,type GuardGame,type Difficulty } from './cwGuard';
import { buildMorseTimeline } from '../timing';
import { DEFAULT_SETTINGS } from '../storage';
import { LASER_SPEED,laserSegments } from './laser';
const timeline=(symbol:string,wpm:number)=>buildMorseTimeline(symbol,'international',{...DEFAULT_SETTINGS,characterSpeed:wpm,effectiveSpeed:wpm});
// FIFO regressions use one-HP enemies independently of new difficulty HP balance.
function start(){const base=createGame('expert',true,73);const g=nextAttack({...base,drones:base.drones.map(d=>({...d,hp:1,maxHp:1}))});return advanceGame(g,g.arrivalUntil);}
function emit(game:GuardGame,x=110,y=109){
  const tx=transmittingAttack(game)!;
  const g=advanceGame(game,Math.max(game.time,tx.readyAt));
  return beginTransmission(g,tx.id,timeline(tx.symbol,tx.wpm),g.time,x,y);
}
function flown(game=start(),x=110){const g=emit(game,x);return advanceGame(g,transmittingAttack(g)!.sendEndsAt!);}
function add(game:GuardGame,x=250){return flown(advanceGame(game,Math.max(game.time,game.nextFireAt)),x);}
const hit=(g:GuardGame)=>answerAttack(g,oldestAttack(g)!.id,oldestAttack(g)!.symbol,g.time);

describe('city and FIFO multi-laser defence',()=>{
  it('keeps buildings independent of enemy count, columns, stage and viewport',()=>{
    const g=createGame('beginner',true,73),city=createCity();
    expect(g.drones).toHaveLength(16);expect(city).toHaveLength(9);expect(cityHp(g)).toBe(18);expect(cityMaxHp(g)).toBe(18);
    expect(nextStage({...g,phase:'clear'}).drones).toHaveLength(20);
    expect(nextStage({...g,phase:'clear'}).buildings).toEqual(city);
    expect(new Set(city.map(b=>b.height)).size).toBeGreaterThan(4);
    expect(city.every((b,i)=>!i||b.x>city[i-1].x+city[i-1].width)).toBe(true);
  });
  it('uses half-open building footprints and never redirects hits in gaps or ruins',()=>{
    const city=createCity();for(const b of city){expect(buildingAt(city,b.x)?.id).toBe(b.id);expect(buildingAt(city,b.x+b.width)).toBeUndefined();}
    let g=flown(start(),100);const a=oldestAttack(g)!;
    g=advanceGame(g,a.impactAt!);expect(g.buildings[1].hp).toBe(1);expect(cityHp(g)).toBe(17);
    expect(g.resolved.find(r=>r.attack.id===a.id)).toMatchObject({status:'impacted',buildingId:1});
    expect(g.buildings.filter(b=>b.hp!==2).map(b=>b.id)).toEqual([1]);
    let gap=flown(start(),71),gapAttack=oldestAttack(gap)!;gap=advanceGame(gap,gapAttack.impactAt!);
    expect(cityHp(gap)).toBe(18);expect(gap.resolved.find(r=>r.attack.id===gapAttack.id)?.buildingId).toBeNull();
    let ruin=flown(start(),100);ruin={...ruin,buildings:ruin.buildings.map(b=>b.id===1?{...b,hp:0}:b)};
    const before=cityHp(ruin);ruin=advanceGame(ruin,oldestAttack(ruin)!.impactAt!);expect(cityHp(ruin)).toBe(before);
  });
  it('binds firing coordinates once even when the sender moves or is rebound',()=>{
    const g=emit(start(),135,109),a=oldestAttack(g)!;
    const later=advanceGame(g,g.time+.1);expect(oldestAttack(later)?.x).toBe(135);
    expect(dronePosition(g.drones.find(d=>d.id===a.enemy)!,formationOffset(10)).x).not.toBe(135);
    expect(beginTransmission(later,a.id,a.timeline!,later.time,999,222)).toBe(later);
    expect(a.impactAt!-a.startedAt!).toBeCloseTo((318-109)/LASER_SPEED);
  });
  it('gates arrival and preparation before a transmission, rejects bad/stale binds',()=>{
    const g=nextAttack(createGame('beginner',true,73));expect(g.phase).toBe('entering');expect(g.attacks).toEqual([]);expect(canAnswer(g)).toBe(false);
    const prep=advanceGame(g,g.arrivalUntil),a=oldestAttack(prep)!;
    expect(a.status).toBe('preparing');expect(canAnswer(prep)).toBe(false);
    expect(beginTransmission(prep,a.id,timeline(a.symbol,a.wpm),prep.time,100,109)).toBe(prep);
    const ready=advanceGame(prep,a.readyAt);
    expect(beginTransmission(ready,999,timeline(a.symbol,a.wpm),ready.time,100,109)).toBe(ready);
    expect(beginTransmission(ready,a.id,timeline(a.symbol,a.wpm),ready.time,Infinity,109)).toBe(ready);
  });
  it('keeps multiple beams flying and one serial CW transmission at a time',()=>{
    let g=flown();const a=oldestAttack(g)!;expect(canAnswer(g)).toBe(true);
    g=advanceGame(g,g.nextFireAt);expect(g.attacks).toHaveLength(2);expect(transmittingAttack(g)?.status).toBe('preparing');
    g=emit(g,250);const b=transmittingAttack(g)!;
    expect(b.startedAt!).toBeGreaterThanOrEqual(a.sendEndsAt!);expect(g.attacks.filter(a=>a.status==='sending')).toHaveLength(1);
    expect(nextAttack(g)).toBe(g);
    const hitWhileSending=hit(g);expect(transmittingAttack(hitWhileSending)?.id).toBe(b.id);expect(transmittingAttack(hitWhileSending)?.status).toBe('sending');
    expect(hitWhileSending.drones.find(d=>d.id===b.enemy)?.alive).toBe(true);
    g=advanceGame(g,b.sendEndsAt!);g=add(g,430);expect(g.attacks.filter(a=>a.status==='flying')).toHaveLength(3);
    const sources=g.attacks.map(a=>a.x);expect(sources).toEqual([110,250,430]);
    const t=g.time;for(const attack of g.attacks){const segments=laserSegments(attack.timeline!,t-attack.startedAt!,true,attack.window,attack.y);expect(segments.length).toBeGreaterThan(0);}
  });
  it('accepts only the oldest attack, even if a later signal matches the selected key',()=>{
    let g=add(flown());const [a,b]=g.attacks;
    expect(a.symbol).not.toBe(b.symbol);
    const before=g.ammo;const wrong=answerAttack(g,a.id,b.symbol,g.time);
    expect(wrong.ammo).toBe(before-1);expect(wrong.combo).toBe(0);expect(wrong.correct).toBe(0);expect(wrong.attacks.map(a=>a.id)).toEqual([a.id,b.id]);
    expect(wrong.result?.answer).toBe('');expect(oldestAttack(wrong)?.id).toBe(a.id);
    const skipped=answerAttack(g,b.id,b.symbol,g.time);expect(skipped.ammo).toBe(before);expect(skipped.correct).toBe(0);
    const resolved=hit(g);expect(oldestAttack(resolved)?.id).toBe(b.id);
    expect(resolved.shots.at(-1)?.enemy).toBe(a.enemy);expect(resolved.drones.filter(d=>!d.alive).map(d=>d.id)).toEqual([a.enemy]);
  });
  it('permits retry after a miss with a shared cooldown and no timeout ammunition charge',()=>{
    let g={...flown(),combo:5};const a=oldestAttack(g)!,wrong=g.squadChoices.find(c=>c!==a.symbol)!;
    const ammo=g.ammo;g=answerAttack(g,a.id,wrong,g.time);
    expect(g.ammo).toBe(ammo-1);expect(g.combo).toBe(0);expect(cityHp(g)).toBe(18);
    const spam=answerAttack(g,a.id,a.symbol,g.time);expect(spam.ammo).toBe(g.ammo);expect(spam.correct).toBe(0);
    const early=answerAttack(g,a.id,a.symbol,g.time+RETRY_SECONDS-.001);expect(early.correct).toBe(0);
    g=answerAttack(g,a.id,a.symbol,g.time+RETRY_SECONDS);expect(g.correct).toBe(1);expect(g.ammo).toBe(ammo-2);expect(g.combo).toBe(1);
    expect(g.attacks.some(b=>b.id===a.id)).toBe(false);expect(cityHp(g)).toBe(18);
    expect(answerAttack(g,a.id,a.symbol,g.time+.5).correct).toBe(1);
  });
  it('resolves physical impacts independently, removes only their attacks and never double-damages',()=>{
    let g=add(flown());const [a,b]=g.attacks;
    const ammo=g.ammo;g=advanceGame(g,a.impactAt!);
    expect(g.attacks.some(x=>x.id===a.id)).toBe(false);expect(g.attacks.some(x=>x.id===b.id)).toBe(true);
    const hp=cityHp(g);expect(hp).toBe(17);expect(g.ammo).toBe(ammo);
    g=advanceGame(g,g.time);expect(cityHp(g)).toBe(hp);expect(g.resolved.filter(r=>r.attack.id===a.id)).toHaveLength(1);
    expect(oldestAttack(g)?.id).toBe(b.id);
  });
  it('accepts a just-before-impact hit but rejects at-impact or stale input without retargeting',()=>{
    const g=add(flown()),a=oldestAttack(g)!;
    const near=answerAttack(g,a.id,a.symbol,a.impactAt!-.001);expect(near.correct).toBe(1);
    const past=advanceGame(near,a.impactAt!);expect(past.resolved.some(r=>r.attack.id===a.id&&r.status==='impacted')).toBe(false);
    for(const offset of [0,.001]){const late=answerAttack(g,a.id,a.symbol,a.impactAt!+offset);expect(late.correct).toBe(0);expect(late.ammo).toBe(g.ammo);}
  });
  it('stops at ammunition zero or total city loss and cannot posthumously shoot',()=>{
    let g=flown();const a=oldestAttack(g)!;g={...g,ammo:1};const out=answerAttack(g,a.id,g.squadChoices.find(c=>c!==a.symbol)!,g.time);
    expect(out.phase).toBe('over');expect(out.ammo).toBe(0);expect(out.attacks).toEqual([]);expect(out.transmittingId).toBeNull();
    expect(answerAttack(out,a.id,a.symbol,out.time)).toBe(out);
    let last=flown(start(),100);last={...last,buildings:last.buildings.map(b=>({...b,hp:b.id===1?1:0}))};
    expect(advanceGame(last,oldestAttack(last)!.impactAt!).phase).toBe('over');
  });
  it('retains flight times, FIFO, ammo and keys through pause, replays only the interrupted CW',()=>{
    let g=flown();g=emit(advanceGame(g,g.nextFireAt),250);const [a,b]=g.attacks;
    const paused=pauseGame(g);expect(advanceGame(paused,999)).toBe(paused);expect(answerAttack(paused,a.id,a.symbol,999)).toBe(paused);
    const resumed=resumeAttack(paused);expect(resumed.phase).toBe('active');expect(resumed.time).toBe(g.time);expect(resumed.ammo).toBe(g.ammo);expect(resumed.squadChoices).toEqual(g.squadChoices);
    expect(resumed.attacks[0]).toEqual(a);expect(resumed.attacks[1]).toMatchObject({id:b.id,status:'preparing',startedAt:null});
    const replay=emit(resumed,250);expect(replay.attacks[0]).toEqual(a);expect(replay.attacks.map(a=>a.id)).toEqual([a.id,b.id]);
    const arriving=nextAttack(createGame('beginner',true,73));expect(resumeAttack(pauseGame(arriving)).phase).toBe('entering');
  });
  it('holds the squad keys for all attacks, waits for pending attacks, then changes keys',()=>{
    let g=flown(),keys=[...g.squadChoices];const row=g.squadRow;
    // Even an externally changed formation cannot advance while a beam remains unresolved.
    const pending={...g,drones:g.drones.map(d=>d.row===row?{...d,alive:false}:d)};
    expect(nextAttack(pending).squadRow).toBe(row);
    for(let i=0;i<4;i++){
      expect(g.squadChoices).toEqual(keys);g=hit(g);
      g=advanceGame(g,g.time+1.2);
      if(i<3){g=advanceGame(g,Math.max(g.time,g.nextFireAt));g=flown(g);}
    }
    expect(g.phase).toBe('entering');expect(squadNumber(g)).toBe(2);expect(g.squadChoices).not.toEqual(keys);
  });
  it('supports more enemies sharing four keys while killing only the actual sender',()=>{
    let g=createGame('beginner',true,73);g={...g,drones:[...g.drones,...g.drones.slice(12).map(d=>({...d,id:d.id+100}))]};
    g=nextAttack(g);g=advanceGame(g,g.arrivalUntil);g=flown(g);
    expect(g.squadChoices).toHaveLength(4);expect(squadDrones(g)).toHaveLength(8);
    const a=oldestAttack(g)!;g=hit(g);expect(g.drones.filter(d=>!d.alive).map(d=>d.id)).toEqual([a.enemy]);
  });
  it('completes three stages with every real sender destroyed, repairs city and never repeats IDs',()=>{
    let g=nextAttack(createGame('standard',false,73)),previousScore=0;const ids=new Set<number>();
    for(let stage=1;stage<=3;stage++){
      let safety=0;
      while(g.phase!=='clear'&&safety++<200){
        if(g.phase==='entering'){g=advanceGame(g,g.arrivalUntil);continue;}
        if(transmittingAttack(g)?.status==='preparing'){g=flown(g);continue;}
        if(canAnswer(g)){const a=oldestAttack(g)!;expect(ids.has(a.id)).toBe(false);ids.add(a.id);g=hit(g);expect(g.score).toBeGreaterThan(previousScore);previousScore=g.score;}
        g=advanceGame(g,g.time+1.2);
      }
      expect(g.phase).toBe('clear');expect(g.stage).toBe(stage);if(stage<3) g=nextAttack(nextStage({...g,buildings:g.buildings.map(b=>({...b,hp:1}))}));
    }
    expect(g.correct).toBe(84);expect(g.maxCombo).toBe(84);expect(nextStage(g).stage).toBe(4);expect(nextStage(g).drones[0].hp).toBe(100);
  });
  it('preserves the score formula, combo multiplier, hints penalty and local-only storage',()=>{
    const score=(mode:Difficulty,hints:boolean)=>{
      let g=nextAttack(createGame(mode,hints,73));g=advanceGame(g,g.arrivalUntil);g=flown(g);return hit(g).score;
    };
    expect(score('expert',false)).toBeGreaterThan(score('standard',false));expect(score('standard',false)).toBeGreaterThan(score('beginner',false));
    expect(score('beginner',true)).toBeLessThan(score('beginner',false));
    let raw='broken';vi.stubGlobal('localStorage',{getItem:()=>raw,setItem:(_:string,s:string)=>{raw=s;}});
    expect(readBest('beginner',true)).toBe(0);expect(saveBest({...createGame('beginner',true),score:900})).toBe(900);expect(readBest('expert',false)).toBe(0);
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}});expect(saveBest(createGame('standard',false))).toBe(0);vi.unstubAllGlobals();
  });
  it('reuses exact CW timing and movement/missile geometry without viewport-dependent difficulty',()=>{
    for(const mode of Object.keys(MODES) as Difficulty[]) for(const letter of MODES[mode].pool){const t=timeline(letter,MODES[mode].wpm);
      expect(t.tones.map(t=>t.element).join('')).toBe(signalCode(letter));t.tones.forEach((tone,i)=>{expect(tone.duration).toBeCloseTo(t.dit*(tone.element==='-'?3:1));if(i) expect(tone.start-t.tones[i-1].start-t.tones[i-1].duration).toBeCloseTo(t.dit);});}
    expect(formationOffset(5)).toBeGreaterThan(0);expect(formationOffset(15)).toBeLessThan(0);expect(movementPose(0)).toBe('right');expect(movementPose(Math.PI/.32)).toBe('left');
    const from=batteryPosition(2),to=dronePosition(createGame('beginner').drones[12],20);
    expect(missilePosition(from,to,1)).toEqual(to);expect(missilePosition(from,to,.5)).toEqual({x:(from.x+to.x)/2,y:(from.y+to.y)/2});
  });
});
