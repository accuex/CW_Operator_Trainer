import {describe,it,expect,vi} from 'vitest';
import {readFileSync,mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LessonPlayer} from '../../../app/components/houki/LessonPlayer';
import {generateRelease,validateRelease} from './release-validator.mjs';
import {generateReleaseCandidate} from './release-candidate.mjs';
import {loadLessonRelease} from './lesson-loader';
const original=JSON.parse(readFileSync('data/houki/original-samples.authoring.json','utf8'));
function pending(){
 const dto=generateRelease(structuredClone(original));dto.master.edition='internal_review';
 for(const n of dto.master.notes){n.effectiveStatus='verified';n.publicEligibility='needs_context';}
 for(const q of dto.master.questions){q.provenance='original_practice';q.sampleYear=null;}
 for(const r of dto.master.reviews){r.humanApproval='pending';r.rights='pending';r.purpose=dto.master.questions.some(q=>q.id===r.contentRef.id)?'original_practice':dto.master.cards.some(c=>c.id===r.contentRef.id&&c.kind==='amendment')?'amendment':'current_note';}
 for(const r of dto.publicReviews){r.purpose=r.purpose.replace('sample:','release:');r.humanApproval='pending';r.rights='pending';}
 return {environment:'local_review_only',releaseApproved:false,publishedAt:null,humanPublicApproval:'pending',displayData:dto,privateEvidence:{secret:'never-distribute'}};
}
// Test-only approval fixture. Never corresponds to actual reviewed law content.
function approvedTestFixture(){
 const d=pending().displayData;d.master.edition='approved_release';d.contentVersion=9;d.dates.editorialVersion=9;
 for(const r of d.master.reviews){r.rights='cleared';r.humanApproval='approved';r.releaseApproved=true;}
 for(const r of d.publicReviews){r.rights='cleared';r.humanApproval='approved';r.releaseApproved=true;r.approvedAt='2026-10-08T00:00:00Z';}
 return d;
}
describe('internal release candidate and approved static activation',()=>{
 it('projects only delivery fields without granting approvals or changing its input',()=>{
  const a=pending(),before=JSON.stringify(a);const d=generateReleaseCandidate(a);
  expect(JSON.stringify(a)).toBe(before);expect(d).not.toBe(a.displayData);
  expect(JSON.stringify(d)).not.toContain('never-distribute');
  expect(d.publicReviews.every(r=>!r.releaseApproved&&r.humanApproval==='pending'&&r.approvedAt===null)).toBe(true);
  expect(()=>validateRelease(d)).toThrow();
 });
 it('refuses mixed approvals, publication dates, private fields and missing references',()=>{
  for(const mutate of [(a:any)=>a.releaseApproved=true,(a:any)=>a.publishedAt='2026-10-08',(a:any)=>a.displayData.temporalRecords[0].publishedAt='2026-10-08',(a:any)=>a.displayData.publicReviews[0].releaseApproved=true,(a:any)=>a.displayData.master.sources[0].sourceHash='secret',(a:any)=>a.displayData.lessons[0].questionIds=['missing']]){const a=pending();mutate(a);expect(()=>generateReleaseCandidate(a)).toThrow();}
 });
 it('keeps source/editing attribution distinct from the fictional sample notice',()=>{
  const d=pending().displayData;d.master.notes[0].asOfDate='2026-10-07';
  const render=()=>renderToStaticMarkup(createElement(LessonPlayer,{release:d,lessonId:d.lessons[0].id,openQuestion:()=>{}}));
  expect(render()).toContain('編集：CWOT');expect(render()).toContain('政府が作成した教材ではありません');
  d.master.notes[0].asOfDate=null;expect(render()).toContain('架空サンプル');expect(render()).not.toContain('編集：CWOT');
 });
 it('production loader refuses a pending candidate even when an index points to it',async()=>{
  const a=pending().displayData;const silence=vi.spyOn(console,'error').mockImplementation(()=>{});vi.stubGlobal('fetch',async(url:string)=>url.endsWith('active.json')?Response.json({schemaVersion:'1.0.0',contentVersion:a.contentVersion,file:`/houki/trainer/lessons-v${a.contentVersion}.json`}):Response.json(a));
  try{await expect(loadLessonRelease()).rejects.toThrow('形式');}finally{vi.unstubAllGlobals();silence.mockRestore();}
 });
 it('checks future approved static releases and prevents sample downgrade, without touching real public data',()=>{
  const temp=mkdtempSync(resolve(tmpdir(),'cwot-release-test-'));const script=resolve('scripts/generateHoukiLessons.mjs');
  const run=(...args:string[])=>spawnSync(process.execPath,[script,...args],{cwd:temp,encoding:'utf8'});
  try{
   mkdirSync(resolve(temp,'public/houki/trainer'),{recursive:true});mkdirSync(resolve(temp,'data/houki'),{recursive:true});
   writeFileSync(resolve(temp,'data/houki/original-samples.authoring.json'),JSON.stringify(original));
   expect(run().status).toBe(0);const index=readFileSync(resolve(temp,'public/houki/trainer/active.json'),'utf8');
   writeFileSync(resolve(temp,'pending.json'),JSON.stringify(pending().displayData));
   expect(run('--activate-reviewed','pending.json').status).not.toBe(0);
   expect(readFileSync(resolve(temp,'public/houki/trainer/active.json'),'utf8')).toBe(index);
   const fixture=approvedTestFixture();writeFileSync(resolve(temp,'approved-test.json'),JSON.stringify(fixture));
   expect(run('--activate-reviewed','approved-test.json').status).toBe(0);expect(run('--check').status).toBe(0);
   const activeIndex=readFileSync(resolve(temp,'public/houki/trainer/active.json'),'utf8');
   expect(run().status).not.toBe(0);expect(readFileSync(resolve(temp,'public/houki/trainer/active.json'),'utf8')).toBe(activeIndex);
   fixture.lessons[0].title='different content same version';writeFileSync(resolve(temp,'changed-test.json'),JSON.stringify(fixture));
   expect(run('--activate-reviewed','changed-test.json').status).not.toBe(0);
   expect(readFileSync(resolve(temp,'public/houki/trainer/active.json'),'utf8')).toBe(activeIndex);
  }finally{rmSync(temp,{recursive:true,force:true});}
 });
});
