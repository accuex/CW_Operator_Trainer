import type {TrainerMaster,RedQuestion} from './types';
export function validateTrainer(data:TrainerMaster):TrainerMaster {
 if(!data || data.schemaVersion!==1 || !['original_sample','approved_release'].includes(data.edition))throw Error('教材の形式を確認できません');
 const groups=[data.chapters,data.notes,data.rules,data.conditions,data.questions,data.cards,data.amendments,data.sources,data.reviews,data.historicalCanonicals,data.historicalQuestions,data.historicalBlanks];
 if(groups.some(g=>!Array.isArray(g)))throw Error('教材データが不足しています');
 for(const g of groups)if(new Set(g.map(x=>x.id)).size!==g.length)throw Error('教材IDが重複しています');
 const has=(g:{id:string}[],ids:string[])=>ids.every(id=>g.some(x=>x.id===id));
 for(const item of [...data.notes,...data.questions,...data.cards]){
  const review=data.reviews.find(r=>r.id===item.reviewId);
  const sample=data.edition==='original_sample';
  if(!review || review.contentRef?.id!==item.id || review.contentRef?.version!==item.version || sample && (review.purpose!=='original_sample'||review.rights!=='original_author'||review.humanApproval!=='not_applicable_sample'||review.releaseApproved) || !sample && (review.rights!=='cleared'||review.humanApproval!=='approved'||!review.releaseApproved))throw Error('配信審査が完了していません');
  if(!sample && review.purpose!==('themeId' in item?'historical':'kind' in item&&item.kind==='amendment'?'amendment':'current_note'))throw Error('教材用途の審査が一致しません');
  if('chapterId' in item && !has(data.chapters,[item.chapterId]))throw Error('章が見つかりません');
 }
 if(data.edition==='original_sample'&&(data.historicalCanonicals.length||data.historicalQuestions.length||data.historicalBlanks.length))throw Error('歴史的データをサンプルへ混入できません');
 for(const h of data.historicalQuestions){if(!data.historicalCanonicals.some(c=>c.id===h.canonicalRef.id&&c.version===h.canonicalRef.version)||h.blankRefs.some(b=>!data.historicalBlanks.some(x=>x.id===b.id&&x.version===b.version)))throw Error('歴史的原問の参照が不正です');}
 for(const c of data.historicalCanonicals)if(c.questionRefs.some(q=>!data.historicalQuestions.some(h=>h.id===q.id&&h.version===q.version&&h.canonicalRef.id===c.id)))throw Error('canonical参照が不正です');
 for(const n of data.notes){
  if(!has(data.rules,n.ruleIds)||!has(data.questions,n.questionIds)||!has(data.cards,n.cardIds)||!has(data.sources,n.sourceIds))throw Error('テーマ参照が不正です');
  if(data.edition==='original_sample' && (n.effectiveStatus!=='not_applicable_sample'||n.publicEligibility!=='sample') || data.edition==='approved_release' && (n.effectiveStatus!=='verified'||n.publicEligibility==='blocked'))throw Error('教材の確認scopeを確認できません');
 }
 for(const q of data.questions){
  if(!has(data.notes,[q.themeId]) || new Set(q.blanks.map(b=>b.id)).size!==q.blanks.length || new Set(q.blanks.map(b=>b.printedPositionId)).size!==q.blanks.length || q.tokens.some(t=>t.kind==='blank'&&!has(q.blanks,[t.blankId])))throw Error('原問単位の穴対応が不正です');
  if(q.historicalRef&&q.blanks.some(b=>!q.historicalRef!.blankRefs.some(ref=>ref.id===b.id&&ref.version===b.version)))throw Error('別原問のblankを混在できません');
  const tokenIds=q.tokens.filter(t=>t.kind==='blank').map(t=>t.blankId);
  if(tokenIds.length!==q.blanks.length || new Set(tokenIds).size!==tokenIds.length || q.blanks.some(b=>!b.answer||!tokenIds.includes(b.id)))throw Error('印刷穴が欠落又は重複しています');
  if(data.edition==='original_sample'&&(q.provenance!=='original_sample'||q.historicalRef!==null))throw Error('実原問をサンプルへ混入できません');
  if(data.edition==='approved_release'&&q.provenance==='historical'&&(!q.historicalRef||!data.historicalQuestions.some(h=>h.id===q.historicalRef?.id&&h.version===q.historicalRef.version)))throw Error('歴史的出典がありません');
 }
 for(const r of data.rules)if(!has(data.conditions,r.conditionIds)||!has(data.sources,r.sourceIds))throw Error('規定参照が不正です');
 for(const c of data.cards)if(c.eventId&&!has(data.amendments,[c.eventId])||!has(data.sources,c.sourceIds))throw Error('カード参照が不正です');
 for(const a of data.amendments)if(!has(data.sources,a.sourceIds))throw Error('改正参照が不正です');
 if(data.edition==='original_sample' && (data.sources.some(s=>s.url!==null||s.asOfDate!==null) || data.notes.some(n=>n.asOfDate!==null)))throw Error('法令資料をサンプルへ混入できません');
 for(const s of data.sources)if(s.url && !/^https:\/\//.test(s.url))throw Error('出典URLが不正です');
 const serialized=JSON.stringify(data);if(/"(?:sha256|pointer|exactRange|sourceHash|evidenceHash)"|private:|docs\/1sou_houki|\/Users\//.test(serialized))throw Error('内部証拠は配信できません');
 return data;
}
export async function loadTrainerMaster():Promise<TrainerMaster>{const r=await fetch('/houki/trainer/original-samples-v1.json');if(!r.ok)throw Error('サンプル教材を読み込めません');return validateTrainer(await r.json());}
export function questionOrder(items:RedQuestion[],year:string,chapter:string,random:boolean,seed:number):RedQuestion[]{
 const result=items.filter(q=>(year==='all'||(q.historicalRef?.examDate.slice(0,4)??q.sampleYear)===year)&&(chapter==='all'||q.chapterId===chapter));
 let x=seed>>>0;const next=()=>{x=(Math.imul(1664525,x)+1013904223)>>>0;return x/4294967296;};
 if(random)for(let i=result.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;
}
export type TrainerLocation={mode:'home'|'book'|'sheet'|'legacy';theme:string;question:string;year:string;chapter:string;random:boolean;seed:number};
export function readLocation(search:string):TrainerLocation{const p=new URLSearchParams(search);const mode=p.get('mode');return {mode:mode==='book'||mode==='sheet'||mode==='legacy'?mode:'home',theme:p.get('theme')??'',question:p.get('question')??'',year:p.get('year')??'all',chapter:p.get('chapter')??'all',random:p.get('random')==='1',seed:Number(p.get('seed'))>>>0};}
export function trainerPath(state:TrainerLocation):string{const p=new URLSearchParams();p.set('mode',state.mode);for(const k of ['theme','question','year','chapter'] as const)if(state[k])p.set(k,state[k]);if(state.random){p.set('random','1');p.set('seed',String(state.seed));}return '/app/houki?'+p.toString();}
export function toggleRevealed(ids:string[],id:string):string[]{return ids.includes(id)?ids.filter(x=>x!==id):[...ids,id];}
