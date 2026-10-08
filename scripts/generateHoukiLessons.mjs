import './checkHoukiPrivateTracking.mjs';
import {readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {generateRelease} from '../lib/houki/trainer/release-validator.mjs';
const dto=generateRelease(JSON.parse(readFileSync('data/houki/original-samples.authoring.json','utf8')));
const path=`public/houki/trainer/lessons-v${dto.contentVersion}.json`;
const index={schemaVersion:'1.0.0',contentVersion:dto.contentVersion,file:'/houki/trainer/lessons-v'+dto.contentVersion+'.json'};
const indexPath='public/houki/trainer/active.json';
if(process.argv.includes('--check')){if(JSON.stringify(JSON.parse(readFileSync(indexPath,'utf8')))!==JSON.stringify(index))throw Error('教材版index不整合');if(JSON.stringify(JSON.parse(readFileSync(path,'utf8')))!==JSON.stringify(dto))throw Error('配信DTOと原本が一致しません');}
else {if(existsSync(path)&&JSON.stringify(JSON.parse(readFileSync(path,'utf8')))!==JSON.stringify(dto))throw Error('既存教材版を上書きできません。contentVersionを上げてください');writeFileSync(path+'.tmp',JSON.stringify(dto,null,2)+'\n');renameSync(path+'.tmp',path);writeFileSync(indexPath,JSON.stringify(index,null,2)+'\n');}
console.log('教材schema・全参照・個別公開審査 PASS');
