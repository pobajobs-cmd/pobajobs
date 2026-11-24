// Brain Tree: projects, to-dos and notes in one tree, on every device, offline first.
// Everything is an "item" (data.type = task | note | project | section); any item can sit inside
// another (data.parent), which is how projects hold their to-dos and notes. A section is a
// group inside a project: a heading in the project's list, a labelled frame on its board.

import * as store from './store.js';
import * as S from './search.js';
import { createEditor, textOf, firstPhoto, mediaSummary, escHtml as esc } from './editor.js';
import { createBoard, COLOURS } from './board.js';
import { parseYouTube, parseTime, fmtTime, thumbUrl, watchUrl, iframeHTML, rangeText } from './media.js';
import { openDrawing } from './draw.js';
import { addExample, EXAMPLE_TITLE, EXAMPLE_REC_CARDS, exampleRecording } from './example.js';
import { createGestures } from './gestures.js';
import { openSheet, sheetRows, cleanSheet } from './sheet.js';
import { linkService } from './attach.js';
import * as ex from './export.js';
import * as theme from './theme.js';
import * as pv from './preview.js';

const VERSION = '0.8.1';
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
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
  top: '<svg viewBox="0 0 24 24"><path d="M5 4h14M12 20V9M7 13l5-5 5 5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  repeat: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  rename: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
};
// The small icons on a note's row for what it holds.
const ROWIC = {
  photo: ICON.photo,
  clip: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="M10 9v6l5-3z"/></svg>',
  draw: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="5" rx="1"/><circle cx="17" cy="17" r="3.5"/><path d="M6.5 9v4.5a3 3 0 0 0 3 3H13"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};
const typeIcon = t =>(t === 'project' ? ICON.folder : t === 'section' ? ICON.section : t === 'task' ? ICON.check : ICON.note);

// ---------- State ----------

let route = { view: null, project: null, item: null };
let search = '';
// (0.8.1) A project's own search: which project it's open in, and what's typed in it.
let pfind = { id: null, q: '' };
let findAll = false;               // (0.8.1) on a phone: the search-everything page is open (maybe nothing typed yet)
const searching = () => !!search || findAll;
let I = null;                       // index of the current data, rebuilt on every change
let editor = null, editingId = null, titleTimer = null;
const openDone = new Set();         // lists with their "Done" section expanded
const collapsed = new Set(readLocal('bt-collapsed', []));
const projTabs = readLocal('bt-projtab', {});   // each project's list: everything, today or upcoming
const projTab = id => (['today', 'upcoming'].includes(projTabs[id]) ? projTabs[id] : 'all');
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
const addMonths = (s, n) => {
  const d = parseYmd(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return ymd(d);
};
// The next given weekday (0 = Sunday) after s.
const nextDow = (s, dow) => { let d = addDays(s, 1); while (parseYmd(d).getDay() !== dow) d = addDays(d, 1); return d; };
const shortDate = s => parseYmd(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

// Card sizes on a board, from the open item (the handle on a card's corner sets any size in between).
const CARD_SIZES = [[0.75, 'Small'], [1, 'Normal'], [1.5, 'Large'], [2.25, 'Huge']];

// Repeating to-dos: ticking one moves it on to its next date (and unticks its steps).
const REPEATS = { day: 'Every day', weekday: 'Every weekday', week: 'Every week', fortnight: 'Every 2 weeks', month: 'Every month', year: 'Every year' };
function stepRepeat(s, rule) {
  if (rule === 'day') return addDays(s, 1);
  if (rule === 'weekday') { let d = addDays(s, 1); while ([0, 6].includes(parseYmd(d).getDay())) d = addDays(d, 1); return d; }
  if (rule === 'week') return addDays(s, 7);
  if (rule === 'fortnight') return addDays(s, 14);
  if (rule === 'month') return addMonths(s, 1);
  if (rule === 'year') return addMonths(s, 12);
  return addDays(s, 1);
}
// Done early: the one after its date. Done late: the first one after today (not a pile of missed ones).
function nextRepeat(from, rule) {
  const t = today();
  let s = stepRepeat(from, rule), n = 0;
  while (s <= t && n++ < 3000) s = stepRepeat(s, rule);
  return s;
}

// Dates typed at the end of a quick-add: "Bins out tomorrow", "Call Sam fri", "Dentist 3 Dec", "Pay rent 1/12".
// (Plain "sat" and "sun" only count with "on", "by" and so on before them: "sit in the sun" isn't a date.)
const DAY_RE = /\s+(?:(?:on|by|due|next|this)\s+)?(mon(?:day)?|tues?(?:day)?|wed(?:nesday|s)?|thu(?:rs?)?(?:day)?|fri(?:day)?|saturday|sunday)$/i;
const DAY_RE2 = /\s+(?:on|by|due|next|this)\s+(sat|sun)$/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
function quickDate(text) {
  const t = today(), s = text.trim();
  const ofDate = (d, m, y) => {
    let year = y ? (y < 100 ? 2000 + y : y) : parseYmd(t).getFullYear();
    const make = yr => { const dt = new Date(yr, m, d); return dt.getMonth() === m && dt.getDate() === d ? ymd(dt) : null; };
    let out = make(year);
    if (out && !y && out < t) out = make(year + 1);   // "3 Jan" in December means next year
    return out;
  };
  const rules = [
    [/\s+(?:on |by |due )?(?:today|tonight)$/i, () => t],
    [/\s+(?:on |by |due )?(?:tomorrow|tmrw|tmr)$/i, () => addDays(t, 1)],
    [/\s+(?:on |by |due )?(?:this )?weekend$/i, () => ([0, 6].includes(parseYmd(t).getDay()) ? t : nextDow(t, 6))],
    [/\s+next week$/i, () => nextDow(t, 1)],
    [/\s+in (\d{1,3}) (day|week|month)s?$/i, m => (m[2].toLowerCase() === 'day' ? addDays(t, +m[1]) : m[2].toLowerCase() === 'week' ? addDays(t, 7 * m[1]) : addMonths(t, +m[1]))],
    ...[DAY_RE, DAY_RE2].map(re => [re, m => nextDow(t, ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[1].slice(0, 3).toLowerCase()))]),
    [new RegExp(`\\s+(?:on |by |due )?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}$`, 'i'), m => ofDate(+m[1], MONTHS.indexOf(m[2].toLowerCase()))],
    [new RegExp(`\\s+(?:on |by |due )?${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?$`, 'i'), m => ofDate(+m[2], MONTHS.indexOf(m[1].toLowerCase()))],
    [/\s+(?:on |by |due )?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2}|\d{4}))?$/, m => ofDate(+m[1], +m[2] - 1, m[3] ? +m[3] : 0)],
  ];
  for (const [re, fn] of rules) {
    const m = s.match(re);
    if (!m) continue;
    const due = fn(m), rest = s.slice(0, m.index).trim();
    if (due && rest) return { title: rest, due };
  }
  return { title: s, due: null };
}

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

// Locked projects (data.lock): what's inside one is left out of everything (lists, boards,
// search, counts) until it's unlocked on this device. A privacy screen, not encryption: the
// data itself syncs as normal.
const unlocked = new Set();
const isLocked = p => !!p?.data.lock && !unlocked.has(p.id);

// Each project opens the way you last looked at it on this device: its list or its board (0.7.2).
const projView = readLocal('bt-proj-view', {});
function rememberView(id, v) {
  if (!id || (projView[id] || 'list') === v) return;
  if (v === 'board') projView[id] = 'board'; else delete projView[id];
  writeLocal('bt-proj-view', projView);
}
function goProject(id) {
  if (projView[id] === 'board' && !isLocked(I.byId.get(id)) && !I.hiddenIn?.get(id)) go({ view: 'board', board: id, project: null, item: null });
  else go({ project: id, view: null, board: null, item: null });
}

function buildIndex() {
  const byId = new Map(), kids = new Map(), trashed = [];
  for (const r of store.all()) if (!r.deleted && r.data.type !== 'pref') byId.set(r.id, r);
  // The locked project each thing is hidden inside, if any.
  const lockMemo = new Map();
  const lockOf = (r, depth = 0) => {
    if (lockMemo.has(r.id)) return lockMemo.get(r.id);
    const p = r.data.parent && byId.get(r.data.parent);
    const out = !p || depth > 60 || p.id === r.id ? null : p.data.type === 'project' && isLocked(p) ? p.id : lockOf(p, depth + 1);
    lockMemo.set(r.id, out);
    return out;
  };
  const hiddenIn = new Map();
  for (const r of byId.values()) { const l = lockOf(r); if (l) hiddenIn.set(r.id, l); }
  for (const id of hiddenIn.keys()) byId.delete(id);
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
  return { byId, kids, trashed, alive: r => byId.has(r.id) && alive(r), parentOf, descendants, ancestors, project, live, hiddenIn };
}

function progress(id) {
  const tasks = I.descendants(id).filter(r => r.data.type === 'task');
  return { total: tasks.length, done: tasks.filter(r => r.data.done).length };
}

