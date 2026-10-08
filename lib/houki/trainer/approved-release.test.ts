import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {validateRelease} from './release-validator.mjs';
import {questionOrder} from './engine';
const index=JSON.parse(readFileSync('public/houki/trainer/active.json','utf8'));
const release=JSON.parse(readFileSync('public'+index.file,'utf8'));
describe('law v1 approved release',()=>{
 it('active release retains approved counts and excludes historical originals',()=>{
  expect(validateRelease(release)).toBe(release);
  expect(index.contentVersion).toBe(6);expect(release.contentVersion).toBe(6);
  expect(release.master.edition).toBe('approved_release');
  expect(release.lessons).toHaveLength(41);expect(release.master.questions).toHaveLength(140);
  expect(release.master.questions.reduce((n:number,q:any)=>n+q.blanks.length,0)).toBe(279);
  expect(release.master.cards).toHaveLength(2);
  for(const key of ['historicalQuestions','historicalCanonicals','historicalBlanks'])expect(release.master[key]).toEqual([]);
  expect(release.master.questions.every((q:any)=>q.provenance==='original_practice'&&q.historicalRef===null)).toBe(true);
  expect(release.dates.verificationAsOf).toBe('2026-10-07');
 });
 it('individual version/use approval remains mandatory',()=>{
  for(const mutate of [(x:any)=>x.publicReviews[0].humanApproval='pending',(x:any)=>x.publicReviews[0].contentVersion++, (x:any)=>x.master.reviews[0].releaseApproved=false, (x:any)=>x.master.sources[0].sourceHash='private']){
   const x=structuredClone(release);mutate(x);expect(()=>validateRelease(x)).toThrow();
  }
 });
 it('filters and seeded repetition retain every practice exactly once',()=>{
  const all=questionOrder(release.master.questions,'all','all',true,42);
  expect(all).toHaveLength(140);expect(new Set(all.map((q:any)=>q.id)).size).toBe(140);
  expect(questionOrder(release.master.questions,'all','all',true,42)).toEqual(all);
  for(const c of release.master.chapters){const group=questionOrder(release.master.questions,'all',c.id,false,0);expect(group.every((q:any)=>q.chapterId===c.id)).toBe(true);}
 });
});
