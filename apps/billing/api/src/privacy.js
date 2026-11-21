// POPIA: cookie-consent log, marketing consent/opt-out, suppression list, unsubscribe. Additive migrations only.
import crypto from 'crypto';import rateLimit from 'express-rate-limit';import {q} from './db.js';import {ipH} from './security.js';
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
const normE=e=>String(e||'').trim().toLowerCase().slice(0,200)||null;
const normP=p=>{let d=String(p||'').replace(/[^\d+]/g,'');if(d.startsWith('0')&&d.length===10)d='+27'+d.slice(1);return d.length>=9?d.slice(0,20):null};
let SECRET;
export async function privacyInit(){
 await q(`create table if not exists cookie_consents(id bigserial primary key,site text not null,consent_id text not null,version text,analytics boolean not null,marketing boolean not null,action text,ip_hash text,ua text,at timestamptz default now());
 create index if not exists cookie_consents_cid on cookie_consents(consent_id);
 create table if not exists marketing_suppression(id serial primary key,client_id int references clients,email text,phone text,reason text not null default 'opt-out',source text not null,user_id int,created_at timestamptz default now());
 create unique index if not exists msup_email on marketing_suppression(coalesce(client_id,0),email) where email is not null;
 create unique index if not exists msup_phone on marketing_suppression(coalesce(client_id,0),phone) where phone is not null;
 alter table crm_contacts add column if not exists marketing_consent boolean; alter table crm_contacts add column if not exists marketing_consent_at timestamptz;
 alter table crm_contacts add column if not exists marketing_consent_source text; alter table crm_contacts add column if not exists opted_out_at timestamptz; alter table crm_contacts add column if not exists opt_out_source text;
 alter table crm_companies add column if not exists marketing_consent boolean; alter table crm_companies add column if not exists marketing_consent_at timestamptz;
 alter table crm_companies add column if not exists marketing_consent_source text; alter table crm_companies add column if not exists opted_out_at timestamptz; alter table crm_companies add column if not exists opt_out_source text;`);
 await q(`insert into settings values('unsub_secret',$1) on conflict do nothing`,[crypto.randomBytes(32).toString('hex')]);
 SECRET=(await q(`select value from settings where key='unsub_secret'`))[0].value;}
const sig=s=>crypto.createHmac('sha256',SECRET).update(s).digest('base64url').slice(0,32);
export const unsubToken=(clientId,email)=>{const p=Buffer.from(JSON.stringify([clientId||0,normE(email)])).toString('base64url');return p+'.'+sig(p)};
function readToken(t){const[p,s]=String(t||'').split('.');if(!p||!s||s.length!==32||!crypto.timingSafeEqual(Buffer.from(s),Buffer.from(sig(p))))throw err('This unsubscribe link is not valid',400);const[c,e]=JSON.parse(Buffer.from(p,'base64url'));return{client_id:c||null,email:e}}
export async function suppress({client_id,email,phone,source,reason='opt-out',user_id}){email=normE(email);phone=normP(phone);if(!email&&!phone)throw err('Give an email or phone');
 if(email)await q(`insert into marketing_suppression(client_id,email,reason,source,user_id) values($1,$2,$3,$4,$5) on conflict do nothing`,[client_id||null,email,reason,source,user_id||null]);
 if(phone)await q(`insert into marketing_suppression(client_id,phone,reason,source,user_id) values($1,$2,$3,$4,$5) on conflict do nothing`,[client_id||null,phone,reason,source,user_id||null]);
 for(const t of['crm_contacts','crm_companies']){const col=t==='crm_contacts'?'mobile':'phone';
  await q(`update ${t} set marketing_consent=false,opted_out_at=coalesce(opted_out_at,now()),opt_out_source=coalesce(opt_out_source,$4) where coalesce(client_id,0)=coalesce($1::int,0) and ((lower(email)=$2 and $2 is not null) or ($3::text is not null and regexp_replace(coalesce(${col},''),'[^0-9]','','g') like '%'||right(regexp_replace($3,'[^0-9]','','g'),9)))`,[client_id||null,email,phone,source]).catch(e=>{if(e.code!=='42703')throw e});}}
