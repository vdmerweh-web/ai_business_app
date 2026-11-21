import pg from 'pg';import fs from 'fs';import bcrypt from 'bcryptjs';
export const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
export const q=(s,p)=>pool.query(s,p).then(r=>r.rows);
const ACC={'Web hosting':'SALES-HOSTING','Domain Cost':'SALES-DOMAIN','2Kwaggas':'BANK','Credit Given':'CREDIT-GIVEN'};
export async function init(){
 await q(`create table if not exists users(id serial primary key,email text unique not null,pw_hash text not null);
 create table if not exists sessions(token_hash text primary key,user_id int references users,expires timestamptz not null);
 create table if not exists settings(key text primary key,value text);
 create table if not exists clients(id serial primary key,legacy_id int,ref text unique not null,name text not null,contact text,email text,cell text,active boolean default true);
 create table if not exists contracts(id serial primary key,client_id int references clients,description text not null default 'Contract Fee',amount numeric(12,2) not null,freq text not null default 'monthly',start_date date not null,end_date date,account text default 'SALES-HOSTING');
 create table if not exists invoices(id serial primary key,number int unique not null,client_id int references clients,inv_date date not null,period text,total numeric(12,2),unique(client_id,period));
 create table if not exists invoice_lines(id serial primary key,invoice_id int references invoices,description text,amount numeric(12,2),account text);
 create table if not exists entries(id serial primary key,tdate date not null,client_id int references clients,description text,dt_account text not null,kt_account text not null,amount numeric(12,2) not null,invoice_no int,kind text);`);
 if(!(await q('select 1 from users')).length&&process.env.ADMIN_PASSWORD_HASH_B64){
  const h=Buffer.from(process.env.ADMIN_PASSWORD_HASH_B64,'base64').toString();
  if(!h.startsWith('$2'))throw new Error('bad admin hash');
  await q('insert into users(email,pw_hash) values($1,$2)',[process.env.ADMIN_EMAIL||'hannes@planet-grid.com',h]);console.log('admin seeded');}
 const defs={next_invoice_no:'5277',company:'Planet Grid',tagline:'planet-grid.com business growth platform',website:'planet-grid.com',email:'hannes@planet-grid.com',owner_name:'Hannes van der Merwe',owner_title:'Web Designer',phone:'082-447-1906',bank_details:'Bank: Standard Bank\nBranch: Port Elizabeth\nBranch Code: 50017\nAccount no: 08-037-051-9',vat_note:'planet-grid.com is not VAT registered'};
 for(const[k,v]of Object.entries(defs))await q('insert into settings values($1,$2) on conflict do nothing',[k,v]);
 await q(`alter table entries add column if not exists journal_id int; alter table entries add column if not exists reference text; create sequence if not exists journal_seq start 1;`);
 // v1.1 migrations: replace v1 placeholders, follow Hannes's manual numbers (last 5288)
 await q(`update settings set value=$1 where key='bank_details' and value like '[BANK DETAILS NOT SET%'`,[defs.bank_details]);
 await q(`update settings set value=$1 where key='vat_note' and value='Not VAT registered'`,[defs.vat_note]);
 if(!(await q('select 1 from invoices')).length)await q(`update settings set value='5289' where key='next_invoice_no' and value::int<5289`);
 // v1.3 multi-user: orgs, roles, per-type permission overrides, Google link (additive only)
 await q(`create table if not exists orgs(id serial primary key,name text not null,kind text not null default 'owner',client_id int references clients unique);
 alter table users add column if not exists org_id int references orgs; alter table users add column if not exists client_id int references clients;
 alter table users add column if not exists role text not null default 'viewer'; alter table users add column if not exists perms jsonb not null default '{}';
 alter table users add column if not exists active boolean not null default true; alter table users add column if not exists name text;
 alter table users add column if not exists google_email text; alter table users add column if not exists google_sub text unique;
 alter table users add column if not exists created_at timestamptz default now(); alter table users alter column pw_hash drop not null;
 create table if not exists oauth_states(state text primary key,verifier text not null,nonce text not null,expires timestamptz not null);`);
 if(!(await q(`select 1 from orgs where kind='owner'`)).length)await q(`insert into orgs(name,kind) values('Planet Grid','owner')`);
 await q(`update users set org_id=(select id from orgs where kind='owner' order by id limit 1) where org_id is null and client_id is null`);
 await q(`update users set role='owner',active=true where lower(email)='hannes@planet-grid.com'`);
 // v1.4 signup, multi-domain clients, no-charge flag, dual membership (additive only)
 await q(`alter table clients add column if not exists no_charge boolean not null default false; alter table clients add column if not exists signup boolean not null default false;
 alter table clients add column if not exists created_at timestamptz default now();
 create table if not exists domains(id serial primary key,client_id int not null references clients,domain text not null unique,status text not null default 'active',notes text,created_at timestamptz default now());
 alter table contracts add column if not exists domain_id int references domains;
 alter table users add column if not exists own_client_id int references clients; alter table users add column if not exists invited boolean not null default false;
 alter table users add column if not exists phone text; alter table sessions add column if not exists mode text;
 alter table oauth_states add column if not exists signup jsonb;`);
 if(!(await q('select 1 from clients')).length&&fs.existsSync('seed.json')){
  const d=JSON.parse(fs.readFileSync('seed.json'));
  await q('update settings set value=$1 where key=$2',[String(Math.max(d.next_invoice_no,5289)),'next_invoice_no']);
  for(const c of d.clients){
   const[{id}]=await q('insert into clients(legacy_id,ref,name,contact,email,cell) values($1,$2,$3,$4,$5,$6) returning id',[c.legacy_id,c.ref,c.name,c.contact,c.email,c.cell]);
   for(const k of c.contracts)await q('insert into contracts(client_id,description,amount,freq,start_date) values($1,$2,$3,$4,$5)',[id,k.description,k.amount,k.freq,k.start]);
   if(c.opening)await q(`insert into entries(tdate,client_id,description,dt_account,kt_account,amount,kind) values('2026-01-01',$1,'Opening balance',$2,$3,$4,'opening')`,[id,...(c.opening>0?['DEBTORS','OPENING-BALANCE']:['OPENING-BALANCE','DEBTORS']),Math.abs(c.opening)]);
   for(const t of c.tx){const o=ACC[t.other]||'OTHER';
    if(t.debit)await q(`insert into entries(tdate,client_id,description,dt_account,kt_account,amount,invoice_no,kind) values($1,$2,$3,'DEBTORS',$4,$5,$6,'legacy')`,[t.date,id,t.desc,o,t.debit,t.inv]);
    if(t.credit)await q(`insert into entries(tdate,client_id,description,dt_account,kt_account,amount,invoice_no,kind) values($1,$2,$3,$4,'DEBTORS',$5,$6,'legacy')`,[t.date,id,t.desc,o,t.credit,t.inv]);}
  }console.log('legacy seeded');}
}
export const settings=async()=>Object.fromEntries((await q('select key,value from settings')).map(r=>[r.key,r.value]));
export const SIGN=`case when dt_account='DEBTORS' then amount else -amount end`;
export async function balance(cid,before){const r=await q(`select coalesce(sum(${SIGN}),0)::float b from entries where client_id=$1 ${before?'and tdate<$2':''}`,before?[cid,before]:[cid]);return r[0].b;}
