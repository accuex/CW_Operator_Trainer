// Crop only the owner's official alpha sprite sheet. No concept art or generated replacements.
const fs=require('node:fs'),sharp=require('sharp'),crypto=require('node:crypto');
(async()=>{
 const source='assets/pcclub/laser/boss.png',out='public/assets/pcclub/boss';fs.mkdirSync(out,{recursive:true});
 const frames=[
  ['normal-1',0,38,250,234],['normal-2',250,38,250,234],['normal-3',500,38,270,234],
  ['awake-1',0,312,250,258],['awake-2',252,312,242,258],['awake-3',500,312,270,258],
  ['damage',0,618,202,188],['hit',202,618,194,188],['smoke',384,610,207,204],['defeat',745,610,325,209],
  ['explosion',198,830,124,164],['debris',478,830,86,160],
 ];
 const manifest={source,sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),outputSize:[320,320],frames:[],notes:['Normal sheet frames already have red eyes/lights; preserve original colours.','Alpha is retained; labels are outside crops. Low residual backdrop alpha < 12 is removed.','Normal/awake front sprites aligned to the same central body anchor; effects use independent bounds.']};
 for(const [id,left,top,width,height] of frames){
  const {data,info}=await sharp(source).extract({left,top,width,height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=3;i<data.length;i+=4) if(data[i]<12) data[i]=0;
  // Disconnected fragments touching a crop edge belong to adjacent cells.
  // Keep the primary subject and internal smoke/glow; never guess opaque colours.
  const labels=new Uint32Array(width*height),parts=[];let label=0;
  for(let pos=0;pos<labels.length;pos++) if(!labels[pos]&&data[pos*4+3]>=12){
   label++;const stack=[pos],part={size:0,edge:false};labels[pos]=label;
   while(stack.length){const v=stack.pop(),x=v%width,y=Math.floor(v/width);part.size++;part.edge ||=x===0||x===width-1;
    for(const n of [x>0?v-1:-1,x<width-1?v+1:-1,y>0?v-width:-1,y<height-1?v+width:-1]) if(n>=0&&!labels[n]&&data[n*4+3]>=12){labels[n]=label;stack.push(n);}
   }parts.push(part);
  }
  const largest=Math.max(...parts.map(p=>p.size));
  for(let i=0;i<labels.length;i++){const part=parts[labels[i]-1];if(part?.edge&&part.size<largest*.15)data[i*4+3]=0;}
  // Fixed transparent canvas, stable body origin; never stretch a frame.
  const front=id.startsWith('normal')||id.startsWith('awake');
  const scale=front?1.1:id==='defeat'?.92:1.25;
  const w=Math.round(width*scale),h=Math.round(height*scale),x=Math.floor((320-w)/2),y=front?(id.startsWith('awake')?22:36):Math.floor((320-h)/2);
  const small=await sharp(data,{raw:info}).resize(w,h).png().toBuffer();
  const path=`${out}/${id}.webp`;
  await sharp({create:{width:320,height:320,channels:4,background:'#00000000'}}).composite([{input:small,left:Math.max(0,x),top:Math.max(0,y)}]).webp({quality:90,alphaQuality:100}).toFile(path);
  manifest.frames.push({id,crop:[left,top,width,height],path,bytes:fs.statSync(path).size});
 }
 fs.mkdirSync('assets/pcclub',{recursive:true});fs.writeFileSync('assets/pcclub/boss-frame-manifest.json',JSON.stringify(manifest,null,2)+'\n');
 const board=await sharp({create:{width:1280,height:960,channels:4,background:'#10203a'}}).composite(await Promise.all(manifest.frames.map(async(f,i)=>({input:await sharp(f.path).png().toBuffer(),left:(i%4)*320,top:Math.floor(i/4)*320})))).png().toBuffer();
 fs.writeFileSync('/tmp/cwot-boss-contact.png',board);
})();
