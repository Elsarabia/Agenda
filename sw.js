/* Agenda — service worker
   Guarda la app en el teléfono para que abra sin internet.
   Sube la versión cuando cambies index.html para forzar la actualización. */
const VERSION = 'agenda-v2';
const BASE = self.registration.scope;
const ESENCIALES = [BASE, BASE + 'index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ESENCIALES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ns => Promise.all(ns.filter(n => n !== VERSION).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Nunca cachear Supabase: los datos deben ser siempre frescos.
  if (url.hostname.endsWith('supabase.co')) return;

  // Documento: red primero, caché como respaldo (así ves la versión nueva al publicar).
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => {
          const copia = r.clone();
          caches.open(VERSION).then(c => c.put(req, copia));
          return r;
        })
        .catch(() => caches.match(req).then(r => r || caches.match(BASE + 'index.html')))
    );
    return;
  }

  // Fuentes y librerías: caché primero, y se actualiza en segundo plano.
  e.respondWith(
    caches.match(req).then(cacheado => {
      const red = fetch(req)
        .then(r => {
          if (r && r.status === 200) {
            const copia = r.clone();
            caches.open(VERSION).then(c => c.put(req, copia));
          }
          return r;
        })
        .catch(() => cacheado);
      return cacheado || red;
    })
  );
});
