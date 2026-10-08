import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {validateReviewPreview} from '../../../../lib/houki/trainer/release-validator.mjs';
export function allowedRequest(req,port){
 return ['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)&&(!req.headers.origin||['http://127.0.0.1:'+port,'http://localhost:'+port].includes(req.headers.origin))&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']));
}
function same(a,b){return typeof a==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function createReviewServer({data,bundle,css,token,port=5189}){
 if(process.env.NODE_ENV==='production')throw Error('Review is local development only');
 const html='<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CWOT 内部教材レビュー</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>';
 const routes=new Map([['/',[html,'text/html; charset=utf-8']],['/app.js',[bundle,'text/javascript']],['/style.css',[css,'text/css']],['/review-data',[JSON.stringify(data),'application/json']]]);
 return http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  if(!allowedRequest(req,port)||req.method!=='GET'){res.writeHead(403);res.end('Forbidden');return;}
  const u=new URL(req.url,'http://127.0.0.1:'+port);
  if(u.pathname==='/open'&&same(u.searchParams.get('token'),token)){res.writeHead(303,{'Set-Cookie':`cwotReview=${token}; HttpOnly; SameSite=Strict; Path=/`,'Location':'/'});res.end();return;}
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('cwotReview='))?.slice(11);
  if(!same(cookie,token)){res.writeHead(403);res.end('Review session required');return;}
  const entry=routes.get(req.url);if(!entry){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':entry[1]});res.end(entry[0]);
 });
}
export async function startReview(){
 if(process.env.NODE_ENV==='production')throw Error('Review is local development only');
 const raw=JSON.parse(await readFile(new URL('../private/false-alert.authoring.json',import.meta.url),'utf8'));
 if(raw.environment!=='local_review_only'||raw.releaseApproved||raw.humanPublicApproval!=='pending')throw Error('Review boundary invalid');
 const dto=validateReviewPreview(raw.displayData);
 const entry=fileURLToPath(new URL('./main.tsx',import.meta.url));const bundle=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},sourcemap:false,tsconfig:fileURLToPath(new URL('../../../../tsconfig.json',import.meta.url))});
 // Schema compilation stays on the server; the CSP does not permit browser unsafe-eval.
 const base=':root{color-scheme:dark;--text:#e9edf9;--text-muted:#a8b1cb;--gold:#eed071;--surface-2:#1c2945;--muted:#a8b1cb;--line-2:#34435f}body{margin:0;background:#0c1225;color:var(--text);font:16px/1.8 system-ui,sans-serif}.page-pad{padding:24px}.panel{background:#151f39;border:1px solid #34435f;border-radius:14px;padding:24px}.btn{font:inherit;padding:10px 16px;min-height:44px;border-radius:8px;border:1px solid #647497;background:#233451;color:inherit;cursor:pointer}.btn-primary{background:#eed071;color:#111}.section-kicker{color:#eed071}a{color:#8fcdff}summary{cursor:pointer;min-height:44px}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #ffcf5a;outline-offset:4px}h1,h2,h3{line-height:1.45}';
 const css=base+await readFile(new URL('../../../../app/styles/views/houki-trainer.css',import.meta.url),'utf8');const token=randomBytes(24).toString('hex');const port=5189;
 const server=createReviewServer({data:{release:dto,review:{theme:dto.lessons[0].title,asOf:raw.verificationAsOf,issues:raw.reviewIssues}},bundle:bundle.outputFiles[0].contents,css,token,port});
 server.listen(port,'127.0.0.1',()=>console.log(`Local review: http://127.0.0.1:${port}/open?token=${token}`));return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url))await startReview();
