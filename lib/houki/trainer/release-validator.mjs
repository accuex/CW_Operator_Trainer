import Ajv from 'ajv';
import schema from './lesson.schema.json' with {type:'json'};
const ajv = new Ajv({allErrors:true, jsonPointers:true});
const check = ajv.compile(schema);
function validateLessonData(value,internalReview=false) {
 if (!check(value)) throw new Error('教材JSON schema: '+ajv.errorsText(check.errors));
 if(value.contentVersion<1||value.dates.editorialVersion!==value.contentVersion)throw Error('edition版不整合');
 const d=value.master;
 const groups=['chapters','notes','rules','conditions','questions','cards','amendments','sources','historicalCanonicals','historicalQuestions','historicalBlanks'];
 const maps=Object.fromEntries(groups.map(k=>[k,new Map(d[k].map(x=>[x.id,x]))]));
 for(const k of groups)if(maps[k].size!==d[k].length)throw Error('重複ID: '+k);
 // IDs are namespaced by registry (K4-D intentionally shares chapter/theme strings).
 const lessons=new Map(value.lessons.map(l=>[l.id,l]));if(lessons.size!==value.lessons.length)throw Error('重複lesson');
 const blockIds=new Set();const required=[];
 const ref=(kind,id)=>{if(!maps[kind].has(id))throw Error('参照欠落: '+kind+'/'+id);return maps[kind].get(id);};
 const need=(id,version,purpose)=>required.push({id,version,purpose});
 for(const k of groups)for(const x of d[k]){need(x.id,x.version??1,k);if('version' in x&&(!Number.isInteger(x.version)||x.version<1))throw Error('不正version');}
 for(const l of value.lessons){
  need(l.id,l.contentVersion,'lesson');if(l.contentVersion!==ref('notes',l.id).version||l.themeId!==l.id)throw Error('lesson version/theme不整合');ref('chapters',l.chapterId);
  for(const [ids,k] of [[l.questionIds,'questions'],[l.ruleIds,'rules'],[l.amendmentIds,'amendments'],[l.sourceIds,'sources']])for(const id of ids)ref(k,id);
  for(const b of l.blocks){if(blockIds.has(b.id)||b.contentVersion<1)throw Error('重複block/version');blockIds.add(b.id);need(b.id,b.contentVersion,'block:'+b.type);
   if(b.questionId){const q=ref('questions',b.questionId);if(q.themeId!==l.id||!l.questionIds.includes(q.id))throw Error('問題/テーマ不一致');}
   for(const id of b.ruleIds??[])if(!l.ruleIds.includes(ref('rules',id).id))throw Error('block rule scope不一致');
   for(const id of b.sourceIds??[])if(!l.sourceIds.includes(ref('sources',id).id))throw Error('block source scope不一致');
   for(const id of b.conditionIds??[])ref('conditions',id);
   if(b.cardId){const c=ref('cards',b.cardId);if(c.kind!==b.type||!ref('notes',l.id).cardIds.includes(c.id))throw Error('カードtype/scope不一致');}
  }
 }
 for(const q of d.questions){if(!lessons.has(q.themeId)||!lessons.get(q.themeId).questionIds.includes(q.id))throw Error('問題→lesson欠落');
  for(const b of q.blanks){need(b.id,b.version,'blank');if(q.historicalRef){const h=ref('historicalBlanks',b.id);if(h.historicalAnswer!==b.answer||h.printedPositionId!==b.printedPositionId||h.version!==b.version)throw Error('historical answer/position/version不一致');}}
 }
 // Only prerequisite composition is acyclic. Question↔lesson backlinks are intentional.
 const done=new Set(),active=new Set();function visit(id){if(active.has(id))throw Error('lesson composition循環');if(done.has(id))return;const l=lessons.get(id);if(!l)throw Error('prerequisite欠落');active.add(id);l.prerequisiteLessonIds.forEach(visit);active.delete(id);done.add(id);}lessons.forEach(l=>visit(l.id));
 for(const n of d.notes){for(const [ids,k] of [[n.ruleIds,'rules'],[n.questionIds,'questions'],[n.cardIds,'cards'],[n.sourceIds,'sources']])for(const id of ids)ref(k,id);}
 for(const r of d.rules){r.conditionIds.forEach(id=>ref('conditions',id));r.sourceIds.forEach(id=>ref('sources',id));}
 for(const c of d.cards){c.sourceIds.forEach(id=>ref('sources',id));if(c.eventId)ref('amendments',c.eventId);}
 for(const a of d.amendments)a.sourceIds.forEach(id=>ref('sources',id));
 for(const q of d.questions){if(q.provenance==='original_practice'&&q.historicalRef!==null)throw Error('独自練習へ原問を混在できません');ref('chapters',q.chapterId);const ids=q.tokens.filter(t=>t.kind==='blank').map(t=>t.blankId);if(new Set(ids).size!==ids.length||ids.length!==q.blanks.length||new Set(q.blanks.map(b=>b.printedPositionId)).size!==q.blanks.length||q.blanks.some(b=>!b.answer||!ids.includes(b.id)||b.version<1))throw Error('blank欠落/位置重複');
  if(q.historicalRef){const h=ref('historicalQuestions',q.historicalRef.id);if(JSON.stringify(h)!==JSON.stringify(q.historicalRef)||q.blanks.some(b=>!h.blankRefs.some(x=>x.id===b.id&&x.version===b.version)))throw Error('historical原問混在');}
 }
 for(const h of d.historicalQuestions){const c=ref('historicalCanonicals',h.canonicalRef.id);if(c.version!==h.canonicalRef.version||!c.questionRefs.some(x=>x.id===h.id&&x.version===h.version))throw Error('canonical逆引き欠落');h.blankRefs.forEach(x=>{if(ref('historicalBlanks',x.id).version!==x.version)throw Error('historical blank version');});}
 for(const c of d.historicalCanonicals)c.questionRefs.forEach(x=>{const h=ref('historicalQuestions',x.id);if(h.version!==x.version||h.canonicalRef.id!==c.id)throw Error('canonical question不一致');});
 if(!['original_sample','approved_release'].includes(d.edition)&&!(internalReview&&d.edition==='internal_review'))throw Error('不正edition');
 if(d.edition==='original_sample'&&(d.historicalQuestions.length||d.historicalCanonicals.length||d.historicalBlanks.length||d.questions.some(q=>q.provenance!=='original_sample'||q.historicalRef!==null)||d.sources.some(x=>x.url!==null||x.asOfDate!==null)||d.notes.some(n=>n.effectiveStatus!=='not_applicable_sample'||n.publicEligibility!=='sample'||n.asOfDate!==null)))throw Error('架空教材へ実法令混入');
 if(d.edition!=='original_sample'&&d.notes.some(n=>n.effectiveStatus!=='verified'||!['approved_candidate','needs_context'].includes(n.publicEligibility)))throw Error('未確認/blocked教材');
 for(const src of d.sources)if(src.url&&!/^https:\/\//.test(src.url))throw Error('不正source URL');
 for(const item of [...d.notes,...d.questions,...d.cards]){
  const r=d.reviews.find(x=>x.id===item.reviewId);
  if(!r||r.contentRef.id!==item.id||r.contentRef.version!==item.version)throw Error('元review参照不一致');
  const expected='themeId' in item?(item.provenance==='original_practice'?'original_practice':'historical'):'kind' in item&&item.kind==='amendment'?'amendment':'current_note';
  if(d.edition==='original_sample'&&(r.purpose!=='original_sample'||r.rights!=='original_author'||r.humanApproval!=='not_applicable_sample'||r.releaseApproved))throw Error('sample審査不一致');
  if(d.edition!=='original_sample'&&r.purpose!==expected)throw Error('用途審査不一致');
  if(!internalReview&&d.edition==='approved_release'&&(r.rights!=='cleared'||r.humanApproval!=='approved'||!r.releaseApproved))throw Error('元review承認未完了');
 }

 const reviews=new Map(value.publicReviews.map(r=>[r.id+'@'+r.contentVersion+':'+r.purpose,r]));if(reviews.size!==value.publicReviews.length)throw Error('review重複');
 const sample=d.edition==='original_sample';
 for(const x of required){const purpose=(sample?'sample:':'release:')+x.purpose;const r=reviews.get(x.id+'@'+x.version+':'+purpose);
  if(!r||sample&&(r.rights!=='original_author'||r.humanApproval!=='not_applicable_sample'||r.releaseApproved||r.approvedAt!==null)||!internalReview&&!sample&&(r.rights!=='cleared'||r.humanApproval!=='approved'||!r.releaseApproved||!r.approvedAt||!Number.isFinite(Date.parse(r.approvedAt))))throw Error('個別用途/version公開審査未完了: '+x.id+'/'+purpose);
 }
 if(internalReview&&(d.edition!=='internal_review'||value.publicReviews.some(r=>r.humanApproval!=='pending'||r.releaseApproved||r.approvedAt!==null)||d.reviews.some(r=>r.humanApproval!=='pending'||r.releaseApproved)))throw Error('内部プレビュー審査状態不整合');
 if(reviews.size!==required.length)throw Error('余剰review');
 const expectedTimes=new Set(required.map(x=>x.id+'@'+x.version));const times=new Map(value.temporalRecords.map(t=>[t.entityId+'@'+t.contentVersion,t]));if(times.size!==value.temporalRecords.length||times.size!==expectedTimes.size||[...expectedTimes].some(k=>!times.has(k)))throw Error('日時記録参照不整合');for(const t of times.values())for(const [key,date] of Object.entries(t))if(key!=='entityId'&&key!=='contentVersion'&&date!==null&&!Number.isFinite(Date.parse(date)))throw Error('不正日時');
 const text=JSON.stringify(value);if(/"(?:sourceHash|pointer|exactRange|evidenceHash|privateEvidence|reviewEvidence|sha256)"|private:|\/Users\/|docs\/1sou_houki/.test(text))throw Error('private情報混入');
 return value;
}
export function validateRelease(value){return validateLessonData(value,false);}
// For an isolated local reviewer only. This does not grant any release approval.
export function validateReviewPreview(value){return validateLessonData(value,true);}
// Explicit allowlist projection; authoring evidence is never serialised. All nested keys are checked by the strict schema.
export function generateRelease(authoring){
 if(authoring.format!=='houki-authoring-v1')throw Error('原本形式が不正');
 const p=authoring.payload;
 // K4-D compatibility metadata is derived; authoring text lives only in ordered blocks.
 const master={...p.master,notes:p.master.notes.map(n=>{if(['goal','explanation','steps'].some(k=>k in n))throw Error('本文の二重管理は不可');const l=p.lessons.find(l=>l.id===n.id);if(!l)throw Error('lesson欠落');return {...n,goal:l.blocks.find(b=>b.type==='keyPoints')?.items.join(' / ')??'',explanation:l.blocks.filter(b=>b.type==='explanation').map(b=>b.body).join('\n'),steps:l.blocks.filter(b=>b.type==='procedure').flatMap(b=>b.items)};})};
 const dto={schemaVersion:p.schemaVersion,contentVersion:p.contentVersion,editionId:p.editionId,master,lessons:p.lessons,dates:p.dates,publicReviews:p.publicReviews,temporalRecords:p.temporalRecords};
 validateRelease(dto);return JSON.parse(JSON.stringify(dto));
}
