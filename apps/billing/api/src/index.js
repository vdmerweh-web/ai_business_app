import express from 'express';import cookieParser from 'cookie-parser';import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';import crypto from 'crypto';
import {pool,q,init,settings,balance,SIGN} from './db.js';import {mailInit,mailRoutes} from './mail.js';import {buildRun,finalise,statementData,ym,onceOff} from './billing.js';import {invoicePdf,statementPdf} from './pdf.js';import {effective,can,TYPES,LV,ROLES,PROTECTED_EMAIL} from './perms.js';import {authRoutes,userRoutes,newSession} from './users.js';import {crmInit,crmRoutes} from './crm.js';import {bizInit,bizRoutes,flags} from './biz.js';import {chatInit,botRoutes,chatRoutes} from './chat.js';import {accountRoutes,accountsInit} from './accounts.js';import {signupRoutes,domainRoutes,memberships} from './signup.js';import {headers,csrf,locked,failed,cleared} from './security.js';import {blogInit,blogRoutes,publicBlogRoutes,blogOn} from './blog.js';import {leadsInit,leadRoutes,publicLeadRoutes,setCan} from './leads.js';import {pushInit,pushRoutes} from './push.js';import {privacyInit,publicPrivacyRoutes,privacyRoutes} from './privacy.js';import {bobbyInit,bobbyRoutes,apiKeySet,getClient} from './bobby.js';import {isAppAdmin,agentsPublic,clientApiAllowed} from './staffcfg.js';import {promptLogInit,usageRoutes} from './promptLog.js';
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);app.use(headers);app.use(csrf);app.use(express.json({limit:'5mb'}));app.use(cookieParser());
const H=t=>crypto.createHash('sha256').update(t).digest('hex');
const W=f=>(req,res,next)=>f(req,res,next).catch(e=>{if(!e.status)console.error(e);res.status(e.status||400).json({error:e.message})});
const r=express.Router();
r.get('/health',(q_,res)=>res.json({ok:true,grokConfigured:apiKeySet()}));
r.post('/login',rateLimit({windowMs:15*60e3,limit:10,standardHeaders:true}),W(async(req,res)=>{
 const{email,password}=req.body||{};const[u]=await q('select * from users where lower(email)=lower($1) and active',[String(email||'')]);
 if(await locked(email))return res.status(429).json({error:'Too many wrong tries. Wait 15 minutes, or sign in with Google.'});
 if(!u||!u.pw_hash||!(await bcrypt.compare(String(password||''),u.pw_hash))){await failed(email,req.ip);return res.status(401).json({error:'Wrong email or password'});}
 await cleared(email);await newSession(res,u.id);res.json({email:u.email});}));
publicPrivacyRoutes(r,{W});publicLeadRoutes(r,{W});publicBlogRoutes(r,{W});r.use(['/auth','/signup'],rateLimit({windowMs:15*60e3,limit:60,standardHeaders:true}));authRoutes(r);signupRoutes(r,{W,newSession});botRoutes(r,{W});
r.use(W(async(req,res,next)=>{const t=req.cookies.pgsid;const[s]=t?await q('select u.*,s.mode session_mode,s.view_client_id,oc.name own_client_name from sessions s join users u on u.id=s.user_id left join clients oc on oc.id=u.own_client_id where token_hash=$1 and expires>now() and u.active',[H(t)]):[];
 if(!s)return res.status(401).json({error:'Not logged in'});req.tokenHash=H(t);s.mode='staff';
 // Dual membership: in 'client' mode a staff login acts purely as the portal user of its own client account.
 if(s.own_client_id&&!s.client_id&&s.session_mode==='client'){s.mode='client';s.staff_role=s.role;s.client_id=s.own_client_id;s.role='client';s.perms={};}// Platform owner "view as company": only a real owner staff login may act as a client account's owner. Re-checked every request.
 s.platform_owner=!s.client_id&&(s.role==='owner'||s.email.toLowerCase()===PROTECTED_EMAIL);
 if(s.view_client_id&&s.platform_owner){const[vc]=await q('select id,name,ref from clients where id=$1',[s.view_client_id]);if(vc){s.mode='client';s.viewing={id:vc.id,name:vc.name,ref:vc.ref};s.staff_role=s.role;s.client_id=vc.id;s.role='client';s.perms={};s.email_real=s.email;}}
 s.p=effective(s);if(s.viewing)s.p=effective({role:'client',client_id:s.client_id,perms:{}});delete s.pw_hash;req.user=s;next();}));
