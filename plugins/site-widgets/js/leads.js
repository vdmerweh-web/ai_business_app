/* Lead forms: <form data-leads data-source="..." data-fallback="email@x"> posts JSON to the Planet Grid CRM
   (POST https://api.planet-grid.com/public/leads, planned endpoint). If it is not live or fails, the visitor's
   email app opens with the message instead, so no lead is lost. */
(function(){var API=(document.documentElement.dataset.leadsApi)||'https://api.planet-grid.com/public/leads';
var qs=new URLSearchParams(location.search),utm={};['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function(k){var v=qs.get(k)||sessionStorage.getItem(k);if(v){utm[k]=v;try{sessionStorage.setItem(k,v)}catch(e){}}});
document.querySelectorAll('form[data-leads]').forEach(function(f){f.setAttribute('novalidate','');f.addEventListener('submit',function(e){e.preventDefault();var st=f.querySelector('[role=status]'),b=f.querySelector('[type=submit]');
if(!f.checkValidity()){var bad=f.querySelector(':invalid');if(st)st.textContent='Please fill in: '+(bad&&bad.labels&&bad.labels[0]?bad.labels[0].textContent.trim():'the required fields')+'.';if(bad)bad.focus();return}
var g=function(n){var x=f.elements[n];return x?(x.type==='checkbox'?x.checked:x.value.trim()):''};
var d={name:g('name'),email:g('email'),phone:g('phone'),company:g('company'),website:g('website'),message:g('message'),source:f.dataset.source||'form',page:location.href.split('?')[0],site:location.hostname,utm:utm,
consent:{contact:true,marketing:!!g('consent_marketing'),text:(function(){var c=f.querySelector('[name=consent_marketing]');return c&&c.labels&&c.labels[0]?c.labels[0].textContent.trim():''})(),at:new Date().toISOString()},hp:g('company_url')};
if(d.hp)return; b.disabled=true;if(st)st.textContent='Sending…';
var done=function(){f.reset();b.disabled=false;if(st)st.textContent=f.dataset.thanks||'Thank you. We will be in touch within one working day.'};
var fallback=function(){b.disabled=false;var to=f.dataset.fallback;if(!to){if(st)st.textContent='Sorry, that did not send. Please try again later.';return}
location.href='mailto:'+to+'?subject='+encodeURIComponent((f.dataset.source||'Website')+' enquiry')+'&body='+encodeURIComponent(['Name: '+d.name,'Email: '+d.email,'Phone: '+d.phone,'Company: '+d.company,'Website: '+d.website,'Marketing OK: '+(d.consent.marketing?'yes':'no'),'',d.message].join('\n'));
if(st)st.textContent='Our form is not connected yet, so your email app should open with your message. If not, email '+to+'.'};
fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d),mode:'cors'}).then(function(r){r.ok?done():fallback()},fallback)})})})();
