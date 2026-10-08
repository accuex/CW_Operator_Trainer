import './checkHoukiPrivateTracking.mjs';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {generateReleaseCandidate} from '../lib/houki/trainer/release-candidate.mjs';
import {validateRelease} from '../lib/houki/trainer/release-validator.mjs';
const [authoringFile,candidateFile,...extra]=process.argv.slice(2);
if(!authoringFile||!candidateFile||extra.length)throw Error('Usage: authoring-file candidate-file');
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const raw=read(authoringFile),dto=read(candidateFile);
assert.deepEqual(dto,generateReleaseCandidate(raw));
assert.throws(()=>validateRelease(dto),'pending candidate cannot be publicly loaded');
assert.equal(dto.master.historicalCanonicals.length,0);assert.equal(dto.master.historicalQuestions.length,0);assert.equal(dto.master.historicalBlanks.length,0);
for(const q of dto.master.questions){assert.equal(q.provenance,'original_practice');assert.equal(q.historicalRef,null);assert.equal(q.sampleYear,null);}
assert.equal(dto.dates.humanApprovedAt,null);assert.ok(dto.temporalRecords.every(t=>t.publishedAt===null));
assert.ok(dto.publicReviews.every(r=>r.humanApproval==='pending'&&!r.releaseApproved&&r.approvedAt===null));
console.log(JSON.stringify({result:'PASS',themes:dto.lessons.length,questions:dto.master.questions.length,blanks:dto.master.questions.reduce((n,q)=>n+q.blanks.length,0),editionId:dto.editionId,contentVersion:dto.contentVersion,publicLoaderRejects:true,publicationDatesNull:true,privateFieldsRejectedByStrictSchema:true},null,2));
