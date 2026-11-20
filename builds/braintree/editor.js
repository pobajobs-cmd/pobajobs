// The note editor: a contenteditable box with a small toolbar (headings, lists, checklists,
// links, photos, YouTube clips, drawings). Notes are saved as cleaned-up HTML:
//   photos    <img data-file="id">, the picture comes from this device's store when shown
//   clips     <div data-yt="VIDEO_ID" data-start data-end data-title></div>  (see media.js)
//   drawings  <div data-draw='{…}'></div>  (see draw.js)
//   sheets    <div data-sheet='{…}'></div>  (see sheet.js)
//   files     <div data-doc="id" data-name data-size data-mime data-parts></div>  (any kind of file, see store.addDoc)
//   links     <div data-weblink="https://…" data-title></div>  (a document or page elsewhere, shown as a tile)
// These are saved empty; what you see inside them is filled in when shown.

import { parseYouTube, clipOf, writeClip, clipFaceHTML, iframeHTML, isVideoId } from './media.js';
import { cleanDrawing, drawingSVG } from './draw.js';
import { cleanSheet, sheetTableHTML } from './sheet.js';
import { docInfo, linkInfo, docTileHTML, linkTileHTML, writeDoc, writeLink } from './attach.js';

const ALLOWED = {
  P: [], DIV: ['data-yt', 'data-start', 'data-end', 'data-title', 'data-draw', 'data-sheet', 'data-doc', 'data-name', 'data-size', 'data-mime', 'data-parts', 'data-weblink'], BR: [], STRONG: [], B: [], EM: [], I: [], U: [], S: [], STRIKE: [],
  H1: [], H2: [], H3: [], UL: ['class'], OL: [], LI: ['data-checked'], BLOCKQUOTE: [], PRE: [], CODE: [], HR: [],
  A: ['href'], IMG: ['data-file', 'src', 'alt'],
};
// Blocks that hold something other than text, and the attributes each keeps.
const EMBEDS = ['data-yt', 'data-draw', 'data-sheet', 'data-doc', 'data-weblink'];
const KEEP = { 'data-yt': ['data-yt', 'data-start', 'data-end', 'data-title'], 'data-draw': ['data-draw'], 'data-sheet': ['data-sheet'], 'data-doc': ['data-doc', 'data-name', 'data-size', 'data-mime', 'data-parts'], 'data-weblink': ['data-weblink', 'data-title'] };
const EMBED_ATTRS = ['data-yt', 'data-start', 'data-end', 'data-title', 'data-draw', 'data-sheet', 'data-doc', 'data-name', 'data-size', 'data-mime', 'data-parts', 'data-weblink'];
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'NOSCRIPT', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'HEAD', 'TITLE', 'META', 'LINK']);

export function sanitize(html) {
  const doc = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
  clean(doc.body);
  return doc.body.innerHTML;
}

