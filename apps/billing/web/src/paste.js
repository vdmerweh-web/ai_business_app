// Cleans HTML pasted from Word, Google Docs, web pages. Keeps structure (headings, lists, bold/italic, links, tables, images), drops styling junk.
const KEEP={a:['href','title'],img:['src','alt','title'],td:['colspan','rowspan'],th:['colspan','rowspan'],ol:['start'],iframe:['src','title'],div:['data-youtube-video']};
const bold=s=>/font-weight\s*:\s*(bold|[6-9]00)/i.test(s),ital=s=>/font-style\s*:\s*italic/i.test(s);
const unwrap=e=>{const p=e.parentNode;if(!p)return;while(e.firstChild)p.insertBefore(e.firstChild,e);p.removeChild(e)};
export function cleanPaste(html){
 html=String(html||'').replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<\/?(o|w|m|v|st1):[^>]*>/gi,'');
 const doc=new DOMParser().parseFromString(html,'text/html');const B=doc.body;
 B.querySelectorAll('style,meta,link,script,title,xml,noscript,object,embed,form,input,button,select,textarea,svg').forEach(e=>e.remove());
 // Google Docs wraps everything in <b style="font-weight:normal" id="docs-internal-guid-...">
 B.querySelectorAll('[id^="docs-internal-guid"]').forEach(unwrap);
 // Word list paragraphs -> real lists
 const isWL=p=>p.tagName==='P'&&(/mso-list/i.test(p.getAttribute('style')||'')||/MsoListParagraph/i.test(p.className));
 [...B.querySelectorAll('p')].forEach(p=>{if(!isWL(p)||!p.parentNode)return;const items=[];let n=p;while(n&&n.nodeType===1&&isWL(n)){items.push(n);n=n.nextElementSibling}
  const first=items[0].textContent.trim();const ordered=/^(\d+|[a-z]|[ivx]+)[.)]/i.test(first);const L=doc.createElement(ordered?'ol':'ul');items[0].parentNode.insertBefore(L,items[0]);
  for(const it of items){it.querySelectorAll('span').forEach(s=>{if(/mso-list\s*:\s*ignore/i.test(s.getAttribute('style')||''))s.remove()});const li=doc.createElement('li');while(it.firstChild)li.appendChild(it.firstChild);
   li.innerHTML=li.innerHTML.replace(/^(\s|&nbsp;)*([·•▪o§\-–]|\d+[.)]|[a-z][.)])(\s|&nbsp;)+/i,'');L.appendChild(li);it.remove()}});
 // inline style meaning -> semantic tags, then drop styles
 [...B.querySelectorAll('span,font,b,strong,i,em,u,p,li,td,th,div')].forEach(e=>{const s=e.getAttribute('style')||'';if(!s)return;const isH=/^H\d$/.test(e.tagName);
  const tag=e.tagName;if(['B','STRONG'].includes(tag)&&/font-weight\s*:\s*(normal|[1-4]00)/i.test(s)){unwrap(e);return}
  let wrap=null;if(bold(s)&&!isH&&!['B','STRONG'].includes(tag))wrap='strong';if(ital(s)&&!['I','EM'].includes(tag))wrap=wrap?wrap+'+em':'em';
  if(wrap){for(const w of wrap.split('+').reverse()){const x=doc.createElement(w);while(e.firstChild)x.appendChild(e.firstChild);e.appendChild(x)}}});
 [...B.querySelectorAll('span,font,u,ins,del,small,big,abbr,section,article,header,footer,main,center,label')].forEach(e=>{if(e.tagName==='U'&&e.closest('a'))return unwrap(e);if(e.tagName!=='U')unwrap(e)});
 B.querySelectorAll('h1').forEach(h=>{const x=doc.createElement('h2');x.innerHTML=h.innerHTML;h.replaceWith(x)});
 B.querySelectorAll('h5,h6').forEach(h=>{const x=doc.createElement('h4');x.innerHTML=h.innerHTML;h.replaceWith(x)});
 B.querySelectorAll('*').forEach(e=>{const k=KEEP[e.tagName.toLowerCase()]||[];for(const a of [...e.attributes])if(!k.includes(a.name))e.removeAttribute(a.name);
  if(e.tagName==='A'&&!/^(https?:|mailto:|tel:|#|\/)/i.test(e.getAttribute('href')||''))e.removeAttribute('href')});
 // Google Docs puts <p> inside <li>, and <br> paragraphs between blocks
 B.querySelectorAll('li>p:only-child').forEach(unwrap);
 B.querySelectorAll('p,h2,h3,h4,li,div').forEach(e=>{if(!e.textContent.replace(/\u00a0/g,'').trim()&&!e.querySelector('img,iframe,br+br,table'))e.remove()});
 B.querySelectorAll('div').forEach(d=>{if(d.hasAttribute('data-youtube-video'))return;if(d.querySelector('p,div,h2,h3,h4,ul,ol,table,blockquote,pre'))unwrap(d);else{const x=doc.createElement('p');x.innerHTML=d.innerHTML;d.replaceWith(x)}});
 return B.innerHTML.replace(/&nbsp;/g,' ');}