// need(type,level): server-side permission gate. own(req,cid): portal users only see their own client.
const need=(t,l)=>(req,res,next)=>can(req.user,t,l)?next():res.status(403).json({error:`No permission: ${t} (${l})`});
const needAny=(...a)=>(req,res,next)=>a.some(([t,l])=>can(req.user,t,l))?next():res.status(403).json({error:'No permission'});
const own=(req,cid)=>{if(req.user.client_id&&+cid!==req.user.client_id){const e=new Error('Not your account');e.status=403;throw e}};
const staff=(req,res,next)=>req.user.client_id?res.status(403).json({error:'Not available in the client portal'}):next();
r.post('/logout',W(async(req,res)=>{await q('delete from sessions where token_hash=$1',[H(req.cookies.pgsid)]);res.clearCookie('pgsid');res.json({ok:1})}));
r.get('/me',W(async(req,res)=>{const u=req.user;const crm=u.client_id?(await q('select crm_enabled from clients where id=$1',[u.client_id]))[0]?.crm_enabled!==false:(await q(`select value from settings where key='crm_enabled'`))[0]?.value!=='false';
 const c=u.client_id?await getClient(u.client_id):null;
 const siteUrl=c?(c.site_url||(c.domain?('https://'+c.domain):null)):null;
 res.json({crm,...await flags(u.client_id),blog:await blogOn(u.client_id),id:u.id,email:u.email,name:u.name,role:u.role,client_id:u.client_id,perms:u.p,has_password:true,mode:u.mode,memberships:memberships(u),viewing:u.viewing||null,platform_owner:!!u.platform_owner,isAdmin:isAppAdmin(u),adminAgents:isAppAdmin(u)?agentsPublic():[],agentName:(c&&c.agent_name)||'Bobby',siteUrl});}));
r.use((req,res,next)=>{if(isAppAdmin(req.user))return next();if(clientApiAllowed(req.path))return next();return res.status(403).json({error:'This part is only for the site admin'})});
r.use('/me/password',rateLimit({windowMs:15*60e3,limit:10,standardHeaders:true}));bobbyRoutes(r,{W});usageRoutes(r,{W});userRoutes(r,{need,W});accountRoutes(r,{W});domainRoutes(r,{need,W,own,can});chatRoutes(r,{W});crmRoutes(r,{W,need});privacyRoutes(r,{W,need});bizRoutes(r,{W,need});blogRoutes(r,{W,need});setCan(can);leadRoutes(r,{W,need});pushRoutes(r,{W});
r.get('/clients',needAny(['clients','read'],['statements','read']),W(async(req,res)=>res.json(await q(`select c.*,coalesce((select sum(${SIGN}) from entries e where e.client_id=c.id),0)::float balance,(select coalesce(sum(case when freq='monthly' then amount else 0 end),0)::float from contracts k where k.client_id=c.id and (end_date is null or end_date>=current_date)) monthly from clients c where ($1::int is null or c.id=$1) order by name`,[req.user.client_id||null]))));
r.post('/clients',staff,need('clients','edit'),W(async(req,res)=>{const b=req.body;res.json((await q('insert into clients(ref,name,contact,email,cell) values($1,$2,$3,$4,$5) returning *',[b.ref,b.name,b.contact,b.email,b.cell]))[0])}));
r.put('/clients/:id',staff,need('clients','edit'),W(async(req,res)=>{const b=req.body;const nc=can(req.user,'users','edit')&&typeof b.no_charge==='boolean'?b.no_charge:null;res.json((await q('update clients set ref=$2,name=$3,contact=$4,email=$5,cell=$6,active=$7,no_charge=coalesce($8,no_charge) where id=$1 returning *',[req.params.id,b.ref,b.name,b.contact,b.email,b.cell,b.active!==false,nc]))[0])}));
r.get('/clients/:id',needAny(['clients','read'],['statements','read']),W(async(req,res)=>{const id=req.params.id;own(req,id);const[c]=await q('select * from clients where id=$1',[id]);
 res.json({...c,balance:await balance(id),contracts:!can(req.user,'contracts','read')?[]:await q('select k.*,d.domain from contracts k left join domains d on d.id=k.domain_id where k.client_id=$1 order by k.id',[id]),domains:!can(req.user,'domains','read')?[]:await q('select * from domains where client_id=$1 order by id',[id]),
  entries:await q('select id,tdate::text,description,dt_account,kt_account,amount::float,invoice_no,kind from entries where client_id=$1 order by tdate,id',[id])})}));
