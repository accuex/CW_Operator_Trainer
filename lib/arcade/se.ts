import type { GuardGame } from './cwGuard';

export type Sound = 'launch'|'hit'|'damage'|'destroy'|'impact'|'combo10'|'combo25'|'combo50'|'combo100'|'squad'|'stage'|'warning'|'bossEnter'|'bossHit'|'awakening'|'final'|'bossDestroy'|'complete'|'over';
export interface Voice { at:number; duration:number; frequency:number; end:number; gain:number; type:OscillatorType|'noise' }
const tone=(at:number,frequency:number,end:number,duration:number,gain=.22,type:Voice['type']='triangle'):Voice=>({at,frequency,end,duration,gain,type});
const boom=(at:number,size:number):Voice[]=>[tone(at,130,35,size,.36,'sine'),tone(at,0,0,size*.7,.26,'noise')];
const melody=(notes:number[],step=.09):Voice[]=>notes.map((f,i)=>tone(i*step,f,f,step*1.6,.19));
/** Original synthesized arcade sounds. No sampled third-party assets or Morse rhythm. */
export function soundVoices(sound:Sound):Voice[]{
 switch(sound){
 case 'launch':return [tone(0,1500,180,.13,.27,'sawtooth'),tone(0,0,0,.06,.1,'noise')];
 case 'hit':return [tone(0,850,240,.09,.22),tone(.015,1240,360,.08,.13)];
 case 'damage':return [tone(0,330,90,.14,.23,'square'),tone(0,0,0,.08,.14,'noise')];
 case 'destroy':return boom(0,.25);
 case 'impact':return [...boom(0,.5),tone(.025,60,28,.4,.2,'sine')];
 case 'bossHit':return [...boom(0,.18),tone(0,215,65,.18,.21,'square')];
 case 'combo10':return melody([523,784,1047]);
 case 'combo25':return melody([523,659,784,1047]);
 case 'combo50':return [...melody([523,659,784,1047,1568]),tone(.36,784,784,.27,.13)];
 case 'combo100':return [...melody([523,659,784,1047,1319,1568]),...melody([262,330,392,523,659,784])];
 case 'squad':return melody([659,784,1047],.1);
 case 'stage':return melody([523,659,784,1047,784,1319],.12);
 case 'warning':return [tone(0,160,430,.28,.24,'sawtooth'),tone(.35,160,430,.28,.24,'sawtooth'),tone(.7,160,430,.28,.24,'sawtooth')];
 case 'bossEnter':return [tone(0,40,170,.7,.28,'sawtooth'),tone(.1,0,0,.6,.17,'noise'),tone(.65,190,45,.35,.27,'sine')];
 case 'awakening':return [tone(0,80,1300,.75,.24,'sawtooth'),tone(.5,0,0,.35,.16,'noise'),...boom(.8,.55)];
 case 'final':return [tone(0,380,120,.16,.26,'square'),tone(.23,380,120,.16,.26,'square')];
 case 'bossDestroy':return [...boom(0,.4),...boom(.4,.55),...boom(.95,.8),...boom(1.65,1)];
 case 'complete':return [...melody([523,659,784,1047,784,1047,1319,1568],.13),tone(.91,784,784,.5,.16)];
 case 'over':return melody([392,330,262,196],.16);
 }
}

/** Separate from the CW context. Bounded polyphony, band-limited noise and a master limiter. */
export class GameSE {
 private context:AudioContext|null=null;
 private master:GainNode|null=null;
 private voices=new Set<AudioScheduledSourceNode>();
 private noise:AudioBuffer|null=null;
 private volume=.65;
 constructor(private factory:()=>AudioContext=()=>new window.AudioContext()){}
 async unlock(){
  if(!this.context){
   this.context=this.factory();this.master=this.context.createGain();
   const limiter=this.context.createDynamicsCompressor();
   limiter.threshold.value=-12;limiter.knee.value=8;limiter.ratio.value=12;limiter.attack.value=.003;limiter.release.value=.12;
   this.master.gain.value=this.volume*.55;this.master.connect(limiter);limiter.connect(this.context.destination);
   this.noise=this.context.createBuffer(1,this.context.sampleRate*2,this.context.sampleRate);
   const data=this.noise.getChannelData(0);let seed=73;
   for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;}
  }
  await this.context.resume();
 }
 setVolume(value:number){this.volume=Math.max(0,Math.min(1,Number.isFinite(value)?value:.65));if(this.context&&this.master)this.master.gain.setTargetAtTime(this.volume*.55,this.context.currentTime,.015);}
 play(sound:Sound){
  const c=this.context;if(!c||!this.master||c.state!=='running'||this.volume===0)return;
  for(const v of soundVoices(sound)){
   // Steal the oldest voice, including scheduled voices, to bound rapid-fire load.
   if(this.voices.size>=32){const oldest=this.voices.values().next().value!;this.voices.delete(oldest);try{oldest.stop();}catch{}}
   const start=c.currentTime+.004+v.at,gain=c.createGain(),filter=c.createBiquadFilter();
   filter.type='lowpass';filter.frequency.value=v.type==='noise'?1800:4200;
   let source:AudioScheduledSourceNode;
   if(v.type==='noise'){const noise=c.createBufferSource();noise.buffer=this.noise;source=noise;}
   else{const oscillator=c.createOscillator();oscillator.type=v.type;oscillator.frequency.setValueAtTime(v.frequency,start);oscillator.frequency.exponentialRampToValueAtTime(Math.max(20,v.end),start+v.duration);source=oscillator;}
   gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(v.gain,start+.008);gain.gain.exponentialRampToValueAtTime(.0001,start+v.duration);
   source.connect(filter);filter.connect(gain);gain.connect(this.master);this.voices.add(source);
   source.onended=()=>{this.voices.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
   source.start(start);source.stop(start+v.duration+.01);
  }
 }
 stop(){for(const source of this.voices){try{source.stop();}catch{}}this.voices.clear();}
 dispose(){this.stop();void this.context?.close();this.context=null;this.master=null;}
}

