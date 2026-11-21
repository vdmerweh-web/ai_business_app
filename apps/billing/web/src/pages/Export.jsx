import React,{useState} from 'react';import {Download} from 'lucide-react';import {Card,Button,Input,Field,PageHead} from '../ui.jsx';
const ty=()=>{const d=new Date();const y=d.getMonth()>=2?d.getFullYear():d.getFullYear()-1;return[`${y}-03-01`,`${y+1}-02-${(y+1)%4===0?29:28}`]};
export default function Export(){const[t0,t1]=ty();const[f,setF]=useState(t0);const[t,setT]=useState(t1);
 return <><PageHead title="Export" sub="Journal CSV for Sage, Xero or QuickBooks."/>
  <Card className="p-6 max-w-lg"><p className="text-muted mb-5">Two lines per entry (debit and credit). The default dates are the SA tax year (March to February).</p>
   <div className="grid grid-cols-2 gap-4"><Field label="From"><Input type="date" value={f} onChange={e=>setF(e.target.value)}/></Field><Field label="To"><Input type="date" value={t} onChange={e=>setT(e.target.value)}/></Field></div>
   <a href={`/api/export.csv?from=${f}&to=${t}`}><Button><Download size={16}/>Download CSV</Button></a></Card></>}