r.post('/contracts',staff,need('contracts','edit'),W(async(req,res)=>{const b=req.body;if(!['monthly','yearly'].includes(b.freq))throw new Error('freq');const did=+b.domain_id||null;
 if(did&&!(await q('select 1 from domains where id=$1 and client_id=$2',[did,b.client_id])).length)throw new Error('That domain is not on this client');
 res.json((await q('insert into contracts(client_id,description,amount,freq,start_date,end_date,account,domain_id) values($1,$2,$3,$4,$5,$6,$7,$8) returning *',[b.client_id,b.description||'Contract Fee',b.amount,b.freq,b.start_date,b.end_date||null,b.freq==='yearly'?'SALES-DOMAIN':'SALES-HOSTING',did]))[0])}));
r.put('/contracts/:id',staff,need('contracts','edit'),W(async(req,res)=>{res.json((await q('update contracts set end_date=$2 where id=$1 returning *',[req.params.id,req.body.end_date||null]))[0])}));
// payment = DT BANK KT DEBTORS; credit note = DT CREDIT-GIVEN KT DEBTORS; charge = DT DEBTORS KT SALES-OTHER
r.post('/entries',staff,need('payments','edit'),W(async(req,res)=>{const b=req.body;const a=+b.amount;if(!(a>0))throw new Error('Amount must be more than 0');
 const map={payment:['BANK','DEBTORS','Payment Received'],credit:['CREDIT-GIVEN','DEBTORS','Credit given'],charge:['DEBTORS','SALES-OTHER','Charge']}[b.kind];if(!map)throw new Error('kind');
 res.json((await q('insert into entries(tdate,client_id,description,dt_account,kt_account,amount,kind) values($1,$2,$3,$4,$5,$6,$7) returning *',[b.tdate,b.client_id,b.description||map[2],map[0],map[1],a,b.kind]))[0])}));
r.delete('/entries/:id',staff,need('payments','delete'),W(async(req,res)=>{await q(`delete from entries where id=$1 and kind in('payment','credit','charge')`,[req.params.id]);res.json({ok:1})}));
r.get('/run/preview',staff,need('run','read'),W(async(req,res)=>res.json(await buildRun(req.query.month))));
r.post('/run/finalise',staff,need('run','edit'),W(async(req,res)=>{if(req.body.confirm!=='FINALISE')throw new Error('confirm');res.json(await finalise(req.body.month))}));
mailRoutes(r,{W,need,staff});
// Once-off invoice: next number, booked to the ledger like the monthly run. Never emails.
r.post('/invoices/once-off',staff,need('run','edit'),W(async(req,res)=>{const b=req.body||{};res.json(await onceOff(+b.client_id,b.inv_date,b.lines))}));
r.get('/invoices',need('invoices','read'),W(async(req,res)=>res.json(await q(`select e.invoice_no number,e.client_id,c.name,c.ref,min(e.tdate)::text inv_date,sum(e.amount)::float total,bool_or(e.kind='invoice') final from entries e join clients c on c.id=e.client_id where invoice_no is not null and dt_account='DEBTORS' and ($1::int is null or e.client_id=$1) group by e.invoice_no,e.client_id,c.name,c.ref order by e.invoice_no desc`,[req.user.client_id||null]))));
async function inv(req){const{month,client}=req.query;const[c]=await q('select * from clients where id=$1',[client]);if(!c)throw new Error('client');
 const fin=(await q('select * from invoices where client_id=$1 and period=$2',[client,month]))[0];
 if(fin)return{c,inv:{...fin,total:+fin.total,inv_date:fin.inv_date.toISOString().slice(0,10),lines:await q('select description,amount::float,account from invoice_lines where invoice_id=$1',[fin.id])},draft:null};
 const[d]=await buildRun(month,client);return{c,inv:d,draft:d};}
const send=(res,name,buf)=>{res.type('pdf').set('Content-Disposition',`inline; filename="${name}"`).send(buf)};
r.get('/clients/:id/invoices',need('invoices','read'),W(async(req,res)=>own(req,req.params.id)||res.json(await q(`select invoice_no number,min(tdate)::text inv_date,sum(amount)::float total,bool_or(kind='invoice') final from entries where client_id=$1 and invoice_no is not null and dt_account='DEBTORS' group by invoice_no order by invoice_no desc`,[req.params.id]))));
r.get('/pdf/invoice/:no',need('invoices','read'),W(async(req,res)=>{const ls=await q(`select client_id,tdate::text,description,amount::float from entries where invoice_no=$1 and dt_account='DEBTORS' order by id`,[req.params.no]);if(!ls.length)throw new Error('No such invoice');own(req,ls[0].client_id);
 const[c]=await q('select * from clients where id=$1',[ls[0].client_id]);send(res,`${c.ref}-invoice-${req.params.no}.pdf`,await invoicePdf(await settings(),c,{number:req.params.no,inv_date:ls[0].tdate,lines:ls,total:ls.reduce((a,l)=>a+l.amount,0)}))}));
