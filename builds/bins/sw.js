// Bin maker service worker. The Bins page was written for the PC's web server, so it asks
// for /api/..., /files/..., /tools/... and /scans/... addresses. This catches those
// requests from the bin maker page and hands them to the page, whose background
// Python answers them. Everything else (the page itself, Pyodide from the CDN) passes through.
const VIRTUAL = /^\/(api|files|tools|scans)\//;
const PASS = /^\/api\/binmaker\//; // the site's own error-report endpoint

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("message", (e) => { if (e.data === "claim") self.clients.claim(); });

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || !VIRTUAL.test(u.pathname) || PASS.test(u.pathname)) return;
  e.respondWith(relay(e));
});

async function relay(e) {
  const client = e.clientId && (await self.clients.get(e.clientId));
  if (!client) return new Response(JSON.stringify({ error: "Open the bin maker page first." }), { status: 503, headers: { "Content-Type": "application/json" } });
  const body = e.request.method === "GET" || e.request.method === "HEAD" ? null : await e.request.arrayBuffer();
  const ch = new MessageChannel();
  const answer = new Promise((res) => { ch.port1.onmessage = (m) => res(m.data); });
  client.postMessage({ type: "req", method: e.request.method, url: e.request.url, body }, body ? [ch.port2, body] : [ch.port2]);
  const r = await answer;
  const headers = new Headers(r.headers || {});
  headers.set("Content-Type", r.ctype || "application/octet-stream");
  headers.set("Cache-Control", "no-store");
  return new Response(r.body, { status: r.status, headers });
}
