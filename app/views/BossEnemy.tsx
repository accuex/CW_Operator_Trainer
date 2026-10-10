'use client';
import { memo } from 'react';
import type { BossForm } from '@/lib/arcade/cwGuard';
export const BOSS_SIZE=184, BOSS_MUZZLE_Y=52;
export const BossEnemy=memo(function BossEnemy({form,frame=0,pose='idle',age=0}:{form:BossForm;frame?:number;pose?:'idle'|'charge'|'send'|'hit'|'defeat'|'awakening';age?:number}){
  const defeated=pose==='defeat';
  const sprite=defeated?'defeat':pose==='hit'?'hit':form==='final'&&frame%4===0?'smoke':form==='final'&&frame%4===2?'damage':`${form==='normal'?'normal':'awake'}-${frame%3+1}`;
  const size=BOSS_SIZE;
  return <g className={`guard-boss guard-boss-${form} guard-boss-${pose}`} data-boss-form={form} data-boss-pose={pose}>
    {!defeated&&<ellipse cx="0" cy="8" rx="80" ry="59" fill={form==='normal'?'#64aaff':'#ff5649'} opacity={pose==='awakening'?.2:.04}/>}
    <g transform={pose==='hit'?`translate(${Math.sin(age*55)*3} 0)`:defeated?`translate(0 ${Math.min(15,age*5)}) rotate(${Math.sin(age*8)*4})`:undefined} opacity={defeated?Math.max(0,1-Math.max(0,age-1.7)/1.3):1}>
      <image href={`/assets/pcclub/boss/${sprite}.webp`} x={-size/2} y={-size/2} width={size} height={size}/>
    </g>
    {defeated&&age>.5&&<image href="/assets/pcclub/boss/debris.webp" x={-size/2-35-age*8} y={-20+age*12} width="80" height="80" opacity={Math.max(0,1-age/3)}/>}
    {defeated&&age>1.4&&<image href="/assets/pcclub/boss/explosion.webp" x={-size*.7} y={-size*.65} width={size*1.4} height={size*1.4} opacity={Math.max(0,1-(age-1.4)/1.6)}/>}
    {pose==='charge'&&<circle r="50" cy="15" fill="none" stroke="#ff7b56" strokeWidth="2" strokeDasharray="5 8"/>}
  </g>;
});
