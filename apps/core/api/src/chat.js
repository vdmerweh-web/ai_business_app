// Chat with the bot "Admin". Same mechanism as Planet Grid:
//  out: POST CG_WEBHOOK_URL (X-CG-Webhook-Secret: CG_WEBHOOK_SECRET, Authorization: CG_WEBHOOK_AUTH) with retry worker.
//  in:  bearer CG_BOT_TOKEN on /bot/messages, /bot/conversations/:id, /bot/files.
import express from 'express';import crypto from 'crypto';import fs from 'fs';import path from 'path';import {db,now} from './db.js';
import {startPromptLog, finishPromptLog} from './promptLog.js';
const DIR=process.env.UPLOAD_DIR||'/data/uploads';const APP=process.env.APP_URL||'https://app.codegreene.com';const MB=1024*1024;
const has=(b,s,o=0)=>b.slice(o,o+s.length).equals(Buffer.from(s,'latin1'));
const KINDS={png:['image/png',b=>has(b,'\x89PNG')],jpg:['image/jpeg',b=>b[0]===0xff&&b[1]===0xd8],jpeg:['image/jpeg',b=>b[0]===0xff&&b[1]===0xd8],
 gif:['image/gif',b=>has(b,'GIF8')],webp:['image/webp',b=>has(b,'RIFF')&&has(b,'WEBP',8)],pdf:['application/pdf',b=>has(b,'%PDF')],txt:['text/plain',()=>true],log:['text/plain',()=>true]};
const INLINE=new Set(['image/png','image/jpeg','image/gif','image/webp']);const MAX=5*MB;
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
const safeEq=(a,b)=>{const x=crypto.createHash('sha256').update(String(a)).digest(),y=crypto.createHash('sha256').update(String(b)).digest();return crypto.timingSafeEqual(x,y)};
fs.mkdirSync(DIR,{recursive:true});
function kindOf(name,buf){const ext=String(name||'').toLowerCase().split('.').pop();const k=KINDS[ext];if(!k)throw err('File type not allowed. Use PNG, JPEG, GIF, WebP, PDF or TXT.');
 if(!buf?.length)throw err('Empty file');if(buf.length>MAX)throw err(`This file is ${(buf.length/MB).toFixed(1)} MB. The limit is 5 MB.`);if(!k[1](buf))throw err(`That does not look like a real .${ext} file`);return k[0];}
