import React, {useEffect, useId, useRef, useState} from 'react';
import {Plus, Send, Paperclip, X, Bot, Loader2, Pencil, ExternalLink, AlertCircle} from 'lucide-react';
import {api, post, patch, when} from '../lib.js';
import Hint from '../Hint.jsx';

export default function Bobby({section, me, onMe}) {
  const [status, setStatus] = useState(null);
  const [list, setList] = useState([]);
  const [cid, setCid] = useState(null);
  const [th, setTh] = useState(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [err, setErr] = useState('');
  const [sending, setSending] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const end = useRef(null);
  const inp = useRef(null);

  const agent = status?.client?.agentName || me?.client?.agentName || 'Bobby';
  const credits = status?.client?.credits;
  const siteUrl = status?.client?.siteUrl || me?.client?.siteUrl;
  const grok = status?.grokConfigured;

  const loadStatus = () => api('/bobby/status').then(s => { setStatus(s); return s; });
  const loadList = () => api('/bobby/conversations').then(l => { setList(l); return l; });

  useEffect(() => {
    Promise.all([loadStatus(), loadList()])
      .then(([, l]) => { if (l[0]) setCid(l[0].id); })
      .catch(e => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!cid) return;
    let alive = true;
    setTh(null);
    api('/bobby/conversations/' + cid).then(t => { if (alive) setTh(t); }).catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [cid]);

  useEffect(() => { end.current?.scrollIntoView({behavior: 'smooth', block: 'end'}); }, [th?.messages?.length, sending]);

  const newChat = async () => {
    const c = await post('/bobby/conversations', {});
    await loadList();
    setCid(c.id);
    setTimeout(() => inp.current?.focus());
  };

  const upload = async f => {
    if (!cid) return;
    try {
      const r = await fetch(`/api/bobby/conversations/${cid}/upload?name=${encodeURIComponent(f.name || 'file')}`, {method: 'POST', body: f, credentials: 'same-origin'});
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setFiles(x => [...x, j]);
    } catch (e) { setErr(e.message); }
  };

  const send = async e => {
    e.preventDefault();
    if (!cid || sending || (!text.trim() && !files.length)) return;
    setSending(true); setErr('');
    const pending = text;
    const pendingFiles = files;
    setText(''); setFiles([]);
    setTh(o => o && ({
      ...o,
      messages: [...o.messages, {id: 'tmp-' + Date.now(), role: 'user', sender: 'user', text: pending, files: pendingFiles, created_at: new Date().toISOString()}],
    }));
    try {
      const r = await post(`/bobby/conversations/${cid}/messages`, {text: pending, files: pendingFiles.map(f => f.id)});
      setTh(o => {
        const msgs = (o?.messages || []).filter(m => m.id !== 'tmp-' + 0 && !String(m.id).startsWith('tmp-'));
        return {...o, title: o?.title, messages: [...msgs, r.user, r.assistant]};
      });
      if (r.credits && status) setStatus(s => ({...s, client: {...s.client, credits: r.credits, agentName: r.agentName || s.client.agentName}}));
      if (r.agentName && onMe) onMe(m => m ? ({...m, client: {...m.client, agentName: r.agentName}}) : m);
      loadList();
    } catch (x) {
      setErr(x.message);
      setText(pending);
      setFiles(pendingFiles);
    }
    setSending(false);
    inp.current?.focus();
  };

  const used = credits ? credits.usedZar : 0;
  const allow = credits ? credits.allowanceZar : 100;
  const pct = Math.min(100, Math.round((used / (allow || 1)) * 100));

  return (
    <div className="max-w-[1500px] mx-auto min-w-0 w-full">
      <div className="rise flex flex-wrap items-end gap-4 justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            {agent}
            <button type="button" onClick={() => setRenameOpen(true)} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-brand-700" aria-label={`Rename ${agent}`}>
              <Pencil size={16} aria-hidden/>
            </button>
          </h1>
          <p className="text-slate-600 mt-1 max-w-2xl">{section.description}. {agent} can read your information in this app, and will ask before deleting anything, spending money, or sending an email.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {siteUrl && (
            <a href={siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:border-brand-600 hover:text-brand-700 transition-colors">
              Look at your site <ExternalLink size={14} aria-hidden/><span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </div>
      </div>

      {credits && (
        <div className="rise mt-5 rounded-2xl bg-white ring-1 ring-slate-200 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">
              AI credits this month
              <Hint term="AI credits" meaning="AI means Artificial Intelligence. Your plan includes R100 of Grok credits each month for this helper."/>
            </p>
            <p className="text-sm text-slate-600">R{used.toFixed(2)} of R{allow.toFixed(0)} used · R{(credits.remainingZar ?? Math.max(0, allow - used)).toFixed(2)} left</p>
          </div>
          <div className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden" role="meter" aria-label="AI credits used this month" aria-valuemin={0} aria-valuemax={allow} aria-valuenow={used} aria-valuetext={`R${used.toFixed(2)} of R${allow.toFixed(0)} used`}>
            <div className={`h-full rounded-full transition-all duration-500 ${pct >= 95 ? 'bg-red-600' : pct >= 70 ? 'bg-amber-500' : 'bg-brand-600'}`} style={{width: pct + '%'}}/>
          </div>
          {!grok && (
            <p role="status" className="mt-3 text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2">
              Live replies are not on yet. Planet Grid still needs to add a Grok API key (API means Application Programming Interface: a key that lets this app talk to Grok).
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[17rem_1fr] h-[calc(100vh-22rem)] min-h-[28rem] min-w-0">
        <nav aria-label="Conversations" className="rounded-2xl bg-white ring-1 ring-slate-200 p-3 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <button onClick={newChat} className="flex items-center justify-center gap-2 rounded-xl bg-brand-900 text-white py-2.5 font-medium hover:bg-brand-700 transition-colors min-h-11">
            <Plus size={16} aria-hidden/>New chat
          </button>
          <ul className="mt-3 space-y-1 overflow-y-auto">
            {list.map(c => (
              <li key={c.id}>
                <button onClick={() => setCid(c.id)} aria-current={c.id === cid ? 'true' : undefined} className={`w-full text-left rounded-xl px-3 py-2 transition-colors ${c.id === cid ? 'bg-brand-50 ring-1 ring-brand-600/30' : 'hover:bg-slate-50'}`}>
                  <span className="block font-medium truncate">{c.title}{c.unread > 0 && <span className="ml-2 rounded-full bg-brand-600 text-white text-xs px-1.5">{c.unread}<span className="sr-only"> unread</span></span>}</span>
                  <span className="block text-xs text-slate-500 truncate">{c.last_text || 'No messages yet'}</span>
                </button>
              </li>
            ))}
            {!list.length && <li className="text-sm text-slate-500 px-2 py-4">No conversations yet. Start one to talk to {agent}.</li>}
          </ul>
        </nav>

        <section aria-label={th ? `Conversation: ${th.title}` : 'Conversation'} className="rounded-2xl bg-white ring-1 ring-slate-200 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {!cid ? (
            <div className="m-auto text-center p-8">
              <Bot className="mx-auto text-brand-600" size={36} aria-hidden/>
              <p className="mt-3 font-medium">Chat with {agent}</p>
              <p className="text-slate-600 text-sm">Ask about your site, your info in this app, or what to do next.</p>
              <button onClick={newChat} className="mt-4 rounded-xl bg-brand-900 text-white px-4 py-2.5">Start a chat</button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <h2 className="font-semibold truncate">{th?.title || '…'}</h2>
              </div>
              <ol className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite" aria-relevant="additions" aria-label="Messages">
                {th?.messages?.map(m => (
                  <li key={m.id} className={`rise flex ${m.role === 'user' || m.sender === 'user' ? 'justify-end' : ''}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${m.role === 'user' || m.sender === 'user' ? 'bg-brand-900 text-white rounded-br-md' : 'bg-slate-100 rounded-bl-md'}`}>
                      <span className="sr-only">{m.role === 'user' || m.sender === 'user' ? 'You' : agent} said: </span>
                      <p className="whitespace-pre-wrap break-words">{linkify(m.text)}</p>
                      {m.files?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.files.map((f, i) => f.image
                            ? <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"><img src={f.url} alt={f.name} className="max-h-48 rounded-lg"/></a>
                            : <a key={i} href={f.url + '?dl=1'} className="underline text-sm">{f.name}</a>)}
                        </div>
                      )}
                      <p className={`mt-1 text-[11px] ${m.role === 'user' || m.sender === 'user' ? 'text-white/60' : 'text-slate-500'}`}>{when(m.created_at)}</p>
                    </div>
                  </li>
                ))}
                {sending && (
                  <li className="flex" role="status">
                    <div className="rounded-2xl bg-slate-100 px-4 py-3 flex gap-1" aria-label={`${agent} is writing a reply`}>
                      {[0, 1, 2].map(i => <span key={i} className="dot w-2 h-2 rounded-full bg-slate-500" style={{animationDelay: i * .2 + 's'}}/>)}
                    </div>
                  </li>
                )}
                <li ref={end} aria-hidden/>
              </ol>
              {err && <p role="alert" className="mx-4 mb-2 rounded-lg bg-red-50 text-red-800 px-3 py-2 text-sm flex items-start gap-2"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden/>{err}</p>}
              <Composer agent={agent} text={text} setText={setText} files={files} setFiles={setFiles} onPasteFiles={fs => fs.forEach(upload)} onUpload={upload} onSend={send} sending={sending} inp={inp}/>
            </>
          )}
        </section>
      </div>

      {renameOpen && (
        <RenameDialog
          current={agent}
          onClose={() => setRenameOpen(false)}
          onSaved={name => {
            setStatus(s => s ? ({...s, client: {...s.client, agentName: name}}) : s);
            if (onMe) onMe(m => m ? ({...m, client: {...m.client, agentName: name}}) : m);
            setRenameOpen(false);
          }}
        />
      )}
    </div>
  );
}

function linkify(text) {
  const parts = String(text || '').split(/(https?:\/\/[^\s<>"]+)/g);
  return parts.map((p, i) => /^https?:\/\//.test(p)
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline break-all">{p}<span className="sr-only"> (opens in a new tab)</span></a>
    : p);
}

function Composer({agent, text, setText, files, setFiles, onPasteFiles, onUpload, onSend, sending, inp}) {
  const fileId = useId();
  const fileInp = useRef(null);
  const onPaste = e => {
    const imgs = [...e.clipboardData.items].filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile());
    if (!imgs.length) return;
    e.preventDefault();
    onPasteFiles(imgs.map((f, i) => new File([f], `pasted-${Date.now()}-${i}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, {type: f.type})));
  };
  return (
    <form onSubmit={onSend} className="border-t border-slate-100 p-3">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 mb-2" aria-label="Attachments">
          {files.map(f => (
            <li key={f.id} className="relative">
              {f.image ? <img src={f.url} alt={f.name} className="h-16 rounded-lg ring-1 ring-slate-200"/> : <span className="text-sm px-2 py-1 rounded bg-slate-100">{f.name}</span>}
              <button type="button" onClick={() => setFiles(x => x.filter(y => y.id !== f.id))} className="absolute -top-2 -right-2 rounded-full bg-slate-800 text-white p-0.5" aria-label={`Remove ${f.name}`}><X size={12} aria-hidden/></button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileInp} type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" multiple className="sr-only" id={fileId} onChange={e => { [...e.target.files].forEach(onUpload); e.target.value = ''; }}/>
        <label htmlFor={fileId} className="p-2.5 rounded-xl text-slate-600 hover:bg-slate-100 cursor-pointer min-h-11 min-w-11 grid place-items-center" title="Attach a file">
          <Paperclip size={18} aria-hidden/><span className="sr-only">Attach a file</span>
        </label>
        <label htmlFor="bobby-text" className="sr-only">Message to {agent}</label>
        <textarea
          id="bobby-text"
          ref={inp}
          rows={1}
          value={text}
          onChange={e => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(e); } }}
          placeholder={`Message ${agent}… (Shift+Enter for a new line)`}
          className="flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 max-h-40"
        />
        <button disabled={sending} className="rounded-xl bg-brand-900 text-white p-2.5 hover:bg-brand-700 disabled:opacity-60 transition-colors min-h-11 min-w-11" aria-label="Send">
          {sending ? <Loader2 size={18} className="animate-spin" aria-hidden/> : <Send size={18} aria-hidden/>}
        </button>
      </div>
    </form>
  );
}

function RenameDialog({current, onClose, onSaved}) {
  const [name, setName] = useState(current);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);
  const save = async e => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await patch('/bobby/settings', {agentName: name});
      onSaved(r.agentName);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-slate-900/40" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="rename-title" className="rise w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="rename-title" className="text-xl font-semibold">Rename your helper</h2>
        <p className="text-slate-600 text-sm mt-1">This name is saved for your whole account. Everyone on the account will see it.</p>
        <form onSubmit={save} className="mt-4">
          <label htmlFor="agent-name" className="block text-sm font-medium">New name</label>
          <input id="agent-name" ref={input} value={name} onChange={e => setName(e.target.value)} maxLength={40} required className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5"/>
          {err && <p role="alert" className="mt-2 text-sm text-red-800">{err}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl px-4 py-2.5 text-slate-700 hover:bg-slate-100">Cancel</button>
            <button disabled={busy} className="rounded-xl bg-brand-900 text-white px-4 py-2.5 font-medium hover:bg-brand-700 disabled:opacity-60">{busy ? 'Saving…' : 'Save name'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
