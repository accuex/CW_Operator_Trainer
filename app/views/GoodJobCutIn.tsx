'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export const GOOD_JOB_MS=2800;
/** Presentation only: the authoritative score is already saved by the game. */
export function GoodJobCutIn({children}:{children:ReactNode}){
  const [done,setDone]=useState(false),[loaded,setLoaded]=useState(false);
  const button=useRef<HTMLButtonElement>(null),result=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(done)result.current?.querySelector('button')?.focus({preventScroll:true});else button.current?.focus({preventScroll:true});},[done]);
  useEffect(()=>{
    if(!loaded||done)return;
    let frame=0,elapsed=0,last=performance.now();
    const tick=(now:number)=>{
      if(!document.hidden)elapsed+=Math.min(100,now-last);
      last=now;
      if(elapsed>=GOOD_JOB_MS)setDone(true);else frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[loaded,done]);
  if(done)return <div ref={result}>{children}</div>;
  return <div className="guard-goodjob" role="dialog" aria-modal="true" aria-label="Good Job!! ミッションクリア" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setDone(true);}if(e.key==='Tab'){e.preventDefault();button.current?.focus();}}}>
    {/* Keep all lettering and the character visible; never crop the supplied art. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/assets/pcclub/laser/goodjob.png" alt="Good Job!! シグナル・マスター撃破。仲間が笑顔で健闘をたたえています。" width="1536" height="1024" onLoad={()=>setLoaded(true)} onError={()=>setDone(true)}/>
    <button ref={button} type="button" className="btn btn-primary" onClick={()=>setDone(true)}>スコアを見る →</button>
  </div>;
}
