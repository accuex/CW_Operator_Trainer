import {execFileSync} from 'node:child_process';
let files=[];
try{files=execFileSync('git',['ls-files','--cached','-z'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0');}catch{/* A source archive need not contain Git metadata. */}
if(files.some(p=>/^docs\/1sou_houki\/[^/]+\/private\//.test(p)||/review-accounts\.json$/.test(p)))throw Error('Private law evidence/reviewer credentials must not be Git-tracked');
