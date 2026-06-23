const CACHE_NAME = 'coletor-endereco-v1';
const ASSETS = [
  './coletor_endereco.html',
  './manifest-endereco.json',
  './icons/endereco-192.png',
  './icons/endereco-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
});

// Stale-while-revalidate: responde do cache na hora, atualiza em segundo plano.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
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
