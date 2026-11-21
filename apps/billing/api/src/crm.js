// Basic CRM. Strictly per account: acct = the user's client_id (portal) or null (Planet Grid's own CRM).
// Every query filters on client_id IS NOT DISTINCT FROM acct. Record type 'crm': read / edit / delete (delete also = export).
import {q} from './db.js';
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
const A='client_id is not distinct from $1';
export async function crmInit(){await q(`
 alter table clients add column if not exists crm_enabled boolean not null default true;
 insert into settings values('crm_enabled','true') on conflict do nothing;
 create table if not exists crm_companies(id serial primary key,client_id int references clients,name text not null,type text not null default 'Customer' check(type in('Customer','Supplier','Both')),website text,vat_no text,reg_no text,address text,tags text[] not null default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
 create table if not exists crm_contacts(id serial primary key,client_id int references clients,company_id int references crm_companies on delete set null,name text not null,role text,mobile text,email text,preferred text check(preferred in('WhatsApp','Call','Email')),consent boolean,consent_date date,consent_how text,dnc boolean not null default false,created_at timestamptz default now(),updated_at timestamptz default now());
 create table if not exists crm_notes(id serial primary key,client_id int references clients,company_id int references crm_companies on delete cascade,contact_id int references crm_contacts on delete cascade,body text not null,user_id int,created_at timestamptz default now());
 create table if not exists crm_followups(id serial primary key,client_id int references clients,company_id int references crm_companies on delete cascade,contact_id int references crm_contacts on delete cascade,title text not null,due date not null,done boolean not null default false,done_at timestamptz,created_at timestamptz default now());
 create table if not exists crm_stages(id serial primary key,client_id int references clients,kind text not null check(kind in('deal','order')),name text not null,pos int not null default 0);
 create table if not exists crm_deals(id serial primary key,client_id int references clients,kind text not null check(kind in('deal','order')),company_id int references crm_companies on delete set null,title text not null,amount numeric(12,2),stage_id int references crm_stages on delete set null,created_at timestamptz default now(),updated_at timestamptz default now());
 create table if not exists crm_company_files(company_id int not null references crm_companies on delete cascade,file_id text not null references files on delete cascade,client_id int,primary key(company_id,file_id));
 create table if not exists crm_deletions(id serial primary key,client_id int,kind text not null,record_id int not null,user_id int,reason text,deleted_at timestamptz default now());
 alter table crm_companies add column if not exists phone text; alter table crm_companies add column if not exists fax text; alter table crm_companies add column if not exists email text; alter table crm_companies add column if not exists description text;
 create index if not exists crm_contacts_acct on crm_contacts(client_id);create index if not exists crm_companies_acct on crm_companies(client_id);create index if not exists crm_fu_acct on crm_followups(client_id,done,due);`);}
const acct=req=>req.user.client_id||null;
const clean=(v,n=200)=>v==null||v===''?null:String(v).trim().slice(0,n)||null;
export const normPhone=p=>{let d=String(p||'').replace(/\D/g,'');if(!d)return null;if(d.startsWith('00'))d=d.slice(2);if(d.length===10&&d[0]==='0')d='27'+d.slice(1);return d};
const normEmail=e=>clean(e,200)?.toLowerCase()||null;
const FIELDS={
 companies:{name:v=>{const x=clean(v,160);if(!x)throw err('Company name is required');return x},type:v=>{if(!['Customer','Supplier','Both'].includes(v))throw err('Type must be Customer, Supplier or Both');return v},
  website:v=>clean(v,200),phone:v=>clean(v,40),fax:v=>clean(v,40),email:v=>{const e=normEmail(v);if(e&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))throw err('That email does not look right');return e},description:v=>clean(v,2000),vat_no:v=>clean(v,40),reg_no:v=>clean(v,40),address:v=>clean(v,500),tags:v=>[...new Set((Array.isArray(v)?v:String(v||'').split(',')).map(t=>String(t).trim().slice(0,40)).filter(Boolean))].slice(0,20)},
 contacts:{name:v=>{const x=clean(v,160);if(!x)throw err('Contact name is required');return x},role:v=>clean(v,80),mobile:v=>clean(v,40),email:v=>{const e=normEmail(v);if(e&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))throw err('That email does not look right');return e},
  company_id:v=>v?+v:null,preferred:v=>{if(!v)return null;if(!['WhatsApp','Call','Email'].includes(v))throw err('Preferred channel: WhatsApp, Call or Email');return v},
  consent:v=>v==null||v===''?null:v===true||v==='true'||v==='yes',consent_date:v=>v?(/^\d{4}-\d\d-\d\d$/.test(v)?v:(()=>{throw err('Consent date must be YYYY-MM-DD')})()):null,consent_how:v=>clean(v,200),dnc:v=>!!v&&v!=='false'},
 followups:{title:v=>{const x=clean(v,200);if(!x)throw err('What needs doing?');return x},due:v=>{if(!/^\d{4}-\d\d-\d\d$/.test(v||''))throw err('Pick a due date');return v},done:v=>!!v,company_id:v=>v?+v:null,contact_id:v=>v?+v:null},
 deals:{title:v=>{const x=clean(v,200);if(!x)throw err('Give it a name');return x},kind:v=>{if(!['deal','order'].includes(v))throw err('kind');return v},amount:v=>v===''||v==null?null:+v,stage_id:v=>v?+v:null,company_id:v=>v?+v:null}};
