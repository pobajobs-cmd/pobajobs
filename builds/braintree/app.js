// Brain Tree: projects, to-dos and notes in one tree, on every device, offline first.
// Everything is an "item" (data.type = task | note | project | section); any item can sit inside
// another (data.parent), which is how projects hold their to-dos and notes. A section is a
// group inside a project: a heading in the project's list, a labelled frame on its board.

import * as store from './store.js';
import { createEditor, textOf, firstPhoto, escHtml as esc } from './editor.js';
import { createBoard, COLOURS } from './board.js';
import * as theme from './theme.js';

const VERSION = '0.4.1';
const $ = (sel, el = document) => el.querySelector(sel);
const TYPE_NAMES = { task: 'To-do', note: 'Note', project: 'Project', section: 'Section' };
const SMART = [
  { id: 'today', name: 'Today', icon: 'sun' },
  { id: 'upcoming', name: 'Upcoming', icon: 'cal' },
  { id: 'inbox', name: 'Inbox', icon: 'tray' },
  { id: 'todos', name: 'All to-dos', icon: 'check' },
  { id: 'notes', name: 'Notes', icon: 'note' },
];
const ICON = {
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  tray: '<svg viewBox="0 0 24 24"><path d="M3 13l3-8h12l3 8v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 13.5h6M13.5 11l2.5 2.5-2.5 2.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  board: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><circle cx="16" cy="9" r="1.5"/><circle cx="12" cy="15" r="1.5"/><path d="M8 9l4 6 4-6"/></svg>',
  string: '<svg viewBox="0 0 24 24"><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><path d="M5 7c3 9 11 9 14 0"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  caret: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 10h14M5 14h9M5 18h6"/></svg>',
  section: '<svg viewBox="0 0 24 24"><path d="M4 9V6a1 1 0 0 1 1-1h3M16 5h3a1 1 0 0 1 1 1v3M20 15v3a1 1 0 0 1-1 1h-3M8 19H5a1 1 0 0 1-1-1v-3"/><path d="M8 10h8M8 14h5"/></svg>',
};
const typeIcon = t => (t === 'project' ? ICON.folder : t === 'section' ? ICON.section : t === 'task' ? ICON.check : ICON.note);

// ---------- State ----------

let route = { view: null, project: null, item: null };
let search = '';
let I = null;                       // index of the current data, rebuilt on every change
let editor = null, editingId = null, titleTimer = null;
const openDone = new Set();         // lists with their "Done" section expanded
const collapsed = new Set(readLocal('bt-collapsed', []));
const wide = matchMedia('(min-width: 900px)');

function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } }
function writeLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }

// ---------- Dates ----------

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);

function fmtDay(s) {
  if (!s) return '';
  const diff = daysBetween(today(), s);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = parseYmd(s);
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = fmtDay(ymd(d));
  return (day === 'Today' || day === 'Yesterday' ? day : day) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---------- Index ----------

function buildIndex() {
  const byId = new Map(), kids = new Map(), trashed = [];
  for (const r of store.all()) if (!r.deleted && r.data.type !== 'pref') byId.set(r.id, r);
  const aliveMemo = new Map();
  const alive = (r, depth = 0) => {
    if (aliveMemo.has(r.id)) return aliveMemo.get(r.id);
    let ok = !r.data.trashed;
    const p = ok && r.data.parent && byId.get(r.data.parent);
    if (p && depth < 60 && p.id !== r.id) ok = alive(p, depth + 1);
    aliveMemo.set(r.id, ok);
    return ok;
  };
  for (const r of byId.values()) {
    if (alive(r)) {
      const p = r.data.parent && byId.has(r.data.parent) ? r.data.parent : '';
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(r);
    } else if (r.data.trashed && !(r.data.parent && byId.get(r.data.parent)?.data.trashed)) trashed.push(r);
  }
  const parentOf = r => (r.data.parent && byId.has(r.data.parent) ? byId.get(r.data.parent) : null);
  const descendants = (id, out = [], seen = new Set()) => {
    for (const k of kids.get(id) || []) { if (seen.has(k.id)) continue; seen.add(k.id); out.push(k); descendants(k.id, out, seen); }
    return out;
  };
  const ancestors = r => { const out = []; let p = parentOf(r); while (p && out.length < 60 && !out.includes(p)) { out.unshift(p); p = parentOf(p); } return out; };
  const project = r => { let p = parentOf(r), n = 0; while (p && n++ < 60) { if (p.data.type === 'project') return p; p = parentOf(p); } return null; };
  const live = [...byId.values()].filter(r => alive(r));
  return { byId, kids, trashed, alive: r => byId.has(r.id) && alive(r), parentOf, descendants, ancestors, project, live };
}

function progress(id) {
  const tasks = I.descendants(id).filter(r => r.data.type === 'task');
  return { total: tasks.length, done: tasks.filter(r => r.data.done).length };
}

const titleOf = r => (r.data.title || '').trim() || (r.data.type === 'note' ? textOf(r.data.body).slice(0, 60) : '') || 'Untitled';
const isOpen = r => (r.data.type === 'task' || r.data.type === 'project') && !r.data.done;
const byDueThenOrder = (a, b) => (a.data.due || '9999').localeCompare(b.data.due || '9999') || (a.data.order || 0) - (b.data.order || 0);
const byPinnedUpdated = (a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || (b.data.updated || '').localeCompare(a.data.updated || '');
const bySectionOrder = (a, b) => (a.data.order || 0) - (b.data.order || 0) || (a.data.created || '').localeCompare(b.data.created || '');

// ---------- Routing ----------

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'project') return { view: null, project: parts[1] || null, item: parts[2] || null, board: null };
  if (parts[0] === 'board') return { view: 'board', project: null, board: parts[1] || null, item: parts[2] || null };
  return { view: parts[0] || null, project: null, item: parts[1] || null, board: null };
}

function go(next, replace = false) {
  const r = { ...route, ...next };
  const hash = r.project ? `#/project/${r.project}${r.item ? '/' + r.item : ''}`
    : r.view === 'board' ? `#/board/${r.board || ''}${r.item ? '/' + r.item : ''}`
    : r.view ? `#/${r.view}${r.item ? '/' + r.item : ''}` : '#/';
  if (replace) history.replaceState(null, '', hash); else if (location.hash !== hash) location.hash = hash;
  if (replace || location.hash === hash) onRoute();
}

function onRoute() {
  const prevItem = route.item;
  route = parseHash();
  if (!route.view && !route.project && wide.matches) route.view = 'today';
  if (prevItem !== route.item) { saveEditing(); editingId = null; }
  render();
}

const listKey = () => (search ? 'search' : route.project ? 'p:' + route.project : route.view || 'today');

// ---------- Rendering ----------

let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); }, 0);
}

function render() {
  I = buildIndex();
  if (route.project && !I.byId.has(route.project)) { go({ project: null, view: 'today', item: null }, true); return; }
  if (route.view === 'board') {
    // Boards belong to projects (there's no overall one any more); anything else opens its project's.
    const b = route.board && I.byId.get(route.board);
    const p = b && (b.data.type === 'project' ? b : I.project(b));
    if (!p) { go({ view: 'today', board: null, item: null }, true); return; }
    if (p.id !== route.board) { go({ board: p.id }, true); return; }
  }
  const onBoard = route.view === 'board' && !search;
  document.body.dataset.view = onBoard ? 'board' : 'lists';
  document.body.toggleAttribute('data-drawer', onBoard && !!route.item);
  document.body.dataset.pane = route.item ? 'detail' : (route.view || route.project || search) ? 'list' : 'nav';
  renderNav();
  if (onBoard) {
    board ??= createBoard($('#board'), boardApi);
    board.show(route.board);
  } else renderList();
  renderDetail();
}

let board = null;
const boardApi = {
  store,
  index: () => I,
  open: id => go({ item: id }),
  openBoard: id => go({ view: 'board', board: id, project: null, item: null }),
  selected: () => route.item,
  today: () => today(),
  fmtDay: s => fmtDay(s),
  progress: id => progress(id),
  titleOf: r => titleOf(r),
  toast: (...a) => toast(...a),
  newItem: (type, parent, extra) => newItem(type, parent ?? null, extra),
  placePicker: (key, exclude, onPick) => pickItem({ title: 'Bring onto this board', exclude: new Set(exclude), only: r => r.data.type !== 'section', onPick }),
  style: () => theme.current(store).look,
};

