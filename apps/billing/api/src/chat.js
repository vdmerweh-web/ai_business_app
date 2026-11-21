// Chat with Grid (the bot) + account file library.
// Users have many conversations; attachments belong to their conversation and can be saved to the account library (tagged to a domain or product).
// Bot side: webhook out (GRID_WEBHOOK_URL + X-Grid-Webhook-Secret), replies in via bearer GRID_BOT_TOKEN.
import express from 'express';import crypto from 'crypto';import fs from 'fs';import path from 'path';import {q} from './db.js';import {scopeFor,fileInScope} from './scope.js';
const DIR=process.env.UPLOAD_DIR||'/data/uploads';const API=process.env.API_URL||'https://api.planet-grid.com';
const MB=1024*1024;
// ext -> [mime, max bytes, magic check]
const has=(b,s,o=0)=>b.slice(o,o+s.length).equals(Buffer.from(s,'latin1'));
const KINDS={png:['image/png',2*MB,b=>has(b,'\x89PNG')],jpg:['image/jpeg',2*MB,b=>b[0]===0xff&&b[1]===0xd8],jpeg:['image/jpeg',2*MB,b=>b[0]===0xff&&b[1]===0xd8],
 gif:['image/gif',2*MB,b=>has(b,'GIF8')],webp:['image/webp',2*MB,b=>has(b,'RIFF')&&has(b,'WEBP',8)],
 svg:['image/svg+xml',2*MB,b=>/<svg[\s>]/i.test(b.slice(0,4096).toString('utf8'))],pdf:['application/pdf',25*MB,b=>has(b,'%PDF')],
 ai:['application/postscript',25*MB,b=>has(b,'%PDF')||has(b,'%!PS')],eps:['application/postscript',25*MB,b=>has(b,'%!PS')||(b[0]===0xc5&&b[1]===0xd0)],
 psd:['image/vnd.adobe.photoshop',25*MB,b=>has(b,'8BPS')],zip:['application/zip',25*MB,b=>has(b,'PK\x03\x04')],
 sketch:['application/zip',25*MB,b=>has(b,'PK\x03\x04')],xd:['application/zip',25*MB,b=>has(b,'PK\x03\x04')],fig:['application/octet-stream',25*MB,b=>has(b,'fig-kiwi')||has(b,'PK\x03\x04')]};
export const CATEGORIES=['Branding','Website','Projects','Products','Marketing','Conversational relations'];
const cat=(v,required)=>{if(v==null||v===''){if(required)throw err('Pick a category for this file');return null}const c=CATEGORIES.find(x=>x.toLowerCase()===String(v).toLowerCase());if(!c)throw err('Unknown category');return c};
const MAXW=2000;
// Pixel width from the file header (PNG, GIF, JPEG, WebP). null if unreadable.
export function imgWidth(b,mime){try{
 if(mime==='image/png')return b.readUInt32BE(16);
 if(mime==='image/gif')return b.readUInt16LE(6);
 if(mime==='image/webp'){const t=b.toString('ascii',12,16);if(t==='VP8 ')return b.readUInt16LE(26)&0x3fff;if(t==='VP8L')return 1+(((b[22]&0x3f)<<8)|b[21]);if(t==='VP8X')return 1+b.readUIntLE(24,3);return null}
 if(mime==='image/jpeg'){let i=2;while(i+9<b.length){if(b[i]!==0xff){i++;continue}const mk=b[i+1];if(mk===0xd8||mk===0x01||(mk>=0xd0&&mk<=0xd7)){i+=2;continue}const len=b.readUInt16BE(i+2);
  if(mk>=0xc0&&mk<=0xcf&&![0xc4,0xc8,0xcc].includes(mk))return b.readUInt16BE(i+7);i+=2+len}return null}}catch{return null}return null}
