// Local content QA. Reads ignored authoring/evidence; never generates a public DTO.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {validateReviewPreview,validateRelease} from '../lib/houki/trainer/release-validator.mjs';
const base=resolve('docs/1sou_houki/StageK4-K/private');
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const raw=await read(resolve(base,'batch1.authoring.json'));
assert.equal(raw.releaseApproved,false);assert.equal(raw.humanPublicApproval,'pending');assert.equal(raw.environment,'local_review_only');
const d=validateReviewPreview(raw.displayData);assert.throws(()=>validateRelease(d));
const old=(await read('docs/1sou_houki/StageK4-J/private/batch1.authoring.json')).displayData;
// Old immutable edition remains on disk; allow only audit-recorded local entity changes.
const diff = await read(resolve(base,'new_old_diff.json'));
const allowed=new Set(diff.changedEntities.map(x=>x.registry+'/'+x.id));
for(const [registry,items] of Object.entries(old.master))if(Array.isArray(items))for(const item of items){const current=d.master[registry].find(x=>x.id===item.id);assert.ok(current,`missing old ${registry}/${item.id}`);if(!allowed.has(registry+'/'+item.id))assert.deepEqual(current,item,`unrecorded edit ${registry}/${item.id}`);}
for(const lesson of old.lessons){const current=d.lessons.find(x=>x.id===lesson.id);assert.ok(current);if(!allowed.has('lessons/'+lesson.id))assert.deepEqual(current,lesson);}
assert.equal(diff.oldQuestions,124);assert.equal(diff.oldThemes,37);assert.equal(diff.oldBlanks,247);
for(const q of old.master.questions)assert.deepEqual(d.master.questions.find(x=>x.id===q.id).blanks,q.blanks,'old answers/blank IDs unchanged');
const added=d.lessons.filter(l=>!old.lessons.some(x=>x.id===l.id));assert.equal(added.length,4);
for(const l of added){assert.ok(l.questionIds.length>=3&&l.questionIds.length<=5);assert.ok(l.sourceIds.length);}
for(const q of d.master.questions){assert.equal(q.provenance,'original_practice');assert.equal(q.historicalRef,null);assert.ok(q.explanation.trim());const ids=q.tokens.filter(t=>t.kind==='blank').map(t=>t.blankId);assert.equal(ids.length,q.blanks.length);assert.equal(new Set(ids).size,ids.length);for(const b of q.blanks){assert.equal(ids.filter(x=>x===b.id).length,1);assert.ok(b.answer.trim());}}
assert.equal(new Set(d.master.chapters.map(c=>c.title)).size,d.master.chapters.length,'duplicate chapter title');
const scope=await read('docs/1sou_houki/StageK4-K/K4K_scope.json');
const registry=(await read('docs/1sou_houki/StageK3-N/priority1_effective_status_registry.json')).entries;
const evidence=await read(resolve(base,'batch1.evidence.json'));
assert.deepEqual(evidence.themes.map(t=>t.themeId).sort(),scope.selected.map(t=>t.themeId).sort());
assert.equal(old.lessons.length,37); assert.equal(old.master.questions.length,124); assert.equal(old.master.questions.reduce((n,q)=>n+q.blanks.length,0),247);
for(const selected of scope.selected)for(const id of selected.canonicalIds){const r=registry.find(r=>r.historicalCanonicalId===id);assert.ok(r);assert.equal(r.effectiveStatus,'verified');assert.equal(r.explicitEightGatesComplete,true);assert.notEqual(r.publicEligibility,'blocked');}
for(const t of evidence.themes){const r=registry.find(r=>r.queueRank===t.queue);assert.ok(r);assert.equal(r.historicalCanonicalId,t.canonicalId);assert.equal(r.effectiveStatus,'verified');assert.equal(r.explicitEightGatesComplete,true);assert.notEqual(r.publicEligibility,'blocked');}

const manifest=await read('docs/1sou_houki/StageK3-N/private/complete_source_manifest.json');
for(const t of evidence.themes){assert.equal(t.selectionVerification,'verified');assert.equal(t.publicApproved,false);for(const s of t.sources){const bytes=await readFile(s.sourceFile);assert.equal(createHash('sha256').update(bytes).digest('hex'),s.sourceHash);const saved=manifest.find(m=>m.sourceFile===s.sourceFile&&m.originalMetadata);assert.ok(saved);assert.equal(s.sourceHash,saved.hash);assert.equal(s.retrievedAt,saved.retrievedAt);assert.equal(s.revision,saved.originalMetadata.revisionInfo.law_revision_id);assert.equal(s.effectiveDate,saved.originalMetadata.revisionInfo.amendment_enforcement_date);assert.ok(s.effectiveDate<='2026-10-07');assert.equal(saved.originalMetadata.futureRevisionUsed,false);let n=JSON.parse(bytes);for(const p of s.pointer.split('/').slice(1))n=n[p];assert.deepEqual(n,s.exactArticle);assert.equal(n.tag,'Article');assert.equal(n.attr.Num,s.article);}}
for(const s of evidence.supportingTableEvidence??[]){const bytes=await readFile(s.sourceFile);assert.equal(createHash('sha256').update(bytes).digest('hex'),s.sourceHash);let n=JSON.parse(bytes);for(const p of s.pointer.split('/').slice(1))n=n[p];assert.deepEqual(n,s.exactNode);assert.equal(n.tag,'AppdxTable');}
console.log(JSON.stringify({result:'PASS',schema:'PASS',retainedExistingThemes:old.lessons.length,auditRecordedChangedEntities:diff.changedEntities.length,oldBlankAnswersUnchanged:true,addedThemes:added.length,questions:d.master.questions.length,blanks:d.master.questions.reduce((n,q)=>n+q.blanks.length,0),pendingReleaseRejected:true,sourceHashesAndPointers:'PASS',humanApproval:false},null,2));