function renderNav() {
  const t = today();
  const counts = {
    today: I.live.filter(r => isOpen(r) && r.data.due && r.data.due <= t).length,
    inbox: I.live.filter(r => !I.parentOf(r) && r.data.type !== 'project' && r.data.type !== 'section' && !(r.data.type === 'task' && r.data.done)).length,
  };
  const active = id => !search && route.view === id && !route.project;
  $('#smart').innerHTML = SMART.map(s => `
    <a href="#/${s.id}" class="navrow ${active(s.id) ? 'on' : ''}" data-view="${s.id}">
      <span class="ic ic-${s.id}">${ICON[s.icon]}</span><span class="name">${s.name}</span>
      ${counts[s.id] ? `<span class="count ${s.id === 'today' && I.live.some(r => isOpen(r) && r.data.due && r.data.due < t) ? 'late' : ''}">${counts[s.id]}</span>` : ''}
    </a>`).join('');

  // Project tree: projects nest under the nearest project above them.
  const projects = I.live.filter(r => r.data.type === 'project' && !r.data.done);
  const under = new Map();
  for (const p of projects) { const up = I.project(p); const k = up && !up.data.done ? up.id : ''; if (!under.has(k)) under.set(k, []); under.get(k).push(p); }
  const branch = (key, depth) => (under.get(key) || []).sort((a, b) => (a.data.order || 0) - (b.data.order || 0)).map(p => {
    const subs = under.has(p.id);
    const { total, done } = progress(p.id);
    const shut = collapsed.has(p.id);
    return `
      <div class="navrow proj ${(route.project === p.id || (route.view === 'board' && route.board === p.id)) && !search ? 'on' : ''}" data-project="${p.id}" style="--depth:${depth}">
        <button class="caret ${subs ? '' : 'none'} ${shut ? '' : 'open'}" data-toggle="${p.id}" aria-label="Show or hide sub-projects">${subs ? ICON.caret : ''}</button>
        <span class="ic">${ICON.folder}</span><span class="name">${esc(titleOf(p))}</span>
        ${total ? `<span class="count">${done}/${total}</span>` : ''}
      </div>${subs && !shut ? branch(p.id, depth + 1) : ''}`;
  }).join('');
  const doneProjects = I.live.filter(r => r.data.type === 'project' && r.data.done).length;
  $('#projects').innerHTML = (branch('', 0) || '<p class="empty-nav">No projects yet. Tap + to start one.</p>')
    + (doneProjects ? `<a href="#/done-projects" class="navrow small ${route.view === 'done-projects' && !search ? 'on' : ''}"><span class="ic">${ICON.check}</span><span class="name">Finished projects</span><span class="count">${doneProjects}</span></a>` : '');

  const conflicts = store.conflicts().length;
  $('#lower').innerHTML = `
    ${conflicts ? `<a href="#/conflicts" class="navrow warn ${route.view === 'conflicts' ? 'on' : ''}"><span class="ic">${ICON.warn}</span><span class="name">Conflicts</span><span class="count late">${conflicts}</span></a>` : ''}
    <a href="#/trash" class="navrow ${route.view === 'trash' ? 'on' : ''}"><span class="ic">${ICON.trash}</span><span class="name">Recently deleted</span>${I.trashed.length ? `<span class="count">${I.trashed.length}</span>` : ''}</a>`;
  renderSyncBar();
}

function renderSyncBar() {
  const s = store.status, n = store.pendingCount();
  let text, cls = s.state;
  if (s.state === 'signedout') text = 'Not signed in · changes stay on this device';
  else if (s.state === 'offline') text = n ? `Offline · ${n} change${n === 1 ? '' : 's'} waiting` : 'Offline · all saved here';
  else if (s.state === 'syncing') text = 'Syncing…';
  else if (s.state === 'error') text = 'Sync problem: ' + s.message;
  else text = s.lastSync ? (n ? `${n} change${n === 1 ? '' : 's'} waiting` : 'Synced ' + new Date(s.lastSync).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })) : 'Ready';
  $('#syncbar').innerHTML = `<button class="sync ${cls}" data-act="sync" title="Sync now"><i></i><span>${esc(text)}</span></button>
    ${s.state === 'signedout' ? '<button class="link" data-act="login">Sign in</button>' : ''}`;
}

// ---------- List pane ----------

