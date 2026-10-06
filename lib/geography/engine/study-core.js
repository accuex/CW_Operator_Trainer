import {aggregate,selectExams,answerMatches} from './core.js';
export {aggregate,selectExams,answerMatches};
export const MODES={shortest:'最短合格',safe:'安全圏',complete:'完全制覇'};
export const GRADES={correct:'正解',sufficient:'試験上十分',near:'惜しい',incorrect:'誤り',revealed:'答えを確認',skipped:'未回答'};
export function priorities(db,stats,exams){
 const out=new Map();
 for(const region of db.regions){
  const xs=db.entities.filter(e=>e.region_id===region.id&&e.role==='exam_candidate'&&stats.get(e.id).count>0);
  const percentile=(e,field,peers)=>{const v=stats.get(e.id)[field];return (peers.filter(p=>stats.get(p.id)[field]<v).length+.5*peers.filter(p=>stats.get(p.id)[field]===v).length)/peers.length;};
  for(const e of xs){const peers=xs.filter(x=>x.entity_type===e.entity_type),s=stats.get(e.id),cp=percentile(e,'count',xs),ep=percentile(e,'exam_count',xs),value=(cp+ep)/2,rank=value>=.75?'A':value>=.5?'B':value>=.25?'C':'D',best=peers.every(p=>stats.get(p.id).count<=s.count),covered=exams.filter(x=>x.regions.includes(region.id)).length;
   out.set(e.id,{rank,choice_percentile:cp,exam_percentile:ep,regional_percentile:value,type_percentile:percentile(e,'count',peers),type_representative:best,region_candidates:xs.length,covered_exam_periods:covered,choice_mentions:s.count,distinct_exam_periods:s.exam_count,entity_type:e.entity_type,reason:`${s.count}選択肢・${s.exam_count}/${covered}収録試験期。地域内${xs.length}地点の登場回数順位と試験期数順位の平均が上位${Math.round((1-value)*100)}%相当。${rank}帯${best?' / この種別の最多登場':''}。次回出題の予測ではありません。`});
  }
 }
 return out;
}
export function pool(db,ranks,region,mode){const candidates=db.entities.filter(e=>e.region_id===region&&ranks.has(e.id)),hasA=candidates.some(e=>ranks.get(e.id).rank==='A'),top=Math.max(0,...candidates.map(e=>ranks.get(e.id).regional_percentile));return candidates.filter(e=>mode==='complete'||mode==='shortest'&&(hasA?ranks.get(e.id).rank==='A':ranks.get(e.id).regional_percentile===top)||mode==='safe'&&(ranks.get(e.id).rank!=='D'||ranks.get(e.id).type_representative||['sea','strait'].includes(e.entity_type))).sort((a,b)=>ranks.get(b.id).regional_percentile-ranks.get(a.id).regional_percentile||a.id.localeCompare(b.id));}
export function unitPoint(bounds,[lon,lat]){const m=v=>Math.log(Math.tan(Math.PI/4+v*Math.PI/360));return [(lon-bounds[0])/(bounds[2]-bounds[0]),(m(bounds[3])-m(lat))/(m(bounds[3])-m(bounds[1]))];}
export function distance(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
export function inGeometry(pt,g){if(!g)return false;const ring=r=>{let inside=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;};const poly=p=>ring(p[0])&&!p.slice(1).some(ring);return g.type==='Polygon'?poly(g.coordinates):g.type==='MultiPolygon'?g.coordinates.some(poly):false;}
function vertices(g){return g.type==='Polygon'?g.coordinates.flat():g.type==='MultiPolygon'?g.coordinates.flat(2):[];}
export function contextAt(pt,bounds,countries,geography){
 const u=unitPoint(bounds,pt),within=countries.features.find(f=>inGeometry(pt,f.geometry));
 const nearest=within||countries.features.map(f=>({f,d:Math.min(...vertices(f.geometry).map(v=>distance(u,unitPoint(bounds,v))))})).sort((a,b)=>a.d-b.d)[0]?.f;
 const area=geography.features.find(f=>f.properties.layer==='entity_area'&&inGeometry(pt,f.geometry));
 return {country:within?.properties.country??null,coast_country:nearest?.properties.country??null,area:area?.properties.entity_id??null};
}
export function pointTolerance(db,profile){
 const e=db.entities.find(x=>x.id===profile.entity_id),r=db.regions.find(r=>r.id===e.region_id),l=db.locations.find(l=>l.entity_id===e.id);
 if(profile.capability!=='point')return null;
 const u=unitPoint(r.bounds,[l.lon,l.lat]);
 const questions=new Set(db.occurrences.filter(o=>o.entity_id===e.id).map(o=>o.question_id)),cochoices=new Set(db.occurrences.filter(o=>questions.has(o.question_id)).map(o=>o.entity_id));
 const peers=db.entities.filter(x=>x.region_id===e.region_id&&x.id!==e.id&&x.entity_type===e.entity_type&&cochoices.has(x.id)).map(x=>({e:x,l:db.locations.find(l=>l.entity_id===x.id)})).filter(x=>x.l.coordinate_status==='verified');
 const nearest=Math.min(Infinity,...peers.map(x=>distance(u,unitPoint(r.bounds,[x.l.lon,x.l.lat]))));
 const base={station:.045,port:.035,strait:.04,landform:.055}[e.entity_type]||.04;
 // Relative to map scale; peer spacing caps the sufficient band, never demands sub-tap precision.
 return {correct:Math.max(.014,Math.min(base*.4,nearest*.20)),sufficient:Math.max(.025,Math.min(base,nearest*.42)),near:Math.max(.07,base*1.8),nearest_peer_spacing:Number.isFinite(nearest)?nearest:null,cochoice_peer_ids:peers.map(x=>x.e.id),origin:'provisional_learning_design',exam_position_variation:profile.exam_position_variation};
}
export function judgePosition(db,profile,pt,countries,geography){
 const e=db.entities.find(x=>x.id===profile.entity_id),r=db.regions.find(x=>x.id===e.region_id),loc=db.locations.find(x=>x.entity_id===e.id),u=unitPoint(r.bounds,pt);
 if(profile.capability==='recognition')return {grade:null,feedback:'位置未確認です。位置は採点せず、名称認識に切り替えます。'};
 const ctx=contextAt(pt,r.bounds,countries,geography),country=profile.feedback_country;
 let grade,relative='',peer=null;
 if(profile.capability==='area'){
  if(inGeometry(pt,profile.area_geometry))grade='sufficient';
  else {const edge=Math.min(...vertices(profile.area_geometry).map(v=>distance(u,unitPoint(r.bounds,v))));grade=edge<.06?'near':'incorrect';}
 }else{
  const reference=profile.capability==='context_area'?db.locations.find(x=>x.entity_id===profile.context_reference_entity):loc;
  const target=unitPoint(r.bounds,[reference.lon,reference.lat]),d=distance(u,target),t=profile.capability==='context_area'?{correct:0,sufficient:.07,near:.13}:pointTolerance(db,profile);
  grade=d<=t.correct?'correct':d<=t.sufficient?'sufficient':d<=t.near?'near':'incorrect';
  if(country&&ctx.country&&ctx.country!==country&&grade!=='incorrect')grade='near';
  relative=(u[1]<target[1]?'北':'南')+(u[0]<target[0]?'西':'東');
  const candidates=db.entities.filter(x=>x.region_id===e.region_id&&x.entity_type===e.entity_type&&x.id!==e.id).map(x=>({e:x,l:db.locations.find(l=>l.entity_id===x.id)})).filter(x=>x.l.coordinate_status==='verified');
  peer=candidates.sort((a,b)=>distance(u,unitPoint(r.bounds,[a.l.lon,a.l.lat]))-distance(u,unitPoint(r.bounds,[b.l.lon,b.l.lat])))[0];
  if(profile.capability==='point'&&peer&&distance(u,unitPoint(r.bounds,[peer.l.lon,peer.l.lat]))<d*.65&&d>t.correct){grade=d<=t.near?'near':'incorrect';}
 }
 const area=ctx.area?db.entities.find(x=>x.id===ctx.area)?.normalized_name:null;
 const landmark=db.entities.filter(x=>x.region_id===e.region_id&&x.id!==e.id&&x.entity_type==='landform').map(x=>({e:x,l:db.locations.find(l=>l.entity_id===x.id)})).filter(x=>x.l.coordinate_status==='verified');
 const reference=profile.capability==='context_area'?db.locations.find(l=>l.entity_id===profile.context_reference_entity):loc;
 const nearby=reference.lat===null?null:landmark.sort((a,b)=>distance(unitPoint(r.bounds,[a.l.lon,a.l.lat]),unitPoint(r.bounds,[reference.lon,reference.lat]))-distance(unitPoint(r.bounds,[b.l.lon,b.l.lat]),unitPoint(r.bounds,[reference.lon,reference.lat])))[0];
 const relation=nearby?`${nearby.e.normalized_name}より${reference.lat>=nearby.l.lat?'北':'南'}${reference.lon>=nearby.l.lon?'東':'西'}側。`:'';
 const feedback=`${GRADES[grade]}。${profile.context_label||e.normalized_name}${country?' / '+country:''}。${grade==='correct'||grade==='sufficient'?'位置関係を理解できています。':'目安の地域を確認して、もう一度。'}${ctx.country?'選んだ国：'+ctx.country+'。':ctx.coast_country?'近い沿岸：'+ctx.coast_country+'。':''}${area?'海域・範囲：'+area+'。':''}${grade==='near'&&relative?'目安より'+relative+'寄り。':''}${grade!=='correct'&&grade!=='sufficient'&&peer?'近い同種地点：'+peer.e.normalized_name+'。':''}${relation}${profile.capability==='context_area'?'歴史的施設の座標は採点していません。':''}`;
 return {grade,feedback,context:ctx,relative,nearby_entity_id:peer?.e.id??null};
}
export function createSession(ids){return {eligible:[...ids],fresh:[...ids],retries:[],step:0,lastRetryStep:-100,results:[],current:null};}
export function reconcileSession(s,ids){const eligible=new Set(ids);s.eligible=[...ids];s.fresh=s.fresh.filter(id=>eligible.has(id));s.retries=s.retries.filter(r=>eligible.has(r.entity_id));if(s.current&&!eligible.has(s.current))s.current=null;for(const id of ids)if(!s.fresh.includes(id)&&!s.results.some(r=>r.entity_id===id)&&s.current!==id)s.fresh.push(id);return s;}
export function nextSession(s){const due=s.retries.findIndex(r=>r.due<=s.step);let id;if(due>=0&&(!s.fresh.length||s.step-s.lastRetryStep>=3)){id=s.retries.splice(due,1)[0].entity_id;s.lastRetryStep=s.step+1;}else id=s.fresh.shift();if(!id&&s.retries.length){s.step=Math.max(s.step,Math.min(...s.retries.map(r=>r.due)));id=s.retries.shift().entity_id;}s.current=id??null;if(id)s.step++;return s.current;}
export function recordSession(s,id,grade){s.results.push({entity_id:id,grade,step:s.step});s.retries=s.retries.filter(r=>r.entity_id!==id);if(['near','incorrect','revealed','skipped'].includes(grade))s.retries.push({entity_id:id,due:s.step+(grade==='near'?3:2)});}
export function recognitionPrompt(db,id){const e=db.entities.find(x=>x.id===id);return e.name_en||db.aliases.find(a=>a.entity_id===id)?.alias||e.normalized_name;}
