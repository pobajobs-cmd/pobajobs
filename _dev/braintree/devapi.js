// Stands in for Cloudflare while testing Brain Tree locally: requests to /api/braintree/... run
// the real worker-braintree.js in this page, with sql.js (SQLite in the browser) playing D1.
// The fake server's database is kept in IndexedDB ("bt-dev-server") so it survives reloads.
//
// From the console:  btDev.offline = true   (requests fail like no signal)
//                    await btDev.call('/sync', {...}, token)   (act as another device)
//                    await btDev.wipeServer()

import { handleBraintree } from '/worker-braintree.js';

const SQLJS = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/';
const state = { offline: false, password: 'dev-password', calls: 0 };

function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = reject; document.head.append(s); });
}
function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('bt-dev-server', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
async function kv(mode, fn) {
  const d = await idb();
  return new Promise((resolve, reject) => { const t = d.transaction('kv', mode); const q = fn(t.objectStore('kv')); t.oncomplete = () => resolve(q?.result); t.onerror = () => reject(t.error); });
}

const ready = (async () => {
  await loadScript(SQLJS + 'sql-wasm.js');
  const SQL = await initSqlJs({ locateFile: f => SQLJS + f });
  const saved = await kv('readonly', s => s.get('db'));
  return new SQL.Database(saved || undefined);
})();

const conv = v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v instanceof ArrayBuffer ? new Uint8Array(v) : v);
function d1(db) {
  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...p) { return new Stmt(this.sql, p); }
    rows() {
      const st = db.prepare(this.sql);
      try { st.bind(this.params.map(conv)); const out = []; while (st.step()) out.push(st.getAsObject()); return out; }
      finally { st.free(); }
    }
    async all() { return { results: this.rows(), success: true }; }
    async first() { return this.rows()[0] ?? null; }
    async run() { this.rows(); return { success: true, meta: {} }; }
  }
  return {
    prepare: sql => new Stmt(sql),
    async batch(list) {
      db.exec('BEGIN');
      try { const out = []; for (const s of list) out.push(await s.all()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}

async function serve(req) {
  const db = await ready;
  state.calls++;
  const res = await handleBraintree(req, { DB: d1(db), BRAINTREE_PASSWORD: state.password }, new URL(req.url));
  await kv('readwrite', s => s.put(db.export(), 'db'));
  return res;
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/braintree')) {
    await new Promise(r => setTimeout(r, 60));
    if (state.offline) throw new TypeError('Failed to fetch');
    return serve(req);
  }
  return realFetch(input, init);
};

window.btDev = {
  get offline() { return state.offline; },
  set offline(v) { state.offline = !!v; },
  get calls() { return state.calls; },
  ready,
  async call(path, body, token) {
    const res = await serve(new Request(location.origin + '/api/braintree' + path, {
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    }));
    return { status: res.status, body: await res.json().catch(() => null) };
  },
  async wipeServer() { await kv('readwrite', s => s.delete('db')); location.reload(); },
  async sql(q) { const db = await ready; return db.exec(q); },
};
