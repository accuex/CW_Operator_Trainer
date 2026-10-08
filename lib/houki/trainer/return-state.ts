import {readLocation,type TrainerLocation} from './engine';
export interface SheetReturn {location:TrainerLocation;questionVersion:number;revealed:string[];explanationOpen:boolean}
export function encodeSheetReturn(value:SheetReturn):string{return JSON.stringify(value);}
export function decodeSheetReturn(raw:string|null):SheetReturn|null{
 if(!raw||raw.length>4096)return null;
 try{const x=JSON.parse(raw);if(x.location?.mode!=='sheet'||!Number.isInteger(x.questionVersion)||x.questionVersion<1||!Array.isArray(x.revealed)||x.revealed.length>100||x.revealed.some((id:unknown)=>typeof id!=='string'||id.length>200)||typeof x.explanationOpen!=='boolean')return null;
 const p=new URLSearchParams();for(const k of ['mode','theme','question','year','chapter','seed'])if(typeof x.location[k]==='string'||typeof x.location[k]==='number')p.set(k,String(x.location[k]));if(x.location.random===true)p.set('random','1');return {location:readLocation(p.toString()),questionVersion:x.questionVersion,revealed:x.revealed,explanationOpen:x.explanationOpen};}catch{return null;}
}
export function restoredPositions(value:SheetReturn,question:{id:string;version:number;blanks:{printedPositionId:string}[]}):string[]{return value.location.question===question.id&&value.questionVersion===question.version?value.revealed.filter(id=>question.blanks.some(b=>b.printedPositionId===id)):[];}