function clean(node) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) { child.remove(); continue; }
    const tag = child.tagName;
    if (DROP.has(tag)) { child.remove(); continue; }
    if (!ALLOWED[tag]) { clean(child); child.replaceWith(...child.childNodes); continue; }
    for (const attr of [...child.attributes]) {
      if (!ALLOWED[tag].includes(attr.name)) child.removeAttribute(attr.name);
    }
    if (tag === 'A') {
      const href = child.getAttribute('href') || '';
      if (!/^(https?:|mailto:|tel:)/i.test(href)) child.removeAttribute('href');
    }
    if (tag === 'IMG') {
      const src = child.getAttribute('src') || '';
      if (child.hasAttribute('data-file')) child.removeAttribute('src');
      else if (!/^https:\/\//i.test(src)) { child.remove(); continue; }
    }
    if (tag === 'UL' && child.getAttribute('class') !== 'checklist') child.removeAttribute('class');
    if (tag === 'LI' && child.getAttribute('data-checked') !== 'true') child.removeAttribute('data-checked');
    if (tag === 'DIV' && EMBEDS.some(a => child.hasAttribute(a))) {
      // A clip, drawing, sheet, file or link: check what it holds, and keep it empty (its insides are only for show).
      const kind = EMBEDS.find(a => child.hasAttribute(a));
      for (const a of EMBED_ATTRS) if (!(KEEP[kind] || []).includes(a)) child.removeAttribute(a);
      if (kind === 'data-sheet') {
        const sh = cleanSheet(child.getAttribute('data-sheet'));
        if (!sh) { child.remove(); continue; }
        child.setAttribute('data-sheet', JSON.stringify(sh));
      } else if (kind === 'data-doc') {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(child.getAttribute('data-doc'))) { child.remove(); continue; }
        child.setAttribute('data-name', (child.getAttribute('data-name') || 'File').slice(0, 200));
        for (const a of ['data-size', 'data-parts']) if (!/^\d{1,9}$/.test(child.getAttribute(a) || '')) child.removeAttribute(a);
        if (!/^[\w.+-]{1,60}\/[\w.+-]{1,80}$/.test(child.getAttribute('data-mime') || '')) child.setAttribute('data-mime', 'application/octet-stream');
      } else if (kind === 'data-weblink') {
        if (!/^https?:\/\/\S{3,2000}$/i.test(child.getAttribute('data-weblink') || '')) { child.remove(); continue; }
        if (child.hasAttribute('data-title')) child.setAttribute('data-title', child.getAttribute('data-title').slice(0, 200));
      } else if (kind === 'data-yt') {
        if (!isVideoId(child.getAttribute('data-yt'))) { child.remove(); continue; }
        for (const a of ['data-start', 'data-end']) if (!/^\d{1,6}$/.test(child.getAttribute(a) || '')) child.removeAttribute(a);
        if (child.hasAttribute('data-title')) child.setAttribute('data-title', child.getAttribute('data-title').slice(0, 200));
        child.removeAttribute('data-draw');
      } else {
        const dr = cleanDrawing(child.getAttribute('data-draw'));
        if (!dr) { child.remove(); continue; }
        child.setAttribute('data-draw', JSON.stringify(dr));
      }
      child.replaceChildren();
      continue;
    }
    for (const a of EMBED_ATTRS) child.removeAttribute(a);
    clean(child);
  }
}

// Plain text from note HTML (for list previews and search).
export function textOf(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString('<body>' + html.replace(/<(\/p|\/div|\/li|\/h[1-3]|br)\b[^>]*>/gi, '$& ') + '</body>', 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}

export function firstPhoto(html) {
  const m = /data-file="([A-Za-z0-9_-]+)"/.exec(html || '');
  return m ? m[1] : null;
}

// For lists: what a note holds besides text ("▶ Video title", "Drawing").
export function mediaSummary(html) {
  if (!html) return '';
  const clip = /<div[^>]*data-yt="[^"]+"[^>]*>/.exec(html);
  if (clip) { const t = /data-title="([^"]*)"/.exec(clip[0]); return '▶ ' + (t ? decode(t[1]) : 'YouTube clip'); }
  if (/data-draw=/.test(html)) return 'Drawing';
  if (/data-sheet=/.test(html)) return 'Spreadsheet';
  const doc = /<div[^>]*data-doc="[^"]+"[^>]*>/.exec(html);
  if (doc) { const n = /data-name="([^"]*)"/.exec(doc[0]); return 'File: ' + (n ? decode(n[1]) : 'file'); }
  const wl = /<div[^>]*data-weblink="([^"]+)"[^>]*>/.exec(html);
  if (wl) { const t = /data-title="([^"]*)"/.exec(wl[0]); return 'Link: ' + (t && t[1] ? decode(t[1]) : decode(wl[1]).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]); }
  if (/data-file=/.test(html)) return 'Photo';
  return '';
}
function decode(s) { const t = document.createElement('textarea'); t.innerHTML = s; return t.value; }

