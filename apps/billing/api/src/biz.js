// Products (catalogue, shipping, orders) and Projects (tasks, docs, team). Strictly per account like the CRM:
// acct = req.user.client_id (portal / company switcher) or null (Planet Grid's own). Not linked to billing invoices.
// Record types: products (catalogue+shipping), orders, projects. Flags: clients.products_enabled / projects_enabled, settings for Planet Grid.
import {q,pool} from './db.js';import fs from 'fs';import path from 'path';
const DIR=process.env.UPLOAD_DIR||'/data/uploads';const VDIR=path.join(DIR,'variants');
// Size variants generated from library images (WebP). og = 1200x630 cover crop for social cards.
export const SIZES={thumb:{w:300},medium:{w:800},large:{w:1600},og:{w:1200,h:630}};
async function makeVariants(fid){try{const sharp=(await import('sharp')).default;fs.mkdirSync(VDIR,{recursive:true});const src=path.join(DIR,fid);
 for(const[k,o]of Object.entries(SIZES)){const out=path.join(VDIR,`${fid}_${k}.webp`);if(fs.existsSync(out))continue;
  await sharp(src).rotate().resize(o.h?{width:o.w,height:o.h,fit:'cover'}:{width:o.w,withoutEnlargement:true}).webp({quality:80}).toFile(out)}return true}catch(e){console.error('variants',fid,e.message);return false}}
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});
const A='client_id is not distinct from $1';
const acct=req=>req.user.client_id||null;
const clean=(v,n=200)=>v==null||v===''?null:String(v).trim().slice(0,n)||null;
const req_=(m,n=160)=>v=>{const x=clean(v,n);if(!x)throw err(m);return x};
const num=(m,min=0)=>v=>{if(v===''||v==null)return null;const n=+v;if(!isFinite(n)||n<min)throw err(m);return Math.round(n*100)/100};
const int=(m,min=0)=>v=>{if(v===''||v==null)return null;const n=Math.trunc(+v);if(!isFinite(n)||n<min)throw err(m);return n};
const one=(l,m)=>v=>{if(!l.includes(v))throw err(m);return v};
const date=v=>{if(!v)return null;if(!/^\d{4}-\d\d-\d\d$/.test(v))throw err('Dates must be YYYY-MM-DD');return v};
const id=v=>v?+v:null;const bool=v=>v===true||v==='true'||v===1;
const email=v=>{const e=clean(v,200)?.toLowerCase()||null;if(e&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))throw err('That email does not look right');return e};
export const ORDER_ST=['new','paid','packed','shipped','delivered','cancelled'];
const TASK_ST=['todo','doing','review','done'];
export async function bizInit(){await q(`
 alter table clients add column if not exists products_enabled boolean not null default false;
 alter table clients add column if not exists projects_enabled boolean not null default false;
 insert into settings values('products_enabled','true') on conflict do nothing; insert into settings values('projects_enabled','true') on conflict do nothing;
 create table if not exists products(id serial primary key,client_id int references clients,name text not null,sku text,description text,price_incl numeric(12,2) not null default 0,vat_rate numeric(5,2) not null default 15,stock int,status text not null default 'active' check(status in('active','draft','archived')),weight_kg numeric(10,3),domain text,supplier_id int references crm_companies on delete set null,created_at timestamptz default now(),updated_at timestamptz default now());
 create unique index if not exists products_sku on products(coalesce(client_id,0),lower(sku)) where sku is not null;
 create table if not exists product_files(product_id int not null references products on delete cascade,file_id text not null references files on delete cascade,client_id int,pos int not null default 0,primary key(product_id,file_id));
 create table if not exists ship_methods(id serial primary key,client_id int references clients,name text not null,kind text not null default 'flat' check(kind in('flat','weight','collection')),courier text,base numeric(12,2) not null default 0,per_kg numeric(12,2) not null default 0,free_over numeric(12,2),eta text,active boolean not null default true,created_at timestamptz default now());
 create table if not exists orders(id serial primary key,client_id int references clients,no int not null,company_id int references crm_companies on delete set null,contact_id int references crm_contacts on delete set null,status text not null default 'new' check(status in('new','paid','packed','shipped','delivered','cancelled')),ship_method_id int references ship_methods on delete set null,ship_cost numeric(12,2) not null default 0,courier text,tracking text,ship_to text,notes text,stock_applied boolean not null default false,created_at timestamptz default now(),updated_at timestamptz default now());
 create unique index if not exists orders_no on orders(coalesce(client_id,0),no);
 create table if not exists order_lines(id serial primary key,order_id int not null references orders on delete cascade,client_id int,product_id int references products on delete set null,name text not null,sku text,qty int not null check(qty>0),unit_incl numeric(12,2) not null,vat_rate numeric(5,2) not null default 15);
 create table if not exists order_log(id serial primary key,order_id int not null references orders on delete cascade,client_id int,status text,note text,user_id int,at timestamptz default now());
 create table if not exists projects(id serial primary key,client_id int references clients,name text not null,status text not null default 'active' check(status in('planning','active','on_hold','done')),start_date date,due_date date,company_id int references crm_companies on delete set null,domain text,description text,created_at timestamptz default now(),updated_at timestamptz default now());
 create table if not exists project_members(id serial primary key,project_id int not null references projects on delete cascade,client_id int,user_id int references users on delete cascade,name text,email text,role text,created_at timestamptz default now());
 create table if not exists tasks(id serial primary key,project_id int not null references projects on delete cascade,client_id int,parent_id int references tasks on delete cascade,title text not null,description text,assignee_id int references project_members on delete set null,due date,priority text not null default 'normal' check(priority in('low','normal','high','urgent')),status text not null default 'todo' check(status in('todo','doing','review','done')),pos int not null default 0,checklist jsonb not null default '[]',created_at timestamptz default now(),updated_at timestamptz default now(),done_at timestamptz);
 create table if not exists task_comments(id serial primary key,task_id int not null references tasks on delete cascade,client_id int,user_id int,body text not null,created_at timestamptz default now());
 create table if not exists project_docs(id serial primary key,project_id int not null references projects on delete cascade,client_id int,title text not null,body text not null default '',pos int not null default 0,updated_by int,created_at timestamptz default now(),updated_at timestamptz default now());
 create table if not exists doc_files(doc_id int not null references project_docs on delete cascade,file_id text not null references files on delete cascade,client_id int,primary key(doc_id,file_id));
 alter table crm_deletions add column if not exists label text;
 alter table products add column if not exists kind text not null default 'physical';alter table products add column if not exists track_stock boolean not null default true;alter table products add column if not exists low_stock int;alter table products add column if not exists backorders boolean not null default false;
 alter table products add column if not exists download_file_id text references files on delete set null;alter table products add column if not exists specs jsonb not null default '[]';
 alter table products add column if not exists brand text;alter table products add column if not exists gtin text;alter table products add column if not exists mpn text;alter table products add column if not exists slug text;alter table products add column if not exists meta_title text;alter table products add column if not exists meta_desc text;
 alter table products add column if not exists canonical text;alter table products add column if not exists og_title text;alter table products add column if not exists og_desc text;alter table products add column if not exists tw_card text not null default 'summary_large_image';alter table products add column if not exists keywords text[] not null default '{}';
 create table if not exists product_variants(id serial primary key,product_id int not null references products on delete cascade,client_id int,name text not null,options jsonb not null default '{}',sku text,price_incl numeric(12,2),stock int,image_file_id text references files on delete set null,pos int not null default 0);
 alter table product_files add column if not exists role text not null default 'gallery';alter table product_files add column if not exists alt text not null default '';alter table product_files add column if not exists variants boolean not null default false;
 alter table order_lines add column if not exists variant_id int references product_variants on delete set null;
 create index if not exists products_acct on products(client_id);create index if not exists orders_acct on orders(client_id,status);create index if not exists tasks_proj on tasks(project_id,status,pos);`);}
