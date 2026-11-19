// Brain Tree data: everything lives in this device's IndexedDB first (so it works offline),
// then swaps changes with /api/braintree/sync whenever there's signal.
//
// An item record: { id, data, deleted, rev, baseRev, dirty, editSeq, conflict }
//   data      the item itself (type, title, body, parent, dates...)
//   rev       the server's number for the version we have
//   baseRev   the server version our unsent edits were made on top of
//   dirty     edits not yet on the server
//   conflict  the server's version, when it changed on another device too

const API = '/api/braintree';
const DB_NAME = 'braintree';

const items = new Map();
const meta = { seq: 0, token: null, device: null };
const listeners = new Set();
const fileUrls = new Map();
export const status = { state: 'idle', message: '', lastSync: 0 };

let db = null;
let syncing = false, syncAgain = false, syncTimer = null;

// ---------- IndexedDB ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('items', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' });
      d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    out = fn(t.objectStore(store));
  });
}

const reqP = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

function putItems(recs) {
  if (!recs.length) return Promise.resolve();
  return tx('items', 'readwrite', s => { for (const r of recs) s.put(r); });
}

function saveMeta(...keys) {
  return tx('meta', 'readwrite', s => { for (const k of keys) s.put(meta[k], k); });
}

// ---------- Start-up ----------

