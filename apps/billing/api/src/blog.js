// Blog (posts per account + website) and site typography (Google Fonts, self-hosted by default).
// acct = req.user.client_id (portal / company switcher) or null (Planet Grid's own). Record type: blog. Flag: clients.blog_enabled / settings blog_enabled.
import {q} from './db.js';import fs from 'fs';import path from 'path';import crypto from 'crypto';import sanitizeHtml from 'sanitize-html';
import {createRequire} from 'module';const GF=createRequire(import.meta.url)('./gfonts.json');const GFM=new Map(GF.map(f=>[f[0],f]));
const DIR=process.env.UPLOAD_DIR||'/data/uploads';const FDIR=path.join(DIR,'fonts');
const err=(m,s=400)=>Object.assign(new Error(m),{status:s});const A='client_id is not distinct from $1';const acct=req=>req.user.client_id||null;
const clean=(v,n=200)=>v==null||v===''?null:String(v).trim().slice(0,n)||null;
const PG_DOMAIN='planet-grid.com';const STATUS=['draft','scheduled','published'];
// ---------- HTML sanitising (XSS + Word/Docs junk). The editor already cleans pastes; this is the server-side guarantee.
const YT=/^https:\/\/(www\.)?(youtube-nocookie\.com|youtube\.com)\/embed\/[A-Za-z0-9_-]{6,20}(\?[^"'<>\s]*)?$/;
export function sanitize(html){return sanitizeHtml(String(html||'').slice(0,400000).replace(/<!--[\s\S]*?-->/g,''),{
 allowedTags:['h2','h3','h4','p','br','strong','b','em','i','u','s','a','ul','ol','li','blockquote','code','pre','hr','img','figure','figcaption','table','thead','tbody','tr','th','td','iframe','div'],
 allowedAttributes:{a:['href','title','rel','target'],img:['src','alt','title','width','height','loading'],th:['colspan','rowspan','scope'],td:['colspan','rowspan'],iframe:['src','width','height','title','allowfullscreen','allow','frameborder'],div:['data-youtube-video'],ol:['start'],code:['class'],pre:['class']},
 allowedClasses:{code:[/^language-[a-z0-9-]+$/],pre:[/^language-[a-z0-9-]+$/]},
 allowedSchemes:['https','http','mailto','tel'],allowedSchemesByTag:{img:['https','http']},allowProtocolRelative:false,
 transformTags:{h1:'h2',h5:'h4',h6:'h4',b:'strong',i:'em',a:(t,a)=>({tagName:'a',attribs:{...a,...(a.target==='_blank'?{rel:'noopener noreferrer'}:{})}})},
 exclusiveFilter:f=>(f.tag==='iframe'&&!YT.test(f.attribs.src||''))||(f.tag==='img'&&!/^(\/api\/files\/[0-9a-f]{32}|https?:\/\/)/.test(f.attribs.src||''))||(f.tag==='p'&&!f.text.replace(/\u00a0/g,'').trim()&&!f.mediaChildren?.length),
 nonTextTags:['style','script','textarea','option','noscript','title','xml'],
}).replace(/(<p>\s*<\/p>\s*)+/g,'')}
const fileIdsIn=h=>[...new Set([...String(h||'').matchAll(/\/api\/files\/([0-9a-f]{32})/g)].map(m=>m[1]))];
// Public copy: library image URLs become public media URLs for this domain.
const pubHtml=(h,dom)=>String(h||'').replace(/\/api\/files\/([0-9a-f]{32})/g,`${API}/public/blog/${dom}/media/$1`);
const API=process.env.PUBLIC_API||'https://api.planet-grid.com';
const words=h=>String(h||'').replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
const slugify=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,120);
const tagList=v=>[...new Set((Array.isArray(v)?v:String(v||'').split(',')).map(t=>String(t).trim().slice(0,40)).filter(Boolean))].slice(0,30);
const isLive=p=>(p.status==='published'||p.status==='scheduled')&&p.publish_at&&new Date(p.publish_at)<=new Date();
export function blogJsonld(p,site){const url=p.canonical||`${site}/blog/${p.slug}`;const img=p.featured_file_id?`${API}/public/blog/${p.domain}/media/${p.featured_file_id}`:undefined;
 return JSON.parse(JSON.stringify({'@context':'https://schema.org','@type':p.schema_type||'BlogPosting',headline:(p.meta_title||p.title).slice(0,110),description:p.meta_desc||p.excerpt||undefined,image:img?[img]:undefined,
  datePublished:p.publish_at||undefined,dateModified:p.updated_at||undefined,author:p.author?{'@type':'Person',name:p.author}:undefined,publisher:{'@type':'Organization',name:p.domain,url:site},
  mainEntityOfPage:{'@type':'WebPage','@id':url},url,keywords:[...(p.tags||[]),...(p.categories||[])].join(', ')||undefined,articleSection:p.categories?.[0],wordCount:words(p.body)}))}
export async function blogInit(){await q(`
 alter table clients add column if not exists blog_enabled boolean not null default false; insert into settings values('blog_enabled','true') on conflict do nothing;
 create table if not exists blog_posts(id serial primary key,client_id int references clients,domain text not null,title text not null,slug text not null,excerpt text,body text not null default '',
  featured_file_id text references files on delete set null,featured_alt text,categories text[] not null default '{}',tags text[] not null default '{}',author text,
  status text not null default 'draft' check(status in('draft','scheduled','published')),publish_at timestamptz,meta_title text,meta_desc text,canonical text,og_title text,og_desc text,
  tw_card text not null default 'summary_large_image',schema_type text not null default 'BlogPosting',created_by int,updated_by int,created_at timestamptz default now(),updated_at timestamptz default now());
 create unique index if not exists blog_slug on blog_posts(coalesce(client_id,0),lower(domain),slug);create index if not exists blog_pub on blog_posts(lower(domain),status,publish_at);
 create table if not exists blog_revisions(id serial primary key,post_id int not null references blog_posts on delete cascade,client_id int,kind text not null default 'save',title text,excerpt text,body text,user_id int,at timestamptz default now());
 create index if not exists blog_rev_post on blog_revisions(post_id,at desc);
 create table if not exists site_typography(id serial primary key,client_id int references clients,domain text not null,heading_font text not null default 'Inter',body_font text not null default 'Inter',
  heading_weights int[] not null default '{600,700}',body_weights int[] not null default '{400,700}',self_host boolean not null default true,built_at timestamptz,updated_at timestamptz default now());
 create unique index if not exists site_typo_dom on site_typography(coalesce(client_id,0),lower(domain));
 update clients set blog_enabled=true where ref='PG186' and not blog_enabled;`);}
export async function blogOn(cid){if(cid)return !!(await q('select blog_enabled from clients where id=$1',[cid]))[0]?.blog_enabled;return (await q(`select value from settings where key='blog_enabled'`))[0]?.value!=='false';}
async function domainsFor(a){const d=(await q(`select domain from domains where ${A} and status<>'inactive' order by domain`,[a])).map(r=>r.domain.toLowerCase());return a?d:[...new Set([PG_DOMAIN,...d])];}
async function checkDom(a,v){const d=clean(v,120)?.toLowerCase().replace(/^https?:\/\//,'').replace(/\/.*$/,'');if(!d)throw err('Pick the website for this post');if(!(await domainsFor(a)).includes(d))throw err('That website is not on this account',403);return d;}
async function libFile(a,fid){if(!/^[0-9a-f]{32}$/.test(String(fid)))throw err('Bad file');if(!(await q(`select 1 from files where id=$2 and in_library and ${A}`,[a,String(fid)])).length)throw err('That image is not in your Files library',404);}
// Which account owns a public domain (Planet Grid's own is null).
async function ownerOf(dom){dom=String(dom||'').toLowerCase();if(!/^[a-z0-9.-]{3,120}$/.test(dom))return undefined;if(dom===PG_DOMAIN)return null;const[r]=await q('select client_id from domains where lower(domain)=$1 and status<>\'inactive\' limit 1',[dom]);return r?r.client_id:undefined;}
// ---------- Google Fonts
const fontOk=n=>{const f=GFM.get(String(n||''));if(!f)throw err(`"${n}" is not in the Google Fonts list`);return f};
const wts=(f,v)=>{const w=[...new Set((Array.isArray(v)?v:[]).map(Number))].filter(x=>f[2].includes(x)).sort((a,b)=>a-b).slice(0,6);return w.length?w:[f[2].includes(400)?400:f[2][0]]};
const fam=(f,w)=>`family=${encodeURIComponent(f[0]).replace(/%20/g,'+')}:wght@${w.join(';')}`;
export function gfUrl(t){const fs_=[[t.heading_font,t.heading_weights]];if(t.body_font!==t.heading_font)fs_.push([t.body_font,t.body_weights]);else fs_[0][1]=[...new Set([...t.heading_weights,...t.body_weights])].sort((a,b)=>a-b);
 return 'https://fonts.googleapis.com/css2?'+fs_.map(([n,w])=>fam(GFM.get(n),w)).join('&')+'&display=swap'}
const stack=n=>{const c=GFM.get(n)?.[1];return `'${n}', ${c==='serif'?'Georgia, serif':c==='monospace'?'ui-monospace, monospace':c==='handwriting'?'cursive':'system-ui, sans-serif'}`};
const vars=t=>`:root{--pg-font-heading:${stack(t.heading_font)};--pg-font-body:${stack(t.body_font)};--pg-heading-weight:${Math.max(...t.heading_weights)};--pg-body-weight:${t.body_weights.includes(400)?400:t.body_weights[0]}}\nbody{font-family:var(--pg-font-body);font-weight:var(--pg-body-weight)}\nh1,h2,h3,h4,h5,h6{font-family:var(--pg-font-heading);font-weight:var(--pg-heading-weight)}`;
const tDir=(a,d)=>path.join(FDIR,String(a??'pg'),d.replace(/[^a-z0-9.-]/g,''));
// Download the woff2 files (latin subsets) from Google once, rewrite the CSS to local paths. Visitors never contact Google.
async function buildFonts(a,t){const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
 const r=await fetch(gfUrl(t),{headers:{'User-Agent':UA}});if(!r.ok)throw err('Google Fonts did not answer ('+r.status+'). Try again later.',502);let css=await r.text();
 // keep latin + latin-ext blocks only
 const blocks=css.split(/(?=\/\* [a-z-]+ \*\/)/).filter(b=>/^\/\* (latin|latin-ext) \*\//.test(b)||!/^\/\*/.test(b));css=blocks.join('');
 const dir=tDir(a,t.domain);fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});const map={};let n=0;
 for(const m of css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)){if(map[m[1]])continue;if(++n>60)break;const fr=await fetch(m[1]);if(!fr.ok)throw err('Could not download a font file',502);
  const name=crypto.createHash('sha1').update(m[1]).digest('hex').slice(0,16)+'.woff2';fs.writeFileSync(path.join(dir,name),Buffer.from(await fr.arrayBuffer()));map[m[1]]=name;}
 css=css.replace(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g,(_,u)=>`url(${map[u]})`);
 fs.writeFileSync(path.join(dir,'fonts.css'),`/* Self-hosted Google Fonts for ${t.domain} (SIL OFL). Built ${new Date().toISOString()} */\n${css}\n${vars(t)}\n`);
 await q(`update site_typography set built_at=now() where id=$1`,[t.id]);return Object.keys(map).length;}
function snippet(t){const pub=`${API}/public/fonts/${t.domain}/`;return t.self_host?
 {mode:'self-hosted',html:`<link rel="stylesheet" href="/fonts/fonts.css">`,install:`curl -fsS ${pub}fonts.zip.txt | sh   # or run: /srv/apps/sites/_template/tools/pull-fonts.sh ${t.domain} <site-folder>`,css:vars(t),preview_css_url:pub+'fonts.css'}
 :{mode:'google-cdn',html:`<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="${gfUrl(t).replace(/&/g,'&amp;')}">`,css:vars(t),
  warning:'Google Fonts CDN shares each visitor\'s IP address with Google. Mention Google Fonts in the privacy policy, or switch to self-hosted.'}}
const typoOut=t=>t&&({...t,google_url:gfUrl(t),snippet:snippet(t)});
// ---------- routes
const out=p=>p&&({...p,live:isLive(p),words:words(p.body),featured_url:p.featured_file_id?'/api/files/'+p.featured_file_id:null});
export function blogRoutes(r,{W,need}){
 const B=l=>[W(async(req,res,next)=>{const a=acct(req);if(!(await blogOn(a)))return res.status(403).json({error:'The blog is not enabled for this account'});req.acct=a;next()}),need('blog',l)];
 r.get('/blog/config',...B('read'),W(async(req,res)=>res.json({domains:await domainsFor(req.acct),ai_tidy:!!process.env.AI_API_KEY,api:API})));
 r.get('/blog/posts',...B('read'),W(async(req,res)=>{const d=clean(req.query.domain,120);res.json((await q(`select id,domain,title,slug,excerpt,status,publish_at,author,categories,tags,featured_file_id,featured_alt,updated_at,created_at,body from blog_posts where ${A} and ($2::text is null or lower(domain)=lower($2)) order by coalesce(publish_at,updated_at) desc limit 500`,[req.acct,d])).map(p=>{const o=out(p);delete o.body;return o}))}));
 r.get('/blog/posts/:id(\\d+)',...B('read'),W(async(req,res)=>{const[p]=await q(`select * from blog_posts where id=$2 and ${A}`,[req.acct,+req.params.id]);if(!p)throw err('Not found',404);
  res.json({...out(p),jsonld:blogJsonld(p,'https://'+p.domain),revisions:await q(`select r.id,r.kind,r.at,r.title,u.name who from blog_revisions r left join users u on u.id=r.user_id where post_id=$1 order by at desc limit 50`,[p.id])})}));
 async function fields(req,cur){const b=req.body||{},a=req.acct,o={};
  if(!cur||'domain'in b)o.domain=await checkDom(a,b.domain??cur?.domain);
  if(!cur||'title'in b){o.title=clean(b.title,200);if(!o.title)throw err('Give the post a title');}
  if(!cur||'slug'in b)o.slug=slugify(b.slug||o.title||cur?.title)||('post-'+Date.now());
  if('excerpt'in b)o.excerpt=clean(b.excerpt,600);if('body'in b)o.body=sanitize(b.body);
  if('author'in b)o.author=clean(b.author,120);else if(!cur)o.author=req.user.name||null;
  if('categories'in b)o.categories=tagList(b.categories);if('tags'in b)o.tags=tagList(b.tags);
  for(const[k,n]of[['meta_title',120],['meta_desc',320],['og_title',120],['og_desc',320]])if(k in b)o[k]=clean(b[k],n);
  if('canonical'in b){const x=clean(b.canonical,300);if(x&&!/^https:\/\//.test(x))throw err('Canonical URL must start with https://');o.canonical=x}
  if('tw_card'in b){if(!['summary','summary_large_image'].includes(b.tw_card))throw err('Twitter card: summary or large image');o.tw_card=b.tw_card}
  if('schema_type'in b){if(!['BlogPosting','Article','NewsArticle'].includes(b.schema_type))throw err('Schema type: BlogPosting, Article or NewsArticle');o.schema_type=b.schema_type}
  if('featured_file_id'in b){o.featured_file_id=clean(b.featured_file_id,64);if(o.featured_file_id)await libFile(a,o.featured_file_id)}
  if('featured_alt'in b)o.featured_alt=clean(b.featured_alt,300);
  if('status'in b){if(!STATUS.includes(b.status))throw err('Status: draft, scheduled or published');o.status=b.status}
  if('publish_at'in b){const d=b.publish_at?new Date(b.publish_at):null;if(d&&isNaN(d))throw err('Publish date is not a valid date');o.publish_at=d}
  const m={...cur,...o};if(m.featured_file_id&&!m.featured_alt)throw err('Describe the featured image (alt text) for screen readers');
  for(const f of fileIdsIn(o.body))await libFile(a,f);
  if(m.status==='scheduled'&&(!m.publish_at||new Date(m.publish_at)<=new Date()))throw err('Scheduled posts need a publish date in the future');
  if(m.status==='published'&&!m.publish_at)o.publish_at=new Date();
  return o}
 const rev=(p,kind,uid)=>q('insert into blog_revisions(post_id,client_id,kind,title,excerpt,body,user_id) values($1,$2,$3,$4,$5,$6,$7)',[p.id,p.client_id,kind,p.title,p.excerpt,p.body,uid]);
 const prune=pid=>q(`delete from blog_revisions where post_id=$1 and id not in(select id from blog_revisions where post_id=$1 order by at desc limit 50)`,[pid]);
 r.post('/blog/posts',...B('edit'),W(async(req,res)=>{const o=await fields(req,null);o.created_by=o.updated_by=req.user.id;const ks=Object.keys(o);
  try{const[p]=await q(`insert into blog_posts(client_id${ks.map(k=>','+k).join('')}) values($1${ks.map((_,i)=>',$'+(i+2)).join('')}) returning *`,[req.acct,...ks.map(k=>o[k])]);await rev(p,'save',req.user.id);res.json(out(p))}
  catch(e){if(e.code==='23505')throw err('Another post on this website already uses that address (slug)');throw e}}));
 // PUT ?autosave=1 keeps one rolling autosave revision per user per 10 minutes.
 r.put('/blog/posts/:id(\\d+)',...B('edit'),W(async(req,res)=>{const[cur]=await q(`select * from blog_posts where id=$2 and ${A}`,[req.acct,+req.params.id]);if(!cur)throw err('Not found',404);
  const auto=req.query.autosave==='1';const o=await fields(req,cur);o.updated_by=req.user.id;const ks=Object.keys(o);let p;
  try{[p]=await q(`update blog_posts set ${ks.map((k,i)=>`${k}=$${i+3}`).join(',')},updated_at=now() where id=$2 and ${A} returning *`,[req.acct,cur.id,...ks.map(k=>o[k])])}catch(e){if(e.code==='23505')throw err('Another post on this website already uses that address (slug)');throw e}
  if(auto){const[last]=await q(`select id from blog_revisions where post_id=$1 and kind='autosave' and user_id=$2 and at>now()-interval '10 minutes' order by at desc limit 1`,[p.id,req.user.id]);
   if(last)await q('update blog_revisions set title=$2,excerpt=$3,body=$4,at=now() where id=$1',[last.id,p.title,p.excerpt,p.body]);else await rev(p,'autosave',req.user.id)}
  else if(cur.body!==p.body||cur.title!==p.title||cur.excerpt!==p.excerpt||cur.status!==p.status)await rev(p,'save',req.user.id);await prune(p.id);res.json(out(p))}));
 r.get('/blog/revisions/:id(\\d+)',...B('read'),W(async(req,res)=>{const[x]=await q(`select * from blog_revisions where id=$2 and ${A}`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);res.json(x)}));
 r.delete('/blog/posts/:id(\\d+)',...B('delete'),W(async(req,res)=>{const[x]=await q(`delete from blog_posts where id=$2 and ${A} returning id,title,domain`,[req.acct,+req.params.id]);if(!x)throw err('Not found',404);
  await q('insert into crm_deletions(client_id,kind,record_id,user_id,reason,label) values($1,$2,$3,$4,$5,$6)',[req.acct,'blog_posts',x.id,req.user.id,clean(req.query.reason,200),clean(x.title+' ('+x.domain+')',200)]);res.json({ok:1})}));
 r.get('/blog/deletions',...B('delete'),W(async(req,res)=>res.json(await q(`select d.id,d.label,d.reason,d.deleted_at,u.name who from crm_deletions d left join users u on u.id=d.user_id where d.${A} and d.kind='blog_posts' order by d.deleted_at desc limit 200`,[req.acct]))));
 // "Tidy with AI": disabled unless AI_API_KEY is set (OpenAI-compatible chat completions; AI_API_URL / AI_MODEL optional). Output is sanitised like any other body.
 r.post('/blog/tidy',...B('edit'),W(async(req,res)=>{if(!process.env.AI_API_KEY)return res.status(503).json({error:'Tidy with AI is not switched on yet (no AI key configured).',enabled:false});
  const html=sanitize(req.body?.html);if(html.length>60000)throw err('That is too long to tidy in one go. Tidy a section at a time.');
  const rr=await fetch(process.env.AI_API_URL||'https://api.x.ai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.AI_API_KEY},signal:AbortSignal.timeout(60000),
   body:JSON.stringify({model:process.env.AI_MODEL||'grok-4-fast',temperature:0,messages:[{role:'system',content:'You clean up pasted blog HTML. Keep the author\'s words exactly; do not add, remove or rewrite content. Fix structure only: proper <h2>/<h3> headings, <p> paragraphs, <ul>/<ol> lists, <strong>/<em>, links, tables, images (keep src and alt). Remove leftover styling, spans, empty paragraphs and stray characters. Return only the HTML, no explanation, no code fences.'},{role:'user',content:html}]})});
  if(!rr.ok)throw err('The AI service answered with an error ('+rr.status+')',502);const j=await rr.json();const tidy=sanitize(String(j.choices?.[0]?.message?.content||'').replace(/^```html?\s*|```\s*$/g,''));
  res.json({html:tidy})}));
 // ---- typography
 r.get('/blog/typography',...B('read'),W(async(req,res)=>{const d=await checkDom(req.acct,req.query.domain);const[t]=await q(`select * from site_typography where ${A} and lower(domain)=$2`,[req.acct,d]);
  res.json(typoOut(t||{id:null,domain:d,heading_font:'Inter',body_font:'Inter',heading_weights:[600,700],body_weights:[400,700],self_host:true,built_at:null}))}));
 r.put('/blog/typography',...B('edit'),W(async(req,res)=>{const b=req.body||{};const d=await checkDom(req.acct,b.domain);const hf=fontOk(b.heading_font),bf=fontOk(b.body_font);
  const o=[hf[0],bf[0],wts(hf,b.heading_weights),wts(bf,b.body_weights),b.self_host!==false];
  const[t]=await q(`insert into site_typography(client_id,domain,heading_font,body_font,heading_weights,body_weights,self_host) values($1,$2,$3,$4,$5,$6,$7) on conflict(coalesce(client_id,0),lower(domain)) do update set heading_font=$3,body_font=$4,heading_weights=$5,body_weights=$6,self_host=$7,updated_at=now(),built_at=null returning *`,[req.acct,d,...o]);
  let files=0,warn=null;if(t.self_host){try{files=await buildFonts(req.acct,t);t.built_at=new Date()}catch(e){warn=e.message}}res.json({...typoOut(t),files,warn})}));
}
// ---------- public, read-only (published posts only; no cookies; CORS open for site builds)
export function publicBlogRoutes(r,{W}){
 const cors=(req,res,next)=>{res.set({'Access-Control-Allow-Origin':'*','Cache-Control':'public, max-age=300'});next()};
 const site=async(req)=>{const a=await ownerOf(req.params.domain);if(a===undefined||!(await blogOn(a)))throw err('Not found',404);return{a,dom:req.params.domain.toLowerCase()}};
 const LIVE=`status in('published','scheduled') and publish_at<=now()`;
 const pub=(p,dom)=>({title:p.title,slug:p.slug,url:p.canonical||`https://${dom}/blog/${p.slug}`,excerpt:p.excerpt,author:p.author,categories:p.categories,tags:p.tags,published_at:p.publish_at,updated_at:p.updated_at,
  image:p.featured_file_id?{url:`${API}/public/blog/${dom}/media/${p.featured_file_id}`,alt:p.featured_alt}:null,
  seo:{title:p.meta_title||p.title,description:p.meta_desc||p.excerpt,canonical:p.canonical||`https://${dom}/blog/${p.slug}`,og_title:p.og_title||p.meta_title||p.title,og_description:p.og_desc||p.meta_desc||p.excerpt,twitter_card:p.tw_card},
  jsonld:blogJsonld(p,'https://'+dom)});
 r.get('/public/blog/:domain/posts.json',cors,W(async(req,res)=>{const{a,dom}=await site(req);const rows=await q(`select * from blog_posts where ${A} and lower(domain)=$2 and ${LIVE} order by publish_at desc limit 200`,[a,dom]);res.json({domain:dom,posts:rows.map(p=>pub(p,dom))})}));
 r.get('/public/blog/:domain/posts/:slug.json',cors,W(async(req,res)=>{const{a,dom}=await site(req);const[p]=await q(`select * from blog_posts where ${A} and lower(domain)=$2 and slug=$3 and ${LIVE}`,[a,dom,String(req.params.slug)]);if(!p)throw err('Not found',404);res.json({...pub(p,dom),html:pubHtml(p.body,dom)})}));
 r.get('/public/blog/:domain/rss.xml',cors,W(async(req,res)=>{const{a,dom}=await site(req);const x=s=>String(s??'').replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
  const rows=await q(`select * from blog_posts where ${A} and lower(domain)=$2 and ${LIVE} order by publish_at desc limit 50`,[a,dom]);
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${x(dom)} blog</title><link>https://${x(dom)}/blog</link><description>Posts from ${x(dom)}</description>${rows.map(p=>`<item><title>${x(p.title)}</title><link>${x(p.canonical||`https://${dom}/blog/${p.slug}`)}</link><guid isPermaLink="false">${x(dom)}-post-${p.id}</guid><pubDate>${new Date(p.publish_at).toUTCString()}</pubDate>${p.author?`<author>${x(p.author)}</author>`:''}${p.categories.map(c=>`<category>${x(c)}</category>`).join('')}<description>${x(p.excerpt||'')}</description><content:encoded><![CDATA[${pubHtml(p.body,dom).replace(/]]>/g,']]&gt;')}]]></content:encoded></item>`).join('')}</channel></rss>`)}));
 // Images used by a live post on this domain only.
 r.get('/public/blog/:domain/media/:fid',cors,W(async(req,res)=>{const{a,dom}=await site(req);const fid=req.params.fid;if(!/^[0-9a-f]{32}$/.test(fid))throw err('Not found',404);
  const ok=(await q(`select 1 from blog_posts where ${A} and lower(domain)=$2 and ${LIVE} and (featured_file_id=$3 or position($4 in body)>0) limit 1`,[a,dom,fid,'/api/files/'+fid])).length;
  const[f]=ok?await q(`select mime from files where id=$2 and ${A} and mime like 'image/%'`,[a,fid]):[];if(!f)throw err('Not found',404);
  res.set({'Content-Type':f.mime,'Cache-Control':'public, max-age=86400','Cross-Origin-Resource-Policy':'cross-origin'});fs.createReadStream(path.join(DIR,fid)).on('error',()=>res.status(404).end()).pipe(res)}));
 // Self-hosted font files (served from Planet Grid's server, never from Google).
 r.get('/public/fonts/:domain/:file',cors,W(async(req,res)=>{const a=await ownerOf(req.params.domain);if(a===undefined)throw err('Not found',404);const f=req.params.file;
  const dir=tDir(a,req.params.domain.toLowerCase());
  if(f==='fonts.zip.txt'){const ls=fs.existsSync(dir)?fs.readdirSync(dir):[];if(!ls.length)throw err('Fonts not built yet',404);const base=`${API}/public/fonts/${req.params.domain.toLowerCase()}/`;
   return res.type('text/plain').send(`#!/bin/sh\n# Downloads this site's self-hosted fonts into ./fonts\nset -e\nmkdir -p fonts\n${ls.map(n=>`curl -fsS -o fonts/${n} ${base}${n}`).join('\n')}\n`)}
  if(!/^[a-z0-9]{16}\.woff2$|^fonts\.css$/.test(f))throw err('Not found',404);const p=path.join(dir,f);if(!fs.existsSync(p))throw err('Not found',404);
  res.set({'Content-Type':f.endsWith('.css')?'text/css; charset=utf-8':'font/woff2','Cross-Origin-Resource-Policy':'cross-origin','Cache-Control':'public, max-age=86400'});fs.createReadStream(p).pipe(res)}));
}
