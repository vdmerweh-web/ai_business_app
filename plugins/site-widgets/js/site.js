(function(){var d=document,t=d.querySelector('.nav-toggle'),n=d.getElementById('nav');
if(t&&n){t.addEventListener('click',function(){var o=n.classList.toggle('open');t.setAttribute('aria-expanded',o)});d.addEventListener('keydown',function(e){if(e.key==='Escape'&&n.classList.contains('open')){n.classList.remove('open');t.setAttribute('aria-expanded','false');t.focus()}})}
var y=d.querySelector('[data-year]');if(y)y.textContent=new Date().getFullYear();
var r=d.querySelectorAll('.reveal');if(!('IntersectionObserver'in window)||matchMedia('(prefers-reduced-motion: reduce)').matches){r.forEach(function(e){e.classList.add('in')})}else{var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px'});r.forEach(function(e){io.observe(e)})}
/* Contact forms without a server: open the visitor's email app with the message filled in. */
d.querySelectorAll('form[data-mailto]').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();if(!f.reportValidity())return;var g=function(n){var x=f.elements[n];return x?x.value:''};
var body='Name: '+g('name')+'\nEmail: '+g('email')+(g('phone')?'\nPhone: '+g('phone'):'')+'\n\n'+g('message');
location.href='mailto:'+f.dataset.mailto+'?subject='+encodeURIComponent(f.dataset.subject||'Website enquiry')+'&body='+encodeURIComponent(body);
var s=f.querySelector('[role=status]');if(s)s.textContent='Your email app should open with your message. If it does not, email us at '+f.dataset.mailto+'.'})});
if(window.PG_PAGE)window.PG_PAGE();})();
