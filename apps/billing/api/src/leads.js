// CRM > Leads. Per account (client_id IS NOT DISTINCT FROM acct). Record type 'leads'.
// Pipeline: cold -> contacted -> engaged -> qualified -> proposal -> negotiation, outcomes won / lost / unsubscribed / client.
// Priority = transparent score: fit + engagement x recency decay, mapped to Hot/Warm/Cold, with reasons. Manual override allowed.
import rateLimit from 'express-rate-limit';import {q} from './db.js';import {ipH} from './security.js';import {suppress} from './privacy.js';
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
const A='client_id is not distinct from $1';
export const STAGES=[['cold','Cold'],['contacted','Contacted'],['engaged','Engaged / replied'],['qualified','Qualified'],['proposal','Proposal sent'],['negotiation','Negotiation'],['won','Won'],['lost','Turned down / lost'],['unsubscribed','Unsubscribed'],['client','Current client']];
const SK=STAGES.map(s=>s[0]);const CLOSED=['won','lost','unsubscribed','client'];
const FORM_W={quote:25,audit:20,review:20,contact:15,call:20,signup:15,newsletter:5,manual:0,import:0};
const ACT=['note','call','email','whatsapp','meeting','reply','visit','form','stage','system'];
export async function leadsInit(){await q(`
 create table if not exists leads(id serial primary key,client_id int references clients,name text,company text,email text,phone text,website text,business_type text,location text,country text,
  source text not null default 'manual',form_type text,message text,utm_source text,utm_medium text,utm_campaign text,utm_term text,utm_content text,landing_page text,referrer text,
  stage text not null default 'cold',lost_reason text,priority_override text check(priority_override in('hot','warm','cold')),override_note text,owner_user_id int,next_followup date,
  replies int not null default 0,visits int not null default 0,consent_marketing boolean,consent_at timestamptz,consent_source text,consent_text text,consent_ip_hash text,
  contact_id int references crm_contacts on delete set null,converted_client_id int references clients,tags text[] not null default '{}',
  last_activity_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now());
 create index if not exists leads_acct on leads(client_id,stage);create index if not exists leads_email on leads(client_id,lower(email));create index if not exists leads_phone on leads(client_id,phone);
 create table if not exists lead_activities(id serial primary key,lead_id int not null references leads on delete cascade,client_id int,kind text not null,body text,meta jsonb,user_id int,at timestamptz default now());
 create index if not exists lead_act_lead on lead_activities(lead_id,at);`);}