function renderList() {
  const key = listKey();
  const t = today();
  let title = '', head = '', groups = [], addHint = 'Add a to-do', canAdd = true;

  if (search) {
    title = 'Search';
    const q = search.toLowerCase();
    const hits = I.live.filter(r => (titleOf(r) + ' ' + textOf(r.data.body)).toLowerCase().includes(q)).sort(byPinnedUpdated);
    groups = [{ name: hits.length ? `${hits.length} found` : 'Nothing found', items: hits }];
    canAdd = false;
  } else if (route.project) {
    const p = I.byId.get(route.project);
    title = titleOf(p);
    const kids = I.kids.get(p.id) || [];
    const { total, done } = progress(p.id);
    const span = p.data.start || p.data.due ? `<span class="chip">${ICON.cal}${p.data.start ? fmtDay(p.data.start) : '…'} → ${p.data.due ? fmtDay(p.data.due) : '…'}</span>` : '';
    head = `
      <button class="projcard" data-open="${p.id}">
        <span class="row1">${span}${total ? `<span class="chip">${done} of ${total} done</span>` : ''}${p.data.done ? '<span class="chip ok">Finished</span>' : ''}</span>
        ${total ? `<span class="bar"><i style="width:${Math.round(100 * done / total)}%"></i></span>` : ''}
        <span class="row2">${textOf(p.data.body) ? esc(textOf(p.data.body).slice(0, 140)) : 'Project notes, links and photos'}<b>Open ›</b></span>
      </button>`;
    // Loose things first, then each section as a heading with what's in it (like the board's frames).
    const sections = kids.filter(r => r.data.type === 'section').sort(bySectionOrder);
    const inSections = sections.flatMap(s => I.kids.get(s.id) || []);
    const openOf = list => [
      ...list.filter(r => r.data.type === 'task' && !r.data.done).sort(byDueThenOrder),
      ...list.filter(r => r.data.type === 'project').sort(byDueThenOrder),
      ...list.filter(r => r.data.type === 'note').sort(byPinnedUpdated),
    ];
    groups = [
      { name: 'To-dos', items: kids.filter(r => r.data.type === 'task' && !r.data.done).sort(byDueThenOrder) },
      { name: 'Sub-projects', items: kids.filter(r => r.data.type === 'project').sort(byDueThenOrder) },
      { name: 'Notes', items: kids.filter(r => r.data.type === 'note').sort(byPinnedUpdated) },
      ...sections.map(s => ({ name: titleOf(s), section: s, items: openOf(I.kids.get(s.id) || []) })),
      { name: 'Done', items: [...kids, ...inSections].filter(r => r.data.type === 'task' && r.data.done).sort((a, b) => (b.data.doneAt || '').localeCompare(a.data.doneAt || '')), done: true },
    ];
  } else {
    const v = route.view || 'today';
    title = (SMART.find(s => s.id === v) || {}).name || { trash: 'Recently deleted', conflicts: 'Conflicts', 'done-projects': 'Finished projects' }[v] || 'Brain Tree';
    if (v === 'today') {
      const open = I.live.filter(r => isOpen(r));
      groups = [
        { name: 'Overdue', items: open.filter(r => r.data.due && r.data.due < t).sort(byDueThenOrder), late: true },
        { name: 'Today', items: open.filter(r => r.data.due === t || (r.data.start === t && !r.data.due)).sort(byDueThenOrder) },
        { name: 'Done today', items: I.live.filter(r => r.data.type === 'task' && r.data.done && (r.data.doneAt || '').startsWith(t)), done: true },
      ];
    } else if (v === 'upcoming') {
      addHint = 'Add a to-do for tomorrow';
      const open = I.live.filter(r => isOpen(r) && ((r.data.due && r.data.due > t) || (r.data.start && r.data.start > t)));
      const keyDate = r => (r.data.start && r.data.start > t && (!r.data.due || r.data.start < r.data.due) ? r.data.start : r.data.due) || r.data.start;
      const map = new Map();
      for (const r of open.sort((a, b) => keyDate(a).localeCompare(keyDate(b)))) {
        const k = keyDate(r), diff = daysBetween(t, k);
        const label = diff < 7 ? fmtDay(k) : parseYmd(k).toLocaleDateString(undefined, { month: 'long', year: parseYmd(k).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
        if (!map.has(label)) map.set(label, []);
        map.get(label).push(r);
      }
      groups = [...map].map(([name, items]) => ({ name, items }));
      if (!groups.length) groups = [{ name: '', items: [], empty: 'Nothing with a future date yet. Give to-dos and projects a start or due date to see them here.' }];
    } else if (v === 'inbox') {
      const loose = I.live.filter(r => !I.parentOf(r) && r.data.type !== 'project');
      groups = [
        { name: 'To-dos', items: loose.filter(r => r.data.type === 'task' && !r.data.done).sort(byDueThenOrder) },
        { name: 'Notes', items: loose.filter(r => r.data.type === 'note').sort(byPinnedUpdated) },
        { name: 'Done', items: loose.filter(r => r.data.type === 'task' && r.data.done).sort((a, b) => (b.data.doneAt || '').localeCompare(a.data.doneAt || '')), done: true },
      ];
    } else if (v === 'todos') {
      const open = I.live.filter(r => r.data.type === 'task' && !r.data.done);
      const map = new Map();
      for (const r of open) { const p = I.project(r); const k = p ? titleOf(p) : ' No project'; if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
      groups = [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([name, items]) => ({ name: name.trim(), items: items.sort(byDueThenOrder) }));
    } else if (v === 'notes') {
      addHint = 'New note title';
      groups = [{ name: '', items: I.live.filter(r => r.data.type === 'note').sort(byPinnedUpdated) }];
    } else if (v === 'done-projects') {
      canAdd = false;
      groups = [{ name: '', items: I.live.filter(r => r.data.type === 'project' && r.data.done).sort((a, b) => (b.data.doneAt || '').localeCompare(a.data.doneAt || '')) }];
    } else if (v === 'trash') {
      canAdd = false;
      head = I.trashed.length ? '<div class="trashbar"><span>Deleted items stay here until you empty it.</span><button class="danger" data-act="empty-trash">Empty</button></div>' : '';
      groups = [{ name: '', items: I.trashed.sort((a, b) => (b.data.trashed || '').localeCompare(a.data.trashed || '')), trash: true }];
    } else if (v === 'conflicts') {
      canAdd = false;
      head = '<p class="hint">These were changed on two devices before they could sync. Open one to compare and pick which to keep.</p>';
      groups = [{ name: '', items: store.conflicts().filter(r => !r.deleted || r.conflict) }];
    }
  }

  $('#listTitle').textContent = title;
  $('#listHead').innerHTML = head;
  $('#boardBtn').hidden = !route.project || !!search;
  const qa = $('#quickAdd');
  qa.hidden = !canAdd;
  qa.querySelector('input').placeholder = addHint;

  const html = groups.map(g => {
    if (g.section) {
      const s = g.section, n = (I.kids.get(s.id) || []).length;
      return `<div class="group sec ${s.data.color ? 'c-' + s.data.color : ''}">
        <div class="sechead ${route.item === s.id ? 'on' : ''}" data-open="${s.id}" role="button" tabindex="0">
          <span class="sname">${esc(g.name)}</span>${n ? `<span class="scount">${n}</span>` : ''}
          <button class="secadd" data-new="task" data-parent="${s.id}" aria-label="Add a to-do to ${esc(g.name)}" title="Add a to-do here">${ICON.plus}</button>
        </div>
        ${g.items.length ? g.items.map(r => rowHTML(r, { inProject: true })).join('') : '<p class="secempty">Nothing open in this section.</p>'}</div>`;
    }
    if (!g.items.length) return g.empty ? `<p class="empty">${esc(g.empty)}</p>` : '';
    const doneKey = key + ':' + g.name;
    if (g.done) {
      const isOpenSec = openDone.has(doneKey);
      return `<div class="group done"><button class="gname toggle" data-done="${esc(doneKey)}">${esc(g.name)} (${g.items.length}) <span>${isOpenSec ? 'Hide' : 'Show'}</span></button>
        ${isOpenSec ? g.items.map(r => rowHTML(r, { trash: g.trash })).join('') : ''}</div>`;
    }
    return `<div class="group ${g.late ? 'late' : ''}">${g.name ? `<div class="gname">${esc(g.name)}</div>` : ''}${g.items.map(r => rowHTML(r, { trash: g.trash, inProject: !!route.project })).join('')}</div>`;
  }).join('');
  const nothing = !groups.some(g => g.items.length);
  $('#listBody').innerHTML = html || (nothing ? `<p class="empty">${emptyText()}</p>` : '');
  hydrateThumbs($('#listBody'));
}

function emptyText() {
  if (search) return 'Nothing matches that.';
  if (route.project) return 'Nothing in this project yet. Add a to-do above, or use + for notes, sections and sub-projects.';
  return {
    today: 'Nothing due today. Enjoy it, or add something above.',
    inbox: 'Loose to-dos and notes land here.',
    todos: 'No open to-dos.',
    notes: 'No notes yet.',
    trash: 'Nothing deleted.',
    conflicts: 'No conflicts.',
    'done-projects': 'No finished projects yet.',
  }[route.view] || '';
}

function rowHTML(r, { trash = false, inProject = false } = {}) {
  const d = r.data, t = today();
  const type = d.type || 'note';
  const sel = route.item === r.id ? 'on' : '';
  const proj = !inProject && I.project(r);
  const chips = [];
  if (type === 'project' && (d.start || d.due)) chips.push(`<span class="chip ${!d.done && d.due && d.due < t ? 'late' : ''}">${ICON.cal}${d.start ? fmtDay(d.start) : '…'} → ${d.due ? fmtDay(d.due) : '…'}</span>`);
  else if (d.due && type !== 'note') chips.push(`<span class="chip ${!d.done && d.due < t ? 'late' : d.due === t ? 'now' : ''}">${ICON.cal}${fmtDay(d.due)}</span>`);
  else if (d.start && d.start > t && type !== 'note') chips.push(`<span class="chip">Starts ${fmtDay(d.start)}</span>`);
  if (type === 'project') { const { total, done } = progress(r.id); if (total) chips.push(`<span class="chip">${done}/${total}</span>`); }
  if (proj) { const sec = I.parentOf(r)?.data.type === 'section' ? I.parentOf(r) : null; chips.push(`<span class="chip proj">${ICON.folder}${esc(titleOf(proj))}${sec ? ' › ' + esc(titleOf(sec)) : ''}</span>`); }
  const kidCount = (I.kids.get(r.id) || []).length;
  if (kidCount && type !== 'project') chips.push(`<span class="chip">${kidCount} inside</span>`);
  if (r.conflict) chips.push(`<span class="chip late">${ICON.warn}Conflict</span>`);
  if (r.dirty && store.status.state !== 'signedout') chips.push('<span class="dot-pending" title="Not synced yet"></span>');
  const photo = firstPhoto(d.body);
  const snippet = type === 'note' ? textOf(d.body).slice(0, 120) : '';
  const lead = type === 'task' ? `<button class="tick ${d.done ? 'done' : ''}" data-tick="${r.id}" aria-label="${d.done ? 'Mark not done' : 'Mark done'}"></button>`
    : `<span class="ic t-${type}">${typeIcon(type)}</span>`;
  return `
    <div class="row ${sel} t-${type} ${d.done ? 'is-done' : ''} ${d.color ? 'c-' + d.color : ''}" data-open="${r.id}" role="button" tabindex="0">
      ${trash ? `<span class="ic">${typeIcon(type)}</span>` : lead}
      <span class="main">
        <span class="title">${d.pinned ? `<span class="pinmark">${ICON.pin}</span>` : ''}${esc(titleOf(r))}</span>
        ${type === 'note' ? `<span class="sub"><b>${esc(fmtDay(ymd(new Date(d.updated || d.created || Date.now()))))}</b> ${esc(snippet || 'No text')}</span>` : ''}
        ${chips.length ? `<span class="chips">${chips.join('')}</span>` : ''}
      </span>
      ${photo ? `<img class="thumb" data-thumb="${photo}" alt="">` : ''}
      ${trash ? `<span class="trashacts"><button data-restore="${r.id}">Restore</button><button class="danger" data-purge="${r.id}">Delete</button></span>` : ''}
    </div>`;
}

function hydrateThumbs(root) {
  for (const img of root.querySelectorAll('img[data-thumb]')) {
    store.fileUrl(img.dataset.thumb).then(u => { if (u) img.src = u; else img.remove(); });
  }
}

// ---------- Detail pane ----------

function renderDetail() {
  const host = $('#detail');
  let id = route.item;
  if (!id && route.project && wide.matches) id = route.project;
  const r = id && I.byId.get(id);
  if (!r) {
    if (editingId) { saveEditing(); editingId = null; }
    const raw = id && store.get(id);
    host.innerHTML = `<div class="blank">${ICON.note}<p>${raw?.conflict ? 'You deleted this here, but it was changed on another device.' : id ? 'That item has been deleted.' : 'Pick something, or make something new.'}</p>
      ${raw?.conflict ? `<button class="primary" data-act="compare" data-id="${id}">Compare</button>` : ''}
      ${id && !wide.matches ? `<button data-act="back">Back</button>` : ''}</div>`;
    return;
  }
  if (editingId !== id) buildDetail(host, r);
  updateDetail(r);
}

function buildDetail(host, r) {
  saveEditing();
  editingId = r.id;
  host.innerHTML = `
    <header class="bar">
      <button class="back" data-act="back">${ICON.back}<span>Back</span></button>
      <nav class="crumbs"></nav>
      <div class="acts">
        <button data-act="board" class="boardbtn" title="Open the board">${ICON.board}</button>
        <button data-act="pin" title="Pin to top">${ICON.pin}</button>
        <button data-act="move" title="Move into a project">${ICON.move}</button>
        <button data-act="trash" title="Delete">${ICON.trash}</button>
        <button data-act="back" class="closer" title="Close">${ICON.close}</button>
      </div>
    </header>
    <div class="scroll">
      <div class="banners"></div>
      <div class="head">
        <button class="tick big" data-act="tick" aria-label="Done"></button>
        <textarea class="title" rows="1" placeholder="Title" enterkeyhint="done"></textarea>
      </div>
      <div class="props">
        <label class="chip sel"><select class="type" aria-label="Type"></select></label>
        <label class="chip date"><span>Start</span><input type="date" class="start"><button type="button" class="x" data-clear="start" aria-label="Clear start date">×</button></label>
        <label class="chip date"><span>Due</span><input type="date" class="due"><button type="button" class="x" data-clear="due" aria-label="Clear due date">×</button></label>
        <button class="chip where" data-act="move"></button>
      </div>
      <div class="swatchrow" role="group" aria-label="Colour">
        <button class="sw none" data-colour-pick="" title="No colour">×</button>
        ${COLOURS.map(c => `<button class="sw c-${c}" data-colour-pick="${c}" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join('')}
      </div>
      <section class="inside top"></section>
      <div class="editor"></div>
      <section class="inside bottom"></section>
      <section class="links"></section>
      <footer class="stamp"></footer>
    </div>`;

  const title = $('.title', host);
  const grow = () => { title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; };
  title.addEventListener('input', () => {
    grow();
    clearTimeout(titleTimer);
    const id = r.id;
    titleTimer = setTimeout(() => { titleTimer = null; store.update(id, { title: title.value }); }, 400);
  });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); editor.focus(); } });
  title.addEventListener('blur', () => saveTitle());
  requestAnimationFrame(grow);

  $('.type', host).addEventListener('change', e => store.update(r.id, { type: e.target.value }));
  for (const k of ['start', 'due']) {
    $('.' + k, host).addEventListener('change', e => store.update(r.id, { [k]: e.target.value || undefined }));
  }

  editor = createEditor($('.editor', host), {
    onChange: html => { if (I.byId.get(r.id) && (I.byId.get(r.id).data.body || '') !== html) store.update(r.id, { body: html }); },
    resolveFile: id => store.fileUrl(id),
    addPhoto: file => store.addPhoto(file),
    onError: msg => toast(msg),
    onImage: src => { $('#lightbox img').src = src; $('#lightbox').hidden = false; },
  });
  editor.setHTML(r.data.body || '');
  // Brand new: straight into naming it (a placeholder name like "New section" is selected, ready to type over).
  if (r.data.created === r.data.updated) setTimeout(() => { title.focus(); title.select(); }, 50);
}

function saveTitle() {
  if (!titleTimer || !editingId) return;
  clearTimeout(titleTimer); titleTimer = null;
  const el = $('#detail .head .title');
  if (el) store.update(editingId, { title: el.value });
}

function saveEditing() {
  saveTitle();
  editor?.flush();
}

function updateDetail(r) {
  const host = $('#detail'), d = r.data, type = d.type || 'note';
  host.dataset.type = type;
  host.classList.toggle('is-done', !!d.done);

  const crumbs = I.ancestors(r);
  $('.crumbs', host).innerHTML = crumbs.length
    ? crumbs.map(a => `<a data-open="${a.id}">${esc(titleOf(a))}</a>`).join('<i>›</i>')
    : `<span>${route.project ? '' : esc(TYPE_NAMES[type])}</span>`;

  const title = $('.title', host);
  if (document.activeElement !== title && !titleTimer && title.value !== (d.title || '')) { title.value = d.title || ''; title.style.height = 'auto'; title.style.height = title.scrollHeight + 'px'; }
  title.placeholder = type === 'task' ? 'What needs doing?' : type === 'project' ? 'Project name' : type === 'section' ? 'Section name' : 'Title';

  const parent = I.parentOf(r);
  const tick = $('.head .tick', host);
  tick.hidden = type === 'note' || type === 'section';
  tick.classList.toggle('done', !!d.done);
  // "Section" is only offered for things directly inside a project.
  const typeSel = $('.type', host);
  const types = ['task', 'note', 'project', ...(type === 'section' || parent?.data.type === 'project' ? ['section'] : [])];
  if ([...typeSel.options].map(o => o.value).join() !== types.join()) typeSel.innerHTML = types.map(t => `<option value="${t}">${TYPE_NAMES[t]}</option>`).join('');
  typeSel.value = type;
  for (const k of ['start', 'due']) {
    const input = $('.' + k, host);
    if (document.activeElement !== input) input.value = d[k] || '';
    input.closest('.chip').classList.toggle('set', !!d[k]);
    input.closest('.chip').classList.toggle('late', k === 'due' && !d.done && !!d.due && d.due < today());
    input.closest('.chip').hidden = type === 'section';
  }
  const proj = parent?.data.type === 'section' ? I.project(r) : null;
  $('.props .where', host).innerHTML = `${ICON.folder}<span>${parent ? (proj ? esc(titleOf(proj)) + ' › ' : '') + esc(titleOf(parent)) : 'No project'}</span>`;
  $('.acts [data-act=pin]', host).classList.toggle('on', !!d.pinned);
  // The board button: a project's own board, or the board of the project this is in.
  const bp = type === 'project' ? r : I.project(r);
  const bb = $('.acts .boardbtn', host);
  bb.hidden = !bp || (route.view === 'board' && route.board === bp.id);
  bb.title = type === 'project' ? 'Open this project’s board' : bp ? `Open “${titleOf(bp)}” board` : '';
  for (const b of host.querySelectorAll('[data-colour-pick]')) b.classList.toggle('on', (d.color || '') === b.dataset.colourPick);

  // Strings: links this item has to others, and others to it.
  const outgoing = (d.links || []).map(l => ({ id: l.to, label: l.label, from: r.id, to: l.to }));
  const incoming = I.live.filter(x => x.id !== r.id && (x.data.links || []).some(l => l.to === r.id))
    .map(x => ({ id: x.id, label: x.data.links.find(l => l.to === r.id).label, from: x.id, to: r.id }));
  const strings = [...outgoing, ...incoming].filter(x => I.byId.has(x.id));
  $('.links', host).innerHTML = `
    <div class="ihead"><h3>Strings</h3><span class="add"><button data-act="tie">+ Tie to…</button></span></div>
    ${strings.length ? strings.map(x => { const o = I.byId.get(x.id); return `
      <div class="lrow" data-open="${x.id}" role="button" tabindex="0">
        <span class="ic t-${o.data.type}">${typeIcon(o.data.type)}</span>
        <span class="name">${esc(titleOf(o))}</span>${x.label ? `<em>${esc(x.label)}</em>` : ''}
        <button class="untie" data-untie="${x.from}|${x.to}" aria-label="Cut this string">${ICON.close}</button>
      </div>`; }).join('') : '<p class="hint">Tie this to anything else in Brain Tree, here or by dragging from a card on a board.</p>'}`;

  // Body: only replace it from outside (another device) when you're not typing in it.
  if (!editor.element.contains(document.activeElement) && !editor.pending && editor.getHTML() !== (d.body || '')) editor.setHTML(d.body || '');

  // What's inside: projects and sections show it above their notes; other items below.
  const kids = (I.kids.get(r.id) || []);
  const group = type === 'project' || type === 'section';
  const top = $('.inside.top', host), bottom = $('.inside.bottom', host);
  const target = group ? top : bottom;
  (group ? bottom : top).innerHTML = '';
  const openTasks = kids.filter(k => k.data.type === 'task' && !k.data.done).sort(byDueThenOrder);
  const rank = k => ({ project: 0, section: 1 }[k.data.type] ?? 2);
  const others = kids.filter(k => k.data.type !== 'task').sort((a, b) => rank(a) - rank(b) || (a.data.type === 'section' ? bySectionOrder(a, b) : byPinnedUpdated(a, b)));
  const done = kids.filter(k => k.data.type === 'task' && k.data.done);
  const doneKey = 'in:' + r.id;
  const label = type === 'project' ? 'In this project' : type === 'section' ? 'In this section' : 'Inside';
  if (group || kids.length || target.dataset.forceOpen === r.id) {
    target.innerHTML = `
      <div class="ihead"><h3>${label}</h3>
        <span class="add"><button data-new="note" data-parent="${r.id}">+ Note</button>${type === 'project' ? `<button data-new="section" data-parent="${r.id}">+ Section</button>` : ''}<button data-new="project" data-parent="${r.id}">+ Sub-project</button></span></div>
      <form class="quick" data-parent="${r.id}"><span class="tick ghost"></span><input placeholder="Add a to-do" enterkeyhint="done"></form>
      ${openTasks.map(k => rowHTML(k, { inProject: true })).join('')}
      ${others.map(k => rowHTML(k, { inProject: true })).join('')}
      ${done.length ? `<button class="gname toggle" data-done="${doneKey}">Done (${done.length}) <span>${openDone.has(doneKey) ? 'Hide' : 'Show'}</span></button>${openDone.has(doneKey) ? done.map(k => rowHTML(k, { inProject: true })).join('') : ''}` : ''}`;
    hydrateThumbs(target);
  } else {
    target.innerHTML = `<button class="addinside" data-act="add-inside">+ Add steps or notes inside this ${TYPE_NAMES[type].toLowerCase()}</button>`;
  }

  // Banners
  const banners = [];
  if (d.trashed) banners.push(`<div class="banner">${ICON.trash}<span>This is in Recently deleted.</span><button data-restore="${r.id}">Restore</button></div>`);
  if (r.conflict) {
    const c = r.conflict;
    banners.push(`<div class="banner warn">${ICON.warn}<span>${c.deleted ? 'Deleted' : 'Also changed'} on ${esc(c.device || 'another device')}${c.updated_at ? ' (' + esc(fmtWhen(c.updated_at)) + ')' : ''} before this device synced.</span><button data-act="compare">Compare</button></div>`);
  }
  $('.banners', host).innerHTML = banners.join('');

  $('.stamp', host).textContent = [d.created ? 'Created ' + fmtWhen(d.created) : '', d.updated && d.updated !== d.created ? 'Edited ' + fmtWhen(d.updated) : '', r.dirty && store.signedIn() ? 'Not synced yet' : ''].filter(Boolean).join(' · ');
}

// ---------- Actions ----------

async function newItem(type, parent, extra = {}) {
  const t = today();
  if (parent === undefined) parent = route.project || null;
  if (!parent && type === 'task' && route.view === 'today' && !route.project) extra.due ??= t;
  if (!parent && type === 'task' && route.view === 'upcoming' && !route.project) extra.due ??= addDays(t, 1);
  const id = await store.create({ type, title: '', body: '', parent: parent || undefined, ...extra });
  return id;
}

function openItem(id) {
  go({ item: id });
}

async function toggleDone(id) {
  const r = store.get(id);
  if (!r) return;
  const done = !r.data.done;
  await store.update(id, { done, doneAt: done ? new Date().toISOString() : undefined });
  if (done && r.data.type === 'task') toast(`Done: ${titleOf(r)}`, 'Undo', () => store.update(id, { done: false, doneAt: undefined }));
}

async function trashItem(id) {
  const r = store.get(id);
  if (!r) return;
  saveEditing();
  if (r.data.type === 'section') {
    // Deleting a section keeps what's in it: those move up into the project.
    const kids = (I.kids.get(id) || []).map(k => k.id), to = r.data.parent;
    for (const k of kids) await store.update(k, { parent: to });
    await store.update(id, { trashed: new Date().toISOString() });
    if (route.item === id) go({ item: null });
    const p = to && I.byId.get(to);
    const where = `“${p ? titleOf(p) : 'the project'}”`;
    toast(`Section deleted${kids.length === 1 ? `. What was in it stays in ${where}` : kids.length ? `. Its ${kids.length} items stay in ${where}` : ''}`, 'Undo', async () => {
      await store.update(id, { trashed: undefined });
      for (const k of kids) await store.update(k, { parent: id });
    });
    return;
  }
  await store.update(id, { trashed: new Date().toISOString() });
  if (route.item === id) go({ item: null });
  else if (route.project === id) go({ project: null, view: 'today', item: null });
  const n = I.descendants(id).length;
  toast(`Moved to Recently deleted${n ? ` (with ${n} inside)` : ''}`, 'Undo', () => store.update(id, { trashed: undefined }));
}

async function purge(ids) {
  const all = new Set();
  for (const id of ids) {
    all.add(id);
    // Everything that was inside it goes too (including things trashed separately).
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      for (const r of store.all()) if (!r.deleted && r.data.parent === cur && !all.has(r.id)) { all.add(r.id); stack.push(r.id); }
    }
  }
  await store.destroy([...all]);
}

function movePicker(id) {
  const r = store.get(id);
  const isSection = r.data.type === 'section';
  const banned = new Set([id, ...I.descendants(id).map(k => k.id)]);
  const projects = I.live.filter(p => p.data.type === 'project' && !banned.has(p.id));
  const under = new Map();
  for (const p of projects) { const up = I.project(p); const k = up && !banned.has(up.id) ? up.id : ''; if (!under.has(k)) under.set(k, []); under.get(k).push(p); }
  // A project's sections are listed under it (a section itself can only go into a project).
  const sections = pid => isSection ? '' : (I.kids.get(pid) || []).filter(s => s.data.type === 'section' && !banned.has(s.id)).sort(bySectionOrder).map(s =>
    `<button class="pick sec ${r.data.parent === s.id ? 'on' : ''}" data-pick="${s.id}">${ICON.section}<span>${esc(titleOf(s))}</span></button>`).join('');
  const branch = (key, depth) => (under.get(key) || []).sort((a, b) => titleOf(a).localeCompare(titleOf(b))).map(p =>
    `<button class="pick ${r.data.parent === p.id ? 'on' : ''}" data-pick="${p.id}" style="--depth:${depth}">${ICON.folder}<span>${esc(titleOf(p))}</span>${p.data.done ? '<em>finished</em>' : ''}</button>
     <div class="subpicks" style="--depth:${depth + 1}">${sections(p.id)}</div>${branch(p.id, depth + 1)}`).join('');
  modal(`
    <h2>Move “${esc(titleOf(r))}”</h2>
    <div class="picks">
      ${isSection ? '' : `<button class="pick ${!r.data.parent ? 'on' : ''}" data-pick="">${ICON.tray}<span>No project (Inbox)</span></button>`}
      ${branch('', 0)}
    </div>
    <div class="mbtns"><button data-close>Cancel</button></div>`, el => {
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      store.update(id, { parent: b.dataset.pick || undefined });
      closeModal();
    });
  });
}

// Pick any item: search box plus a list (projects first, then most recently edited).
function pickItem({ title, exclude = new Set(), only = () => true, onPick }) {
  const pool = I.live.filter(r => !exclude.has(r.id) && only(r))
    .sort((a, b) => (a.data.type === 'project' ? 0 : 1) - (b.data.type === 'project' ? 0 : 1) || (b.data.updated || '').localeCompare(a.data.updated || ''));
  const rows = q => {
    const s = q.trim().toLowerCase();
    const hits = (s ? pool.filter(r => (titleOf(r) + ' ' + textOf(r.data.body)).toLowerCase().includes(s)) : pool).slice(0, 60);
    return hits.length ? hits.map(r => { const p = I.project(r); return `
      <button class="pick" data-pickitem="${r.id}">${typeIcon(r.data.type)}
        <span>${esc(titleOf(r))}</span>${p ? `<em>${esc(titleOf(p))}</em>` : ''}</button>`; }).join('') : '<p class="hint">Nothing matches.</p>';
  };
  modal(`
    <h2>${esc(title)}</h2>
    <input class="picksearch" type="search" placeholder="Search" autocomplete="off">
    <div class="picks">${rows('')}</div>
    <div class="mbtns"><button data-close>Cancel</button></div>`, el => {
    const input = el.querySelector('.picksearch');
    input.addEventListener('input', () => { el.querySelector('.picks').innerHTML = rows(input.value); });
    if (wide.matches) setTimeout(() => input.focus(), 30);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-pickitem]');
      if (!b) return;
      closeModal();
      onPick(b.dataset.pickitem);
    });
  });
}

function compareModal(id) {
  const r = store.get(id);
  if (!r?.conflict) return;
  const c = r.conflict;
  const side = (who, data, deleted) => deleted ? `<div class="side"><h3>${who}</h3><p class="gone">Deleted</p></div>` : `
    <div class="side"><h3>${who}</h3>
      <p class="ctitle">${esc((data.title || '').trim() || 'Untitled')}</p>
      <p class="cmeta">${esc(TYPE_NAMES[data.type] || 'Note')}${data.done ? ' · done' : ''}${data.start ? ' · starts ' + esc(fmtDay(data.start)) : ''}${data.due ? ' · due ' + esc(fmtDay(data.due)) : ''}</p>
      <div class="cbody">${esc(textOf(data.body)).slice(0, 1200) || '<em>No text</em>'}</div>
      <p class="cmeta">Edited ${esc(fmtWhen(data.updated))}</p>
    </div>`;
  modal(`
    <h2>Pick a version</h2>
    <p class="hint">This was changed on this device and on ${esc(c.device || 'another device')} before they synced.</p>
    <div class="compare">${side('This device (' + esc(store.device()) + ')', r.data, r.deleted)}${side(esc(c.device || 'Other device'), c.data || {}, c.deleted)}</div>
    <div class="mbtns col">
      <button class="primary" data-choice="mine">Keep this device’s</button>
      <button class="primary" data-choice="theirs">Keep ${esc(c.device || 'the other')}’s</button>
      ${!r.deleted && !c.deleted ? '<button data-choice="both">Keep both (as two items)</button>' : ''}
      <button data-close>Decide later</button>
    </div>`, el => {
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-choice]');
      if (!b) return;
      closeModal();
      editingId = null; // rebuild the editor with the chosen text
      await store.resolve(id, b.dataset.choice);
    });
  });
}

// A tiny picture of each board look for the settings: two cards and the string between them.
function lookPreview(id) {
  const looks = {
    corkboard: `<rect width="120" height="48" fill="#C79D69"/><rect x="12" y="10" width="34" height="28" fill="#FFF3BF" transform="rotate(-4 29 24)"/><rect x="74" y="12" width="34" height="26" fill="#FFF" transform="rotate(3 91 25)"/>
      <path d="M29 13 Q60 40 91 15" fill="none" stroke="#C62828" stroke-width="2.4"/><circle cx="29" cy="13" r="3.6" fill="#2E8B3E"/><circle cx="91" cy="15" r="3.6" fill="#2F6FC8"/>`,
    whiteboard: `<rect width="120" height="48" fill="#F7F7F4"/><rect x="10" y="12" width="36" height="26" rx="4" fill="#FFF0A8"/><rect x="74" y="12" width="36" height="26" rx="4" fill="#CFE4FF"/>
      <path d="M46 24 C55 19 61 30 70 25" fill="none" stroke="#2B3038" stroke-width="2.4" stroke-linecap="round"/><path d="M65 21 L71 25 L65 29" fill="none" stroke="#2B3038" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    blueprint: `<rect width="120" height="48" fill="#1D4E74"/><path d="M0 12H120M0 24H120M0 36H120M24 0V48M48 0V48M72 0V48M96 0V48" stroke="rgba(200,225,245,.18)"/>
      <rect x="10" y="8" width="34" height="18" fill="none" stroke="#F2F8FF" stroke-width="1.4"/><rect x="76" y="24" width="34" height="18" fill="none" stroke="#F2F8FF" stroke-width="1.4"/>
      <path d="M44 17H60V33H72" fill="none" stroke="#F2F8FF" stroke-width="1.4"/><path d="M71 30L76 33L71 36z" fill="#F2F8FF"/><circle cx="44" cy="17" r="2" fill="#F2F8FF"/>`,
    notebook: `<rect width="120" height="48" fill="#FBF9F3"/><path d="M6 6h.1M18 6h.1M30 6h.1M42 6h.1M54 6h.1M66 6h.1M78 6h.1M90 6h.1M102 6h.1M114 6h.1M6 42h.1M18 42h.1M30 42h.1M42 42h.1M54 42h.1M66 42h.1M78 42h.1M90 42h.1M102 42h.1M114 42h.1" stroke="rgba(60,50,30,.35)" stroke-width="2" stroke-linecap="round"/>
      <rect x="10" y="12" width="36" height="26" fill="#FFF" stroke="rgba(0,0,0,.08)"/><rect x="20" y="8" width="16" height="7" fill="rgba(233,196,106,.8)"/><rect x="74" y="12" width="36" height="26" fill="#FFF" stroke="rgba(0,0,0,.08)"/><rect x="84" y="8" width="16" height="7" fill="rgba(143,184,222,.8)"/>
      <path d="M46 26 C56 22 62 30 70 26" fill="none" stroke="#1F3B8C" stroke-width="1.3" stroke-linecap="round"/><path d="M66 23 L71 26 L66 29" fill="none" stroke="#1F3B8C" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`,
  };
  return `<svg viewBox="0 0 120 48" aria-hidden="true">${looks[id] || ''}</svg>`;
}

async function settingsModal() {
  const s = store.status;
  const p = theme.current(store);
  const dark = document.documentElement.dataset.mode === 'dark';
  const th = theme.THEMES.find(t => t.id === p.theme) || theme.THEMES[0];
  const seg = (k, options) => `<div class="seg" role="group">${Object.entries(options).map(([v, label]) => `<button data-k="${k}" data-v="${v}" class="${p[k] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  modal(`
    <h2>Brain Tree</h2>
    <div class="settings">
      <h3>Appearance</h3>
      <div class="themepick">${theme.THEMES.map(t => `
        <button data-theme="${t.id}" class="${p.theme === t.id ? 'on' : ''}" style="--a:${(dark ? t.dark : t.light).accent};--b:${(dark ? t.dark : t.light).bg};--c:${(dark ? t.dark : t.light).card};--s:${(dark ? t.dark : t.light).string}">
          <i><b></b><u></u></i><span>${t.name}</span></button>`).join('')}</div>
      <div class="setrow"><span>Light or dark</span>${seg('mode', { auto: 'Match phone', light: 'Light', dark: 'Dark' })}</div>
      <div class="setrow"><span>Main colour</span><span class="colour"><input type="color" data-colour="accent" value="${p.accent || (dark ? th.dark : th.light).accent}" aria-label="Main colour"><button data-reset="accent" class="link" ${p.accent ? '' : 'hidden'}>Use theme’s</button></span></div>
      <div class="setrow"><span>Text style</span>${seg('font', Object.fromEntries(Object.entries(theme.FONTS).map(([k, f]) => [k, `<span style="font-family:${f.stack.replace(/"/g, "'")}">${f.name}</span>`])))}</div>
      <div class="setrow"><span>Text size</span>${seg('size', { small: 'Small', normal: 'Normal', large: 'Large' })}</div>
      <h3>Boards</h3>
      <div class="lookpick">${Object.entries(theme.LOOKS).map(([id, l]) => `
        <button data-look="${id}" class="${p.look === id ? 'on' : ''}">${lookPreview(id)}<span>${l.name}</span></button>`).join('')}</div>
      <div class="setrow"><span>String colour</span><span class="colour"><input type="color" data-colour="string" value="${theme.wireColour(p, dark)}" aria-label="String colour"><button data-reset="string" class="link" ${p.string ? '' : 'hidden'}>Use the look’s</button></span></div>
      <h3>This device</h3>
      <label>This device’s name<input class="devname" value="${esc(store.device())}" maxlength="40"></label>
      <p class="hint">Shown when the same thing is changed on two devices.</p>
      <div class="kv"><span>Sync</span><b>${esc(s.state === 'idle' ? 'Working' : s.state)}${s.message ? ': ' + esc(s.message) : ''}</b></div>
      <div class="kv"><span>Last synced</span><b>${s.lastSync ? esc(fmtWhen(new Date(s.lastSync).toISOString())) : 'Not yet'}</b></div>
      <div class="kv"><span>Waiting to sync</span><b>${store.pendingCount()}</b></div>
      <div class="kv"><span>Stored online</span><b class="stats">${store.signedIn() ? 'Checking…' : 'Sign in to see'}</b></div>
      <div class="kv"><span>Version</span><b>${VERSION}</b></div>
      <details><summary>Put it on your iPhone home screen</summary>
        <p>Open this page in <b>Safari</b>, tap the Share button, then <b>Add to Home Screen</b>. It opens full-screen like an app and works offline. Sign in once inside the home-screen app (it keeps its own sign-in, separate from Safari).</p>
        <p>On a PC in Chrome or Edge: the install icon at the right of the address bar.</p>
      </details>
    </div>
    <div class="mbtns col">
      <button class="primary" data-s="sync">Sync now</button>
      <button data-s="export">Download a backup (JSON)</button>
      ${store.signedIn() ? '<button data-s="logout">Sign out</button><button class="danger" data-s="erase">Sign out and wipe this device’s copy</button>' : '<button class="primary" data-s="login">Sign in</button>'}
      <button data-close>Close</button>
    </div>`, el => {
    el.querySelector('.devname').addEventListener('change', e => store.setDevice(e.target.value));
    // Appearance changes show straight away and are saved (and synced) as you go.
    const setPref = async (patch, reopen) => {
      await theme.save(store, { ...theme.current(store), ...patch });
      if (reopen) { const top = el.scrollTop; await settingsModal(); $('#modal .sheet').scrollTop = top; }
    };
    for (const input of el.querySelectorAll('[data-colour]')) {
      input.addEventListener('input', () => theme.apply({ ...theme.current(store), [input.dataset.colour]: input.value }));
      input.addEventListener('change', () => setPref({ [input.dataset.colour]: input.value }, true));
    }
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-theme]'), s = e.target.closest('[data-k]'), r = e.target.closest('[data-reset]'), l = e.target.closest('[data-look]');
      if (t) setPref({ theme: t.dataset.theme, accent: null }, true);
      else if (l) setPref({ look: l.dataset.look, string: null }, true);   // each look comes with its own string
      else if (s) setPref({ [s.dataset.k]: s.dataset.v }, true);
      else if (r) setPref({ [r.dataset.reset]: null }, true);
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const a = b.dataset.s;
      if (a === 'sync') { closeModal(); store.sync(); }
      if (a === 'export') downloadBackup();
      if (a === 'login') { closeModal(); showLogin(true); }
      if (a === 'logout') { closeModal(); await store.logout(false); toast('Signed out. Your copy stays on this device.'); }
      if (a === 'erase') {
        if (store.pendingCount() && !confirm(`${store.pendingCount()} change(s) haven’t synced yet and will be lost. Wipe anyway?`)) return;
        if (!confirm('Wipe Brain Tree from this device? Everything already synced stays safe online.')) return;
        closeModal(); await store.logout(true); showLogin(false);
      }
    });
    if (store.signedIn()) store.serverStats().then(st => {
      const mb = b => (b / 1048576).toFixed(1) + ' MB';
      const x = el.querySelector('.stats');
      if (x) x.textContent = `${st.items} items (${mb(st.itemBytes)}), ${st.files} photos (${mb(st.fileBytes)})`;
    }).catch(err => { const x = el.querySelector('.stats'); if (x) x.textContent = err.message; });
  });
}

function downloadBackup() {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `brain-tree-backup-${today()}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function newMenu(anchorParent) {
  modal(`
    <h2>New</h2>
    <div class="mbtns col">
      <button class="primary" data-n="task">${ICON.check} To-do</button>
      <button class="primary" data-n="note">${ICON.note} Note</button>
      <button class="primary" data-n="project">${ICON.folder} Project</button>
      ${route.project && anchorParent === route.project ? `<button class="primary" data-n="section">${ICON.section} Section in this project</button>` : ''}
      <button data-close>Cancel</button>
    </div>`, el => {
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-n]');
      if (!b) return;
      closeModal();
      const id = await newItem(b.dataset.n, anchorParent);
      if (b.dataset.n === 'project' && !anchorParent && !route.project) go({ project: id, view: null, item: id });
      else openItem(id);
    });
  });
}

