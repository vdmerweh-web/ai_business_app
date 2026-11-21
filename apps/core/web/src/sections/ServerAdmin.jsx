import React,{useEffect,useMemo,useState} from 'react';import {RefreshCw,Search,ServerCog,Activity,Copy as CopyIcon,Skull,ExternalLink,MessageSquare,LayoutDashboard,FileText} from 'lucide-react';
import {api,post,when} from '../lib.js';import Chat from '../Chat.jsx';
const TABS=[{id:'',name:'Overview',icon:LayoutDashboard},{id:'report',name:'Full report',icon:FileText},{id:'chat',name:'Chat with Admin',icon:MessageSquare}];
export default function ServerAdmin({section,path,go}){const tab=path.split('/')[2]||'';const [inv,setInv]=useState(null);const [err,setErr]=useState('');const [busy,setBusy]=useState(false);
 const load=()=>api('/inventory').then(setInv).catch(e=>setErr(e.message));useEffect(()=>{load()},[]);
 const refresh=async()=>{setBusy(true);try{await post('/inventory/refresh');await load()}catch(e){setErr(e.message)}setBusy(false)};
 const onKey=(e,i)=>{const n=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!n)return;e.preventDefault();const t=TABS[(i+n+TABS.length)%TABS.length];go('/server-admin'+(t.id?'/'+t.id:''));setTimeout(()=>document.getElementById('tab-'+(t.id||'overview'))?.focus());};
 return <div className="max-w-[1500px] mx-auto">
  <div className="rise flex flex-wrap items-end gap-4 justify-between">
   <div><h1 className="text-3xl font-semibold tracking-tight">{section.name}</h1><p className="text-slate-600 mt-1">{section.description}.</p></div>
   {inv&&!inv.empty&&<div className="flex items-center gap-3 text-sm text-slate-600"><span>Updated {when(inv.fetched_at)}</span>
    <button onClick={refresh} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 hover:border-brand-600 hover:text-brand-700 transition-colors"><RefreshCw size={16} className={busy?'animate-spin':''} aria-hidden/>Check for a new report</button></div>}
  </div>
  <div role="tablist" aria-label="Server Admin views" className="mt-6 flex gap-1 border-b border-slate-200">
   {TABS.map((t,i)=>{const on=tab===t.id;const I=t.icon;return <button key={t.id} id={'tab-'+(t.id||'overview')} role="tab" aria-selected={on} aria-controls="sa-panel" tabIndex={on?0:-1} onKeyDown={e=>onKey(e,i)}
    onClick={()=>go('/server-admin'+(t.id?'/'+t.id:''))} className={`relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${on?'text-brand-700':'text-slate-600 hover:text-slate-900'}`}>
    <I size={16} aria-hidden/>{t.name}<span className={`absolute left-2 right-2 -bottom-px h-0.5 rounded bg-brand-600 transition-transform origin-left ${on?'scale-x-100':'scale-x-0'}`}/></button>})}
  </div>
  <section id="sa-panel" role="tabpanel" aria-labelledby={'tab-'+(tab||'overview')} className="mt-6">
   {err&&<p role="alert" className="rounded-xl bg-red-50 text-red-800 px-4 py-3">{err}</p>}
   {tab==='chat'?<Chat section="server-admin" bot={section.bot}/>:!inv?<p role="status" className="text-slate-500">Loading inventory…</p>:inv.empty?<Empty refresh={refresh}/>:tab==='report'?<Report inv={inv}/>:<Overview inv={inv} go={go}/>}
  </section></div>;}
