// Public signup, multi-domain client accounts, dual membership (staff + own client account).
import bcrypt from 'bcryptjs';import rateLimit from 'express-rate-limit';import {q,pool} from './db.js';
export const normDomain=d=>String(d||'').trim().toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/[\/?#].*$/,'');
const DOM=/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const EMAIL=/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
export function checkSignup(b,{google}={}){
 const name=String(b.name||'').trim().slice(0,120),company=String(b.company||'').trim().slice(0,120),domain=normDomain(b.domain),phone=String(b.phone||'').trim().slice(0,40);
 const email=String(b.email||'').trim().toLowerCase();
 if(!name)throw err('Tell us your name');
 if(!google&&!EMAIL.test(email))throw err('Enter a valid email');
 if(!google&&String(b.password||'').length<10)throw err('Use a password of at least 10 characters');
 if(!company&&!domain)throw err('Add your company name or your website domain');
 if(domain&&!DOM.test(domain))throw err('That domain does not look right (e.g. mybusiness.co.za)');
 if(phone&&!/^[+0-9 ()-]{6,40}$/.test(phone))throw err('That phone number does not look right');
 return{name,company,domain,phone,email,password:b.password?String(b.password):null};}
// Creates (or claims a pre-invited) login. Returns user id.
export async function createAccount(d,{pwHash=null,googleSub=null}={}){
 const[ex]=await q(`select * from users where lower(email)=$1 or lower(google_email)=$1 order by (lower(email)=$1) desc limit 1`,[d.email]);
 if(ex){if(!(ex.invited&&!ex.pw_hash&&!ex.google_sub&&ex.active))throw err('That email already has an account. Log in instead.',409);
  await q(`update users set pw_hash=coalesce($2,pw_hash),google_sub=coalesce($3,google_sub),google_email=case when $3::text is not null then coalesce(google_email,$4) else google_email end,name=coalesce(nullif(name,''),$5),phone=coalesce(phone,nullif($6,'')),invited=false where id=$1`,[ex.id,pwHash,googleSub,d.email,d.name,d.phone]);
  const cid=ex.own_client_id||ex.client_id;if(cid&&d.domain)await q(`insert into domains(client_id,domain) values($1,$2) on conflict do nothing`,[cid,d.domain]);
  return ex.id;}
 const c=await pool.connect();const cq=(s,p)=>c.query(s,p).then(r=>r.rows);
 try{await cq('begin');await cq('lock table clients in share row exclusive mode');
  if(d.domain&&(await cq('select 1 from domains where domain=$1',[d.domain])).length)throw err('That domain is already on an account. Log in, or contact us.',409);
  const n=(await cq(`select coalesce(max(substring(ref from '^PG(\\d+)$')::int),0)+1 n from clients`))[0].n;
  const[cl]=await cq(`insert into clients(ref,name,contact,email,cell,signup) values($1,$2,$3,$4,$5,true) returning id`,['PG'+String(n).padStart(3,'0'),d.company||d.domain,d.name,d.email,d.phone||null]);
  if(d.domain)await cq('insert into domains(client_id,domain,status) values($1,$2,$3)',[cl.id,d.domain,'pending']);
  const[o]=await cq(`insert into orgs(name,kind,client_id) values($1,'client',$2) returning id`,[d.company||d.domain,cl.id]);
  const[u]=await cq(`insert into users(email,pw_hash,org_id,client_id,role,name,phone,google_sub,google_email) values($1,$2,$3,$4,'client',$5,$6,$7,$8) returning id`,[d.email,pwHash,o.id,cl.id,d.name,d.phone||null,googleSub,googleSub?d.email:null]);
  await cq('commit');return u.id;}
 catch(e){await cq('rollback');if(e.code==='23505')throw err('That email or domain already has an account.',409);throw e}finally{c.release()}}
export function signupRoutes(r,{W,newSession}){
 r.post('/signup',rateLimit({windowMs:60*60e3,limit:8,standardHeaders:true}),W(async(req,res)=>{const d=checkSignup(req.body||{});
  const id=await createAccount(d,{pwHash:await bcrypt.hash(d.password,12)});await newSession(res,id);res.json({ok:1})}));}
// Memberships: a staff user may also own a client account (own_client_id). Session mode picks the view.
export function memberships(u){if(!u.own_client_id)return null;return[{mode:'staff',label:'Planet Grid',sub:'Team'},{mode:'client',label:u.own_client_name||'My account',sub:'My business'}];}
export function domainRoutes(r,{need,W,own,can}){
 r.post('/me/mode',W(async(req,res)=>{const m=req.body?.mode==='client'?'client':'staff';if(!req.user.own_client_id)throw err('Only one account on this login');
  await q('update sessions set mode=$2 where token_hash=$1',[req.tokenHash,m]);res.json({mode:m})}));
 r.get('/clients/:id/domains',need('domains','read'),W(async(req,res)=>{own(req,req.params.id);res.json(await q(`select d.*,(select coalesce(sum(case when k.freq='monthly' then k.amount else 0 end),0)::float from contracts k where k.domain_id=d.id and (k.end_date is null or k.end_date>=current_date)) monthly from domains d where client_id=$1 order by d.id`,[req.params.id]))}));
 const staff=(req,res,next)=>req.user.client_id?res.status(403).json({error:'Not available in the client portal'}):next();
 r.post('/domains',staff,need('domains','edit'),W(async(req,res)=>{const dm=normDomain(req.body?.domain);if(!DOM.test(dm))throw err('That domain does not look right');
  if(!(await q('select 1 from clients where id=$1',[req.body.client_id])).length)throw err('Unknown client');
  res.json((await q('insert into domains(client_id,domain,status,notes) values($1,$2,$3,$4) returning *',[req.body.client_id,dm,['active','pending','placeholder','inactive'].includes(req.body.status)?req.body.status:'active',req.body.notes||null]).catch(e=>{if(e.code==='23505')throw err('That domain is already on an account');throw e}))[0])}));
 r.put('/domains/:id',staff,need('domains','edit'),W(async(req,res)=>{const b=req.body||{};const[d]=await q('select * from domains where id=$1',[req.params.id]);if(!d)throw err('No such domain',404);
  const dm=b.domain?normDomain(b.domain):d.domain;if(!DOM.test(dm))throw err('That domain does not look right');
  res.json((await q('update domains set domain=$2,status=$3,notes=$4 where id=$1 returning *',[d.id,dm,['active','pending','placeholder','inactive'].includes(b.status)?b.status:d.status,b.notes??d.notes]))[0])}));
 r.delete('/domains/:id',staff,need('domains','delete'),W(async(req,res)=>{if((await q('select 1 from contracts where domain_id=$1',[req.params.id])).length)throw err('This domain has contracts. End them instead.');
  await q('delete from domains where id=$1',[req.params.id]);res.json({ok:1})}));}
