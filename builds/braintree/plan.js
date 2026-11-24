// (0.9.0) Planning helpers shared by the lists, the board and the timeline:
//  - Waiting on: a string with an arrow from an unfinished to-do (or project) into a to-do means
//    that to-do waits for it. It shows faded, stays out of Today, and lights up when the first is done.
//  - Tags: #words in a title or a note's text (#shopping, #call). Tap one in the sidebar to see them all.
//  - Costs: a to-do's price (data.cost, in pounds) adds up per section and project, against an
//    optional project budget (data.budget). "£12.50" typed in a new to-do sets it.

import { textFor } from './search.js';

// ----- Waiting on -----

// Map of to-do id → ids of the unfinished things it waits for.
export function waitMap(I) {
  const m = new Map();
  const open = x => (x.data.type === 'task' || x.data.type === 'project') && !x.data.done;
  const add = (blocked, by) => {
    if (!blocked || !by || blocked === by) return;
    const b = I.byId.get(blocked), x = I.byId.get(by);
    if (!b || !x || !I.alive(b) || !I.alive(x) || b.data.type !== 'task' || b.data.done || !open(x)) return;
    // (not on something it's inside, or inside it: that would never come free)
    if (I.ancestors(b).some(a => a.id === by) || I.ancestors(x).some(a => a.id === blocked)) return;
    if (!m.has(blocked)) m.set(blocked, []);
    if (!m.get(blocked).includes(by)) m.get(blocked).push(by);
  };
  for (const x of I.live) for (const l of x.data.links || []) {
    // 'to': the arrow goes from this one to the other (and to any branches); 'from': back to this one.
    if (l.dir === 'to') { add(l.to, x.id); for (const c of l.also || []) add(c, x.id); }
    else if (l.dir === 'from') add(x.id, l.to);
  }
  return m;
}

// ----- Tags -----

const TAG_RE = /(^|[\s(,;])#([\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*)/gu;
export const tagKey = s => String(s || '').replace(/^#/, '').toLowerCase().normalize('NFC');
const tagMemo = new Map();
export function tagsOf(r) {
  const text = (r.data.title || '') + ' ' + textFor(r);
  const hit = tagMemo.get(r.id);
  if (hit && hit.text === text) return hit.tags;
  const tags = [...new Set([...text.matchAll(TAG_RE)].map(m => tagKey(m[2])))].slice(0, 30);
  tagMemo.set(r.id, { text, tags });
  if (tagMemo.size > 5000) tagMemo.delete(tagMemo.keys().next().value);
  return tags;
}
// Every tag in use, most used first: [[tag, count], …]
export function allTags(pool) {
  const n = new Map();
  for (const r of pool) for (const t of tagsOf(r)) n.set(t, (n.get(t) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
// Already-escaped title text with its #tags as little chips.
export const tagChips = html => html.replace(/(^|[\s(,;])#([\p{L}\p{N}_-]*\p{L}[\p{L}\p{N}_-]*)/gu, (m, pre, t) => `${pre}<span class="tag">#${t}</span>`);

// ----- Costs -----

export function money(n) {
  const v = Math.round((+n || 0) * 100) / 100;
  return (v < 0 ? '−£' : '£') + Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
// "Bearings £12.50" → { title: 'Bearings', cost: 12.5 }
export function quickCost(text) {
  const m = /(^|\s)£\s?(\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.(\d{1,2}))?(?=\s|$)/.exec(text);
  if (!m) return { title: text, cost: null };
  const cost = Number(m[2].replace(/,/g, '') + (m[3] ? '.' + m[3] : ''));
  const title = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim();
  return title ? { title, cost } : { title: text, cost: null };
}
// What the to-dos in something add up to: planned (all of them) and spent (the ticked ones).
export function costOf(I, id) {
  let planned = 0, spent = 0, n = 0;
  for (const r of I.descendants(id)) {
    const c = +r.data.cost;
    if (r.data.type !== 'task' || !c) continue;
    n++; planned += c; if (r.data.done) spent += c;
  }
  return { planned, spent, n };
}
