/* Planet Grid cookie consent v1. POPIA + GDPR/ePrivacy friendly.
 * Non-essential scripts must be written as:
 *   <script type="text/plain" data-consent="analytics" src="..."></script>
 * They only run after the visitor allows that category. Nothing non-essential runs before consent.
 * Options: <script src="consent.js" data-site="example.co.za" data-policy="/cookies.html" data-log="https://api.planet-grid.com/public/consent"></script>
 */
(function(){
var VER='1',KEY='pg_consent',me=document.currentScript||{dataset:{}},ds=me.dataset||{};
var SITE=ds.site||location.hostname,POLICY=ds.policy||'/cookies.html',LOG=ds.log||'https://api.planet-grid.com/public/consent';
var CATS=[['necessary','Necessary','Needed for the site to work, like keeping you logged in. Always on.'],
 ['analytics','Analytics','Helps us see how the site is used so we can improve it.'],
 ['marketing','Marketing','Used to show you relevant adverts and measure campaigns.']];
function get(){try{var c=JSON.parse(localStorage.getItem(KEY));return c&&c.v===VER?c:null}catch(e){return null}}
function run(c){document.querySelectorAll('script[type="text/plain"][data-consent]').forEach(function(s){
 if(!c[s.dataset.consent]||s.dataset.done)return;s.dataset.done=1;var n=document.createElement('script');
 for(var i=0;i<s.attributes.length;i++){var a=s.attributes[i];if(a.name!=='type')n.setAttribute(a.name,a.value)}n.text=s.text;s.parentNode.insertBefore(n,s.nextSibling)});
 document.dispatchEvent(new CustomEvent('pg-consent',{detail:c}))}
function save(ch,how){var c={v:VER,necessary:true,analytics:!!ch.analytics,marketing:!!ch.marketing,at:new Date().toISOString(),id:(get()||{}).id||(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2))};
 try{localStorage.setItem(KEY,JSON.stringify(c))}catch(e){}
 try{fetch(LOG,{method:'POST',mode:'cors',credentials:'omit',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({site:SITE,consent_id:c.id,version:VER,analytics:c.analytics,marketing:c.marketing,action:how})}).catch(function(){})}catch(e){}
 close();run(c);if(!c.analytics||!c.marketing)wipe(c)}
function wipe(c){/* best effort: remove common analytics/ad cookies after a withdrawal */
 document.cookie.split(';').forEach(function(k){k=k.split('=')[0].trim();if(/^(_ga|_gid|_gat|_fbp|_fbc|_gcl)/.test(k)&&!(c.analytics&&/^_g/.test(k))){var h=location.hostname.split('.');for(var i=0;i<h.length-1;i++)document.cookie=k+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;domain=.'+h.slice(i).join('.');document.cookie=k+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/'}})}
var css='#pgc{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:12px;max-width:560px;margin:0 auto;background:#06122A;color:#fff;border-radius:14px;padding:18px 18px 14px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35);animation:pgcin .35s ease-out}'+
'#pgc h2{margin:0 0 6px;font-size:17px}#pgc p{margin:0 0 12px}#pgc a{color:#8fd3ff}#pgc .r{display:flex;flex-wrap:wrap;gap:8px}'+
'#pgc button{font:inherit;border-radius:9px;padding:9px 14px;border:2px solid #8fd3ff;background:transparent;color:#fff;cursor:pointer}#pgc button.p{background:#8fd3ff;color:#06122A;font-weight:600}'+
'#pgc button:focus-visible,#pgcl:focus-visible,#pgc input:focus-visible{outline:3px solid #ffd166;outline-offset:2px}#pgc fieldset{border:0;padding:0;margin:0 0 12px}#pgc label{display:block;margin:6px 0}#pgc small{display:block;opacity:.8;margin-left:26px}'+
'#pgcl{position:fixed;z-index:2147482999;left:10px;bottom:10px;font:13px system-ui,sans-serif;background:#06122A;color:#fff;border:0;border-radius:20px;padding:6px 12px;opacity:.85;cursor:pointer}'+
'@keyframes pgcin{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}@media (prefers-reduced-motion:reduce){#pgc{animation:none}}';
var last;
function close(){var b=document.getElementById('pgc');if(b)b.remove();if(last&&last.focus)last.focus();link()}
function open(custom){close();last=document.activeElement;var c=get()||{};var d=document.createElement('div');d.id='pgc';d.setAttribute('role','dialog');d.setAttribute('aria-modal','false');d.setAttribute('aria-labelledby','pgc-t');d.setAttribute('aria-describedby','pgc-d');
 var h='<h2 id="pgc-t">Cookies on this site</h2><p id="pgc-d">We use necessary cookies to make this site work. With your permission we would also like to use analytics and marketing cookies. You can change your mind at any time. <a href="'+POLICY+'">Read our cookie policy</a>.</p>';
 if(custom){h+='<fieldset><legend class="sr-only" style="position:absolute;left:-9999px">Choose cookie types</legend>';CATS.forEach(function(k){var on=k[0]==='necessary'||c[k[0]];
  h+='<label><input type="checkbox" name="'+k[0]+'"'+(on?' checked':'')+(k[0]==='necessary'?' disabled aria-describedby="pgc-'+k[0]+'"':' aria-describedby="pgc-'+k[0]+'"')+'> '+k[1]+'</label><small id="pgc-'+k[0]+'">'+k[2]+'</small>'});
  h+='</fieldset><div class="r"><button type="button" class="p" data-a="save">Save my choices</button><button type="button" data-a="reject">Reject all</button><button type="button" data-a="accept">Accept all</button></div>'}
 else h+='<div class="r"><button type="button" class="p" data-a="accept">Accept all</button><button type="button" data-a="reject">Reject all</button><button type="button" data-a="custom">Customise</button></div>';
 d.innerHTML=h;document.body.appendChild(d);var l=document.getElementById('pgcl');if(l)l.remove();
 d.addEventListener('click',function(e){var a=e.target.getAttribute&&e.target.getAttribute('data-a');if(!a)return;
  if(a==='accept')save({analytics:1,marketing:1},'accept_all');else if(a==='reject')save({},'reject_all');else if(a==='custom')open(true);
  else save({analytics:d.querySelector('[name=analytics]').checked,marketing:d.querySelector('[name=marketing]').checked},'custom')});
 
 var f=d.querySelector('button,input:not([disabled])');if(f)f.focus({preventScroll:true})}
function link(){/* v1.1: no floating button by default; sites put a data-cookie-settings link in the footer/menu. Opt back in with data-link="float". */if(document.getElementById('pgcl')||ds.link!=='float')return;var b=document.createElement('button');b.id='pgcl';b.type='button';b.textContent='Cookie settings';b.setAttribute('aria-label','Open cookie settings');b.onclick=function(){open(true)};document.body.appendChild(b)}
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&document.getElementById('pgc')&&get())close()});
window.pgConsent={open:function(){open(true)},get:get};
function start(){var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);
 document.querySelectorAll('[data-cookie-settings]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();open(true)})});
 var c=get();if(c){run(c);link()}else open(false)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
