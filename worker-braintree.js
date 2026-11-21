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
const MAX_FILE = 1_900_000;      // bytes per photo or file piece (D1 rows top out at 2 MB; the app shrinks photos, and sends other files in pieces)
const MAX_ITEM = 900_000;        // bytes of JSON per item
const MAX_CHANGES = 200;         // changes accepted per sync request
const PAGE = 500;                // changes sent back per sync request
const FAILS_PER_HOUR = 10;       // wrong passwords allowed from one connection per hour
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Other files (PDFs, documents…) come in pieces as plain bytes; the app knows what each one is.
const PIECE_TYPE = 'application/octet-stream';

export async function handleBraintree(request, env, url) {
  try {
    if (!env.BRAINTREE_PASSWORD) return json({ error: 'Brain Tree isn’t set up yet: add the BRAINTREE_PASSWORD secret to the pobajobs Worker.' }, 503);
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Forbidden.' }, 403);

    const path = url.pathname.slice('/api/braintree'.length) || '/';
    await ensureSchema(env.DB);

    // Claude's connector (0.7.3): its own key, in its address (see "Claude" below).
    if (path === '/mcp' || path.startsWith('/mcp/')) return await mcp(request, env, url, path.slice('/mcp/'.length));

    if (path === '/login') return await login(request, env);
    if (!(await signedIn(request, env))) return json({ error: 'Please sign in.' }, 401);

    if (path === '/claude') return await claudeKey(request, env, url);
    if (path === '/sync') return await sync(request, env);
    if (path === '/files') return await putFile(request, env, url);
    if (path.startsWith('/files/')) return await getFile(env, path.slice('/files/'.length));
    if (path === '/stats') return await stats(env);
    if (path === '/ping') return json({ ok: true });
    if (path === '/video') return await videoInfo(url);
    return json({ error: 'Not found.' }, 404);
  } catch (e) {
    return json({ error: 'Server error: ' + (e && e.message ? e.message : String(e)) }, 500);
  }
}

// ---------- YouTube clip titles ----------

// GET /video?id=<YouTube video id>: its title and channel, from YouTube's public oEmbed
// (asked from here because YouTube doesn't let pages ask it directly).
async function videoInfo(url) {
  const id = url.searchParams.get('id') || '';
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return json({ error: 'That isn’t a YouTube video id.' }, 400);
  const res = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id), { cf: { cacheTtl: 86400 } });
  if (!res.ok) return json({ error: res.status === 404 || res.status === 401 ? 'That video is private, removed or can’t be embedded.' : 'YouTube didn’t answer (' + res.status + ').' }, 404);
  const o = await res.json();
  return json({ title: String(o.title || '').slice(0, 200), author: String(o.author_name || '').slice(0, 100) });
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

// ---------- Photos and files ----------

async function putFile(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'POST only.' }, 405, { Allow: 'POST' });
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json({ error: 'Bad file id.' }, 400);
  const mime = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!IMAGE_TYPES.includes(mime) && mime !== PIECE_TYPE) return json({ error: 'Only photos (JPEG, PNG, WebP, GIF) and file pieces.' }, 415);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: 'Empty file.' }, 400);
  if (buf.byteLength > MAX_FILE) return json({ error: mime === PIECE_TYPE ? 'That piece of the file is too big.' : 'That photo is too big.' }, 413);
  // A file id never changes what it points to, so a repeat upload is a no-op.
  await env.DB.prepare('INSERT OR IGNORE INTO bt_files (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, mime, buf.byteLength, buf, new Date().toISOString()).run();
  return json({ ok: true, id });
}

async function getFile(env, id) {
  if (!ID_RE.test(id)) return json({ error: 'Bad file id.' }, 400);
  const row = await env.DB.prepare('SELECT mime, data FROM bt_files WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found.' }, 404);
  // (pieces of files are only ever handed over as bytes to save, never shown as a page)
  return new Response(new Uint8Array(row.data), {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', ...(IMAGE_TYPES.includes(row.mime) ? {} : { 'Content-Disposition': 'attachment' }) },
  });
}

async function stats(env) {
  const items = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM bt_items WHERE deleted = 0').first();
  const files = await env.DB.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM bt_files').first();
  return json({ items: items.n, itemBytes: items.bytes, files: files.n, fileBytes: files.bytes });
}

// ---------- Claude (0.7.3) ----------
// Brain Tree as a Claude connector: an MCP server (Streamable HTTP, plain JSON replies) at
//   POST /api/braintree/mcp/<key>
// The key is made in the app (Settings → Claude: POST /claude), kept here only as a hash in
// bt_keys, and goes in the connector's address, so it works with Claude's "No sign in" option
// on any plan. (An "Authorization: Bearer <key>" header works too.) Settings can switch it off.
//
// Claude can read projects (not what's inside locked ones: the lock is a privacy screen in the
// app, so Claude doesn't see past it either), block out new ones, add to them, change things,
// tie strings, and move things to Recently deleted. Its changes are ordinary saves: every
// device picks them up on its next sync, marked as made on "Claude".

