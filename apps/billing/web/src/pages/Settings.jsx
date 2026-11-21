import React,{useState,useEffect} from 'react';import {toast} from 'sonner';import {api} from '../lib.js';import {useCan} from '../store.js';import {Card,Button,Input,Textarea,Field,PageHead,Skel,ErrorBox} from '../ui.jsx';
const F=[['company','Business name'],['tagline','Tagline'],['owner_name','Your name'],['owner_title','Your title'],['website','Website'],['email','Email'],['phone','Phone'],['vat_note','VAT note','e.g. "Not VAT registered"']];
export default function Settings(){const can=useCan();const ro=!can('settings','edit');const[s,setS]=useState(null);const[err,setErr]=useState('');const[busy,setBusy]=useState(false);const load=()=>{setErr('');api('/settings').then(setS).catch(e=>setErr(e.message))};useEffect(load,[]);
 if(err)return <ErrorBox msg={err} retry={load}/>;
 return <><PageHead title="Settings" sub="These details print on your invoices and statements."/>
  {!s?<Card className="p-6 max-w-2xl space-y-4">{[1,2,3,4].map(i=><Skel key={i} h={40}/>)}</Card>:
  <form onSubmit={e=>{e.preventDefault();setBusy(true);api('/settings',{method:'PUT',body:s}).then(r=>{setS(r);toast.success('Settings saved')}).catch(x=>toast.error(x.message)).finally(()=>setBusy(false))}}>
   <Card className="p-6 max-w-2xl"><div className="grid sm:grid-cols-2 gap-x-4">{F.map(([k,l,h])=><Field key={k} label={l} hint={h}><Input disabled={ro} value={s[k]||''} onChange={e=>setS({...s,[k]:e.target.value})}/></Field>)}</div>
    <Field label="Bank details" hint="Shown at the bottom of each invoice"><Textarea disabled={ro} rows={5} value={s.bank_details||''} onChange={e=>setS({...s,bank_details:e.target.value})}/></Field>
    <div className="flex items-center justify-between border-t border-line pt-4 mt-2"><span className="text-muted text-sm">Next invoice number: <b className="text-ink num">{s.next_invoice_no}</b></span>{!ro&&<Button disabled={busy}>{busy?'Saving…':'Save settings'}</Button>}</div></Card></form>}</>}
