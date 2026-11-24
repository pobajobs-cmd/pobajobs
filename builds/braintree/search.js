// (0.8.1) Search: the words you type, in any order, anywhere in a thing: its title, its text, its
// checklist, the cells of a spreadsheet in it, the names of files in it, the titles of clips and
// links in it, and the labels on its strings. Capitals and accents don't matter ("cafe" finds
// "Café"), and "quotes" keep words together. Used by the search box (everywhere), a project's own
// search, and Find on a board.

import { textOf } from './editor.js';
import { sheetRows } from './sheet.js';

// Lower case, no accents. (Each letter stays one letter, so places found in this match the original.)
export const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC').toLowerCase();

// The words to look for: ['three', 'hearts'] from 'Three hearts'; ['three hearts'] from '"three hearts"'.
export function terms(q) {
  const out = [];
  String(q || '').replace(/"([^"]+)"?|(\S+)/g, (_, phrase, word) => { const t = fold((phrase || word).trim()); if (t) out.push(t); });
  return [...new Set(out)];
}

const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attrs = (html, name) => [...html.matchAll(new RegExp(`\\b${name}="([^"]*)"`, 'g'))].map(m => decode(m[1]));

// Everything searchable in a thing besides its title, as plain text. Kept until the thing changes.
const memo = new Map();
export function textFor(r) {
  const d = r.data || {}, body = d.body || '';
  const stamp = (d.updated || '') + '|' + body.length + '|' + (d.links || []).length;
  const hit = memo.get(r.id);
  if (hit && hit.stamp === stamp) return hit.text;
  const bits = [textOf(body)];
  if (/data-(name|title|weblink|sheet)=/.test(body)) {
    bits.push(...attrs(body, 'data-name'), ...attrs(body, 'data-title'));
    for (const u of attrs(body, 'data-weblink')) { try { bits.push(new URL(u).hostname.replace(/^www\./, '')); } catch (e) {} }
    for (const m of body.matchAll(/data-sheet='([^']*)'/g)) {
      try { bits.push(sheetRows(JSON.parse(decode(m[1]))).map(row => row.join(' ')).join(' · ')); } catch (e) {}
    }
  }
  for (const l of d.links || []) if (l.label) bits.push(l.label);
  const text = bits.filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim();
  memo.set(r.id, { stamp, text });
  if (memo.size > 5000) memo.delete(memo.keys().next().value);
  return text;
}

// Does this thing match? Gives back how well (higher is better) and where the words were found, or
// null. title: the title as shown.
export function matchItem(r, title, ts) {
  if (!ts.length) return null;
  const t = fold(title), x = fold(textFor(r));
  let score = 0, inText = false;
  for (const w of ts) {
    const i = t.indexOf(w);
    if (i >= 0) { score += 10 + (i === 0 ? 4 : /\W/.test(t[i - 1]) ? 2 : 0) + (t.length === w.length ? 6 : 0); continue; }
    const j = x.indexOf(w);
    if (j < 0) return null;
    score += 3 + (j === 0 || /\W/.test(x[j - 1]) ? 1 : 0);
    inText = true;
  }
  return { score, inText };
}

// Text with the words picked out (<mark>), safe to put in a page.
export function markHTML(text, ts, esc) {
  text = String(text || '');
  const f = fold(text), spans = [];
  for (const w of ts) { let i = f.indexOf(w); while (i >= 0 && spans.length < 40) { spans.push([i, i + w.length]); i = f.indexOf(w, i + w.length); } }
  if (!spans.length) return esc(text);
  spans.sort((a, b) => a[0] - b[0]);
  let out = '', at = 0;
  for (const [a, b] of spans) {
    if (b <= at) continue;
    const s = Math.max(a, at);
    out += esc(text.slice(at, s)) + '<mark>' + esc(text.slice(s, b)) + '</mark>';
    at = b;
  }
  return out + esc(text.slice(at));
}

// A short bit of a thing's text around the first word found in it, picked out.
export function snippetHTML(r, ts, esc, size = 90) {
  const text = textFor(r), f = fold(text);
  // around the words together if they're there together, else the longest of them
  let first = -1;
  for (const w of [ts.join(' '), ...[...ts].sort((x, y) => y.length - x.length)]) { first = f.indexOf(w); if (first >= 0) break; }
  if (first < 0) return '';
  let a = Math.max(0, first - Math.round(size * 0.35)), b = Math.min(text.length, a + size);
  if (a > 0) { const sp = text.indexOf(' ', a); if (sp > 0 && sp < first) a = sp + 1; }
  if (b < text.length) { const sp = text.lastIndexOf(' ', b); if (sp > first) b = sp; }
  return (a > 0 ? '… ' : '') + markHTML(text.slice(a, b), ts, esc) + (b < text.length ? ' …' : '');
}
