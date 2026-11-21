import React,{useState} from 'react';import {Plus,Users,Search} from 'lucide-react';import {toast} from 'sonner';
import {useData,go,useCan} from '../store.js';import {api,clientStatus} from '../lib.js';import {Card,Table,Badge,Money,Button,PageHead,Input,Field,Sheet,SkelRows,ErrorBox,Empty} from '../ui.jsx';
export function ClientForm({open,setOpen,initial,onSaved}){const canU=useCan()('users','edit');const[n,setN]=useState(initial||{});const[busy,setBusy]=useState(false);const edit=!!initial?.id;
 const F=(k,l,p={})=><Field label={l} hint={p.hint}><Input value={n[k]||''} onChange={e=>setN({...n,[k]:e.target.value})} {...p}/></Field>;
 const save=e=>{e.preventDefault();setBusy(true);api(edit?'/clients/'+n.id:'/clients',{method:edit?'PUT':'POST',body:n}).then(r=>{toast.success(edit?'Client updated':'Client added');setOpen(false);onSaved?.(r)}).catch(x=>toast.error(x.message)).finally(()=>setBusy(false))};
 return <Sheet open={open} onOpenChange={o=>{setOpen(o);if(o)setN(initial||{})}} title={edit?'Edit client':'New client'} desc={edit?'Change contact details.':'Add a client. You can add a contract after.'}
  footer={<><Button v="secondary" onClick={()=>setOpen(false)}>Cancel</Button><Button form="cf" disabled={busy}>{busy?'Saving…':'Save client'}</Button></>}>
  <form id="cf" onSubmit={save}>{F('name','Business name',{required:true})}{F('ref','Reference',{required:true,hint:'Clients pay with this, e.g. PG042'})}{F('contact','Contact person')}{F('email','Email',{type:'email'})}{F('cell','Cell number',{type:'tel'})}
  {edit&&<label className="flex items-center gap-2 mt-2"><input type="checkbox" checked={n.active!==false} onChange={e=>setN({...n,active:e.target.checked})}/> Active client</label>}
  {edit&&canU&&<label className="flex items-start gap-2 mt-3"><input type="checkbox" className="mt-1" checked={!!n.no_charge} onChange={e=>setN({...n,no_charge:e.target.checked})}/><span>No charge / test account<span className="block text-xs text-muted">Left out of monthly runs and statements.</span></span></label>}</form></Sheet>}
export default function Clients(){const{loading,error,clients=[],reload}=useData();const[f,setF]=useState('');const[show,setShow]=useState('active');const[open,setOpen]=useState(false);const can=useCan();
 const l=clients.filter(c=>(show==='all'||(show==='active'?c.active!==false:c.active===false))&&(c.name+c.ref+(c.contact||'')).toLowerCase().includes(f.toLowerCase()));
 const tot=l.reduce((a,c)=>a+c.balance,0);
 return <><PageHead title="Clients" sub={loading?'':`${clients.filter(c=>c.active!==false).length} active`}>{can('clients','edit')&&<Button onClick={()=>setOpen(true)}><Plus size={16}/>New client</Button>}</PageHead>
  <Card><div className="flex flex-wrap gap-3 p-4 border-b border-line"><div className="relative flex-1 min-w-[200px]"><Search size={16} className="absolute left-3 top-3 text-muted"/><Input className="pl-9" placeholder="Search name, reference or contact" value={f} onChange={e=>setF(e.target.value)}/></div>
   <div className="flex rounded-lg border border-line p-0.5">{[['active','Active'],['inactive','Inactive'],['all','All']].map(([k,t])=><button key={k} onClick={()=>setShow(k)} className={'px-3 h-9 rounded-md text-[13px] cursor-pointer '+(show===k?'bg-navy text-white':'text-muted')}>{t}</button>)}</div></div>
  {error?<div className="p-4"><ErrorBox msg={error} retry={reload}/></div>:loading?<SkelRows n={8}/>:
  <Table rowKey={c=>c.id} onRow={c=>go('clients',c.id)} rows={l} empty={<Empty icon={Users} title="No clients found" text={f?'Try another search.':'Add your first client.'}/>} cols={[
   {h:'Client',r:c=><div><div className="font-medium">{c.name}</div><div className="text-xs text-muted">{c.ref}</div></div>},
   {h:'Contact',hide:1,r:c=><span className="text-muted">{c.contact}</span>},
   {h:'Status',r:c=>{const[k,t]=clientStatus(c.balance,c.an?.overdue);return <Badge k={k}>{t}</Badge>}},
   {h:'Monthly',right:1,hide:1,r:c=>c.monthly?<Money v={c.monthly}/>:<span className="text-muted">—</span>},
   {h:'Balance',right:1,r:c=><Money v={c.balance} className={c.an?.overdue>0?'text-over font-medium':''}/>}]}/>}
  {!loading&&!error&&l.length>0&&<div className="flex justify-between px-4 py-3 border-t border-line bg-slate-50/60 rounded-b-xl font-medium"><span>Total owed</span><span className="num">{'R '+tot.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,' ')}</span></div>}</Card>
  <ClientForm open={open} setOpen={setOpen} onSaved={r=>{reload();r?.id&&go('clients',r.id)}}/></>}