// ---------- Modal, toast, login ----------

function modal(html, setup) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  setup?.(m.firstElementChild);
}
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }

function toast(msg, actionLabel, action) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) t.querySelector('button').onclick = () => { action(); t.remove(); };
  $('#toasts').append(t);
  setTimeout(() => t.classList.add('out'), 4500);
  setTimeout(() => t.remove(), 5000);
}

function showLogin(canSkip) {
  const el = $('#login');
  el.hidden = false;
  el.querySelector('.skip').hidden = !canSkip;
  el.querySelector('.err').textContent = '';
  setTimeout(() => el.querySelector('input').focus(), 50);
}

$('#login form').addEventListener('submit', async e => {
  e.preventDefault();
  const el = $('#login'), input = el.querySelector('input'), btn = el.querySelector('button[type=submit]');
  btn.disabled = true; el.querySelector('.err').textContent = '';
  try {
    await store.login(input.value);
    input.value = '';
    el.hidden = true;
    toast('Signed in. Syncing…');
  } catch (err) {
    el.querySelector('.err').textContent = navigator.onLine ? err.message : 'You’re offline. Sign in when you have signal.';
  } finally { btn.disabled = false; }
});
$('#login .skip').addEventListener('click', () => { $('#login').hidden = true; writeLocal('bt-skipped-login', true); });

