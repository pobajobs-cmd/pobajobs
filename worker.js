// pobajobs.co.uk: serves the site files, plus one small API for the Pobcast's "Suggest a topic" box.
// Only /api/... addresses reach this code (see wrangler.jsonc); everything else is a plain file.
//
// Suggestions are stored in the "pobajobs" D1 database. To read them:
//   Cloudflare dashboard > Storage & databases > D1 > pobajobs > Console, then run
//   SELECT created_at, name, topic FROM suggestions ORDER BY id DESC;

const MAX_TOPIC = 500;
const MAX_NAME = 60;
const PER_HOUR = 5; // suggestions allowed from one connection per hour

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/pobcast/suggest') return suggest(request, env, url);
    if (url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function suggest(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'Send suggestions with the form on /pobcast/.' }, 405, { Allow: 'POST' });

  // Only accept the site's own form
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return json({ error: 'Suggestions can only be sent from pobajobs.co.uk.' }, 403);
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) return json({ error: 'Unexpected format.' }, 415);

  const raw = await request.text();
  if (raw.length > 4000) return json({ error: 'That suggestion is too long.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'Unexpected format.' }, 400); }

  // Bots fill in the hidden "website" box; say thanks and drop it.
  if (body.website) return json({ ok: true });

  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
  const topic = clean(body.topic, MAX_TOPIC);
  const name = clean(body.name, MAX_NAME);
  if (topic.length < 3) return json({ error: 'Type a topic first.' }, 400);

  await ensureSchema(env.DB);

  const ipHash = await sha256('pobcast:' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM suggestions WHERE ip_hash = ? AND created_at > ?').bind(ipHash, hourAgo).all();
  if ((results[0]?.n || 0) >= PER_HOUR) return json({ error: 'Easy, tiger. That’s a lot of ideas. Try again in an hour.' }, 429);

  await env.DB.prepare('INSERT INTO suggestions (topic, name, created_at, ip_hash) VALUES (?, ?, ?, ?)')
    .bind(topic, name || null, new Date().toISOString(), ipHash).run();
  return json({ ok: true });
}

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL,
      ip_hash TEXT
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS suggestions_ip_time ON suggestions (ip_hash, created_at)'),
  ]);
  schemaReady = true;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
