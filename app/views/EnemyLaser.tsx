'use client';
import { memo, useId } from 'react';
import type { MorseTimeline } from '@/lib/types';
import { laserSegments, LASER_IMPACT_Y } from '@/lib/arcade/laser';

export const EnemyLaser = memo(function EnemyLaser({ x,y,timeline,elapsed,window,hints,phase,correct,impactProgress }: {
  x:number; y:number; timeline:MorseTimeline; elapsed:number; window:number; hints:boolean;
  phase:'sending'|'answer'|'feedback'; correct:boolean; impactProgress:number;
}) {
  const clipId=useId().replace(/:/g,'');
  if (phase==='feedback' && correct && impactProgress>=1) return null;
  const segments=laserSegments(timeline,phase==='sending'?elapsed:window,hints,window,y);
  const tip=segments.length ? Math.max(...segments.map(segment=>segment.y+segment.length)) : y;
  const impact=phase==='feedback'&&!correct ? Math.min(1,impactProgress) : 0;
  return <g className="guard-enemy-laser" data-laser-x={x} data-laser-origin-y={y} data-laser-hints={hints}>
    {hints && <defs>{segments.map((segment,i)=><clipPath key={i} id={`${clipId}-${i}`} clipPathUnits="userSpaceOnUse">
      <rect x={x-12} y={segment.y} width="24" height={segment.length}/>
    </clipPath>)}</defs>}
    {segments.map((segment,i)=><g key={i} clipPath={hints ? `url(#${clipId}-${i})` : undefined} strokeLinecap="butt">
      <path className="guard-laser-glow" d={`M${x} ${segment.y} v${segment.length}`} stroke="#e8a928" strokeWidth="9" strokeOpacity=".22" fill="none"/>
      <path className="guard-laser-core" d={`M${x} ${segment.y} v${segment.length}`} stroke="#ffe16c" strokeWidth="4" fill="none"/>
      <path d={`M${x} ${segment.y} v${segment.length}`} stroke="#fff7c4" strokeWidth="1" fill="none"/>
    </g>)}
    {impact>0 && <path className="guard-laser-impact" d={`M${x} ${tip} V${tip+(LASER_IMPACT_Y-tip)*impact}`} stroke="#ffe16c" strokeWidth="4" fill="none"/>}
    {impact>=1 && <path d={`M${x-8} ${LASER_IMPACT_Y+5} l8-10 8 10 M${x-8} ${LASER_IMPACT_Y-5} l16 10`} stroke="#ffd266" strokeWidth="3" fill="none"/>}
  </g>;
});