// The only allowed way to get a marketing list: opted in, not opted out, not DNC, not suppressed.
export const marketableSql=`p.marketing_consent is true and p.opted_out_at is null and not p.dnc and not exists(select 1 from marketing_suppression s where coalesce(s.client_id,0)=coalesce(p.client_id,0) and ((s.email is not null and s.email=lower(p.email)) or (s.phone is not null and right(regexp_replace(coalesce(p.mobile,''),'[^0-9]','','g'),9)=right(regexp_replace(s.phone,'[^0-9]','','g'),9))))`;
const page=(t,b)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><style>body{font:17px/1.5 system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 18px;color:#06122A}button{font:inherit;padding:10px 16px;border-radius:9px;border:0;background:#06122A;color:#fff;cursor:pointer}button:focus-visible{outline:3px solid #ffd166;outline-offset:2px}</style></head><body><main><h1>${t}</h1>${b}</main></body></html>`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function publicPrivacyRoutes(r,{W}){
 const lim=rateLimit({windowMs:60e3,limit:30,standardHeaders:true});
 const cors=(req,res,next)=>{res.set({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type'});if(req.method==='OPTIONS')return res.sendStatus(204);next()};
 r.options('/public/consent',cors);
 r.post('/public/consent',cors,lim,W(async(req,res)=>{const b=req.body||{};const site=String(b.site||'').slice(0,100),id=String(b.consent_id||'').slice(0,64);if(!site||!id)throw err('site and consent_id');
  await q('insert into cookie_consents(site,consent_id,version,analytics,marketing,action,ip_hash,ua) values($1,$2,$3,$4,$5,$6,$7,$8)',[site,id,String(b.version||'').slice(0,10),!!b.analytics,!!b.marketing,String(b.action||'').slice(0,20),ipH(req.ip),String(req.get('user-agent')||'').slice(0,200)]);res.json({ok:1})}));
 r.get('/public/unsubscribe',lim,W(async(req,res)=>{let t;try{t=readToken(req.query.t)}catch(e){return res.status(400).type('html').send(page('Link not valid','<p>This unsubscribe link is broken or expired. Reply to the email with STOP, or email hannes@planet-grid.com, and we will remove you.</p>'))}
  res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'").type('html').send(page('Unsubscribe',`<p>Stop marketing messages to <strong>${esc(t.email)}</strong>?</p><form method="post"><input type="hidden" name="t" value="${esc(req.query.t)}"><button type="submit">Yes, unsubscribe me</button></form>`))}));
 const form=(req,res,next)=>{if(req.is('application/x-www-form-urlencoded')){let d='';req.on('data',c=>{d+=c;if(d.length>4000)req.destroy()});req.on('end',()=>{req.body=Object.fromEntries(new URLSearchParams(d));next()})}else next()};
 r.post('/public/unsubscribe',lim,form,W(async(req,res)=>{const tk=req.body?.t||req.query.t||(String(req.get('list-unsubscribe-post')||'')&&req.query.t);let t;try{t=readToken(tk)}catch(e){return res.status(400).type('html').send(page('Link not valid','<p>This unsubscribe link is not valid.</p>'))}
  await suppress({client_id:t.client_id,email:t.email,source:'unsubscribe-link'});res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'").type('html').send(page('You are unsubscribed','<p>Done. You will not get marketing messages from us any more. Service messages about your account or orders may still be sent.</p>'))}));
 }
// Logged-in CRM endpoints (account-scoped like the rest of the CRM)
export function privacyRoutes(r,{W,need}){
 const acct=req=>req.user.client_id||null;
 r.get('/crm/suppression',need('crm','read'),W(async(req,res)=>res.json(await q('select id,email,phone,reason,source,created_at from marketing_suppression where coalesce(client_id,0)=coalesce($1::int,0) order by created_at desc limit 2000',[acct(req)]))));
 r.post('/crm/suppression',need('crm','edit'),W(async(req,res)=>{const b=req.body||{};await suppress({client_id:acct(req),email:b.email,phone:b.phone,source:String(b.source||'manual').slice(0,60),reason:String(b.reason||'opt-out').slice(0,60),user_id:req.user.id});res.json({ok:1})}));
 r.post('/crm/contacts/:id/marketing',need('crm','edit'),W(async(req,res)=>{const b=req.body||{};const a=acct(req);const[p]=await q('select * from crm_contacts where id=$1 and coalesce(client_id,0)=coalesce($2::int,0)',[+req.params.id,a]);if(!p)throw err('Not found',404);
  const src=String(b.source||'').trim().slice(0,200);if(!src)throw err('Say how you got this (e.g. "signed up on website form 20 Oct")');
  if(b.consent===true){if((await q(`select 1 from crm_contacts p where id=$1 and exists(select 1 from marketing_suppression s where coalesce(s.client_id,0)=coalesce(p.client_id,0) and s.email=lower(p.email))`,[p.id])).length&&!b.override_optout)throw err('This person opted out before. Only mark them as opted in if they asked again themselves, and tick that.');
   if(b.override_optout&&p.email)await q('delete from marketing_suppression where coalesce(client_id,0)=coalesce($1::int,0) and email=lower($2)',[a,p.email]);
   await q('update crm_contacts set marketing_consent=true,marketing_consent_at=now(),marketing_consent_source=$2,opted_out_at=null,opt_out_source=null where id=$1',[p.id,src]);}
  else await suppress({client_id:a,email:p.email,phone:p.mobile,source:src,user_id:req.user.id}).catch(async e=>{if(e.status!==400)throw e;await q('update crm_contacts set marketing_consent=false,opted_out_at=now(),opt_out_source=$2 where id=$1',[p.id,src])});
  res.json((await q('select id,marketing_consent,marketing_consent_at,marketing_consent_source,opted_out_at,opt_out_source from crm_contacts where id=$1',[p.id]))[0])}));
 r.get('/crm/marketing/audience',need('crm','read'),W(async(req,res)=>{const a=acct(req);const rows=await q(`select p.id,p.name,p.email,p.mobile from crm_contacts p where coalesce(p.client_id,0)=coalesce($1::int,0) and ${marketableSql} order by p.name`,[a]);
  res.json(rows.map(x=>({...x,unsubscribe_url:x.email?`https://api.planet-grid.com/public/unsubscribe?t=${unsubToken(a,x.email)}`:null})))}));}
