import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { RobotEnemy,ROBOT_SIZE,ROBOT_MUZZLE_Y,type RobotPose } from '../../app/views/RobotEnemy';
import { createGame,dronePosition } from './cwGuard';
import { LASER_WAIT_Y } from './laser';
describe('CWOT robot sprites',()=>{
  it('maps every pose to a prepared sprite and stable bounds without visible answer text',()=>{
    for(const pose of ['idle','enter','left','right','charge','send','hit','defeat'] as RobotPose[]){
      const html=renderToStaticMarkup(React.createElement('svg',{},React.createElement(RobotEnemy,{pose,frame:1,progress:.5})));
      const frame=['idle','enter'].includes(pose)?'idle-2':pose==='right'?'left':pose==='left'?'right':pose;
      expect(html).toContain(`/assets/pcclub/robot/${frame}.webp`);
      expect(html).toContain(`width="${ROBOT_SIZE}" height="${ROBOT_SIZE}"`);
      expect(html).not.toContain('<text');
      expect(html).toContain(`data-enemy-state="${pose}"`);
    }
  });
  it('cycles moving sprites while leaning in the travel direction',()=>{
    for(const pose of ['left','right'] as const){
      const frames=Array.from({length:4},(_,frame)=>renderToStaticMarkup(React.createElement(RobotEnemy,{pose,frame})));
      expect(new Set(frames).size).toBe(3);
      expect(frames[2]).toContain('idle-1.webp');expect(frames[3]).toContain('idle-2.webp');
      expect(frames[2]).toContain(`rotate(${pose==='right'?8:-8})`);
    }
  });
  it('keeps the muzzle and large laser corridor at the same height for every squad',()=>{
    const game=createGame('expert',true,73);
    for(const drone of game.drones){
      const p=dronePosition(drone,20,1.5);
      expect(p.y).toBeGreaterThanOrEqual(75);expect(p.y).toBeLessThanOrEqual(79);
      expect(LASER_WAIT_Y-p.y-ROBOT_MUZZLE_Y).toBeGreaterThan(175);
      expect(p.x).toBe(115+122*drone.column+20);
    }
  });
  it('serves eight small alpha WebP frames of identical size with transparent borders',async()=>{
    const manifest=JSON.parse(readFileSync('assets/pcclub/robot-frame-manifest.json','utf8'));
    expect(manifest.frames).toHaveLength(8);
    for(const frame of manifest.frames){
      const meta=await sharp(frame.path).metadata();
      expect(meta.format).toBe('webp');expect(meta.hasAlpha).toBe(true);
      expect([meta.width,meta.height]).toEqual([256,256]);expect(frame.bytes).toBeLessThan(40000);
      const {data}=await sharp(frame.path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      expect([data[3],data[(256-1)*4+3],data[(256*256-1)*4+3]]).toEqual([0,0,0]);
    }
  });
});
