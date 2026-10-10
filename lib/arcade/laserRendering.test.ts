import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it,expect } from 'vitest';
import { writeFileSync,readFileSync } from 'node:fs';
import { EnemyLaser } from '../../app/views/EnemyLaser';
import { buildMorseTimeline } from '../timing';
import { DEFAULT_SETTINGS } from '../storage';
import { transmissionWindow,laserSegments } from './laser';

const signal=(symbol:string,wpm:number)=>buildMorseTimeline(symbol,'international',{...DEFAULT_SETTINGS,characterSpeed:wpm,effectiveSpeed:wpm});
const svg=(symbol:string,wpm:number,origin:number,hints:boolean,time?:number)=>{
  const timeline=signal(symbol,wpm), window=transmissionWindow('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',wpm);
  return renderToStaticMarkup(React.createElement('svg',{viewBox:'0 0 600 390'},
    React.createElement('rect',{width:600,height:390,fill:'#071427'}),
    React.createElement('path',{d:`M270 ${origin-16} L300 ${origin-31} L330 ${origin-16} L300 ${origin-1} Z`,fill:'#1c6b91',stroke:'#9debff'}),
    React.createElement('path',{d:'M0 297H600',stroke:'#275275'}),
    React.createElement(EnemyLaser,{x:300,y:origin,timeline,elapsed:time??window,window,hints,phase:'sending',correct:false,impactProgress:0})
  ));
};
describe('laser glow containment',()=>{
  it('clips all ON layers at exact segment ends, leaving gaps free of axial glow',()=>{
    for(const wpm of [16,20,30,40]) for(const symbol of ['A','N','S','O','5','0']){
      const t=signal(symbol,wpm), window=transmissionWindow('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',wpm);
      const markup=svg(symbol,wpm,269,true);
      const segments=laserSegments(t,window,true,window,269);
      expect((markup.match(/<clipPath /g)||[]).length).toBe(t.tones.length);
      expect((markup.match(/clip-path="url/g)||[]).length).toBe(t.tones.length);
      expect((markup.match(/stroke-linecap="butt"/g)||[]).length).toBe(t.tones.length);
      for(const segment of segments) expect(markup).toContain(`y="${segment.y}" width="24" height="${segment.length}"`);
    }
  });
  it('leaves OFF as one uninterrupted beam with no segment clips',()=>{
    const markup=svg('A',40,269,false);
    expect(markup).not.toContain('<clipPath');
    expect((markup.match(/class="guard-laser-core"/g)||[]).length).toBe(1);
    expect(markup).toContain('M300 269 v18');
  });
});

// Optional local QA artifact: actual component, actual timings; no game/audio changes.
if(process.env.CWOT_LASER_QA_HTML){
  const cases=Object.fromEntries([16,20,30,40].flatMap(wpm=>['A','N','S','O','5','0'].flatMap(symbol=>[222,269].flatMap(origin=>[true,false].map(hints=>{
    const timeline=signal(symbol,wpm);
    return [`${wpm}-${symbol}-${origin}-${hints}`,{duration:timeline.duration,frames:Array.from({length:61},(_,i)=>svg(symbol,wpm,origin,hints,timeline.duration*i/60))}];
  })))));
  const css=readFileSync('app/styles/views/computer-club.css','utf8');
  writeFileSync(process.env.CWOT_LASER_QA_HTML,`<!doctype html><meta charset="utf-8"><title>CWレーザー描画検証</title><style>${css}\nbody{background:#071427;color:white;font:16px sans-serif;margin:12px}button,select{font-size:16px;padding:8px;margin:3px}#board{max-width:600px}svg{width:100%;display:block}label{display:inline-block}</style><h1>CWレーザー描画検証</h1><p>実コンポーネント・音声なし。ゲームの速度設定は変更しません。</p><label>WPM<select id="speed">${[16,20,30,40].map(n=>'<option>'+n+'</option>').join('')}</select></label><label>符号<select id="symbol">${['A','N','S','O','5','0'].map(n=>'<option>'+n+'</option>').join('')}</select></label><label>発射位置<select id="origin"><option>222</option><option>269</option></select></label><label><input id="hints" type="checkbox" checked>符号ON</label><button id="play">描画再生</button><div id="board"></div><script>const cases=${JSON.stringify(cases)};let run=0;const selectors=['speed','symbol','origin','hints'];function current(){return cases[selectors.map(id=>id==='hints'?document.getElementById(id).checked:document.getElementById(id).value).join('-')]}function show(){run++;board.innerHTML=current().frames[60]}selectors.forEach(id=>document.getElementById(id).onchange=show);play.onclick=()=>{const token=++run,c=current(),start=performance.now();function frame(now){if(token!==run)return;const n=Math.min(60,Math.floor((now-start)/1000/c.duration*60));board.innerHTML=c.frames[n];if(n<60)requestAnimationFrame(frame)}requestAnimationFrame(frame)};show()</script>`);
}
