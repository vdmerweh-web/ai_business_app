// Planet Grid service worker. Caches only static files + the offline page. Never caches /api or page data.
const V='pg-static-v1';const PRE=['/offline.html','/offline.js','/favicon-192.png','/favicon-512.png','/manifest.webmanifest'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(PRE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
 if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return; // network only, never cached
 if(r.mode==='navigate'){e.respondWith(fetch(r).catch(()=>caches.match('/offline.html')));return} // network-first pages, offline fallback
 if(u.pathname.startsWith('/assets/')||/\.(png|ico|jpg|svg|woff2?)$/.test(u.pathname)){e.respondWith(caches.match(r).then(c=>c||fetch(r).then(res=>{if(res.ok){const cl=res.clone();caches.open(V).then(c=>c.put(r,cl))}return res})))}});
self.addEventListener('push',e=>{let d={};try{d=e.data?e.data.json():{}}catch{d={body:e.data&&e.data.text()}}
 e.waitUntil(self.registration.showNotification(d.title||'Planet Grid',{body:d.body||'',icon:'/favicon-192.png',badge:'/favicon-192.png',tag:d.tag,data:{url:d.url||'/'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=new URL(e.notification.data?.url||'/',location.origin);if(url.origin!==location.origin)url.href=location.origin+'/';
 e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{for(const w of ws){if('focus' in w){w.navigate&&w.navigate(url.href).catch(()=>{});return w.focus()}}return self.clients.openWindow(url.href)}))});
