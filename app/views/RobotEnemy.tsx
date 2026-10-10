'use client';
import { memo } from 'react';
export type RobotPose='idle'|'left'|'right'|'charge'|'send'|'hit'|'defeat'|'enter';
export const ROBOT_SIZE=112;
export const ROBOT_MUZZLE_Y=32;
export const RobotEnemy=memo(function RobotEnemy({pose,frame=0,progress=0}:{pose:RobotPose;frame?:number;progress?:number}){
  const sprite=['idle','enter'].includes(pose) ? `idle-${frame%2+1}` : pose;
  return <g data-enemy-state={pose} className={`guard-robot guard-robot-${pose}`}>
    <g transform={pose==='defeat' ? `translate(0 ${progress*25}) rotate(${progress*35})` : undefined} opacity={pose==='defeat'?1-progress:1}>
      <image href={`/assets/pcclub/robot/${sprite}.webp`} x={-ROBOT_SIZE/2} y={-ROBOT_SIZE/2} width={ROBOT_SIZE} height={ROBOT_SIZE}/>
    </g>
  </g>;
});