const ICONS = {
  h: '<svg viewBox="0 0 24 24"><path d="M5 5v14M15 5v14M5 12h10"/><path d="M19 19v-6l-2 1.5"/></svg>',
  bold: '<svg viewBox="0 0 24 24"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/></svg>',
  italic: '<svg viewBox="0 0 24 24"><path d="M10 5h8M6 19h8M14 5l-4 14"/></svg>',
  strike: '<svg viewBox="0 0 24 24"><path d="M4 12h16M16 7a4 3 0 0 0-8 0c0 4 8 3 8 7a4 3 0 0 1-8 1"/></svg>',
  ul: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  ol: '<svg viewBox="0 0 24 24"><path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5a1.5 1.5 0 1 1 2.5 1L3.5 19h3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="6" height="6" rx="1.5"/><path d="M4.5 16.5l1.5 1.5 3-3.5M12 7h9M12 17h9"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  photo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="M10 9v6l5-3z"/></svg>',
  draw: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="5" rx="1"/><circle cx="17" cy="17" r="3.5"/><path d="M6.5 9v4.5a3 3 0 0 0 3 3H13"/><path d="M15 4l5 5"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/></svg>',
  attach: '<svg viewBox="0 0 24 24"><path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.6 1.6 0 0 1-2.3-2.3L15 7.3"/></svg>',
};

// One page-wide listener; only the open editor (there's one at a time) is told.
let onSelection = null, closePops = null;
document.addEventListener('selectionchange', () => onSelection?.());
document.addEventListener('pointerdown', e => closePops?.(e), true);