const clean=(v,n=200)=>v==null||v===''?null:String(v).trim().slice(0,n)||null;
const normE=e=>{const x=clean(e,200)?.toLowerCase()||null;if(x&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))throw err('That email does not look right');return x};
const normP=p=>{let d=String(p||'').replace(/[^\d+]/g,'');if(d.startsWith('00'))d='+'+d.slice(2);if(d.startsWith('0')&&d.length===10)d='+27'+d.slice(1);if(/^27\d{9}$/.test(d))d='+'+d;return d.replace(/\D/g,'').length>=9?d.slice(0,20):null};
const SA=/south africa|\bza\b|gauteng|western cape|kwazulu|natal|eastern cape|free state|limpopo|mpumalanga|north west|northern cape|johannesburg|pretoria|cape town|durban|gqeberha|port elizabeth|bloemfontein|polokwane|nelspruit|mbombela|centurion|sandton|stellenbosch|pietermaritzburg|east london|kimberley/i;
const GOOD_BIZ=/retail|shop|store|trade|service|plumb|electric|build|construct|salon|beauty|restaurant|cafe|guest|lodge|tour|travel|clinic|dental|medical|law|attorney|account|consult|agency|school|church|ngo|manufactur|auto|motor|garden|cleaning|security|property|estate|hobby|model|aviation|fitness|gym|photo|events?/i;
// ---- transparent priority ----
export function score(l,now=Date.now()){const R=[];let fit=0,eng=0;
 if(l.website){fit+=12;R.push(['+12','Has a website we can improve'])}else{fit+=6;R.push(['+6','No website yet (needs one)'])}
 if(l.business_type){if(GOOD_BIZ.test(l.business_type)){fit+=10;R.push(['+10',`Business type fits: ${l.business_type}`])}else{fit+=4;R.push(['+4',`Business type given: ${l.business_type}`])}}
 const sa=(l.country||'').toUpperCase()==='ZA'||SA.test(l.location||'')||/^\+27/.test(l.phone||'')||/\.co\.za\b|\.za\b/.test(l.website||'')||/\.co\.za$/.test(l.email||'');
 if(sa){fit+=12;R.push(['+12','Based in South Africa'])}
 if(l.company){fit+=3;R.push(['+3','Company name given'])}if(l.phone){fit+=3;R.push(['+3','Phone number given'])}
 const fw=FORM_W[l.form_type]??0;if(fw){eng+=fw;R.push([`+${fw}`,`Came in via ${l.form_type} form`])}
 const rp=Math.min(20,(l.replies||0)*10);if(rp){eng+=rp;R.push([`+${rp}`,`${l.replies} repl${l.replies===1?'y':'ies'}`])}
 const vs=Math.min(10,(l.visits||0)*2);if(vs){eng+=vs;R.push([`+${vs}`,`${l.visits} page visit${l.visits===1?'':'s'}`])}
 const days=Math.max(0,(now-new Date(l.last_activity_at||l.created_at||now))/864e5);const decay=Math.pow(0.5,days/14);
 const engD=Math.round(eng*decay);if(eng&&engD<eng)R.push([`−${eng-engD}`,`Last activity ${Math.round(days)} days ago (engagement halves every 14 days)`]);
 let s=Math.min(100,fit+engD);let auto=s>=60?'hot':s>=35?'warm':'cold';
 if(CLOSED.includes(l.stage)){auto='cold';R.push(['','Closed stage: not in the follow-up queue'])}
 const p=l.priority_override||auto;if(l.priority_override)R.push(['',`Set by hand to ${p}${l.override_note?': '+l.override_note:''}`]);
 return{score:s,fit,engagement:engD,auto,priority:p,reasons:R};}
const withScore=l=>({...l,...score(l)});
async function suppressed(a,email,phone){return(await q(`select 1 from marketing_suppression where coalesce(client_id,0)=coalesce($1::int,0) and ((email is not null and email=$2) or (phone is not null and phone=$3)) limit 1`,[a,email,phone])).length>0}
async function log(id,a,kind,body,meta,uid){await q('insert into lead_activities(lead_id,client_id,kind,body,meta,user_id) values($1,$2,$3,$4,$5,$6)',[id,a,kind,body?String(body).slice(0,4000):null,meta?JSON.stringify(meta):null,uid||null])}
const FIELDS={name:v=>clean(v,160),company:v=>clean(v,160),email:normE,phone:normP,website:v=>clean(v,200),business_type:v=>clean(v,80),location:v=>clean(v,120),country:v=>clean(v,2)?.toUpperCase()||null,
 source:v=>clean(v,60)||'manual',form_type:v=>{const x=clean(v,30);if(x&&!(x in FORM_W))throw err('Unknown form type');return x},message:v=>clean(v,4000),
 utm_source:v=>clean(v,100),utm_medium:v=>clean(v,100),utm_campaign:v=>clean(v,100),utm_term:v=>clean(v,100),utm_content:v=>clean(v,100),landing_page:v=>clean(v,300),referrer:v=>clean(v,300),
 priority_override:v=>{if(!v)return null;if(!['hot','warm','cold'].includes(v))throw err('Priority: hot, warm or cold');return v},override_note:v=>clean(v,300),
 next_followup:v=>{if(!v)return null;if(!/^\d{4}-\d\d-\d\d$/.test(v))throw err('Follow-up date must be YYYY-MM-DD');return v},tags:v=>[...new Set((Array.isArray(v)?v:String(v||'').split(',')).map(t=>String(t).trim().slice(0,40)).filter(Boolean))].slice(0,20),
 lost_reason:v=>clean(v,300),owner_user_id:v=>v?+v:null};