const titleOf = r => (r.data.title || '').trim() || (r.data.type === 'note' ? textOf(r.data.body).slice(0, 60) || mediaSummary(r.data.body).replace(/^▶ /, '') : '') || 'Untitled';
const isOpen = r => (r.data.type === 'task' || r.data.type === 'project') && !r.data.done;
const byDueThenOrder = (a, b) => (a.data.due || '9999').localeCompare(b.data.due || '9999') || (a.data.order || 0) - (b.data.order || 0);
const byPinnedUpdated = (a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || (b.data.updated || '').localeCompare(a.data.updated || '');
// Shorten to about n letters at a word break, with "…".
const shorten = (s, n) => (s.length <= n ? s : s.slice(0, n).replace(/\s+\S*$/, '') + '…');
const bySectionOrder = (a, b) => (a.data.order || 0) - (b.data.order || 0) || (a.data.created || '').localeCompare(b.data.created || '');
// Inside a project things stay where you put them (drag them, or "Move to top"); pinned notes first.
const byOrder = bySectionOrder;
// Pinned things stay at the top of their list (projects: at the top of the sidebar).
const pinFirst = cmp => (a, b) => (b.data.pinned ? 1 : 0) - (a.data.pinned ? 1 : 0) || cmp(a, b);
const byPinnedOrder = pinFirst(byOrder);
const isTodo = r => isOpen(r) && r.data.type === 'task';
// Where a project sits in the sidebar: under the nearest unfinished project above it.
const navUnder = p => { const up = I.project(p); return up && !up.data.done ? up.id : ''; };

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

const listKey = () => (searching() ? 'search' : route.project ? 'p:' + route.project : route.view || 'today');

// ---------- Rendering ----------

let renderQueued = false, renderHeld = false;
function queueRender() {
  // Not mid-swipe or mid-drag: redrawing would pull the row out from under the finger.
  if (gest.busy()) { renderHeld = true; return; }
  if (renderQueued) return;
  renderQueued = true;
  setTimeout(() => { renderQueued = false; render(); }, 0);
}

function render() {
  I = buildIndex();
  // Somewhere inside a locked project: go to the project (its list asks for the password).
  const hid = id => id && I.hiddenIn.get(id);
  if (hid(route.project) || (route.view === 'board' && hid(route.board))) { go({ project: hid(route.project) || hid(route.board), view: null, board: null, item: null }, true); return; }
  if (route.view === 'board' && route.board && isLocked(I.byId.get(route.board))) { go({ project: route.board, view: null, board: null, item: null }, true); return; }
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
  document.body.dataset.pane = route.item ? 'detail' : (route.view || route.project || searching()) ? 'list' : 'nav';
  renderNav();
  if (onBoard) {
    board ??= createBoard($('#board'), boardApi);
    board.show(route.board);
  } else renderList();
  renderDetail();
  gest.restore();
}

let board = null;
const boardApi = {
  store,
  index: () => I,
  locked: r => isLocked(r),
  open: id => go({ item: id }),
  openBoard: id => { rememberView(id, 'board'); go({ view: 'board', board: id, project: null, item: null }); },
  selected: () => route.item,
  today: () => today(),
  fmtDay: s => fmtDay(s),
  progress: id => progress(id),
  titleOf: r => titleOf(r),
  toast: (...a) => toast(...a),
  newItem: (type, parent, extra) => newItem(type, parent ?? null, extra),
  placePicker: (key, exclude, onPick) => pickItem({ title: 'Bring onto this board', exclude: new Set(exclude), only: r => r.data.type !== 'section', onPick }),
  style: () => theme.current(store).look,
  tidyMove: () => theme.current(store).tidyMove === 'move',
  ownWire: () => !!theme.current(store).string,   // your own string colour (instead of the look's)
  pickClip: c => clipModal(c),
  draw: (d, title) => openDrawing({ drawing: d, title }),
  bigVideo: c => videoModal(c),
  sheet: (s, title) => openSheet({ sheet: s, title, saveFile: deliver }),
  pickLink: l => linkModal(l),
  openDoc: d => openDoc(d),
  addDoc: file => addDocWithPreview(file),
  docPreview: d => docPreviewUrl(d),
  saveFile: (blob, name) => deliver(blob, name),   // (0.8.0: a recording's video)
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

  // Project tree: projects nest under the nearest project above them; pinned ones first.
  const projects = I.live.filter(r => r.data.type === 'project' && !r.data.done);
  const under = new Map();
  for (const p of projects) { const k = navUnder(p); if (!under.has(k)) under.set(k, []); under.get(k).push(p); }
  const branch = (key, depth) => (under.get(key) || []).sort(byPinnedOrder).map(p => {
    const locked = isLocked(p);
    const subs = under.has(p.id) && !locked;
    const { total, done } = locked ? { total: 0, done: 0 } : progress(p.id);
    const shut = collapsed.has(p.id);
    // To-dos due today (or late) anywhere in it, so a glance at the sidebar shows where today's work is.
    const due = locked ? [] : I.descendants(p.id).filter(r => isTodo(r) && r.data.due && r.data.due <= t);
    const late = due.some(r => r.data.due < t);
    return `
      <div class="navrow proj ${(route.project === p.id || (route.view === 'board' && route.board === p.id)) && !search ? 'on' : ''}" data-project="${p.id}" data-under="${key}" data-depth="${depth}" style="--depth:${depth}">
        <button class="caret ${subs ? '' : 'none'} ${shut ? '' : 'open'}" data-toggle="${p.id}" aria-label="Show or hide sub-projects">${subs ? ICON.caret : ''}</button>
        <span class="ic">${ICON.folder}</span><span class="name">${esc(titleOf(p))}</span>
        ${p.data.pinned ? `<span class="pinmark" title="Pinned">${ICON.pin}</span>` : ''}
        ${locked ? `<span class="lockmark" title="Locked">${ICON.lock}</span>` : p.data.lock ? `<span class="lockmark open" title="Unlocked for now">${ICON.unlock}</span>` : ''}
        ${due.length ? `<span class="duebadge ${late ? 'late' : ''}" title="${due.length} to-do${due.length === 1 ? '' : 's'} due today${late ? ' or late' : ''}">${due.length}</span>` : ''}
        ${total ? `<span class="count">${done}/${total}</span>` : ''}
      </div>${subs && !shut ? branch(p.id, depth + 1) : ''}`;
  }).join('');
  const doneProjects = I.live.filter(r => r.data.type === 'project' && r.data.done).length;
  const hasExample = I.live.some(r => r.data.type === 'project' && r.data.title === EXAMPLE_TITLE);
  const tree = branch('', 0);
  $('#projects').innerHTML = (tree || '<p class="empty-nav">No projects yet. Tap + to start one, or <button class="link" data-act="example">add an example project</button> to see what Brain Tree can do.</p>')
    + (doneProjects ? `<a href="#/done-projects" class="navrow small ${route.view === 'done-projects' && !search ? 'on' : ''}"><span class="ic">${ICON.check}</span><span class="name">Finished projects</span><span class="count">${doneProjects}</span></a>` : '')
    // Until there's one, an easy way to see what's possible (it's in Settings too).
    + (tree && !hasExample ? `<button class="navrow small example" data-act="example"><span class="ic">${ICON.plus}</span><span class="name">Add the example project</span></button>` : '');

  const conflicts = store.conflicts().filter(r => !I.hiddenIn.has(r.id)).length;
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

// Today and Upcoming, for everything (the smart lists) or for one project's contents.
function todayGroups(pool) {
  const t = today(), open = pool.filter(r => isOpen(r));
  return [
    { name: 'Overdue', items: open.filter(r => r.data.due && r.data.due < t).sort(pinFirst(byDueThenOrder)), late: true },
    { name: 'Today', items: open.filter(r => r.data.due === t || (r.data.start === t && !r.data.due)).sort(pinFirst(byDueThenOrder)) },
    { name: 'Done today', items: pool.filter(r => r.data.type === 'task' && r.data.done && (r.data.doneAt || '').startsWith(t)), done: true },
  ];
}
const isUpcoming = (r, t) => isOpen(r) && ((r.data.due && r.data.due > t) || (r.data.start && r.data.start > t));
function upcomingGroups(pool) {
  const t = today();
  const open = pool.filter(r => isUpcoming(r, t));
  const keyDate = r => (r.data.start && r.data.start > t && (!r.data.due || r.data.start < r.data.due) ? r.data.start : r.data.due) || r.data.start;
  const map = new Map();
  for (const r of open.sort((a, b) => keyDate(a).localeCompare(keyDate(b)))) {
    const k = keyDate(r), diff = daysBetween(t, k);
    const label = diff < 7 ? fmtDay(k) : parseYmd(k).toLocaleDateString(undefined, { month: 'long', year: parseYmd(k).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(r);
  }
  return [...map].map(([name, items]) => ({ name, items }));
}

// (0.8.1) Search results, best first, in groups. Searching everything: projects that match first, then
// what's in each project (under its top project), then things in no project. Searching one project
// (under = its id): what's loose in it, then each section or sub-project with what matches in it.
function searchGroups(pool, ts, under) {
  if (!ts.length) return [];
  const hits = new Map(), groups = new Map();
  for (const r of pool) {
    const m = S.matchItem(r, titleOf(r), ts);
    if (!m) continue;
    hits.set(r.id, { ...m, ts });
    const path = I.ancestors(r);
    let gk, name, gu, first = false;
    if (under) {
      const box = path[path.findIndex(x => x.id === under) + 1];
      gk = box ? box.id : under; gu = box ? box.id : under; name = titleOf(box || I.byId.get(under)); first = !box;
    } else if (r.data.type === 'project') { gk = '~projects'; name = 'Projects'; gu = null; first = true; }
    else {
      const top = path.find(x => x.data.type === 'project');
      gk = top ? top.id : '~loose'; name = top ? titleOf(top) : 'Not in a project'; gu = top ? top.id : null;
    }
    if (!groups.has(gk)) groups.set(gk, { name, items: [], hits, under: gu, first, best: 0 });
    const g = groups.get(gk);
    g.items.push(r); g.best = Math.max(g.best, m.score);
  }
  const score = r => hits.get(r.id).score;
  for (const g of groups.values()) g.items.sort((a, b) => score(b) - score(a) || byPinnedUpdated(a, b));
  return [...groups.values()].sort((a, b) => (b.first - a.first) || (b.best - a.best) || a.name.localeCompare(b.name));
}

// (0.8.1) A project's own search (the magnifier at the top of its list).
function openFind() {
  if (!route.project) return;
  pfind = { id: route.project, q: '' };
  render();
  const inp = $('#listFind input'); inp.focus(); inp.select();
}
function closeFind(redraw = true) {
  pfind = { id: null, q: '' };
  if (redraw) render();
}
// (0.8.1) On a phone: the search-everything page, with its own box (the side panel's is out of sight).
function openFindAll() {
  findAll = true; pfind = { id: null, q: '' };
  render();
  $('#listFind input').focus();
}

function renderList() {
  const key = listKey();
  const t = today();
  let title = '', head = '', groups = [], addHint = 'Add a to-do', canAdd = true;

  if (searching()) {
    groups = searchGroups(I.live, S.terms(search), null);
    const n = groups.reduce((a, g) => a + g.items.length, 0);
    title = search && n ? `${n} found` : 'Search';
    canAdd = false;
  } else if (route.project && isLocked(I.byId.get(route.project))) {
    // Locked: just the way in. (Left alone while it's showing, so a redraw doesn't wipe what you've typed.)
    const p = I.byId.get(route.project);
    $('#listTitle').textContent = titleOf(p);
    $('#boardBtn').hidden = true; $('#exportBtn').hidden = true; $('#quickAdd').hidden = true;
    if ($('#listHead .lockpanel')?.dataset.unlock !== p.id) { $('#listHead').innerHTML = lockPanelHTML(p); $('#listBody').innerHTML = ''; }
    return;
  } else if (route.project) {
    const p = I.byId.get(route.project);
    title = titleOf(p);
    const kids = I.kids.get(p.id) || [];
    const { total, done } = progress(p.id);
    // One slim line: how far along, when it ends, and the way into the project's own notes.
    const end = p.data.due ? `ends ${fmtDay(p.data.due)}` : p.data.start ? `starts ${fmtDay(p.data.start)}` : '';
    head = `<div class="projline">
      <button class="projsum" data-open="${p.id}" title="The project's own notes, dates and settings">
        ${total ? `<span class="n">${done}/${total}</span><span class="bar"><i style="width:${Math.round(100 * done / total)}%"></i></span>` : '<span class="grow"></span>'}
        ${end ? `<span class="${!p.data.done && p.data.due && p.data.due < t ? 'late' : ''}">${esc(end)}</span>` : ''}
        ${p.data.done ? '<span class="ok">Finished</span>' : ''}
        <b>${textOf(p.data.body) ? 'Notes' : 'Details'} ›</b>
      </button>
      ${p.data.lock ? `<button class="lockbtn" data-act="lock-now" data-id="${p.id}" title="Lock it again now">${ICON.lock}<span>Lock</span></button>` : ''}</div>`;
    // Everything in it, or just what's due today / coming up (from anywhere inside, sections and sub-projects too).
    const tab = projTab(p.id), pool = I.descendants(p.id);
    if (pfind.id === p.id && pfind.q) {
      // (0.8.1) Searching just this project: what matches, under the section or sub-project it's in.
      groups = searchGroups(pool, S.terms(pfind.q), p.id);
      head = `<p class="findall">${groups.length ? '' : 'Nothing in this project matches that. '}<button class="link" data-act="find-everywhere">Search everywhere for “${esc(pfind.q)}”</button></p>`;
      canAdd = false;
    } else {
    const nToday = pool.filter(r => isOpen(r) && ((r.data.due && r.data.due <= t) || (r.data.start === t && !r.data.due))).length;
    const nSoon = pool.filter(r => isUpcoming(r, t)).length;
    head += `<div class="seg projtabs" role="tablist" aria-label="Show">${[['all', 'Everything'], ['today', 'Today', nToday], ['upcoming', 'Upcoming', nSoon]]
      .map(([k, label, n]) => `<button role="tab" aria-selected="${tab === k}" data-projtab="${k}" class="${tab === k ? 'on' : ''}">${label}${n ? ` <i>${n}</i>` : ''}</button>`).join('')}</div>`;
    if (tab === 'today') {
      addHint = 'Add a to-do for today';
      groups = todayGroups(pool).map(g => ({ ...g, where: true }));
    } else if (tab === 'upcoming') {
      addHint = 'Add a to-do for tomorrow';
      groups = upcomingGroups(pool).map(g => ({ ...g, where: true }));
      if (!groups.length) groups = [{ name: '', items: [], empty: 'Nothing in this project has a future date yet.' }];
    } else {
      // Loose things first, then each section as a heading with what's in it (like the board's frames).
      const sections = kids.filter(r => r.data.type === 'section').sort(bySectionOrder);
      const inSections = sections.flatMap(s => I.kids.get(s.id) || []);
      const openOf = list => [
        ...list.filter(r => r.data.type === 'task' && !r.data.done).sort(byPinnedOrder),
        ...list.filter(r => r.data.type === 'project').sort(byPinnedOrder),
        ...list.filter(r => r.data.type === 'note').sort(byPinnedOrder),
      ];
      // (the loose ones without headings: to-dos, then sub-projects, then notes)
      groups = [
        { name: 'To-dos', bare: true, items: kids.filter(r => r.data.type === 'task' && !r.data.done).sort(byPinnedOrder), drop: p.id, kind: 'task' },
        { name: 'Sub-projects', bare: true, items: kids.filter(r => r.data.type === 'project').sort(byPinnedOrder), drop: p.id, kind: 'project' },
        { name: 'Notes', bare: true, items: kids.filter(r => r.data.type === 'note').sort(byPinnedOrder), drop: p.id, kind: 'note' },
        ...sections.map(s => ({ name: titleOf(s), section: s, items: openOf(I.kids.get(s.id) || []) })),
        { name: 'Done', items: [...kids, ...inSections].filter(r => r.data.type === 'task' && r.data.done).sort((a, b) => (b.data.doneAt || '').localeCompare(a.data.doneAt || '')), done: true },
      ];
    }
    }
  } else {
    const v = route.view || 'today';
    title = (SMART.find(s => s.id === v) || {}).name || { trash: 'Recently deleted', conflicts: 'Conflicts', 'done-projects': 'Finished projects' }[v] || 'Brain Tree';
    if (v === 'today') {
      groups = todayGroups(I.live);
    } else if (v === 'upcoming') {
      addHint = 'Add a to-do for tomorrow';
      groups = upcomingGroups(I.live);
      if (!groups.length) groups = [{ name: '', items: [], empty: 'Nothing with a future date yet. Give to-dos and projects a start or due date to see them here.' }];
    } else if (v === 'inbox') {
      const loose = I.live.filter(r => !I.parentOf(r) && r.data.type !== 'project');
      groups = [
        { name: 'To-dos', items: loose.filter(r => r.data.type === 'task' && !r.data.done).sort(pinFirst(byDueThenOrder)) },
        { name: 'Notes', items: loose.filter(r => r.data.type === 'note').sort(byPinnedUpdated) },
        { name: 'Done', items: loose.filter(r => r.data.type === 'task' && r.data.done).sort((a, b) => (b.data.doneAt || '').localeCompare(a.data.doneAt || '')), done: true },
      ];
    } else if (v === 'todos') {
      const open = I.live.filter(r => r.data.type === 'task' && !r.data.done);
      const map = new Map();
      for (const r of open) { const p = I.project(r); const k = p ? titleOf(p) : ' No project'; if (!map.has(k)) map.set(k, []); map.get(k).push(r); }
      groups = [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([name, items]) => ({ name: name.trim(), items: items.sort(pinFirst(byDueThenOrder)) }));
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
      groups = [{ name: '', items: store.conflicts().filter(r => (!r.deleted || r.conflict) && !I.hiddenIn.has(r.id)) }];
    }
  }

  $('#listTitle').textContent = title;
  $('#listHead').innerHTML = head;
  $('#boardBtn').hidden = !route.project || !!search;
  // (0.8.1) the project's own search: the magnifier, and the box under the bar while it's open
  const canFind = !!route.project && !search && !isLocked(I.byId.get(route.project));
  if (pfind.id && (pfind.id !== route.project || !canFind)) closeFind(false);
  $('#findBtn').hidden = !canFind;
  $('#findBtn').classList.toggle('on', pfind.id === route.project);
  // The search box in the list itself: a project's own search, or (on a phone, where the one in the
  // side panel is out of sight) searching everything.
  const lf = $('#listFind'), mode = searching() ? (wide.matches ? '' : 'all') : pfind.id && pfind.id === route.project ? 'project' : '';
  lf.hidden = !mode; lf.dataset.mode = mode;
  if (mode) {
    const inp = lf.querySelector('input'), v = mode === 'all' ? search : pfind.q;
    inp.placeholder = mode === 'all' ? 'Search everything' : `Search in ${titleOf(I.byId.get(route.project))}`;
    if (inp.value.trim() !== v) inp.value = v;
  }
  $('#exportBtn').hidden = !!search || (!route.project && ['trash', 'conflicts'].includes(route.view));
  const qa = $('#quickAdd');
  qa.hidden = !canAdd;
  qa.querySelector('input').placeholder = addHint;

  const html = groups.map(g => {
    if (g.section) {
      const s = g.section, n = (I.kids.get(s.id) || []).length;
      return `<div class="group sec ${s.data.color ? 'c-' + s.data.color : ''}" data-drop="${s.id}" data-kind="any">
        <div class="sechead ${route.item === s.id ? 'on' : ''}" data-open="${s.id}" role="button" tabindex="0">
          <span class="sname">${esc(g.name)}</span>${n ? `<span class="scount">${n}</span>` : ''}
          <button class="secadd" data-new="task" data-parent="${s.id}" aria-label="Add a to-do to ${esc(g.name)}" title="Add a to-do here">${ICON.plus}</button>
        </div>
        ${g.items.length ? g.items.map(r => rowHTML(r, { inProject: true })).join('') : '<p class="secempty">Nothing open in this section.</p>'}</div>`;
    }
    if (!g.items.length) return g.empty ? `<p class="empty">${esc(g.empty)}</p>` : '';
    const doneKey = key + ':' + g.name;
    if (g.done) {
      // A quiet line at the bottom: "3 done · Show".
      const isOpenSec = openDone.has(doneKey);
      return `<div class="group done"><button class="foot toggle" data-done="${esc(doneKey)}">${g.items.length} ${g.name === 'Done today' ? 'done today' : 'done'} · <span>${isOpenSec ? 'Hide' : 'Show'}</span></button>
        ${isOpenSec ? g.items.map(r => rowHTML(r, { trash: g.trash, inProject: !!route.project, where: g.where })).join('') : ''}</div>`;
    }
    const band = g.name && !g.bare ? `<div class="gname band ${g.late ? 'late' : ''}"><span>${esc(g.name)}</span><small>${g.items.length}</small></div>` : '';
    const rowOf = r => rowHTML(r, g.hits ? { inProject: true, hit: g.hits.get(r.id), under: g.under } : { trash: g.trash, inProject: !!route.project, where: g.where });
    return `<div class="group ${g.late ? 'late' : ''} ${g.bare ? 'bare' : ''} ${g.hits ? 'found' : ''}" ${g.drop ? `data-drop="${g.drop}" data-kind="${g.kind}"` : ''}>${band}${g.items.map(rowOf).join('')}</div>`;
  }).join('');
  const nothing = !groups.some(g => g.items.length);
  $('#listBody').innerHTML = html || (nothing ? `<p class="empty">${emptyText()}</p>` : '');
  hydrateThumbs($('#listBody'));
}

function emptyText() {
  if (searching() && !search) return 'Type to search everything: titles, text, checklists, spreadsheets, file names and string labels. Put "quotes" round words that go together.';
  if (searching()) return 'Nothing matches that. Search looks at titles, text, checklists, spreadsheets, file names and string labels.';
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

// What a note holds besides text, for the little icon on its row.
function noteKind(body = '') {
  if (/data-sheet=/.test(body)) return ['sheet', 'Spreadsheet'];
  if (/data-yt=/.test(body)) return ['clip', 'YouTube clip'];
  if (/data-draw=/.test(body)) return ['draw', 'Drawing'];
  if (/data-doc=/.test(body)) return ['doc', 'File'];
  if (/data-weblink=/.test(body)) return ['link', 'Link'];
  if (/data-file=/.test(body)) return ['photo', 'Photo'];
  return null;
}
// A note's checklist, ticked of total ("2/5"), or ''.
function checkCount(body = '') {
  const lists = body.match(/<ul class="checklist">[\s\S]*?<\/ul>/g);
  if (!lists) return '';
  const all = lists.join('');
  const n = (all.match(/<li\b/g) || []).length, done = (all.match(/data-checked="true"/g) || []).length;
  return n ? `${done}/${n}` : '';
}

// One line per row (list style B, "Compact"): tick or icon, the title with a few grey extras
// after it (steps done, where it lives), one small icon, and the date in a column on the right.
function rowHTML(r, { trash = false, inProject = false, where = false, hit = null, under = null } = {}) {
  const d = r.data, t = today();
  const type = d.type || 'note';
  const sel = route.item === r.id ? 'on' : '';
  const bits = [];
  const kids = I.kids.get(r.id) || [];
  if (type === 'project') { const { total, done } = progress(r.id); if (total) bits.push(`${done}/${total}`); }
  else if (kids.length) { const tasks = kids.filter(k => k.data.type === 'task'); bits.push(tasks.length ? `${tasks.filter(k => k.data.done).length}/${tasks.length}` : `${kids.length} inside`); }
  else if (type === 'note') { const c = checkCount(d.body); if (c) bits.push(c); }
  const proj = !inProject && I.project(r);
  if (proj) { const sec = I.parentOf(r)?.data.type === 'section' ? I.parentOf(r) : null; bits.push(`· ${titleOf(proj)}${sec ? ' › ' + titleOf(sec) : ''}`); }
  // In a project's Today / Upcoming: which section or sub-project it's in, if not loose in the project.
  if (where && route.project) { const par = I.parentOf(r); if (par && par.id !== route.project) bits.push('· ' + titleOf(par)); }
  // (0.8.1) A search result: inside something further down than its group says.
  if (hit) { const path = I.ancestors(r), at = under ? path.findIndex(x => x.id === under) : -1, rest = path.slice(at + 1); if (rest.length) bits.push('· ' + rest.map(titleOf).join(' › ')); }
  // One small icon: a conflict, a repeat, or what a note holds.
  const kind = type === 'note' && noteKind(d.body);
  const ic = r.conflict ? `<span class="meta late" title="Conflict: changed on two devices">${ICON.warn}</span>`
    : d.repeat && type === 'task' ? `<span class="meta" title="${esc(REPEATS[d.repeat] || 'Repeats')}">${ICON.repeat}</span>`
    : type === 'project' && d.lock ? `<span class="meta" title="${isLocked(r) ? 'Locked' : 'Unlocked for now'}">${isLocked(r) ? ICON.lock : ICON.unlock}</span>`
    : kind ? `<span class="meta" title="${kind[1]}">${ROWIC[kind[0]]}</span>` : '';
  // The date column: when it's due (or starts); a note shows when it was last changed.
  let when = '', wcls = '';
  if (type === 'task' && d.done) when = d.doneAt ? fmtDay(d.doneAt.slice(0, 10)) : '';
  else if ((type === 'task' || type === 'project') && d.due) { when = fmtDay(d.due); wcls = !d.done && d.due < t ? 'late' : d.due === t ? 'now' : ''; }
  else if ((type === 'task' || type === 'project') && d.start && d.start > t) when = 'from ' + fmtDay(d.start);
  else if (type === 'note' && !inProject) { when = fmtDay(ymd(new Date(d.updated || d.created || Date.now()))); wcls = 'soft'; }
  const lead = type === 'task' ? `<button class="tick ${d.done ? 'done' : ''}" data-tick="${r.id}" aria-label="${d.done ? 'Mark not done' : 'Mark done'}"></button>`
    : `<span class="ic t-${type}">${typeIcon(type)}</span>`;
  return `
    <div class="row ${sel} t-${type} ${d.done ? 'is-done' : ''} ${d.color ? 'c-' + d.color : ''} ${hit?.inText ? 'hassnip' : ''}" data-open="${r.id}" role="button" tabindex="0">
      ${trash ? `<span class="ic">${typeIcon(type)}</span>` : lead}
      <span class="title">${d.pinned ? `<span class="pinmark" title="Pinned">${ICON.pin}</span>` : ''}${hit ? S.markHTML(titleOf(r), hit.ts, esc) : esc(titleOf(r))}${bits.length ? ` <small>${esc(bits.join(' '))}</small>` : ''}</span>
      ${ic}${r.dirty && store.status.state !== 'signedout' ? '<span class="dot-pending" title="Not synced yet"></span>' : ''}
      ${trash ? `<span class="trashacts"><button data-restore="${r.id}">Restore</button><button class="danger" data-purge="${r.id}">Delete</button></span>` : `<span class="when ${wcls}">${esc(when)}</span>`}
      ${hit?.inText ? `<span class="snip">${S.snippetHTML(r, hit.ts, esc)}</span>` : ''}
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
  // Inside a locked project (or the locked project's own page): the way in, unless its list is showing it already.
  const lockId = id && (I.hiddenIn.get(id) || (isLocked(I.byId.get(id)) ? id : null));
  if (lockId) {
    if (editingId) { saveEditing(); editingId = null; }
    const p = I.byId.get(lockId);
    if (route.project === lockId && wide.matches) host.innerHTML = `<div class="blank">${ICON.lock}<p>Locked.</p></div>`;
    else if (host.querySelector('.lockpanel')?.dataset.unlock !== lockId) host.innerHTML = `<div class="scroll lockwrap">${lockPanelHTML(p)}${!wide.matches ? '<button class="link" data-act="back">Back</button>' : ''}</div>`;
    return;
  }
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
        <button data-act="pin" title="Pin to the top">${ICON.pin}</button>
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
        <label class="chip sel rep">${ICON.repeat}<select class="repeat" aria-label="Repeat"><option value="">Repeat</option>${Object.entries(REPEATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <button class="chip where" data-act="move"></button>
      </div>
      <div class="swatchrow" role="group" aria-label="Colour">
        <button class="sw none" data-colour-pick="" title="No colour">×</button>
        ${COLOURS.map(c => `<button class="sw c-${c}" data-colour-pick="${c}" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join('')}
      </div>
      <div class="boardsize" hidden><span>Size on the board</span><div class="seg">${CARD_SIZES.map(([s, label]) => `<button data-cardsize="${s}">${label}</button>`).join('')}</div></div>
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
  $('.repeat', host).addEventListener('change', e => {
    const rule = e.target.value || undefined, cur = I.byId.get(r.id);
    // Repeating needs a date to count from: today, if it hasn't got one.
    store.update(r.id, { repeat: rule, ...(rule && !cur?.data.due ? { due: today() } : {}) });
  });
  for (const k of ['start', 'due']) {
    $('.' + k, host).addEventListener('change', e => store.update(r.id, { [k]: e.target.value || undefined }));
  }

  editor = createEditor($('.editor', host), {
    onChange: html => { if (I.byId.get(r.id) && (I.byId.get(r.id).data.body || '') !== html) store.update(r.id, { body: html }); },
    resolveFile: id => store.fileUrl(id),
    addPhoto: file => store.addPhoto(file),
    onError: msg => toast(msg),
    onImage: src => { $('#lightbox img').src = src; $('#lightbox').hidden = false; },
    onClip: c => clipModal(c),
    onDraw: dr => openDrawing({ drawing: dr, title: (I.byId.get(r.id) && titleOf(I.byId.get(r.id))) || 'Drawing' }),
    videoInfo: id => store.videoInfo(id),
    onSheet: sh => openSheet({ sheet: sh, title: (I.byId.get(r.id) && titleOf(I.byId.get(r.id))) || 'Spreadsheet', saveFile: deliver }),
    onLink: l => linkModal(l),
    addDoc: file => addDocWithPreview(file),
    openDoc: d => openDoc(d),
    saveDoc: d => saveDoc(d),
    previewDoc: d => previewOptions(d),
    canPreview: d => !!pv.previewKind(d),
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
  const rep = $('.repeat', host);
  rep.value = d.repeat && REPEATS[d.repeat] ? d.repeat : '';
  rep.closest('.chip').hidden = type !== 'task';
  rep.closest('.chip').classList.toggle('set', !!d.repeat);
  const proj = parent?.data.type === 'section' ? I.project(r) : null;
  $('.props .where', host).innerHTML = `${ICON.folder}<span>${parent ? (proj ? esc(titleOf(proj)) + ' › ' : '') + esc(titleOf(parent)) : 'No project'}</span>`;
  $('.acts [data-act=pin]', host).classList.toggle('on', !!d.pinned);
  // The board button: a project's own board, or the board of the project this is in.
  const bp = type === 'project' ? r : I.project(r);
  const bb = $('.acts .boardbtn', host);
  bb.hidden = !bp || (route.view === 'board' && route.board === bp.id);
  bb.title = type === 'project' ? 'Open this project’s board' : bp ? `Open “${titleOf(bp)}” board` : '';
  for (const b of host.querySelectorAll('[data-colour-pick]')) b.classList.toggle('on', (d.color || '') === b.dataset.colourPick);
  // Opened from a board: how big its card is there (also the handle on the card's corner).
  const bs = $('.boardsize', host), onBoard = route.view === 'board' && route.board && route.board !== r.id && type !== 'section';
  bs.hidden = !onBoard;
  if (onBoard) {
    const cur = +d.cork?.[route.board]?.s || 1;
    const near = CARD_SIZES.reduce((a, b) => (Math.abs(b[0] - cur) < Math.abs(a[0] - cur) ? b : a))[0];
    for (const b of bs.querySelectorAll('[data-cardsize]')) b.classList.toggle('on', +b.dataset.cardsize === near);
  }

  // Strings: every string this is on (from it, to it, or joined to one as a branch), listing the
  // other things on each. × cuts a string between two ends; on a branch it takes that branch off.
  const strings = [];
  for (const x of I.live) for (const l of x.data.links || []) {
    const ends = [x.id, l.to], also = (l.also || []).filter(c => !ends.includes(c));
    if (!ends.includes(r.id) && !also.includes(r.id)) continue;
    for (const o of [...ends, ...also]) {
      if (o === r.id || !I.byId.has(o)) continue;
      const off = also.includes(r.id) ? r.id : also.includes(o) ? o : null;   // the branch × takes off
      // (0.7.7) which way it points, from here: → to the other one, ← to this one (set in the string's menu on a board)
      const toSide = id => id === x.id ? 'from' : 'to', dir = l.dir;
      const arrow = !dir || dir === 'none' ? '' : dir === 'both' ? '↔' : (dir === toSide(o) || (dir === 'to' && also.includes(o))) ? '→' : (dir === toSide(r.id) || (dir === 'to' && also.includes(r.id))) ? '←' : '';
      strings.push({ id: o, label: l.label, arrow, branch: !!off, untie: off ? `data-unbranch="${x.id}|${l.to}|${off}"` : `data-untie="${x.id}|${l.to}"` });
    }
  }
  $('.links', host).innerHTML = `
    <div class="ihead"><h3>Strings</h3><span class="add"><button data-act="tie">+ Tie to…</button></span></div>
    ${strings.length ? strings.map(x => { const o = I.byId.get(x.id); return `
      <div class="lrow" data-open="${x.id}" role="button" tabindex="0">
        <span class="ic t-${o.data.type}">${typeIcon(o.data.type)}</span>
        ${x.arrow ? `<span class="sdir" title="${x.arrow === '→' ? 'Points to it' : x.arrow === '←' ? 'Points here' : 'Points both ways'}">${x.arrow}</span>` : ''}<span class="name">${esc(titleOf(o))}</span>${x.label ? `<em>${esc(x.label)}</em>` : ''}${x.branch ? '<small class="via">branch</small>' : ''}
        <button class="untie" ${x.untie} aria-label="${x.branch ? 'Take off this string' : 'Cut this string'}">${ICON.close}</button>
      </div>`; }).join('') : '<p class="hint">Tie this to anything else in Brain Tree, here or by dragging from a card on a board.</p>'}`;

  // Body: only replace it from outside (another device) when you're not typing in it.
  if (!editor.element.contains(document.activeElement) && !editor.pending && editor.getHTML() !== (d.body || '')) editor.setHTML(d.body || '');

  // What's inside: projects and sections show it above their notes; other items below.
  const kids = (I.kids.get(r.id) || []);
  const group = type === 'project' || type === 'section';
  const top = $('.inside.top', host), bottom = $('.inside.bottom', host);
  const target = group ? top : bottom;
  (group ? bottom : top).innerHTML = '';
  const openTasks = kids.filter(k => k.data.type === 'task' && !k.data.done).sort(byPinnedOrder);
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
      ${done.length ? `<button class="foot toggle" data-done="${doneKey}">${done.length} done · <span>${openDone.has(doneKey) ? 'Hide' : 'Show'}</span></button>${openDone.has(doneKey) ? done.map(k => rowHTML(k, { inProject: true })).join('') : ''}` : ''}`;
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

  $('.stamp', host).textContent = [d.created ? 'Created ' + fmtWhen(d.created) : '', d.repeat && d.lastDone ? 'Last done ' + fmtWhen(d.lastDone) : '', d.updated && d.updated !== d.created ? 'Edited ' + fmtWhen(d.updated) : '', r.dirty && store.signedIn() ? 'Not synced yet' : ''].filter(Boolean).join(' · ');
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
  if (done && r.data.type === 'task' && r.data.repeat) {
    // A repeating to-do stays open: it moves on to its next date, with its steps unticked.
    const d = r.data, next = nextRepeat(d.due || today(), d.repeat);
    const before = { due: d.due, start: d.start, lastDone: d.lastDone };
    const steps = I.descendants(id).filter(k => k.data.type === 'task' && k.data.done).map(k => ({ id: k.id, doneAt: k.data.doneAt }));
    await store.update(id, { due: next, start: d.start ? addDays(d.start, daysBetween(d.due || today(), next)) : undefined, lastDone: new Date().toISOString() });
    for (const s of steps) await store.update(s.id, { done: undefined, doneAt: undefined });
    toast(`Done. Next one: ${fmtDay(next)}`, 'Undo', async () => {
      await store.update(id, before);
      for (const s of steps) await store.update(s.id, { done: true, doneAt: s.doneAt });
    });
    return;
  }
  await store.update(id, { done: done || undefined, doneAt: done ? new Date().toISOString() : undefined });
  if (done && r.data.type === 'task') toast(`Done: ${titleOf(r)}`, 'Undo', () => store.update(id, { done: undefined, doneAt: undefined }));
  if (done && r.data.type === 'project') toast(`Finished: ${titleOf(r)}`, 'Undo', () => store.update(id, { done: undefined, doneAt: undefined }));
}

async function setDue(id, due) {
  const r = store.get(id);
  if (!r || (r.data.due || '') === (due || '')) return;
  const was = r.data.due;
  await store.update(id, { due: due || undefined });
  toast(due ? `Due ${fmtDay(due)}: ${titleOf(r)}` : `No date now: ${titleOf(r)}`, 'Undo', () => store.update(id, { due: was }));
}

// Things that sit side by side with it, in the order they're shown (for dragging and "Move to top").
function siblingsOf(r) {
  if (r.data.type === 'project') {
    const k = navUnder(r);
    return I.live.filter(p => p.data.type === 'project' && !p.data.done && navUnder(p) === k).sort(byPinnedOrder);
  }
  return (I.kids.get(I.parentOf(r)?.id || '') || []).filter(k => k.data.type === r.data.type && !k.data.done).sort(byPinnedOrder);
}
// Only where the order is yours to set: projects and sections, and what's inside a project.
const canTop = r => {
  const par = I.parentOf(r);
  if (!['project', 'section'].includes(r.data.type) && !['project', 'section'].includes(par?.data.type)) return false;
  return siblingsOf(r)[0]?.id !== r.id && !r.data.done;
};
async function toTop(id) {
  const r = I.byId.get(id);
  if (!r) return;
  const first = siblingsOf(r)[0];
  if (!first || first.id === id) return;
  const was = r.data.order;
  await store.update(id, { order: (first.data.order || 0) - 1000 });
  toast(`Moved to the top: ${titleOf(r)}`, 'Undo', () => store.update(id, { order: was }));
}

// A copy, with everything inside it (to-dos come out unticked, so a project works as a template).
async function duplicate(id) {
  const r = I.byId.get(id);
  if (!r) return null;
  const all = [r, ...I.descendants(id)];   // each thing comes after the one it's in
  const ids = new Map();
  for (const x of all) {
    const data = structuredClone(x.data);
    for (const k of ['created', 'updated', 'done', 'doneAt', 'trashed', 'lastDone', 'links']) delete data[k];
    if (x === r) {
      if ((data.title || '').trim()) data.title = data.title.trim() + ' (copy)';
      data.order = (x.data.order || 0) + 0.5;   // right after the original
      delete data.pinned;
    } else data.parent = ids.get(data.parent) || data.parent;
    // Board spots: kept on the copy's own boards; the copy itself finds a free spot on the board it's on.
    if (data.cork) {
      const c = {};
      for (const [k, v] of Object.entries(data.cork)) { if (k === 'banner') c.banner = v; else if (ids.get(k)) c[ids.get(k)] = v; }
      if (Object.keys(c).length) data.cork = c; else delete data.cork;
    }
    ids.set(x.id, await store.create(data));
  }
  // Strings between things that were copied are copied too (with any of their branches that were).
  for (const x of all) {
    const ls = (x.data.links || []).filter(l => ids.get(l.to));
    if (ls.length) await store.update(ids.get(x.id), { links: ls.map(l => {
      const y = { ...l, to: ids.get(l.to), also: (l.also || []).map(c => ids.get(c)).filter(Boolean) };
      if (!y.also.length) delete y.also;
      // (a string's shape, for the copied boards)
      const via = Object.fromEntries(Object.entries(l.via || {}).filter(([b]) => ids.get(b)).map(([b, v]) => [ids.get(b), v]));
      if (Object.keys(via).length) y.via = via; else delete y.via;
      return y;
    }) });
  }
  const copy = ids.get(id);
  toast(`Copied${all.length > 1 ? ` with ${all.length - 1} thing${all.length === 2 ? '' : 's'} inside` : ''}`, 'Open', () => (r.data.type === 'project' && !route.project ? go({ project: copy, view: null, item: null }) : openItem(copy)));
  return copy;
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

// ---------- Swipe, hold and drag (gestures.js does the finger work) ----------

const idOf = el => el.dataset.open || el.dataset.project || '';

// What a swipe shows: right for quick things and More, left for Delete.
function rowActions(el) {
  const r = I.byId.get(idOf(el));
  if (!r || !I.alive(r) || (!route.project && !search && ['trash', 'conflicts'].includes(route.view) && el.closest('#listBody'))) return null;
  const t = r.data.type;
  const more = { id: 'more', label: 'More', icon: ICON.dots, tone: 'grey' };
  if (isLocked(r)) return { lead: [{ id: 'pin', label: r.data.pinned ? 'Unpin' : 'Pin', icon: ICON.pin, tone: 'accent' }, more], trail: [] };
  const lead = t === 'task' ? [{ id: 'done', label: r.data.done ? 'Undo' : 'Done', icon: ICON.check, tone: 'green' }, { id: 'when', label: 'Date', icon: ICON.cal, tone: 'accent' }, more]
    : t === 'project' ? [{ id: 'board', label: 'Board', icon: ICON.board, tone: 'blue' }, { id: 'pin', label: r.data.pinned ? 'Unpin' : 'Pin', icon: ICON.pin, tone: 'accent' }, more]
    : t === 'note' ? [{ id: 'pin', label: r.data.pinned ? 'Unpin' : 'Pin', icon: ICON.pin, tone: 'accent' }, more]
    : [more];
  return { lead, trail: [{ id: 'delete', label: 'Delete', icon: ICON.trash, tone: 'red' }] };
}

function rowAction(el, act) {
  const id = idOf(el), r = I.byId.get(id);
  if (!r) return;
  if (act === 'done') toggleDone(id);
  else if (act === 'when') whenSheet(id);
  else if (act === 'more') itemMenu(id);
  else if (act === 'board') go({ view: 'board', board: r.data.type === 'project' ? id : I.project(r)?.id, project: null, item: null });
  else if (act === 'pin') togglePin(id);
  else if (act === 'delete') trashItem(id);
}

function dateButtons(due) {
  const t = today(), seen = new Set();
  const opts = [['Today', t], ['Tomorrow', addDays(t, 1)], ['This weekend', [0, 6].includes(parseYmd(t).getDay()) ? t : nextDow(t, 6)], ['Next week', nextDow(t, 1)]]
    .filter(([, d]) => !seen.has(d) && seen.add(d));
  return opts.map(([label, d]) => `<button class="${due === d ? 'on' : ''}" data-due="${d}"><b>${label}</b><small>${esc(shortDate(d))}</small></button>`).join('')
    + `<label class="${due && !seen.has(due) ? 'on' : ''}"><b>Pick a date</b><small>${due && !seen.has(due) ? esc(shortDate(due)) : 'Calendar'}</small><input type="date" value="${due || ''}"></label>`
    + (due ? '<button data-due=""><b>No date</b><small>Clear it</small></button>' : '');
}
function wireDates(el, id) {
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-due]');
    if (!b) return;
    closeModal();
    setDue(id, b.dataset.due);
  });
  const input = el.querySelector('.mdates input[type=date]');
  input?.addEventListener('change', () => { if (!input.value) return; closeModal(); setDue(id, input.value); });
  // Tapping anywhere on "Pick a date" opens the calendar.
  input?.closest('label').addEventListener('click', e => { if (e.target !== input) { e.preventDefault(); try { input.showPicker(); } catch (err) { input.focus(); } } });
}

function whenSheet(id) {
  const r = I.byId.get(id);
  if (!r) return;
  modal(`
    <div class="mhead"><span class="ic">${ICON.cal}</span><b>${esc(titleOf(r))}</b></div>
    <div class="mdates">${dateButtons(r.data.due)}</div>
    <div class="mbtns"><button data-close>Cancel</button></div>`, el => wireDates(el, id), 'menu');
}

// Rename without opening it (from the hold menu).
function renameSheet(id) {
  const r = I.byId.get(id);
  if (!r) return;
  const what = { project: 'project', section: 'section', note: 'note', task: 'to-do' }[r.data.type] || 'item';
  modal(`
    <h2>Rename ${what}</h2>
    <form class="renameform">
      <label class="field">Name<input class="rname" value="${esc(r.data.title || '')}" placeholder="${esc(titleOf(r))}" maxlength="200" autocomplete="off" enterkeyhint="done"></label>
      <div class="mbtns"><button type="button" data-close>Cancel</button><button class="primary">Save</button></div>
    </form>`, el => {
    const input = el.querySelector('.rname');
    // Straight away, while the tap that asked for it still counts (an iPhone only shows the keyboard then).
    input.focus(); input.select();
    el.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      const title = input.value.trim();
      closeModal();
      if ((title || r.data.type === 'note') && title !== (r.data.title || '')) store.update(id, { title });
    });
  });
}

// Pinned to-dos and notes stay at the top of their list; pinned projects at the top of the sidebar.
const pinWhere = r => (r.data.type === 'project' ? 'the top of the sidebar' : 'the top of its list');
function togglePin(id) {
  const r = I.byId.get(id);
  if (!r) return;
  const was = r.data.pinned, on = !was;
  store.update(id, { pinned: on ? new Date().toISOString() : undefined });
  toast(on ? `Pinned to ${pinWhere(r)}` : 'Unpinned', 'Undo', () => store.update(id, { pinned: was }));
}

// ---------- Locked projects ----------
// The password itself is never kept: data.lock holds a salted PBKDF2 hash of it, so this device can
// check what you type. Unlocking lasts until the app is closed, or left for 5 minutes, or "Lock".

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function lockHash(pw, salt, iter) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, key, 256));
}
async function makeLock(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 210000;
  return { v: 1, salt: b64(salt), iter, hash: await lockHash(pw, salt, iter), set: new Date().toISOString() };
}
async function lockMatches(lock, pw) {
  try { return (await lockHash(pw, unb64(lock.salt), lock.iter || 210000)) === lock.hash; } catch (e) { return false; }
}

function lockPanelHTML(p) {
  return `<form class="lockpanel" data-unlock="${p.id}" autocomplete="off">
    <span class="lockic">${ICON.lock}</span>
    <h3>“${esc(titleOf(p))}” is locked</h3>
    <p>Type its password to open it on this device.</p>
    <input type="password" class="lockpw" placeholder="Password" aria-label="Password" autocomplete="off" enterkeyhint="go">
    <button class="primary">Unlock</button>
    <p class="lockerr" role="alert"></p>
    <button type="button" class="link" data-act="lock-forgot" data-id="${p.id}">Forgotten it?</button>
  </form>`;
}

async function tryUnlock(form) {
  const p = I.byId.get(form.dataset.unlock), input = form.querySelector('.lockpw'), err = form.querySelector('.lockerr'), btn = form.querySelector('.primary');
  if (!p?.data.lock || !input.value) return;
  btn.disabled = true; err.textContent = '';
  const ok = await lockMatches(p.data.lock, input.value);
  btn.disabled = false;
  if (!ok) { err.textContent = 'That isn’t its password.'; input.select(); return; }
  input.value = '';
  unlocked.add(p.id);
  render();
}

function lockNow(id) {
  unlocked.delete(id);
  render();
}

// Put a lock on (or change it): the password twice.
function lockSheet(id) {
  const r = I.byId.get(id);
  if (!r) return;
  const had = !!r.data.lock;
  modal(`
    <h2>${had ? 'Change the password' : 'Lock with a password'}</h2>
    <form class="lockform" autocomplete="off">
      <label class="field">New password<input type="password" class="pw1" autocomplete="new-password" minlength="4" required></label>
      <label class="field">Type it again<input type="password" class="pw2" autocomplete="new-password" required></label>
      <p class="hint">Everything in “${esc(titleOf(r))}” is hidden on every device (lists, board, search, Today) until the password is typed, and locks again when you leave the app for a few minutes. It’s a privacy screen, not encryption: the project still syncs like everything else. If you forget it, your Brain Tree sign-in password takes the lock off.</p>
      <p class="cerr" role="alert"></p>
      <div class="mbtns"><button type="button" data-close>Cancel</button><button class="primary">${had ? 'Change it' : 'Lock it'}</button></div>
    </form>`, el => {
    const f = el.querySelector('form'), a = el.querySelector('.pw1'), b = el.querySelector('.pw2'), err = el.querySelector('.cerr');
    a.focus();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (a.value.length < 4) { err.textContent = 'Make it at least 4 characters.'; return; }
      if (a.value !== b.value) { err.textContent = 'Those two don’t match.'; b.select(); return; }
      f.querySelector('.primary').disabled = true;
      const lock = await makeLock(a.value);
      closeModal();
      unlocked.add(id);   // you know it: it stays open here until you lock it or leave the app
      await store.update(id, { lock });
      toast(had ? 'Password changed.' : 'Locked. It stays open on this device until you tap Lock or leave the app.');
    });
  });
}

function removeLock(id) {
  const r = I.byId.get(id);
  if (!r?.data.lock || isLocked(r)) return;
  const was = r.data.lock;
  store.update(id, { lock: undefined });
  toast('Lock taken off.', 'Undo', () => store.update(id, { lock: was }));
}

// Forgotten the project's password: the Brain Tree sign-in password (checked by the server) takes the lock off.
function forgotSheet(id) {
  const r = I.byId.get(id);
  if (!r) return;
  modal(`
    <h2>Forgotten the password?</h2>
    <form class="lockform" autocomplete="off">
      <p class="hint">Type your Brain Tree sign-in password (the one you use on a new device) to take the lock off “${esc(titleOf(r))}”. This needs signal.</p>
      <label class="field">Brain Tree password<input type="password" class="pw1" autocomplete="current-password" required></label>
      <p class="cerr" role="alert"></p>
      <div class="mbtns"><button type="button" data-close>Cancel</button><button class="primary">Take the lock off</button></div>
    </form>`, el => {
    const f = el.querySelector('form'), a = el.querySelector('.pw1'), err = el.querySelector('.cerr');
    a.focus();
    f.addEventListener('submit', async e => {
      e.preventDefault();
      if (!navigator.onLine) { err.textContent = 'You’re offline. Try again when there’s signal.'; return; }
      const btn = f.querySelector('.primary');
      btn.disabled = true; err.textContent = '';
      try { await store.checkPassword(a.value); } catch (x) { err.textContent = x.message; btn.disabled = false; return; }
      closeModal();
      await store.update(id, { lock: undefined });
      toast('Lock taken off. You can lock it again with a new password from its menu.');
    });
  });
}

// Leave the app for 5 minutes and anything unlocked locks again.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (unlocked.size && hiddenAt && Date.now() - hiddenAt > 5 * 60e3) { unlocked.clear(); render(); }
});

// Everything you can do to a thing, from holding it (or right-clicking, or swiping right and More).
function itemMenu(id) {
  const r = I.byId.get(id);
  if (!r || !I.alive(r)) return;
  const d = r.data, type = d.type;
  const mi = (m, icon, label, cls = '') => `<button class="mi ${cls}" data-m="${m}">${icon}<span>${label}</span></button>`;
  if (isLocked(r)) {
    // Locked: only the way in (and pinning, which shows nothing of what's inside).
    modal(`
      <div class="mhead"><span class="ic t-project">${ICON.lock}</span><b>${esc(titleOf(r))}</b></div>
      <div class="mlist">${mi('open', ICON.unlock, 'Unlock…')}${mi('pin', ICON.pin, d.pinned ? 'Unpin' : `Pin to ${pinWhere(r)}`)}</div>
      <div class="mbtns"><button data-close>Cancel</button></div>`, el => el.addEventListener('click', e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      closeModal();
      if (b.dataset.m === 'open') { search = ''; $('#search').value = ''; go({ project: id, view: null, board: null, item: null }); setTimeout(() => $('.lockpw')?.focus(), 60); }
      else togglePin(id);
    }), 'menu');
    return;
  }
  const items = [mi('open', ICON.open, 'Open'), mi('rename', ICON.rename, 'Rename')];
  if (type === 'task') items.push(mi('done', ICON.check, d.done ? 'Mark not done' : d.repeat ? 'Done (moves to its next date)' : 'Mark done'));
  if (type === 'project') items.push(mi('board', ICON.board, 'Open its board'), mi('add', ICON.plus, 'Add a to-do to it'), mi('done', ICON.check, d.done ? 'Reopen project' : 'Finish project'));
  if (type === 'project') items.push(...(d.lock ? [mi('locknow', ICON.lock, 'Lock it now'), mi('lockset', ICON.lock, 'Change its password…'), mi('unlockall', ICON.unlock, 'Take the lock off')] : [mi('lockset', ICON.lock, 'Lock with a password…')]));
  if (type === 'project' || type === 'section') items.push(mi('export', ICON.share, 'Print or export…'));
  if (type !== 'section') items.push(mi('pin', ICON.pin, d.pinned ? 'Unpin' : `Pin to ${pinWhere(r)}`));
  if (canTop(r)) items.push(mi('top', ICON.top, 'Move to the top'));
  if (type !== 'section') items.push(mi('move', ICON.move, 'Move to another project…'));
  if (type === 'task' && d.repeat) items.push(mi('norepeat', ICON.repeat, `Stop repeating (${(REPEATS[d.repeat] || '').toLowerCase()})`));
  if (type !== 'section') items.push(mi('dup', ICON.copy, type === 'project' ? 'Duplicate, with everything in it' : 'Duplicate'));
  items.push(mi('delete', ICON.trash, type === 'section' ? 'Delete section (keeps what’s in it)' : 'Delete', 'danger'));
  modal(`
    <div class="mhead"><span class="ic t-${type}">${typeIcon(type)}</span><b>${esc(titleOf(r))}</b></div>
    ${type === 'task' && !d.done ? `<div class="mdates">${dateButtons(d.due)}</div>` : ''}
    <div class="mlist">${items.join('')}</div>
    <div class="swatchrow" role="group" aria-label="Colour">
      <button class="sw none ${d.color ? '' : 'on'}" data-mcolour="" title="No colour">×</button>
      ${COLOURS.map(c => `<button class="sw c-${c} ${d.color === c ? 'on' : ''}" data-mcolour="${c}" title="${c[0].toUpperCase() + c.slice(1)}"></button>`).join('')}
    </div>
    <div class="mbtns"><button data-close>Cancel</button></div>`, el => {
    wireDates(el, id);
    el.addEventListener('click', async e => {
      const c = e.target.closest('[data-mcolour]');
      if (c) { store.update(id, { color: c.dataset.mcolour || undefined }); closeModal(); return; }
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const m = b.dataset.m;
      closeModal();
      if (m === 'open') type === 'project' && !route.project && route.view !== 'board' ? goProject(id) : openItem(id);
      else if (m === 'rename') renameSheet(id);
      else if (m === 'done') toggleDone(id);
      else if (m === 'board') go({ view: 'board', board: id, project: null, item: null });
      else if (m === 'add') { search = ''; $('#search').value = ''; go({ project: id, view: null, item: null }); setTimeout(() => $('#quickAdd input')?.focus(), 60); }
      else if (m === 'pin') togglePin(id);
      else if (m === 'locknow') lockNow(id);
      else if (m === 'lockset') lockSheet(id);
      else if (m === 'unlockall') removeLock(id);
      else if (m === 'export') exportSheet({ project: type === 'project' ? id : I.project(r)?.id, section: type === 'section' ? id : null });
      else if (m === 'top') toTop(id);
      else if (m === 'move') movePicker(id);
      else if (m === 'norepeat') store.update(id, { repeat: undefined });
      else if (m === 'dup') duplicate(id);
      else if (m === 'delete') trashItem(id);
    });
  }, 'menu');
}

// Where a dragged row can go. Projects: among the projects beside them in the sidebar. In a project's
// list: anywhere among things of the same kind, loose or in any section (dropping in a section moves
// it there). Section headings: among the other sections.
function dropSlots(el) {
  if (search) return null;
  const id = idOf(el), r = I.byId.get(id);
  if (!r) return null;
  const box = n => n.getBoundingClientRect();
  const across = n => () => { const b = box(n); return [b.left + 6, b.right - 6]; };
  if (el.matches('#projects .navrow.proj')) {
    const rows = [...$('#projects').querySelectorAll('.navrow.proj')];
    const all = rows.filter(x => x.dataset.under === el.dataset.under);
    const sibs = all.filter(x => x !== el);
    if (!sibs.length) return null;
    const ids = sibs.map(x => x.dataset.project), was = all.map(x => x.dataset.project);
    const slots = sibs.map((s, i) => ({ y: () => box(s).top, x: across(s), sibs: ids, index: i, was }));
    // After the last one, below anything shown inside it.
    const last = sibs[sibs.length - 1];
    let end = last;
    for (let i = rows.indexOf(last) + 1; rows[i] && +rows[i].dataset.depth > +last.dataset.depth; i++) end = rows[i];
    slots.push({ y: () => box(end).bottom, x: across(last), sibs: ids, index: ids.length, was });
    return slots;
  }
  if (!route.project || projTab(route.project) !== 'all' || !el.closest('#listBody')) return null;
  if (el.matches('.sechead')) {
    const secs = [...$('#listBody').querySelectorAll('.group.sec')];
    const others = secs.filter(g => !g.contains(el));
    if (!others.length) return null;
    const ids = others.map(g => g.dataset.drop), was = secs.map(g => g.dataset.drop);
    const slots = others.map((g, i) => ({ y: () => box(g).top, x: across(g), sibs: ids, index: i, was }));
    slots.push({ y: () => box(others[others.length - 1]).bottom, x: across(others[others.length - 1]), sibs: ids, index: ids.length, was });
    return slots;
  }
  const kind = r.data.type;
  if (el.closest('.group.done') || !['task', 'note', 'project'].includes(kind)) return null;
  // Taking something out of a section needs somewhere loose to drop it, even if nothing's loose yet.
  if (!$(`#listBody .group[data-kind="${kind}"]`)) {
    const name = { task: 'To-dos', project: 'Sub-projects', note: 'Notes' }[kind];
    const html = `<div class="group dropzone" data-drop="${route.project}" data-kind="${kind}"><div class="gname">${name}</div><p class="secempty">Drop here to take it out of its section</p></div>`;
    const before = kind === 'task' ? $('#listBody').firstElementChild : $('#listBody .group.sec, #listBody .group.done');
    before ? before.insertAdjacentHTML('beforebegin', html) : $('#listBody').insertAdjacentHTML('beforeend', html);
  }
  const slots = [];
  for (const g of $('#listBody').querySelectorAll('.group[data-drop]')) {
    if (g.dataset.kind !== kind && g.dataset.kind !== 'any') continue;
    const all = [...g.querySelectorAll(':scope > .row.t-' + kind)];
    const rows = all.filter(x => x !== el);
    const ids = rows.map(x => x.dataset.open), was = all.map(x => x.dataset.open), parent = g.dataset.drop;
    rows.forEach((x, i) => slots.push({ y: () => box(x).top, x: across(g), sibs: ids, index: i, parent, was }));
    const tail = rows[rows.length - 1], head = g.querySelector(':scope > .sechead, :scope > .gname');
    // After the last of its kind; with none, under the heading (to-dos) or at the end (notes, projects).
    const y = tail ? () => box(tail).bottom : kind === 'task' && head ? () => box(head).bottom : () => box(g).bottom - 4;
    slots.push({ y, x: across(g), sibs: ids, index: ids.length, parent, was });
  }
  return slots;
}

async function dropRow(el, slot) {
  const id = idOf(el), r = I.byId.get(id);
  if (!r) return;
  const list = slot.sibs.map(x => I.byId.get(x)).filter(Boolean);
  const i = Math.min(slot.index, list.length);
  const moving = slot.parent && slot.parent !== (r.data.parent || '');
  const seq = [...list.slice(0, i), r, ...list.slice(i)];
  if (!moving && seq.map(x => x.id).join() === slot.was.join()) return;   // dropped where it was
  const before = { parent: r.data.parent, order: r.data.order };
  const patch = moving ? { parent: slot.parent } : {};
  const prev = list[i - 1], next = list[i];
  const a = prev?.data.order ?? 0, b = next?.data.order ?? 0;
  if (prev && next && a < b) patch.order = (a + b) / 2;
  else if (prev && !next) patch.order = a + 1000;
  else if (next && !prev) patch.order = b - 1000;
  else if (prev && next) {
    // Two with the same place number: number the whole run again.
    const base = Math.min(...seq.map(x => x.data.order || 0));
    for (let k = 0; k < seq.length; k++) {
      if (seq[k].id === id) patch.order = base + k * 1000;
      else if (seq[k].data.order !== base + k * 1000) await store.update(seq[k].id, { order: base + k * 1000 });
    }
  }
  await store.update(id, patch);
  if (moving) {
    const to = I.byId.get(slot.parent);
    toast(`Moved to “${to ? titleOf(to) : 'the project'}”`, 'Undo', () => store.update(id, before));
  }
}

const gest = createGestures({
  rows: '#listBody .row[data-open], #detail .inside .row[data-open], #projects .navrow.proj, #listBody .sechead',
  scrollers: '.listscroll, .navscroll, #detail .scroll',
  actions: rowActions,
  run: rowAction,
  menu: el => itemMenu(idOf(el)),
  slots: dropSlots,
  drop: dropRow,
  dragEnd: () => queueRender(),   // tidies away any drop zone that was added
  idle: () => { if (renderHeld) { renderHeld = false; queueRender(); } },
});

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
    circuit: `<rect width="120" height="48" fill="#0E3B27"/><path d="M0 8L40 48M60 0L108 48" stroke="rgba(224,178,82,.18)"/><rect x="10" y="10" width="34" height="26" rx="2" fill="#0A2C1D" stroke="#C9A24A" stroke-width="1.4"/><rect x="76" y="12" width="34" height="26" rx="2" fill="#0A2C1D" stroke="#C9A24A" stroke-width="1.4"/>
      <path d="M44 23H54L62 31H76" fill="none" stroke="#E0B252" stroke-width="2.4"/><circle cx="44" cy="23" r="3" fill="#0A2C1D" stroke="#E0B252" stroke-width="1.8"/><circle cx="76" cy="31" r="3" fill="#0A2C1D" stroke="#E0B252" stroke-width="1.8"/>`,
    city: `<rect width="120" height="48" fill="#E7E5DF"/><path d="M0 18H120M0 40H120M30 0V48M92 0V48" stroke="#FAF9F5" stroke-width="3"/><rect x="8" y="9" width="34" height="26" rx="3" fill="#fff"/><rect x="8" y="9" width="34" height="5" rx="2" fill="#0060A8"/>
      <rect x="78" y="14" width="34" height="26" rx="3" fill="#fff"/><rect x="78" y="14" width="34" height="5" rx="2" fill="#E2382F"/><path d="M42 22H52L60 30H78" fill="none" stroke="#00843D" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="42" cy="22" r="3.4" fill="#fff" stroke="#00843D" stroke-width="2"/><circle cx="78" cy="30" r="3.4" fill="#fff" stroke="#00843D" stroke-width="2"/>`,
    neon: `<rect width="120" height="48" fill="#0D0B14"/><rect x="10" y="11" width="34" height="26" rx="6" fill="none" stroke="#FF3EA5" stroke-width="5" opacity=".3"/><rect x="10" y="11" width="34" height="26" rx="6" fill="#120E1E" stroke="#FF3EA5" stroke-width="1.6"/>
      <rect x="76" y="11" width="34" height="26" rx="6" fill="none" stroke="#22E3FF" stroke-width="5" opacity=".3"/><rect x="76" y="11" width="34" height="26" rx="6" fill="#120E1E" stroke="#22E3FF" stroke-width="1.6"/>
      <path d="M44 24C58 10 62 38 76 24" fill="none" stroke="#B98CFF" stroke-width="5" opacity=".3"/><path d="M44 24C58 10 62 38 76 24" fill="none" stroke="#B98CFF" stroke-width="1.8"/>`,
    minimal: `<rect width="120" height="48" fill="#F1F1F2"/><rect x="10" y="12" width="36" height="24" rx="6" fill="#fff"/><rect x="74" y="12" width="36" height="24" rx="6" fill="#fff"/><path d="M47 24H70" stroke="#A1A1AA" stroke-width="1.3"/><path d="M68 21.5L72.5 24L68 26.5z" fill="#A1A1AA"/>`,
    hacker: `<rect width="120" height="48" fill="#030603"/><rect x="8" y="9" width="38" height="30" fill="#050A05" stroke="#1E7A3A"/><rect x="8" y="9" width="38" height="6" fill="#0C1B0C"/><circle cx="11.5" cy="12" r="1.2" fill="#FF5F57"/><circle cx="15.5" cy="12" r="1.2" fill="#FEBC2E"/><circle cx="19.5" cy="12" r="1.2" fill="#28C840"/><path d="M12 23h12M12 29h18" stroke="#33FF66" stroke-width="1.6"/>
      <rect x="74" y="9" width="38" height="30" fill="#050A05" stroke="#1E7A3A"/><rect x="74" y="9" width="38" height="6" fill="#0C1B0C"/><circle cx="77.5" cy="12" r="1.2" fill="#FF5F57"/><circle cx="81.5" cy="12" r="1.2" fill="#FEBC2E"/><circle cx="85.5" cy="12" r="1.2" fill="#28C840"/><path d="M78 23h16M78 29h10" stroke="#33FF66" stroke-width="1.6"/>
      <path d="M46 24H60V30H72" fill="none" stroke="#33FF66" stroke-width="1.3" stroke-dasharray="3 2"/><path d="M70 27.5L74 30L70 32.5z" fill="#33FF66"/>`,
    chalkboard: `<rect width="120" height="48" fill="#29402F"/><rect x="10" y="11" width="34" height="26" rx="6" fill="none" stroke="#F4F1E6" stroke-width="1.6" opacity=".85"/><rect x="76" y="11" width="34" height="26" rx="6" fill="none" stroke="#FFD0DD" stroke-width="1.6" opacity=".85"/>
      <path d="M46 26 C56 20 62 30 72 25" fill="none" stroke="#F4F1E6" stroke-width="2" stroke-dasharray="10 2 1 2"/><path d="M67 21L72 25L66 28" fill="none" stroke="#F4F1E6" stroke-width="1.8" stroke-linecap="round"/>`,
    space: `<rect width="120" height="48" fill="#060A1C"/><circle cx="20" cy="7" r=".8" fill="#fff"/><circle cx="58" cy="42" r=".8" fill="#fff"/><circle cx="102" cy="5" r="1" fill="#fff"/><circle cx="55" cy="9" r=".6" fill="#fff"/><circle cx="114" cy="44" r=".7" fill="#fff"/>
      <rect x="8" y="14" width="36" height="24" rx="6" fill="#10163A" stroke="#7F95D8" stroke-width=".8"/><rect x="76" y="12" width="36" height="24" rx="6" fill="#10163A" stroke="#7F95D8" stroke-width=".8"/>
      <path d="M44 24L76 22" stroke="#C9D8FF" stroke-width=".9"/><circle cx="44" cy="24" r="3.5" fill="rgba(200,215,255,.25)"/><circle cx="44" cy="24" r="1.7" fill="#fff"/><circle cx="76" cy="22" r="3.5" fill="rgba(200,215,255,.25)"/><circle cx="76" cy="22" r="1.7" fill="#fff"/>`,
  };
  return `<svg viewBox="0 0 120 48" aria-hidden="true">${looks[id] || ''}</svg>`;
}

async function settingsModal() {
  const s = store.status;
  const p = theme.current(store);
  const dark = document.documentElement.dataset.mode === 'dark';
  const th = theme.THEMES.find(t => t.id === p.theme) || theme.THEMES[0];
  const seg = (k, options) => `<div class="seg" role="group">${Object.entries(options).map(([v, label]) => `<button data-k="${k}" data-v="${v}" class="${p[k] === v ? 'on' : ''}">${label}</button>`).join('')}</div>`;
  // (changes are saved as you make them; Done, which stays at the top, just closes)
  modal(`
    <div class="sethead"><button type="button" class="setdone" data-close>Done</button><h2>Settings</h2></div>
    <div class="settings">
      <h3>Appearance</h3>
      <div class="themepick">${theme.THEMES.map(t => `
        <button data-pick-theme="${t.id}" class="${p.theme === t.id ? 'on' : ''}" style="--a:${(dark ? t.dark : t.light).accent};--b:${(dark ? t.dark : t.light).bg};--c:${(dark ? t.dark : t.light).card};--s:${(dark ? t.dark : t.light).string}">
          <i><b></b><u></u></i><span>${t.name}</span></button>`).join('')}</div>
      <div class="setrow"><span>Light or dark</span>${seg('mode', { auto: 'Match phone', light: 'Light', dark: 'Dark' })}</div>
      <div class="setrow"><span>Main colour</span><span class="colour"><input type="color" data-colour="accent" value="${p.accent || (dark ? th.dark : th.light).accent}" aria-label="Main colour"><button data-reset="accent" class="link" ${p.accent ? '' : 'hidden'}>Use theme’s</button></span></div>
      <div class="setrow"><span>Text style</span>${seg('font', Object.fromEntries(Object.entries(theme.FONTS).map(([k, f]) => [k, `<span style="font-family:${f.stack.replace(/"/g, "'")}">${f.name}</span>`])))}</div>
      <div class="setrow"><span>Text size</span>${seg('size', { small: 'Small', normal: 'Normal', large: 'Large' })}</div>
      <h3>Boards</h3>
      <div class="lookpick">${Object.entries(theme.LOOKS).map(([id, l]) => `
        <button data-pick-look="${id}" class="${p.look === id ? 'on' : ''}">${lookPreview(id)}<span>${l.name}</span></button>`).join('')}</div>
      <div class="setrow"><span>String colour</span><span class="colour"><input type="color" data-colour="string" value="${theme.wireColour(p, dark)}" aria-label="String colour"><button data-reset="string" class="link" ${p.string ? '' : 'hidden'}>Use the look’s</button></span></div>
      <div class="setrow"><span>Card only strung outside its section</span>${seg('tidyMove', { ask: 'Tidy suggests moving it', move: 'Tidy moves it' })}</div>
      <p class="hint">When a card’s strings all go to things outside its section, Tidy tries it out of the section (or in the one its strings go to). If the board comes out tidier, it suggests the move, or just makes it if you choose that (Undo puts it back).</p>
      <h3>Claude</h3>
      <p class="hint">Connect Claude, and in any Claude chat you can say “block this out in Brain Tree”: it makes the project here, with its sections, to-dos, notes and strings, and links back to the chat. It can also add to projects and tick things off. It uses your Claude plan; nothing to pay here.</p>
      <div class="kv"><span>Claude</span><b class="claudestate">${store.signedIn() ? 'Checking…' : 'Sign in to Brain Tree first'}</b></div>
      <div class="claudebtns"></div>
      <h3>Getting started</h3>
      <button class="setbtn" data-s="example">Add an example project</button>
      <p class="hint">A small project that shows everything Brain Tree can do: dates, steps and repeats, sections, a board with strings and a branch, a clip, drawings (one made on the board), a photo, a spreadsheet, a file, a link, a pinned to-do and a locked project. Delete it whenever you like.</p>
      <details><summary>Handy shortcuts</summary>
        <p><b>Swipe</b> a to-do, note or project left to delete it, or right for Done, Date and More.</p>
        <p><b>Hold</b> one for everything you can do to it (on a computer, right-click). Hold and <b>drag</b> to put it in order, or into a section. Projects in the sidebar drag too.</p>
        <p><b>Type a date</b> at the end of a new to-do: “Bins out tomorrow”, “Call Sam fri”, “Dentist 3 Dec”, “Pay rent 1/12”, “Service the car in 2 weeks”.</p>
        <p>On a keyboard: <b>N</b> adds a to-do, <b>/</b> searches.</p>
      </details>
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
      // (data-pick-look and data-pick-theme, not data-look/data-theme: <html> itself carries those,
      // so closest() would always find it)
      const t = e.target.closest('[data-pick-theme]'), s = e.target.closest('[data-k]'), r = e.target.closest('[data-reset]'), l = e.target.closest('[data-pick-look]');
      if (t) {
        // A theme with a feel of its own (Hacker's typewriter text) brings it; one with a board look
        // to match offers it.
        const th = theme.THEMES.find(x => x.id === t.dataset.pickTheme), cur = theme.current(store);
        const prev = theme.THEMES.find(x => x.id === cur.theme);
        // (leaving such a theme puts the usual text back, unless you'd picked another since)
        const font = th?.font || (prev?.font && cur.font === prev.font ? 'system' : null);
        setPref({ theme: t.dataset.pickTheme, accent: null, ...(font ? { font } : {}) }, true);
        if (th?.look && theme.current(store).look !== th.look) toast(`Use the ${theme.LOOKS[th.look].name} board look too?`, 'Yes', () => setPref({ look: th.look, string: null }, $('#modal .settings') ? true : false));
      }
      else if (l) setPref({ look: l.dataset.pickLook, string: null }, true);   // each look comes with its own string
      else if (s) setPref({ [s.dataset.k]: s.dataset.v }, true);
      else if (r) setPref({ [r.dataset.reset]: null }, true);
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const a = b.dataset.s;
      if (a === 'example') { closeModal(); showExample(); }
      if (a === 'claude-connect') {
        if (b.dataset.again && !confirm('Make a new connector address? The one Claude has now stops working, so you’ll paste the new one into Claude.')) return;
        b.disabled = true;
        try { const k = await store.claudeConnect(); claudeSheet(k.url); }
        catch (err) { b.disabled = false; toast(navigator.onLine ? err.message : 'You’re offline. Connect Claude when you have signal.'); }
      }
      if (a === 'claude-off') {
        if (!confirm('Switch Claude off? Claude chats won’t be able to reach Brain Tree until you connect it again.')) return;
        try { await store.claudeOff(); toast('Claude switched off.'); const top = el.scrollTop; await settingsModal(); $('#modal .sheet').scrollTop = top; }
        catch (err) { toast(err.message); }
      }
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
    // Claude: connected or not (asked of the server, which keeps the connector's key).
    if (store.signedIn()) store.claudeStatus().then(c => {
      const x = el.querySelector('.claudestate'), btns = el.querySelector('.claudebtns');
      if (!x) return;
      const when = iso => esc(fmtWhen(iso));
      x.textContent = '';
      x.innerHTML = c.connected ? `Connected${c.lastUsed ? `, last used ${when(c.lastUsed)}` : ', not used yet'}` : 'Not connected';
      btns.innerHTML = c.connected
        ? '<button class="setbtn" data-s="claude-connect" data-again="1">Make a new connector address…</button><button class="setbtn danger" data-s="claude-off">Switch Claude off</button>'
        : '<button class="setbtn" data-s="claude-connect">Connect Claude…</button>';
    }).catch(err => { const x = el.querySelector('.claudestate'); if (x) x.textContent = navigator.onLine ? err.message : 'Needs signal to check'; });
    if (store.signedIn()) store.serverStats().then(st => {
      const mb = b => (b / 1048576).toFixed(1) + ' MB';
      const x = el.querySelector('.stats');
      if (x) x.textContent = `${st.items} items (${mb(st.itemBytes)}), ${st.files} photos (${mb(st.fileBytes)})`;
    }).catch(err => { const x = el.querySelector('.stats'); if (x) x.textContent = err.message; });
  });
}