const INLINE=new Set(['image/png','image/jpeg','image/gif','image/webp']);
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
const safeEq=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
export async function chatInit(){await q(`create table if not exists conversations(id serial primary key,user_id int not null references users on delete cascade,client_id int references clients,title text not null default 'New chat',created_at timestamptz default now(),last_user_at timestamptz,last_bot_at timestamptz,user_read_at timestamptz default now(),staff_read_at timestamptz default now());
 create table if not exists files(id text primary key,client_id int references clients,conversation_id int references conversations on delete set null,user_id int references users on delete set null,name text not null,mime text not null,size int not null,
  in_library boolean not null default false,category text,domain_id int references domains on delete set null,product text,notes text,created_at timestamptz default now());
 create table if not exists chat_messages(id serial primary key,conversation_id int not null references conversations on delete cascade,sender text not null check(sender in('user','bot','staff')),user_id int,text text not null default '',files jsonb not null default '[]',delivered boolean,created_at timestamptz default now());
 create index if not exists chat_messages_conv on chat_messages(conversation_id,id);create index if not exists files_client on files(client_id) where in_library;
 alter table files add column if not exists category text; alter table chat_messages add column if not exists attempts int not null default 0; alter table chat_messages add column if not exists next_attempt_at timestamptz; alter table chat_messages add column if not exists last_status int;
 create index if not exists chat_messages_retry on chat_messages(next_attempt_at) where delivered is not true and next_attempt_at is not null;`);startRetryWorker();fs.mkdirSync(DIR,{recursive:true});}
export const isAdmin=u=>!u.client_id&&['owner','admin'].includes(u.role);
const fileOut=(f,base='/api/files/')=>f&&({id:f.id,name:f.name,category:f.category||null,mime:f.mime,size:f.size,image:INLINE.has(f.mime),url:base+f.id,in_library:f.in_library,domain_id:f.domain_id,domain:f.domain,product:f.product,notes:f.notes,client_id:f.client_id,created_at:f.created_at});
async function filesByIds(ids){if(!ids.length)return{};return Object.fromEntries((await q('select f.*,d.domain from files f left join domains d on d.id=f.domain_id where f.id=any($1)',[ids])).map(f=>[f.id,f]));}
async function msgsOut(ms,base){const ids=[...new Set(ms.flatMap(m=>(m.files||[]).filter(x=>x.id).map(x=>x.id)))];const F=await filesByIds(ids);
 return ms.map(m=>({id:m.id,sender:m.sender,text:m.text,created_at:m.created_at,files:(m.files||[]).map(x=>x.id?fileOut(F[x.id],base):{url:x.url,external:true,image:true,name:x.url}).filter(Boolean)}));}
async function getConv(u,id){const[c]=await q(`select c.*,us.email,us.name from conversations c join users us on us.id=c.user_id where c.id=$1`,[+id]);if(!c||(c.user_id!==u.id&&!isAdmin(u)))throw err('No such conversation',404);return c;}
async function thread(c,after,base){const ms=await q('select * from chat_messages where conversation_id=$1 and id>$2 order by id',[c.id,+after||0]);
 const typing=!!c.last_user_at&&(!c.last_bot_at||c.last_bot_at<c.last_user_at)&&Date.now()-new Date(c.last_user_at)<120e3;
 return{id:c.id,title:c.title,email:c.email,name:c.name,client_id:c.client_id,typing,messages:await msgsOut(ms,base)};}
export function kindOf(name,buf){const ext=String(name||'').toLowerCase().split('.').pop();const k=KINDS[ext];if(!k)throw err('File type not allowed. Use images, PDF, SVG, AI/EPS, PSD, Sketch/XD/Fig or ZIP.');
 if(!buf?.length)throw err('Empty file');if(buf.length>k[1]&&!INLINE.has(k[0]))throw err(`This file is too big: .${ext} files can be up to ${k[1]/MB} MB.`);if(!k[2](buf))throw err(`That does not look like a real .${ext} file`);
 if(INLINE.has(k[0])){if(buf.length>k[1])throw err(`This image is ${(buf.length/MB).toFixed(1)} MB. Images can be up to 2 MB, so please make it smaller and try again.`);
  const w=imgWidth(buf,k[0]);if(w==null)throw err("We couldn't read this image's size. Try saving it as PNG or JPEG.");if(w>MAXW)throw err(`This image is ${w}px wide. Images can be up to ${MAXW}px wide, so please resize it and try again.`);}
 return k[0];}
