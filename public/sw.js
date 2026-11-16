// Guarda la estructura de la app para que abra rápido y sin conexión. Los datos (API) siempre van a la red.
const VERSION = 'puntual-v1';
const BASE = ['/css/base.css', '/css/panel.css', '/css/reserva.css', '/js/comun.js', '/js/reserva.js', '/js/panel/app.js',
  '/fonts/inter-regular.woff', '/fonts/inter-medium.woff', '/fonts/inter-semibold.woff', '/fonts/inter-display-semibold.woff', '/fonts/inter-display-medium.woff', '/img/icono.svg'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(BASE)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && !r.redirected) { const copia = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copia)); }
    return r;
  }).catch(() => caches.match(e.request)));
});