// Connecting Claude: the connector's address (with its key in it, shown this once) and where it goes.
function claudeSheet(url) {
  modal(`
    <div class="sethead"><button type="button" class="setdone" data-close>Done</button><h2>Connect Claude</h2></div>
    <p>Do this once, in Claude on the web (claude.ai, on a computer or in Safari). After that it works in every chat, in the Claude app on your phone too.</p>
    <ol class="steps">
      <li>Go to <b>Customize → Connectors</b> (claude.ai/customize/connectors).</li>
      <li>Tap <b>+ Add</b>, then <b>Add custom connector</b>.</li>
      <li>Call it <b>Brain Tree</b>, and paste this as the <b>MCP server URL</b>:
        <span class="copyrow"><input class="claudeurl" readonly value="${esc(url)}" aria-label="Connector address"><button type="button" class="setbtn" data-copy>Copy</button></span></li>
      <li>Tap <b>Continue</b>, choose <b>No sign in</b>, then <b>Continue</b> and <b>Add</b>.</li>
      <li>In a chat: <b>+</b> → <b>Connectors</b>, switch on <b>Brain Tree</b>, and say “block this out in Brain Tree”.</li>
    </ol>
    <p class="hint">Brain Tree shows this address only now, so copy it before you close this. Keep it to yourself: it works like a key. If it ever gets out, make a new one in Settings → Claude and the old one stops working.</p>`, el => {
    const input = el.querySelector('.claudeurl');
    el.querySelector('[data-copy]').addEventListener('click', async e => {
      try { await navigator.clipboard.writeText(url); e.target.textContent = 'Copied'; }
      catch (err) { input.focus(); input.select(); e.target.textContent = 'Selected: copy it'; }
    });
  });
}

