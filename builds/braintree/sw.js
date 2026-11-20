// Brain Tree offline support: keeps the app's own files on the device so it opens with no signal.
// Your data isn't here (that's in IndexedDB); /api/ requests always go to the network.
// Bump VERSION whenever any file below changes, so devices pick up the new copy.

const VERSION = 'braintree-0.7.1';
const FILES = ['./', 'app.js', 'store.js', 'editor.js', 'board.js', 'theme.js', 'media.js', 'draw.js', 'example.js', 'gestures.js', 'sheet.js', 'attach.js', 'export.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('braintree-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  // Pages (any address in the app) get the cached app shell; other files come from the cache first.
  const key = req.mode === 'navigate' ? new Request(scope) : req;
  event.respondWith(caches.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
