// Local content QA. Reads ignored authoring/evidence; never generates a public DTO.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {validateReviewPreview,validateRelease} from '../lib/houki/trainer/release-validator.mjs';
const base=resolve('docs/1sou_houki/StageK4-H/private');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const raw=await read(resolve(base,'batch1.authoring.json'));
assert.equal(raw.releaseApproved,false);assert.equal(raw.humanPublicApproval,'pending');assert.equal(raw.environment,'local_review_only');
const d=validateReviewPreview(raw.displayData);assert.throws(()=>validateRelease(d));
const old=(await read('docs/1sou_houki/StageK4-G/private/batch1.authoring.json')).displayData;
for(const [registry,items] of Object.entries(old.master))if(Array.isArray(items))for(const item of items)assert.deepEqual(d.master[registry].find(x=>x.id===item.id),item,`existing ${registry}/${item.id}`);
for(const lesson of old.lessons)assert.deepEqual(d.lessons.find(x=>x.id===lesson.id),lesson);
for(const clock of old.temporalRecords)assert.deepEqual(d.temporalRecords.find(x=>x.entityId===clock.entityId),clock);
const added=d.lessons.filter(l=>!old.lessons.some(x=>x.id===l.id));assert.equal(added.length,10);
for(const l of added){assert.ok(l.questionIds.length>=3&&l.questionIds.length<=5);assert.ok(l.sourceIds.length);}
for(const q of d.master.questions){assert.equal(q.provenance,'original_practice');assert.equal(q.historicalRef,null);assert.ok(q.explanation.trim());const ids=q.tokens.filter(t=>t.kind==='blank').map(t=>t.blankId);assert.equal(ids.length,q.blanks.length);assert.equal(new Set(ids).size,ids.length);for(const b of q.blanks){assert.equal(ids.filter(x=>x===b.id).length,1);assert.ok(b.answer.trim());}}
const evidence=await read(resolve(base,'batch1.evidence.json'));
const manifest=await read('docs/1sou_houki/StageK3-N/private/complete_source_manifest.json');
for(const t of evidence.themes){assert.equal(t.selectionVerification,'verified');assert.equal(t.publicApproved,false);for(const s of t.sources){const bytes=await readFile(s.sourceFile);assert.equal(createHash('sha256').update(bytes).digest('hex'),s.sourceHash);const saved=manifest.find(m=>m.sourceFile===s.sourceFile&&m.originalMetadata);assert.ok(saved);assert.equal(s.sourceHash,saved.hash);assert.equal(s.retrievedAt,saved.retrievedAt);assert.ok(s.effectiveDate<='2026-10-07');assert.equal(saved.originalMetadata.futureRevisionUsed,false);let n=JSON.parse(bytes);for(const p of s.pointer.split('/').slice(1))n=n[p];assert.deepEqual(n,s.exactArticle);assert.equal(n.tag,'Article');assert.equal(n.attr.Num,s.article);}}
console.log(JSON.stringify({result:'PASS',schema:'PASS',unchangedExistingThemes:old.lessons.length,addedThemes:added.length,questions:d.master.questions.length,blanks:d.master.questions.reduce((n,q)=>n+q.blanks.length,0),pendingReleaseRejected:true,sourceHashesAndPointers:'PASS',humanApproval:false},null,2));