const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const APP_PATH = '/builds/braintree/';
const COLOURS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'white'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET: is Claude connected? POST: make a new key (the old one stops working). DELETE: switch it off.
async function claudeKey(request, env, url) {
  if (request.method === 'GET') {
    const row = await env.DB.prepare("SELECT created_at, last_used FROM bt_keys WHERE name = 'claude'").first();
    return json({ connected: !!row, created: row?.created_at || null, lastUsed: row?.last_used || null });
  }
  if (request.method === 'POST') {
    const key = 'bt' + b64url(crypto.getRandomValues(new Uint8Array(30)));
    await env.DB.prepare(`INSERT INTO bt_keys (name, hash, created_at, last_used) VALUES ('claude', ?, ?, NULL)
      ON CONFLICT(name) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at, last_used = NULL`)
      .bind(await sha256('braintree-key:' + key), new Date().toISOString()).run();
    return json({ key, url: `${url.origin}/api/braintree/mcp/${key}` });
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare("DELETE FROM bt_keys WHERE name = 'claude'").run();
    return json({ ok: true });
  }
  return json({ error: 'Not allowed.' }, 405, { Allow: 'GET, POST, DELETE' });
}

async function mcp(request, env, url, inPath) {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });   // (no event streams)
  const key = (/^[A-Za-z0-9_-]{20,100}$/.test(inPath) ? inPath : '') || (/^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('Authorization') || '') || [])[1] || '';
  const row = key ? await env.DB.prepare("SELECT hash, last_used FROM bt_keys WHERE name = 'claude'").first() : null;
  if (!row || !(await sameText(await sha256('braintree-key:' + key), row.hash))) {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Brain Tree doesn’t recognise this connector address. Make a new one in Brain Tree: Settings → Claude.' } }, 401);
  }
  if (!row.last_used || Date.parse(row.last_used) < Date.now() - 3600e3) {
    await env.DB.prepare("UPDATE bt_keys SET last_used = ? WHERE name = 'claude'").bind(new Date().toISOString()).run();
  }
  const raw = await request.text();
  if (raw.length > 2_000_000) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Too much at once.' } }, 413);
  let msg;
  try { msg = JSON.parse(raw); } catch (e) { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }, 400); }
  const ctx = { env, origin: url.origin };
  if (Array.isArray(msg)) {
    const out = [];
    for (const m of msg) { const r = await rpc(m, ctx); if (r) out.push(r); }
    return out.length ? json(out) : new Response(null, { status: 202 });
  }
  const out = await rpc(msg, ctx);
  return out ? json(out) : new Response(null, { status: 202 });
}

async function rpc(m, ctx) {
  const hasId = m && typeof m === 'object' && 'id' in m && m.id !== null;
  const ok = result => (hasId ? { jsonrpc: '2.0', id: m.id, result } : null);
  const fail = (code, message) => (hasId ? { jsonrpc: '2.0', id: m.id, error: { code, message } } : null);
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(-32600, 'Invalid request.');
  const p = m.params && typeof m.params === 'object' ? m.params : {};
  switch (m.method) {
    case 'initialize':
      return ok({
        protocolVersion: MCP_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : MCP_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'brain-tree', title: 'Brain Tree', version: '0.7.3' },
        instructions: MCP_INSTRUCTIONS,
      });
    case 'ping': return ok({});
    case 'tools/list': return ok({ tools: MCP_TOOLS });
    case 'tools/call': {
      const tool = TOOL_FNS[p.name];
      if (!tool) return fail(-32602, `There's no tool called ${p.name}.`);
      try {
        const r = await tool(p.arguments && typeof p.arguments === 'object' ? p.arguments : {}, ctx);
        return ok({ content: [{ type: 'text', text: r.text }] });
      } catch (e) {
        // (a problem with what was asked: Claude reads this and can try again)
        return ok({ content: [{ type: 'text', text: e && e.message ? e.message : String(e) }], isError: true });
      }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default:
      if (m.method.startsWith('notifications/')) return null;
      return fail(-32601, `Brain Tree doesn't handle ${m.method}.`);
  }
}

const MCP_INSTRUCTIONS = `Brain Tree is the user's own planner (projects, to-dos, notes and boards), on their phone and computer.
When the user asks to put a plan from this chat into Brain Tree ("block it out"), call block_out_project once with the whole thing: sections for the phases or areas of work, to-dos for actions (with steps for the smaller actions inside one), notes for reference material and decisions, and strings.
Strings are what make the board useful, so always include them. Tie a string wherever one thing feeds into, needs, comes before, is based on or is for another, across sections as well as inside them: from research and notes to the to-dos that use them, from each step of the work to the next, from a decision to what it affects. Most to-dos and notes should be on at least one string; as a guide, about one string for every two or three things. Give every item you'll tie a key, and give each string a short label (one to three words) saying how they're linked, like "feeds into", "needs", "before", "based on" or "for". Where the link has a direction (one thing comes before, feeds into or is needed by the other), set arrow "to" so the board shows an arrowhead pointing from → to; leave it out for plain links.
Before blocking a project out, ask the user for this chat's link so the project can link back to it: on the web it's the address in the browser bar (claude.ai/chat/...), which only they can open; Share → Copy link makes a public copy instead. Pass it as chat_url. If they'd rather not, carry on without it.
Don't make up dates; only use ones the user gave. Keep titles short and clear, put detail in notes.
To change an existing project, read it first with get_project (or find things with search) and use the ids it gives. remove_item only moves things to Recently deleted, where the user can restore them.
Locked projects are private: Claude can't see or change what's inside them.
After a change, tell the user what you did and give them the project's link from the result.`;

