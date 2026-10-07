// Offline cache for the app shell. Bump C when any precached file changes.
const C = 'fin-v6';
const F = [
  './',
  'index.html',
  'support.js',
  'Field.dc.html',
  'vendor/react.production.min.js',
  'vendor/react-dom.production.min.js',
  '_ds/nocturne-20784bdc-6977-4a9c-b05c-2e700e589536/styles.css',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', e => e.waitUntil(
  caches.open(C).then(c => c.addAll(F)).then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(k => Promise.all(k.filter(x => x !== C).map(x => caches.delete(x))))
    .then(() => self.clients.claim())
));

// Network first, cache as fallback. Only same-origin requests are handled:
// NBU rates, Google sign-in and Drive sync go straight to the network and are
// never stored in the cache (Drive responses contain the user's data).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(r => {
        if (r.ok) { const cp = r.clone(); caches.open(C).then(c => c.put(req, cp)); }
        return r;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