const pick=b=>{const o={};for(const k of Object.keys(FIELDS))if(k in b)o[k]=FIELDS[k](b[k]);return o};
async function one(id,a){const[l]=await q(`select * from leads where id=$2 and ${A}`,[a,+id]);if(!l)throw err('Not found',404);return l}
// Webhook to Grid: lead summary only (no message body, no consent IP).
async function notifyGrid(l){const url=process.env.GRID_WEBHOOK_URL;if(!url)return;try{
 const a=String(process.env.GRID_WEBHOOK_AUTH||'').trim().replace(/^authorization\s*:\s*/i,'');const au=a?{Authorization:/^[A-Za-z][\w-]*\s+\S/.test(a)?a:'Bearer '+a}:{};const s=score(l);
 await fetch(url,{method:'POST',signal:AbortSignal.timeout(10e3),headers:{'Content-Type':'application/json','X-Grid-Webhook-Secret':process.env.GRID_WEBHOOK_SECRET||'',...au},
  body:JSON.stringify({type:'new_lead',conversationId:null,accountId:l.client_id??null,text:`New lead #${l.id}: ${l.name||l.email||l.phone}${l.company?' ('+l.company+')':''} via ${l.source}${l.form_type?'/'+l.form_type:''}, priority ${s.priority} (${s.score}). Open: https://app.planet-grid.com/#/crm?lead=${l.id}`,
   lead:{id:l.id,name:l.name,company:l.company,website:l.website,source:l.source,form_type:l.form_type,stage:l.stage,priority:s.priority,score:s.score,utm_campaign:l.utm_campaign,url:`https://app.planet-grid.com/#/crm?lead=${l.id}`}})});}catch(e){console.error('lead webhook',e.name)}}
// Create or merge (dedupe on email, then phone, inside the account; closed leads are re-opened only if not lost/unsubscribed).
export async function upsertLead(a,b,{uid,kind='form',ip}={}){const o=pick(b);if(!o.email&&!o.phone&&!o.name)throw err('Give at least a name, email or phone');
 let[l]=o.email?await q(`select * from leads where ${A} and lower(email)=$2 order by id limit 1`,[a,o.email]):[];if(!l&&o.phone)[l]=await q(`select * from leads where ${A} and phone=$2 order by id limit 1`,[a,o.phone]);
 const sup=await suppressed(a,o.email,o.phone);let created=false;
 if(!l){const cols=Object.keys(o);[l]=await q(`insert into leads(client_id,${cols.join(',')}) values($1,${cols.map((_,i)=>'$'+(i+2)).join(',')}) returning *`,[a,...cols.map(k=>o[k])]);created=true;}
 else{const fill={};for(const[k,v]of Object.entries(o))if(v!=null&&(l[k]==null||l[k]===''||['form_type','message'].includes(k)))fill[k]=v;
  if(o.form_type&&(FORM_W[o.form_type]||0)<(FORM_W[l.form_type]||0))delete fill.form_type;
  const ks=Object.keys(fill);if(ks.length)[l]=await q(`update leads set ${ks.map((k,i)=>k+'=$'+(i+2)).join(',')},updated_at=now(),last_activity_at=now() where id=$1 returning *`,[l.id,...ks.map(k=>fill[k])]);
  else[l]=await q('update leads set last_activity_at=now() where id=$1 returning *',[l.id]);}
 if(b.consent_marketing!=null&&kind==='form'){const yes=b.consent_marketing===true||b.consent_marketing==='true';
  if(yes&&!sup)[l]=await q('update leads set consent_marketing=true,consent_at=now(),consent_source=$2,consent_text=$3,consent_ip_hash=$4 where id=$1 returning *',[l.id,clean(b.consent_source,200)||`${o.source||'web'} form`,clean(b.consent_text,500),ip?ipH(ip):null]);
  else if(!yes&&l.consent_marketing==null)[l]=await q('update leads set consent_marketing=false,consent_at=now(),consent_source=$2 where id=$1 returning *',[l.id,`${o.source||'web'} form (not ticked)`]);}
 if(sup&&l.stage!=='unsubscribed')[l]=await q(`update leads set stage='unsubscribed',consent_marketing=false where id=$1 returning *`,[l.id]);
 await log(l.id,a,kind,created?(o.message||`New lead from ${o.source||'manual'}`):`Came back via ${o.source||'manual'}${o.form_type?' ('+o.form_type+')':''}${o.message?': '+o.message:''}`,{form_type:o.form_type,utm_campaign:o.utm_campaign,landing_page:o.landing_page},uid);
 if(sup)await log(l.id,a,'system','On the do-not-market list: kept as Unsubscribed. Only reply to what they asked; no marketing.');
 return{lead:l,created,suppressed:sup};}