// The shapes Claude can describe things in.
const ITEM_FIELDS = {
  key: { type: 'string', description: 'Optional: a short name for this, to tie strings to it (in "strings").' },
  type: { type: 'string', enum: ['task', 'note', 'project'], description: 'task = a to-do (default), note = notes or reference, project = a smaller project inside this one.' },
  title: { type: 'string', description: 'Short and clear.' },
  notes: { type: 'string', description: 'Text inside it. Plain text; lines starting "- " become a list, "[ ] " a checklist, "# " a heading, **bold** works.' },
  steps: { type: 'array', items: { type: 'string' }, description: 'For a to-do: the smaller to-dos inside it.' },
  checklist: { type: 'array', items: { type: 'string' }, description: 'For a note: a checklist inside it.' },
  color: { type: 'string', enum: COLOURS, description: 'For a note: its sticky-note colour.' },
  due: { type: 'string', description: 'Only if the user gave one: YYYY-MM-DD.' },
};
const ITEM = { type: 'object', properties: ITEM_FIELDS, required: ['title'] };
const ITEM_WITH_KIDS = { type: 'object', properties: { ...ITEM_FIELDS, items: { type: 'array', items: ITEM, description: 'For a smaller project: what goes in it.' } }, required: ['title'] };
const SECTION = { type: 'object', properties: { key: ITEM_FIELDS.key, title: { type: 'string' }, color: { type: 'string', enum: COLOURS }, items: { type: 'array', items: ITEM_WITH_KIDS } }, required: ['title'] };
// (0.7.7) Which way a string points on the board (data.links[].dir); left out, the board's look decides.
const ARROWS = ['to', 'from', 'both', 'none'];
const ARROW = { type: 'string', enum: ARROWS, description: 'Optional: which end gets an arrowhead on the board. "to" points at the to end (right for "feeds into", "before", "needs"-style links read from → to), "from" at the from end, "both", or "none" for a plain link. Leave it out to let the board\'s look decide.' };
const STRINGS = { type: 'array', description: 'Strings between things, shown on the board: include plenty (about one for every two or three things), wherever one thing feeds into, needs, comes before or is based on another, across sections too. from/to: a key or the exact title of something in this call (or, with add_items, something already in the project).', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, label: { type: 'string', description: 'One to three words saying how they link, like "feeds into", "needs", "before".' }, arrow: ARROW }, required: ['from', 'to'] } };

const MCP_TOOLS = [
  { name: 'list_projects', title: 'List projects', description: 'All the projects in Brain Tree (with their smaller projects), with ids and how many to-dos are done.',
    inputSchema: { type: 'object', properties: { include_done: { type: 'boolean', description: 'Also list finished projects.' } } }, annotations: { readOnlyHint: true } },
  { name: 'get_project', title: 'Open a project', description: 'Everything in one project: its notes, sections, to-dos (with steps), notes, smaller projects and strings, with ids.',
    inputSchema: { type: 'object', properties: { project_id: { type: 'string' } }, required: ['project_id'] }, annotations: { readOnlyHint: true } },
  { name: 'search', title: 'Search Brain Tree', description: 'Find to-dos, notes, sections and projects by words in their title or notes.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, annotations: { readOnlyHint: true } },
  { name: 'block_out_project', title: 'Block out a project', description: 'Create a whole new project in one go: its notes, sections with their to-dos and notes, loose to-dos and notes, smaller projects, and the strings that show how they connect on its board (include plenty: give items keys and tie them). Pass chat_url (this chat\'s link) so the project links back to the chat.',
    inputSchema: { type: 'object', properties: {
      title: { type: 'string' }, notes: { type: 'string', description: 'What the project is about (same format as item notes).' },
      chat_url: { type: 'string', description: 'This Claude chat\'s link, from the user.' },
      inside_project_id: { type: 'string', description: 'Optional: make it a smaller project inside this one.' },
      start: { type: 'string', description: 'Only if the user gave one: YYYY-MM-DD.' }, due: { type: 'string', description: 'Only if the user gave one: YYYY-MM-DD.' },
      sections: { type: 'array', items: SECTION, description: 'Groups inside the project (phases, areas). Shown as headings in the list and frames on the board.' },
      items: { type: 'array', items: ITEM_WITH_KIDS, description: 'To-dos, notes and smaller projects not in a section.' },
      strings: STRINGS,
    }, required: ['title'] } },
  { name: 'add_items', title: 'Add to a project', description: 'Add to-dos, notes, smaller projects and sections to an existing project, section or to-do (things added to a to-do become its steps). Strings can tie new things and things already in the project (by title); with only strings, it just ties them.',
    inputSchema: { type: 'object', properties: { parent_id: { type: 'string', description: 'The project, section or to-do to add to.' }, sections: { type: 'array', items: SECTION }, items: { type: 'array', items: ITEM_WITH_KIDS }, strings: STRINGS }, required: ['parent_id'] } },
  { name: 'update_item', title: 'Change something', description: 'Change a to-do, note, section or project: rename it, tick it off (or not), change or add to its notes, set or clear dates, change a note\'s colour, move it somewhere else, or (projects) set the Claude chat link.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' }, title: { type: 'string' }, done: { type: 'boolean' },
      notes: { type: 'string', description: 'Replaces its text (photos, drawings and other things in it are kept).' }, append_notes: { type: 'string', description: 'Added to the end of its notes.' },
      due: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear.' }, start: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null to clear.' },
      color: { type: 'string', enum: COLOURS }, move_to: { type: 'string', description: 'Id of the project, section or to-do to move it into.' },
      chat_url: { type: 'string' },
    }, required: ['id'] } },
  { name: 'tie_string', title: 'Tie a string', description: 'Tie a string between two things (it shows on the board, and under Strings on each). Tying two already tied changes its label and/or arrow.',
    inputSchema: { type: 'object', properties: { from_id: { type: 'string' }, to_id: { type: 'string' }, label: { type: 'string' }, arrow: ARROW }, required: ['from_id', 'to_id'] } },
  { name: 'remove_item', title: 'Move to Recently deleted', description: 'Move a to-do, note, project or section to Recently deleted (the user can restore it). Removing a section keeps what was in it.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, annotations: { destructiveHint: true } },
];

