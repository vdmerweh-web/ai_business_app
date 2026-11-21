import React,{useEffect,useRef,useState} from 'react';import {Plus,Send,Paperclip,X,Bot,Loader2,Trash2,AlertCircle} from 'lucide-react';import {api,post,when} from './lib.js';
// Chat with a bot (Admin). Paste or attach images; polls for replies every 4s.
export default function Chat({section,bot='Admin'}){const [list,setList]=useState([]);const [cid,setCid]=useState(null);const [th,setTh]=useState(null);const [text,setText]=useState('');const [files,setFiles]=useState([]);const [err,setErr]=useState('');const [sending,setSending]=useState(false);
 const end=useRef(null);const inp=useRef(null);const fileInp=useRef(null);const last=useRef(0);
 const loadList=()=>api('/chat/list?section='+section).then(l=>{setList(l);return l});
 useEffect(()=>{loadList().then(l=>{if(l[0])setCid(l[0].id)}).catch(e=>setErr(e.message))},[]);
 useEffect(()=>{if(!cid)return;let alive=true;last.current=0;setTh(null);
  const tick=async()=>{try{const t=await api(`/chat/c/${cid}?after=${last.current}`);if(!alive)return;
   setTh(o=>{const ms=o&&o.id===t.id?[...o.messages,...t.messages.filter(m=>!o.messages.some(x=>x.id===m.id))]:t.messages;if(ms.length)last.current=ms[ms.length-1].id;return{...t,messages:ms}});}catch(e){}};
  tick();const iv=setInterval(tick,4000);return()=>{alive=false;clearInterval(iv)}},[cid]);
 useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'end'})},[th?.messages.length,th?.typing]);
 const newChat=async()=>{const c=await post('/chat/new',{section});await loadList();setCid(c.id);setTimeout(()=>inp.current?.focus())};
 const upload=async f=>{if(!cid)return;try{const r=await fetch(`/api/chat/c/${cid}/upload?name=${encodeURIComponent(f.name||'pasted.png')}`,{method:'POST',body:f,credentials:'same-origin'});const j=await r.json();if(!r.ok)throw new Error(j.error);setFiles(x=>[...x,j]);}catch(e){setErr(e.message)}};
 const onPaste=e=>{const imgs=[...e.clipboardData.items].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile());if(!imgs.length)return;e.preventDefault();
  imgs.forEach((f,i)=>upload(new File([f],`pasted-${Date.now()}-${i}.${(f.type.split('/')[1]||'png').replace('jpeg','jpg')}`,{type:f.type})));};
 const send=async e=>{e.preventDefault();if(!cid||sending||(!text.trim()&&!files.length))return;setSending(true);setErr('');
  try{const m=await post(`/chat/c/${cid}/messages`,{text,files:files.map(f=>f.id)});setTh(o=>({...o,typing:true,messages:[...o.messages,m]}));last.current=m.id;setText('');setFiles([]);loadList()}catch(x){setErr(x.message)}setSending(false);inp.current?.focus()};
 const del=async()=>{if(!cid||!confirm('Delete this conversation and its files?'))return;await api('/chat/c/'+cid,{method:'DELETE'});const l=await loadList();setCid(l[0]?.id||null);setTh(null)};
 return <div className="grid gap-4 lg:grid-cols-[17rem_1fr] h-[calc(100vh-15rem)] min-h-[28rem]">
  <nav aria-label="Conversations" className="rounded-2xl bg-white ring-1 ring-slate-200 p-3 flex flex-col min-h-0">
   <button onClick={newChat} className="flex items-center justify-center gap-2 rounded-xl bg-brand-900 text-white py-2 font-medium hover:bg-brand-700 transition-colors"><Plus size={16} aria-hidden/>New chat</button>
   <ul className="mt-3 space-y-1 overflow-y-auto">{list.map(c=><li key={c.id}><button onClick={()=>setCid(c.id)} aria-current={c.id===cid?'true':undefined} className={`w-full text-left rounded-xl px-3 py-2 transition-colors ${c.id===cid?'bg-brand-50 ring-1 ring-brand-600/30':'hover:bg-slate-50'}`}>
    <span className="block font-medium truncate">{c.title}{c.unread>0&&<span className="ml-2 rounded-full bg-brand-600 text-white text-xs px-1.5">{c.unread}<span className="sr-only"> unread</span></span>}</span><span className="block text-xs text-slate-500 truncate">{c.last_text||'No messages yet'}</span></button></li>)}
    {!list.length&&<li className="text-sm text-slate-500 px-2 py-4">No conversations yet. Start one to talk to {bot}.</li>}</ul></nav>
  <section aria-label={th?`Conversation: ${th.title}`:'Conversation'} className="rounded-2xl bg-white ring-1 ring-slate-200 flex flex-col min-h-0">
   {!cid?<div className="m-auto text-center p-8"><Bot className="mx-auto text-brand-600" size={36} aria-hidden/><p className="mt-3 font-medium">Chat with {bot}</p><p className="text-slate-600 text-sm">Ask about servers, sites, backups or migrations. Paste screenshots straight in.</p><button onClick={newChat} className="mt-4 rounded-xl bg-brand-900 text-white px-4 py-2">Start a chat</button></div>:<>
   <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3"><h2 className="font-semibold truncate">{th?.title||'…'}</h2><button onClick={del} className="ml-auto p-2 rounded-lg text-slate-500 hover:text-red-700 hover:bg-red-50" aria-label="Delete conversation"><Trash2 size={16} aria-hidden/></button></div>
   <ol className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite" aria-relevant="additions" aria-label="Messages">
    {th?.messages.map(m=><li key={m.id} className={`rise flex ${m.sender==='user'?'justify-end':''}`}><div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${m.sender==='user'?'bg-brand-900 text-white rounded-br-md':'bg-slate-100 rounded-bl-md'}`}>
     <span className="sr-only">{m.sender==='user'?'You':bot} said: </span><p className="whitespace-pre-wrap break-words">{m.text}</p>
     {m.files?.length>0&&<div className="mt-2 flex flex-wrap gap-2">{m.files.map((f,i)=>f.image?<a key={i} href={f.url} target="_blank" rel="noopener noreferrer"><img src={f.url} alt={f.name} className="max-h-48 rounded-lg"/></a>:<a key={i} href={f.url+'?dl=1'} className="underline text-sm">{f.name}</a>)}</div>}
     <p className={`mt-1 text-[11px] ${m.sender==='user'?'text-white/60':'text-slate-500'}`}>{when(m.created_at)}{m.delivered===false&&<span className="inline-flex items-center gap-1 ml-2 text-amber-300"><AlertCircle size={11} aria-hidden/>not delivered yet, retrying</span>}</p></div></li>)}
    {th?.typing&&<li className="flex" role="status"><div className="rounded-2xl bg-slate-100 px-4 py-3 flex gap-1" aria-label={`${bot} is working on a reply`}>{[0,1,2].map(i=><span key={i} className="dot w-2 h-2 rounded-full bg-slate-500" style={{animationDelay:i*.2+'s'}}/>)}</div></li>}
    <li ref={end} aria-hidden/></ol>
   {err&&<p role="alert" className="mx-4 mb-2 rounded-lg bg-red-50 text-red-800 px-3 py-2 text-sm">{err}</p>}
   <form onSubmit={send} className="border-t border-slate-100 p-3">
    {files.length>0&&<ul className="flex flex-wrap gap-2 mb-2" aria-label="Attachments">{files.map(f=><li key={f.id} className="relative">{f.image?<img src={f.url} alt={f.name} className="h-16 rounded-lg ring-1 ring-slate-200"/>:<span className="text-sm px-2 py-1 rounded bg-slate-100">{f.name}</span>}
     <button type="button" onClick={()=>setFiles(x=>x.filter(y=>y.id!==f.id))} className="absolute -top-2 -right-2 rounded-full bg-slate-800 text-white p-0.5" aria-label={`Remove ${f.name}`}><X size={12} aria-hidden/></button></li>)}</ul>}
    <div className="flex items-end gap-2">
     <input ref={fileInp} type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain" multiple className="sr-only" id="chat-file" onChange={e=>{[...e.target.files].forEach(upload);e.target.value=''}}/>
     <label htmlFor="chat-file" className="p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 cursor-pointer" title="Attach a file"><Paperclip size={18} aria-hidden/><span className="sr-only">Attach a file</span></label>
     <label htmlFor="chat-text" className="sr-only">Message to {bot}</label>
     <textarea id="chat-text" ref={inp} rows={1} value={text} onChange={e=>setText(e.target.value)} onPaste={onPaste} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(e)}}}
      placeholder={`Message ${bot}… (paste screenshots, Shift+Enter for a new line)`} className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 max-h-40"/>
     <button disabled={sending} className="rounded-xl bg-brand-900 text-white p-2.5 hover:bg-brand-700 disabled:opacity-60 transition-colors" aria-label="Send">{sending?<Loader2 size={18} className="animate-spin" aria-hidden/>:<Send size={18} aria-hidden/>}</button></div></form></>}
  </section></div>;}
