// Blog: posts per website (domain) of the current account, plus site typography (Google Fonts). Server enforces the 'blog' permission.
import React,{useEffect,useState,useCallback,useMemo,useRef} from 'react';import * as T from '@radix-ui/react-tabs';import {toast} from 'sonner';import {motion} from 'motion/react';
import {Newspaper,Plus,Trash2,Eye,History,Type,Copy,Rss,Search,Check,ImagePlus,X} from 'lucide-react';
import {api,fmtDate} from '../lib.js';import {useCan} from '../store.js';import {Card,Table,Badge,Button,Input,Field,Select,Textarea,Sheet,Confirm,PageHead,Empty,SkelRows,cn} from '../ui.jsx';
import Editor,{LibraryPicker} from './Editor.jsx';import GF from '../data/gfonts.json';
const ST={draft:['draft','Draft'],scheduled:['due','Scheduled'],published:['paid','Published']};
const Counter=({v,max,ideal})=>{const n=(v||'').length;return <span className={cn('text-xs num',n>max?'text-over':n>=ideal[0]&&n<=ideal[1]?'text-paid':'text-muted')}>{n}/{max}{n>max?' – too long':n&&n<ideal[0]?' – a bit short':''}</span>};
const slugify=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const local=d=>{if(!d)return '';const x=new Date(d);const p=n=>String(n).padStart(2,'0');return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`};
const when=d=>d?new Date(d).toLocaleString('en-ZA',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
const copy=t=>navigator.clipboard.writeText(t).then(()=>toast.success('Copied'));
// Load Google Fonts for the in-app preview only (app users, not site visitors).
const gfHref=(fs)=>'https://fonts.googleapis.com/css2?'+fs.map(([n,w])=>`family=${encodeURIComponent(n).replace(/%20/g,'+')}:wght@${[...new Set(w)].sort((a,b)=>a-b).join(';')}`).join('&')+'&display=swap';
function useFonts(fs){useEffect(()=>{if(!fs.length)return;const l=document.createElement('link');l.rel='stylesheet';l.href=gfHref(fs);document.head.appendChild(l);return()=>l.remove()},[JSON.stringify(fs)])}
const stack=n=>{const c=GF.find(f=>f[0]===n)?.[1];return `'${n}', ${c==='serif'?'Georgia, serif':c==='monospace'?'monospace':'system-ui, sans-serif'}`};
export default function Blog(){const can=useCan();const[cfg,setCfg]=useState(null);const[dom,setDom]=useState('');const[tab,setTab]=useState('posts');
 useEffect(()=>{api('/blog/config').then(c=>{setCfg(c);setDom(d=>d||c.domains[0]||'')}).catch(e=>toast.error(e.message))},[]);
 if(!cfg)return <SkelRows/>;
 return <div><PageHead title="Blog" sub="Posts and fonts for each of your websites">
  <label className="flex items-center gap-2 text-sm"><span className="text-muted">Website</span><Select value={dom} onChange={e=>setDom(e.target.value)} className="w-56">{cfg.domains.map(d=><option key={d}>{d}</option>)}</Select></label></PageHead>
  {!cfg.domains.length?<Card><Empty icon={Newspaper} title="No websites on this account yet" text="Add a domain first, then you can blog for it."/></Card>:
  <T.Root value={tab} onValueChange={setTab}><T.List aria-label="Blog sections" className="flex gap-6 border-b border-line mb-5">{[['posts','Posts'],['fonts','Fonts'],...(can('blog','delete')?[['log','Delete log']]:[])].map(([k,l])=><T.Trigger key={k} value={k} className="relative py-2.5 text-sm text-muted data-[state=active]:text-ink data-[state=active]:font-medium cursor-pointer">{l}{tab===k&&<motion.span layoutId="blogtab" className="absolute left-0 right-0 -bottom-px h-0.5 bg-grid rounded"/>}</T.Trigger>)}</T.List>
   <T.Content value="posts"><Posts dom={dom} cfg={cfg}/></T.Content><T.Content value="fonts"><Fonts dom={dom}/></T.Content><T.Content value="log"><DelLog/></T.Content></T.Root>}</div>}
function Posts({dom,cfg}){const can=useCan();const[l,setL]=useState(null);const[open,setOpen]=useState(null);
 const load=useCallback(()=>api('/blog/posts?domain='+encodeURIComponent(dom)).then(setL).catch(e=>toast.error(e.message)),[dom]);useEffect(()=>{setL(null);load()},[load]);
 const feed=`${cfg.api}/public/blog/${dom}/`;
 return <><div className="flex flex-wrap items-center gap-2 mb-4">{can('blog','edit')&&<Button onClick={()=>setOpen('new')}><Plus size={16}/>New post</Button>}
  <span className="ml-auto text-xs text-muted flex items-center gap-2"><Rss size={14}/>Public feeds: <a className="text-grid hover:underline" href={feed+'posts.json'} target="_blank" rel="noreferrer">JSON</a> · <a className="text-grid hover:underline" href={feed+'rss.xml'} target="_blank" rel="noreferrer">RSS</a></span></div>
  <Card>{!l?<SkelRows/>:<Table rows={l} rowKey={p=>p.id} onRow={p=>setOpen(p.id)} empty={<Empty icon={Newspaper} title="No posts yet" text={`Write the first post for ${dom}.`}/>}
   cols={[{h:'Title',r:p=><div><div className="font-medium">{p.title}</div><div className="text-xs text-muted">/blog/{p.slug}</div></div>},{h:'Status',r:p=><Badge k={ST[p.status][0]}>{p.status==='scheduled'&&p.live?'Published':ST[p.status][1]}</Badge>},
    {h:'Publish date',hide:1,r:p=>when(p.publish_at)||'—'},{h:'Author',hide:1,r:p=>p.author||'—'},{h:'Updated',hide:1,r:p=>fmtDate(p.updated_at)}]}/>}</Card>
  <PostSheet id={open} dom={dom} cfg={cfg} onClose={()=>setOpen(null)} reload={load} setId={setOpen}/></>}
const blank=d=>({domain:d,title:'',slug:'',excerpt:'',body:'',author:'',categories:'',tags:'',status:'draft',publish_at:'',featured_file_id:'',featured_alt:'',meta_title:'',meta_desc:'',canonical:'',og_title:'',og_desc:'',tw_card:'summary_large_image',schema_type:'BlogPosting'});
function PostSheet({id,dom,cfg,onClose,reload,setId}){const can=useCan();const ed=can('blog','edit');const[f,setF]=useState(blank(dom));const[p,setP]=useState(null);const[tab,setTab]=useState('write');const[busy,setBusy]=useState(false);
 const[dirty,setDirty]=useState(false);const[saved,setSaved]=useState(null);const[pick,setPick]=useState(false);const[del,setDel]=useState(false);const[prev,setPrev]=useState(false);const fr=useRef(f);fr.current=f;
 const fill=x=>{setP(x);setF({...blank(dom),...Object.fromEntries(Object.entries(x).map(([k,v])=>[k,v??''])),categories:(x.categories||[]).join(', '),tags:(x.tags||[]).join(', '),publish_at:local(x.publish_at)});setDirty(false)};
 useEffect(()=>{setTab('write');setSaved(null);if(id==='new'){setP(null);setF(blank(dom));setDirty(false)}else if(id)api('/blog/posts/'+id).then(fill).catch(e=>toast.error(e.message))},[id]);
 const set=k=>e=>{const v=e?.target?e.target.value:e;setF(x=>({...x,[k]:v,...(k==='title'&&!p&&(!x.slug||x.slug===slugify(x.title))?{slug:slugify(v)}:{})}));setDirty(true)};
 const body=b=>{const o={...b};['id','client_id','created_at','updated_at','created_by','updated_by','live','words','featured_url','jsonld','revisions'].forEach(k=>delete o[k]);o.publish_at=o.publish_at?new Date(o.publish_at).toISOString():null;return o};
 const save=(st)=>{setBusy(true);const b=body({...f,...(st?{status:st}:{})});if(st==='published'&&!b.publish_at)b.publish_at=new Date().toISOString();
  api(p?'/blog/posts/'+p.id:'/blog/posts',{method:p?'PUT':'POST',body:b}).then(x=>{toast.success(p?'Saved':'Post created');reload();setSaved(new Date());if(!p){setId(x.id)}else api('/blog/posts/'+x.id).then(fill)}).catch(x=>toast.error(x.message)).finally(()=>setBusy(false))};
 // Autosave every 20 s while editing an existing post (title, excerpt, body only).
 useEffect(()=>{if(!p||!dirty||!ed)return;const t=setTimeout(()=>{const x=fr.current;api('/blog/posts/'+p.id+'?autosave=1',{method:'PUT',body:{title:x.title,excerpt:x.excerpt,body:x.body}}).then(()=>{setSaved(new Date());setDirty(false)}).catch(()=>{})},20000);return()=>clearTimeout(t)},[f,p,dirty]);
 const restore=rid=>api('/blog/revisions/'+rid).then(r=>{setF(x=>({...x,title:r.title,excerpt:r.excerpt||'',body:r.body||''}));setDirty(true);setTab('write');toast.success('Revision loaded. Save to keep it.')}).catch(e=>toast.error(e.message));
 const site='https://'+(f.domain||dom);const url=f.canonical||`${site}/blog/${f.slug||'your-post'}`;const st=f.status;
 const tabs=[['write','Write'],['details','Details'],['seo','SEO & sharing'],...(p?[['history','Revisions']]:[])];
 return <Sheet wide open={!!id} onOpenChange={o=>!o&&onClose()} title={p?p.title:'New post'} desc={<span aria-live="polite">{f.domain}{saved?` · saved ${saved.toLocaleTimeString('en-ZA',{hour:'2-digit',minute:'2-digit'})}`:dirty?' · unsaved changes':''}</span>}
  footer={<>{p&&can('blog','delete')&&<Button v="ghost" className="mr-auto text-over" onClick={()=>setDel(true)}><Trash2 size={15}/>Delete</Button>}<Button v="secondary" onClick={()=>setPrev(true)}><Eye size={15}/>Preview</Button>
   {ed&&<><Button v="secondary" disabled={busy} onClick={()=>save()}>{busy?'Saving…':st==='draft'?'Save draft':'Save'}</Button>{st==='draft'&&<Button disabled={busy} onClick={()=>save('published')}>Publish now</Button>}</>}</>}>
  <T.Root value={tab} onValueChange={setTab}><T.List aria-label="Post sections" className="flex gap-5 border-b border-line mb-5 overflow-x-auto">{tabs.map(([k,l])=><T.Trigger key={k} value={k} className="py-2 text-sm text-muted data-[state=active]:text-ink data-[state=active]:font-medium data-[state=active]:border-b-2 data-[state=active]:border-grid -mb-px whitespace-nowrap cursor-pointer">{l}</T.Trigger>)}</T.List>
  <fieldset disabled={!ed} className="min-w-0">
  <T.Content value="write">
   <Field label="Title *"><Input value={f.title} onChange={set('title')} className="text-lg font-medium" maxLength={200}/></Field>
   <Field label="Excerpt" hint="One or two sentences shown in lists and feeds."><Textarea rows={2} value={f.excerpt} onChange={set('excerpt')} maxLength={600}/></Field>
   <div className="mb-1 text-[13px] font-medium" id="bodylbl">Body</div><Editor value={f.body} onChange={v=>{setF(x=>({...x,body:v}));setDirty(true)}} aiTidy={cfg.ai_tidy}/>
   {!cfg.ai_tidy&&<p className="text-xs text-muted mt-2">“Tidy with AI” switches on once an AI key is added on the server.</p>}
  </T.Content>
  <T.Content value="details"><div className="grid sm:grid-cols-2 gap-x-4">
   <Field label="Website"><Select value={f.domain} onChange={set('domain')}>{cfg.domains.map(d=><option key={d}>{d}</option>)}</Select></Field>
   <Field label="Address (slug)" hint={`${site}/blog/${f.slug||'…'}`}><Input value={f.slug} onChange={e=>set('slug')(slugify(e.target.value))}/></Field>
   <Field label="Status"><Select value={f.status} onChange={set('status')}><option value="draft">Draft (only you see it)</option><option value="scheduled">Scheduled</option><option value="published">Published</option></Select></Field>
   <Field label={st==='scheduled'?'Publish on *':'Publish date'} hint="South African time. Scheduled posts go live on their own at this time."><Input type="datetime-local" value={f.publish_at} onChange={set('publish_at')}/></Field>
   <Field label="Author"><Input value={f.author} onChange={set('author')}/></Field><div/>
   <Field label="Categories" hint="Comma separated, e.g. Model kits, News"><Input value={f.categories} onChange={set('categories')}/></Field>
   <Field label="Tags" hint="Comma separated"><Input value={f.tags} onChange={set('tags')}/></Field></div>
   <div className="text-[13px] font-medium mb-1.5">Featured image</div>
   {f.featured_file_id?<div className="flex gap-4 items-start mb-4"><img src={'/api/files/'+f.featured_file_id} alt={f.featured_alt} className="w-40 h-24 object-cover rounded-lg border border-line"/>
    <div className="flex-1"><Field label="Alt text (for screen readers) *"><Input value={f.featured_alt} onChange={set('featured_alt')} maxLength={300} aria-invalid={!f.featured_alt}/></Field><Button v="ghost" type="button" onClick={()=>{setF(x=>({...x,featured_file_id:'',featured_alt:''}));setDirty(true)}}><X size={14}/>Remove</Button></div></div>
   :<Button v="secondary" type="button" onClick={()=>setPick(true)} className="mb-4"><ImagePlus size={16}/>Choose from Files</Button>}
  </T.Content>
  <T.Content value="seo">
   <Field label={<span className="flex justify-between">Meta title<Counter v={f.meta_title||f.title} max={60} ideal={[30,60]}/></span>} hint="Leave empty to use the post title."><Input value={f.meta_title} onChange={set('meta_title')} placeholder={f.title}/></Field>
   <Field label={<span className="flex justify-between">Meta description<Counter v={f.meta_desc||f.excerpt} max={160} ideal={[70,160]}/></span>} hint="Leave empty to use the excerpt."><Textarea rows={2} value={f.meta_desc} onChange={set('meta_desc')} placeholder={f.excerpt}/></Field>
   <Field label="Canonical URL" hint={`Only if this post first appeared elsewhere. Default: ${site}/blog/${f.slug||'…'}`}><Input value={f.canonical} onChange={set('canonical')} placeholder="https://"/></Field>
   <div className="grid sm:grid-cols-2 gap-x-4"><Field label="Social title (Open Graph)"><Input value={f.og_title} onChange={set('og_title')} placeholder={f.meta_title||f.title}/></Field>
    <Field label="Twitter / X card"><Select value={f.tw_card} onChange={set('tw_card')}><option value="summary_large_image">Large image</option><option value="summary">Small summary</option></Select></Field></div>
   <Field label="Social description"><Textarea rows={2} value={f.og_desc} onChange={set('og_desc')} placeholder={f.meta_desc||f.excerpt}/></Field>
   <Field label="Schema.org type" hint="BlogPosting suits most posts; Article for guides; NewsArticle for news."><Select value={f.schema_type} onChange={set('schema_type')}><option>BlogPosting</option><option>Article</option><option>NewsArticle</option></Select></Field>
   <div className="text-[13px] font-medium mb-1.5">Google preview</div><Card className="p-4 mb-4"><div className="text-xs text-[#202124]">{site.replace('https://','')} › blog › {f.slug}</div><div className="text-[18px] text-[#1a0dab] leading-snug truncate">{(f.meta_title||f.title||'Post title').slice(0,60)}</div><div className="text-[13px] text-[#4d5156] line-clamp-2">{(f.meta_desc||f.excerpt||'Add a meta description…').slice(0,160)}</div></Card>
   {p?.jsonld&&<details className="text-xs"><summary className="cursor-pointer text-muted mb-2">Structured data (JSON-LD) search engines read</summary><pre className="bg-slate-50 border border-line rounded-lg p-3 overflow-auto max-h-64">{JSON.stringify(p.jsonld,null,2)}</pre></details>}
  </T.Content>
  {p&&<T.Content value="history">{!p.revisions?.length?<p className="text-muted">No revisions yet.</p>:<ul className="divide-y divide-line">{p.revisions.map(r=><li key={r.id} className="flex items-center gap-3 py-2.5"><History size={15} className="text-muted"/><span className="flex-1"><span className="font-medium">{when(r.at)}</span> <span className="text-muted">· {r.kind==='autosave'?'autosave':'saved'}{r.who?' by '+r.who:''} · {r.title}</span></span>{ed&&<Button v="secondary" type="button" onClick={()=>restore(r.id)}>Load</Button>}</li>)}</ul>}</T.Content>}
  </fieldset></T.Root>
  <LibraryPicker open={pick} onClose={()=>setPick(false)} onPick={x=>{setPick(false);setF(v=>({...v,featured_file_id:x.id,featured_alt:x.alt}));setDirty(true)}}/>
  <Preview open={prev} onClose={()=>setPrev(false)} f={f} url={url}/>
  <DelPost open={del} setOpen={setDel} p={p} onDone={()=>{reload();onClose()}}/>
 </Sheet>}
function Preview({open,onClose,f,url}){const[t,setT]=useState(null);useEffect(()=>{if(open)api('/blog/typography?domain='+encodeURIComponent(f.domain)).then(setT).catch(()=>setT(null))},[open,f.domain]);
 useFonts(open&&t?[[t.heading_font,t.heading_weights],[t.body_font,t.body_weights]]:[]);
 return <Sheet wide open={open} onOpenChange={o=>!o&&onClose()} title="Preview" desc={url}>
  <article className="max-w-[680px] mx-auto" style={t?{fontFamily:stack(t.body_font)}:undefined}>
   {f.featured_file_id&&<img src={'/api/files/'+f.featured_file_id} alt={f.featured_alt} className="w-full rounded-xl mb-6 aspect-[1200/630] object-cover"/>}
   <h1 className="text-3xl font-semibold tracking-tight mb-2" style={t?{fontFamily:stack(t.heading_font),fontWeight:Math.max(...t.heading_weights)}:undefined}>{f.title||'Untitled'}</h1>
   <p className="text-sm text-muted mb-6">{f.author&&<>By {f.author} · </>}{f.publish_at?when(f.publish_at):'Not published yet'}</p>
   <div className={cn('pg-prose',t&&'[&_h2]:[font-family:var(--hf)] [&_h3]:[font-family:var(--hf)] [&_h4]:[font-family:var(--hf)]')} style={t?{'--hf':stack(t.heading_font)}:undefined} dangerouslySetInnerHTML={{__html:f.body||'<p><em>Nothing written yet.</em></p>'}}/>
  </article></Sheet>}
function DelPost({open,setOpen,p,onDone}){const[r,setR]=useState('');return <Confirm open={open} onOpenChange={setOpen} danger title={`Delete “${p?.title}”?`} body="This removes the post and its revisions. It is recorded in the delete log." action="Delete"
 onConfirm={()=>api('/blog/posts/'+p.id+(r?'?reason='+encodeURIComponent(r):''),{method:'DELETE'}).then(()=>{toast.success('Deleted');setOpen(false);onDone()}).catch(x=>toast.error(x.message))}><div className="mt-4"><Field label="Reason (optional)"><Input value={r} onChange={e=>setR(e.target.value)}/></Field></div></Confirm>}
function DelLog(){const[l,setL]=useState(null);useEffect(()=>{api('/blog/deletions').then(setL).catch(e=>toast.error(e.message))},[]);
 return <Card>{!l?<SkelRows/>:<Table rows={l} rowKey={x=>x.id} empty={<Empty title="Nothing deleted"/>} cols={[{h:'Post',r:x=>x.label},{h:'Deleted',r:x=>when(x.deleted_at)},{h:'By',r:x=>x.who||'—'},{h:'Reason',hide:1,r:x=>x.reason||'—'}]}/>}</Card>}
// ---------- Fonts
function FontPick({label,value,onChange,id}){const[q,setQ]=useState('');const[open,setOpen]=useState(false);const[cat,setCat]=useState('');
 const list=useMemo(()=>{const s=q.trim().toLowerCase();return GF.filter(f=>(!cat||f[1]===cat)&&(!s||f[0].toLowerCase().includes(s))).slice(0,60)},[q,cat]);
 return <div className="relative mb-4"><label htmlFor={id} className="block text-[13px] font-medium mb-1.5">{label}</label>
  <div className="flex gap-2"><div className="relative flex-1"><Search size={15} className="absolute left-3 top-3 text-muted"/><Input id={id} role="combobox" aria-expanded={open} aria-controls={id+'-l'} aria-autocomplete="list" className="pl-9" value={open?q:value} placeholder="Search 1,900+ Google Fonts" onFocus={()=>{setOpen(true);setQ('')}} onChange={e=>{setQ(e.target.value);setOpen(true)}} onBlur={()=>setTimeout(()=>setOpen(false),150)} onKeyDown={e=>{if(e.key==='Escape')setOpen(false);if(e.key==='Enter'&&list[0]){e.preventDefault();onChange(list[0][0]);setOpen(false)}}}/></div>
   <Select value={cat} onChange={e=>setCat(e.target.value)} aria-label={label+' category'} className="w-36"><option value="">All styles</option><option value="sans-serif">Sans serif</option><option value="serif">Serif</option><option value="display">Display</option><option value="handwriting">Handwriting</option><option value="monospace">Monospace</option></Select></div>
  {open&&<motion.ul initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}} id={id+'-l'} role="listbox" aria-label={label} className="absolute z-20 mt-1 w-full max-h-72 overflow-auto bg-white border border-line rounded-lg shadow-xl p-1">
   {list.map(f=><li key={f[0]} role="option" aria-selected={f[0]===value}><button type="button" onMouseDown={e=>e.preventDefault()} onClick={()=>{onChange(f[0]);setOpen(false)}} className="w-full flex justify-between items-center px-3 h-9 rounded-md hover:bg-slate-50 text-left cursor-pointer"><span>{f[0]}</span><span className="text-xs text-muted">{f[1]} · {f[2].length} weights{f[0]===value&&<Check size={13} className="inline ml-1 text-grid"/>}</span></button></li>)}
   {!list.length&&<li className="p-3 text-muted text-sm">No font matches.</li>}</motion.ul>}</div>}
function Weights({font,value,onChange,label}){const f=GF.find(x=>x[0]===font);if(!f)return null;return <fieldset className="mb-5"><legend className="text-[13px] font-medium mb-1.5">{label}</legend><div className="flex flex-wrap gap-1.5">{f[2].map(w=>{const on=value.includes(w);return <button key={w} type="button" aria-pressed={on} onClick={()=>onChange(on?value.filter(x=>x!==w):[...value,w].sort((a,b)=>a-b))} className={cn('h-8 px-3 rounded-full border text-[13px] num transition cursor-pointer',on?'bg-grid text-white border-grid':'border-line hover:bg-slate-50')}>{w}</button>})}</div></fieldset>}
function Fonts({dom}){const can=useCan();const ed=can('blog','edit');const[t,setT]=useState(null);const[busy,setBusy]=useState(false);
 useEffect(()=>{setT(null);api('/blog/typography?domain='+encodeURIComponent(dom)).then(setT).catch(e=>toast.error(e.message))},[dom]);
 useFonts(t?[[t.heading_font,t.heading_weights],[t.body_font,t.body_weights]]:[]);
 if(!t)return <SkelRows/>;const set=k=>v=>setT(x=>({...x,[k]:v,...(k.endsWith('_font')?{[k.replace('font','weights')]:(GF.find(f=>f[0]===v)?.[2]||[400]).filter(w=>[400,600,700].includes(w)).slice(0,3)}:{})}));
 const save=()=>{setBusy(true);api('/blog/typography',{method:'PUT',body:{domain:dom,heading_font:t.heading_font,body_font:t.body_font,heading_weights:t.heading_weights,body_weights:t.body_weights,self_host:t.self_host}})
  .then(x=>{setT(x);x.warn?toast.error('Saved, but fonts could not be downloaded: '+x.warn):toast.success(x.self_host?`Saved. ${x.files} font files stored on our server.`:'Saved')}).catch(e=>toast.error(e.message)).finally(()=>setBusy(false))};
 const hw=Math.max(...(t.heading_weights.length?t.heading_weights:[700]));
 return <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6"><Card className="p-5"><fieldset disabled={!ed}>
  <FontPick id="hf" label="Heading font" value={t.heading_font} onChange={set('heading_font')}/><Weights font={t.heading_font} value={t.heading_weights} onChange={set('heading_weights')} label="Heading weights"/>
  <FontPick id="bf" label="Body font" value={t.body_font} onChange={set('body_font')}/><Weights font={t.body_font} value={t.body_weights} onChange={set('body_weights')} label="Body weights"/>
  <fieldset className="mb-5"><legend className="text-[13px] font-medium mb-1.5">How visitors get the fonts</legend>
   <label className="flex gap-3 items-start p-3 rounded-lg border border-line mb-2 cursor-pointer has-[:checked]:border-grid has-[:checked]:bg-grid/5"><input type="radio" name="sh" checked={t.self_host} onChange={()=>setT({...t,self_host:true})} className="mt-1"/><span><b>Self-hosted (recommended)</b><span className="block text-xs text-muted">Font files are copied onto the website. Visitors never contact Google, so no extra cookie or privacy notice is needed.</span></span></label>
   <label className="flex gap-3 items-start p-3 rounded-lg border border-line cursor-pointer has-[:checked]:border-grid has-[:checked]:bg-grid/5"><input type="radio" name="sh" checked={!t.self_host} onChange={()=>setT({...t,self_host:false})} className="mt-1"/><span><b>Google Fonts CDN</b><span className="block text-xs text-muted">Simpler, but each visitor's IP address goes to Google. The privacy policy must mention it (POPIA / EU rules).</span></span></label></fieldset>
  {ed&&<Button onClick={save} disabled={busy||!t.heading_weights.length||!t.body_weights.length}><Type size={16}/>{busy?'Saving and downloading fonts…':'Save fonts'}</Button>}</fieldset></Card>
  <div className="space-y-4"><Card className="p-6 overflow-hidden" aria-label="Live preview"><div className="text-xs text-muted mb-3">Live preview · {dom}</div>
   <motion.div key={t.heading_font+t.body_font} initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} transition={{duration:.3}}>
   <h2 style={{fontFamily:stack(t.heading_font),fontWeight:hw}} className="text-3xl leading-tight mb-3">Build the model you've always wanted</h2>
   <h3 style={{fontFamily:stack(t.heading_font),fontWeight:hw}} className="text-xl mb-2">New arrivals this week</h3>
   <p style={{fontFamily:stack(t.body_font)}} className="text-[15px] leading-relaxed">From 1:24 scale cars to detailed aircraft kits, every product is checked before it ships. <b style={{fontWeight:Math.max(...t.body_weights)}}>Free collection</b> in store, or courier anywhere in South Africa.</p></motion.div></Card>
   {t.snippet&&<Card className="p-5"><div className="flex items-center justify-between mb-2"><b className="text-sm">Code for the website</b>{t.self_host&&<span className="text-xs text-muted">{t.built_at?'Fonts built '+when(t.built_at):'Save to download the fonts'}</span>}</div>
    <Snip label="In the page <head>" text={t.snippet.html}/><Snip label="CSS variables (already used by the Planet Grid site template)" text={t.snippet.css}/>
    {t.self_host&&<Snip label="Copy the font files into the site's /fonts folder (on the server)" text={`/srv/apps/sites/_template/tools/pull-fonts.sh ${dom} /srv/apps/sites/<site-folder>`}/>}
    {t.snippet.warning&&<p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5">{t.snippet.warning}</p>}</Card>}</div></div>}
const Snip=({label,text})=><div className="mb-3"><div className="flex justify-between items-center text-xs text-muted mb-1">{label}<button type="button" onClick={()=>copy(text)} className="inline-flex items-center gap-1 text-grid hover:underline cursor-pointer" aria-label={'Copy: '+label}><Copy size={12}/>Copy</button></div><pre className="text-xs bg-slate-50 border border-line rounded-lg p-2.5 overflow-auto whitespace-pre-wrap break-all">{text}</pre></div>;