// ----- reading Brain Tree -----

async function loadTree(env) {
  const { results } = await env.DB.prepare('SELECT id, data FROM bt_items WHERE deleted = 0').all();
  const byId = new Map();
  for (const r of results) {
    let d;
    try { d = JSON.parse(r.data); } catch (e) { continue; }
    if (d && d.type !== 'pref') byId.set(r.id, { id: r.id, data: d });
  }
  // (what's inside a locked project is left out, as in the app while it's locked)
  const lockedIn = r => { let p = r.data.parent && byId.get(r.data.parent), n = 0; while (p && n++ < 60) { if (p.data.type === 'project' && p.data.lock) return p.id; p = p.data.parent && byId.get(p.data.parent); } return null; };
  for (const r of [...byId.values()]) if (lockedIn(r)) byId.delete(r.id);
  const memo = new Map();
  const alive = (r, n = 0) => {
    if (memo.has(r.id)) return memo.get(r.id);
    let ok = !r.data.trashed;
    const p = ok && r.data.parent && byId.get(r.data.parent);
    if (p && n < 60) ok = alive(p, n + 1);
    memo.set(r.id, ok);
    return ok;
  };
  const kids = new Map();
  for (const r of byId.values()) if (alive(r)) {
    const p = r.data.parent && byId.has(r.data.parent) ? r.data.parent : '';
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(r);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.data.order || 0) - (b.data.order || 0));
  const get = id => { const r = byId.get(String(id || '')); return r && alive(r) ? r : null; };
  const parentOf = r => get(r.data.parent);
  const projectOf = r => { let p = parentOf(r), n = 0; while (p && n++ < 60) { if (p.data.type === 'project') return p; p = parentOf(p); } return null; };
  const descendants = (id, out = []) => { for (const k of kids.get(id) || []) { out.push(k); descendants(k.id, out); } return out; };
  const where = r => { const p = projectOf(r), par = parentOf(r); return p ? p.data.title + (par && par.data.type === 'section' ? ' › ' + par.data.title : '') : r.data.type === 'project' ? 'the project list' : 'Inbox'; };
  return { byId, kids, get, parentOf, projectOf, descendants, where };
}

const titleOf = r => (r.data.title || '').trim() || (r.data.type === 'note' ? 'Untitled note' : 'Untitled');
const tasksIn = (T, id) => T.descendants(id).filter(r => r.data.type === 'task');
const progressOf = (T, id) => { const t = tasksIn(T, id); return { done: t.filter(r => r.data.done).length, total: t.length }; };
const linkTo = (ctx, id, board = false) => `${ctx.origin}${APP_PATH}#/${board ? 'board' : 'project'}/${id}`;

// A note's text as plain text for Claude to read (lists, checklists and what's attached, in words).
function plainText(html) {
  return String(html || '')
    .replace(/<div data-yt="[^"]*"[^>]*data-title="([^"]*)"[^>]*><\/div>/g, '\n(YouTube clip: $1)\n')
    .replace(/<div data-yt[^>]*><\/div>/g, '\n(YouTube clip)\n')
    .replace(/<div data-draw[^>]*><\/div>/g, '\n(a drawing)\n')
    .replace(/<div data-sheet[^>]*><\/div>/g, '\n(a spreadsheet)\n')
    .replace(/<div data-doc="[^"]*"[^>]*data-name="([^"]*)"[^>]*><\/div>/g, '\n(file: $1)\n')
    .replace(/<div data-weblink="([^"]*)"[^>]*><\/div>/g, '\n(link: $1)\n')
    .replace(/<img[^>]*>/g, '\n(a photo)\n')
    .replace(/<li data-checked="true"[^>]*>/g, '\n[x] ').replace(/<ul class="checklist"[^>]*>([\s\S]*?)<\/ul>/g, (m, inner) => inner.replace(/<li(?![^>]*data-checked)[^>]*>/g, '\n[ ] '))
    .replace(/<li[^>]*>/g, '\n- ').replace(/<h[1-3][^>]*>/g, '\n# ').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|div|h[1-3]|li)>/g, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map(s => s.trim()).filter(Boolean).join('\n');
}
const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '… (more in the app)' : s);

// ----- writing -----

const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = s => escHtml(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
// Claude's plain text as a note: paragraphs, lists, checklists and headings.
function notesHtml(text) {
  const out = [];
  let list = null;
  const close = () => { if (list) { out.push(list.html + '</ul>'); list = null; } };
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    const check = /^(?:[-*•]\s*)?\[( |x|X)\]\s+(.*)$/.exec(line), bullet = /^[-*•]\s+(.*)$/.exec(line), head = /^#{1,3}\s+(.*)$/.exec(line);
    if (check) {
      if (list?.kind !== 'check') { close(); list = { kind: 'check', html: '<ul class="checklist">' }; }
      list.html += `<li${check[1] !== ' ' ? ' data-checked="true"' : ''}>${inline(check[2])}</li>`;
    } else if (bullet) {
      if (list?.kind !== 'ul') { close(); list = { kind: 'ul', html: '<ul>' }; }
      list.html += `<li>${inline(bullet[1])}</li>`;
    } else { close(); if (head) out.push(`<h3>${inline(head[1])}</h3>`); else if (line) out.push(`<p>${inline(line)}</p>`); }
  }
  close();
  return out.join('');
}
const checklistHtml = list => (list?.length ? '<ul class="checklist">' + list.map(s => `<li>${inline(s)}</li>`).join('') + '</ul>' : '');
// What in a note isn't text (photos, clips, drawings, sheets, files, links): kept when its text is replaced.
const mediaOf = html => (String(html || '').match(/<div data-(?:yt|draw|sheet|doc|weblink)[^>]*><\/div>|<img [^>]*>/g) || []).join('');