export function leadRoutes(r,{W,need}){const R=need('leads','read'),E=need('leads','edit'),D=need('leads','delete');const acct=req=>req.user.client_id||null;
 r.get('/leads/meta',R,(req,res)=>res.json({stages:STAGES,forms:Object.keys(FORM_W),activities:ACT}));
 r.get('/leads',R,W(async(req,res)=>{const a=acct(req);const Q=req.query;const rows=await q(`select l.*,(select count(*)::int from lead_activities x where x.lead_id=l.id) acts from leads l where l.${A}
  and ($2::text is null or l.stage=$2) and ($3::text is null or l.source=$3) and ($4::text is null or l.utm_campaign=$4)
  and ($5::text is null or l.name ilike '%'||$5||'%' or l.company ilike '%'||$5||'%' or l.email ilike '%'||$5||'%' or l.phone like '%'||$5||'%' or l.website ilike '%'||$5||'%')
  and ($6::boolean is not true or (l.next_followup is not null and l.next_followup<=current_date)) order by l.last_activity_at desc limit 2000`,[a,Q.stage||null,Q.source||null,Q.campaign||null,Q.q||null,Q.due==='1']);
  let out=rows.map(withScore);if(Q.priority)out=out.filter(x=>x.priority===Q.priority);
  const facets={sources:[...new Set(rows.map(x=>x.source))].sort(),campaigns:[...new Set(rows.map(x=>x.utm_campaign).filter(Boolean))].sort()};res.json({rows:out,facets})}));
 r.get('/leads/:id',R,W(async(req,res)=>{const a=acct(req);const l=await one(req.params.id,a);
  res.json({...withScore(l),activities:await q(`select x.*,u.name author from lead_activities x left join users u on u.id=x.user_id where x.lead_id=$1 order by x.at desc`,[l.id]),
   client:l.converted_client_id?(await q('select id,ref,name from clients where id=$1',[l.converted_client_id]))[0]:null})}));
 r.post('/leads',E,W(async(req,res)=>{const a=acct(req);const out=await upsertLead(a,{source:'manual',...req.body},{uid:req.user.id,kind:'system'});res.json({...withScore(out.lead),created:out.created,suppressed:out.suppressed})}));
 r.put('/leads/:id',E,W(async(req,res)=>{const a=acct(req);const l=await one(req.params.id,a);const o=pick(req.body||{});delete o.source;const ks=Object.keys(o);if(!ks.length)return res.json(withScore(l));
  const[n]=await q(`update leads set ${ks.map((k,i)=>k+'=$'+(i+2)).join(',')},updated_at=now() where id=$1 returning *`,[l.id,...ks.map(k=>o[k])]);
  if('priority_override' in o&&o.priority_override!==l.priority_override)await log(l.id,a,'system',o.priority_override?`Priority set by hand to ${o.priority_override}`:'Priority back to automatic',null,req.user.id);
  if('next_followup' in o&&o.next_followup!==(l.next_followup&&l.next_followup.toISOString?.().slice(0,10)))await log(l.id,a,'system',o.next_followup?`Next follow-up ${o.next_followup}`:'Follow-up cleared',null,req.user.id);
  res.json(withScore(n))}));
 r.post('/leads/:id/stage',E,W(async(req,res)=>{const a=acct(req);const l=await one(req.params.id,a);const b=req.body||{};const st=b.stage;if(!SK.includes(st))throw err('Unknown stage');
  if(l.stage==='unsubscribed'&&st!=='unsubscribed'&&!['won','client'].includes(st))throw err('This person unsubscribed. They stay off marketing; you can only move them to Won/Current client if they buy.');
  if(st==='lost'&&!clean(b.reason))throw err('Give a reason, e.g. "Too expensive" or "Went with Wix"');
  let cid=l.converted_client_id;
  if(['won','client'].includes(st)){if(b.client_id){if(a)throw err('Linking to a billing client is only for Planet Grid staff');const[c]=await q('select id from clients where id=$1',[+b.client_id]);if(!c)throw err('Client not found');cid=c.id;}
   else if(b.create_client){if(a)throw err('Only Planet Grid staff can create a client account');if(!can_(req,'clients','edit'))throw err('You need permission to add clients',403);
    const n=(await q(`select coalesce(max(substring(ref from '^PG(\\d+)$')::int),0)+1 n from clients`))[0].n;
    const[c]=await q('insert into clients(ref,name,contact,email,cell) values($1,$2,$3,$4,$5) returning id,ref',['PG'+String(n).padStart(3,'0'),l.company||l.name||l.email,l.name,l.email,l.phone]);cid=c.id;await log(l.id,a,'system',`Client account ${c.ref} created (no contract or invoice yet)`,null,req.user.id);}}
  if(st==='unsubscribed'){if(l.email||l.phone)await suppress({client_id:a,email:l.email,phone:l.phone,source:clean(b.reason)||'Lead marked unsubscribed in CRM',user_id:req.user.id}).catch(e=>{if(e.status!==400)throw e});}
  const[n]=await q(`update leads set stage=$2,lost_reason=case when $2='lost' then $3 else lost_reason end,converted_client_id=$4,consent_marketing=case when $2='unsubscribed' then false else consent_marketing end,next_followup=case when $2 in('lost','unsubscribed') then null else next_followup end,updated_at=now(),last_activity_at=now() where id=$1 returning *`,[l.id,st,clean(b.reason,300),cid]);
  await log(l.id,a,'stage',`${STAGES.find(s=>s[0]===l.stage)?.[1]} → ${STAGES.find(s=>s[0]===st)[1]}${b.reason?': '+clean(b.reason,300):''}`,{from:l.stage,to:st},req.user.id);res.json(withScore(n))}));
 r.post('/leads/:id/activities',E,W(async(req,res)=>{const a=acct(req);const l=await one(req.params.id,a);const b=req.body||{};if(!ACT.includes(b.kind)||['stage','system','form'].includes(b.kind))throw err('Pick note, call, email, WhatsApp, meeting, reply or visit');
  const body=clean(b.body,4000);if(!body&&!['reply','visit'].includes(b.kind))throw err('What happened?');await log(l.id,a,b.kind,body,null,req.user.id);
  const[n]=await q(`update leads set replies=replies+$2,visits=visits+$3,last_activity_at=now(),stage=case when $2>0 and stage in('cold','contacted') then 'engaged' when $4 and stage='cold' then 'contacted' else stage end where id=$1 returning *`,[l.id,b.kind==='reply'?1:0,b.kind==='visit'?1:0,['call','email','whatsapp','meeting'].includes(b.kind)]);
  if(n.stage!==l.stage)await log(l.id,a,'stage',`${STAGES.find(s=>s[0]===l.stage)[1]} → ${STAGES.find(s=>s[0]===n.stage)[1]} (automatic)`,{from:l.stage,to:n.stage});res.json(withScore(n))}));
 r.delete('/leads/:id',D,W(async(req,res)=>{const a=acct(req);const l=await one(req.params.id,a);await q('delete from leads where id=$1',[l.id]);await q(`insert into crm_deletions(client_id,kind,record_id,user_id,reason) values($1,'lead',$2,$3,$4)`,[a,l.id,req.user.id,clean(req.body?.reason)]);res.json({ok:1})}));
 r.get('/leads.csv',D,W(async(req,res)=>{const a=acct(req);const rows=(await q(`select * from leads where ${A} order by id`,[a])).map(withScore);const c=v=>`"${String(v??'').replace(/"/g,'""')}"`;const K=['id','name','company','email','phone','website','business_type','location','source','form_type','utm_source','utm_medium','utm_campaign','stage','lost_reason','priority','score','next_followup','consent_marketing','consent_at','created_at','last_activity_at'];
  res.type('text/csv').set('Content-Disposition','attachment; filename=leads.csv').send([K.join(','),...rows.map(x=>K.map(k=>c(x[k]instanceof Date?x[k].toISOString():x[k])).join(','))].join('\n'))}));}