// (0.8.1) An example project added before 0.8.0 has no recording: it gets the one new examples come
// with (once on each device, and only once this device has synced, so it doesn't undo one changed
// elsewhere; delete it and it stays gone).
function exampleRecUpgrade() {
  if (!(store.status.state === 'signedout' || store.status.lastSync > 0)) return;
  for (const p of I.live) {
    if (p.data.type !== 'project' || p.data.title !== EXAMPLE_TITLE || p.data.recs || store.get(p.id)?.data.recs) continue;
    const seen = 'bt-exrec:' + p.id;
    if (readLocal(seen, false)) continue;
    writeLocal(seen, true);
    const inside = I.descendants(p.id), ids = {};
    for (const [k, t] of Object.entries(EXAMPLE_REC_CARDS)) ids[k] = inside.find(r => r.data.title === t)?.id;
    if (Object.values(ids).every(Boolean)) store.update(p.id, { recs: [exampleRecording(ids)] });
  }
}

async function showExample() {
  const already = I.live.find(r => r.data.type === 'project' && r.data.title === EXAMPLE_TITLE);
  if (already && !confirm('There’s already an example project. Add another one?')) { go({ project: already.id, view: null, item: null }); return; }
  search = ''; $('#search').value = '';
  const id = await addExample(store, { makeLock, makePreview: (file, d) => makePreviewPhoto(file, d).catch(() => null) });
  go({ project: id, view: null, item: null });
  toast('Example project added. Open its board from the top of the list.');
}

