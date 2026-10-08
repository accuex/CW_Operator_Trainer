import './checkHoukiPrivateTracking.mjs';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {generateRelease,validateRelease} from '../lib/houki/trainer/release-validator.mjs';
const indexPath='public/houki/trainer/active.json';
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sample=()=>generateRelease(read('data/houki/original-samples.authoring.json'));
function active(){
 const i=read(indexPath);
 if(Object.keys(i).sort().join()!=='contentVersion,file,schemaVersion'||i.schemaVersion!=='1.0.0'||!Number.isInteger(i.contentVersion)||i.contentVersion<1||i.file!==`/houki/trainer/lessons-v${i.contentVersion}.json`)throw Error('教材版index不整合');
 const dto=validateRelease(read('public'+i.file));
 if(dto.contentVersion!==i.contentVersion)throw Error('教材版index不整合');
 return dto;
}
const args=process.argv.slice(2);
if(args.length===1&&args[0]==='--check'){
 const dto=active();
 if(dto.master.edition==='original_sample'&&JSON.stringify(dto)!==JSON.stringify(sample()))throw Error('配信DTOと原本が一致しません');
 console.log('Active教材schema・全参照・個別公開審査 PASS');
}else{
 let dto;
 if(args.length===2&&args[0]==='--activate-reviewed'){
  // The supplied DTO must already have every human/content/version approval.
  // This command never changes approval fields or converts a pending candidate.
  dto=validateRelease(read(args[1]));
  if(dto.master.edition!=='approved_release')throw Error('承認済みreleaseだけを切替できます');
 }else if(args.length===0){
  if(existsSync(indexPath)&&active().master.edition==='approved_release')throw Error('公開releaseをsampleへ置換できません');
  dto=sample();
 }else throw Error('Usage: --check | --activate-reviewed approved-dto.json');
 const path=`public/houki/trainer/lessons-v${dto.contentVersion}.json`;
 if(existsSync(path)&&JSON.stringify(read(path))!==JSON.stringify(dto))throw Error('既存教材版を上書きできません。contentVersionを上げてください');
 if(!existsSync(path)){writeFileSync(path+'.tmp',JSON.stringify(dto,null,2)+'\n',{flag:'wx'});renameSync(path+'.tmp',path);}
 const index={schemaVersion:'1.0.0',contentVersion:dto.contentVersion,file:'/houki/trainer/lessons-v'+dto.contentVersion+'.json'};
 writeFileSync(indexPath+'.tmp',JSON.stringify(index,null,2)+'\n');renameSync(indexPath+'.tmp',indexPath);
 console.log('教材schema・全参照・個別公開審査 PASS');
}
