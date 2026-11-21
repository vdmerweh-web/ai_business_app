// Web push (PWA notifications). VAPID keys come from env (.env on the server), never from git.
import webpush from 'web-push';import rateLimit from 'express-rate-limit';import {q} from './db.js';
const PUB=process.env.VAPID_PUBLIC_KEY||'',PRIV=process.env.VAPID_PRIVATE_KEY||'';
const ON=!!(PUB&&PRIV);if(ON)webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:hannes@planet-grid.com',PUB,PRIV);
export async function pushInit(){await q(`create table if not exists push_subscriptions(id serial primary key,user_id int not null references users(id) on delete cascade,endpoint text not null unique,p256dh text not null,auth text not null,user_agent text,created_at timestamptz default now());
 create index if not exists push_subscriptions_user on push_subscriptions(user_id)`);}
// Send to all of one user's devices; drops subscriptions the push service says are gone (404/410).
export async function pushToUser(uid,payload){if(!ON)return{sent:0,failed:0};const subs=await q('select * from push_subscriptions where user_id=$1',[uid]);let sent=0,failed=0;
 for(const s of subs){try{await webpush.sendNotification({endpoint:s.endpoint,keys:{p256dh:s.p256dh,auth:s.auth}},JSON.stringify(payload),{TTL:3600});sent++}
  catch(e){failed++;if(e.statusCode===404||e.statusCode===410)await q('delete from push_subscriptions where id=$1',[s.id]);else console.error('push',e.statusCode||e.message)}}
 return{sent,failed};}
const okEndpoint=u=>{try{const x=new URL(u);return x.protocol==='https:'&&u.length<1000}catch{return false}};
export function pushRoutes(r,{W}){
 r.get('/push/key',(req,res)=>res.json({enabled:ON,key:PUB}));
 r.get('/push/status',W(async(req,res)=>res.json({devices:(await q('select count(*)::int n from push_subscriptions where user_id=$1',[req.user.id]))[0].n})));
 r.post('/push/subscribe',rateLimit({windowMs:15*60e3,limit:20,standardHeaders:true}),W(async(req,res)=>{const s=req.body||{};const k=s.keys||{};
  if(!okEndpoint(s.endpoint)||typeof k.p256dh!=='string'||typeof k.auth!=='string'||k.p256dh.length>200||k.auth.length>100)throw new Error('Bad subscription');
  await q(`insert into push_subscriptions(user_id,endpoint,p256dh,auth,user_agent) values($1,$2,$3,$4,$5) on conflict(endpoint) do update set user_id=$1,p256dh=$3,auth=$4,user_agent=$5`,[req.user.id,s.endpoint,k.p256dh,k.auth,String(req.get('user-agent')||'').slice(0,300)]);res.json({ok:1})}));
 r.post('/push/unsubscribe',W(async(req,res)=>{const e=String(req.body?.endpoint||'');await q('delete from push_subscriptions where user_id=$1 and endpoint=$2',[req.user.id,e]);res.json({ok:1})}));
 r.post('/push/test',rateLimit({windowMs:15*60e3,limit:5,standardHeaders:true,message:{error:'Too many test notifications. Wait 15 minutes.'}}),W(async(req,res)=>{
  if(!ON)throw new Error('Notifications are not set up on the server yet');const out=await pushToUser(req.user.id,{title:'Planet Grid',body:'Test notification: it works! Tap to open the app.',url:'/account',tag:'pg-test'});
  if(!out.sent)throw new Error('No device got it. Turn notifications on again on this device.');res.json(out)}));}
