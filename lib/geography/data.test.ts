import {afterEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import GeographyLoading from '../../app/views/geography/GeographyLoading';
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
describe('geography load progress',()=>{
 it('counts parsed files and shares the existing cached load across observers',async()=>{
  const {loadGeography,GEOGRAPHY_FILE_COUNT}=await import('./data');
  const resolve:Array<(value:Response)=>void>=[];
  const fetch=vi.fn(()=>new Promise<Response>(r=>resolve.push(r)));vi.stubGlobal('fetch',fetch);
  const a:number[]=[],b:number[]=[];const first=loadGeography(p=>a.push(p.completed));const second=loadGeography(p=>b.push(p.completed));
  expect(fetch).toHaveBeenCalledTimes(GEOGRAPHY_FILE_COUNT);expect(a).toEqual([0]);expect(b).toEqual([0]);
  for(let i=0;i<resolve.length;i++){resolve[i](Response.json({entities:[]}));await new Promise(r=>setTimeout(r,0));expect(a.at(-1)).toBe(i+1);}
  expect(await first).toBe(await second);expect(a).toEqual(b);expect(a.at(-1)).toBe(12);
  const cached:number[]=[];await loadGeography(p=>cached.push(p.completed));expect(cached).toEqual([12]);expect(fetch).toHaveBeenCalledTimes(12);
 });
 it('failed requests can retry without old pending files contaminating progress',async()=>{
  const {loadGeography}=await import('./data');const resolves:Array<(value:Response)=>void>=[];
  vi.stubGlobal('fetch',()=>new Promise<Response>(r=>resolves.push(r)));
  const first=loadGeography();const rejection=expect(first).rejects.toThrow('教材読込失敗');resolves[0](new Response('',{status:500}));await rejection;
  const counts:number[]=[];const retry=loadGeography(p=>counts.push(p.completed));
  resolves.slice(1,12).forEach(r=>r(Response.json({entities:[]})));await new Promise(r=>setTimeout(r,0));expect(counts).toEqual([0]);
  resolves.slice(12).forEach(r=>r(Response.json({entities:[]})));await retry;expect(counts.at(-1)).toBe(12);expect(Math.max(...counts)).toBe(12);
 });
 it('does not count a response until its JSON is usable',async()=>{
  const {loadGeography}=await import('./data');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('invalid-json')));
  const counts:number[]=[];await expect(loadGeography(p=>counts.push(p.completed))).rejects.toThrow();expect(counts).toEqual([0]);
 });
 it('exposes native progress, live status and an escape action without a fake time estimate',()=>{
  const html=renderToStaticMarkup(createElement(GeographyLoading,{completed:7,total:12,onBack:()=>{}}));
  expect(html).toContain('max="12" value="7"');expect(html).toContain('role="status"');expect(html).toContain('aria-busy="true"');expect(html).toContain('一総通へ戻る');expect(html).not.toContain('秒');
 });
});