export async function load() {
  db = await openDb();
  const [recs, seq, token, device] = await Promise.all([
    tx('items', 'readonly', s => reqP(s.getAll())),
    tx('meta', 'readonly', s => reqP(s.get('seq'))),
    tx('meta', 'readonly', s => reqP(s.get('token'))),
    tx('meta', 'readonly', s => reqP(s.get('device'))),
  ]);
  for (const r of await recs) items.set(r.id, r);
  meta.seq = (await seq) || 0;
  meta.token = (await token) || null;
  meta.device = (await device) || guessDevice();
  if (!(await device)) saveMeta('device');

  window.addEventListener('online', () => sync());
  window.addEventListener('offline', () => setStatus(meta.token ? 'offline' : 'signedout'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 60_000);
  if (!meta.token) setStatus('signedout');
}

function guessDevice() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'PC' : /Macintosh/.test(ua) ? 'Mac' : 'Device';
  return kind + ' ' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

export const device = () => meta.device;
export async function setDevice(name) { meta.device = String(name).trim().slice(0, 40) || guessDevice(); await saveMeta('device'); }

// ---------- Reading ----------

export const get = id => items.get(id);
export const all = () => items.values();
export const signedIn = () => !!meta.token;
export const pendingCount = () => { let n = 0; for (const r of items.values()) if (r.dirty) n++; return n; };
export const conflicts = () => [...items.values()].filter(r => r.conflict);

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(ids) { for (const fn of listeners) { try { fn(ids); } catch (e) { console.error(e); } } }

function setStatus(state, message = '') {
  status.state = state; status.message = message;
  emit(null);
}

// ---------- Writing ----------

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map(x => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export function create(data) { return createWithId(newId(), data); }

export async function createWithId(id, data) {
  const now = new Date().toISOString();
  const rec = { id, data: { created: now, updated: now, order: Date.now(), ...data }, deleted: false, rev: 0, baseRev: 0, dirty: true, editSeq: 1, conflict: null, baseData: null };
  items.set(rec.id, rec);
  await putItems([rec]);
  emit([rec.id]);
  scheduleSync();
  return rec.id;
}

// Merge a patch into an item. Keys set to undefined are removed.
export async function update(id, patch) {
  const rec = items.get(id);
  if (!rec || rec.deleted) return;
  // Remember the synced version this edit starts from, so edits on two devices to
  // different parts of an item can be merged instead of asking which to keep.
  if (!rec.dirty && rec.rev) rec.baseData = structuredClone(rec.data);
  const data = { ...rec.data, ...patch, updated: new Date().toISOString() };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  rec.data = data; rec.dirty = true; rec.editSeq = (rec.editSeq || 0) + 1;
  await putItems([rec]);
  emit([id]);
  scheduleSync();
}

// Gone for good (everywhere, once synced).
export async function destroy(ids) {
  const recs = [];
  for (const id of ids) {
    const rec = items.get(id);
    if (!rec) continue;
    if (!rec.rev && !rec.conflict) { items.delete(id); await tx('items', 'readwrite', s => s.delete(id)); continue; }
    rec.deleted = true; rec.data = {}; rec.dirty = true; rec.editSeq = (rec.editSeq || 0) + 1;
    recs.push(rec);
  }
  await putItems(recs);
  emit(ids);
  scheduleSync();
}

// Pick a side when an item changed on two devices.
export async function resolve(id, choice) {
  const rec = items.get(id);
  if (!rec || !rec.conflict) return;
  const theirs = rec.conflict;
  if (choice === 'both' && !rec.deleted) {
    await create({ ...rec.data, title: (rec.data.title || 'Untitled') + ' (' + meta.device + ')' });
  }
  if (choice === 'mine') {
    rec.rev = rec.baseRev = theirs.rev;
    rec.dirty = true; rec.editSeq = (rec.editSeq || 0) + 1;
    rec.baseData = theirs.data ? structuredClone(theirs.data) : null;
  } else {
    rec.data = theirs.data || {}; rec.deleted = !!theirs.deleted;
    rec.rev = rec.baseRev = theirs.rev; rec.dirty = false; rec.baseData = null;
  }
  rec.conflict = null;
  await putItems([rec]);
  emit([id]);
  scheduleSync();
}

// ---------- Sign-in ----------

export async function login(password) {
  const res = await fetch(API + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Couldn’t sign in (' + res.status + ').');
  meta.token = out.token;
  await saveMeta('token');
  setStatus('idle');
  sync();
}

export async function logout(eraseLocal) {
  meta.token = null;
  await saveMeta('token');
  if (eraseLocal) {
    items.clear(); meta.seq = 0;
    await tx('items', 'readwrite', s => s.clear());
    await tx('files', 'readwrite', s => s.clear());
    await saveMeta('seq');
  }
  setStatus('signedout');
}

async function api(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30_000);
  try {
    const res = await fetch(API + path, {
      ...opts, signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + meta.token, ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    });
    if (!res.ok) {
      const out = await res.json().catch(() => ({}));
      const err = new Error(out.error || 'The server said ' + res.status + '.');
      err.status = res.status;
      throw err;
    }
    return opts.raw ? res : res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server took too long to answer.');
    throw e;
  } finally { clearTimeout(timer); }
}

export const serverStats = () => api('/stats');

// ---------- Sync ----------

export function scheduleSync(ms = 1500) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync(), ms);
}