function downloadBackup() {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `brain-tree-backup-${today()}.json`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Files, links, print and export ----------

// Hands a file over (share sheet on a phone, download on a computer). If the phone wants a fresh
// tap first (making the file took a moment), it offers a button for it.
async function deliver(blob, name) {
  const res = await ex.saveFile(blob, name);
  if (res === 'needs-tap') toast(`Ready: ${name}`, 'Share', () => ex.saveFile(blob, name));
  return res;
}

// A file in a note: open it (a new tab on a computer; on a phone, the share sheet's Quick Look,
// Files, Books… ), or save a copy.
async function openDoc(d) {
  const phone = matchMedia('(pointer: coarse)').matches;
  const viewable = /^(application\/pdf|image\/|text\/plain|audio\/|video\/)/.test(d.mime);
  const w = !phone && viewable ? window.open('', '_blank') : null;   // now, while the tap still counts
  const blob = await store.docBlob(d);
  if (!blob) { w?.close(); toast('That file isn’t on this device yet, and there’s no signal to fetch it.'); return; }
  if (w) { w.location.href = URL.createObjectURL(blob); return; }
  deliver(blob, d.name);
}
async function saveDoc(d) {
  const blob = await store.docBlob(d);
  if (!blob) { toast('That file isn’t on this device yet, and there’s no signal to fetch it.'); return; }
  deliver(blob, d.name);
}

// ---------- (0.7.9) Files as pictures on the board (see preview.js) ----------

// A file's picture, kept like a photo (so it syncs, and other devices just show it): {pv, pva}.
// src: the file, or one already open (from openDocument).
async function makePreviewPhoto(src, d, opts = {}) {
  const r = src?.render ? await pv.previewFrom(src, opts) : await pv.previewBlob(src, d, opts);
  if (!r) return null;
  return { pv: await store.addPhoto(r.blob), pva: r.aspect };
}
// A file kept, with its picture made straight away (if it's a kind that has one, and it doesn't
// take too long: it's still added if not, and the board makes one later).
async function addDocWithPreview(file) {
  const d = await store.addDoc(file);
  if (pv.previewKind(d)) {
    const p = await Promise.race([makePreviewPhoto(file, d).catch(() => null), new Promise(r => setTimeout(() => r(null), 12000))]);
    if (p) Object.assign(d, p);
  }
  return d;
}
// For a file with no picture of its own yet (added before there were pictures): one made on this
// device and kept here. One at a time, so a board full of files doesn't stall. A file that isn't
// on this device is fetched for it, unless it's big. Resolves with an address for it, or null.
const pvMade = new Map();
let pvQueue = Promise.resolve();
function docPreviewUrl(d) {
  if (!pv.previewKind(d)) return Promise.resolve(null);
  const k = [d.id, d.page || 1, d.crop || ''].join('|');
  if (!pvMade.has(k)) {
    const job = (async () => {
      const hit = await store.previewGet(k);
      if (hit) return URL.createObjectURL(hit);
      const made = pvQueue.then(async () => {
        if (!(await store.hasDoc(d.id)) && (d.size > 15 * 1048576 || !navigator.onLine)) return null;
        const blob = await store.docBlob(d);
        const r = blob && await pv.previewBlob(blob, d, { page: d.page, crop: d.crop });
        if (!r) return null;
        await store.previewPut(k, r.blob);
        return URL.createObjectURL(r.blob);
      });
      pvQueue = made.catch(() => null);
      return made;
    })().catch(() => null);
    pvMade.set(k, job);
    job.then(u => { if (!u) setTimeout(() => pvMade.delete(k), 60_000); });   // (try again in a while: it may have been offline)
  }
  return pvMade.get(k);
}

// How a file shows on the board: which page, just part of it (drag across it), or only its tile.
// Resolves with its new attributes for the note ({pv, pva, page, crop} or {pv: 'off'}), or null.
async function previewOptions(d) {
  const blob = await store.docBlob(d);
  if (!blob) { toast('That file isn’t on this device yet, and there’s no signal to fetch it.'); return null; }
  let doc = null;
  try { doc = await pv.openDocument(blob, d); } catch (e) { doc = null; }
  if (!doc) { toast(navigator.onLine ? 'Brain Tree can’t make a picture of that file, so it shows as a tile.' : 'You’re offline, and showing that kind of file needs a quick download the first time.'); return null; }
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (!settled) { settled = true; doc.close(); resolve(v); } };
    let page = Math.min(Math.max(1, d.page || 1), doc.pages), crop = pv.parseCrop(d.crop), shown = 0;
    modal(`
      <h2>How it shows on the board</h2>
      <p class="hint">Drag across it to pin up just that part${doc.pages > 1 ? ', and use the arrows to pick the page' : ''}. Tap it to go back to all of it.</p>
      <div class="pvpage"><canvas></canvas><i class="pvcrop" hidden></i></div>
      ${doc.pages > 1 ? '<div class="pvnav"><button data-pv="prev" aria-label="Page before">‹</button><span class="pvn"></span><button data-pv="next" aria-label="Next page">›</button></div>' : ''}
      <p class="cerr" role="alert"></p>
      <div class="mbtns"><button data-pv="tile">Just its tile</button><span class="grow"></span><button data-close>Cancel</button><button class="primary" data-pv="ok">Pin it up</button></div>`, el => {
      const box = el.querySelector('.pvpage'), cv = box.querySelector('canvas'), cr = box.querySelector('.pvcrop'), err = el.querySelector('.cerr');
      const showCrop = () => {
        cr.hidden = !crop;
        if (crop) Object.assign(cr.style, { left: crop.x * 100 + '%', top: crop.y * 100 + '%', width: crop.w * 100 + '%', height: crop.h * 100 + '%' });
      };
      const draw = async () => {
        const n = ++shown, w = Math.min(1600, Math.round(Math.max(280, el.clientWidth - 40) * (devicePixelRatio || 1)));
        try {
          const c = await doc.render(page, w);
          if (n !== shown) return;
          cv.width = c.width; cv.height = c.height;
          cv.getContext('2d').drawImage(c, 0, 0);
        } catch (e) { err.textContent = 'That page couldn’t be shown.'; }
        const pn = el.querySelector('.pvn');
        if (pn) pn.textContent = `Page ${page} of ${doc.pages}`;
      };
      draw(); showCrop();
      // Drag across the page for a snippet; drag the snippet to move it; a tap clears it.
      let drag = null;
      const at = e => { const r = cv.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
      box.addEventListener('pointerdown', e => {
        const p = at(e);
        try { box.setPointerCapture(e.pointerId); } catch (err) {}
        drag = crop && p.x > crop.x && p.x < crop.x + crop.w && p.y > crop.y && p.y < crop.y + crop.h ? { move: true, p, c: { ...crop }, moved: false } : { move: false, p, moved: false };
      });
      box.addEventListener('pointermove', e => {
        if (!drag) return;
        const p = at(e), dx = p.x - drag.p.x, dy = p.y - drag.p.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.01) drag.moved = true;
        if (!drag.moved) return;
        if (drag.move) crop = { ...drag.c, x: Math.min(1 - drag.c.w, Math.max(0, drag.c.x + dx)), y: Math.min(1 - drag.c.h, Math.max(0, drag.c.y + dy)) };
        else crop = { x: Math.min(p.x, drag.p.x), y: Math.min(p.y, drag.p.y), w: Math.abs(dx), h: Math.abs(dy) };
        showCrop();
      });
      const end = () => {
        if (!drag) return;
        if (!drag.moved || (crop && (crop.w < 0.04 || crop.h < 0.03))) crop = null;
        drag = null; showCrop();
      };
      box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-pv]');
        if (!b) return;
        const a = b.dataset.pv;
        if (a === 'prev' || a === 'next') { page = Math.min(doc.pages, Math.max(1, page + (a === 'next' ? 1 : -1))); draw(); return; }
        if (a === 'tile') { finish({ pv: 'off' }); closeModal(); return; }
        b.disabled = true; b.textContent = 'Pinning…';
        try {
          const p = await makePreviewPhoto(doc, d, { page, crop: pv.cropStr(crop) });
          if (!p) throw new Error('no picture');
          finish({ ...p, page: page > 1 ? page : undefined, crop: crop ? pv.cropStr(crop) : undefined });
          closeModal();
        } catch (e2) { b.disabled = false; b.textContent = 'Pin it up'; err.textContent = 'That couldn’t be made into a picture. Try again, or use just its tile.'; }
      });
    }, 'pvsheet');
    onModalClose = () => finish(null);
  });
}

