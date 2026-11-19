// Brain Tree (/builds/braintree/): the sync API behind the personal planner.
//
// Each device keeps its own full copy (so it works offline) and swaps changes through
// POST /api/braintree/sync. Every saved change gets the next number in one running sequence
// ("rev"), so a device only has to ask "what changed since number N?".
// A change made on top of an out-of-date copy isn't applied: it comes back as a conflict and
// the device shows both versions so you can pick.
//
// Data lives in the "pobajobs" D1 database, tables bt_items / bt_files / bt_meta / bt_logins.
// Sign-in is one password, kept as the Worker secret BRAINTREE_PASSWORD
// (Cloudflare dashboard > Workers & Pages > pobajobs > Settings > Variables and secrets).
// Changing that password signs every device out.
//
// Not published as a site file (see .assetsignore); worker.js imports it.

const TOKEN_DAYS = 400;          // how long a device stays signed in
const MAX_FILE = 1_900_000;      // bytes per photo (D1 rows top out at 2 MB; the app shrinks photos well under this)
const MAX_ITEM = 900_000;        // bytes of JSON per item
const MAX_CHANGES = 200;         // changes accepted per sync request
const PAGE = 500;                // changes sent back per sync request
const FAILS_PER_HOUR = 10;       // wrong passwords allowed from one connection per hour
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function handleBraintree(request, env, url) {
  try {
    if (!env.BRAINTREE_PASSWORD) return json({ error: 'Brain Tree isn’t set up yet: add the BRAINTREE_PASSWORD secret to the pobajobs Worker.' }, 503);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Forbidden.' }, 403);

    const path = url.pathname.slice('/api/braintree'.length) || '/';
    await ensureSchema(env.DB);

    if (path === '/login') return await login(request, env);
    if (!(await signedIn(request, env))) return json({ error: 'Please sign in.' }, 401);

    if (path === '/sync') return await sync(request, env);
    if (path === '/files') return await putFile(request, env, url);
    if (path.startsWith('/files/')) return await getFile(env, path.slice('/files/'.length));
    if (path === '/stats') return await stats(env);
    if (path === '/ping') return json({ ok: true });
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    return json({ error: 'Server error: ' + (e && e.message ? e.message : String(e)) }, 500);
  }
}

// ---------- Sign-in ----------

async function login(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405, { Allow: 'POST' });
  const ipHash = await sha256('braintree:' + (request.headers.get('CF-Connecting-IP') || 'unknown'));
  const hourAgo = new Date(Date.now() - 3600e3).toISOString();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM bt_logins WHERE ip_hash = ? AND at > ?').bind(ipHash, hourAgo).first();
  if ((row?.n || 0) >= FAILS_PER_HOUR) return json({ error: 'Too many wrong passwords. Try again in an hour.' }, 429);

  let body;
  try { body = JSON.parse(await request.text()); } catch (e) { return json({ error: 'Unexpected format.' }, 400); }
  if (!(await sameText(String(body.password ?? ''), env.BRAINTREE_PASSWORD))) {
    await env.DB.prepare('INSERT INTO bt_logins (ip_hash, at) VALUES (?, ?)').bind(ipHash, new Date().toISOString()).run();
    return json({ error: 'That password isn’t right.' }, 401);
  }
  await env.DB.prepare('DELETE FROM bt_logins WHERE at < ?').bind(new Date(Date.now() - 86400e3).toISOString()).run();
  const expires = Date.now() + TOKEN_DAYS * 86400e3;
  return json({ token: `${expires}.${await hmac(env.BRAINTREE_PASSWORD, 'braintree-token:' + expires)}`, expires });
}

async function signedIn(request, env) {
  const m = /^Bearer\s+(\d+)\.([0-9a-f]{64})$/.exec(request.headers.get('Authorization') || '');
  if (!m || Number(m[1]) < Date.now()) return false;
  return sameText(m[2], await hmac(env.BRAINTREE_PASSWORD, 'braintree-token:' + m[1]));
}

// ---------- Sync ----------