function Empty({refresh}){return <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center"><p className="font-medium">No inventory report yet.</p><p className="text-slate-600 mt-1">The Admin bot publishes it; it appears here automatically.</p><button onClick={refresh} className="mt-4 rounded-xl bg-brand-900 text-white px-4 py-2">Check now</button></div>;}
const STAT={Active:['bg-brand-50 text-brand-700 ring-brand-600/20',Activity],Copy:['bg-amber-50 text-amber-800 ring-amber-600/20',CopyIcon],Dead:['bg-slate-100 text-slate-700 ring-slate-500/20',Skull],down:['bg-red-50 text-red-800 ring-red-600/20',Activity]};
function Overview({inv,go}){const c=inv.counts||{};
 return <div className="space-y-8">
  <ul className="grid gap-4 sm:grid-cols-3" aria-label="Sites by status">{['Active','Copy','Dead'].map((k,i)=>{const [cls,I]=STAT[k];return <li key={k} style={{animationDelay:i*70+'ms'}} className="rise rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:shadow-md transition-shadow">
   <div className={`inline-flex rounded-xl p-2 ring-1 ${cls}`}><I size={20} aria-hidden/></div><p className="mt-3 text-3xl font-semibold">{c[k]??0}</p><p className="text-slate-600">{k} sites</p></li>})}</ul>
  <div><h2 className="text-xl font-semibold">Servers</h2>
   <ul className="mt-4 grid gap-4 lg:grid-cols-3">{inv.servers.map((s,i)=>{const vuln=/VULNERABLE/i.test(s['php2shell status']||'');
    return <li key={i} style={{animationDelay:i*80+'ms'}} className="rise rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
     <div className="flex items-center gap-3"><ServerCog className="text-brand-600" aria-hidden/><h3 className="text-lg font-semibold">{s.Server}</h3><span className="text-slate-500 text-sm">{s.IP}</span>
      <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${vuln?'bg-red-50 text-red-800 ring-red-600/20':'bg-brand-50 text-brand-700 ring-brand-600/20'}`}>{vuln?'Needs attention':'OK'}</span></div>
     <dl className="mt-4 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-2 text-sm">{Object.entries(s).filter(([k])=>!['Server','IP'].includes(k)).map(([k,v])=><React.Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="whitespace-pre-line break-words">{v||'—'}</dd></React.Fragment>)}</dl></li>})}</ul></div>
  <div><h2 className="text-xl font-semibold">In the report</h2><ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{inv.sections.map(s=><li key={s.id}>
   <a href={'/server-admin/report#'+s.id} onClick={e=>{e.preventDefault();go('/server-admin/report');setTimeout(()=>{const el=document.getElementById(s.id);el?.scrollIntoView();el?.focus()},50)}} className="block rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200 hover:ring-brand-600 transition">{s.title}</a></li>)}</ul></div>
 </div>;}
function Report({inv}){const [q,setQ]=useState('');
 return <div className="space-y-10">
  {inv.intro?.map((p,i)=><p key={i} className="text-slate-700 max-w-3xl">{p}</p>)}
  <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-slate-50/90 backdrop-blur"><label htmlFor="inv-q" className="sr-only">Filter all tables</label>
   <div className="relative max-w-md"><Search size={16} className="absolute left-3 top-3 text-slate-400" aria-hidden/><input id="inv-q" type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Filter rows in every table (domain, server, status…)" className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2"/></div></div>
  {inv.sections.map(s=><section key={s.id} aria-labelledby={s.id} className="rise">
   <h2 id={s.id} tabIndex={-1} className="text-xl font-semibold scroll-mt-20">{s.title}</h2>
   <div className="mt-3 space-y-4">{s.blocks.map((b,i)=><Block key={i} b={b} q={q}/>)}</div></section>)}
 </div>;}
function Rich({c}){if(!c)return null;const lines=c.text.split('\n');
 return lines.map((ln,i)=>{let parts=[ln];for(const l of c.links||[]){parts=parts.flatMap(p=>typeof p!=='string'||!l.text||!p.includes(l.text)?[p]:p.split(l.text).flatMap((x,j,a)=>j<a.length-1?[x,<a key={l.href+j} href={l.href} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline decoration-brand-600/40 hover:decoration-brand-600 inline-flex items-center gap-0.5">{l.text}<ExternalLink size={11} aria-hidden/><span className="sr-only"> {l.sr||'(opens in new tab)'}</span></a>]:[x]))}
  return <React.Fragment key={i}>{parts}{i<lines.length-1&&<br/>}</React.Fragment>});}
function Block({b,q}){if(b.type==='heading')return <h3 className="font-semibold text-lg">{b.text}</h3>;
 if(b.type==='list')return <ul className="list-disc pl-6 space-y-1 max-w-4xl">{b.items.map((it,i)=><li key={i}><Rich c={it}/></li>)}</ul>;
 if(b.type==='alert')return <div role="note" className="rounded-xl border-l-4 border-red-600 bg-red-50 px-4 py-3 max-w-4xl"><Rich c={b}/></div>;
 if(b.type==='text')return <p className="max-w-4xl text-slate-700"><Rich c={b}/></p>;
 return <Table t={b} q={q}/>;}
function Table({t,q}){const ql=q.trim().toLowerCase();const rows=useMemo(()=>ql?t.rows.filter(r=>r.cells.some(c=>c.text.toLowerCase().includes(ql))):t.rows,[t,ql]);
 return <figure className="rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm overflow-hidden">
  <div className="overflow-x-auto max-h-[70vh]" tabIndex={0} role="region" aria-label={`${t.caption} (scrollable table)`}>
  <table className="min-w-full text-sm"><caption className="text-left px-4 py-3 font-semibold bg-slate-50 border-b border-slate-200">{t.caption}{ql&&<span className="font-normal text-slate-500"> · showing {rows.length} of {t.rows.length}</span>}</caption>
   <thead><tr>{t.columns.map((c,i)=><th key={i} scope="col" className="sticky top-0 bg-brand-900 text-white text-left font-medium px-3 py-2 whitespace-nowrap">{c}</th>)}</tr></thead>
   <tbody>{rows.map((r,i)=><tr key={i} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">{r.cells.map((c,j)=>{const T=j===0?'th':'td';const isStat=STAT[c.text]&&t.columns[j]==='Status';
    return <T key={j} scope={j===0?'row':undefined} className={`px-3 py-2 align-top text-left ${j===0?'font-medium':''} ${j===0&&r.status&&STAT[r.status]?'border-l-4 '+(r.status==='Active'?'border-brand-600':r.status==='Copy'?'border-amber-500':'border-slate-400'):''}`}>
     {isStat?<span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STAT[c.text][0]}`}>{c.text}</span>:<Rich c={c}/>}</T>})}</tr>)}
   {!rows.length&&<tr><td colSpan={t.columns.length} className="px-3 py-6 text-center text-slate-500">No rows match “{q}”.</td></tr>}</tbody></table></div></figure>;}
