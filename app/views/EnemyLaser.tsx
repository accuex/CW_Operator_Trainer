'use client';
import { memo, useId } from 'react';
import type { MorseTimeline } from '@/lib/types';
import { laserSegments, LASER_IMPACT_Y, laserTravelSeconds } from '@/lib/arcade/laser';

export const EnemyLaser = memo(function EnemyLaser({ x,y,timeline,elapsed,window,hints,phase,correct,impactProgress,tone="gold",power=1 }: {
  x:number; y:number; timeline:MorseTimeline; elapsed:number; window:number; hints:boolean;
  phase:'sending'|'answer'|'feedback'; correct:boolean; impactProgress:number; tone?:'gold'|'red'; power?:number;
}) {
  const clipId=useId().replace(/:/g,'');
  if (phase==='feedback' && correct && impactProgress>=1) return null;
  const segments=elapsed>=laserTravelSeconds(y)?[]:laserSegments(timeline,elapsed,hints,window,y);
  const impacted=phase==='feedback'&&!correct && elapsed>=laserTravelSeconds(y);
  return <g className="guard-enemy-laser" data-laser-x={x} data-laser-origin-y={y} data-laser-hints={hints} data-laser-tone={tone}>
    {hints && <defs>{segments.map((segment,i)=><clipPath key={i} id={`${clipId}-${i}`} clipPathUnits="userSpaceOnUse">
      <rect x={x-12} y={segment.y} width="24" height={segment.length}/>
    </clipPath>)}</defs>}
    {segments.map((segment,i)=><g key={i} clipPath={hints ? `url(#${clipId}-${i})` : undefined} strokeLinecap="butt">
      <path className="guard-laser-glow" d={`M${x} ${segment.y} v${segment.length}`} stroke={tone==='red'?'#ff4739':'#e8a928'} strokeWidth={6*power} strokeOpacity={.16*power} fill="none"/>
      <path className="guard-laser-core" d={`M${x} ${segment.y} v${segment.length}`} stroke={tone==='red'?'#ff6254':'#ffe16c'} strokeWidth={4*power} fill="none"/>
      <path d={`M${x} ${segment.y} v${segment.length}`} stroke={tone==='red'?'#fff0df':'#fff7c4'} strokeWidth="1" fill="none"/>
    </g>)}
    {impacted && <path className="guard-laser-impact" d={`M${x-8} ${LASER_IMPACT_Y+5} l8-10 8 10 M${x-8} ${LASER_IMPACT_Y-5} l16 10`} stroke="#ffd266" strokeWidth="3" fill="none"/>}
  </g>;
});