/** Game-clock queue: launches immediately, impact/damage sounds at missile arrival (.55s). */
export class SoundEvents {
 private previous:GuardGame|null=null;
 private pending:{at:number;sound:Sound}[]=[];
 private shot=0;
 private impacts=new Set<number>();
 private clearedSquads=new Set<string>();
 reset(){this.previous=null;this.pending=[];this.shot=0;this.impacts.clear();this.clearedSquads.clear();}
 update(g:GuardGame|null):Sound[]{
  if(!g){this.reset();return [];}
  if(this.previous?.runId!==g.runId)this.reset();
  const old=this.previous, output:Sound[]=[];
  const phase=g.phase==='paused'?g.pausedFrom:g.phase;
  const oldPhase=old?.phase==='paused'?old.pausedFrom:old?.phase;
  const newShots=g.shots.filter(s=>s.id>this.shot);
  const remainingHits=new Map<number,number>();
  for(const shot of newShots)if(shot.correct)remainingHits.set(shot.enemy,(remainingHits.get(shot.enemy)??0)+1);
  for(const shot of newShots){
   this.shot=shot.id;output.push('launch');
   if(shot.correct){
    const drone=g.drones.find(d=>d.id===shot.enemy);
    const laterHits=(remainingHits.get(shot.enemy)??1)-1;remainingHits.set(shot.enemy,laterHits);
    this.pending.push({at:shot.at+.55,sound:'hit'},{at:shot.at+.55,sound:g.boss?'bossHit':drone&&(drone.hp+laterHits)>0?'damage':'destroy'});
    const rowKey=`${g.stage}:${drone?.row}`;
    if(!g.boss&&drone&&!drone.alive&&!g.drones.some(d=>d.row===drone.row&&d.alive)&&!this.clearedSquads.has(rowKey)){
     this.clearedSquads.add(rowKey);this.pending.push({at:Math.max(...newShots.map(s=>s.at))+.72,sound:'squad'});
    }
   }
  }
  for(const resolution of g.resolved){
   if(resolution.status==='impacted'&&!this.impacts.has(resolution.attack.id)){this.impacts.add(resolution.attack.id);output.push('impact');}
  }
  // Shot IDs survive stages, but are reset on a fresh run only.
  if(old&&g.correct>old.correct&&g.combo>old.combo)for(const n of [10,25,50,100] as const)if(old.combo<n&&g.combo>=n)output.push(`combo${n}`);
  if(phase!==oldPhase){
   if(phase==='entering'&&g.boss)output.push('bossEnter');
   if(phase==='intermission')output.push('stage');
   if(phase==='warning'){if(!g.bossOnly)output.push('stage');output.push('warning');}
   if(phase==='awakening')output.push('awakening');
   if(phase==='defeating')this.pending.push({at:g.time+.55,sound:'bossDestroy'});
   if(phase==='clear')output.push('complete');
   if(phase==='over'){this.pending=[];output.push('over');}
  }
  if(g.boss?.form==='final'&&old?.boss?.form!=='final')output.push('final');
  this.previous=g;
  if(g.phase==='paused')return [];
  const due=this.pending.filter(e=>e.at<=g.time);this.pending=this.pending.filter(e=>e.at>g.time);
  return [...output,...due.map(e=>e.sound)];
 }
}

export const MIX_KEY='cwot:arcade:guard:mix:v1';
export const DEFAULT_MIX={cw:1,bgm:.35,se:.65};
export function readMix():typeof DEFAULT_MIX{
 try{const saved=JSON.parse(localStorage.getItem(MIX_KEY)??'{}');return Object.fromEntries(Object.entries(DEFAULT_MIX).map(([k,v])=>[k,typeof saved[k]==='number'&&Number.isFinite(saved[k])?Math.max(0,Math.min(1,saved[k])):v])) as typeof DEFAULT_MIX;}catch{return {...DEFAULT_MIX};}
}
export function saveMix(mix:typeof DEFAULT_MIX){try{localStorage.setItem(MIX_KEY,JSON.stringify(mix));}catch{ /* Storage is optional; audio still works. */ }}