let can_=()=>false;export const setCan=f=>{can_=(req,t,l)=>f(req.user,t,l)};
// ---- public intake (planet-grid.com funnel + newsletter). No cookies. Leads go to Planet Grid's own CRM (account null).
const ORIG=new Set(['https://planet-grid.com','https://www.planet-grid.com','https://app.planet-grid.com',...(process.env.EXTRA_LEAD_ORIGINS||'').split(',').filter(Boolean)]);
export function publicLeadRoutes(r,{W}){
 const cors=(req,res,next)=>{const o=req.get('origin');if(o&&ORIG.has(o))res.set({'Access-Control-Allow-Origin':o,'Vary':'Origin','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'});
  if(req.method==='OPTIONS')return res.sendStatus(o&&ORIG.has(o)?204:403);if(o&&!ORIG.has(o))return res.status(403).json({error:'Not allowed from this site'});next()};
 const lim=rateLimit({windowMs:15*60e3,limit:8,standardHeaders:true,message:{error:'Too many tries. Please wait a few minutes or email us.'}});
 const day=rateLimit({windowMs:24*3600e3,limit:40,standardHeaders:true,message:{error:'Too many tries today.'}});
 r.options('/public/leads',cors);
 r.post('/public/leads',cors,lim,day,W(async(req,res)=>{const b=req.body||{};const ok=()=>res.json({ok:true,message:'Thanks! We will be in touch soon.'});
  // Spam checks: honeypot, too-fast submit, link stuffing, junk in name.
  if(b.hp||b.website_confirm||b.fax_number)return ok();
  const ms=+b.elapsed_ms;if(Number.isFinite(ms)&&ms>0&&ms<2500)return ok();
  const msg=String(b.message||'');if((msg.match(/https?:\/\//g)||[]).length>3||/<a\s|\[url=/i.test(msg))return ok();
  if(/https?:\/\/|www\./i.test(String(b.name||'')))return ok();
  const form=b.form_type||(b.source==='newsletter'?'newsletter':'contact');if(!(form in FORM_W)||['manual','import'].includes(form))throw err('Unknown form');
  if(!b.email&&!b.phone)throw err('Please give an email or phone number');
  if(b.consent_privacy!==true&&b.consent_privacy!=='true')throw err('Please accept the privacy policy so we may store your details');
  const src=clean(b.source,60)||(form==='newsletter'?'newsletter':'website');
  const out=await upsertLead(null,{name:b.name,company:b.company,email:b.email,phone:b.phone,website:b.website,business_type:b.business_type,location:b.location,country:b.country,source:src,form_type:form,message:msg,
   utm_source:b.utm_source,utm_medium:b.utm_medium,utm_campaign:b.utm_campaign,utm_term:b.utm_term,utm_content:b.utm_content,landing_page:b.landing_page,referrer:b.referrer,
   consent_marketing:form==='newsletter'?true:b.consent_marketing,consent_source:`${src} ${form} form`,consent_text:b.consent_text},{kind:'form',ip:req.ip});
  await log(out.lead.id,null,'system',`Privacy policy accepted on ${src} ${form} form`,{privacy_version:clean(b.privacy_version,40)});
  if(out.created)notifyGrid(out.lead);ok()}));}
