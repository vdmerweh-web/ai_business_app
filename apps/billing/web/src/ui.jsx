import React,{useEffect,useState} from 'react';import clsx from 'clsx';import * as D from '@radix-ui/react-dialog';import {X,Inbox,AlertTriangle} from 'lucide-react';
import {animate,useReducedMotion} from 'motion/react';import {R} from './lib.js';
export const cn=clsx;
export const Button=({v='primary',className,...p})=><button {...p} className={cn('inline-flex items-center justify-center gap-2 rounded-lg px-4 h-10 font-medium transition-[transform,background,box-shadow] duration-150 active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
 {primary:'bg-grid text-white shadow-sm shadow-grid/30 hover:bg-[#1479E6]',secondary:'bg-white border border-line hover:bg-slate-50',ghost:'hover:bg-slate-100',danger:'bg-over text-white hover:bg-red-700'}[v],className)}/>;
export const Card=({className,...p})=><div {...p} className={cn('bg-white border border-line rounded-xl shadow-[0_1px_3px_#0F172A0a]',className)}/>;
export const Field=({label,hint,children})=><label className="block mb-4"><span className="block text-[13px] font-medium mb-1.5">{label}</span>{children}{hint&&<span className="block text-xs text-muted mt-1">{hint}</span>}</label>;
const ic='w-full h-10 rounded-lg border border-line bg-white px-3 outline-none focus:border-grid focus:ring-2 focus:ring-grid/20 transition';
export const Input=({className,...p})=><input {...p} className={cn(ic,className)}/>;
export const Textarea=({className,...p})=><textarea {...p} className={cn(ic,'h-auto py-2',className)}/>;
export const Select=({className,children,...p})=><select {...p} className={cn(ic,'pr-8',className)}>{children}</select>;
const bc={paid:'bg-green-100 text-green-700',due:'bg-amber-100 text-amber-700',over:'bg-red-100 text-red-700',draft:'bg-sky-100 text-sky-700',credit:'bg-indigo-100 text-indigo-700',muted:'bg-slate-100 text-slate-600'};
export const Badge=({k='muted',children})=><span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',bc[k])}>{children}</span>;
export const Money=({v,className})=><span className={cn('num',className)}>{R(v)}</span>;
export function CountUp({v}){const rm=useReducedMotion();const[n,setN]=useState(rm?v:0);
 useEffect(()=>{if(rm){setN(v);return}const c=animate(0,v,{duration:.8,ease:[.2,.8,.2,1],onUpdate:setN});return()=>c.stop()},[v,rm]);return <span className="num">{R(n)}</span>}
export function Sheet({open,onOpenChange,title,desc,children,footer,wide}){return <D.Root open={open} onOpenChange={onOpenChange}><D.Portal>
 <D.Overlay className="overlay fixed inset-0 bg-navy/40 z-40"/>
 <D.Content className={cn('sheet fixed right-0 top-0 h-full w-full bg-white z-50 shadow-2xl flex flex-col',wide?'sm:w-[min(900px,95vw)]':'sm:w-[440px]')}>
  <div className="flex items-start justify-between px-6 py-5 border-b border-line"><div><D.Title className="text-lg font-semibold">{title}</D.Title>{desc?<D.Description className="text-muted text-sm mt-1">{desc}</D.Description>:<D.Description className="sr-only">{title}</D.Description>}</div>
  <D.Close className="p-2 -m-2 rounded-lg hover:bg-slate-100 cursor-pointer" aria-label="Close"><X size={18}/></D.Close></div>
  <div className="flex-1 overflow-auto px-6 py-5">{children}</div>{footer&&<div className="px-6 py-4 border-t border-line flex gap-2 justify-end">{footer}</div>}
 </D.Content></D.Portal></D.Root>}
export function Confirm({open,onOpenChange,title,body,action='Confirm',danger,onConfirm,children,disabled}){return <D.Root open={open} onOpenChange={onOpenChange}><D.Portal>
 <D.Overlay className="overlay fixed inset-0 bg-navy/40 z-40"/>
 <D.Content className="pop fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-xl shadow-2xl w-[min(440px,92vw)] p-6">
  <D.Title className="text-lg font-semibold">{title}</D.Title><D.Description className="text-muted mt-2">{body}</D.Description>{children}
  <div className="flex gap-2 justify-end mt-6"><D.Close asChild><Button v="secondary">Cancel</Button></D.Close><Button v={danger?'danger':'primary'} disabled={disabled} onClick={onConfirm}>{action}</Button></div>
 </D.Content></D.Portal></D.Root>}
export const Skel=({h=16,w='100%',className})=><div className={cn('skel',className)} style={{height:h,width:w}}/>;
export const SkelRows=({n=5})=><div className="space-y-3 p-5">{Array.from({length:n},(_,i)=><Skel key={i} h={20}/>)}</div>;
export const Empty=({icon:I=Inbox,title,text,action})=><div className="text-center py-14 px-6"><div className="mx-auto w-12 h-12 rounded-xl bg-slate-100 grid place-items-center text-muted mb-3"><I size={22}/></div>
 <div className="font-medium">{title}</div>{text&&<div className="text-muted text-sm mt-1">{text}</div>}{action&&<div className="mt-4">{action}</div>}</div>;
export const ErrorBox=({msg,retry})=><div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 text-red-800 px-4 py-3"><AlertTriangle size={18}/><span className="flex-1">{msg}</span>{retry&&<Button v="secondary" onClick={retry}>Try again</Button>}</div>;
export function Table({cols,rows,empty,onRow,rowKey}){
 return <div className="overflow-x-auto"><table className="w-full border-collapse"><thead><tr>{cols.map((c,i)=><th key={i} className={cn('text-xs font-medium text-muted px-4 py-2.5 border-b border-line text-left whitespace-nowrap',c.right&&'text-right',c.hide&&'hidden md:table-cell')}>{c.h}</th>)}</tr></thead>
 <tbody>{rows.map((r,ri)=><tr key={rowKey?rowKey(r,ri):ri} onClick={onRow&&(()=>onRow(r))} className={cn('border-b border-slate-100 last:border-0 transition-colors',onRow&&'cursor-pointer hover:bg-slate-50')}>
  {cols.map((c,i)=><td key={i} className={cn('px-4 h-11 py-2',c.right&&'text-right num',c.hide&&'hidden md:table-cell',c.className)}>{c.r(r,ri)}</td>)}</tr>)}</tbody></table>
 {!rows.length&&empty}</div>}
export const PageHead=({title,sub,children})=><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{sub&&<div className="text-muted mt-1">{sub}</div>}</div>{children&&<div className="flex flex-wrap gap-2">{children}</div>}</div>;
export const Stat=({label,children,note,tone})=><Card className="p-5"><div className="text-[13px] font-medium text-muted">{label}</div><div className={cn('text-[26px] font-semibold my-1.5 tracking-tight',tone)}>{children}</div><div className="text-xs text-muted">{note}</div></Card>;
export function PdfSheet({pdf,onClose,extra}){return <Sheet wide open={!!pdf} onOpenChange={o=>!o&&onClose()} title={pdf?.title||''} desc={pdf?.desc}
 footer={pdf&&<>{extra}<a href={pdf.url} target="_blank" rel="noreferrer"><Button v="secondary">Open in new tab</Button></a></>}>{pdf&&<iframe title={pdf.title} src={pdf.url} className="w-full h-[75vh] rounded-lg border border-line"/>}</Sheet>}
