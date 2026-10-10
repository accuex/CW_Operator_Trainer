// Deterministic crop/alignment/WebP conversion of the prepared transparent atlas.
// Original user asset remains untouched. No background guessing or color-keying.
const fs=require('node:fs');
const sharp=require('sharp');
const crypto=require('node:crypto');
(async()=>{
 const input='assets/pcclub/robot-atlas-prepared.png';
 const frames=['idle-1','idle-2','left','right','charge','send','hit','defeat'];
 const shifts=[[1,0],[-3,0],[23,-5],[-15,-4],[1,31],[2,35],[18,12],[-6,-14]];
 const output='public/assets/pcclub/robot';fs.mkdirSync(output,{recursive:true});
 const manifest={source:input,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex'),cell:[384,512],outputSize:[256,256],frames:[]};
 for(let k=0;k<8;k++){
   const {data}=await sharp(input).extract({left:(k%4)*384,top:Math.floor(k/4)*512,width:384,height:512}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   const aligned=Buffer.alloc(384*384*4),[dx,dy]=shifts[k];
   for(let y=0;y<512;y++)for(let x=0;x<384;x++){
     const ax=x+dx, ay=y+dy-84;
     if(ax>=0&&ax<384&&ay>=0&&ay<384)data.copy(aligned,(ay*384+ax)*4,(y*384+x)*4,(y*384+x)*4+4);
   }
   const path=`${output}/${frames[k]}.webp`;
   await sharp(aligned,{raw:{width:384,height:384,channels:4}}).resize(256,256).webp({quality:88,alphaQuality:100}).toFile(path);
   manifest.frames.push({id:frames[k],cell:k,shift:shifts[k],path,bytes:fs.statSync(path).size});
 }
 fs.writeFileSync('assets/pcclub/robot-frame-manifest.json',JSON.stringify(manifest,null,2)+'\n');
})();