// onClip(clip?), onDraw(drawing?), onSheet(sheet?) and onLink(link?) ask for a new or changed one (null =
// cancelled, 'remove' = take it out); videoInfo(id) looks up a video's title. addDoc(file) keeps a file and
// says what it is; openDoc(info) / saveDoc(info) open or save a copy of one.
export function createEditor(host, { onChange, resolveFile, addPhoto, onError, onImage, onClip, onDraw, videoInfo, onSheet, onLink, addDoc, openDoc, saveDoc }) {
  host.innerHTML = `
    <div class="tools" role="toolbar" aria-label="Formatting">
      <button type="button" data-cmd="h" title="Heading">${ICONS.h}</button>
      <button type="button" data-cmd="bold" title="Bold (Ctrl+B)">${ICONS.bold}</button>
      <button type="button" data-cmd="italic" title="Italic (Ctrl+I)">${ICONS.italic}</button>
      <button type="button" data-cmd="strike" title="Strikethrough">${ICONS.strike}</button>
      <span class="sep"></span>
      <button type="button" data-cmd="check" title="Checklist">${ICONS.check}</button>
      <button type="button" data-cmd="ul" title="Bullets">${ICONS.ul}</button>
      <button type="button" data-cmd="ol" title="Numbered list">${ICONS.ol}</button>
      <span class="sep"></span>
      <button type="button" data-cmd="link" title="Link">${ICONS.link}</button>
      <button type="button" data-cmd="photo" title="Add photo">${ICONS.photo}</button>
      <button type="button" data-cmd="clip" title="Add a YouTube clip">${ICONS.clip}</button>
      <button type="button" data-cmd="draw" title="Add a drawing">${ICONS.draw}</button>
      <button type="button" data-cmd="sheet" title="Add a spreadsheet">${ICONS.sheet}</button>
      <button type="button" data-cmd="attach" title="Attach a file, or link to a document">${ICONS.attach}</button>
      <input type="file" accept="image/*" multiple hidden>
      <input type="file" class="anyfile" multiple hidden>
    </div>
    <div class="body" contenteditable="true" spellcheck="true" data-placeholder="Write anything: notes, links, photos, clips, drawings, checklists…"></div>
    <div class="linkpop" hidden><a target="_blank" rel="noopener noreferrer">Open link ↗</a></div>
    <div class="blockpop" hidden></div>`;
  const tools = host.querySelector('.tools');
  const body = host.querySelector('.body');
  const fileInput = host.querySelector('input[type=file]:not(.anyfile)'), anyFile = host.querySelector('input.anyfile');
  const blockpop = host.querySelector('.blockpop');
  const linkpop = host.querySelector('.linkpop');
  let saved = null, timer = null, loading = false;

  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

  const changed = () => {
    if (loading) return;
    clearTimeout(timer);
    timer = setTimeout(() => onChange(getHTML()), 500);
  };
  const flush = () => { if (timer) { clearTimeout(timer); timer = null; onChange(getHTML()); } };

  // Keep the caret position so toolbar taps (which can steal focus on phones) act in the right place.
  onSelection = () => {
    const sel = getSelection();
    if (sel.rangeCount && body.contains(sel.anchorNode)) saved = sel.getRangeAt(0).cloneRange();
  };
  function restore() {
    body.focus({ preventScroll: true });
    if (saved) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(saved); }
  }

  tools.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
  tools.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'photo') { fileInput.click(); return; }
    if (cmd === 'clip') { addClip(); return; }
    if (cmd === 'draw') { addDrawing(); return; }
    if (cmd === 'sheet') { addSheet(); return; }
    if (cmd === 'attach') { showPop(btn, [['file', 'A file from this device'], ['link', 'A link to a document or web page']], a => (a === 'file' ? anyFile.click() : addLink2())); return; }
    restore();
    if (cmd === 'h') document.execCommand('formatBlock', false, currentBlock()?.tagName === 'H2' ? 'p' : 'h2');
    else if (cmd === 'bold') document.execCommand('bold');
    else if (cmd === 'italic') document.execCommand('italic');
    else if (cmd === 'strike') document.execCommand('strikeThrough');
    else if (cmd === 'ul' || cmd === 'ol') {
      const list = currentList();
      if (cmd === 'ul' && list?.classList.contains('checklist')) list.classList.remove('checklist');
      else document.execCommand(cmd === 'ul' ? 'insertUnorderedList' : 'insertOrderedList');
    } else if (cmd === 'check') toggleChecklist();
    else if (cmd === 'link') addLink();
    changed();
    updateTools();
  });

  function currentBlock() {
    let n = getSelection().anchorNode;
    while (n && n !== body) { if (n.nodeType === 1 && /^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE|PRE)$/.test(n.tagName)) return n; n = n.parentNode; }
    return null;
  }
  function currentList() {
    let n = getSelection().anchorNode;
    while (n && n !== body) { if (n.nodeType === 1 && (n.tagName === 'UL' || n.tagName === 'OL')) return n; n = n.parentNode; }
    return null;
  }
  function toggleChecklist() {
    let list = currentList();
    if (list && list.classList.contains('checklist')) { document.execCommand('insertUnorderedList'); return; }
    if (!list || list.tagName !== 'UL') document.execCommand('insertUnorderedList');
    list = currentList();
    if (list) list.className = 'checklist';
  }
  function addLink() {
    const sel = getSelection();
    const text = sel.toString();
    let url = prompt('Link address', /^https?:\/\//.test(text) ? text : 'https://');
    if (!url || url === 'https://') return;
    if (!/^(https?:|mailto:|tel:)/i.test(url)) url = 'https://' + url;
    restore();
    if (sel.isCollapsed || !text) document.execCommand('insertHTML', false, `<a href="${escAttr(url)}">${escHtml(url)}</a>&nbsp;`);
    else document.execCommand('createLink', false, url);
  }
  function updateTools() {
    const list = currentList();
    const set = (cmd, on) => tools.querySelector(`[data-cmd="${cmd}"]`).classList.toggle('on', !!on);
    let state = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
    set('bold', state('bold')); set('italic', state('italic')); set('strike', state('strikeThrough'));
    set('h', currentBlock()?.tagName === 'H2');
    set('check', list?.classList.contains('checklist'));
    set('ul', list?.tagName === 'UL' && !list.classList.contains('checklist'));
    set('ol', list?.tagName === 'OL');
  }
  body.addEventListener('keyup', updateTools);
  body.addEventListener('mouseup', updateTools);

  // Any kind of file: photos go in as photos, everything else as a file tile.
  anyFile.addEventListener('change', async () => {
    const files = [...anyFile.files];
    anyFile.value = '';
    for (const f of files) {
      if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) { await insertPhoto(f); continue; }
      try {
        const d = await addDoc(f);
        const div = document.createElement('div');
        writeDoc(div, d);
        insertBlock(div);
        flush();
      } catch (e) { onError(e.message || String(e)); }
    }
  });

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];
    fileInput.value = '';
    for (const f of files) await insertPhoto(f);
  });

  // Photos, clips and drawings go in as their own block, after the line the caret is on (or at
  // the end), with an empty line after them to carry on typing.
  function insertBlock(el) {
    let block = saved && body.contains(saved.startContainer) ? saved.startContainer : null;
    while (block && block.parentNode !== body) block = block.parentNode;
    if (block && !block.textContent.trim() && !block.querySelector('img, div') && block.matches('p')) block.replaceWith(el);   // an empty line: use it
    else if (block) block.after(el); else body.append(el);
    let next = el.nextElementSibling;
    if (!next || !next.matches('p')) { next = document.createElement('p'); next.innerHTML = '<br>'; el.after(next); }
    const r = document.createRange();
    r.setStart(next, 0); r.collapse(true);
    saved = r;
    if (document.activeElement === body) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
    hydrate();
    changed();
  }

  async function insertPhoto(file) {
    try {
      const id = await addPhoto(file);
      const p = document.createElement('p');
      const img = document.createElement('img');
      img.dataset.file = id; img.alt = '';
      p.append(img);
      insertBlock(p);
    } catch (e) { onError(e.message || String(e)); }
  }

  async function addClip(start) {
    const c = start || (onClip && await onClip(null));
    if (!c || c === 'remove') return;
    const div = document.createElement('div');
    writeClip(div, c);
    insertBlock(div);
    if (!c.title) fillTitle(div);
    flush();
  }
  // A pasted link has no title yet: ask YouTube (when there's signal).
  async function fillTitle(div) {
    const c = clipOf(div);
    const info = c && videoInfo ? await videoInfo(c.id) : null;
    if (!info?.title || !body.contains(div) || div.getAttribute('data-title')) return;
    div.setAttribute('data-title', info.title.slice(0, 200));
    if (!div.classList.contains('playing')) { div.replaceChildren(); hydrate(); }
    changed();
  }
  async function editClip(div) {
    const res = onClip && await onClip(clipOf(div));
    if (!res) return;
    if (res === 'remove') div.remove();
    else { writeClip(div, res); div.classList.remove('playing'); div.replaceChildren(); hydrate(); }
    changed(); flush();
  }

  async function addDrawing() {
    const dr = onDraw && await onDraw(null);
    if (!dr || dr === 'remove' || !dr.s.length) return;
    const div = document.createElement('div');
    div.setAttribute('data-draw', JSON.stringify(dr));
    insertBlock(div);
    flush();
  }
  async function editDrawing(div) {
    const dr = onDraw && await onDraw(cleanDrawing(div.getAttribute('data-draw')));
    if (!dr) return;
    if (dr === 'remove' || !dr.s.length) div.remove();
    else { div.setAttribute('data-draw', JSON.stringify(dr)); div.replaceChildren(); hydrate(); }
    changed(); flush();
  }

  async function addSheet() {
    const sh = onSheet && await onSheet(null);
    if (!sh || sh === 'remove') return;
    const div = document.createElement('div');
    div.setAttribute('data-sheet', JSON.stringify(sh));
    insertBlock(div);
    flush();
  }
  async function editSheet(div) {
    const sh = onSheet && await onSheet(cleanSheet(div.getAttribute('data-sheet')));
    if (!sh) return;
    if (sh === 'remove') div.remove();
    else { div.setAttribute('data-sheet', JSON.stringify(sh)); div.replaceChildren(); hydrate(); }
    changed(); flush();
  }
  async function addLink2() {
    const l = onLink && await onLink(null);
    if (!l || l === 'remove') return;
    const div = document.createElement('div');
    writeLink(div, l);
    insertBlock(div);
    flush();
  }
  async function editLink(div) {
    const l = onLink && await onLink(linkInfo(div));
    if (!l) return;
    if (l === 'remove') div.remove();
    else { writeLink(div, l); div.replaceChildren(); hydrate(); }
    changed(); flush();
  }

  // A small menu by a toolbar button or a block: [[key, label], …].
  function showPop(anchor, opts, onPick) {
    blockpop.innerHTML = opts.map(([k, label, cls]) => `<button type="button" data-p="${k}" class="${cls || ''}">${escHtml(label)}</button>`).join('');
    blockpop.hidden = false;
    const r = anchor.getBoundingClientRect(), hr = host.getBoundingClientRect();
    blockpop.style.left = Math.max(0, Math.min(r.left - hr.left, hr.width - 230)) + 'px';
    blockpop.style.top = (r.bottom - hr.top + 6) + 'px';
    blockpop.onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; blockpop.hidden = true; onPick(b.dataset.p); };
  }
  closePops = e => { if (!blockpop.hidden && !blockpop.contains(e.target) && !e.target.closest?.('[data-cmd=attach]')) blockpop.hidden = true; };

  // Typing into an empty note starts a proper paragraph (not loose text).
  body.addEventListener('focus', () => {
    if (body.childNodes.length) return;
    body.innerHTML = '<p><br></p>';
    const r = document.createRange(); r.setStart(body.firstChild, 0); r.collapse(true);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  });

  body.addEventListener('input', changed);
  body.addEventListener('blur', flush);

  // Checklist ticks: a tap on the box at the start of a checklist line.
  body.addEventListener('click', e => {
    // A clip: play it right here, change its times, or stop it.
    const clipEl = e.target.closest('div[data-yt]');
    if (clipEl && body.contains(clipEl)) {
      e.preventDefault();
      if (e.target.closest('[data-clipedit]')) editClip(clipEl);
      else if (e.target.closest('[data-stop]')) { clipEl.classList.remove('playing'); clipEl.replaceChildren(); hydrate(); }
      else if (!clipEl.classList.contains('playing')) {
        const c = clipOf(clipEl);
        if (c) { clipEl.classList.add('playing'); clipEl.innerHTML = iframeHTML(c) + '<button type="button" class="cstop" data-stop aria-label="Stop the video">✕</button>'; }
      }
      return;
    }
    // A drawing: open it to change it.
    const drawEl = e.target.closest('div[data-draw]');
    if (drawEl && body.contains(drawEl)) { e.preventDefault(); editDrawing(drawEl); return; }
    // A spreadsheet: open it to change it.
    const sheetEl = e.target.closest('div[data-sheet]');
    if (sheetEl && body.contains(sheetEl)) { e.preventDefault(); editSheet(sheetEl); return; }
    // A file: open it, save a copy, or take it out. A link: open it, change it, or take it out.
    const docEl = e.target.closest('div[data-doc]');
    if (docEl && body.contains(docEl)) {
      e.preventDefault();
      const d = docInfo(docEl);
      showPop(docEl, [['open', 'Open'], ['save', 'Save a copy'], ['remove', 'Take it out of the note', 'danger']], a => {
        if (a === 'open') openDoc?.(d);
        else if (a === 'save') saveDoc?.(d);
        else { docEl.remove(); changed(); flush(); }
      });
      return;
    }
    const linkEl = e.target.closest('div[data-weblink]');
    if (linkEl && body.contains(linkEl)) {
      e.preventDefault();
      const l = linkInfo(linkEl);
      showPop(linkEl, [['open', 'Open ↗'], ['edit', 'Change'], ['remove', 'Take it out of the note', 'danger']], a => {
        if (a === 'open') window.open(l.url, '_blank', 'noopener,noreferrer');
        else if (a === 'edit') editLink(linkEl);
        else { linkEl.remove(); changed(); flush(); }
      });
      return;
    }
    const li = e.target.closest('ul.checklist > li');
    if (li && body.contains(li) && e.clientX - li.getBoundingClientRect().left < 30) {
      e.preventDefault();
      if (li.getAttribute('data-checked') === 'true') li.removeAttribute('data-checked'); else li.setAttribute('data-checked', 'true');
      changed();
      return;
    }
    const img = e.target.closest('img');
    if (img && body.contains(img) && img.src) { onImage?.(img.src); return; }
    const a = e.target.closest('a[href]');
    if (a && body.contains(a)) {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); return; }
      const r = a.getBoundingClientRect(), hr = host.getBoundingClientRect();
      linkpop.hidden = false;
      linkpop.querySelector('a').href = a.href;
      linkpop.style.left = Math.max(0, Math.min(r.left - hr.left, hr.width - 140)) + 'px';
      linkpop.style.top = (r.bottom - hr.top + 6) + 'px';
      return;
    }
    linkpop.hidden = true;
  });
  linkpop.addEventListener('click', () => setTimeout(() => { linkpop.hidden = true; }, 0));
  body.addEventListener('keydown', e => {
    linkpop.hidden = true;
    // A new checklist line starts unticked (browsers copy the previous line's tick).
    if (e.key === 'Enter') setTimeout(() => {
      const li = currentBlock();
      if (li?.tagName === 'LI' && li.getAttribute('data-checked') && !li.textContent.trim()) { li.removeAttribute('data-checked'); changed(); }
    }, 0);
  });

  body.addEventListener('paste', e => {
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.files].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); files.forEach(insertPhoto); return; }
    const html = cd.getData('text/html');
    const text = cd.getData('text/plain');
    e.preventDefault();
    if (/^\s*https?:\/\/\S+\s*$/.test(text) && parseYouTube(text)) {
      addClip(parseYouTube(text));   // a YouTube link becomes a clip (starting where the link says, if it does)
    } else if (/^\s*https?:\/\/\S+\s*$/.test(text)) {
      const url = text.trim();
      document.execCommand('insertHTML', false, `<a href="${escAttr(url)}">${escHtml(url)}</a>&nbsp;`);
    } else if (html) {
      document.execCommand('insertHTML', false, sanitize(html.replace(/<!--[\s\S]*?-->/g, '')));
      hydrate();
    } else {
      document.execCommand('insertText', false, text);
    }
  });
  body.addEventListener('dragover', e => { if ([...e.dataTransfer.items].some(i => i.kind === 'file')) e.preventDefault(); });
  body.addEventListener('drop', e => {
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (range) saved = range;
    files.forEach(insertPhoto);
  });

  function hydrate() {
    for (const el of body.querySelectorAll('div[data-yt], div[data-draw], div[data-sheet], div[data-doc], div[data-weblink]')) {
      el.contentEditable = 'false';
      if (el.firstChild) continue;
      if (el.hasAttribute('data-sheet')) { el.className = 'sheetblock'; el.innerHTML = sheetTableHTML(el.getAttribute('data-sheet'), { maxRows: 40 }) + '<span class="dedit">Edit spreadsheet</span>'; continue; }
      if (el.hasAttribute('data-doc')) { el.className = 'tile docblock'; el.innerHTML = docTileHTML(docInfo(el)); continue; }
      if (el.hasAttribute('data-weblink')) { el.className = 'tile linkblock'; el.innerHTML = linkTileHTML(linkInfo(el)); continue; }
      if (el.hasAttribute('data-yt')) { const c = clipOf(el); el.className = 'clip'; if (c) el.innerHTML = clipFaceHTML(c, { edit: true }); }
      else { const dr = cleanDrawing(el.getAttribute('data-draw')); el.className = 'drawblock'; if (dr) el.innerHTML = drawingSVG(dr) + '<span class="dedit">Edit drawing</span>'; }
    }
    for (const img of body.querySelectorAll('img[data-file]:not([src])')) {
      img.classList.add('loading');
      resolveFile(img.dataset.file).then(url => {
        img.classList.remove('loading');
        if (url) img.src = url; else img.classList.add('missing');
      });
    }
  }

  function getHTML() {
    const clone = body.cloneNode(true);
    for (const img of clone.querySelectorAll('img[data-file]')) { img.removeAttribute('src'); img.removeAttribute('class'); }
    const html = sanitize(clone.innerHTML).trim();
    return /^(<p>(<br>)?<\/p>|<br>)?$/.test(html) ? '' : html;
  }

  return {
    setHTML(html) {
      loading = true;
      body.innerHTML = sanitize(html || '');
      hydrate();
      loading = false;
    },
    getHTML,
    flush,
    get pending() { return !!timer; },
    focus() { body.focus(); },
    get element() { return body; },
  };
}

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const escAttr = escHtml;
