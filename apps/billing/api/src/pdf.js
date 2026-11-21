import PDFDocument from 'pdfkit';
// Layout follows Hannes's old Access invoices/statements.
const R=n=>{const v=Number(n);return (v<0?'R -':'R ')+Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,' ')};
const D=s=>String(s).slice(0,10).replace(/-/g,'/');
const BAR='#0b3a44',LINE='#9aa5a8';
const LOGO=new URL('../assets/logo-mono.jpg',import.meta.url).pathname;
function head(doc,s,c){
 doc.image(LOGO,45,30,{width:190});
 const right=[s.owner_name,s.owner_title,s.email,s.phone].filter(Boolean).join('\n');
 doc.font('Times-Roman').fontSize(10.5).fillColor(BAR).text(right,300,40,{width:250,align:'right'});
 doc.moveDown(1).text(s.bank_details||'',300,doc.y,{width:250,align:'right'});
 doc.font('Times-Roman').fontSize(20).fillColor(BAR).text(c.name.toUpperCase(),45,200,{width:505,align:'center',characterSpacing:1});
}
function footer(doc){const r=doc.page.margins.bottom;doc.page.margins.bottom=0;
 const y=doc.page.height-45;doc.rect(25,y,545,26).fill(BAR);
 doc.fillColor('#fff').font('Helvetica-Bold').fontSize(8).text(new Date().toLocaleDateString('en-ZA',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Africa/Johannesburg'}),35,y+9,{lineBreak:false});
 doc.rect(535,y+5,22,16).fill('#fff');doc.fillColor(BAR).text(String(doc.bufferedPageRange().count),535,y+9,{width:22,align:'center',lineBreak:false});doc.page.margins.bottom=r;}
function table(doc,cols,rows,y){
 const hdr=()=>{doc.rect(45,y,505,16).lineWidth(0.6).stroke(BAR);doc.font('Helvetica').fontSize(8).fillColor('#222');
  cols.forEach(c=>doc.text(c.h,c.x,y+4,{width:c.w,align:c.a||'left'}));y+=24};
 hdr();rows.forEach((r,i)=>{if(y>740){footer(doc);doc.addPage();y=50;hdr()}
  if(r.shade)doc.rect(45,y-3,505,15).fill('#eef1f2');
  doc.font(r.bold?'Helvetica-BoldOblique':'Helvetica').fontSize(8).fillColor(r.color||'#222');
  r.cells.forEach((t,j)=>doc.text(String(t??''),cols[j].x,y,{width:cols[j].w,align:cols[j].a||'left',lineBreak:false,ellipsis:true}));y+=r.gap||15});
 return y;
}
function totalBar(doc,y,label,val){doc.rect(45,y,505,20).fill(BAR);doc.rect(440,y+3,106,14).fill('#fff');
 doc.font('Helvetica-BoldOblique').fontSize(9).fillColor('#fff').text(label,250,y+6,{width:180,align:'right'});
 doc.fillColor(BAR).text(R(val),440,y+6,{width:102,align:'right'});return y+28}
function payRef(doc,s,c,y){doc.font('Helvetica-Bold').fontSize(9).fillColor('#222').text(`* ${s.vat_note||''}`,45,y,{width:505,align:'right'})
 .text(`Please use reference ${c.name||c.ref} when you pay.`,45,y+14,{width:505,align:'right'});}
const done=doc=>new Promise(r=>{const b=[];doc.on('data',d=>b.push(d));doc.on('end',()=>r(Buffer.concat(b)));footer(doc);doc.end()});
export function invoicePdf(s,c,inv){
 const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true});head(doc,s,c);
 doc.font('Times-Bold').fontSize(11).fillColor(BAR).text(`Invoice # ${inv.number||'DRAFT'}`,55,232);
 doc.font('Helvetica-Bold').fontSize(13).fillColor(BAR).text(inv.number?'Invoice':'Invoice (DRAFT)',45,232,{width:505,align:'center'});
 const cols=[{h:'Date',x:55,w:70},{h:'Description',x:135,w:250},{h:'Amount',x:385,w:75,a:'right'},{h:'Total',x:465,w:75,a:'right'}];
 let run=0;const rows=inv.lines.map(l=>{run+=l.amount;return{cells:[D(inv.inv_date),l.description,R(l.amount),R(run)]}});rows[0].gap=15;
 let y=table(doc,cols,rows,252);y=totalBar(doc,y+15,'Invoice Total',inv.total);payRef(doc,s,c,y);return done(doc);
}
export function statementPdf(s,c,st){
 const doc=new PDFDocument({size:'A4',margin:40,bufferPages:true});head(doc,s,c);
 doc.font('Times-Bold').fontSize(11).fillColor(BAR).text('STATEMENT',45,232);
 doc.font('Helvetica-Bold').fontSize(11).text(`${D(st.from)} - ${D(st.to)}`,45,246,{width:505,align:'center'});
 const cols=[{h:'Date',x:55,w:60},{h:'Description',x:120,w:220},{h:'DT',x:335,w:65,a:'right'},{h:'CT',x:400,w:65,a:'right'},{h:'Balance',x:470,w:72,a:'right'}];
 const rows=[{cells:[D(st.from),'Balance brought forward','','',R(st.opening)],bold:true,color:'#e07b20',gap:24},
  ...st.tx.map((t,i)=>({shade:i%2==1,cells:[D(t.tdate),t.description+(t.invoice_no?` (Inv #${t.invoice_no})`:''),t.debit?R(t.debit):'',t.credit?R(t.credit):'',R(t.balance)]}))];
 let y=table(doc,cols,rows,266);y=totalBar(doc,y+15,st.closing<0?'Closing Balance (in credit)':'Closing Balance',st.closing);payRef(doc,s,c,y);return done(doc);
}
