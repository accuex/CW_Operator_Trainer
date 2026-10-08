import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {resolve} from 'node:path';
const base='docs/1sou_houki/StageK4-G/private'; // Existing reviewer credentials remain unchanged.
const contentBase='docs/1sou_houki/StageK4-J/private';
export async function initializeReviewAccounts(root){
 const path=resolve(root,base,'review-accounts.json');
 try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const accounts=['reviewer','observer'].map(name=>{const password=randomBytes(24).toString('base64url'),salt=randomBytes(16).toString('hex');return {name,password,salt,hash:scryptSync(password,salt,32).toString('hex'),roles:name==='reviewer'?['houki-review']:[]};});
 await mkdir(resolve(root,base),{recursive:true});await writeFile(path,JSON.stringify(accounts,null,2),{flag:'wx',mode:0o600});return accounts;
}
export function createReviewMiddleware({accounts,loadData,production=false,now=()=>Date.now()}){
 const sessions=new Map();const attempts=new Map();
 const equal=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 return async(req,res,next)=>{
  let u;try{u=new URL(req.url,'http://localhost');}catch{return next();}
  // Vite's file server must never expose ignored evidence, credentials, or raw authoring.
  let path;try{path=decodeURIComponent(u.pathname).replaceAll('\\','/');}catch{path='';}
  if(/(?:^|\/)(?:docs|\.git|\.env[^/]*)(?:\/|$)/i.test(path)||/authoring\.json|review-accounts\.json/i.test(path)){res.writeHead(404);res.end();return;}
  if(!u.pathname.startsWith('/__houki-review/'))return next();
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  const host=req.headers.host??'';const remote=req.socket.remoteAddress;
  const local=/^(localhost|127\.0\.0\.1):\d+$/.test(host)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote);
  const sameOrigin=!req.headers.origin||req.headers.origin===`http://${host}`;
  if(production||!local||!sameOrigin||(req.headers['sec-fetch-site']&&!['none','same-origin'].includes(req.headers['sec-fetch-site']))){res.writeHead(403);res.end('Review unavailable');return;}
  const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('cwotHoukiReviewer='))?.slice(18);
  const session=sessions.get(cookie);const identity=session&&session.expires>now()?accounts.find(a=>a.name===session.name):null;
  if(u.pathname==='/__houki-review/login'&&req.method==='GET'){
   res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="ja"><meta name="viewport" content="width=device-width,initial-scale=1"><title>内部教材レビュー認証</title><h1>内部教材レビュー</h1><p>この端末のレビュー用アカウントが必要です。一般のCWOTログインとは別です。</p><form method="post" action="/__houki-review/login"><label>担当者 <input name="name" autocomplete="username" required></label><label>パスワード <input name="password" type="password" autocomplete="current-password" required></label><button>認証する</button></form><a href="/app/houki">通常の法規へ戻る</a><p id="result" role="status"></p><script src="/__houki-review/login.js" defer></script></html>');return;
  }
  if(u.pathname==='/__houki-review/login.js'&&req.method==='GET'){
   res.writeHead(200,{'Content-Type':'text/javascript'});res.end("document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const status=document.getElementById('result');try{if(navigator.serviceWorker?.controller){status.textContent='このブラウザにはオフライン用サービスワーカーが残っています。サービスワーカーのないブラウザで内部レビューを開いてください。';return;}const r=await fetch('/__houki-review/login',{method:'POST',headers:{Accept:'application/json'},body:new URLSearchParams(new FormData(e.target)),credentials:'same-origin'});if(!r.ok)throw Error();window.location.assign('/app/houki?review=1');}catch{status.textContent='認証できませんでした。担当者名とパスワードを確認してください。';}});");return;
  }
  if(u.pathname==='/__houki-review/login'&&req.method==='POST'){
   const recent=(attempts.get(remote)??[]).filter(t=>t>now()-60000);attempts.set(remote,[...recent,now()]);if(recent.length>=10){res.writeHead(429);res.end('Try later');return;}
   let body='';try{for await(const chunk of req){body+=chunk;if(body.length>2048)throw Error();}}catch{res.writeHead(400);res.end('Invalid request');return;}
   const form=new URLSearchParams(body);const account=accounts.find(a=>a.name===form.get('name'));
   const hash=scryptSync(form.get('password')??'',account?.salt??'invalid',32).toString('hex');
   if(!account||!equal(hash,account.hash)){res.writeHead(403);res.end('Authentication failed');return;}
   const id=randomBytes(32).toString('hex');sessions.set(id,{name:account.name,expires:now()+4*3600000});
   res.setHeader('Set-Cookie',`cwotHoukiReviewer=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`);if(req.headers.accept==='application/json'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');}else{res.writeHead(303,{Location:'/app/houki?review=1'});res.end();}return;
  }
  if(!identity){res.writeHead(401);res.end('Reviewer authentication required');return;}
  if(!identity.roles.includes('houki-review')){res.writeHead(403);res.end('Reviewer authorization required');return;}
  if(u.pathname==='/__houki-review/logout'&&req.method==='POST'){sessions.delete(cookie);res.writeHead(204,{'Set-Cookie':'cwotHoukiReviewer=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});res.end();return;}
  if(u.pathname!=='/__houki-review/data'||req.method!=='GET'){res.writeHead(404);res.end();return;}
  try{const data=await loadData();res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));}catch{res.writeHead(503);res.end('Review data unavailable');}
 };
}
export function houkiReviewPlugin(){return {name:'cwot-houki-dev-review',apply:'serve',async configureServer(server){
 const root=server.config.root;const accounts=await initializeReviewAccounts(root);
 const middleware=createReviewMiddleware({accounts,production:process.env.NODE_ENV==='production',loadData:async()=>{
  const {validateReviewPreview}=await import('../../lib/houki/trainer/release-validator.mjs');
  const raw=JSON.parse(await readFile(resolve(root,contentBase,'batch1.authoring.json'),'utf8'));
  if(raw.releaseApproved!==false||raw.humanPublicApproval!=='pending'||raw.environment!=='local_review_only')throw Error();
  return validateReviewPreview(raw.displayData);
 }});server.middlewares.use(middleware);
}};}
