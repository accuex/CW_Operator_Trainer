/** One local music element; never shares or retimes the CW engine. */
export class GameMusic {
  private frame=0;
  private generation=0;
  private desired=false;
  private audio:HTMLAudioElement|null=null;
  private context:AudioContext|null=null;
  private tones:OscillatorNode[]=[];
  private getAudio(){return this.audio=this.element()??this.audio;}
  constructor(private element:()=>HTMLAudioElement|null=()=>null) {}
  attach(audio:HTMLAudioElement|null){this.audio=audio;}
  async unlock() {
    const audio=this.getAudio(); if(!audio) return;
    this.desired=false;this.cancel();const generation=this.generation;audio.volume=0;audio.currentTime=0;
    if(typeof window!=='undefined'&&window.AudioContext){this.context??=new window.AudioContext();void this.context.resume().catch(()=>{});}
    await audio.play();if(generation!==this.generation)return;audio.pause();audio.currentTime=0;
  }
  private cancel(){this.generation++;cancelAnimationFrame(this.frame);}
  pause(){this.desired=false;this.cancel();this.getAudio()?.pause();for(const tone of this.tones){try{tone.stop();}catch{}}this.tones=[];}
  async play(volume:number){
    const audio=this.getAudio();if(!audio) return;
    this.desired=true;this.cancel();const generation=this.generation;
    await audio.play();if(generation!==this.generation){if(!this.desired)audio.pause();return;}
    this.fade(volume,600,false);
  }
  fade(volume:number,duration=600,stop=false){
    this.cancel();const audio=this.getAudio();if(!audio)return;
    const start=performance.now(),from=audio.volume,generation=this.generation;
    const tick=()=>{
      if(generation!==this.generation)return;
      const t=Math.min(1,(performance.now()-start)/duration);
      audio.volume=Math.max(0,Math.min(1,from+(volume-from)*t));
      if(t<1)this.frame=requestAnimationFrame(tick);else{this.frame=0;if(stop)audio.pause();}
    };this.frame=requestAnimationFrame(tick);
  }
  stop(){this.desired=false;this.fade(0,650,true);}
  warning(){
    const context=this.context;if(!context||context.state!=='running')return;
    for(const delay of [0,.38,.76]){
      const tone=context.createOscillator(),gain=context.createGain(),start=context.currentTime+delay;
      tone.type='sine';tone.frequency.setValueAtTime(190,start);tone.frequency.linearRampToValueAtTime(280,start+.18);
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.035,start+.015);gain.gain.linearRampToValueAtTime(0,start+.22);
      tone.connect(gain);gain.connect(context.destination);tone.start(start);tone.stop(start+.23);this.tones.push(tone);
    }
  }
  dispose(){this.pause();void this.context?.close();this.context=null;}
}