// ---------- Events ----------

document.addEventListener('click', async e => {
  const t = e.target;
  const el = sel => t.closest(sel);
  let x;
  if ((x = el('[data-close]')) || t.id === 'modal') { closeModal(); return; }
  if (t.closest('#lightbox')) { $('#lightbox').hidden = true; return; }
  if ((x = el('[data-tick]'))) { e.stopPropagation(); toggleDone(x.dataset.tick); return; }
  if ((x = el('[data-restore]'))) { e.stopPropagation(); store.update(x.dataset.restore, { trashed: undefined }); return; }
  if ((x = el('[data-purge]'))) {
    e.stopPropagation();
    if (confirm('Delete this for good, on every device? This can’t be undone.')) purge([x.dataset.purge]);
    return;
  }
  if ((x = el('[data-colour-pick]')) && editingId) { store.update(editingId, { color: x.dataset.colourPick || undefined }); return; }
  if ((x = el('[data-untie]'))) {
    e.stopPropagation();
    const [from, to] = x.dataset.untie.split('|');
    const links = store.get(from)?.data.links || [];
    store.update(from, { links: links.filter(l => l.to !== to) });
    toast('String cut.', 'Undo', () => store.update(from, { links }));
    return;
  }
  if ((x = el('[data-done]'))) { const k = x.dataset.done; openDone.has(k) ? openDone.delete(k) : openDone.add(k); render(); return; }
  if ((x = el('[data-toggle]'))) {
    e.stopPropagation();
    const id = x.dataset.toggle;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    writeLocal('bt-collapsed', [...collapsed]);
    renderNav();
    return;
  }
  if ((x = el('[data-project]'))) { search = ''; $('#search').value = ''; go({ project: x.dataset.project, view: null, item: null }); return; }
  if ((x = el('#smart [data-view], #lower a, #projects a.navrow'))) {
    // The link's own address does the rest; clicking the list you're already on just clears the search.
    const wasSearching = !!search;
    search = ''; $('#search').value = '';
    if (wasSearching && location.hash === x.getAttribute('href')) render();
    return;
  }
  if ((x = el('[data-new]'))) {
    const id = await newItem(x.dataset.new, x.dataset.parent);
    openItem(id);
    return;
  }
  if ((x = el('[data-open]'))) {
    const id = x.dataset.open;
    if (x.closest('.crumbs') || x.closest('.inside') || x.closest('.links') || x.closest('#listBody') || x.closest('#listHead')) openItem(id);
    return;
  }
  if ((x = el('[data-act]'))) {
    const a = x.dataset.act;
    const id = editingId;
    if (a === 'back') { saveEditing(); go({ item: null }); }
    else if (a === 'back-nav') { search = ''; $('#search').value = ''; go({ view: null, project: null, item: null }); }
    else if (a === 'sync') store.signedIn() ? store.sync() : showLogin(true);
    else if (a === 'login') showLogin(true);
    else if (a === 'settings') settingsModal();
    else if (a === 'new') newMenu(route.project || undefined);
    else if (a === 'new-project') { const pid = await newItem('project', null); go({ project: pid, view: null, item: pid }); }
    else if (a === 'empty-trash') { if (confirm(`Delete all ${I.trashed.length} item(s) in Recently deleted for good, on every device?`)) purge(I.trashed.map(r => r.id)); }
    else if (a === 'board-list') go(route.board ? { view: null, project: route.board, item: null } : { view: 'today', item: null });
    else if (a === 'open-board' && route.project) go({ view: 'board', board: route.project, project: null, item: null });
    else if (id && a === 'board') {
      const r = I.byId.get(id), bp = r && (r.data.type === 'project' ? r : I.project(r));
      if (bp) go({ view: 'board', board: bp.id, project: null, item: null });
    }
    else if (id && a === 'tie') {
      const links = store.get(id)?.data.links || [];
      pickItem({ title: 'Tie a string to…', exclude: new Set([id, ...links.map(l => l.to)]), onPick: to => store.update(id, { links: [...(store.get(id)?.data.links || []), { to }] }) });
    }
    else if (id && a === 'tick') toggleDone(id);
    else if (id && a === 'pin') { const r = store.get(id); store.update(id, { pinned: r.data.pinned ? undefined : true }); }
    else if (id && a === 'move') movePicker(id);
    else if (id && a === 'trash') trashItem(id);
    else if (a === 'compare') compareModal(x.dataset.id || id);
    else if (id && a === 'add-inside') { const sec = x.closest('.inside'); sec.dataset.forceOpen = id; updateDetail(I.byId.get(id)); sec.querySelector('input')?.focus(); }
  }
  if ((x = el('[data-clear]')) && editingId) { e.preventDefault(); store.update(editingId, { [x.dataset.clear]: undefined }); return; }
  // An empty date chip opens the date picker wherever it's tapped.
  if ((x = el('.props .chip.date')) && !x.classList.contains('set')) { try { x.querySelector('input').showPicker(); } catch (err) {} }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else if (!$('#lightbox').hidden) $('#lightbox').hidden = true; }
  const row = e.target.closest?.('.row[data-open]');
  if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openItem(row.dataset.open); }
});

