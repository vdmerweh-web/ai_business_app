import {q,pool,settings,balance,SIGN} from './db.js';
const MON=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const ym=s=>{const[y,m]=s.split('-').map(Number);if(!y||!m||m>12)throw new Error('bad month');return{y,m}};
const iso=(y,m,d=1)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
// Build invoices for a month (not saved)
export async function buildRun(month,clientId){
 const{y,m}=ym(month);const first=iso(y,m),last=iso(y,m+1,0);
 const rows=await q(`select k.*,c.name,c.ref from contracts k join clients c on c.id=k.client_id where c.active and not c.no_charge and k.start_date<=$1 and (k.end_date is null or k.end_date>=$2) ${clientId?'and c.id=$3':''} order by c.name,k.id`,clientId?[last,first,clientId]:[last,first]);
 const done=new Set((await q('select client_id from invoices where period=$1',[month])).map(r=>r.client_id));
 const inv={};
 for(const k of rows){if(done.has(k.client_id))continue;
  if(k.freq==='yearly'&&new Date(k.start_date).getUTCMonth()+1!==m)continue;
  const desc=k.freq==='yearly'?`${k.description} for year ${y}/${y+1}`:`${k.description} for ${MON[m-1]} ${y}`;
  (inv[k.client_id]??={client_id:k.client_id,name:k.name,ref:k.ref,inv_date:first,period:month,lines:[]}).lines.push({description:desc,amount:+k.amount,account:k.account});}
 return Object.values(inv).map(i=>({...i,total:i.lines.reduce((a,l)=>a+l.amount,0)}));
}
export async function finalise(month){
 const run=await buildRun(month);const c=await pool.connect();const out=[];
 try{await c.query('begin');await c.query('lock table invoices');
  let n=+(await c.query(`select value from settings where key='next_invoice_no' for update`)).rows[0].value;
  for(const i of run){const no=n++;
   const{rows:[r]}=await c.query('insert into invoices(number,client_id,inv_date,period,total) values($1,$2,$3,$4,$5) returning id',[no,i.client_id,i.inv_date,i.period,i.total]);
   for(const l of i.lines){await c.query('insert into invoice_lines(invoice_id,description,amount,account) values($1,$2,$3,$4)',[r.id,l.description,l.amount,l.account]);
    await c.query(`insert into entries(tdate,client_id,description,dt_account,kt_account,amount,invoice_no,kind) values($1,$2,$3,'DEBTORS',$4,$5,$6,'invoice')`,[i.inv_date,i.client_id,l.description,l.account,l.amount,no]);}
   out.push({...i,number:no});}
  await c.query(`update settings set value=$1 where key='next_invoice_no'`,[String(n)]);await c.query('commit');}
 catch(e){await c.query('rollback');throw e}finally{c.release()}return out;
}
export async function statementData(cid,month,draft){
 if((await q('select no_charge from clients where id=$1',[cid]))[0]?.no_charge)throw new Error('No-charge test account: no statements');
 // Statement for month M: 6 months, from the 1st of M-5 up to and INCLUDING the 1st of M+1 (billing date), so the next invoice run and anything booked before it shows.
 const{y,m}=ym(month);const from=iso(y,m-5),to=iso(y,m+1,1);
 const opening=await balance(cid,from);
 const tx=await q(`select tdate::text,description,invoice_no,case when dt_account='DEBTORS' then amount else 0 end::float debit,case when kt_account='DEBTORS' then amount else 0 end::float credit from entries where client_id=$1 and tdate>=$2 and tdate<=$3 order by tdate,id`,[cid,from,to]);
 if(draft)for(const l of draft.lines)tx.push({tdate:draft.inv_date,description:l.description,invoice_no:'DRAFT',debit:l.amount,credit:0});
 tx.sort((a,b)=>a.tdate<b.tdate?-1:a.tdate>b.tdate?1:0);
 let b=opening;for(const t of tx){b+=t.debit-t.credit;t.balance=b}
 return{from,to,opening,tx,closing:b};
}
// Once-off invoice: same numbering (settings.next_invoice_no, locked) and same ledger booking as finalise().
// No VAT line: like monthly invoices, the PDF carries settings.vat_note (planet-grid.com is not VAT registered).
export async function onceOff(clientId,invDate,lines){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(invDate||''))||isNaN(Date.parse(invDate)))throw new Error('Pick a valid invoice date');
 if(!Array.isArray(lines)||!lines.length||lines.length>50)throw new Error('Add at least one line');
 const ls=lines.map(l=>{const qty=+l.qty||1,unit=+l.unit_price,d=String(l.description||'').trim();
  if(!d)throw new Error('Every line needs a description');if(!(qty>0)||!(unit>0))throw new Error('Quantity and unit price must be more than 0');
  return{description:qty===1?d:`${qty} x ${d}`,amount:Math.round(qty*unit*100)/100,account:'SALES-OTHER'}});
 const total=Math.round(ls.reduce((a,l)=>a+l.amount,0)*100)/100;const c=await pool.connect();
 try{await c.query('begin');await c.query('lock table invoices');
  const[cl]=(await c.query('select id,no_charge,active from clients where id=$1',[clientId])).rows;if(!cl)throw new Error('No such client');if(cl.no_charge)throw new Error('No-charge test account: no invoices');if(cl.active===false)throw new Error('This client is inactive: no invoices');
  const no=+(await c.query(`select value from settings where key='next_invoice_no' for update`)).rows[0].value;
  const{rows:[r]}=await c.query('insert into invoices(number,client_id,inv_date,period,total) values($1,$2,$3,null,$4) returning id',[no,clientId,invDate,total]);
  for(const l of ls){await c.query('insert into invoice_lines(invoice_id,description,amount,account) values($1,$2,$3,$4)',[r.id,l.description,l.amount,l.account]);
   await c.query(`insert into entries(tdate,client_id,description,dt_account,kt_account,amount,invoice_no,kind) values($1,$2,$3,'DEBTORS',$4,$5,$6,'invoice')`,[invDate,clientId,l.description,l.account,l.amount,no]);}
  await c.query(`update settings set value=$1 where key='next_invoice_no'`,[String(no+1)]);await c.query('commit');
  return{number:no,client_id:+clientId,inv_date:invDate,lines:ls,total};}
 catch(e){await c.query('rollback');throw e}finally{c.release()}
}