// A link to a document or page: its address and (optionally) a name. Resolves with {url, title},
// 'remove', or null.
function linkModal(existing) {
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    modal(`
      <h2>${existing ? 'Change the link' : 'Link to a document or page'}</h2>
      <label class="field">Address<input class="lurl" type="url" inputmode="url" placeholder="Paste a link: Google Docs, OneDrive, Dropbox, any page" value="${existing ? esc(existing.url) : ''}" autocomplete="off"></label>
      <label class="field">Name (optional)<input class="ltitle" placeholder="What it is" value="${existing ? esc(existing.title || '') : ''}" maxlength="200" autocomplete="off"></label>
      <p class="hint lkind"></p>
      <p class="cerr" role="alert"></p>
      <div class="mbtns">${existing ? '<button class="danger" data-l="remove">Remove</button><span class="grow"></span>' : ''}<button data-close>Cancel</button><button class="primary" data-l="ok">${existing ? 'Save' : 'Add link'}</button></div>`, el => {
      const url = el.querySelector('.lurl'), title = el.querySelector('.ltitle'), kind = el.querySelector('.lkind'), err = el.querySelector('.cerr');
      const fix = v => { v = v.trim(); return v && !/^https?:\/\//i.test(v) ? 'https://' + v : v; };
      const show = () => { const u = fix(url.value); kind.textContent = /^https?:\/\/\S+\.\S+/.test(u) ? linkService(u).name : ''; };
      url.addEventListener('input', show); show();
      if (!existing) setTimeout(() => url.focus(), 30);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-l]');
        if (!b) return;
        if (b.dataset.l === 'remove') { finish('remove'); closeModal(); return; }
        const u = fix(url.value);
        if (!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(u)) { err.textContent = 'That doesn’t look like a web address.'; return; }
        finish({ url: u, title: title.value.trim() });
        closeModal();
      });
    });
    onModalClose = () => finish(null);
  });
}

