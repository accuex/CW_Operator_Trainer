import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import HoukiTrainerView from '../../../app/views/HoukiTrainerView';
import {validateTrainer,questionOrder,toggleRevealed,readLocation,trainerPath,loadTrainerMaster} from './engine';
import type {TrainerMaster} from './types';
const sample=JSON.parse(readFileSync('public/houki/trainer/original-samples-v1.json','utf8')) as TrainerMaster;
describe('production trainer samples and release safety',()=>{
 it('loads only original authored samples, not verified law or real exams',()=>{expect(validateTrainer(sample)).toBe(sample);expect(sample.notes).toHaveLength(2);expect(sample.questions).toHaveLength(3);expect(sample.questions.every(q=>q.historicalRef===null&&q.provenance==='original_sample')).toBe(true);expect(sample.reviews.every(r=>!r.releaseApproved)).toBe(true);});
 it('rejects pending/incorrect-version reviews, missing dependencies, private evidence and duplicates',()=>{
  const mutations=[(d:TrainerMaster)=>{d.reviews[0].rights='pending';},(d:TrainerMaster)=>{d.reviews[0].contentRef.version=2;},(d:TrainerMaster)=>{d.rules[0].conditionIds=['missing'];},(d:TrainerMaster)=>{d.notes[0].explanation='private:raw';},(d:TrainerMaster)=>{d.questions.push(d.questions[0]);},(d:TrainerMaster)=>{d.questions[0].tokens.push(d.questions[0].tokens[1]);},(d:TrainerMaster)=>{d.sources[0].url='https://laws.e-gov.go.jp/law/example';}];
  for(const change of mutations){const d=structuredClone(sample);change(d);expect(()=>validateTrainer(d)).toThrow();}
 });
 it('does not promote staging/verified alone to approved release',()=>{const d=structuredClone(sample);d.edition='approved_release';expect(()=>validateTrainer(d)).toThrow();});
 it('filters both dimensions with empty results supported',()=>{expect(questionOrder(sample.questions,'2025','sample-delivery',false,1).map(x=>x.id)).toEqual(['sample-question-2']);expect(questionOrder(sample.questions,'2025','sample-library',false,1)).toEqual([]);});
 it('random order is deterministic, complete, varies across seeds and does not mutate master',()=>{const original=sample.questions.map(q=>q.id);const runs=Array.from({length:20},(_,seed)=>questionOrder(sample.questions,'all','all',true,seed).map(x=>x.id));expect(new Set(runs.map(x=>x.join())).size).toBeGreaterThan(1);for(const r of runs)expect([...r].sort()).toEqual([...original].sort());expect(questionOrder(sample.questions,'all','all',true,7)).toEqual(questionOrder(sample.questions,'all','all',true,7));expect(sample.questions.map(q=>q.id)).toEqual(original);});
 it('reveal state operates on printed positions without canonical variants',()=>{const ids=sample.questions[0].blanks.map(b=>b.printedPositionId);expect(toggleRevealed([],ids[0])).toEqual([ids[0]]);expect(toggleRevealed([ids[0]],ids[0])).toEqual([]);expect(ids).toHaveLength(2);});
 it('deep URL preserves selection, filters and random seed',()=>{const loc=readLocation('?mode=sheet&question=sample-question-3&chapter=sample-library&year=2026&random=1&seed=9');expect(readLocation(trainerPath(loc).split('?')[1])).toEqual(loc);expect(readLocation('?mode=unexpected').mode).toBe('home');expect(readLocation('?seed=bad').seed).toBe(0);});
 it('public shell offers two modes and existing 28 without loading historical texts',()=>{const html=renderToStaticMarkup(createElement(HoukiTrainerView,{onBack:()=>{}}));for(const text of ['法規トレーナー','参考書で学ぶ','赤シートで特訓','既存28句'])expect(html).toContain(text);expect(html).not.toContain('staging-k4a');});
 it('loader handles failed HTTP and malformed data',async()=>{
  const original=globalThis.fetch;
  try{globalThis.fetch=async()=>new Response('',{status:404});await expect(loadTrainerMaster()).rejects.toThrow();globalThis.fetch=async()=>Response.json({});await expect(loadTrainerMaster()).rejects.toThrow();}finally{globalThis.fetch=original;}
 });
});
