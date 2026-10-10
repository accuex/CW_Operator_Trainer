'use client';
import { memo } from 'react';
import type { MorseTimeline } from '@/lib/types';
import { laserSegments, LASER_IMPACT_Y } from '@/lib/arcade/laser';

export const EnemyLaser = memo(function EnemyLaser({ x,y,timeline,elapsed,window,hints,phase,correct,impactProgress }: {
  x:number; y:number; timeline:MorseTimeline; elapsed:number; window:number; hints:boolean;
  phase:'sending'|'answer'|'feedback'; correct:boolean; impactProgress:number;
}) {
  if (phase==='feedback' && correct && impactProgress>=1) return null;
  const segments=laserSegments(timeline,phase==='sending'?elapsed:window,hints,window,y);
  const tip=segments.length ? segments[segments.length-1].y+segments[segments.length-1].length : y;
  const impact=phase==='feedback'&&!correct ? Math.min(1,impactProgress) : 0;
  return <g className="guard-enemy-laser" data-laser-x={x} data-laser-origin-y={y}>
    {segments.map((segment,i)=><g key={i}>
      <path className="guard-laser-glow" d={`M${x} ${segment.y} v${segment.length}`} stroke="#e8a928" strokeWidth="9" strokeOpacity=".22" fill="none"/>
      <path className="guard-laser-core" d={`M${x} ${segment.y} v${segment.length}`} stroke="#ffe16c" strokeWidth="4" fill="none"/>
      <path d={`M${x} ${segment.y} v${segment.length}`} stroke="#fff7c4" strokeWidth="1" fill="none"/>
    </g>)}
    {impact>0 && <path className="guard-laser-impact" d={`M${x} ${tip} V${tip+(LASER_IMPACT_Y-tip)*impact}`} stroke="#ffe16c" strokeWidth="4" fill="none"/>}
    {impact>=1 && <path d={`M${x-8} ${LASER_IMPACT_Y+5} l8-10 8 10 M${x-8} ${LASER_IMPACT_Y-5} l16 10`} stroke="#ffd266" strokeWidth="3" fill="none"/>}
  </g>;
});