// What a note says, as lines for an export: paragraphs, headings, list and checklist lines,
// spreadsheets as rows, and a line saying what any picture, clip, file or link is.
function noteLines(body) {
  if (!body) return [];
  const doc = new DOMParser().parseFromString('<body>' + body + '</body>', 'text/html');
  const out = [];
  const txt = el => el.textContent.replace(/\s+/g, ' ').trim();
  for (const el of doc.body.children) {
    const tag = el.tagName;
    if (el.matches('div[data-sheet]')) { const sh = cleanSheet(el.getAttribute('data-sheet')); if (sh) out.push({ t: 'rows', rows: sheetRows(sh), head: !!sh.h }); }
    else if (el.matches('div[data-yt]')) out.push({ t: 'p', text: `YouTube: ${el.getAttribute('data-title') || 'clip'} (youtu.be/${el.getAttribute('data-yt')})` });
    else if (el.matches('div[data-draw]')) out.push({ t: 'p', text: '(a drawing)' });
    else if (el.matches('div[data-doc]')) out.push({ t: 'p', text: `File: ${el.getAttribute('data-name') || 'file'}` });
    else if (el.matches('div[data-weblink]')) out.push({ t: 'p', text: `Link: ${el.getAttribute('data-title') ? el.getAttribute('data-title') + ' – ' : ''}${el.getAttribute('data-weblink')}` });
    else if (tag === 'UL' || tag === 'OL') for (const li of el.querySelectorAll(':scope > li')) { const t = txt(li); if (t) out.push(el.classList.contains('checklist') ? { t: 'check', text: t, done: li.getAttribute('data-checked') === 'true' } : { t: 'li', text: t }); }
    else if (/^H[1-3]$/.test(tag)) { const t = txt(el); if (t) out.push({ t: 'h', text: t }); }
    else {
      const t = txt(el);
      if (t) out.push({ t: 'p', text: t });
      else if (el.querySelector('img')) out.push({ t: 'p', text: '(a photo)' });
    }
  }
  return out;
}

// What goes into a printed or exported list: the project (or a section, or one of the lists like
// Today), grouped as on screen.
function exportDoc(ctx, { text = true, done = false } = {}) {
  const t = today();
  const whereOf = r => { const p = I.project(r), par = I.parentOf(r); return p ? titleOf(p) + (par && par.data.type === 'section' ? ' › ' + titleOf(par) : '') : ''; };
  const toItem = (r, where) => {
    const d = r.data;
    const it = { kind: d.type || 'note', title: titleOf(r), done: !!d.done, due: d.due || '', late: !d.done && !!d.due && d.due < t, where: where ? whereOf(r) : '' };
    it.dueText = d.due ? fmtDay(d.due) : d.start && d.start > t ? 'from ' + fmtDay(d.start) : '';
    if (d.type === 'project') { const { total, done: dn } = progress(r.id); if (total) it.dueText = `${dn}/${total}` + (it.dueText ? ' · ' + it.dueText : ''); }
    else it.steps = (I.kids.get(r.id) || []).filter(k => k.data.type === 'task' && (done || !k.data.done)).map(k => ({ title: titleOf(k), done: !!k.data.done }));
    if (text && d.type !== 'project') it.lines = noteLines(d.body);
    return it;
  };
  const stamp = 'Printed ' + new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  if (ctx.project || ctx.section) {
    const p = I.byId.get(ctx.project);
    const sec = ctx.section && I.byId.get(ctx.section);
    const kids = I.kids.get((sec || p).id) || [];
    const open = list => [
      ...list.filter(r => r.data.type === 'task' && !r.data.done).sort(byPinnedOrder),
      ...list.filter(r => r.data.type === 'project').sort(byPinnedOrder),
      ...list.filter(r => r.data.type === 'note').sort(byPinnedOrder),
    ];
    const sections = sec ? [] : kids.filter(r => r.data.type === 'section').sort(bySectionOrder);
    const groups = [{ name: '', items: open(kids).map(r => toItem(r)) }, ...sections.map(s => ({ name: titleOf(s), tone: 'section', items: open(I.kids.get(s.id) || []).map(r => toItem(r)) }))];
    if (done) groups.push({ name: 'Done', items: [...kids, ...sections.flatMap(s => I.kids.get(s.id) || [])].filter(r => r.data.type === 'task' && r.data.done).map(r => toItem(r)) });
    const { total, done: dn } = progress(p.id);
    const sub = [p.data.start || p.data.due ? `${p.data.start ? fmtDay(p.data.start) : '…'} → ${p.data.due ? fmtDay(p.data.due) : '…'}` : '', total ? `${dn} of ${total} done` : '', stamp].filter(Boolean).join(' · ');
    return { title: sec ? `${titleOf(p)} › ${titleOf(sec)}` : titleOf(p), sub, groups };
  }
  const v = ctx.view || 'today';
  const title = (SMART.find(s => s.id === v) || {}).name || 'Brain Tree';
  let groups = [];
  if (v === 'today') groups = todayGroups(I.live).filter(g => done || !g.done);
  else if (v === 'upcoming') groups = upcomingGroups(I.live);
  else if (v === 'inbox') { const loose = I.live.filter(r => !I.parentOf(r) && r.data.type !== 'project'); groups = [{ name: 'To-dos', items: loose.filter(r => r.data.type === 'task' && !r.data.done).sort(pinFirst(byDueThenOrder)) }, { name: 'Notes', items: loose.filter(r => r.data.type === 'note').sort(byPinnedUpdated) }]; }
  else if (v === 'todos') { const map = new Map(); for (const r of I.live.filter(x => x.data.type === 'task' && !x.data.done)) { const p = I.project(r), k = p ? titleOf(p) : ' No project'; if (!map.has(k)) map.set(k, []); map.get(k).push(r); } groups = [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([name, items]) => ({ name: name.trim(), items: items.sort(pinFirst(byDueThenOrder)) })); }
  else if (v === 'notes') groups = [{ name: '', items: I.live.filter(r => r.data.type === 'note').sort(byPinnedUpdated) }];
  else if (v === 'done-projects') groups = [{ name: '', items: I.live.filter(r => r.data.type === 'project' && r.data.done) }];
  const where = v !== 'todos';
  return { title, sub: stamp, groups: groups.map(g => ({ name: g.name, tone: g.late ? 'late' : '', items: g.items.map(r => toItem(r, where)) })) };
}

