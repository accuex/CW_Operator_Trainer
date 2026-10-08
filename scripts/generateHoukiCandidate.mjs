// Local-only candidate output. Never activates a release or grants approval.
import './checkHoukiPrivateTracking.mjs';
import {readFile,writeFile,realpath} from 'node:fs/promises';
import {resolve,relative,dirname,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {generateReleaseCandidate} from '../lib/houki/trainer/release-candidate.mjs';
const [input,output,...extra]=process.argv.slice(2);
if(!input||!output||extra.length)throw Error('Usage: node scripts/generateHoukiCandidate.mjs private-authoring.json private-output.json');
const root=await realpath(process.cwd()), parent=await realpath(dirname(resolve(output))), target=resolve(parent,resolve(output).split(sep).at(-1));
const rel=relative(root,target);
if(rel.startsWith('..')||rel.split(sep).includes('public')||rel.startsWith('dist'+sep)||rel.startsWith('.git'+sep))throw Error('Candidate must remain in ignored internal storage');
try{execFileSync('git',['check-ignore','--quiet',rel],{stdio:'ignore'});}catch{throw Error('Candidate output must be ignored');}
const candidate=generateReleaseCandidate(JSON.parse(await readFile(resolve(input),'utf8')));
await writeFile(target,JSON.stringify(candidate,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Internal candidate schema PASS; approvals unchanged; public activation not performed.');
