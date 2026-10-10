import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {BossEnemy,BOSS_SIZE,BOSS_MUZZLE_Y} from '../../app/views/BossEnemy';
import {EnemyLaser} from '../../app/views/EnemyLaser';
import {buildMorseTimeline} from '../timing';
import {DEFAULT_SETTINGS} from '../storage';
import {createBossGame,enemyPosition,bossDrone,MODES} from './cwGuard';
import {laserTravelSeconds,transmissionWindow} from './laser';
describe('official boss sprites and red continuous laser',()=>{
 it('uses only the official normal/awake/damage/defeat crops and never creates a third-form sprite',()=>{
  for(const form of ['normal','awakened','final'] as const){
   const html=renderToStaticMarkup(React.createElement(BossEnemy,{form,frame:1}));
   expect(html).toContain(`/assets/pcclub/boss/${form==='normal'?'normal':'awake'}-2.webp`);expect(html).toContain(`width="${BOSS_SIZE}"`);
   expect(html).not.toContain('final.webp');expect(html).not.toContain('<text');
  }
  const hit=renderToStaticMarkup(React.createElement(BossEnemy,{form:'awakened',pose:'hit'}));expect(hit).toContain('hit.webp');
  const end=renderToStaticMarkup(React.createElement(BossEnemy,{form:'final',pose:'defeat',age:1.6}));for(const sprite of ['defeat','debris','explosion'])expect(end).toContain(`${sprite}.webp`);
 });
 it('has transparent fixed-size WebPs with clear borders, official input hash and manageable weight',async()=>{
  const manifest=JSON.parse(readFileSync('assets/pcclub/boss-frame-manifest.json','utf8'));expect(manifest.frames).toHaveLength(12);
  expect(manifest.sourceSha256).toBe(createHash('sha256').update(readFileSync(manifest.source)).digest('hex'));
  for(const f of manifest.frames){const meta=await sharp(f.path).metadata();expect([meta.width,meta.height]).toEqual([320,320]);expect(meta.hasAlpha).toBe(true);expect(meta.format).toBe('webp');expect(f.bytes).toBeLessThan(60000);
   const {data}=await sharp(f.path).ensureAlpha().raw().toBuffer({resolveWithObject:true});for(const pos of [0,319,320*319,320*320-1])expect(data[pos*4+3]).toBe(0);
  }
 });
 it('keeps boss muzzle below the sprite and flight later than audio completion in every mode',()=>{
  for(const mode of ['beginner','standard','expert'] as const){const g=createBossGame(mode,73),p=enemyPosition(g,bossDrone(g)!);
   expect(p.x).toBeGreaterThanOrEqual(110);expect(p.x).toBeLessThanOrEqual(490);
   for(const wpm of [MODES[mode].wpm+2,MODES[mode].wpm+4,MODES[mode].wpm+6])expect(laserTravelSeconds(p.y+BOSS_MUZZLE_Y)-transmissionWindow(MODES[mode].pool,wpm)).toBeGreaterThan(2);
  }
 });
 it('renders one red unsegmented core for all symbols, using the same physical clock and origin',()=>{
  for(const letter of ['A','N','S','O']){const timeline=buildMorseTimeline(letter,'international',{...DEFAULT_SETTINGS,characterSpeed:30,effectiveSpeed:30});
   const html=renderToStaticMarkup(React.createElement(EnemyLaser,{x:300,y:145,timeline,elapsed:1.5,window:transmissionWindow(MODES.expert.pool,30),hints:false,tone:'red',phase:'answer',correct:false,impactProgress:0}));
   expect(html.match(/guard-laser-core/g)).toHaveLength(1);expect(html).toContain('stroke="#ff6254"');expect(html).toContain('data-laser-hints="false"');expect(html).not.toContain('clipPath');
  }
 });
});
