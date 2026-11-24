// Brain Tree offline support: keeps the app's own files on the device so it opens with no signal.
// Your data isn't here (that's in IndexedDB); /api/ requests always go to the network.
// Bump VERSION whenever any file below changes, so devices pick up the new copy.

const VERSION = 'braintree-0.9.1';
const FILES = ['./', 'app.js', 'store.js', 'editor.js', 'board.js', 'theme.js', 'media.js', 'draw.js', 'example.js', 'gestures.js', 'sheet.js', 'attach.js', 'export.js', 'preview.js', 'record.js', 'search.js', 'plan.js', 'timeline.js', 'remind.js', 'widget.js', 'styles.css', 'manifest.webmanifest', 'icon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];
// (0.7.9) Mozilla's pdf.js, for pictures of PDFs on boards: fetched the first time it's needed, then
// kept here (under its own name, so a new version of Brain Tree doesn't throw it away).
const LIB = 'bt-lib-pdfjs-4.10.38';
const LIB_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith('braintree-') && k !== VERSION) || (k.startsWith('bt-lib-pdfjs-') && k !== LIB)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// (0.9.0) Reminders: the server sends them (web push) even when Brain Tree is closed.
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'Brain Tree', { body: d.body || '', tag: d.tag || undefined, data: { url: d.url || '' }, icon: 'icon-192.png', badge: 'icon-192.png' }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const hash = event.notification.data?.url || '';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.registration.scope));
    if (open) { open.postMessage({ go: hash }); return open.focus(); }
    return self.clients.openWindow(self.registration.scope + hash);
  }));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === 'GET' && url.href.startsWith(LIB_URL)) {
    event.respondWith(caches.open(LIB).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
    return;
  }
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  // (0.9.0) a read-only link's page is its own page, not the app
  if (url.pathname.startsWith(scope + 'share')) return;
  // Pages (any address in the app) get the cached app shell; other files come from the cache first.
  const key = req.mode === 'navigate' ? new Request(scope) : req;
  event.respondWith(caches.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