// Quick add: the list's box, and the ones inside an open item.
document.addEventListener('submit', async e => {
  const form = e.target;
  if (form.id === 'quickAdd') {
    e.preventDefault();
    const input = form.querySelector('input'), title = input.value.trim();
    if (!title) return;
    input.value = '';
    const type = route.view === 'notes' && !route.project ? 'note' : 'task';
    const id = await newItem(type, undefined, { title });
    if (type === 'note') openItem(id);
  } else if (form.classList.contains('quick')) {
    e.preventDefault();
    const input = form.querySelector('input'), title = input.value.trim();
    if (!title) return;
    input.value = '';
    await newItem('task', form.dataset.parent, { title });
    requestAnimationFrame(() => $(`#detail form.quick[data-parent="${form.dataset.parent}"] input`)?.focus());
  }
});

$('#search').addEventListener('input', e => {
  search = e.target.value.trim();
  render();
});

window.addEventListener('hashchange', onRoute);
wide.addEventListener('change', () => onRoute());
window.addEventListener('pagehide', saveEditing);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveEditing(); });

// ---------- Start ----------

// 0.4: a section used to be a sub-project drawn as a frame on its parent's board. Sections are
// their own kind of item now, so those become sections (everything in them stays put).
let migrating = false;
async function migrate() {
  if (migrating) return;
  migrating = true;
  try {
    for (const r of store.all()) {
      if (r.deleted || r.data.type !== 'project' || !r.data.parent || !r.data.cork?.[r.data.parent]?.w) continue;
      const p = store.get(r.data.parent);
      if (p && !p.deleted && p.data.type === 'project') await store.update(r.id, { type: 'section' });
    }
  } finally { migrating = false; }
}