function chatLinkHtml(url) {
  let u;
  try { u = new URL(String(url)); } catch (e) { throw new Error('That chat link isn’t a web address.'); }
  if (u.protocol !== 'https:') throw new Error('The chat link should start with https://.');
  return `<div data-weblink="${escHtml(u.href)}" data-title="The Claude chat this was planned in"></div>`;
}
// A project's notes with its chat link (one only: a new one replaces the old).
const withChat = (body, url) => chatLinkHtml(url) + String(body || '').replace(/<div data-weblink="https:\/\/(?:[a-z0-9-]+\.)?claude\.(?:ai|com)\/[^"]*"[^>]*><\/div>/g, '');

function newItemId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
}
const day = (v, what) => {
  if (v == null || v === '') return undefined;
  if (!DAY_RE.test(String(v)) || Number.isNaN(Date.parse(v))) throw new Error(`${what} should be a date like 2026-12-31.`);
  return String(v);
};
const text = (v, max, what) => {
  const s = String(v ?? '').trim();
  if (!s && what) throw new Error(`${what} can’t be empty.`);
  return s.slice(0, max);
};

async function saveItem(env, id, data) {
  data.updated = new Date().toISOString();
  const raw = JSON.stringify(data);
  if (raw.length > MAX_ITEM) throw new Error(`“${data.title || 'That'}” is too big to save.`);
  const rev = await nextRev(env.DB);
  await env.DB.prepare(`INSERT INTO bt_items (id, rev, data, deleted, updated_at, device) VALUES (?, ?, ?, 0, ?, 'Claude')
    ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, data = excluded.data, deleted = 0, updated_at = excluded.updated_at, device = excluded.device`)
    .bind(id, rev, raw, data.updated).run();
  return rev;
}

// Turns what Claude described (sections, items, strings) into Brain Tree items under a parent.
// Plans everything first (ids, order, strings), then saves.
function planItems(T, parentId, { sections = [], items = [], strings = [] }, plan) {
  const now = new Date().toISOString();
  const add = (data, key) => {
    const id = newItemId();
    plan.items.push({ id, data: { created: now, order: plan.order++, body: '', ...data } });
    plan.named.set(String(data.title).toLowerCase(), id);
    if (key) plan.named.set('key:' + String(key).toLowerCase(), id);
    if (plan.items.length > 400) throw new Error('That’s more than 400 things at once: block it out in parts.');
    return id;
  };
  const addItem = (it, parent, depth = 0) => {
    if (!it || typeof it !== 'object') return;
    const type = ['task', 'note', 'project'].includes(it.type) ? it.type : 'task';
    const data = { type, title: text(it.title, 300, 'A title'), parent };
    let body = notesHtml(text(it.notes, 20000));
    if (type === 'note') { body += checklistHtml((it.checklist || []).map(s => text(s, 300)).filter(Boolean)); if (COLOURS.includes(it.color)) data.color = it.color; }
    data.body = body;
    if (type !== 'note') { const due = day(it.due, `The due date for “${data.title}”`); if (due) data.due = due; }
    const id = add(data, it.key);
    if (type === 'task') for (const s of (it.steps || []).slice(0, 60)) { const t = text(s, 300); if (t) add({ type: 'task', title: t, parent: id }); }
    if (type === 'project' && depth < 2) for (const k of (it.items || []).slice(0, 200)) addItem(k, id, depth + 1);
  };
  for (const s of sections.slice(0, 40)) {
    if (!s || typeof s !== 'object') continue;
    const sid = add({ type: 'section', title: text(s.title, 200, 'A section title'), parent: parentId, ...(COLOURS.includes(s.color) ? { color: s.color } : {}) }, s.key);
    for (const it of (s.items || []).slice(0, 200)) addItem(it, sid);
  }
  for (const it of items.slice(0, 300)) addItem(it, parentId);
  for (const st of strings.slice(0, 100)) {
    const find = v => plan.named.get('key:' + String(v || '').toLowerCase()) || plan.named.get(String(v || '').toLowerCase()) || (T.get(v) ? String(v) : null);
    const from = find(st?.from), to = find(st?.to);
    if (!from || !to || from === to) { plan.skipped.push(`${st?.from} → ${st?.to}`); continue; }
    plan.strings.push({ from, to, label: text(st.label, 40), dir: ARROWS.includes(st.arrow) ? st.arrow : null });
  }
}

async function savePlan(env, T, plan) {
  const mine = new Map(plan.items.map(x => [x.id, x.data]));
  const touched = new Map();
  for (const s of plan.strings) {
    let data = mine.get(s.from);
    if (!data) { if (!touched.has(s.from)) touched.set(s.from, structuredClone(T.get(s.from).data)); data = touched.get(s.from); }
    const links = (data.links || []).filter(l => l.to !== s.to);
    links.push({ to: s.to, ...(s.label ? { label: s.label } : {}), ...(s.dir ? { dir: s.dir } : {}) });
    data.links = links;
  }
  for (const x of plan.items) await saveItem(env, x.id, x.data);
  for (const [id, data] of touched) await saveItem(env, id, data);
}
const newPlan = () => ({ items: [], strings: [], skipped: [], named: new Map(), order: Date.now() });
const counted = plan => {
  const n = t => plan.items.filter(x => x.data.type === t).length;
  return [[n('section'), 'section'], [n('task'), 'to-do'], [n('note'), 'note'], [n('project'), 'smaller project'], [plan.strings.length, 'string']]
    .filter(([k]) => k).map(([k, w]) => `${k} ${w}${k === 1 ? '' : 's'}`).join(', ') || 'nothing else';
};

