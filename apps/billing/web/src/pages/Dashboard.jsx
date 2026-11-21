import React from 'react';import {ResponsiveContainer,BarChart,Bar,XAxis,YAxis,Tooltip,CartesianGrid} from 'recharts';import {ArrowRight,CheckCircle2} from 'lucide-react';
import {useData,go,useCan} from '../store.js';import {R,fmtDate,ageDays,nextMonth,monthName,api} from '../lib.js';import {Card,Stat,CountUp,Badge,Button,PageHead,Skel,ErrorBox,Empty} from '../ui.jsx';
import {useEffect,useState} from 'react';
const greet=()=>{const h=new Date().getHours();return h<12?'Good morning':h<18?'Good afternoon':'Good evening'};
export default function Dashboard(){const{loading,error,clients=[],reload}=useData();const[bank,setBank]=useState(null);const[run,setRun]=useState(null);const nm=nextMonth();const can=useCan();
 useEffect(()=>{can('journal','read')?api('/journal?account=BANK').then(setBank).catch(()=>setBank([])):setBank([]);can('run','read')?api('/run/preview?month='+nm).then(setRun).catch(()=>setRun([])):setRun([])},[]);
 if(error)return <ErrorBox msg={'Could not load: '+error} retry={reload}/>;
 const act=clients.filter(c=>c.active!==false);const owed=act.reduce((a,c)=>a+Math.max(0,c.balance),0);const owers=act.filter(c=>c.balance>0.004);
 const over=act.reduce((a,c)=>a+(c.an?.overdue||0),0);const overN=act.filter(c=>c.an?.overdue>0).length;const mrr=act.reduce((a,c)=>a+c.monthly,0);
 const months=[];for(let i=5;i>=0;i--){const d=new Date();d.setDate(1);d.setMonth(d.getMonth()-i);months.push(d.toLocaleDateString('en-CA').slice(0,7))}
 const cash=months.map(m=>({m,label:monthName(m).slice(0,3),v:(bank||[]).filter(l=>l.dt>0&&l.tdate.startsWith(m)).reduce((a,l)=>a+l.dt,0)}));
 const thisM=cash[5].v,lastM=cash[4].v;
 const tasks=[];
 act.filter(c=>c.an?.overdue>0).sort((a,b)=>b.an.overdue-a.an.overdue).forEach(c=>tasks.push({c,why:`Unpaid since ${fmtDate(c.an.oldest)}`,badge:['over',`${ageDays(c.an.oldest)} days`],amt:c.an.overdue,btn:'Open'}));
 clients.filter(c=>c.active!==false&&!c.contracts?.some(k=>!k.end_date||k.end_date>=new Date().toISOString())).forEach(c=>tasks.push({c,why:'No active contract',badge:['due','Check'],btn:'Open'}));
 const runTotal=(run||[]).reduce((a,i)=>a+i.total,0);
 return <><PageHead title={greet()+', Hannes'} sub={new Date().toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long'})+(loading?'':` · ${tasks.length} thing${tasks.length===1?'':'s'} need${tasks.length===1?'s':''} you`)}>
   {can('run','read')&&<Button onClick={()=>go('run')}>{run&&run.length?`Start ${monthName(nm).split(' ')[0]} run`:'Monthly run'} <ArrowRight size={16}/></Button>}</PageHead>
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
   {loading?[1,2,3,4].map(i=><Card key={i} className="p-5"><Skel w={90} h={12}/><Skel className="my-3" w={140} h={26}/><Skel w={80} h={10}/></Card>):<>
   <Stat label="Owed to you" note={`across ${owers.length} client${owers.length===1?'':'s'}`}><CountUp v={owed}/></Stat>
   <Stat label="Overdue (30+ days)" tone={over>0?'text-over':''} note={over>0?<Badge k="over">{overN} client{overN===1?'':'s'}</Badge>:'Nothing overdue'}><CountUp v={over}/></Stat>
   <Stat label={'Cash in · '+monthName(months[5]).split(' ')[0]} note={bank?(lastM?<span className={thisM>=lastM?'text-paid':'text-over'}>{thisM>=lastM?'▲':'▼'} vs {monthName(months[4]).split(' ')[0]} ({R(lastM)})</span>:'From bank entries'):'…'}><CountUp v={thisM}/></Stat>
   <Stat label="Monthly recurring" note={`${act.length} active clients`}><CountUp v={mrr}/></Stat></>}
  </div>
  <div className="grid lg:grid-cols-[2fr_1fr] gap-4 mt-4">
   <Card><div className="px-5 pt-5 pb-2 font-semibold">Needs attention</div>
    {loading?<div className="p-5 space-y-3">{[1,2,3].map(i=><Skel key={i} h={22}/>)}</div>:
    <div className="divide-y divide-slate-100">{tasks.map((t,i)=><button key={i} onClick={()=>go('clients',t.c.id)} className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 cursor-pointer transition-colors">
      <div className="flex-1 min-w-0"><div className="font-medium truncate">{t.c.name}</div><div className="text-xs text-muted">{t.why}</div></div><Badge k={t.badge[0]}>{t.badge[1]}</Badge>
      <div className="num w-24 text-right">{t.amt?R(t.amt):'—'}</div><ArrowRight size={16} className="text-muted hidden sm:block"/></button>)}
     {run&&run.length>0&&<button onClick={()=>go('run')} className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 cursor-pointer"><div className="flex-1"><div className="font-medium">{monthName(nm)} run</div><div className="text-xs text-muted">{run.length} draft invoices ready to check</div></div><Badge k="draft">Draft</Badge><div className="num w-24 text-right">{R(runTotal)}</div><ArrowRight size={16} className="text-muted hidden sm:block"/></button>}
     {!tasks.length&&!(run&&run.length)&&<Empty icon={CheckCircle2} title="All clear" text="Nobody is overdue."/>}</div>}</Card>
   <Card className="p-5"><div className="font-semibold">Cash in · last 6 months</div><div className="text-xs text-muted mb-3">Money into the bank from the ledger</div>
    {bank===null?<Skel h={180}/>:<div className="h-[190px]"><ResponsiveContainer><BarChart data={cash} margin={{left:-12,right:4,top:8}}><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4FC3F7"/><stop offset="1" stopColor="#1E8BFF"/></linearGradient></defs>
     <CartesianGrid vertical={false} stroke="#EEF2F7"/><XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="#64748B"/><YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#64748B" tickFormatter={v=>v>=1000?(v/1000)+'k':v}/>
     <Tooltip cursor={{fill:'#F1F5F9'}} formatter={v=>[R(v),'Cash in']} contentStyle={{borderRadius:8,border:'1px solid #E5EAF1'}}/><Bar dataKey="v" fill="url(#g)" radius={[6,6,2,2]} maxBarSize={36} animationDuration={600}/></BarChart></ResponsiveContainer></div>}</Card>
  </div></>}