r.get('/pdf/invoice',need('invoices','read'),W(async(req,res)=>{own(req,req.query.client);const{c,inv:i}=await inv(req);if(req.user.client_id&&!i?.number)throw new Error('No invoice for this month');if(!i)throw new Error('No invoice for this month');send(res,`${c.ref}-invoice-${i.number||'DRAFT'}.pdf`,await invoicePdf(await settings(),c,i))}));
r.get('/pdf/statement',need('statements','read'),W(async(req,res)=>{ym(req.query.month);own(req,req.query.client);const[c]=await q('select * from clients where id=$1',[req.query.client]);if(!c)throw new Error('client');const st=await statementData(c.id,req.query.month);send(res,`${c.ref}-statement-${st.from}-to-${st.to}.pdf`,await statementPdf(await settings(),c,st))}));
r.get('/settings',staff,need('settings','read'),W(async(req,res)=>res.json(await settings())));
r.put('/settings',staff,need('settings','edit'),W(async(req,res)=>{for(const k of['company','tagline','website','email','bank_details','vat_note','owner_name','owner_title','phone'])if(k in req.body)await q('update settings set value=$2 where key=$1',[k,String(req.body[k])]);res.json(await settings())}));
// ---- Journal ----
async function journalLines(qs){const w=[],p=[];const add=(sql,v)=>{p.push(v);w.push(sql.replace('?','$'+p.length))};
 add('e.tdate>=?',qs.from||'2000-01-01');add('e.tdate<=?',qs.to||'2099-12-31');
 if(qs.client)add('e.client_id=?',+qs.client);if(qs.account){p.push(qs.account);w.push(`(e.dt_account=$${p.length} or e.kt_account=$${p.length})`)}
 const rows=await q(`select e.id,e.tdate::text,e.journal_id,e.reference,e.invoice_no,e.description,e.dt_account,e.kt_account,e.amount::float,e.kind,e.client_id,c.ref cref,c.name from entries e left join clients c on c.id=e.client_id where ${w.join(' and ')} order by e.tdate desc,e.id desc`,p);
 const out=[];for(const e of rows){const jno=e.journal_id?'MJ'+e.journal_id:String(e.id);const ref=e.reference||(e.invoice_no?'INV'+e.invoice_no:'J'+e.id);
  const base={tdate:e.tdate,journal_no:jno,journal_id:e.journal_id,reference:ref,description:e.description,client_ref:e.cref||'',client_name:e.name||'',kind:e.kind,entry_id:e.id};
  if(!qs.account||e.dt_account===qs.account)out.push({...base,account:e.dt_account,dt:e.amount,ct:0});
  if(!qs.account||e.kt_account===qs.account)out.push({...base,account:e.kt_account,dt:0,ct:e.amount});}
 return out;}
function csv(lines){const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
 return [['Date','JournalNo','Reference','Description','Account','Debit','Credit','ClientRef','ClientName'],...lines.map(l=>[l.tdate,l.journal_no,l.reference,l.description,l.account,l.dt?l.dt.toFixed(2):'',l.ct?l.ct.toFixed(2):'',l.client_ref,l.client_name])].map(r=>r.map(esc).join(',')).join('\r\n');}
