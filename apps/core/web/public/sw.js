// Cache the app shell only. API requests always go to the network (they are private and change).
const CACHE = 'cg-app-shell-v1';
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  // HTML and the rest: network first, cache fallback.
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      const c = await caches.open(CACHE);
      if (res.ok && e.request.destination === 'document') c.put('/', res.clone());
      return res;
    } catch {
      const c = await caches.open(CACHE);
      return (await c.match(e.request)) || (await c.match('/')) || Response.error();
    }
  })());
});
