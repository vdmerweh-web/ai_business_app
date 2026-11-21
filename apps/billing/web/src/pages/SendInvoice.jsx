import React,{useState} from 'react';import {toast} from 'sonner';import {Send,Paperclip,AlertTriangle} from 'lucide-react';
import {api} from '../lib.js';import {Button,Input,Textarea,Field,Sheet} from '../ui.jsx';
// Send an invoice by email. Only sends when the user clicks Send.
export default function SendInvoice({no}){const[d,setD]=useState(null);const[f,setF]=useState(null);const[busy,setBusy]=useState(false);const[cfg,setCfg]=useState(null);
 React.useEffect(()=>{setCfg(null);api(`/invoices/${no}/email`).then(r=>setCfg(r)).catch(()=>setCfg({configured:false}))},[no]);
 const open=()=>{setD(cfg);setF({...cfg.defaults})};
 const send=e=>{e.preventDefault();setBusy(true);api(`/invoices/${no}/email`,{method:'POST',body:f}).then(()=>{toast.success(`Invoice ${no} sent`,{description:f.to});setD(null);api(`/invoices/${no}/email`).then(setCfg)}).catch(x=>toast.error(x.message)).finally(()=>setBusy(false))};
 const sent=(cfg?.history||[]).filter(h=>h.status==='sent');
 return <>{cfg&&!cfg.configured?<Button v="secondary" disabled aria-disabled="true" title="Email not set up yet">Email not set up yet</Button>:<Button onClick={open} disabled={!cfg}><Send size={15}/>Send</Button>}
  <Sheet open={!!d} onOpenChange={o=>!o&&!busy&&setD(null)} title={`Send invoice ${no}`} desc={d?`${d.client} · from ${d.from}`:''} footer={<><Button v="secondary" onClick={()=>setD(null)} disabled={busy}>Cancel</Button><Button form="sif" disabled={busy}><Send size={15}/>{busy?'Sending…':'Send'}</Button></>}>
   {d&&f&&<form id="sif" onSubmit={send}>
    {sent.length>0&&<div role="alert" className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 mb-4 text-sm"><AlertTriangle size={16} aria-hidden="true" className="shrink-0 mt-0.5"/>Already sent {sent.length} time{sent.length>1?'s':''}, last on {new Date(sent[0].sent_at).toLocaleString('en-ZA')}.</div>}
    <Field label="To" hint="Separate several addresses with commas"><Input type="text" inputMode="email" autoComplete="off" value={f.to} onChange={e=>setF({...f,to:e.target.value})} required/></Field>
    <Field label="CC" hint="Separate several addresses with commas"><Input type="text" inputMode="email" autoComplete="off" value={f.cc} onChange={e=>setF({...f,cc:e.target.value})}/></Field>
    <Field label="Subject"><Input value={f.subject} onChange={e=>setF({...f,subject:e.target.value})} required/></Field>
    <Field label="Message"><Textarea rows={12} value={f.message} onChange={e=>setF({...f,message:e.target.value})} required/></Field>
    <div className="text-[13px] font-medium mb-1.5" id="si-att">Attachments (always included)</div>
    <ul aria-labelledby="si-att" className="mb-4 flex flex-wrap gap-2">{d.attachments.map(a=><li key={a.name} aria-label={`${a.kind} PDF: ${a.name}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-slate-50 px-3 py-1 text-sm"><Paperclip size={14} aria-hidden="true"/><span className="font-medium">{a.kind}:</span>{a.name}</li>)}</ul>
    <section aria-labelledby="si-hist"><h3 id="si-hist" className="text-[13px] font-medium mb-1.5">Send history</h3>
     {d.history.length?<ul className="text-sm space-y-1.5">{d.history.map((h,i)=><li key={i}><span className={h.status==='sent'?'text-paid':'text-over'}>{h.status==='sent'?'Sent':'Failed'}</span> {new Date(h.sent_at).toLocaleString('en-ZA')} to {h.to_addrs}{h.cc_addrs?` (cc ${h.cc_addrs})`:''}{h.attachments?` · ${h.attachments}`:''}{h.error?` · ${h.error}`:''}</li>)}</ul>:<p className="text-sm text-muted">Not sent yet.</p>}</section></form>}</Sheet></>}
