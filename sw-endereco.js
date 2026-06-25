const CACHE_NAME = 'coletor-endereco-v2';
const ASSETS = [
  './coletor_endereco.html',
  './manifest-endereco.json',
  './icons/endereco-192.png',
  './icons/endereco-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Navegações usam network-first para não abrir uma versão antiga do coletor.
// Demais assets continuam em stale-while-revalidate.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp.ok) caches.open(CACHE_NAME).then((c) => c.put(e.request, resp.clone()));
          return resp;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request)
        .then((resp) => {
          if (resp.ok) caches.open(CACHE_NAME).then((c) => c.put(e.request, resp.clone()));
          return resp;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});
