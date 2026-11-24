// (0.9.0) Reminders: notifications on this device, sent by the server (web push) even when Brain
// Tree is closed. The app works out what to say and when, for the next two weeks: each to-do's own
// reminder (data.remind, a time on its due date) and, if you want one, a morning summary of what's
// due that day. It hands that list to the server (POST /push/plan), which sends each when its time
// comes to every device that switched reminders on. Whichever device changes things sends it again.
// (On an iPhone this works in the home-screen app, iOS 16.4 or later; not in a Safari tab.)

import * as store from './store.js';

const read = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const toB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const enabled = () => !!read('bt-push-on', false) && supported() && Notification.permission === 'granted';

async function registration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r => setTimeout(() => r(null), 6000))]);
  if (!reg) throw new Error('Brain Tree’s offline helper isn’t running on this device yet. Reload the app and try again.');
  return reg;
}

// Ask (must come from a tap), sign this device up, and tell the server.
export async function turnOn() {
  if (!supported()) throw new Error(isIOS() && !standalone() ? 'On an iPhone, reminders work in the home-screen app: add Brain Tree to your home screen (Share → Add to Home Screen), open it from there, and switch them on in its Settings.' : 'This browser can’t show notifications from web apps.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for Brain Tree. Allow them in the phone’s Settings → Notifications → Brain Tree (or the browser’s site settings), then try again.' : 'Brain Tree wasn’t allowed to show notifications.');
  const reg = await registration();
  const { key } = await store.call('/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (sub && toB64u(sub.options?.applicationServerKey || new ArrayBuffer(0)) !== key) { await sub.unsubscribe().catch(() => {}); sub = null; }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
  await store.call('/push/sub', { method: 'POST', body: JSON.stringify({ sub: sub.toJSON(), device: store.device() }) });
  write('bt-push-on', true);
  write('bt-push-plan', '');   // send the list again
}

export async function turnOff() {
  write('bt-push-on', false);
  const reg = await registration().catch(() => null);
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await store.call('/push/sub', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export async function test() {
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) throw new Error('This device isn’t signed up. Switch reminders on again.');
  await store.call('/push/test', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) });
}

export const status = () => store.call('/push/status');

// What to send, and when (ms since 1970): [{ at, title, body, tag, url }]
// ctx: { I, today, addDays, titleOf, isWaiting, morning ('08:00' or ''), fmtDay }
export function planFor(ctx) {
  const { I, today, addDays, titleOf, isWaiting, morning } = ctx;
  const now = Date.now(), t = today(), out = [];
  const at = (day, hm) => { const [y, m, d] = day.split('-').map(Number), [h, mi] = hm.split(':').map(Number); return new Date(y, m - 1, d, h, mi).getTime(); };
  const where = r => { const p = I.project(r); return p ? `#/project/${p.id}/${r.id}` : `#/inbox/${r.id}`; };
  const open = I.work.filter(r => r.data.type === 'task' && !r.data.done);
  for (const r of open) {
    if (!r.data.remind || !r.data.due || r.data.due > addDays(t, 30)) continue;
    const when = at(r.data.due, r.data.remind);
    if (when <= now) continue;
    const p = I.project(r);
    out.push({ at: when, title: titleOf(r), body: [p ? titleOf(p) : '', isWaiting(r) ? 'Still waiting on something' : 'Due today'].filter(Boolean).join(' · '), tag: 'r-' + r.id, url: where(r) });
  }
  if (morning) {
    for (let i = 0; i < 14; i++) {
      const day = addDays(t, i), when = at(day, morning);
      if (when <= now) continue;
      const due = open.filter(r => r.data.due && r.data.due <= day && !isWaiting(r)).sort((a, b) => a.data.due.localeCompare(b.data.due));
      if (!due.length) continue;
      const late = due.filter(r => r.data.due < day).length;
      out.push({ at: when, title: `${due.length} thing${due.length === 1 ? '' : 's'} for today${late ? ` (${late} late)` : ''}`, body: due.slice(0, 4).map(r => titleOf(r)).join(' · ') + (due.length > 4 ? ` · and ${due.length - 4} more` : ''), tag: 'morning', url: '#/today' });
    }
  }
  return out.sort((a, b) => a.at - b.at).slice(0, 300);
}

// Send the list to the server when it's changed (and at most every few seconds).
let timer = 0;
export function schedule(makePlan) {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    if (!store.signedIn() || !navigator.onLine || store.status.state === 'signedout') return;
    let items;
    try { items = makePlan(); } catch (e) { return; }
    const sig = JSON.stringify(items);
    if (sig === read('bt-push-plan', '') && Date.now() - read('bt-push-plan-at', 0) < 6 * 3600e3) return;
    try {
      await store.call('/push/plan', { method: 'POST', body: JSON.stringify({ items }) });
      write('bt-push-plan', sig); write('bt-push-plan-at', Date.now());
    } catch (e) { /* next time */ }
  }, 4000);
}