function saveFile(buf,name,cid,uid){name=String(name||'file').replace(/[\/\\\x00-\x1f"]/g,'_').slice(-120);const mime=kindOf(name,buf);const id=crypto.randomBytes(16).toString('hex');
 fs.writeFileSync(path.join(DIR,id),buf,{mode:0o600});db.prepare('insert into files(id,conversation_id,user_id,name,mime,size) values(?,?,?,?,?,?)').run(id,cid,uid,name,mime,buf.length);return db.prepare('select * from files where id=?').get(id);}
const fileOut=(f,base='/api/files/')=>f&&{id:f.id,name:f.name,mime:f.mime,size:f.size,image:INLINE.has(f.mime),url:base+f.id};
function sendFile(res,f,dl){res.set({'Content-Type':f.mime,'Cache-Control':'private, max-age=86400','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox",
 'Content-Disposition':`${INLINE.has(f.mime)&&!dl?'inline':'attachment'}; filename="${f.name.replace(/[^\x20-\x7e]/g,'_')}"`}).send(fs.readFileSync(path.join(DIR,f.id)));}
function msgsOut(ms,base){return ms.map(m=>({id:m.id,sender:m.sender,text:m.text,created_at:m.created_at,delivered:m.sender==='user'?(m.delivered===1?true:m.next_attempt_at||m.attempts===0?null:false):undefined,
 files:JSON.parse(m.files||'[]').map(x=>x.id?fileOut(db.prepare('select * from files where id=?').get(x.id),base):{url:x.url,external:true,image:true,name:x.url}).filter(Boolean)}));}
function getConv(u,id){const c=db.prepare('select c.*,u.email,u.name from conversations c join users u on u.id=c.user_id where c.id=?').get(+id);if(!c||c.user_id!==u.id)throw err('No such conversation',404);return c;}
function thread(c,after,base){const ms=db.prepare('select * from chat_messages where conversation_id=? and id>? order by id').all(c.id,+after||0);
 const typing=!!c.last_user_at&&(!c.last_bot_at||c.last_bot_at<c.last_user_at)&&now()-c.last_user_at<120e3;
 return{id:c.id,title:c.title,section:c.section,email:c.email,name:c.name,typing,messages:msgsOut(ms,base)};}
const whAuth=()=>{const a=String(process.env.CG_WEBHOOK_AUTH||'').trim().replace(/^authorization\s*:\s*/i,'');return a?{Authorization:/^[A-Za-z][\w-]*\s+\S/.test(a)?a:'Bearer '+a}:{}};
// Delivery with retry; state is on chat_messages so it survives restarts. Claim a row by pushing next_attempt_at forward before sending.
const BACKOFF=[30,120,600,1800];
export async function deliver(mid){const url=process.env.CG_WEBHOOK_URL;if(!url)return;
 const m=db.prepare(`update chat_messages set attempts=attempts+1,next_attempt_at=? where id=? and sender='user' and coalesce(delivered,0)=0 and (next_attempt_at is null or next_attempt_at<=?) and attempts<5 returning *`).get(now()+300e3,mid,now());if(!m)return;
 const c=db.prepare('select c.*,u.email,u.name from conversations c join users u on u.id=c.user_id where c.id=?').get(m.conversation_id);
 if(!c){db.prepare('update chat_messages set next_attempt_at=null where id=?').run(m.id);return;}
 const F=JSON.parse(m.files||'[]').filter(x=>x.id).map(x=>db.prepare('select * from files where id=?').get(x.id)).filter(Boolean);
 const att=F.map(f=>({id:f.id,name:f.name,mime:f.mime,size:f.size,url:`${APP}/api/bot/files/${f.id}?conversationId=${c.id}`}));
 let st=0;try{const r=await fetch(url,{method:'POST',signal:AbortSignal.timeout(10e3),headers:{'Content-Type':'application/json','X-CG-Webhook-Secret':process.env.CG_WEBHOOK_SECRET||'',...whAuth()},
  body:JSON.stringify({app:'app.codegreene.com',section:c.section,conversationId:c.id,conversationTitle:c.title,userEmail:c.email,userName:c.name||'',userRole:'admin',text:m.text,
   imageUrls:att.filter(a=>INLINE.has(a.mime)).map(a=>a.url),attachments:att,messageId:m.id,attempt:m.attempts,replyTo:`${APP}/api/bot/messages`})});st=r.status;}catch(e){st=0;console.error('webhook',m.id,'network',e.name);}
 const ok=st>=200&&st<300;const wait=BACKOFF[m.attempts-1];
 db.prepare('update chat_messages set delivered=?,last_status=?,next_attempt_at=? where id=?').run(ok?1:0,st,ok||wait==null?null:now()+wait*1e3,m.id);
 console.log('webhook',m.id,'attempt',m.attempts,'status',st,ok?'delivered':wait?`retry in ${wait}s`:'gave up');}
export function startRetryWorker(){const tick=async()=>{if(!process.env.CG_WEBHOOK_URL)return;
 try{for(const{id}of db.prepare(`select id from chat_messages where sender='user' and coalesce(delivered,0)=0 and next_attempt_at<=? and attempts<5 order by id limit 20`).all(now()))await deliver(id);}catch(e){console.error('retry worker',e.message)}};
 setInterval(tick,15e3).unref();setTimeout(tick,5e3).unref();}
const raw=express.raw({type:()=>true,limit:MAX+1024});
const ids=v=>[...new Set((Array.isArray(v)?v:[]).map(String))].filter(x=>/^[0-9a-f]{32}$/.test(x)).slice(0,10);
export const botAuth=(req,res,next)=>{const t=process.env.CG_BOT_TOKEN;const h=String(req.get('authorization')||'');if(!t||t.length<24||!h.startsWith('Bearer ')||!safeEq(h.slice(7),t))return res.status(401).json({error:'Bad bot token'});next();};
export function botRoutes(r,{W}){const bot=botAuth;
 const B=APP+'/api/bot/files/';
 r.post('/bot/messages',bot,W(async(req,res)=>{const b=req.body||{};const c=db.prepare('select * from conversations where id=?').get(+b.conversationId);if(!c)throw err('No such conversation',404);
  const text=String(b.text||'').slice(0,20000);const att=[];
  for(const u of [...(Array.isArray(b.imageUrls)?b.imageUrls:[]),...ids(b.fileIds).map(i=>'/files/'+i)].slice(0,10).map(String)){const m=u.match(/\/files\/([0-9a-f]{32})(\?|$)/);
   if(m){const f=db.prepare('select * from files where id=?').get(m[1]);if(!f||f.conversation_id!==c.id)throw err('File is not in this conversation',403);att.push({id:m[1]});}
   else if(/^https:\/\/[^\s"'<>]+$/.test(u))att.push({url:u});else throw err('imageUrls must be https URLs or file URLs');}
  if(!text.trim()&&!att.length)throw err('Empty message');
  const m=db.prepare(`insert into chat_messages(conversation_id,sender,text,files) values(?,'bot',?,?) returning id`).get(c.id,text,JSON.stringify(att));
  db.prepare('update conversations set last_bot_at=? where id=?').run(now(),c.id);
  const agent=c.section==='server-admin'?'admin':(c.section||'admin');
  try{finishPromptLog(c.id,agent,{status:'ok',response_length:text.length})}catch(e){console.error('prompt log finish',e.message)}
  res.json({messageId:m.id})}));
 r.post('/bot/files',bot,raw,W(async(req,res)=>{const c=db.prepare('select * from conversations where id=?').get(+req.query.conversationId);if(!c)throw err('Pass a valid conversationId',404);
  res.json(fileOut(saveFile(req.body,req.query.name,c.id,null),B))}));
 r.get('/bot/files/:id',bot,W(async(req,res)=>{const f=/^[0-9a-f]{32}$/.test(req.params.id)?db.prepare('select * from files where id=?').get(req.params.id):null;
  if(!f||f.conversation_id!==+req.query.conversationId)throw err('Not found (pass the conversationId it belongs to)',404);sendFile(res,f,true)}));
 r.get('/bot/files',bot,W(async(req,res)=>{const c=db.prepare('select * from conversations where id=?').get(+req.query.conversationId);if(!c)throw err('Pass conversationId');
  res.json(db.prepare('select * from files where conversation_id=? order by created_at desc limit 200').all(c.id).map(f=>fileOut(f,B)))}));
 r.get('/bot/conversations/:id',bot,W(async(req,res)=>{const c=db.prepare('select c.*,u.email,u.name from conversations c join users u on u.id=c.user_id where c.id=?').get(+req.params.id);if(!c)throw err('No such conversation',404);res.json(thread(c,req.query.after,B))}));
}
export function chatRoutes(r,{W}){
 r.get('/chat/list',W(async(req,res)=>res.json(db.prepare(`select c.id,c.title,c.section,c.created_at,(select text from chat_messages where conversation_id=c.id order by id desc limit 1) last_text,
  coalesce((select max(created_at) from chat_messages where conversation_id=c.id),c.created_at) last_at,(select count(*) from chat_messages m where m.conversation_id=c.id and m.sender='bot' and strftime('%s',m.created_at)*1000>c.user_read_at) unread
  from conversations c where user_id=? and section=? order by last_at desc`).all(req.user.id,String(req.query.section||'server-admin')))));
 r.post('/chat/new',W(async(req,res)=>{const t=String(req.body?.title||'').trim().slice(0,80)||'New chat';const s=String(req.body?.section||'server-admin').replace(/[^a-z0-9-]/g,'').slice(0,40)||'server-admin';
  res.json(db.prepare('insert into conversations(user_id,section,title) values(?,?,?) returning id,title,section').get(req.user.id,s,t))}));
 r.put('/chat/c/:id',W(async(req,res)=>{const c=getConv(req.user,req.params.id);const t=String(req.body?.title||'').trim().slice(0,80);if(!t)throw err('Give it a title');db.prepare('update conversations set title=? where id=?').run(t,c.id);res.json({id:c.id,title:t})}));
 r.delete('/chat/c/:id',W(async(req,res)=>{const c=getConv(req.user,req.params.id);for(const f of db.prepare('select id from files where conversation_id=?').all(c.id))fs.rmSync(path.join(DIR,f.id),{force:true});
  db.prepare('delete from conversations where id=?').run(c.id);res.json({ok:1})}));
 r.get('/chat/c/:id',W(async(req,res)=>{const c=getConv(req.user,req.params.id);const t=thread(c,req.query.after);db.prepare('update conversations set user_read_at=? where id=?').run(now(),c.id);res.json(t)}));
 r.post('/chat/c/:id/messages',W(async(req,res)=>{const c=getConv(req.user,req.params.id);const text=String(req.body?.text||'').slice(0,8000);
  const F=ids(req.body?.files).map(i=>{const f=db.prepare('select * from files where id=?').get(i);if(!f||f.conversation_id!==c.id)throw err('File not found');return f;});
  if(!text.trim()&&!F.length)throw err('Write a message');
  const m=db.prepare(`insert into chat_messages(conversation_id,sender,user_id,text,files) values(?,'user',?,?,?) returning *`).get(c.id,req.user.id,text,JSON.stringify(F.map(f=>({id:f.id}))));
  db.prepare(`update conversations set last_user_at=?,user_read_at=?,title=case when title='New chat' and ?<>'' then substr(?,1,60) else title end where id=?`).run(now(),now(),text.trim(),text.trim().split('\n')[0],c.id);
  const agent=c.section==='server-admin'?'admin':(c.section||'admin');
  try{startPromptLog({agent,user:req.user,client:req.user.client_id?{id:req.user.client_id}:null,prompt:text,conversationId:c.id})}catch(e){console.error('prompt log start',e.message)}
  deliver(m.id).catch(e=>console.error('webhook',e.message));res.json(msgsOut([m])[0])}));
 r.post('/chat/c/:id/upload',raw,W(async(req,res)=>{const c=getConv(req.user,req.params.id);res.json(fileOut(saveFile(req.body,req.query.name,c.id,req.user.id)))}));
 r.get('/files/:id',W(async(req,res)=>{const f=/^[0-9a-f]{32}$/.test(req.params.id)?db.prepare('select f.* from files f join conversations c on c.id=f.conversation_id where f.id=? and c.user_id=?').get(req.params.id,req.user.id):null;
  if(!f)throw err('Not found',404);sendFile(res,f,req.query.dl==='1')}));
}