async function saveFile(buf,name,o){name=String(name||'file').replace(/[\/\\\x00-\x1f"]/g,'_').slice(-120);const mime=kindOf(name,buf);const id=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(path.join(DIR,id),buf,{mode:0o600});
 const[f]=await q('insert into files(id,client_id,conversation_id,user_id,name,mime,size,in_library,domain_id,product,notes,category) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *',[id,o.client_id??null,o.conversation_id??null,o.user_id??null,name,mime,buf.length,!!o.in_library,o.domain_id||null,o.product||null,o.notes||null,o.category||null]);return f;}
function sendFile(res,f,dl){res.set({'Content-Type':f.mime,'Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",
 'Content-Disposition':`${INLINE.has(f.mime)&&!dl?'inline':'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g,'_')}"`}).send(fs.readFileSync(path.join(DIR,f.id)));}
// May this user see this file? Admin: all. Else: their own conversation's file, or a library file of their account.
async function canFile(u,f){if(isAdmin(u))return true;if(f.user_id===u.id)return true;
 if(f.conversation_id&&(await q('select 1 from conversations where id=$1 and user_id=$2',[f.conversation_id,u.id])).length)return true;
 return f.in_library&&u.client_id&&f.client_id===u.client_id;}
async function fileFor(u,id){if(!/^[0-9a-f]{32}$/.test(id))throw err('Not found',404);const[f]=await q('select * from files where id=$1',[id]);if(!f||!(await canFile(u,f)))throw err('Not found',404);return f;}
async function checkDomain(did,cid){if(!did)return null;if(!(await q('select 1 from domains where id=$1 and client_id is not distinct from $2',[+did,cid])).length)throw err('That domain is not on this account');return +did;}
// GRID_WEBHOOK_AUTH: full Authorization value (a leading 'Authorization:' header name is stripped); a bare token gets 'Bearer ' prefixed.
const whAuth=()=>{const a=String(process.env.GRID_WEBHOOK_AUTH||'').trim().replace(/^authorization\s*:\s*/i,'');return a?{Authorization:/^[A-Za-z][\w-]*\s+\S/.test(a)?a:'Bearer '+a}:{}};
// Delivery with retry. State lives on chat_messages (survives restarts). A row is "claimed" by pushing
// next_attempt_at forward before sending, so two workers/restarts never send the same message twice.
const BACKOFF=[30,120,600,1800]; // seconds after attempt 1..4; attempt 5 is the last
export async function deliver(mid){const url=process.env.GRID_WEBHOOK_URL;if(!url)return;
 const[m]=await q(`update chat_messages set attempts=attempts+1,next_attempt_at=now()+interval '5 minutes' where id=$1 and sender='user' and delivered is not true and (next_attempt_at is null or next_attempt_at<=now()) and attempts<5 returning *`,[mid]);if(!m)return;
 const[c]=await q('select * from conversations where id=$1',[m.conversation_id]);const[u]=c?await q('select * from users where id=$1',[c.user_id]):[];
 if(!c||!u){await q('update chat_messages set next_attempt_at=null where id=$1',[m.id]);return;}
 const fids=(m.files||[]).filter(x=>x.id).map(x=>x.id);const F=fids.length?await q('select * from files where id=any($1)',[fids]):[];
 const sc=await scopeFor(c,u).catch(()=>({accountId:c.client_id??null,userRole:u.role,domains:[]}));
 const att=F.map(f=>({id:f.id,name:f.name,category:f.category||null,mime:f.mime,size:f.size,url:`${API}/bot/files/${f.id}?conversationId=${c.id}`}));
 let st=0;try{const r=await fetch(url,{method:'POST',signal:AbortSignal.timeout(10e3),headers:{'Content-Type':'application/json','X-Grid-Webhook-Secret':process.env.GRID_WEBHOOK_SECRET||'',...whAuth()},
  body:JSON.stringify({conversationId:c.id,conversationTitle:c.title,accountId:sc.accountId,userRole:sc.userRole,domains:sc.domains,scope:sc,userEmail:u.email,userName:u.name||'',text:m.text,imageUrls:att.filter(a=>INLINE.has(a.mime)).map(a=>a.url),attachments:att,messageId:m.id,attempt:m.attempts})});st=r.status;}catch(e){st=0;console.error('webhook',m.id,'network',e.name);}
 const ok=st>=200&&st<300;const wait=BACKOFF[m.attempts-1];
 await q(`update chat_messages set delivered=$2,last_status=$3,next_attempt_at=case when $2 or $4::int is null then null else now()+make_interval(secs=>$4) end where id=$1`,[m.id,ok,st,ok?null:(wait??null)]);
 console.log('webhook',m.id,'attempt',m.attempts,'status',st,ok?'delivered':wait?`retry in ${wait}s`:'gave up');}
export function startRetryWorker(){const tick=async()=>{if(!process.env.GRID_WEBHOOK_URL)return;
 try{for(const{id}of await q(`select id from chat_messages where sender='user' and delivered is not true and next_attempt_at<=now() and attempts<5 order by id limit 20`))await deliver(id);}catch(e){console.error('retry worker',e.message)}};
 setInterval(tick,15e3).unref();setTimeout(tick,5e3);}
const raw=express.raw({type:()=>true,limit:26*MB});
const ids=v=>[...new Set((Array.isArray(v)?v:[]).map(String))].slice(0,10);
// ---- Bot routes (mount BEFORE the session gate) ----
export function botRoutes(r,{W}){
 const bot=(req,res,next)=>{const t=process.env.GRID_BOT_TOKEN;const h=String(req.get('authorization')||'');if(!t||!h.startsWith('Bearer ')||!safeEq(h.slice(7),t))return res.status(401).json({error:'Bad bot token'});next();};
 const B=API+'/bot/files/';
 r.post('/bot/messages',bot,W(async(req,res)=>{const b=req.body||{};const[c]=await q('select * from conversations where id=$1',[+b.conversationId]);if(!c)throw err('No such conversation',404);
  const text=String(b.text||'').slice(0,20000);const att=[];
  for(const u of [...(Array.isArray(b.imageUrls)?b.imageUrls:[]),...ids(b.fileIds).map(i=>'/files/'+i)].slice(0,10).map(String)){const m=u.match(/\/files\/([0-9a-f]{32})$/);
   const[f]=m?await q('select * from files where id=$1',[m[1]]):[];if(m&&!(f&&fileInScope(f,c)))throw err('File is not in this conversation or account',403);
   if(m)att.push({id:m[1]});else if(/^https:\/\/[^\s"'<>]+$/.test(u))att.push({url:u});else throw err('imageUrls must be https URLs or file URLs');}
  if(!text.trim()&&!att.length)throw err('Empty message');
  const[m]=await q(`insert into chat_messages(conversation_id,sender,text,files) values($1,'bot',$2,$3) returning *`,[c.id,text,JSON.stringify(att)]);
  await q('update conversations set last_bot_at=now() where id=$1',[c.id]);res.json({messageId:m.id})}));
 r.post('/bot/files',bot,raw,W(async(req,res)=>{const cid=+req.query.conversationId||null;const[c]=cid?await q('select * from conversations where id=$1',[cid]):[{}];if(cid&&!c)throw err('No such conversation',404);
  const f=await saveFile(req.body,req.query.name,{conversation_id:cid,client_id:c.client_id??null});res.json(fileOut(f,B))}));
 // Bot file reads/listing are scoped: pass conversationId; only that conversation's files and its account's library are reachable.
 r.get('/bot/files/:id',bot,W(async(req,res)=>{const[f]=/^[0-9a-f]{32}$/.test(req.params.id)?await q('select * from files where id=$1',[req.params.id]):[];if(!f)throw err('Not found',404);
  const[c]=await q('select * from conversations where id=$1',[+req.query.conversationId||0]);if(!c||!fileInScope(f,c))throw err('Not found (pass the conversationId it belongs to)',404);sendFile(res,f,true)}));
 r.get('/bot/conversations/:id',bot,W(async(req,res)=>{const[c]=await q(`select c.*,u.email,u.name from conversations c join users u on u.id=c.user_id where c.id=$1`,[+req.params.id]);if(!c)throw err('No such conversation',404);res.json(await thread(c,req.query.after,B))}));
 r.get('/bot/files',bot,W(async(req,res)=>{const[c]=await q('select * from conversations where id=$1',[+req.query.conversationId]);if(!c)throw err('Pass conversationId');
  res.json((await q('select f.*,d.domain from files f left join domains d on d.id=f.domain_id where conversation_id=$1 or (in_library and client_id is not null and client_id=$2) order by created_at desc limit 200',[c.id,c.client_id])).map(f=>fileOut(f,B)))}));}
// ---- User routes ----
export function chatRoutes(r,{W}){
 r.get('/chat/list',W(async(req,res)=>res.json(await q(`select c.id,c.title,c.created_at,(select text from chat_messages where conversation_id=c.id order by id desc limit 1) last_text,coalesce((select max(created_at) from chat_messages where conversation_id=c.id),c.created_at) last_at,(select count(*)::int from chat_messages m where m.conversation_id=c.id and m.sender<>'user' and m.created_at>c.user_read_at) unread from conversations c where user_id=$1 order by last_at desc`,[req.user.id]))));
 r.post('/chat/new',W(async(req,res)=>{const t=String(req.body?.title||'').trim().slice(0,80)||'New chat';res.json((await q('insert into conversations(user_id,client_id,title) values($1,$2,$3) returning id,title',[req.user.id,req.user.client_id||null,t]))[0])}));
 r.put('/chat/c/:id',W(async(req,res)=>{const c=await getConv(req.user,req.params.id);const t=String(req.body?.title||'').trim().slice(0,80);if(!t)throw err('Give it a title');await q('update conversations set title=$2 where id=$1',[c.id,t]);res.json({id:c.id,title:t})}));
 r.get('/chat/c/:id',W(async(req,res)=>{const c=await getConv(req.user,req.params.id);const t=await thread(c,req.query.after);
  if(c.user_id===req.user.id)await q('update conversations set user_read_at=now() where id=$1',[c.id]);else if(!req.query.after||t.messages.length)await q('update conversations set staff_read_at=now() where id=$1',[c.id]);res.json(t)}));
 r.post('/chat/c/:id/messages',W(async(req,res)=>{const c=await getConv(req.user,req.params.id);if(c.user_id!==req.user.id)throw err('Only the person in this chat can write here',403);
  const text=String(req.body?.text||'').slice(0,8000);const fid=ids(req.body?.files);const F=[];
  for(const i of fid){const[f]=await q('select * from files where id=$1',[i]);if(!f||!(await canFile(req.user,f)))throw err('File not found');F.push(f);}
  if(!text.trim()&&!F.length)throw err('Write a message');
  const[m]=await q(`insert into chat_messages(conversation_id,sender,user_id,text,files) values($1,'user',$2,$3,$4) returning *`,[c.id,req.user.id,text,JSON.stringify(F.map(f=>({id:f.id})))]);
  await q('update conversations set last_user_at=now(),user_read_at=now(),title=case when title=$2 and $3<>\'\' then left($3,60) else title end where id=$1',[c.id,'New chat',text.trim().split('\n')[0]]);
  deliver(m.id).catch(e=>console.error('webhook',e.message));res.json((await msgsOut([m]))[0])}));
 r.post('/chat/c/:id/upload',raw,W(async(req,res)=>{const c=await getConv(req.user,req.params.id);if(c.user_id!==req.user.id)throw err('Not your chat',403);
  res.json(fileOut(await saveFile(req.body,req.query.name,{conversation_id:c.id,client_id:c.client_id,user_id:req.user.id})))}));
 r.get('/chat/unread',W(async(req,res)=>{const[{n}]=await q(`select count(*)::int n from chat_messages m join conversations c on c.id=m.conversation_id where c.user_id=$1 and m.sender<>'user' and m.created_at>c.user_read_at`,[req.user.id]);
  const staff=isAdmin(req.user)?(await q(`select count(*)::int n from chat_messages m join conversations c on c.id=m.conversation_id where m.sender='user' and m.created_at>c.staff_read_at and c.user_id<>$1`,[req.user.id]))[0].n:0;res.json({unread:n,staff})}));
 const adm=(req,res,next)=>isAdmin(req.user)?next():res.status(403).json({error:'Owner or admin only'});
 r.get('/chat/all',adm,W(async(req,res)=>res.json(await q(`select c.id,c.title,u.email,u.name,cl.name client_name,(select text from chat_messages where conversation_id=c.id order by id desc limit 1) last_text,(select max(created_at) from chat_messages where conversation_id=c.id) last_at,(select count(*)::int from chat_messages m where m.conversation_id=c.id and m.sender='user' and m.created_at>c.staff_read_at) unread from conversations c join users u on u.id=c.user_id left join clients cl on cl.id=c.client_id where exists(select 1 from chat_messages where conversation_id=c.id) and c.user_id<>$1 order by last_at desc`,[req.user.id]))));
 // ---- Files / library ----
 const acct=(req,cid)=>req.user.client_id?req.user.client_id:(isAdmin(req.user)?(cid===''||cid==null||cid==='null'?null:+cid):(()=>{throw err('Owner or admin only',403)})());
 r.get('/files',W(async(req,res)=>{const all=isAdmin(req.user)&&(req.query.client==null||req.query.client==='all');const cid=all?null:acct(req,req.query.client);
  res.json((await q(`select f.*,d.domain,cl.name client_name from files f left join domains d on d.id=f.domain_id left join clients cl on cl.id=f.client_id where f.in_library and ($1 or f.client_id is not distinct from $2) order by f.created_at desc limit 500`,[all,cid])).map(f=>({...fileOut(f),client_name:f.client_name}))) }));
 r.get('/files/tags',W(async(req,res)=>{const cid=acct(req,req.query.client);res.json({categories:CATEGORIES,client_id:cid,domains:cid?await q('select id,domain from domains where client_id=$1 order by domain',[cid]):[],
  products:(await q(`select distinct product from files where in_library and product is not null and client_id is not distinct from $1 order by 1`,[cid])).map(r=>r.product)})}));
 r.post('/files/upload',raw,W(async(req,res)=>{const cid=acct(req,req.query.client);const category=cat(req.query.category,true);const did=await checkDomain(req.query.domain_id,cid);
  res.json(fileOut(await saveFile(req.body,req.query.name,{client_id:cid,user_id:req.user.id,in_library:true,category,domain_id:did,product:String(req.query.product||'').slice(0,80)||null,notes:String(req.query.notes||'').slice(0,500)||null})))}));
 r.put('/files/:id',W(async(req,res)=>{const f=await fileFor(req.user,req.params.id);const b=req.body||{};const did=b.domain_id!==undefined?await checkDomain(b.domain_id,f.client_id):f.domain_id;const lib=b.in_library??true;
  const category=b.category!==undefined?cat(b.category,lib):f.category;if(lib&&!category)throw err('Pick a category for this file');
  await q('update files set in_library=$2,domain_id=$3,product=$4,notes=$5,name=$6,category=$7 where id=$1',[f.id,lib,did,b.product!==undefined?(String(b.product).slice(0,80)||null):f.product,b.notes!==undefined?(String(b.notes).slice(0,500)||null):f.notes,b.name?String(b.name).replace(/[\/\\\x00-\x1f"]/g,'_').slice(0,120):f.name,category]);
  res.json(fileOut((await q('select f.*,d.domain from files f left join domains d on d.id=f.domain_id where f.id=$1',[f.id]))[0]))}));
 r.get('/files/:id',W(async(req,res)=>sendFile(res,await fileFor(req.user,req.params.id),req.query.dl==='1')));}