async function sync(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405, { Allow: 'POST' });
  const raw = await request.text();
  if (raw.length > 20_000_000) return json({ error: 'Too much at once.' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ error: 'Unexpected format.' }, 400); }

  const since = Math.max(0, Math.floor(Number(body.since) || 0));
  const device = clean(body.device, 60);
  const changes = Array.isArray(body.changes) ? body.changes.slice(0, MAX_CHANGES) : [];
  const accepted = [], conflicts = [], rejected = [];
  const now = new Date().toISOString();
  const upsert = env.DB.prepare(`INSERT INTO bt_items (id, rev, data, deleted, updated_at, device) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, data = excluded.data, deleted = excluded.deleted,
    updated_at = excluded.updated_at, device = excluded.device`);

  for (const c of changes) {
    const id = String(c?.id ?? '');
    if (!ID_RE.test(id)) continue;
    const deleted = c.deleted ? 1 : 0;
    const data = deleted ? '{}' : JSON.stringify(c.data && typeof c.data === 'object' ? c.data : {});
    if (data.length > MAX_ITEM) { rejected.push({ id, error: 'This item is too big to save.' }); continue; }
    const base = Math.max(0, Math.floor(Number(c.base_rev) || 0));

    const cur = await env.DB.prepare('SELECT rev, data, deleted, updated_at, device FROM bt_items WHERE id = ?').bind(id).first();
    if (cur && cur.rev !== base) {
      // Someone saved this since the device last saw it. Same content: nothing to do.
      if (cur.data === data && cur.deleted === deleted) { accepted.push({ id, rev: cur.rev }); continue; }
      conflicts.push(rowOut({ id, ...cur }));
      continue;
    }
    const rev = await nextRev(env.DB);
    await upsert.bind(id, rev, data, deleted, now, device).run();
    accepted.push({ id, rev });
  }

  const { results } = await env.DB.prepare('SELECT id, rev, data, deleted, updated_at, device FROM bt_items WHERE rev > ? ORDER BY rev LIMIT ?')
    .bind(since, PAGE + 1).all();
  const more = results.length > PAGE;
  const rows = results.slice(0, PAGE);
  const head = (await env.DB.prepare("SELECT v FROM bt_meta WHERE k = 'seq'").first())?.v || 0;
  return json({
    accepted, conflicts, rejected,
    items: rows.map(rowOut),
    seq: rows.length ? rows[rows.length - 1].rev : Math.min(since, head),
    head, more,
  });
}

function rowOut(r) {
  let data = null;
  if (!r.deleted) { try { data = JSON.parse(r.data); } catch (e) { data = {}; } }
  return { id: r.id, rev: r.rev, deleted: !!r.deleted, data, updated_at: r.updated_at || null, device: r.device || null };
}

async function nextRev(db) {
  const row = await db.prepare("UPDATE bt_meta SET v = v + 1 WHERE k = 'seq' RETURNING v").first();
  return row.v;
}

// ---------- Photos ----------

async function putFile(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405, { Allow: 'POST' });
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json({ error: 'Bad file id.' }, 400);
  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(mime)) return json({ error: 'Only photos (JPEG, PNG, WebP, GIF) for now.' }, 415);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: 'Empty file.' }, 400);
  if (buf.byteLength > MAX_FILE) return json({ error: 'That photo is too big.' }, 413);
  // A file id never changes what it points to, so a repeat upload is a no-op.
  await env.DB.prepare('INSERT OR IGNORE INTO bt_files (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, mime, buf.byteLength, buf, new Date().toISOString()).run();
  return json({ ok: true, id });
}

async function getFile(env, id) {
  if (!ID_RE.test(id)) return json({ error: 'Bad file id.' }, 400);
  const row = await env.DB.prepare('SELECT mime, data FROM bt_files WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found.' }, 404);
  return new Response(new Uint8Array(row.data), {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function stats(env) {
  const items = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM bt_items WHERE deleted = 0').first();
  const files = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM bt_files').first();
  return json({ items: items.n, itemBytes: items.bytes, files: files.n, fileBytes: files.bytes });
}

// ---------- Helpers ----------

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS bt_items (
      id TEXT PRIMARY KEY,
      rev INTEGER NOT NULL,
      data TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      device TEXT
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS bt_items_rev ON bt_items (rev)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS bt_files (
      id TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT
    )`),
    db.prepare('CREATE TABLE IF NOT EXISTS bt_meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL)'),
    db.prepare("INSERT OR IGNORE INTO bt_meta (k, v) VALUES ('seq', 0)"),
    db.prepare('CREATE TABLE IF NOT EXISTS bt_logins (ip_hash TEXT NOT NULL, at TEXT NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS bt_logins_ip_at ON bt_logins (ip_hash, at)'),
  ]);
  schemaReady = true;
}

const clean = (v, max) => (v == null ? null : String(v).replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max));

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

// Compares two strings without leaking how much of them matched.
async function sameText(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
