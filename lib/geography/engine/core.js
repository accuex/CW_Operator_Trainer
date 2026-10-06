export const TYPES={station:'海岸局・無線施設',port:'港・都市',strait:'海峡・水道',landform:'半島・島',sea:'海名・湾',country:'国'};
export function normalize(s){return s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_]/gu,'');}
export function selectExams(db,period,from='',to=''){
 const all=[...db.exams].sort((a,b)=>a.exam_month.localeCompare(b.exam_month));
 if(period==='10'||period==='5')return all.slice(-Number(period));
 if(period==='custom')return all.filter(e=>(!from||e.exam_month>=from)&&(!to||e.exam_month<=to));
 return all;
}
export function aggregate(db,exams){
 const ids=new Set(exams.map(e=>e.id)),all=new Map(db.entities.map(e=>[e.id,{count:0,exam_count:0,question_count:0,correct_count:null,evidence:[],first:null,last:null}])),date=new Map(db.exams.map(e=>[e.id,e.exam_month]));
 const seen=new Set();
 for(const o of db.occurrences){if(!ids.has(o.exam_id)||o.evidence_status!=='image_reviewed'||(o.confidence&&o.confidence!=='verified'))continue;const key=o.choice_id+"/"+o.entity_id;if(seen.has(key))continue;seen.add(key);const s=all.get(o.entity_id);if(s){s.count++;s.evidence.push(o);}}
 for(const s of all.values()){s.evidence.sort((a,b)=>date.get(a.exam_id).localeCompare(date.get(b.exam_id))||a.question_id.localeCompare(b.question_id,undefined,{numeric:true}));s.exam_count=new Set(s.evidence.map(o=>o.exam_id)).size;s.question_count=new Set(s.evidence.map(o=>o.question_id)).size;s.first=s.evidence.length?date.get(s.evidence[0].exam_id):null;s.last=s.evidence.length?date.get(s.evidence.at(-1).exam_id):null;}
 return all;
}
export function answerMatches(db,entityId,text){const n=normalize(text);return !!n&&(normalize(db.entities.find(e=>e.id===entityId)?.normalized_name||'')===n||db.aliases.some(a=>a.entity_id===entityId&&normalize(a.alias)===n));}
export function learnable(db,stats,region,kinds){const loc=new Map(db.locations.map(l=>[l.entity_id,l]));return db.entities.filter(e=>e.region_id===region&&e.role==='exam_candidate'&&kinds.has(e.entity_type)&&stats.get(e.id).count>0&&loc.get(e.id)?.verification_status==='verified'&&Number.isFinite(loc.get(e.id).lat)&&Number.isFinite(loc.get(e.id).lon));}
export function learnerState(attempts,entityId,mode){const xs=attempts.filter(a=>a.entity_id===entityId&&a.mode===mode);return {attempts:xs.length,weakness:xs.length?xs.filter(a=>!['correct','sufficient'].includes(a.result)).length/xs.length:null,last_attempt_at:xs.at(-1)?.attempted_at??null};}