export async function flags(cid){if(cid){const[c]=await q('select products_enabled,projects_enabled from clients where id=$1',[cid]);return{products:!!c?.products_enabled,projects:!!c?.projects_enabled}}
 const s=Object.fromEntries((await q(`select key,value from settings where key in('products_enabled','projects_enabled')`)).map(r=>[r.key,r.value]));return{products:s.products_enabled!=='false',projects:s.projects_enabled!=='false'}}
async function own(tbl,i,a,what='record'){if(i==null)return;if(!(await q(`select 1 from ${tbl} where id=$2 and ${A}`,[a,i])).length)throw err(`That ${what} is not in this account`,404);}
async function libFile(a,fid){if(!(await q(`select 1 from files where id=$2 and in_library and ${A}`,[a,String(fid||'')])).length)throw err('That file is not in your Files library',404);}
const F={
 products:{name:req_('Product name is required'),sku:v=>clean(v,60),description:v=>clean(v,5000),price_incl:v=>num('Price must be 0 or more')(v)??0,vat_rate:v=>num('VAT rate must be 0 or more')(v)??15,stock:int('Stock must be 0 or more'),status:one(['active','draft','archived'],'Status: active, draft or archived'),weight_kg:num('Weight must be 0 or more'),domain:v=>clean(v,120)?.toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'')||null,supplier_id:id,
  kind:one(['physical','digital','service'],'Type: physical, digital or service'),track_stock:bool,low_stock:int('Low-stock level must be 0 or more'),backorders:bool,download_file_id:v=>clean(v,64),
  specs:v=>JSON.stringify((Array.isArray(v)?v:[]).slice(0,60).map(x=>({k:String(x?.k||'').trim().slice(0,60),v:String(x?.v||'').trim().slice(0,300)})).filter(x=>x.k)),
  brand:v=>clean(v,80),gtin:v=>{const x=clean(v,14);if(x&&!/^\d{8,14}$/.test(x))throw err('GTIN/barcode must be 8 to 14 digits');return x},mpn:v=>clean(v,60),
  slug:v=>clean(v,120)?.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||null,meta_title:v=>clean(v,120),meta_desc:v=>clean(v,320),canonical:v=>{const x=clean(v,300);if(x&&!/^https:\/\//.test(x))throw err('Canonical URL must start with https://');return x},
  og_title:v=>clean(v,120),og_desc:v=>clean(v,320),tw_card:one(['summary','summary_large_image'],'Twitter card: summary or large image'),keywords:v=>[...new Set((Array.isArray(v)?v:String(v||'').split(',')).map(t=>String(t).trim().slice(0,40)).filter(Boolean))].slice(0,30)},
 variants:{name:req_('Name the variant (e.g. Large / Red)',120),options:v=>Object.fromEntries(Object.entries(v&&typeof v==='object'?v:{}).slice(0,5).map(([a,b])=>[String(a).slice(0,30),String(b).slice(0,60)])),sku:v=>clean(v,60),price_incl:num('Price must be 0 or more'),stock:int('Stock must be 0 or more'),image_file_id:v=>clean(v,64),pos:v=>int('pos')(v)??0},
 ship_methods:{name:req_('Name the shipping method'),kind:one(['flat','weight','collection'],'Type: flat, weight or collection'),courier:v=>clean(v,80),base:v=>num('Price must be 0 or more')(v)??0,per_kg:v=>num('Per kg must be 0 or more')(v)??0,free_over:num('Free-over must be 0 or more'),eta:v=>clean(v,80),active:bool},
 projects:{name:req_('Project name is required'),status:one(['planning','active','on_hold','done'],'Status: planning, active, on hold or done'),start_date:date,due_date:date,company_id:id,domain:v=>clean(v,120),description:v=>clean(v,5000)},
 tasks:{title:req_('Give the task a title',200),description:v=>clean(v,10000),assignee_id:id,due:date,priority:one(['low','normal','high','urgent'],'Priority: low, normal, high or urgent'),status:one(TASK_ST,'Status: to do, doing, review or done'),pos:v=>int('pos')(v)??0,parent_id:id,
  checklist:v=>(Array.isArray(v)?v:[]).slice(0,100).map(x=>({t:String(x?.t||'').trim().slice(0,200),done:!!x?.done})).filter(x=>x.t)},
 project_docs:{title:req_('Give the page a title'),body:v=>String(v??'').slice(0,200000),pos:v=>int('pos')(v)??0},
};
const REQ={variants:['name'],products:['name'],ship_methods:['name'],projects:['name'],tasks:['title'],project_docs:['title']};
function pick(t,b,partial){const o={};for(const k of Object.keys(F[t]))if(k in b)o[k]=F[t][k](b[k]);else if(!partial&&REQ[t].includes(k))o[k]=F[t][k](undefined);if('checklist'in o)o.checklist=JSON.stringify(o.checklist);if(t==='variants'&&'options'in o)o.options=JSON.stringify(o.options);return o}
const ins=async(t,a,o,extra={})=>{o={...o,...extra};const ks=Object.keys(o);return(await q(`insert into ${t}(client_id${ks.map(k=>','+k).join('')}) values($1${ks.map((_,i)=>',$'+(i+2)).join('')}) returning *`,[a,...ks.map(k=>o[k])]))[0]};
const upd=async(t,a,i,o,touch=true)=>{const ks=Object.keys(o);if(!ks.length)throw err('Nothing to change');const[x]=await q(`update ${t} set ${ks.map((k,j)=>`${k}=$${j+3}`).join(',')}${touch?',updated_at=now()':''} where id=$2 and ${A} returning *`,[a,i,...ks.map(k=>o[k])]);if(!x)throw err('Not found',404);return x};
const logDel=(req,kind,rid,label)=>q('insert into crm_deletions(client_id,kind,record_id,user_id,reason,label) values($1,$2,$3,$4,$5,$6)',[req.acct,kind,rid,req.user.id,clean(req.query.reason,200),clean(label,200)]);
const csvEsc=v=>`"${String(v??'').replace(/"/g,'""').replace(/^([=+\-@])/,"'$1")}"`;
const money=n=>Math.round(n*100)/100;
// Totals: all prices are VAT-inclusive; VAT = incl * r/(100+r). Shipping VAT at 15%.
function totals(lines,ship){let incl=0,vat=0;for(const l of lines){const t=+l.unit_incl*l.qty;incl+=t;vat+=t*+l.vat_rate/(100+ +l.vat_rate)}const s=+ship||0;incl+=s;vat+=s*15/115;return{subtotal_incl:money(incl-s),shipping:money(s),total_incl:money(incl),vat:money(vat),total_excl:money(incl-vat)}}
export function shipQuote(m,weight,goods){if(!m)return 0;if(m.kind==='collection')return 0;if(m.free_over!=null&&goods>=+m.free_over)return 0;return money(+m.base+(m.kind==='weight'?Math.max(0,Math.ceil(weight||0))*+m.per_kg:0))}
const LIVE=['paid','packed','shipped','delivered'];
const ROLES_IMG=['main','gallery','thumbnail','social','variant'];
const avail=p=>p.status!=='active'?'https://schema.org/Discontinued':p.kind!=='physical'||!p.track_stock||p.stock==null?'https://schema.org/InStock':p.stock>0?'https://schema.org/InStock':p.backorders?'https://schema.org/BackOrder':'https://schema.org/OutOfStock';
// schema.org Product JSON-LD for the product page on the client's website.
export function jsonld(p){const site=p.domain?'https://'+p.domain:null;const url=p.canonical||(site&&p.slug?`${site}/products/${p.slug}`:undefined);const img=(p.images||[]).sort((a,b)=>(a.role==='main'?-1:0)-(b.role==='main'?-1:0)).map(i=>site?`${site}/media/${i.id}.webp`:i.vurl);
 const o={'@context':'https://schema.org','@type':'Product',name:p.name,description:p.meta_desc||p.description||undefined,sku:p.sku||undefined,gtin:p.gtin||undefined,mpn:p.mpn||undefined,brand:p.brand?{'@type':'Brand',name:p.brand}:undefined,image:img.length?img:undefined,url,
  offers:(p.variants?.length?p.variants:[null]).map(v=>({'@type':'Offer',sku:v?.sku||p.sku||undefined,name:v?.name,price:(v?.price_incl??p.price_incl).toFixed(2),priceCurrency:'ZAR',availability:v&&p.track_stock&&v.stock!=null?(v.stock>0?'https://schema.org/InStock':p.backorders?'https://schema.org/BackOrder':'https://schema.org/OutOfStock'):avail(p),url}))};
 if(p.specs?.length)o.additionalProperty=p.specs.map(s=>({'@type':'PropertyValue',name:s.k,value:s.v}));return JSON.parse(JSON.stringify(o))}
// Stock movement for one order line (dir -1 take, +1 return). Only tracked physical products; variant stock if the line has a variant.
async function move(c,l,dir){const[p]=(await c.query("select name,track_stock,kind,low_stock from products where id=$1",[l.product_id])).rows;if(!p||!p.track_stock||p.kind!=='physical')return null;
 const r=l.variant_id?(await c.query('update product_variants set stock=stock+$2 where id=$1 and stock is not null returning stock',[l.variant_id,dir*l.qty])).rows[0]:(await c.query('update products set stock=stock+$2,updated_at=now() where id=$1 and stock is not null returning stock',[l.product_id,dir*l.qty])).rows[0];
 return r?{name:p.name,stock:r.stock,low:p.low_stock!=null&&r.stock<=p.low_stock}:null}
export function bizRoutes(r,{W,need}){
 const on=k=>W(async(req,res,next)=>{const a=acct(req);if(!(await flags(a))[k])return res.status(403).json({error:`${k==='products'?'Products':'Projects'} are not enabled for this account`});req.acct=a;next()});
 const P=l=>[on('products'),need('products',l)],O=l=>[on('products'),need('orders',l)],J=l=>[on('projects'),need('projects',l)];
 // ---- shared lookups
 r.get('/biz/lookups',W(async(req,res)=>{const a=acct(req);res.json({
  companies:await q(`select id,name,type from crm_companies where ${A} order by lower(name)`,[a]),contacts:await q(`select id,name,company_id,email,mobile from crm_contacts where ${A} order by lower(name)`,[a]),
  domains:a?(await q('select domain from domains where client_id=$1 order by domain',[a])).map(d=>d.domain):['planet-grid.com'],
  library:await q(`select id,name,mime,category,'/api/files/'||id url,mime in('image/png','image/jpeg','image/gif','image/webp') image from files where in_library and ${A} order by created_at desc limit 500`,[a]),
  users:await q(`select id,coalesce(name,email) name,email from users where active and ${a?'(client_id=$1 or own_client_id=$1)':"client_id is null and role<>'client' and $1::int is null"} order by 2`,[a])})}));
 // ---- products
 const prodFiles=a=>q(`select pf.product_id,pf.role,pf.alt,pf.variants,pf.pos,f.id,f.name,f.category,'/api/files/'||f.id url,'/api/products/img/'||f.id vurl from product_files pf join files f on f.id=pf.file_id where pf.${A} order by pf.pos,f.created_at`,[a]);
 r.get('/products',...P('read'),W(async(req,res)=>{const a=req.acct;const rows=await q(`select p.*,p.price_incl::float price_incl,p.vat_rate::float vat_rate,p.weight_kg::float weight_kg,c.name supplier from products p left join crm_companies c on c.id=p.supplier_id where p.${A} order by lower(p.name)`,[a]);
  const im=await prodFiles(a);const vs=await q(`select *,price_incl::float price_incl from product_variants where ${A} order by pos,id`,[a]);
  for(const p of rows){p.images=im.filter(f=>f.product_id===p.id);p.variants=vs.filter(v=>v.product_id===p.id);p.price_excl=money(p.price_incl*100/(100+p.vat_rate));p.availability=avail(p);p.low=p.track_stock&&p.kind==='physical'&&p.low_stock!=null&&p.stock!=null&&p.stock<=p.low_stock;p.jsonld=jsonld(p)}res.json(rows)}));
 r.get('/products/img/:fid',...P('read'),W(async(req,res)=>{const fid=req.params.fid,k=SIZES[req.query.size]?req.query.size:'medium';if(!/^[\w-]+$/.test(fid))throw err('Bad id');
  if(!(await q(`select 1 from product_files where file_id=$2 and ${A}`,[req.acct,fid])).length)throw err('Not found',404);const f=path.join(VDIR,`${fid}_${k}.webp`);
  if(!fs.existsSync(f)&&!(await makeVariants(fid)))return res.redirect('/api/files/'+fid);res.set('Cache-Control','private, max-age=86400').type('image/webp').sendFile(f)}));
 for(const m of['post','put'])r[m](m==='post'?'/products/:id/variants':'/variants/:id',...P('edit'),W(async(req,res)=>{const a=req.acct,o=pick('variants',req.body||{},m==='put');if(o.image_file_id)await libFile(a,o.image_file_id);
  if(m==='post'){await own('products',+req.params.id,a,'product');return res.json(await ins('product_variants',a,o,{product_id:+req.params.id}))}res.json(await upd('product_variants',a,+req.params.id,o,false))}));
 r.delete('/variants/:id',...P('delete'),W(async(req,res)=>{const[x]=await q(`delete from product_variants where id=$2 and ${A} returning id,name`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);await logDel(req,'variants',x.id,x.name);res.json({ok:1})}));
 r.put('/products/:id/images/:fid',...P('edit'),W(async(req,res)=>{const b=req.body||{};const o={};if('alt'in b){o.alt=clean(b.alt,250);if(!o.alt)throw err('Alt text is required: describe the image for people using screen readers')}if('role'in b)o.role=one(ROLES_IMG,'Unknown image role')(b.role);if('pos'in b)o.pos=+b.pos||0;const ks=Object.keys(o);if(!ks.length)throw err('Nothing to change');
  if(o.role==='main')await q(`update product_files set role='gallery' where product_id=$2 and role='main' and ${A}`,[req.acct,+req.params.id]);
  await q(`update product_files set ${ks.map((k,i)=>`${k}=$${i+4}`).join(',')} where product_id=$2 and file_id=$3 and ${A}`,[req.acct,+req.params.id,req.params.fid,...ks.map(k=>o[k])]);res.json({ok:1})}));
 r.post('/products',...P('edit'),W(async(req,res)=>{const o=pick('products',req.body||{});if(o.download_file_id)await libFile(req.acct,o.download_file_id);await own('crm_companies',o.supplier_id,req.acct,'supplier');res.json(await ins('products',req.acct,o).catch(e=>{throw e.code==='23505'?err('That SKU is already used'):e}))}));
 r.put('/products/:id',...P('edit'),W(async(req,res)=>{const o=pick('products',req.body||{},true);if(o.download_file_id)await libFile(req.acct,o.download_file_id);await own('crm_companies',o.supplier_id,req.acct,'supplier');res.json(await upd('products',req.acct,+req.params.id,o).catch(e=>{throw e.code==='23505'?err('That SKU is already used'):e}))}));
 r.delete('/products/:id',...P('delete'),W(async(req,res)=>{const[x]=await q(`delete from products where id=$2 and ${A} returning id,name`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);await logDel(req,'products',x.id,x.name);res.json({ok:1})}));
 r.post('/products/:id/images',...P('edit'),W(async(req,res)=>{const a=req.acct,b=req.body||{};await own('products',+req.params.id,a,'product');await libFile(a,b.file_id);const alt=clean(b.alt,250);if(!alt)throw err('Alt text is required: describe the image for people using screen readers');const role=one(ROLES_IMG,'Unknown image role')(b.role||'gallery');
  const[f]=await q('select mime from files where id=$1',[String(b.file_id)]);if(!/^image\//.test(f.mime))throw err('Only images can be product pictures (use Download file for other files)');
  if(role==='main')await q(`update product_files set role='gallery' where product_id=$2 and role='main' and ${A}`,[a,+req.params.id]);
  await q('insert into product_files(product_id,file_id,client_id,pos,role,alt) values($1,$2,$3,(select count(*) from product_files where product_id=$1),$4,$5) on conflict(product_id,file_id) do update set role=$4,alt=$5',[+req.params.id,String(b.file_id),a,role,alt]);
  const ok=await makeVariants(String(b.file_id));await q('update product_files set variants=$2 where file_id=$1',[String(b.file_id),ok]);res.json({ok:1,variants:ok})}));
 r.delete('/products/:id/images/:fid',...P('edit'),W(async(req,res)=>{await q(`delete from product_files where product_id=$2 and file_id=$3 and ${A}`,[req.acct,+req.params.id,req.params.fid]);res.json({ok:1})}));
 r.get('/products/export.csv',...P('delete'),W(async(req,res)=>{const rows=await q(`select p.name,p.sku,p.status,p.price_incl::float price_incl,round(p.price_incl*100/(100+p.vat_rate),2)::float price_excl,p.vat_rate::float vat_rate,p.stock,p.weight_kg::float weight_kg,p.domain,c.name supplier,p.description from products p left join crm_companies c on c.id=p.supplier_id where p.${A} order by lower(p.name)`,[req.acct]);
  const h=['name','sku','status','price_incl','price_excl','vat_rate','stock','weight_kg','domain','supplier','description'];res.set('Content-Type','text/csv').set('Content-Disposition','attachment; filename="products.csv"').send('\ufeff'+[h.join(','),...rows.map(x=>h.map(k=>csvEsc(x[k])).join(','))].join('\r\n'))}));
 // ---- shipping methods
 r.get('/shipping',...P('read'),W(async(req,res)=>res.json(await q(`select *,base::float base,per_kg::float per_kg,free_over::float free_over from ship_methods where ${A} order by active desc,lower(name)`,[req.acct]))));
 r.post('/shipping',...P('edit'),W(async(req,res)=>res.json(await ins('ship_methods',req.acct,pick('ship_methods',req.body||{})))));
 r.put('/shipping/:id',...P('edit'),W(async(req,res)=>res.json(await upd('ship_methods',req.acct,+req.params.id,pick('ship_methods',req.body||{},true),false))));
 r.delete('/shipping/:id',...P('delete'),W(async(req,res)=>{const[x]=await q(`delete from ship_methods where id=$2 and ${A} returning id,name`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);await logDel(req,'shipping',x.id,x.name);res.json({ok:1})}));
 // ---- orders
 const orderList=async(a,oid)=>{const os=await q(`select o.*,o.ship_cost::float ship_cost,c.name company,p.name contact,p.email contact_email,p.mobile contact_mobile,m.name ship_method from orders o left join crm_companies c on c.id=o.company_id left join crm_contacts p on p.id=o.contact_id left join ship_methods m on m.id=o.ship_method_id where o.${A} ${oid?'and o.id=$2':''} order by o.no desc`,oid?[a,oid]:[a]);
  const ls=await q(`select *,unit_incl::float unit_incl,vat_rate::float vat_rate from order_lines where ${A} ${oid?'and order_id=$2':''} order by id`,oid?[a,oid]:[a]);
  for(const o of os){o.lines=ls.filter(l=>l.order_id===o.id);Object.assign(o,totals(o.lines,o.ship_cost))}return os};
 r.get('/orders',...O('read'),W(async(req,res)=>res.json(await orderList(req.acct))));
 r.get('/orders/:id(\d+)',...O('read'),W(async(req,res)=>{const[o]=await orderList(req.acct,+req.params.id);if(!o)throw err('Not found',404);o.log=await q(`select l.*,u.name who from order_log l left join users u on u.id=l.user_id where l.order_id=$2 and l.${A} order by l.at`,[req.acct,o.id]);res.json(o)}));
 // Body: {company_id,contact_id,ship_method_id,ship_cost?,ship_to,notes,courier,tracking,lines:[{product_id,qty,unit_incl?}|{name,qty,unit_incl,vat_rate}]}
 async function saveOrder(req,oid){const a=req.acct,b=req.body||{};const c=await pool.connect();try{await c.query('begin');
  const cur=oid?(await c.query(`select * from orders where id=$2 and ${A} for update`,[a,oid])).rows[0]:null;if(oid&&!cur)throw err('Not found',404);
  const o={};if('company_id'in b)o.company_id=id(b.company_id);if('contact_id'in b)o.contact_id=id(b.contact_id);if('ship_method_id'in b)o.ship_method_id=id(b.ship_method_id);
  for(const k of['ship_to','notes'])if(k in b)o[k]=clean(b[k],2000);for(const k of['courier','tracking'])if(k in b)o[k]=clean(b[k],120);
  await own('crm_companies',o.company_id,a,'company');await own('crm_contacts',o.contact_id,a,'contact');await own('ship_methods',o.ship_method_id,a,'shipping method');
  let lines=null;if(Array.isArray(b.lines)){if(cur&&cur.stock_applied)throw err('Items can only be changed while the order is New. Cancel and re-create it instead.');
   lines=[];for(const l of b.lines.slice(0,200)){const qty=Math.trunc(+l.qty);if(!(qty>0))throw err('Each item needs a quantity of 1 or more');
    if(l.product_id){const[p]=(await c.query(`select * from products where id=$2 and ${A}`,[a,+l.product_id])).rows;if(!p)throw err('That product is not in this account',404);
     const v=l.variant_id?(await c.query('select * from product_variants where id=$1 and product_id=$2',[+l.variant_id,p.id])).rows[0]:null;if(l.variant_id&&!v)throw err('That variant is not on this product',404);
     if(p.track_stock&&p.kind==='physical'&&!p.backorders){const st=v?v.stock:p.stock;if(st!=null&&st<qty)throw err(`Only ${st} of ${p.name}${v?' ('+v.name+')':''} in stock and backorders are off`)}
     lines.push({product_id:p.id,variant_id:v?.id||null,name:p.name+(v?' – '+v.name:''),sku:v?.sku||p.sku,qty,unit_incl:l.unit_incl!=null&&l.unit_incl!==''?num('Price')(l.unit_incl):+(v?.price_incl??p.price_incl),vat_rate:+p.vat_rate,w:p.kind==='physical'?+p.weight_kg||0:0})}
    else{const name=clean(l.name,200);if(!name)throw err('Each item needs a product or a name');lines.push({product_id:null,name,sku:clean(l.sku,60),qty,unit_incl:num('Price')(l.unit_incl)??0,vat_rate:num('VAT')(l.vat_rate)??15,w:0})}}
   if(!lines.length)throw err('Add at least one item');}
  if('ship_cost'in b&&b.ship_cost!==''&&b.ship_cost!=null)o.ship_cost=num('Shipping must be 0 or more')(b.ship_cost);
  else if(lines||'ship_method_id'in b){const L=lines||(await c.query('select l.*,coalesce(p.weight_kg,0) w from order_lines l left join products p on p.id=l.product_id where order_id=$1',[oid])).rows;const mid=('ship_method_id'in o)?o.ship_method_id:cur?.ship_method_id;
   const m=mid?(await c.query('select * from ship_methods where id=$1',[mid])).rows[0]:null;o.ship_cost=shipQuote(m,L.reduce((s,l)=>s+(+l.w||0)*l.qty,0),L.reduce((s,l)=>s+ +l.unit_incl*l.qty,0));}
  let row;if(!oid){if(!lines)throw err('Add at least one item');const no=(await c.query(`select coalesce(max(no),1000)+1 n from orders where ${A}`,[a])).rows[0].n;const ks=Object.keys(o);
   row=(await c.query(`insert into orders(client_id,no${ks.map(k=>','+k).join('')}) values($1,$2${ks.map((_,i)=>',$'+(i+3)).join('')}) returning *`,[a,no,...ks.map(k=>o[k])])).rows[0];await c.query('insert into order_log(order_id,client_id,status,note,user_id) values($1,$2,$3,$4,$5)',[row.id,a,'new','Order created',req.user.id]);}
  else{const ks=Object.keys(o);row=ks.length?(await c.query(`update orders set ${ks.map((k,i)=>`${k}=$${i+3}`).join(',')},updated_at=now() where id=$2 and ${A} returning *`,[a,oid,...ks.map(k=>o[k])])).rows[0]:cur;}
  if(lines){await c.query('delete from order_lines where order_id=$1',[row.id]);for(const l of lines)await c.query('insert into order_lines(order_id,client_id,product_id,variant_id,name,sku,qty,unit_incl,vat_rate) values($1,$2,$3,$9,$4,$5,$6,$7,$8)',[row.id,a,l.product_id,l.name,l.sku,l.qty,l.unit_incl,l.vat_rate,l.variant_id]);}
  await c.query('commit');return row.id}catch(e){await c.query('rollback');throw e}finally{c.release()}}
 r.post('/orders',...O('edit'),W(async(req,res)=>{const i=await saveOrder(req);res.json((await orderList(req.acct,i))[0])}));
 r.put('/orders/:id',...O('edit'),W(async(req,res)=>{const i=await saveOrder(req,+req.params.id);res.json((await orderList(req.acct,i))[0])}));
 // Status change. Stock comes off when an order first becomes paid/packed/shipped/delivered, and goes back if it is cancelled.
 r.post('/orders/:id/status',...O('edit'),W(async(req,res)=>{const a=req.acct,s=req.body?.status;if(!ORDER_ST.includes(s))throw err('Unknown status');const c=await pool.connect();let warn=[];try{await c.query('begin');
  const[o]=(await c.query(`select * from orders where id=$2 and ${A} for update`,[a,+req.params.id])).rows;if(!o)throw err('Not found',404);if(o.status===s){await c.query('rollback');return res.json({ok:1})}
  const ls=(await c.query('select product_id,variant_id,qty from order_lines where order_id=$1 and product_id is not null',[o.id])).rows;let applied=o.stock_applied;
  if(LIVE.includes(s)&&!applied){for(const l of ls){const p=await move(c,l,-1);if(p&&p.stock<0)warn.push(`${p.name} is now at ${p.stock}`);else if(p&&p.low)warn.push(`${p.name} is low on stock (${p.stock} left)`)}applied=true}
  if(s==='cancelled'&&applied){for(const l of ls)await move(c,l,1);applied=false}
  if(s==='new'&&applied){for(const l of ls)await move(c,l,1);applied=false}
  await c.query('update orders set status=$2,stock_applied=$3,updated_at=now() where id=$1',[o.id,s,applied]);await c.query('insert into order_log(order_id,client_id,status,note,user_id) values($1,$2,$3,$4,$5)',[o.id,a,s,clean(req.body?.note,500),req.user.id]);await c.query('commit')}catch(e){await c.query('rollback');throw e}finally{c.release()}res.json({ok:1,warn})}));
 r.delete('/orders/:id',...O('delete'),W(async(req,res)=>{const a=req.acct;const[o]=await q(`select * from orders where id=$2 and ${A}`,[a,+req.params.id]);if(!o)throw err('Not found',404);
  if(o.stock_applied){const c=await pool.connect();try{for(const l of await q('select product_id,variant_id,qty from order_lines where order_id=$1 and product_id is not null',[o.id]))await move(c,l,1)}finally{c.release()}}
  await q('delete from orders where id=$1',[o.id]);await logDel(req,'orders',o.id,'Order #'+o.no);res.json({ok:1})}));
 r.get('/orders/export.csv',...O('delete'),W(async(req,res)=>{const os=await orderList(req.acct);const h=['order_no','date','status','company','contact','items','subtotal_incl','shipping','vat','total_excl','total_incl','ship_method','courier','tracking'];
  const rows=os.map(o=>({order_no:o.no,date:o.created_at.toISOString().slice(0,10),status:o.status,company:o.company,contact:o.contact,items:o.lines.map(l=>`${l.qty} x ${l.name}`).join('; '),subtotal_incl:o.subtotal_incl,shipping:o.shipping,vat:o.vat,total_excl:o.total_excl,total_incl:o.total_incl,ship_method:o.ship_method,courier:o.courier,tracking:o.tracking}));
  res.set('Content-Type','text/csv').set('Content-Disposition','attachment; filename="orders.csv"').send('\ufeff'+[h.join(','),...rows.map(x=>h.map(k=>csvEsc(x[k])).join(','))].join('\r\n'))}));
 // ---- projects
 r.get('/projects',...J('read'),W(async(req,res)=>res.json(await q(`select p.*,p.start_date::text start_date,p.due_date::text due_date,c.name company,(select count(*)::int from tasks t where t.project_id=p.id and t.parent_id is null) tasks,(select count(*)::int from tasks t where t.project_id=p.id and t.parent_id is null and t.status='done') done,(select count(*)::int from project_members m where m.project_id=p.id) members from projects p left join crm_companies c on c.id=p.company_id where p.${A} order by p.status='done',lower(p.name)`,[req.acct]))));
 r.get('/projects/:id',...J('read'),W(async(req,res)=>{const a=req.acct,i=+req.params.id;const[p]=await q(`select p.*,p.start_date::text start_date,p.due_date::text due_date,c.name company from projects p left join crm_companies c on c.id=p.company_id where p.id=$2 and p.${A}`,[a,i]);if(!p)throw err('Not found',404);
  p.members=await q(`select m.*,coalesce(u.name,u.email,m.name) display,coalesce(u.email,m.email) mail,m.user_id is not null login from project_members m left join users u on u.id=m.user_id where m.project_id=$2 and m.${A} order by m.id`,[a,i]);
  p.tasks=await q(`select t.*,t.due::text due,(select count(*)::int from task_comments c where c.task_id=t.id) comments from tasks t where t.project_id=$2 and t.${A} order by t.pos,t.id`,[a,i]);
  p.docs=await q(`select id,title,pos,updated_at from project_docs where project_id=$2 and ${A} order by pos,id`,[a,i]);res.json(p)}));
 r.post('/projects',...J('edit'),W(async(req,res)=>{const o=pick('projects',req.body||{});await own('crm_companies',o.company_id,req.acct,'company');const p=await ins('projects',req.acct,o);
  await q('insert into project_members(project_id,client_id,user_id,role) values($1,$2,$3,$4)',[p.id,req.acct,req.user.viewing?null:req.user.id,'Owner']).catch(()=>{});res.json(p)}));
 r.put('/projects/:id',...J('edit'),W(async(req,res)=>{const o=pick('projects',req.body||{},true);await own('crm_companies',o.company_id,req.acct,'company');res.json(await upd('projects',req.acct,+req.params.id,o))}));
 r.delete('/projects/:id',...J('delete'),W(async(req,res)=>{const[x]=await q(`delete from projects where id=$2 and ${A} returning id,name`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);await logDel(req,'projects',x.id,x.name);res.json({ok:1})}));
 // members: {user_id} for an account login, or {name,email} stored only (nobody is emailed).
 r.post('/projects/:id/members',...J('edit'),W(async(req,res)=>{const a=req.acct,pid=+req.params.id;await own('projects',pid,a,'project');const b=req.body||{};const role=clean(b.role,60);
  if(b.user_id){const ok=await q(`select 1 from users where id=$2 and active and ${a?'(client_id=$1 or own_client_id=$1)':"client_id is null and role<>'client' and $1::int is null"}`,[a,+b.user_id]);if(!ok.length)throw err('That login is not part of this account',404);
   if((await q('select 1 from project_members where project_id=$1 and user_id=$2',[pid,+b.user_id])).length)throw err('Already on this project');return res.json((await q('insert into project_members(project_id,client_id,user_id,role) values($1,$2,$3,$4) returning *',[pid,a,+b.user_id,role]))[0])}
  const name=clean(b.name,120);if(!name)throw err('Name is required');res.json((await q('insert into project_members(project_id,client_id,name,email,role) values($1,$2,$3,$4,$5) returning *',[pid,a,name,email(b.email),role]))[0])}));
 r.delete('/projects/:id/members/:mid',...J('edit'),W(async(req,res)=>{await q(`delete from project_members where id=$2 and project_id=$3 and ${A}`,[req.acct,+req.params.mid,+req.params.id]);res.json({ok:1})}));
 // tasks
 const taskLinks=async(o,a,pid)=>{if(o.assignee_id&&!(await q(`select 1 from project_members where id=$2 and project_id=$3 and ${A}`,[a,o.assignee_id,pid])).length)throw err('Assignee must be on this project');
  if(o.parent_id&&!(await q(`select 1 from tasks where id=$2 and project_id=$3 and parent_id is null and ${A}`,[a,o.parent_id,pid])).length)throw err('Parent task not found');};
 r.post('/projects/:id/tasks',...J('edit'),W(async(req,res)=>{const a=req.acct,pid=+req.params.id;await own('projects',pid,a,'project');const o=pick('tasks',req.body||{});await taskLinks(o,a,pid);
  if(!('pos'in(req.body||{})))o.pos=(await q('select coalesce(max(pos),0)+1 n from tasks where project_id=$1',[pid]))[0].n;res.json(await ins('tasks',a,o,{project_id:pid}))}));
 r.put('/tasks/:id',...J('edit'),W(async(req,res)=>{const a=req.acct;const[t]=await q(`select project_id from tasks where id=$2 and ${A}`,[a,+req.params.id]);if(!t)throw err('Not found',404);const o=pick('tasks',req.body||{},true);if(o.parent_id===+req.params.id)throw err('A task cannot be its own parent');await taskLinks(o,a,t.project_id);
  if('status'in o)o.done_at=o.status==='done'?new Date():null;res.json(await upd('tasks',a,+req.params.id,o))}));
 r.delete('/tasks/:id',...J('delete'),W(async(req,res)=>{const[x]=await q(`delete from tasks where id=$2 and ${A} returning id,title`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);await logDel(req,'tasks',x.id,x.title);res.json({ok:1})}));
 r.get('/tasks/:id/comments',...J('read'),W(async(req,res)=>res.json(await q(`select c.*,coalesce(u.name,u.email) author from task_comments c left join users u on u.id=c.user_id where c.task_id=$2 and c.${A} order by c.created_at`,[req.acct,+req.params.id]))));
 r.post('/tasks/:id/comments',...J('edit'),W(async(req,res)=>{await own('tasks',+req.params.id,req.acct,'task');const body=clean(req.body?.body,5000);if(!body)throw err('Write a comment');res.json((await q('insert into task_comments(task_id,client_id,user_id,body) values($1,$2,$3,$4) returning *',[+req.params.id,req.acct,req.user.id,body]))[0])}));
 r.delete('/comments/:id',...J('edit'),W(async(req,res)=>{await q(`delete from task_comments where id=$2 and user_id=$3 and ${A}`,[req.acct,+req.params.id,req.user.id]);res.json({ok:1})}));
 // docs
 r.get('/docs/:id',...J('read'),W(async(req,res)=>{const a=req.acct;const[d]=await q(`select d.*,coalesce(u.name,u.email) editor from project_docs d left join users u on u.id=d.updated_by where d.id=$2 and d.${A}`,[a,+req.params.id]);if(!d)throw err('Not found',404);
  d.files=await q(`select f.id,f.name,f.mime,f.category,'/api/files/'||f.id url,f.mime in('image/png','image/jpeg','image/gif','image/webp') image from doc_files x join files f on f.id=x.file_id where x.doc_id=$2 and x.${A}`,[a,d.id]);res.json(d)}));
 r.post('/projects/:id/docs',...J('edit'),W(async(req,res)=>{const pid=+req.params.id;await own('projects',pid,req.acct,'project');res.json(await ins('project_docs',req.acct,pick('project_docs',req.body||{}),{project_id:pid,updated_by:req.user.id}))}));
 r.put('/docs/:id',...J('edit'),W(async(req,res)=>{const o=pick('project_docs',req.body||{},true);o.updated_by=req.user.id;res.json(await upd('project_docs',req.acct,+req.params.id,o))}));
 r.delete('/docs/:id',...J('delete'),W(async(req,res)=>{const[x]=await q(`delete from project_docs where id=$2 and ${A} returning id,title`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);await logDel(req,'docs',x.id,x.title);res.json({ok:1})}));
 r.post('/docs/:id/files',...J('edit'),W(async(req,res)=>{const a=req.acct;await own('project_docs',+req.params.id,a,'page');await libFile(a,req.body?.file_id);await q('insert into doc_files(doc_id,file_id,client_id) values($1,$2,$3) on conflict do nothing',[+req.params.id,String(req.body.file_id),a]);res.json({ok:1})}));
 r.delete('/docs/:id/files/:fid',...J('edit'),W(async(req,res)=>{await q(`delete from doc_files where doc_id=$2 and file_id=$3 and ${A}`,[req.acct,+req.params.id,req.params.fid]);res.json({ok:1})}));
}