(async function start() {
  $('#nav .brand').insertAdjacentHTML('beforeend', `<button class="iconbtn" data-act="settings" aria-label="Settings">${ICON.gear}</button>`);
  $('#newProject').innerHTML = ICON.plus;
  $('#newBtn').innerHTML = ICON.plus;
  $('#boardBtn').innerHTML = ICON.board;
  $('#listBack').innerHTML = ICON.back + '<span>Lists</span>';
  try {
    await store.load();
  } catch (e) {
    document.body.innerHTML = `<p style="padding:2rem;font-family:system-ui">Brain Tree couldn’t open its storage on this device: ${esc(e.message)}. Private browsing can block it.</p>`;
    return;
  }
  theme.apply(theme.current(store));
  theme.watch(() => theme.current(store));
  store.onChange(ids => {
    if (ids && ids.includes(theme.PREF_ID)) theme.apply(theme.current(store));
    if (!migrating && store.all().some(r => !r.deleted && r.data.type === 'project' && r.data.parent && r.data.cork?.[r.data.parent]?.w)) migrate();
    queueRender();
  });
  await migrate();
  onRoute();
  if (!store.signedIn() && !readLocal('bt-skipped-login', false)) showLogin(true);
  else store.sync();

  if ('serviceWorker' in navigator && !window.BT_NO_SW && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      let reloading = false;
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloading) return;
        toast('Brain Tree has been updated.', 'Reload', () => { reloading = true; saveEditing(); location.reload(); });
      });
      reg.update().catch(() => {});
    } catch (e) { console.warn('Offline support unavailable', e); }
  }
})();
