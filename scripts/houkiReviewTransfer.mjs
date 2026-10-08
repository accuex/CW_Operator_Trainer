// Local-only transfer package; never writes to public or the Git index.
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {validateReviewPreview} from '../lib/houki/trainer/release-validator.mjs';
const root=process.cwd(),base=resolve(root,'docs/1sou_houki/StageK4-L/private');
const hash=x=>createHash('sha256').update(x).digest('hex');
const [mode,path]=process.argv.slice(2);if(!path||!['export','restore'].includes(mode))throw Error('Usage: node scripts/houkiReviewTransfer.mjs export|restore /absolute/private/package.json');
const target=resolve(path);const parent=await realpath(resolve(target,'..'));
if(parent===resolve(root,'public')||parent.startsWith(resolve(root,'public')+'/')||parent.startsWith(resolve(root,'dist'))||parent.startsWith(resolve(root,'.git')))throw Error('Public/build/Git destination forbidden');
if(!relative(root,target).startsWith('..')){try{execFileSync('git',['check-ignore','--quiet',relative(root,target)]);}catch{throw Error('In-repository transfer must stay ignored');}}
if(mode==='export'){
 const files={};for(const name of ['batch1.authoring.json','batch1.evidence.json','selection.json']){const text=await readFile(resolve(base,name),'utf8');files[name]={text,sha256:hash(text)};}
 const raw=JSON.parse(files['batch1.authoring.json'].text);const dto=validateReviewPreview(raw.displayData);
 const p={format:'cwot-private-review-transfer-v1',editionId:dto.editionId,contentVersion:dto.contentVersion,themeIds:dto.lessons.map(x=>x.id),createdAt:new Date().toISOString(),files};
 await writeFile(target,JSON.stringify(p),{flag:'wx',mode:0o600});console.log('Private package created; credentials excluded. Transfer only through an approved encrypted channel.');
}else{
 const p=JSON.parse(await readFile(target,'utf8'));if(p.format!=='cwot-private-review-transfer-v1')throw Error('Invalid package');
 const names=['batch1.authoring.json','batch1.evidence.json','selection.json'];if(Object.keys(p.files).sort().join()!==names.sort().join())throw Error('Invalid file allowlist');
 for(const name of names)if(hash(p.files[name].text)!==p.files[name].sha256)throw Error('Hash mismatch');
 const raw=JSON.parse(p.files['batch1.authoring.json'].text);const dto=validateReviewPreview(raw.displayData);if(raw.releaseApproved!==false||raw.humanPublicApproval!=='pending'||dto.editionId!==p.editionId||dto.contentVersion!==p.contentVersion||JSON.stringify(dto.lessons.map(x=>x.id))!==JSON.stringify(p.themeIds))throw Error('Boundary/version mismatch');
 // Preflight every destination before writing anything. Never replace existing work.
 for(const name of names){try{await readFile(resolve(base,name));throw Error('Restore destination exists');}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const name of names)await writeFile(resolve(base,name),p.files[name].text,{flag:'wx',mode:0o600});console.log('Restored; local reviewer accounts must be initialized separately.');
}