r.get('/journal',staff,need('journal','read'),W(async(req,res)=>res.json(await journalLines(req.query))));
const sendCsv=(res,name,lines)=>res.type('text/csv').set('Content-Disposition',`attachment; filename="${name}"`).send(csv(lines));
r.get('/journal.csv',staff,need('journal','read'),W(async(req,res)=>sendCsv(res,`journal-${req.query.from||'all'}-${req.query.to||'all'}.csv`,(await journalLines(req.query)).reverse())));
r.get('/export.csv',staff,need('export','read'),W(async(req,res)=>sendCsv(res,`journal-${req.query.from}-${req.query.to}.csv`,(await journalLines(req.query)).reverse())));
r.get('/accounts',staff,need('journal','read'),W(async(req,res)=>res.json((await q(`select a from (select dt_account a from entries union select kt_account from entries union select unnest(array['DEBTORS','BANK','SALES-HOSTING','SALES-DOMAIN','SALES-OTHER','CREDIT-GIVEN','OPENING-BALANCE','EXPENSES','HOSTING-COSTS','BANK-CHARGES','DRAWINGS','CAPITAL'])) x order by a`)).map(r=>r.a))));
const C=n=>Math.round(+n*100);
function checkJournal(b){
 if(!/^\d{4}-\d\d-\d\d$/.test(b.tdate||''))throw new Error('Date is required');
 if(!String(b.description||'').trim())throw new Error('Description is required');
 const lines=(b.lines||[]).map(l=>({account:String(l.account||'').trim().toUpperCase(),dt:C(l.dt||0),ct:C(l.ct||0)})).filter(l=>l.account||l.dt||l.ct);
 if(lines.length<2)throw new Error('At least 2 lines needed');
 for(const l of lines){if(!/^[A-Z0-9][A-Z0-9 &_-]{0,39}$/.test(l.account))throw new Error('Bad account name: '+l.account);
  if(l.dt<0||l.ct<0||(l.dt>0)===(l.ct>0))throw new Error(`Line ${l.account}: put an amount in DT or CT, not both`);}
 const dt=lines.reduce((a,l)=>a+l.dt,0),ct=lines.reduce((a,l)=>a+l.ct,0);
 if(dt!==ct)throw new Error(`Not balanced: DT ${(dt/100).toFixed(2)} vs CT ${(ct/100).toFixed(2)}`);
 if(lines.some(l=>l.account==='DEBTORS')&&!b.client_id)throw new Error('Pick a client when using DEBTORS');
 // pair debits with credits into ledger rows
 const D=lines.filter(l=>l.dt).map(l=>({a:l.account,v:l.dt})),K=lines.filter(l=>l.ct).map(l=>({a:l.account,v:l.ct}));const rows=[];
 let i=0,j=0;while(i<D.length&&j<K.length){const v=Math.min(D[i].v,K[j].v);rows.push({dt:D[i].a,kt:K[j].a,amount:v/100});D[i].v-=v;K[j].v-=v;if(!D[i].v)i++;if(!K[j].v)j++;}
 return rows;}
async function saveJournal(b,jid,q){const rows=checkJournal(b);
 if(b.client_id&&!(await q('select 1 from clients where id=$1',[b.client_id])).length)throw new Error('Unknown client');
 const id=jid||(await q(`select nextval('journal_seq')::int n`))[0].n;
 for(const r of rows)await q(`insert into entries(tdate,client_id,description,dt_account,kt_account,amount,kind,journal_id,reference) values($1,$2,$3,$4,$5,$6,'journal',$7,$8)`,[b.tdate,b.client_id||null,b.description.trim(),r.dt,r.kt,r.amount,id,String(b.reference||'').trim()||null]);
 return id;}
async function tx(f){const c=await pool.connect();const cq=(s,p)=>c.query(s,p).then(r=>r.rows);try{await cq('begin');const r=await f(cq);await cq('commit');return r}catch(e){await cq('rollback');throw e}finally{c.release()}}
r.post('/journal',staff,need('journal','edit'),W(async(req,res)=>res.json({journal_id:await tx(cq=>saveJournal(req.body,null,cq))})));
r.get('/journal/:jid',staff,need('journal','read'),W(async(req,res)=>{const rows=await q(`select tdate::text,description,reference,client_id,dt_account,kt_account,amount::float from entries where journal_id=$1 and kind='journal' order by id`,[req.params.jid]);if(!rows.length)throw new Error('Not a manual journal');
 const m={};for(const r of rows){(m['D'+r.dt_account]??={account:r.dt_account,dt:0,ct:0}).dt+=r.amount;(m['K'+r.kt_account]??={account:r.kt_account,dt:0,ct:0}).ct+=r.amount;}
 res.json({tdate:rows[0].tdate,description:rows[0].description,reference:rows[0].reference||'',client_id:rows[0].client_id,lines:Object.values(m)})}));
r.put('/journal/:jid',staff,need('journal','edit'),W(async(req,res)=>{const jid=+req.params.jid;if(!(await q(`select 1 from entries where journal_id=$1 and kind='journal'`,[jid])).length)throw new Error('Only manual journals can be edited');
 await tx(async cq=>{await cq(`delete from entries where journal_id=$1 and kind='journal'`,[jid]);await saveJournal(req.body,jid,cq)});res.json({journal_id:jid})}));
r.delete('/journal/:jid',staff,need('journal','delete'),W(async(req,res)=>{const n=await q(`delete from entries where journal_id=$1 and kind='journal' returning id`,[req.params.jid]);if(!n.length)throw new Error('Only manual journals can be deleted');res.json({deleted:n.length})}));
app.use('/api',r);app.use('/',r);
await init();await bobbyInit();await promptLogInit();await chatInit();await crmInit();await privacyInit();await bizInit();await blogInit();await leadsInit();await accountsInit();await mailInit();await pushInit();app.listen(+process.env.PORT||3000,()=>console.log('api on 3000'));