// Print or export: a list (as PDF, a print, Excel CSV or text) and, for a project, its board.
function exportSheet(ctx) {
  const p = ctx.project && I.byId.get(ctx.project);
  if (p && isLocked(p)) { toast('Unlock it first.'); return; }
  const name = p ? titleOf(p) + (ctx.section && I.byId.get(ctx.section) ? ' › ' + titleOf(I.byId.get(ctx.section)) : '') : (SMART.find(s => s.id === (ctx.view || 'today')) || {}).name || 'Brain Tree';
  modal(`
    <div class="exportsheet">
      <h2>Print or export</h2>
      <p class="hint">“${esc(name)}”</p>
      ${ctx.board ? '' : `<div class="egroup"><h3>The list</h3>
        <div class="echecks"><label><input type="checkbox" data-o="text" checked> What notes say</label><label><input type="checkbox" data-o="done"> Done to-dos</label></div>
        <div class="eopts">
          <button data-e="pdf"><b>PDF</b><small>A4, two columns, few pages</small></button>
          <button data-e="print"><b>Print</b><small>or save as PDF from there</small></button>
          <button data-e="csv"><b>Excel (CSV)</b><small>a row for each thing</small></button>
          <button data-e="text"><b>Text</b><small>copied, to paste anywhere</small></button>
        </div></div>`}
      ${p && !ctx.section ? `<div class="egroup"><h3>The board</h3>
        <div class="eopts">
          <button data-b="pdf"><b>PDF</b><small>the whole board on a page</small></button>
          <button data-b="png"><b>Picture (PNG)</b><small>sharp, to send or keep</small></button>
          <button data-b="svg"><b>SVG</b><small>scales to any size</small></button>
          <button data-b="print"><b>Print</b><small>on one page</small></button>
        </div></div>` : ''}
      <div class="mbtns"><button data-close>Close</button></div>
    </div>`, el => {
    el.addEventListener('click', async e => {
      const b = e.target.closest('[data-e], [data-b]');
      if (!b) return;
      const opt = k => el.querySelector(`[data-o="${k}"]`)?.checked;
      const opts = { text: opt('text') !== false, done: !!opt('done') };
      closeModal();
      try {
        if (b.dataset.e) {
          const doc = exportDoc(ctx, opts);
          if (b.dataset.e === 'pdf') await deliver(ex.listPDF(doc, { accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#C98A00' }), ex.fileName(doc.title, 'pdf'));
          else if (b.dataset.e === 'print') ex.printHTML(ex.listPrintHTML(doc));
          else if (b.dataset.e === 'csv') await deliver(new Blob([ex.listCSV(doc)], { type: 'text/csv' }), ex.fileName(doc.title, 'csv'));
          else if (b.dataset.e === 'text') {
            const txt = ex.listText(doc);
            let copied = false;
            try { await navigator.clipboard.writeText(txt); copied = true; } catch (err) {}
            toast(copied ? 'Copied as text.' : 'Ready as text.', 'Save as a file', () => deliver(new Blob([txt], { type: 'text/plain' }), ex.fileName(doc.title, 'txt')));
          }
        } else await exportBoard(p.id, b.dataset.b);
      } catch (err) { toast(err.message || String(err)); }
    });
  });
}

// The board as a PDF, picture, SVG or print. (It's drawn from the board itself, so it opens first.)
async function exportBoard(pid, how) {
  if (route.view !== 'board' || route.board !== pid) {
    go({ view: 'board', board: pid, project: null, item: null });
    await new Promise(r => setTimeout(r, 450));
  }
  if (!board || !document.querySelector('#board .cork')?.clientWidth) throw new Error('Open the board on this screen first.');
  toast('Making the board picture…');
  const { svg, w, h } = await board.exportSVG();
  const title = titleOf(I.byId.get(pid));
  if (how === 'svg') return deliver(new Blob([svg], { type: 'image/svg+xml' }), ex.fileName(title + ' board', 'svg'));
  if (how === 'print') return ex.printHTML(`<p class="ptitle">${esc(title)}</p>${svg}`, { landscape: w > h });
  // A picture as sharp as a phone can hold (canvases top out around 16 million pixels on an iPhone).
  const scale = Math.min(how === 'png' ? 2 : 1.6, Math.sqrt(15e6 / (w * h)), 8000 / Math.max(w, h));
  const canvas = await ex.svgToCanvas(svg, w, h, scale);
  if (how === 'png') return deliver(await ex.canvasBlob(canvas, 'image/png'), ex.fileName(title + ' board', 'png'));
  const jpeg = await ex.canvasBlob(canvas, 'image/jpeg', 0.9);
  return deliver(await ex.imagePDF(jpeg, canvas.width, canvas.height, title), ex.fileName(title + ' board', 'pdf'));
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

let onModalClose = null;   // told when the open modal goes away, however it's closed
function modal(html, setup, cls = '') {
  const was = onModalClose; onModalClose = null; was?.();
  const m = $('#modal');
  m.innerHTML = `<div class="sheet ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  m.hidden = false;
  setup?.(m.firstElementChild);
}
function closeModal() {
  $('#modal').hidden = true; $('#modal').innerHTML = '';
  const f = onModalClose; onModalClose = null; f?.();
}

// Add or change a YouTube clip: the link, then where it starts and ends. Resolves with the clip,
// 'remove', or null if you back out.
function clipModal(existing) {
  return new Promise(resolve => {
    let settled = false;
    const finish = v => { if (!settled) { settled = true; resolve(v); } };
    const c0 = existing || null;
    modal(`
      <h2>${c0 ? 'Change the clip' : 'Add a YouTube clip'}</h2>
      <label class="field">YouTube link<input class="curl" type="url" inputmode="url" placeholder="Paste a youtube.com or youtu.be link" value="${c0 ? esc(watchUrl(c0)) : ''}" autocomplete="off"></label>
      <div class="cprev" hidden><img alt=""><span></span></div>
      <div class="ctimes">
        <label class="field">Start<input class="cstart" inputmode="decimal" placeholder="0:00" value="${c0?.start ? fmtTime(c0.start) : ''}" autocomplete="off"></label>
        <label class="field">End<input class="cend" inputmode="decimal" placeholder="the end" value="${c0?.end ? fmtTime(c0.end) : ''}" autocomplete="off"></label>
      </div>
      <p class="hint">Times like 1:30 (or 1.30 on a phone keypad). Leave them empty for the whole video.</p>
      <p class="cerr" role="alert"></p>
      <div class="mbtns">${c0 ? '<button class="danger" data-c="remove">Remove</button><span class="grow"></span>' : ''}<button data-close>Cancel</button><button class="primary" data-c="ok">${c0 ? 'Save' : 'Add clip'}</button></div>`, el => {
      const url = el.querySelector('.curl'), st = el.querySelector('.cstart'), en = el.querySelector('.cend'), err = el.querySelector('.cerr'), prev = el.querySelector('.cprev');
      let title = c0?.title || '', shownId = c0?.id || null, lookup = null;
      const preview = () => {
        const c = parseYouTube(url.value);
        prev.hidden = !c;
        if (!c) return;
        prev.querySelector('img').src = thumbUrl(c.id);
        if (c.id !== shownId) {   // a new video: start where its link says, and look up its name
          shownId = c.id; title = '';
          if (c.start != null && !st.value) st.value = fmtTime(c.start);
        }
        prev.querySelector('span').textContent = title || 'Looking up its name…';
        if (!title) lookup = store.videoInfo(c.id).then(info => {
          if (shownId !== c.id) return;
          title = info?.title || '';
          prev.querySelector('span').textContent = title || 'YouTube video';
        });
      };
      url.addEventListener('input', preview);
      preview();
      if (!c0 && wide.matches) setTimeout(() => url.focus(), 30);
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-c]');
        if (!b) return;
        if (b.dataset.c === 'remove') { finish('remove'); closeModal(); return; }
        const c = parseYouTube(url.value);
        if (!c) { err.textContent = 'That doesn’t look like a YouTube link.'; return; }
        const s = parseTime(st.value), e2 = parseTime(en.value);
        if (Number.isNaN(s) || Number.isNaN(e2)) { err.textContent = 'Write times like 1:30, 1.30 or 90 (seconds).'; return; }
        if (s != null && e2 != null && e2 <= s) { err.textContent = 'The end needs to be after the start.'; return; }
        if (lookup && !title) { b.disabled = true; await Promise.race([lookup, new Promise(r => setTimeout(r, 3000))]); }
        finish({ id: c.id, start: s || null, end: e2 || null, title: title || '' });
        closeModal();
      });
    });
    onModalClose = () => finish(null);
  });
}

// A clip, big.
function videoModal(c) {
  const range = rangeText(c);
  modal(`
    <div class="vbig">${iframeHTML(c)}</div>
    <div class="vmeta"><b>${esc(c.title || 'YouTube video')}</b>${range ? `<span>${esc(range)}</span>` : ''}</div>
    <div class="mbtns"><a class="link" href="${esc(watchUrl(c))}" target="_blank" rel="noopener noreferrer">Open in YouTube ↗</a><span class="grow"></span><button data-close>Close</button></div>`, null, 'wide');
}

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
  if ((x = el('[data-cardsize]')) && editingId && route.board) {
    const r = store.get(editingId), s = +x.dataset.cardsize, cork = { ...(r.data.cork || {}) };
    const spot = { ...(cork[route.board] || {}) };
    if (s === 1) delete spot.s; else spot.s = s;
    if (Object.keys(spot).length) cork[route.board] = spot; else delete cork[route.board];
    store.update(editingId, { cork: Object.keys(cork).length ? cork : undefined });
    return;
  }
  if ((x = el('[data-untie]'))) {
    e.stopPropagation();
    const [from, to] = x.dataset.untie.split('|');
    const links = store.get(from)?.data.links || [];
    store.update(from, { links: links.filter(l => l.to !== to) });
    toast('String cut.', 'Undo', () => store.update(from, { links }));
    return;
  }
  if ((x = el('[data-unbranch]'))) {
    e.stopPropagation();
    const [from, to, c] = x.dataset.unbranch.split('|');
    const links = store.get(from)?.data.links || [];
    store.update(from, { links: links.map(l => {
      if (l.to !== to) return l;
      const y = { ...l, also: (l.also || []).filter(i => i !== c) };
      if (!y.also.length) delete y.also;
      return y;
    }) });
    toast('Taken off the string.', 'Undo', () => store.update(from, { links }));
    return;
  }
  if ((x = el('[data-done]'))) { const k = x.dataset.done; openDone.has(k) ? openDone.delete(k) : openDone.add(k); render(); return; }
  if ((x = el('[data-projtab]')) && route.project) {
    projTabs[route.project] = x.dataset.projtab;
    writeLocal('bt-projtab', projTabs);
    renderList();
    return;
  }
  if ((x = el('[data-toggle]'))) {
    e.stopPropagation();
    const id = x.dataset.toggle;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    writeLocal('bt-collapsed', [...collapsed]);
    renderNav();
    return;
  }
  if ((x = el('[data-project]'))) { search = ''; $('#search').value = ''; goProject(x.dataset.project); return; }
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
    else if (a === 'back-nav') { search = ''; findAll = false; $('#search').value = ''; go({ view: null, project: null, item: null }); }
    else if (a === 'find') { if (pfind.id === route.project) closeFind(); else openFind(); }
    else if (a === 'find-close') {
      if ($('#listFind').dataset.mode === 'project') closeFind();
      else { search = ''; findAll = false; $('#search').value = ''; render(); }
    }
    else if (a === 'find-everywhere') {
      const q = pfind.q; closeFind(false);
      search = q; $('#search').value = q; findAll = !wide.matches;
      render();
      if (findAll) $('#listFind input').focus(); else $('#search').focus();
    }
    else if (a === 'sync') store.signedIn() ? store.sync() : showLogin(true);
    else if (a === 'login') showLogin(true);
    else if (a === 'settings') settingsModal();
    else if (a === 'new') newMenu(route.project || undefined);
    else if (a === 'new-project') { const pid = await newItem('project', null); go({ project: pid, view: null, item: pid }); }
    else if (a === 'example') showExample();
    else if (a === 'lock-now') lockNow(x.dataset.id);
    else if (a === 'lock-forgot') forgotSheet(x.dataset.id);
    else if (a === 'export-list') exportSheet({ project: route.project && !search ? route.project : null, view: route.project ? null : route.view || 'today' });
    else if (a === 'export-board') exportSheet({ project: route.board, board: true });
    else if (a === 'empty-trash') { if (confirm(`Delete all ${I.trashed.length} item(s) in Recently deleted for good, on every device?`)) purge(I.trashed.map(r => r.id)); }
    else if (a === 'board-list') { rememberView(route.board, 'list'); go(route.board ? { view: null, project: route.board, item: null } : { view: 'today', item: null }); }
    else if (a === 'open-board' && route.project) { rememberView(route.project, 'board'); go({ view: 'board', board: route.project, project: null, item: null }); }
    else if (id && a === 'board') {
      const r = I.byId.get(id), bp = r && (r.data.type === 'project' ? r : I.project(r));
      if (bp) { rememberView(bp.id, 'board'); go({ view: 'board', board: bp.id, project: null, item: null }); }
    }
    else if (id && a === 'tie') {
      const links = store.get(id)?.data.links || [];
      pickItem({ title: 'Tie a string to…', exclude: new Set([id, ...links.map(l => l.to)]), onPick: to => store.update(id, { links: [...(store.get(id)?.data.links || []), { to }] }) });
    }
    else if (id && a === 'tick') toggleDone(id);
    else if (id && a === 'pin') togglePin(id);
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
  // On a keyboard: N adds a to-do, / searches (when you're not typing somewhere).
  const typing = e.target.closest?.('input, textarea, select, [contenteditable]');
  // (0.8.1) / on a board: Find on this board
  if (!typing && e.key === '/' && $('#modal').hidden && !e.ctrlKey && !e.metaKey && document.body.dataset.view === 'board' && board?.find) { e.preventDefault(); board.find(); return; }
  if (!typing && $('#modal').hidden && !e.ctrlKey && !e.metaKey && !e.altKey && document.body.dataset.view !== 'board') {
    if (e.key === '/') { e.preventDefault(); if (!$('#findBtn').hidden && $('#list').offsetParent) openFind(); else $('#search').focus(); return; }
    if (e.key === 'n' || e.key === 'N') {
      const qa = $('#quickAdd input');
      if (qa && !$('#quickAdd').hidden && qa.offsetParent) { e.preventDefault(); qa.focus(); return; }
    }
  }
  const row = e.target.closest?.('.row[data-open]');
  if (row && (e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openItem(row.dataset.open); }
});

// Quick add: the list's box, and the ones inside an open item.
document.addEventListener('submit', async e => {
  const form = e.target;
  if (form.classList.contains('lockpanel')) { e.preventDefault(); tryUnlock(form); return; }
  if (form.id === 'quickAdd') {
    e.preventDefault();
    const input = form.querySelector('input'), typed = input.value.trim();
    if (!typed) return;
    input.value = '';
    const type = route.view === 'notes' && !route.project ? 'note' : 'task';
    if (type === 'note') { openItem(await newItem('note', undefined, { title: typed })); return; }
    // In a project's Today or Upcoming tab, new to-dos are for today or tomorrow (unless you typed a date).
    const tab = route.project && !search ? projTab(route.project) : 'all';
    const { title, due } = quickDate(typed);
    const extra = { title, ...(due ? { due } : tab === 'today' ? { due: today() } : tab === 'upcoming' ? { due: addDays(today(), 1) } : {}) };
    const id = await newItem('task', undefined, extra);
    if (due) dateToast(id, typed, due);
  } else if (form.classList.contains('quick')) {
    e.preventDefault();
    const input = form.querySelector('input'), typed = input.value.trim();
    if (!typed) return;
    input.value = '';
    const { title, due } = quickDate(typed);
    const id = await newItem('task', form.dataset.parent, { title, ...(due ? { due } : {}) });
    if (due) dateToast(id, typed, due);
    requestAnimationFrame(() => $(`#detail form.quick[data-parent="${form.dataset.parent}"] input`)?.focus());
  }
});

// "Bins out tomorrow" became "Bins out", due tomorrow: say so, with a way back if that word wasn't a date.
function dateToast(id, typed, due) {
  toast(`Due ${fmtDay(due)}`, 'Not a date', () => store.update(id, { title: typed, due: undefined }));
}

$('#search').addEventListener('input', e => {
  search = e.target.value.trim();
  render();
});
// (0.8.1) On a phone the side panel goes out of sight once there are results, so tapping its box
// opens the search page, which has a box of its own.
const phoneSearch = () => { $('#search').readOnly = !wide.matches; };
phoneSearch();
wide.addEventListener('change', phoneSearch);
$('#search').addEventListener('click', () => { if (!wide.matches) openFindAll(); });
$('#listFind input').addEventListener('input', e => {
  const v = e.target.value.trim();
  if ($('#listFind').dataset.mode === 'project') pfind.q = v;
  else { search = v; $('#search').value = e.target.value; }
  render();
});
$('#listFind input').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('#listFind [data-act=find-close]').click(); }
  else if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
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

// For testing on this computer (the local test server) only.
if (['127.0.0.1', 'localhost'].includes(location.hostname)) window.btApp = { get board() { return board; }, exportDoc, exportBoard, unlocked };

(async function start() {
  $('#nav .brand').insertAdjacentHTML('beforeend', `<button class="iconbtn" data-act="settings" aria-label="Settings">${ICON.gear}</button>`);
  $('#newProject').innerHTML = ICON.plus;
  $('#newBtn').innerHTML = ICON.plus;
  $('#setBtn').innerHTML = ICON.gear;
  $('#boardBtn').innerHTML = ICON.board + '<span>Board</span>';
  $('#exportBtn').innerHTML = ICON.share;
  $('#findBtn').innerHTML = ICON.search;
  $('#listFind').insertAdjacentHTML('afterbegin', ICON.search);
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
  store.onChange(() => { try { exampleRecUpgrade(); } catch (e) {} });
  try { exampleRecUpgrade(); } catch (e) {}
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