export async function sync() {
  if (!meta.token) { setStatus('signedout'); return; }
  if (!navigator.onLine) { setStatus('offline'); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setStatus('syncing');
  try {
    await uploadFiles();
    for (let round = 0; round < 100; round++) {
      const dirty = [...items.values()].filter(r => r.dirty && !r.conflict).slice(0, 200);
      const sent = new Map(dirty.map(r => [r.id, r.editSeq]));
      const res = await api('/sync', {
        method: 'POST',
        body: JSON.stringify({ since: meta.seq, device: meta.device, changes: dirty.map(r => ({ id: r.id, base_rev: r.baseRev || 0, deleted: !!r.deleted, data: r.deleted ? null : r.data })) }),
      });

      if (res.head < meta.seq) {
        // The server has less than we've seen (its data was reset): send everything again.
        meta.seq = 0;
        for (const r of items.values()) { r.baseRev = 0; r.rev = 0; if (!r.deleted) r.dirty = true; }
        await putItems([...items.values()]);
        continue;
      }

      const sentData = new Map(dirty.map(r => [r.id, r.deleted ? null : structuredClone(r.data)]));
      const changed = new Map();
      for (const a of res.accepted) {
        const r = items.get(a.id);
        if (!r) continue;
        r.rev = r.baseRev = a.rev;
        if (r.editSeq === sent.get(a.id)) { r.dirty = false; r.baseData = null; }
        else r.baseData = sentData.get(a.id);
        changed.set(r.id, r);
      }
      for (const c of res.conflicts) {
        const r = items.get(c.id);
        if (!r) continue;
        clash(r, { rev: c.rev, data: c.data, deleted: c.deleted, device: c.device, updated_at: c.updated_at });
        changed.set(r.id, r);
      }
      for (const x of res.rejected || []) setStatus('error', x.error);
      for (const it of res.items) {
        let r = items.get(it.id);
        if (!r) {
          r = { id: it.id, data: it.data || {}, deleted: it.deleted, rev: it.rev, baseRev: it.rev, dirty: false, editSeq: 0, conflict: null };
          items.set(r.id, r); changed.set(r.id, r);
          continue;
        }
        if (it.rev <= (r.rev || 0)) continue;
        if (r.dirty) {
          // Unsent edits here, newer version there.
          if (!r.conflict || it.rev > r.conflict.rev) clash(r, { rev: it.rev, data: it.data, deleted: it.deleted, device: it.device, updated_at: it.updated_at });
        } else {
          r.data = it.data || {}; r.deleted = it.deleted; r.rev = r.baseRev = it.rev;
        }
        changed.set(r.id, r);
      }
      // Tombstones the server has confirmed can go.
      const gone = [...changed.values()].filter(r => r.deleted && !r.dirty && !r.conflict);
      for (const r of gone) { items.delete(r.id); changed.delete(r.id); }
      if (gone.length) await tx('items', 'readwrite', s => { for (const r of gone) s.delete(r.id); });

      meta.seq = res.seq;
      await putItems([...changed.values()]);
      await saveMeta('seq');
      if (changed.size || gone.length) emit([...changed.keys(), ...gone.map(r => r.id)]);

      // Anything changed since this round started (including quietly merged items) goes up now.
      const stillDirty = [...items.values()].some(r => r.dirty && !r.conflict && (!sent.has(r.id) || r.editSeq !== sent.get(r.id)));
      if (!res.more && !stillDirty && dirty.length < 200) break;
    }
    status.lastSync = Date.now();
    setStatus(status.state === 'error' ? 'error' : 'idle', status.state === 'error' ? status.message : '');
  } catch (e) {
    if (e.status === 401) { meta.token = null; await saveMeta('token'); setStatus('signedout', 'Signed out. Sign in again to sync.'); }
    // A TypeError from fetch means no connection (phones often claim to be online with no signal).
    else if (!navigator.onLine || e instanceof TypeError || /too long/.test(e.message)) setStatus('offline', e.message);
    else setStatus('error', e.message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
}

// ---------- Merging ----------

// This device's unsent edit meets a newer version from another device. If the two changed
// different things (say, the title here and the due date there, or cards moved on different
// boards), combine them quietly. Only real clashes are kept for you to pick.
function clash(r, theirs) {
  const merged = autoMerge(r, theirs);
  if (merged) {
    r.data = merged; r.rev = r.baseRev = theirs.rev; r.baseData = structuredClone(theirs.data);
    r.dirty = true; r.editSeq = (r.editSeq || 0) + 1; r.conflict = null;
    return;
  }
  r.conflict = theirs;
}

function autoMerge(r, theirs) {
  if (r.deleted || theirs.deleted || !theirs.data) return null;
  // Settings: the newest wins.
  if (r.data.type === 'pref') return (theirs.data.updated || '') > (r.data.updated || '') ? structuredClone(theirs.data) : { ...r.data };
  const base = r.baseData;
  if (!base) return null;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const out = structuredClone(theirs.data);
  const keys = new Set([...Object.keys(base), ...Object.keys(r.data), ...Object.keys(theirs.data)]);
  keys.delete('updated');
  for (const k of keys) {
    const mine = r.data[k], other = theirs.data[k], was = base[k];
    if (same(mine, was) || same(mine, other)) continue;      // only they changed it, or both made the same change
    if (same(other, was)) { if (mine === undefined) delete out[k]; else out[k] = structuredClone(mine); continue; } // only we changed it
    if (k === 'cork') { const m = mergeKeyed(was, mine, other); if (!m) return null; out[k] = m; continue; }
    if (k === 'links') { out[k] = mergeLinks(was, mine, other); continue; }
    return null; // both changed the same thing differently
  }
  out.updated = [r.data.updated || '', theirs.data.updated || ''].sort().pop();
  return out;
}

// Board positions: merge per board; a clash only if both moved the same card on the same board.
function mergeKeyed(was = {}, mine = {}, other = {}) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const out = { ...other };
  for (const k of new Set([...Object.keys(was), ...Object.keys(mine), ...Object.keys(other)])) {
    if (same(mine[k], was[k]) || same(mine[k], other[k])) continue;
    if (same(other[k], was[k])) { if (mine[k] === undefined) delete out[k]; else out[k] = mine[k]; continue; }
    out[k] = mine[k]; // both moved it: this device's spot wins, nothing worth asking about
  }
  return out;
}

// Strings: keep every string either side added, drop any either side removed.
function mergeLinks(was = [], mine = [], other = []) {
  const key = l => l.to;
  const wasK = new Set(was.map(key)), mineK = new Set(mine.map(key));
  const removed = new Set([...wasK].filter(k => !mineK.has(k)));
  const out = new Map(other.filter(l => !removed.has(key(l))).map(l => [key(l), l]));
  for (const l of mine) if (!wasK.has(key(l))) out.set(key(l), l);
  return [...out.values()];
}

// ---------- Photos ----------

// Shrinks a photo, keeps it on this device and queues it for upload. Returns its id.
export async function addPhoto(file) {
  const blob = await shrink(file);
  const id = newId();
  await tx('files', 'readwrite', s => s.put({ id, blob, mime: blob.type, uploaded: false }));
  fileUrls.set(id, URL.createObjectURL(blob));
  scheduleSync(300);
  return id;
}

async function shrink(file, max = 2000) {
  if (file.type === 'image/gif') return file;
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) { throw new Error('This browser can’t open that kind of image.'); }
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size < 1_800_000) return blob;
  }
  throw new Error('That photo is too big even after shrinking.');
}