const TBL={companies:'crm_companies',contacts:'crm_contacts',followups:'crm_followups',deals:'crm_deals'};
// Ensure linked ids belong to the same account.
async function own(tbl,id,a){if(id==null)return;if(!(await q(`select 1 from ${tbl} where id=$2 and ${A}`,[a,id])).length)throw err('That record is not in your account',404);}
async function checkLinks(o,a){await own('crm_companies',o.company_id,a);await own('crm_contacts',o.contact_id,a);await own('crm_stages',o.stage_id,a);}
function pick(type,b,partial){const F=FIELDS[type],o={};for(const k of Object.keys(F))if(k in b)o[k]=F[k](b[k]);else if(!partial&&['name','title','due','kind','type'].includes(k))o[k]=F[k](k==='type'?'Customer':undefined);return o}
async function stages(a){let s=await q(`select * from crm_stages where ${A} order by kind,pos,id`,[a]);
 if(!s.length){const D=[['deal',['Lead','Quoted','Won','Lost']],['order',['Ordered','Received']]];for(const[k,ns]of D)for(const[i,n]of ns.entries())await q('insert into crm_stages(client_id,kind,name,pos) values($1,$2,$3,$4)',[a,k,n,i]);s=await q(`select * from crm_stages where ${A} order by kind,pos,id`,[a]);}return s;}