// The item Claude named, if it can be changed (not deleted, not a locked project or inside one).
function mustGet(T, id, what = 'that', { lockedOk = false } = {}) {
  const r = T.get(id);
  if (!r) throw new Error(`Brain Tree has nothing with the id “${id}” (or it's deleted, or inside a locked project). Use list_projects or search to find ${what}.`);
  if (r.data.lock && !lockedOk) throw new Error(`“${titleOf(r)}” is locked, so Claude can't change it or what's in it. The user can unlock it in Brain Tree.`);
  return r;
}

// ----- the tools -----

const TOOL_FNS = {
  async list_projects(a, ctx) {
    const T = await loadTree(ctx.env);
    // (each project under the project it's in, wherever in it: loose or in a section)
    const under = new Map();
    for (const r of T.byId.values()) if (r.data.type === 'project' && T.get(r.id)) {
      const k = T.projectOf(r)?.id || '';
      if (!under.has(k)) under.set(k, []);
      under.get(k).push(r);
    }
    for (const list of under.values()) list.sort((x, y) => (x.data.order || 0) - (y.data.order || 0));
    const lines = [];
    const walk = (parent, depth) => {
      for (const r of under.get(parent) || []) {
        if (r.data.done && !a.include_done) continue;
        const { done, total } = progressOf(T, r.id);
        const bits = [r.data.lock ? 'locked' : total ? `${done}/${total} to-dos done` : 'no to-dos yet', r.data.start || r.data.due ? `${r.data.start || '…'} → ${r.data.due || '…'}` : '', r.data.done ? 'finished' : ''].filter(Boolean);
        lines.push(`${'  '.repeat(depth)}- ${titleOf(r)} (id ${r.id}): ${bits.join(', ')}`);
        if (!r.data.lock) walk(r.id, depth + 1);
      }
    };
    walk('', 0);
    return { text: lines.length ? `Projects in Brain Tree:\n${lines.join('\n')}` : 'Brain Tree has no projects yet.' };
  },

  async get_project(a, ctx) {
    const T = await loadTree(ctx.env);
    const p = mustGet(T, a.project_id, 'the project', { lockedOk: true });
    if (p.data.type !== 'project') throw new Error(`“${titleOf(p)}” is a ${p.data.type === 'task' ? 'to-do' : p.data.type}, not a project. It's in ${T.where(p)}.`);
    const L = [`Project: ${titleOf(p)} (id ${p.id})`];
    if (p.data.lock) return { text: L[0] + '\nIt’s locked, so Claude can’t see what’s in it.', data: { id: p.id, locked: true } };
    const { done, total } = progressOf(T, p.id);
    if (p.data.start || p.data.due) L.push(`Dates: ${p.data.start || '…'} → ${p.data.due || '…'}`);
    L.push(`Progress: ${done} of ${total} to-dos done${p.data.done ? ' (the project is ticked off)' : ''}`);
    L.push(`Open in Brain Tree: ${linkTo(ctx, p.id)}`);
    const pn = plainText(p.data.body);
    if (pn) L.push('Notes:\n' + short(pn, 1500).split('\n').map(s => '  ' + s).join('\n'));
    const line = (r, ind) => {
      const d = r.data, kind = d.type === 'task' ? `[${d.done ? 'x' : ' '}]` : d.type === 'project' ? 'Project:' : 'Note:';
      let s = `${ind}- ${kind} ${titleOf(r)} (id ${r.id})${d.due ? ` due ${d.due}` : ''}${d.repeat ? ` repeats (${d.repeat})` : ''}${d.lock ? ' (locked)' : ''}`;
      if (d.type === 'project') { const pr = progressOf(T, r.id); s += pr.total ? `, ${pr.done}/${pr.total} to-dos done` : ''; return s; }
      const steps = (T.kids.get(r.id) || []).filter(k => k.data.type === 'task');
      if (steps.length) s += '\n' + steps.map(k => `${ind}    - [${k.data.done ? 'x' : ' '}] ${titleOf(k)} (id ${k.id})`).join('\n');
      const tx = plainText(d.body);
      if (tx) s += '\n' + short(tx, 600).split('\n').map(x => `${ind}    ${x}`).join('\n');
      return s;
    };
    const kids = T.kids.get(p.id) || [];
    const loose = kids.filter(r => r.data.type !== 'section');
    if (loose.length) L.push('Not in a section:\n' + loose.map(r => line(r, '  ')).join('\n'));
    for (const s of kids.filter(r => r.data.type === 'section')) {
      const inS = T.kids.get(s.id) || [];
      L.push(`Section: ${titleOf(s)} (id ${s.id})${inS.length ? '\n' + inS.map(r => line(r, '  ')).join('\n') : ' (empty)'}`);
    }
    const here = new Set([p.id, ...T.descendants(p.id).map(r => r.id)]);
    const strings = [];
    for (const id of here) for (const l of T.get(id)?.data.links || []) {
      if (!T.get(l.to)) continue;
      const also = (l.also || []).map(c => T.get(c)).filter(Boolean).map(titleOf);
      const arrow = l.dir === 'to' ? `, points to ${titleOf(T.get(l.to))}` : l.dir === 'from' ? `, points to ${titleOf(T.get(id))}` : l.dir === 'both' ? ', points both ways' : l.dir === 'none' ? ', no arrows' : '';
      strings.push(`- ${titleOf(T.get(id))} → ${titleOf(T.get(l.to))}${l.label ? ` “${l.label}”` : ''}${also.length ? ` (branches to ${also.join(', ')})` : ''}${arrow}`);
    }
    if (strings.length) L.push('Strings:\n' + strings.join('\n'));
    return { text: L.join('\n'), data: { id: p.id, title: titleOf(p), url: linkTo(ctx, p.id) } };
  },

  async search(a, ctx) {
    const q = text(a.query, 200, 'What to search for').toLowerCase();
    const T = await loadTree(ctx.env);
    const hits = [];
    for (const r of T.byId.values()) {
      if (!T.get(r.id)) continue;
      if (titleOf(r).toLowerCase().includes(q) || plainText(r.data.body).toLowerCase().includes(q)) hits.push(r);
      if (hits.length >= 25) break;
    }
    const kind = t => ({ task: 'To-do', note: 'Note', project: 'Project', section: 'Section' }[t] || t);
    return { text: hits.length ? hits.map(r => `- ${kind(r.data.type)}: ${titleOf(r)} (id ${r.id})${r.data.type === 'task' && r.data.done ? ', done' : ''}, in ${T.where(r)}`).join('\n') : `Nothing in Brain Tree matches “${a.query}”.`,
      data: { results: hits.map(r => ({ id: r.id, type: r.data.type, title: titleOf(r), where: T.where(r) })) } };
  },

  async block_out_project(a, ctx) {
    const T = await loadTree(ctx.env);
    const parent = a.inside_project_id ? mustGet(T, a.inside_project_id, 'the project to put it in') : null;
    if (parent && parent.data.type !== 'project') throw new Error(`“${titleOf(parent)}” isn't a project.`);
    const plan = newPlan();
    const id = newItemId(), now = new Date().toISOString();
    const data = { type: 'project', title: text(a.title, 300, 'The project title'), created: now, order: plan.order++, body: notesHtml(text(a.notes, 20000)) };
    if (parent) data.parent = parent.id;
    const start = day(a.start, 'The start date'), due = day(a.due, 'The due date');
    if (start) data.start = start;
    if (due) data.due = due;
    if (a.chat_url) data.body = withChat(data.body, a.chat_url);
    plan.named.set(data.title.toLowerCase(), id);
    planItems(T, id, { sections: a.sections || [], items: a.items || [], strings: a.strings || [] }, plan);
    const made = counted(plan);
    // (few strings for the size of it: say so, so Claude can tie more with tie_string)
    const things = plan.items.filter(x => x.data.type !== 'section' && !(x.data.type === 'task' && plan.items.some(y => y.id === x.data.parent && y.data.type === 'task'))).length;
    const fewStrings = things >= 4 && plan.strings.length < Math.ceil(things / 4);
    plan.items.unshift({ id, data });
    await savePlan(ctx.env, T, plan);
    const url = linkTo(ctx, id);
    return { text: `Blocked out “${data.title}” in Brain Tree: ${made}${a.chat_url ? ', and a link back to this chat' : ''}.${plan.skipped.length ? `\nStrings left out (couldn't find both ends): ${plan.skipped.join('; ')}.` : ''}${fewStrings ? `\nOnly ${plan.strings.length} string${plan.strings.length === 1 ? '' : 's'} for ${things} things: the board shows how things connect through strings, so tie more where one thing feeds into, needs or comes before another: add_items with parent_id ${id} and just a strings list (titles work) ties several at once.` : ''}\nOpen it: ${url}\nIts board: ${linkTo(ctx, id, true)}`,
      data: { project_id: id, url } };
  },

  async add_items(a, ctx) {
    const T = await loadTree(ctx.env);
    const parent = mustGet(T, a.parent_id, 'where to add things');
    if (parent.data.type === 'note') throw new Error(`“${titleOf(parent)}” is a note: add to its project or section instead.`);
    if (parent.data.type === 'task' && (a.sections || []).length) throw new Error('Sections can only go in a project.');
    if (parent.data.type === 'section' && (a.sections || []).length) throw new Error('Sections go in a project, not inside another section.');
    const plan = newPlan();
    // (things already here can be named in strings too)
    for (const r of [parent, ...T.descendants((T.projectOf(parent) || parent).id)]) plan.named.set(titleOf(r).toLowerCase(), r.id);
    const items = parent.data.type === 'task' ? (a.items || []).map(it => ({ ...it, type: 'task' })) : a.items || [];
    planItems(T, parent.id, { sections: a.sections || [], items, strings: a.strings || [] }, plan);
    await savePlan(ctx.env, T, plan);
    const p = parent.data.type === 'project' ? parent : T.projectOf(parent);
    return { text: `Added ${counted(plan)} to “${titleOf(parent)}”.${plan.skipped.length ? `\nStrings left out (couldn't find both ends): ${plan.skipped.join('; ')}.` : ''}${p ? `\nOpen it: ${linkTo(ctx, p.id)}` : ''}`,
      data: { added: plan.items.map(x => ({ id: x.id, type: x.data.type, title: x.data.title })) } };
  },

  async update_item(a, ctx) {
    const T = await loadTree(ctx.env);
    const r = mustGet(T, a.id);
    const d = structuredClone(r.data), did = [];
    if (a.title != null) { d.title = text(a.title, 300, 'The title'); did.push('renamed it'); }
    if (a.done != null) {
      if (d.type === 'note' || d.type === 'section') throw new Error(`“${titleOf(r)}” is a ${d.type}: only to-dos and projects get ticked off.`);
      if (a.done && d.repeat && d.type === 'task') throw new Error(`“${titleOf(r)}” repeats, so tick it off in Brain Tree itself (that moves it on to its next date).`);
      if (a.done) { d.done = true; d.doneAt = new Date().toISOString(); } else { delete d.done; delete d.doneAt; }
      did.push(a.done ? 'ticked it off' : 'unticked it');
    }
    if (a.notes != null) { d.body = notesHtml(text(a.notes, 20000)) + mediaOf(d.body); did.push('replaced its notes'); }
    if (a.append_notes) { d.body = String(d.body || '') + notesHtml(text(a.append_notes, 20000)); did.push('added to its notes'); }
    if (a.chat_url) { if (d.type !== 'project') throw new Error('Only projects get a chat link.'); d.body = withChat(d.body, a.chat_url); did.push('linked this chat'); }
    for (const k of ['due', 'start']) if (a[k] !== undefined) {
      if (a[k] === null || a[k] === '') { delete d[k]; did.push(`cleared its ${k === 'due' ? 'due' : 'start'} date`); }
      else { d[k] = day(a[k], `The ${k} date`); did.push(`set its ${k === 'due' ? 'due' : 'start'} date`); }
    }
    if (a.color != null) { if (!COLOURS.includes(a.color)) throw new Error(`Colours: ${COLOURS.join(', ')}.`); d.color = a.color; did.push('changed its colour'); }
    if (a.move_to != null) {
      const to = mustGet(T, a.move_to, 'where to move it');
      if (to.id === r.id || T.descendants(r.id).some(x => x.id === to.id)) throw new Error('It can’t go inside itself.');
      if (to.data.type === 'note') throw new Error('Things can’t go inside a note.');
      if (d.type === 'section' && to.data.type !== 'project') throw new Error('A section can only go in a project.');
      d.parent = to.id; did.push(`moved it into “${titleOf(to)}”`);
    }
    if (!did.length) throw new Error('Nothing to change: say what to change (title, done, notes, dates, colour, move_to…).');
    await saveItem(ctx.env, r.id, d);
    const p = d.type === 'project' ? r : T.projectOf(r);
    return { text: `“${titleOf({ data: d })}”: ${did.join(', ')}.${p ? `\nOpen it: ${linkTo(ctx, p.id)}` : ''}`, data: { id: r.id } };
  },

  async tie_string(a, ctx) {
    const T = await loadTree(ctx.env);
    const from = mustGet(T, a.from_id), to = mustGet(T, a.to_id);
    if (from.id === to.id) throw new Error('A string needs two different things.');
    const back = (to.data.links || []).find(l => l.to === from.id);
    const [owner, other] = back ? [to, from] : [from, to];
    const d = structuredClone(owner.data), label = text(a.label, 40);
    // (the arrow as Claude means it, from from_id to to_id; flipped if the string is stored the other way round)
    let dir = ARROWS.includes(a.arrow) ? a.arrow : null;
    if (dir && back) dir = { to: 'from', from: 'to' }[dir] || dir;
    const links = d.links || [];
    const had = links.find(l => l.to === other.id);
    const extra = { ...(label ? { label } : {}), ...(dir ? { dir } : {}) };
    d.links = had ? links.map(l => (l.to === other.id ? { ...l, ...extra } : l)) : [...links, { to: other.id, ...extra }];
    await saveItem(ctx.env, owner.id, d);
    return { text: `${had ? 'Changed the string' : 'Tied a string'} between “${titleOf(from)}” and “${titleOf(to)}”${label ? ` (“${label}”)` : ''}${dir ? `, ${a.arrow === 'both' ? 'pointing both ways' : a.arrow === 'none' ? 'with no arrows' : `pointing to “${titleOf(a.arrow === 'to' ? to : from)}”`}` : ''}.`, data: { from: from.id, to: to.id } };
  },

  async remove_item(a, ctx) {
    const T = await loadTree(ctx.env);
    const r = mustGet(T, a.id);
    const now = new Date().toISOString();
    if (r.data.type === 'section') {
      // (as in the app: what was in it stays, moved up into the project)
      const kids = T.kids.get(r.id) || [];
      for (const k of kids) await saveItem(ctx.env, k.id, { ...structuredClone(k.data), parent: r.data.parent });
      await saveItem(ctx.env, r.id, { ...structuredClone(r.data), trashed: now });
      return { text: `Moved the section “${titleOf(r)}” to Recently deleted; the ${kids.length} thing${kids.length === 1 ? '' : 's'} in it stay in the project.`, data: { id: r.id } };
    }
    const n = T.descendants(r.id).length;
    await saveItem(ctx.env, r.id, { ...structuredClone(r.data), trashed: now });
    return { text: `Moved “${titleOf(r)}” to Recently deleted${n ? ` (with the ${n} thing${n === 1 ? '' : 's'} inside it)` : ''}. It can be restored from there in Brain Tree.`, data: { id: r.id } };
  },
};

// ---------- Helpers ----------

const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

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
    db.prepare('CREATE TABLE IF NOT EXISTS bt_keys (name TEXT PRIMARY KEY, hash TEXT NOT NULL, created_at TEXT, last_used TEXT)'),
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
