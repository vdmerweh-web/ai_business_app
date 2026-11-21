// Invoice email: only sent when a staff user clicks Send. Never automatic. No secrets logged.
import nodemailer from 'nodemailer';import rateLimit from 'express-rate-limit';import {q,settings,balance} from './db.js';import {invoicePdf,statementPdf} from './pdf.js';import {statementData} from './billing.js';
const env=k=>(process.env[k]||'').trim();
const cfg=()=>({host:env('SMTP_HOST')||'mail.planet-grid.com',port:+(env('SMTP_PORT')||587),user:env('SMTP_USER')||'hannes@planet-grid.com',pass:process.env.SMTP_PASS||'',from:env('MAIL_FROM')||'Hannes - Planet Grid <hannes@planet-grid.com>'});
export const smtpReady=()=>!!cfg().pass;
const transport=()=>{const c=cfg();return nodemailer.createTransport({host:c.host,port:c.port,secure:c.port===465,requireTLS:c.port!==465,auth:{user:c.user,pass:c.pass},connectionTimeout:15e3,greetingTimeout:15e3,socketTimeout:30e3});};
export const verifySmtp=()=>transport().verify();
const EM=/^[^\s@<>(),;:"\[\]]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const list=(v,name,req)=>{const a=(Array.isArray(v)?v:String(v||'').split(/[,;\s]+/)).map(s=>String(s).trim()).filter(Boolean);
 if(req&&!a.length)throw new Error(`Add at least one ${name} address`);if(a.length>10)throw new Error(`Too many ${name} addresses (max 10)`);
 const bad=a.filter(x=>x.length>254||!EM.test(x));if(bad.length)throw new Error(`Not a valid email address: ${bad.join(', ')}`);return[...new Set(a)];};
const R=n=>'R'+Number(n).toLocaleString('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2}).replace(/\u00a0/g,' ');
// Statement month M covers the 1st of M-5 up to and including the 1st of M+1. An invoice dated the 1st belongs to the month before (5280, 1 Nov -> Oct statement ending 2026/11/01); a mid-month invoice uses its own month. Use the current month if later, so recent bookings show too.
const prevM=(y,m)=>new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7);
const stMonth=d=>{const now=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Johannesburg'}).slice(0,7);const[y,m,dd]=d.split('-').map(Number);const im=dd===1?prevM(y,m):d.slice(0,7);return im>now?im:now};
const safe=s=>String(s).replace(/[^A-Za-z0-9._-]+/g,'-');
const names=(c,inv)=>{const m=stMonth(inv.inv_date);const[y,mm]=m.split('-').map(Number);const from=new Date(Date.UTC(y,mm-6,1)).toISOString().slice(0,10),to=new Date(Date.UTC(y,mm,1)).toISOString().slice(0,10);return{month:m,invoice:`Invoice-${inv.number}.pdf`,statement:`Statement-${safe(c.name)}-${from}-to-${to}.pdf`}};
export async function statementFor(c,inv){const n=names(c,inv);return{name:n.statement,pdf:await statementPdf(await settings(),c,await statementData(c.id,n.month))}}
async function load(no){const ls=await q(`select client_id,tdate::text,description,amount::float from entries where invoice_no=$1 and dt_account='DEBTORS' order by id`,[no]);
 if(!ls.length)throw new Error('No such invoice');const[c]=await q('select * from clients where id=$1',[ls[0].client_id]);
 const[{lt}]=await q('select max(tdate)::text lt from entries where client_id=$1',[c.id]);
 return{c,inv:{last_tdate:lt,number:String(no),inv_date:ls[0].tdate,lines:ls,total:ls.reduce((a,l)=>a+l.amount,0)}};}
export async function mailInit(){await q(`create table if not exists invoice_emails(id serial primary key,invoice_no int not null,to_addrs text not null,cc_addrs text,subject text,sent_at timestamptz default now(),message_id text,status text not null,error text,sent_by int);
 create index if not exists invoice_emails_no on invoice_emails(invoice_no); alter table invoice_emails add column if not exists attachments text`);}
export function mailRoutes(r,{W,need,staff}){
 r.get('/invoices/:no/email',staff,need('invoices','edit'),W(async(req,res)=>{const no=+req.params.no;const{c,inv}=await load(no);const bal=await balance(c.id);
  const lines=inv.lines.map(l=>`- ${l.description}: ${R(l.amount)}`).join('\n');
  const payBit=(bal>0.004?`Your account balance is now ${R(bal)}. `:'')+`Please use reference ${c.name||c.ref} when you pay.`;
  const message=`Dear ${c.contact||c.name},\n\nPlease find attached invoice ${no} for ${c.name}, dated ${inv.inv_date.replace(/-/g,'/')}, for ${R(inv.total)}.\n\n${lines}\n\n${payBit} I've also attached your latest 6-month statement.\n\nThank you for your business. If you have any questions, just reply to this email.\n\nKind regards,\nHannes\nPlanet Grid`;
  res.json({configured:smtpReady(),from:cfg().from,client:c.name,attachments:(n=>[{kind:'Invoice',name:n.invoice},{kind:'6-month statement',name:n.statement}])(names(c,inv)),
   defaults:{to:c.email||'',cc:'hannes@planet-grid.com',subject:`Invoice ${no} from Planet Grid`,message},
   history:await q(`select to_addrs,cc_addrs,subject,attachments,sent_at,message_id,status,error from invoice_emails where invoice_no=$1 order by sent_at desc`,[no])});}));
 r.post('/invoices/:no/email',staff,need('invoices','edit'),rateLimit({windowMs:15*60e3,limit:10,standardHeaders:true,message:{error:'Too many emails. Wait 15 minutes.'}}),W(async(req,res)=>{
  if(!smtpReady())throw new Error('Email not set up yet');const no=+req.params.no;const b=req.body||{};
  const to=list(b.to,'To',true),cc=list(b.cc,'CC',false);const subject=String(b.subject||'').trim().slice(0,200),text=String(b.message||'').trim().slice(0,20000);
  if(!subject||!text)throw new Error('Subject and message are needed');
  const{c,inv}=await load(no);if(c.active===false)throw new Error('This client is inactive: no invoice or statement emails');const pdf=await invoicePdf(await settings(),c,inv);const st=await statementFor(c,inv);const k=cfg();const att=`${names(c,inv).invoice}, ${st.name}`;
  try{const info=await transport().sendMail({from:k.from,to,cc,subject,text,attachments:[{filename:names(c,inv).invoice,content:pdf,contentType:'application/pdf'},{filename:st.name,content:st.pdf,contentType:'application/pdf'}]});
   await q(`insert into invoice_emails(invoice_no,to_addrs,cc_addrs,subject,message_id,status,sent_by,attachments) values($1,$2,$3,$4,$5,'sent',$6,$7)`,[no,to.join(', '),cc.join(', '),subject,info.messageId||null,req.user.id,att]);
   res.json({ok:true,messageId:info.messageId});}
  catch(e){await q(`insert into invoice_emails(invoice_no,to_addrs,cc_addrs,subject,status,error,sent_by,attachments) values($1,$2,$3,$4,'failed',$5,$6,$7)`,[no,to.join(', '),cc.join(', '),subject,String(e.message).slice(0,500),req.user.id,att]);
   throw new Error('Sending failed: '+e.message);}}));
}
