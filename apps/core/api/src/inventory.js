// Server inventory. The old PHP page (alpha.codegreene.com/bot_admin) just serves /var/lib/bot_admin/index.html,
// an HTML report that the Admin bot writes from the box (push.sh -> install to /var/lib/bot_admin/index.html).
// Here we parse that same report into structured JSON (sections -> paragraphs, lists, tables with rows/cells/links).
// Sources, in order: 1) POST /bot/inventory (Admin pushes html or json), 2) INVENTORY_FILE mounted read-only.
// Each distinct report is kept as a snapshot (sha-deduped) so the app can show "last updated" and history.
import fs from 'fs';import crypto from 'crypto';import {parse} from 'node-html-parser';import {db} from './db.js';
const FILE=process.env.INVENTORY_FILE||'/report/index.html';const SUMMARY=process.env.INVENTORY_SUMMARY||FILE.replace(/index\.html$/,'summary.md');
const ws=s=>s.replace(/[ \t\r\f\v]+/g,' ').replace(/ *\n */g,'\n').trim();
const safeHref=h=>/^(https?:|mailto:|#)/i.test(h||'')?h:null;
function cellOf(el){const links=el.querySelectorAll('a').map(a=>({text:ws(a.querySelectorAll('.sr-only').reduce((t,s)=>t.replace(s.text,''),a.text)),href:safeHref(a.getAttribute('href')),sr:ws(a.querySelector('.sr-only')?.text||'')||undefined})).filter(l=>l.href);
 const c=el.clone();c.querySelectorAll('.sr-only').forEach(s=>s.remove());c.querySelectorAll('br').forEach(b=>b.replaceWith('\n'));
 const strong=c.querySelectorAll('strong,b').map(s=>ws(s.text)).filter(Boolean);return{text:ws(c.text),links,strong:strong.length?strong:undefined};}
function tableOf(t){const head=t.querySelectorAll('thead th').map(th=>ws(th.text));
 const rows=t.querySelectorAll('tbody tr').map(tr=>({status:tr.getAttribute('class')||null,cells:tr.childNodes.filter(n=>n.tagName==='TH'||n.tagName==='TD').map(cellOf)}));
 return{caption:ws(t.querySelector('caption')?.text||''),columns:head,rows};}
export function parseReport(html){const root=parse(html,{blockTextElements:{script:false,style:false}});
 const title=ws(root.querySelector('h1')?.text||'Server inventory');const intro=root.querySelectorAll('header p').map(p=>ws(p.text));
 const sections=root.querySelectorAll('main section').map(s=>{const h=s.querySelector('h2');const blocks=[];
  for(const n of s.querySelectorAll('p,ul,ol,table,h3,div.alert')){if(n.closest('table')!==null&&n.tagName!=='TABLE')continue;if(n.parentNode?.closest?.('ul,ol')&&n.tagName!=='UL')continue;
   if(n.tagName==='TABLE')blocks.push({type:'table',...tableOf(n)});
   else if(n.tagName==='UL'||n.tagName==='OL'){if(n.parentNode?.closest?.('ul,ol'))continue;blocks.push({type:'list',items:n.querySelectorAll(':scope > li').map(cellOf)});}
   else if(n.tagName==='H3')blocks.push({type:'heading',text:ws(n.text)});
   else if(n.closest('li'))continue;else blocks.push({type:n.classList?.contains('alert')||n.closest('.alert')?'alert':'text',...cellOf(n)});}
  return{id:h?.id||s.id||null,title:ws(h?.text||''),blocks};}).filter(s=>s.title||s.blocks.length);
 // Headline numbers for the dashboard cards
 const sv=sections.flatMap(s=>s.blocks).find(b=>b.type==='table'&&/server summary/i.test(b.caption));
 const servers=sv?sv.rows.map(r=>Object.fromEntries(sv.columns.map((c,i)=>[c,r.cells[i]?.text||'']))):[];
 const counts={Active:0,Copy:0,Dead:0};for(const s of sections)for(const b of s.blocks)if(b.type==='table'&&/sites/i.test(b.caption))for(const r of b.rows)if(counts[r.status]!=null)counts[r.status]++;
 return{title,intro,sections,servers,counts};}
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export function storeReport(html,source,summary){const h=sha(html);const ex=db.prepare('select id from inventory_snapshots where sha=?').get(h);if(ex)return{id:ex.id,changed:false};
 const data=parseReport(html);if(summary)data.summary=String(summary).slice(0,200000);
 const r=db.prepare('insert into inventory_snapshots(source,sha,data) values(?,?,?) returning id').get(source,h,JSON.stringify(data));
 db.prepare('delete from inventory_snapshots where id not in (select id from inventory_snapshots order by id desc limit 30)').run();return{id:r.id,changed:true};}
export function syncFromFile(){try{if(!fs.existsSync(FILE))return null;const html=fs.readFileSync(FILE,'utf8');const sm=fs.existsSync(SUMMARY)?fs.readFileSync(SUMMARY,'utf8'):null;
 return storeReport(html,'file:'+FILE+'@'+fs.statSync(FILE).mtime.toISOString(),sm);}catch(e){console.error('inventory sync',e.code||e.message);return null;}}
export function startInventoryWatch(){syncFromFile();setInterval(syncFromFile,60e3).unref();}
const latest=()=>db.prepare('select * from inventory_snapshots order by id desc limit 1').get();
export function inventoryRoutes(r,{W}){
 r.get('/inventory',W(async(req,res)=>{const s=latest();if(!s)return res.json({empty:true});res.json({id:s.id,source:s.source.replace(/^file:.*@/,'report file, modified '),fetched_at:s.fetched_at,...JSON.parse(s.data)})}));
 r.get('/inventory/history',W(async(req,res)=>res.json(db.prepare('select id,source,fetched_at from inventory_snapshots order by id desc').all())));
 r.get('/inventory/summary.md',W(async(req,res)=>{const s=latest();res.type('text/plain').send(s?JSON.parse(s.data).summary||'':'')}));
 r.post('/inventory/refresh',W(async(req,res)=>res.json(syncFromFile()||{error:'Report file not found'})));}
export function inventoryBotRoutes(r,{W,bot}){
 // Admin bot pushes the report directly: {html, summary?}
 r.post('/bot/inventory',bot,W(async(req,res)=>{const html=String(req.body?.html||'');if(html.length<50)return res.status(400).json({error:'Send {html} with the full report'});res.json(storeReport(html,'pushed by bot',req.body?.summary))}));}