const csvEsc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
export function crmRoutes(r,{W,need}){
 const on=W(async(req,res,next)=>{const a=acct(req);const en=a?(await q('select crm_enabled from clients where id=$1',[a]))[0]?.crm_enabled:(await q(`select value from settings where key='crm_enabled'`))[0]?.value!=='false';
  if(!en)return res.status(403).json({error:'CRM is not enabled for this account'});req.acct=a;next()});
 const R=[on,need('crm','read')],E=[on,need('crm','edit')],D=[on,need('crm','delete')];
 r.get('/crm/summary',...R,W(async(req,res)=>{const a=req.acct;const n=async t=>(await q(`select count(*)::int n from ${t} where ${A}`,[a]))[0].n;
  res.json({companies:await n('crm_companies'),contacts:await n('crm_contacts'),stages:await stages(a),
   due:await q(`select f.*,c.name company,p.name contact from crm_followups f left join crm_companies c on c.id=f.company_id left join crm_contacts p on p.id=f.contact_id where f.${A} and not f.done and f.due<=current_date order by f.due,f.id`,[a])})}));
 r.get('/crm/companies',...R,W(async(req,res)=>res.json(await q(`select c.*,(select count(*)::int from crm_contacts p where p.company_id=c.id) contacts,(select min(due) from crm_followups f where f.company_id=c.id and not done)::text next_due from crm_companies c where c.${A} and ($2::text is null or type=$2 or type='Both') and ($3::text is null or c.name ilike '%'||$3||'%' or $3=any(tags)) order by lower(c.name)`,[req.acct,req.query.type||null,req.query.q||null]))));
 r.get('/crm/contacts',...R,W(async(req,res)=>res.json(await q(`select p.*,c.name company from crm_contacts p left join crm_companies c on c.id=p.company_id where p.${A} and ($2::text is null or p.name ilike '%'||$2||'%' or p.email ilike '%'||$2||'%' or p.mobile like '%'||$2||'%') order by lower(p.name)`,[req.acct,req.query.q||null]))));
 r.get('/crm/companies/:id',...R,W(async(req,res)=>{const a=req.acct,id=+req.params.id;const[c]=await q(`select * from crm_companies where id=$2 and ${A}`,[a,id]);if(!c)throw err('Not found',404);
  res.json({...c,contacts:await q(`select * from crm_contacts where company_id=$2 and ${A} order by name`,[a,id]),
   notes:await q(`select n.*,u.name author,p.name contact from crm_notes n left join users u on u.id=n.user_id left join crm_contacts p on p.id=n.contact_id where (n.company_id=$2 or n.contact_id in(select id from crm_contacts where company_id=$2)) and n.${A} order by n.created_at desc`,[a,id]),
   followups:await q(`select * from crm_followups where company_id=$2 and ${A} order by done,due`,[a,id]),deals:await q(`select d.*,s.name stage from crm_deals d left join crm_stages s on s.id=d.stage_id where d.company_id=$2 and d.${A} order by d.created_at desc`,[a,id]),
   files:await q(`select f.id,f.name,f.mime,f.size,f.category,'/api/files/'||f.id url,f.mime in('image/png','image/jpeg','image/gif','image/webp') image from crm_company_files cf join files f on f.id=cf.file_id where cf.company_id=$2 and cf.${A} order by f.created_at desc`,[a,id])})}));
 r.get('/crm/contacts/:id',...R,W(async(req,res)=>{const a=req.acct,id=+req.params.id;const[p]=await q(`select p.*,c.name company from crm_contacts p left join crm_companies c on c.id=p.company_id where p.id=$2 and p.${A}`,[a,id]);if(!p)throw err('Not found',404);
  res.json({...p,wa:normPhone(p.mobile),notes:await q(`select n.*,u.name author from crm_notes n left join users u on u.id=n.user_id where n.contact_id=$2 and n.${A} order by created_at desc`,[a,id]),followups:await q(`select * from crm_followups where contact_id=$2 and ${A} order by done,due`,[a,id])})}));
 for(const t of Object.keys(TBL)){
  r.post('/crm/'+t,...E,W(async(req,res)=>{const o=pick(t,req.body||{});await checkLinks(o,req.acct);const ks=Object.keys(o);
   res.json((await q(`insert into ${TBL[t]}(client_id,${ks.join(',')}) values($1,${ks.map((_,i)=>'$'+(i+2)).join(',')}) returning *`,[req.acct,...ks.map(k=>o[k])]))[0])}));
  r.put('/crm/'+t+'/:id',...E,W(async(req,res)=>{const o=pick(t,req.body||{},true);await checkLinks(o,req.acct);if(t==='followups'&&'done' in o)o.done_at=o.done?new Date():null;const ks=Object.keys(o);if(!ks.length)throw err('Nothing to change');
   const[x]=await q(`update ${TBL[t]} set ${ks.map((k,i)=>`${k}=$${i+3}`).join(',')}${t==='followups'?'':',updated_at=now()'} where id=$2 and ${A} returning *`,[req.acct,+req.params.id,...ks.map(k=>o[k])]);if(!x)throw err('Not found',404);res.json(x)}));
  r.delete('/crm/'+t+'/:id',...D,W(async(req,res)=>{const[x]=await q(`delete from ${TBL[t]} where id=$2 and ${A} returning id`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);
   if(t==='contacts'||t==='companies')await q('insert into crm_deletions(client_id,kind,record_id,user_id,reason) values($1,$2,$3,$4,$5)',[req.acct,t,x.id,req.user.id,clean(req.query.reason,200)]);res.json({ok:1})}));}
 r.post('/crm/notes',...E,W(async(req,res)=>{const b=req.body||{};const body=clean(b.body,5000);if(!body)throw err('Write a note');const o={company_id:b.company_id?+b.company_id:null,contact_id:b.contact_id?+b.contact_id:null};if(!o.company_id&&!o.contact_id)throw err('Note needs a company or contact');await checkLinks(o,req.acct);
  res.json((await q('insert into crm_notes(client_id,company_id,contact_id,body,user_id) values($1,$2,$3,$4,$5) returning *',[req.acct,o.company_id,o.contact_id,body,req.user.id]))[0])}));
 r.delete('/crm/notes/:id',...E,W(async(req,res)=>{await q(`delete from crm_notes where id=$2 and ${A}`,[req.acct,+req.params.id]);res.json({ok:1})}));
 r.get('/crm/followups',...R,W(async(req,res)=>res.json(await q(`select f.*,f.due::text due,c.name company,p.name contact from crm_followups f left join crm_companies c on c.id=f.company_id left join crm_contacts p on p.id=f.contact_id where f.${A} and ($2::text<>'open' or not f.done) order by f.done,f.due`,[req.acct,req.query.status||'open']))));
 r.get('/crm/deals',...R,W(async(req,res)=>res.json(await q(`select d.*,d.amount::float amount,c.name company from crm_deals d left join crm_companies c on c.id=d.company_id where d.${A} order by d.updated_at desc`,[req.acct]))));
 r.get('/crm/stages',...R,W(async(req,res)=>res.json(await stages(req.acct))));
 // PUT /crm/stages {kind, stages:[{id?,name}]} — rename/reorder/add; removed ones are deleted (their deals keep no stage).
 r.put('/crm/stages',...E,W(async(req,res)=>{const a=req.acct,k=req.body?.kind;if(!['deal','order'].includes(k))throw err('kind');const list=(req.body.stages||[]).map(s=>({id:s.id?+s.id:null,name:clean(s.name,40)})).filter(s=>s.name).slice(0,12);if(!list.length)throw err('Keep at least one stage');
  await stages(a);const keep=[];for(const[i,s]of list.entries()){if(s.id){const[x]=await q(`update crm_stages set name=$3,pos=$4 where id=$2 and kind=$5 and ${A} returning id`,[a,s.id,s.name,i,k]);if(x)keep.push(x.id)}else keep.push((await q('insert into crm_stages(client_id,kind,name,pos) values($1,$2,$3,$4) returning id',[a,k,s.name,i]))[0].id)}
  await q(`delete from crm_stages where kind=$2 and ${A} and not(id=any($3))`,[a,k,keep]);res.json(await stages(a))}));
 r.post('/crm/companies/:id/files',...E,W(async(req,res)=>{const a=req.acct;await own('crm_companies',+req.params.id,a);const fid=String(req.body?.file_id||'');
  if(!(await q(`select 1 from files where id=$2 and in_library and ${A}`,[a,fid])).length)throw err('That file is not in your Files library',404);
  await q('insert into crm_company_files(company_id,file_id,client_id) values($1,$2,$3) on conflict do nothing',[+req.params.id,fid,a]);res.json({ok:1})}));
 r.delete('/crm/companies/:id/files/:fid',...E,W(async(req,res)=>{await q(`delete from crm_company_files where company_id=$2 and file_id=$3 and ${A}`,[req.acct,+req.params.id,req.params.fid]);res.json({ok:1})}));
 r.get('/crm/library',...R,W(async(req,res)=>res.json(await q(`select id,name,mime,category from files where in_library and ${A} order by created_at desc limit 500`,[req.acct]))));
 // Export (owner-level = delete permission).
 r.get('/crm/export.csv',...D,W(async(req,res)=>{const t=req.query.type==='companies'?'companies':'contacts';const a=req.acct;
  const rows=t==='companies'?await q(`select name,type,website,phone,fax,email,description,vat_no,reg_no,address,array_to_string(tags,'; ') tags,created_at::date::text created from crm_companies where ${A} order by name`,[a])
   :await q(`select p.name,p.role,p.mobile,p.email,c.name company,p.preferred,case when p.consent then 'yes' when p.consent=false then 'no' end consent,p.consent_date::text consent_date,p.consent_how,case when p.dnc then 'yes' else 'no' end do_not_contact,p.created_at::date::text created from crm_contacts p left join crm_companies c on c.id=p.company_id where p.${A} order by p.name`,[a]);
  const cols=rows[0]?Object.keys(rows[0]):t==='companies'?['name','type','website','phone','fax','email','description','vat_no','reg_no','address','tags','created']:['name','role','mobile','email','company','preferred','consent','consent_date','consent_how','do_not_contact','created'];
  res.type('text/csv').set('Content-Disposition',`attachment; filename="crm-${t}-${new Date().toISOString().slice(0,10)}.csv"`).send([cols.map(csvEsc).join(','),...rows.map(r=>cols.map(c=>csvEsc(r[c])).join(','))].join('\r\n'))}));
 // Import: client parses CSV + matches columns; sends mapped rows. Dedupe contacts on email/phone, companies on name/website.
 r.post('/crm/import',...E,W(async(req,res)=>{const a=req.acct;const t=req.body?.type==='companies'?'companies':'contacts';const rows=(req.body?.rows||[]).slice(0,5000);const dry=!!req.body?.dry;
  const out={created:0,duplicates:0,errors:[]};const seenE=new Set(),seenP=new Set(),seenN=new Set();
  const ex=t==='contacts'?await q(`select lower(email) e,mobile from crm_contacts where ${A}`,[a]):await q(`select lower(name) n,lower(website) w from crm_companies where ${A}`,[a]);
  ex.forEach(x=>{if(x.e)seenE.add(x.e);if(x.mobile)seenP.add(normPhone(x.mobile));if(x.n)seenN.add(x.n);if(x.w)seenE.add(x.w)});
  const comp={};if(t==='contacts')(await q(`select id,lower(name) n from crm_companies where ${A}`,[a])).forEach(c=>comp[c.n]=c.id);
  for(const[i,raw]of rows.entries()){try{const b={...raw};let companyName=null;if(t==='contacts'){companyName=clean(b.company,160);delete b.company;}
    if(t==='companies'&&b.type){const ty=String(b.type).toLowerCase();b.type=ty.startsWith('s')?'Supplier':ty.startsWith('b')?'Both':'Customer'}
    if(t==='contacts'&&b.preferred){const p=String(b.preferred).toLowerCase();b.preferred=p.startsWith('w')?'WhatsApp':p.startsWith('c')||p.startsWith('p')?'Call':p.startsWith('e')?'Email':null}
    if(t==='contacts'&&'consent' in b)b.consent=/^(y|yes|true|1|ja)$/i.test(String(b.consent||''))?true:/^(n|no|false|0|nee)$/i.test(String(b.consent||''))?false:null;
    if(t==='contacts'&&'dnc' in b)b.dnc=/^(y|yes|true|1|ja)$/i.test(String(b.dnc||''));
    const o=pick(t,b);
    if(t==='contacts'){const e=o.email,p=normPhone(o.mobile);if((e&&seenE.has(e))||(p&&seenP.has(p))){out.duplicates++;continue}if(e)seenE.add(e);if(p)seenP.add(p);
     if(companyName){const k=companyName.toLowerCase();if(!comp[k]&&!dry)comp[k]=(await q(`insert into crm_companies(client_id,name) values($1,$2) returning id`,[a,companyName]))[0].id;o.company_id=comp[k]||null}}
    else{const n=o.name.toLowerCase(),w=o.website?.toLowerCase();if(seenN.has(n)||(w&&seenE.has(w))){out.duplicates++;continue}seenN.add(n);if(w)seenE.add(w)}
    if(!dry){const ks=Object.keys(o);await q(`insert into ${TBL[t]}(client_id,${ks.join(',')}) values($1,${ks.map((_,j)=>'$'+(j+2)).join(',')})`,[a,...ks.map(k=>o[k])]);}out.created++;
   }catch(e){if(out.errors.length<20)out.errors.push(`Row ${i+2}: ${e.message}`)}}
  res.json(out)}));}
