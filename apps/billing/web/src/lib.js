export const api=async(p,o={})=>{const r=await fetch('/api'+p,{credentials:'include',headers:{'Content-Type':'application/json'},...o,body:o.body&&JSON.stringify(o.body)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||r.statusText);return d};
export const R=n=>{const v=Number(n||0);const s=Math.abs(v).toFixed(2).split('.');return (v<0?'-':'')+'R '+s[0].replace(/\B(?=(\d{3})+(?!\d))/g,' ')+'.'+s[1]};
export const today=()=>new Date().toLocaleDateString('en-CA');
export const nextMonth=()=>{const d=new Date();d.setDate(1);d.setMonth(d.getMonth()+1);return d.toLocaleDateString('en-CA').slice(0,7)};
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const fmtDate=s=>{if(!s)return '';const[y,m,d]=s.slice(0,10).split('-');return `${+d} ${MN[m-1]} ${y}`};
export const monthName=ym=>{const[y,m]=ym.split('-');return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m-1]} ${y}`};
export const asset=p=>import.meta.env.BASE_URL+p;
// Read-only analysis of a client's ledger: FIFO-allocate credits to oldest debits. Display only; billing numbers come from the API.
export function analyse(entries,days=30){const debits=[];let credit=0;
 for(const e of entries){if(e.dt_account==='DEBTORS')debits.push({...e,open:e.amount});else if(e.kt_account==='DEBTORS')credit+=e.amount;}
 for(const d of debits){const u=Math.min(d.open,credit);d.open=Math.round((d.open-u)*100)/100;credit-=u;}
 const cut=new Date();cut.setDate(cut.getDate()-days);const cutS=cut.toLocaleDateString('en-CA');
 const overdue=debits.filter(d=>d.open>0&&d.tdate<cutS).reduce((a,d)=>a+d.open,0);
 const oldest=debits.find(d=>d.open>0);const inv={};for(const d of debits)if(d.invoice_no){(inv[d.invoice_no]??={open:0,date:d.tdate});inv[d.invoice_no].open+=d.open;}
 const pays=entries.filter(e=>e.kind==='payment'||(e.dt_account==='BANK'&&e.kt_account==='DEBTORS'));
 return{overdue:Math.round(overdue*100)/100,oldest:oldest?.tdate,invOpen:inv,lastPay:pays[pays.length-1]};}
export const ageDays=d=>d?Math.floor((Date.now()-new Date(d))/864e5):0;
export function clientStatus(bal,overdue){if(bal<-0.004)return['credit','In credit'];if(bal<0.005)return['paid','Paid up'];if(overdue>0)return['over','Overdue'];return['due','Due'];}
export function invStatus(i,open){if(open==null||open<0.005)return['paid','Paid'];if(ageDays(i.inv_date)>30)return['over','Overdue'];return['due','Due'];}
