import React,{useState} from 'react';import {toast} from 'sonner';import {Check,Info,FileText,AlertTriangle} from 'lucide-react';
import {api,R,nextMonth,monthName} from '../lib.js';import {useData,useCan} from '../store.js';import {Card,Table,Button,Input,Field,PageHead,Confirm,PdfSheet,SkelRows,ErrorBox,Empty,Badge,cn} from '../ui.jsx';
const Step=({n,title,on,done})=><div className={cn('flex items-center gap-3',!on&&!done&&'opacity-50')}><div className={cn('w-8 h-8 rounded-full grid place-items-center text-sm font-semibold',done?'bg-paid text-white':on?'bg-grid text-white':'bg-slate-200')}>{done?<Check size={16}/>:n}</div><span className="font-medium">{title}</span></div>;
export default function Run(){const{reload}=useData();const can=useCan();const[m,setM]=useState(nextMonth());const[l,setL]=useState(null);const[busy,setBusy]=useState(false);const[err,setErr]=useState('');const[conf,setConf]=useState(false);const[typed,setTyped]=useState('');const[done,setDone]=useState(null);const[pdf,setPdf]=useState(null);
 const step=done?3:l?2:1;
 const preview=()=>{setBusy(true);setErr('');api('/run/preview?month='+m).then(setL).catch(e=>setErr(e.message)).finally(()=>setBusy(false))};
 const fin=()=>{setBusy(true);api('/run/finalise',{method:'POST',body:{month:m,confirm:'FINALISE'}}).then(r=>{setDone(r);setConf(false);setL(null);toast.success(`${r.length} invoices created for ${monthName(m)}`);reload()}).catch(e=>toast.error(e.message)).finally(()=>setBusy(false))};
 const tot=(l||[]).reduce((a,i)=>a+i.total,0);
 return <><PageHead title="Monthly run" sub="Make the invoices for a month. Nothing is emailed."/>
  <Card className="p-5 mb-4"><div className="flex flex-col sm:flex-row gap-4 sm:gap-10"><Step n={1} title="Pick month" on={step===1} done={step>1}/><Step n={2} title="Check drafts" on={step===2} done={step>2}/><Step n={3} title="Finalise" on={step===3} done={!!done}/></div></Card>
  {step===1&&<Card className="p-5 max-w-md"><Field label="Month to invoice"><Input type="month" value={m} onChange={e=>setM(e.target.value)}/></Field>
   <div className="flex items-start gap-2 text-sm text-muted mb-4"><Info size={16} className="mt-0.5 shrink-0"/>Preview is safe. It saves nothing and uses no invoice numbers.</div>
   {err&&<div className="mb-3"><ErrorBox msg={err}/></div>}<Button onClick={preview} disabled={busy||!m}>{busy?'Loading…':'Preview drafts'}</Button></Card>}
  {step===2&&<><div className="flex items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 text-sky-900 px-4 py-3 mb-4"><FileText size={18}/><span className="flex-1"><b>Draft · {monthName(m)}.</b> These are not real invoices yet. Check them, then finalise.</span></div>
   <Card>{!l.length?<Empty title="Nothing to invoice" text={`No contracts are due in ${monthName(m)}, or the month is already finalised.`}/>:
    <Table rows={l} rowKey={i=>i.client_id} cols={[{h:'Client',r:i=><div><div className="font-medium">{i.name}</div><div className="text-xs text-muted">{i.ref}</div></div>},{h:'Lines',hide:1,r:i=><span className="text-muted">{i.lines.map(x=>x.description).join(', ')}</span>},
     {h:'Status',r:()=><Badge k="draft">Draft</Badge>},{h:'Total',right:1,r:i=>R(i.total)},
     {h:'',r:i=><div className="flex gap-3 justify-end text-[13px] whitespace-nowrap"><button className="text-grid cursor-pointer" onClick={()=>setPdf({title:`Draft invoice · ${i.name}`,desc:monthName(m),url:`/api/pdf/invoice?client=${i.client_id}&month=${m}`})}>Invoice</button><button className="text-grid cursor-pointer" onClick={()=>setPdf({title:`Draft statement · ${i.name}`,desc:monthName(m),url:`/api/pdf/statement?client=${i.client_id}&month=${m}`})}>Statement</button></div>}]}/>}
    <div className="flex flex-wrap gap-3 items-center justify-between px-4 py-3 border-t border-line"><span className="font-medium">{l.length} invoices · <span className="num">{R(tot)}</span></span>
     <div className="flex gap-2"><Button v="secondary" onClick={()=>setL(null)}>Back</Button>{l.length>0&&can('run','edit')&&<Button onClick={()=>{setTyped('');setConf(true)}}>Finalise {monthName(m)}…</Button>}</div></div></Card></>}
  {done&&<Card className="p-8 text-center max-w-lg"><div className="mx-auto w-12 h-12 rounded-full bg-green-100 text-paid grid place-items-center mb-3"><Check/></div><div className="text-lg font-semibold">{done.length} invoices created</div><p className="text-muted mt-1">{monthName(m)} is finalised. View them under Invoices.</p>
   <Button v="secondary" className="mt-4" onClick={()=>{setDone(null);setL(null)}}>Start another month</Button></Card>}
  <Confirm open={conf} onOpenChange={setConf} danger title={`Finalise ${monthName(m)}?`} action={busy?'Working…':'Create real invoices'} disabled={typed!=='FINALISE'||busy} onConfirm={fin}
   body={`This creates ${l?.length||0} real invoices (${R(tot)}) with invoice numbers. It can't be undone from here.`}>
   <div className="mt-4"><Field label="Type FINALISE to confirm"><Input value={typed} onChange={e=>setTyped(e.target.value)} autoFocus/></Field></div></Confirm>
  <PdfSheet pdf={pdf} onClose={()=>setPdf(null)}/></>}