async function uploadFiles() {
  const pending = await tx('files', 'readonly', s => reqP(s.getAll()));
  for (const f of (await pending).filter(f => !f.uploaded)) {
    await api('/files?id=' + encodeURIComponent(f.id), { method: 'POST', body: f.blob, headers: { 'Content-Type': f.mime || 'image/jpeg' }, timeout: 120_000 });
    f.uploaded = true;
    await tx('files', 'readwrite', s => s.put(f));
  }
}

// An object URL for a photo: from this device, or fetched (and kept) when online.
export async function fileUrl(id) {
  if (fileUrls.has(id)) return fileUrls.get(id);
  const f = await tx('files', 'readonly', s => reqP(s.get(id)));
  const rec = await f;
  if (rec) { const u = URL.createObjectURL(rec.blob); fileUrls.set(id, u); return u; }
  if (!meta.token || !navigator.onLine) return null;
  try {
    const res = await api('/files/' + encodeURIComponent(id), { raw: true, timeout: 60_000 });
    const blob = await res.blob();
    await tx('files', 'readwrite', s => s.put({ id, blob, mime: blob.type, uploaded: true }));
    const u = URL.createObjectURL(blob); fileUrls.set(id, u); return u;
  } catch (e) { return null; }
}

// ---------- Backup ----------

export function exportJson() {
  const out = [...items.values()].filter(r => !r.deleted).map(r => ({ id: r.id, ...r.data }));
  return JSON.stringify({ app: 'Brain Tree', exported: new Date().toISOString(), device: meta.device, items: out }, null, 2);
}
