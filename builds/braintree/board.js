// The board: items as cards on an endless surface you can pan and zoom. Two looks:
//   Corkboard   tilted paper pinned to cork, red string that sags between pins
//   Whiteboard  flat sticky notes on a dot grid, curved arrows between them (FigJam-like)
// Every project has its own board, plus one "home" board.
//
// Nothing here is board-only. Each card is a real item, so it's in the lists too:
//   where a card sits:      data.cork[boardKey] = {x, y}
//   a section (a frame):    data.cork[boardKey] = {x, y, w, h}. The item is a project, and
//                           whatever you drop inside it is put inside that project
//   strings / arrows:       data.links = [{to, label}], shown under "Strings" on each item
//   "put inside" from here: data.parent, the same tree the lists show

import { textOf, firstPhoto, escHtml as esc } from './editor.js';

const CARD_W = 220;
const GAP_X = 50, ROW = 290;
const FRAME_W = 700, FRAME_H = 480, FRAME_HEAD = 46;
const MIN_Z = 0.15, MAX_Z = 2.5;
export const COLOURS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'white'];

export function createBoard(host, api) {
  // api: { store, index(), open(id), selected(), today(), fmtDay(s), progress(id), titleOf(r), toast(msg, label, fn), newItem(type, parent, extra), placePicker(key, exclude, onPick), style() }
  host.innerHTML = `
    <header class="boardhead">
      <button class="back" data-act="back-nav"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Lists</span></button>
      <h2></h2>
      <button class="tolist" data-act="board-list">List view</button>
    </header>
    <div class="cork" tabindex="0" aria-label="Board. Drag to move around, pinch or Ctrl+scroll to zoom.">
      <div class="world">
        <div class="frames"></div>
        <div class="cards"></div>
        <svg class="strings" width="1" height="1" overflow="visible">
          <defs><marker id="bt-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="arrowhead"/></marker></defs>
          <g class="lines"></g>
        </svg>
      </div>
    </div>
    <div class="boardbar">
      <button data-b="add-note" title="New note here">+ Note</button>
      <button data-b="add-task" title="New to-do here">+ To-do</button>
      <button data-b="add-section" title="New section: a project you can drop cards into">+ Section</button>
      <button data-b="place" title="Bring in something that's already in Brain Tree">Pin<span class="long"> existing</span></button>
      <span class="sep"></span>
      <button data-b="twine" title="Show or hide what's inside what">Tree<span class="long"> lines</span></button>
      <button data-b="tidy" title="Lay the cards out as a tree again">Tidy</button>
      <span class="sep"></span>
      <button data-b="out" aria-label="Zoom out">−</button>
      <button data-b="fit" title="Fit everything on screen">Fit</button>
      <button data-b="in" aria-label="Zoom in">+</button>
    </div>
    <div class="stringpop" hidden><input placeholder="Label (optional)" maxlength="40"><button data-s="save">Save</button><button data-s="remove" class="danger">Remove</button></div>
    <div class="boardmenu" hidden></div>
    <p class="boardhint" hidden></p>`;
  const cork = host.querySelector('.cork');
  const world = host.querySelector('.world');
  const lines = host.querySelector('.strings .lines');
  const framesEl = host.querySelector('.frames');
  const cardsEl = host.querySelector('.cards');
  const pop = host.querySelector('.stringpop');
  const menuEl = host.querySelector('.boardmenu');
  const hint = host.querySelector('.boardhint');
  cork.style.setProperty('--cork-tex', `url(${corkTexture()})`);

  let key = 'home';
  let view = { x: 40, y: 40, z: 1 };
  let pos = new Map();          // id -> {x, y, w?, h?} for everything on this board right now
  let shown = [];               // records on the board
  let autoIds = new Set();      // on this board automatically (not just brought in by hand)
  let busy = false, pendingRender = false;
  let showTwine = readLocal('bt-twine', true);
  let popLink = null, menuActions = [];
  const isFrame = id => !!pos.get(id)?.w;
  const white = () => api.style() === 'whiteboard';
  const parentFor = () => (key === 'home' ? null : key);   // where new or dropped-out things go

  // ---------- What goes on a board ----------

  function members(I) {
    const out = new Map();
    const add = r => { if (r && I.alive(r)) out.set(r.id, r); };
    if (key === 'home') {
      for (const r of I.live) if (!I.parentOf(r) && (r.data.type === 'project' ? !r.data.done : r.data.type === 'note')) add(r);
    } else {
      add(I.byId.get(key));
      for (const r of I.descendants(key)) add(r);
    }
    autoIds = new Set(out.keys());
    for (const r of I.live) if (r.data.cork && r.data.cork[key]) add(r);
    // Everything inside a section shown here comes along too.
    for (const r of [...out.values()]) if (r.data.cork?.[key]?.w) for (const d of I.descendants(r.id)) add(d);
    return [...out.values()];
  }

  // Cards with no saved spot get a tree layout (parents above children). Inside a section they
  // fill it in rows; everything else goes in a row under what's already there.
  function layout(I, list) {
    const ids = new Set(list.map(r => r.id));
    const saved = new Map();
    for (const r of list) { const p = r.data.cork?.[key]; if (p && Number.isFinite(p.x)) saved.set(r.id, { ...p }); }
    const loose = list.filter(r => !saved.has(r.id));
    if (!loose.length) return saved;
    const parentOn = r => { let p = I.parentOf(r), n = 0; while (p && n++ < 60) { if (ids.has(p.id)) return p.id; p = I.parentOf(p); } return null; };
    const kids = new Map(), tops = [];
    for (const r of loose) { const p = parentOn(r); if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(r); } else tops.push(r); }
    const rank = r => (r.data.type === 'project' ? 0 : r.data.type === 'task' ? 1 : 2);
    const order = (a, b) => rank(a) - rank(b) || (a.data.order || 0) - (b.data.order || 0);
    const width = id => { const k = kids.get(id) || []; return k.length ? Math.max(CARD_W, k.reduce((s, c) => s + width(c.id), 0) + GAP_X * (k.length - 1)) : CARD_W; };
    const out = new Map(saved);
    const place = (r, left, y) => {
      const w = width(r.id);
      out.set(r.id, { x: Math.round(left + w / 2 - CARD_W / 2), y });
      placeKids(r.id, left + w / 2, y + ROW);
    };
    const placeKids = (pid, centre, y) => {
      const list2 = (kids.get(pid) || []).sort(order);
      if (!list2.length) return;
      let x = centre - (list2.reduce((s, c) => s + width(c.id), 0) + GAP_X * (list2.length - 1)) / 2;
      for (const c of list2) { place(c, x, y); x += width(c.id) + GAP_X; }
    };
    for (const [pid, p] of saved) {
      if (p.w) {
        // Fill the section in rows, left to right.
        const cols = Math.max(1, Math.floor((p.w - 30) / (CARD_W + 30)));
        (kids.get(pid) || []).sort(order).forEach((c, i) => out.set(c.id, { x: p.x + 24 + (i % cols) * (CARD_W + 30), y: p.y + FRAME_HEAD + 24 + Math.floor(i / cols) * 190 }));
      } else placeKids(pid, p.x + CARD_W / 2, p.y + ROW);
    }
    let maxY = -Infinity;
    for (const p of out.values()) maxY = Math.max(maxY, p.y + (p.h || 0));
    let cursor = 0;
    const startY = maxY === -Infinity ? 0 : maxY + ROW / 2 + 60;
    for (const r of tops.sort(order)) { place(r, cursor, startY); cursor += width(r.id) + GAP_X * 2; }
    return out;
  }

  // ---------- Drawing ----------

  function render() {
    if (busy) { pendingRender = true; return; }
    const I = api.index();
    shown = members(I);
    pos = layout(I, shown);
    const t = api.today();
    const sel = api.selected();
    host.querySelector('.boardhead h2').textContent = key === 'home' ? (white() ? 'Whiteboard' : 'Corkboard') : api.titleOf(I.byId.get(key) || { data: {} });
    const frames = shown.filter(r => isFrame(r.id)).sort((a, b) => area(b.id) - area(a.id));
    framesEl.innerHTML = frames.map(r => frameHTML(r, I, sel)).join('');
    cardsEl.innerHTML = shown.filter(r => !isFrame(r.id)).map(r => cardHTML(r, I, t, sel)).join('');
    for (const el of framesEl.children) placeEl(el);
    for (const el of cardsEl.children) placeEl(el);
    for (const img of cardsEl.querySelectorAll('img[data-thumb]')) api.store.fileUrl(img.dataset.thumb).then(u => { if (u) img.src = u; else img.remove(); });
    host.querySelector('[data-b=twine]').classList.toggle('on', showTwine);
    const hasLinks = shown.some(r => (r.data.links || []).length);
    hint.textContent = white() ? 'Drag the dot on a card’s edge to another card to connect them.' : 'Drag a card’s pin onto another card to tie a string between them.';
    hint.hidden = shown.length < 2 || hasLinks || readLocal('bt-hint-seen', false);
    requestAnimationFrame(drawLines);
    applyView();
  }
  const area = id => { const p = pos.get(id); return (p?.w || 0) * (p?.h || 0); };

  function cardHTML(r, I, t, sel) {
    const d = r.data, type = d.type || 'note';
    const photo = firstPhoto(d.body);
    const text = textOf(d.body).slice(0, 160);
    const chips = [];
    if (type === 'project') {
      const { total, done } = api.progress(r.id);
      if (total) chips.push(`<span class="chip">${done}/${total}</span>`);
      if (d.start || d.due) chips.push(`<span class="chip ${!d.done && d.due && d.due < t ? 'late' : ''}">${d.start ? api.fmtDay(d.start) : '…'} → ${d.due ? api.fmtDay(d.due) : '…'}</span>`);
    } else if (d.due && type === 'task') chips.push(`<span class="chip ${!d.done && d.due < t ? 'late' : d.due === t ? 'now' : ''}">${api.fmtDay(d.due)}</span>`);
    const tilt = ((hash(r.id) % 7) - 3) * 0.6;
    const progress = type === 'project' ? api.progress(r.id) : null;
    return `
      <div class="pcard t-${type} ${d.color ? 'c-' + d.color : ''} ${d.done ? 'is-done' : ''} ${r.id === key ? 'root' : ''} ${sel === r.id ? 'on' : ''}" data-card="${r.id}" style="--tilt:${tilt}deg">
        <span class="pin" data-pin="${r.id}" title="Drag onto another card to connect"></span>
        ${photo ? `<img class="polaroid" data-thumb="${photo}" alt="">` : ''}
        <div class="ptitle">${type === 'task' ? `<button class="tick ${d.done ? 'done' : ''}" data-tick="${r.id}" aria-label="Done"></button>` : ''}<span>${esc(api.titleOf(r))}</span></div>
        ${text && type !== 'task' ? `<p class="ptext">${esc(text)}</p>` : ''}
        ${progress && progress.total ? `<span class="pbar"><i style="width:${Math.round(100 * progress.done / progress.total)}%"></i></span>` : ''}
        ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
      </div>`;
  }

  function frameHTML(r, I, sel) {
    const inside = I.descendants(r.id).length;
    return `
      <div class="frame ${r.data.color ? 'c-' + r.data.color : ''} ${sel === r.id ? 'on' : ''}" data-frame="${r.id}">
        <div class="fhead" data-fhead="${r.id}"><span class="fname">${esc(api.titleOf(r))}</span><span class="fcount">${inside || ''}</span>
          <span class="pin fpin" data-pin="${r.id}" title="Drag onto a card to connect"></span></div>
        <span class="fsize" data-fsize="${r.id}" aria-label="Resize section"></span>
      </div>`;
  }

  function placeEl(el) {
    const p = pos.get(el.dataset.card || el.dataset.frame);
    if (!p) return;
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    if (p.w) { el.style.width = p.w + 'px'; el.style.height = p.h + 'px'; }
  }
  const elOf = id => cardsEl.querySelector(`[data-card="${id}"]`) || framesEl.querySelector(`[data-frame="${id}"]`);
  const rectOf = id => {
    const p = pos.get(id), el = elOf(id);
    if (!p || !el) return null;
    return { x: p.x, y: p.y, w: p.w || el.offsetWidth, h: p.h || el.offsetHeight };
  };
  const centre = id => { const r = rectOf(id); return r && { x: r.x + r.w / 2, y: r.y + (isFrame(id) ? FRAME_HEAD / 2 : r.h / 2) }; };
  const pinPoint = id => { const r = rectOf(id); return r && (isFrame(id) ? { x: r.x + r.w - 26, y: r.y + FRAME_HEAD / 2 } : { x: r.x + r.w / 2, y: r.y + 10 }); };

  // Corkboard string: sags under its own weight, more the further it goes.
  function sag(a, b, extra = 0) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const droop = Math.min(140, 18 + dist * 0.18) + extra;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + droop;
    return { d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`, mid: { x: mx, y: (a.y + b.y) / 4 + my / 2 } };
  }

  // Whiteboard arrow: leaves the side of one card facing the other and curves into the facing side.
  function arrow(fromId, toId) {
    const A = rectOf(fromId), B = rectOf(toId);
    if (!A || !B) return null;
    const ac = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, bc = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const dx = bc.x - ac.x, dy = bc.y - ac.y;
    let p0, p3, n0, n3;
    if (Math.abs(dx) * A.h > Math.abs(dy) * A.w) {
      p0 = { x: dx > 0 ? A.x + A.w : A.x, y: ac.y }; n0 = { x: Math.sign(dx), y: 0 };
      p3 = { x: dx > 0 ? B.x - 6 : B.x + B.w + 6, y: bc.y }; n3 = { x: -Math.sign(dx), y: 0 };
    } else {
      p0 = { x: ac.x, y: dy > 0 ? A.y + A.h : A.y }; n0 = { x: 0, y: Math.sign(dy) };
      p3 = { x: bc.x, y: dy > 0 ? B.y - 6 : B.y + B.h + 6 }; n3 = { x: 0, y: -Math.sign(dy) };
    }
    const k = Math.max(40, Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.4);
    const p1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k }, p2 = { x: p3.x + n3.x * k, y: p3.y + n3.y * k };
    return { d: `M${p0.x} ${p0.y} C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`, mid: { x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8, y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8 } };
  }

  function drawLines() {
    const I = api.index();
    const on = new Set(shown.map(r => r.id));
    const wb = white();
    let html = '';
    if (showTwine) {
      for (const r of shown) {
        let p = I.parentOf(r), n = 0;
        while (p && !on.has(p.id) && n++ < 60) p = I.parentOf(p);
        if (!p || isFrame(p.id)) continue;           // a section already shows what's in it
        const a = rectOf(p.id), b = rectOf(r.id);
        if (!a || !b) continue;
        const from = { x: a.x + a.w / 2, y: a.y + a.h - 6 }, to = wb ? { x: b.x + b.w / 2, y: b.y } : pinPoint(r.id);
        const d = wb ? `M${from.x} ${from.y} C${from.x} ${from.y + 60} ${to.x} ${to.y - 60} ${to.x} ${to.y}` : sag(from, to, -10).d;
        html += `<path class="twine hit" data-twine="${r.id}" d="${d}"/><path class="twine" d="${d}"/>`;
      }
    }
    const labels = [];
    for (const r of shown) for (const l of r.data.links || []) {
      if (!on.has(l.to)) continue;
      const s = wb ? arrow(r.id, l.to) : (pinPoint(r.id) && pinPoint(l.to) ? sag(pinPoint(r.id), pinPoint(l.to)) : null);
      if (!s) continue;
      const id = `${r.id}|${esc(l.to)}`;
      html += `<path class="redstring hit" data-link="${id}" d="${s.d}"/><path class="redstring ${wb ? 'arrowline' : ''}" d="${s.d}" ${wb ? 'marker-end="url(#bt-arrow)"' : ''}/>`;
      if (l.label) labels.push(`<g class="slabel" data-link="${id}" transform="translate(${s.mid.x} ${s.mid.y})"><rect x="${-l.label.length * 3.6 - 8}" y="-11" width="${l.label.length * 7.2 + 16}" height="22" rx="${wb ? 11 : 6}"/><text text-anchor="middle" y="4">${esc(l.label)}</text></g>`);
    }
    let pins = '';
    if (!wb) for (const r of shown) {
      const a = pinPoint(r.id);
      if (a) pins += `<circle class="pinhead t-${r.data.type || 'note'}" cx="${a.x}" cy="${a.y}" r="8"/><circle class="pinshine" cx="${a.x - 2.5}" cy="${a.y - 2.5}" r="2.4"/>`;
    }
    lines.innerHTML = html + pins + labels.join('');
  }

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    cork.style.backgroundPosition = `${view.x}px ${view.y}px`;
    cork.style.backgroundSize = `${Math.max(8, 220 * view.z)}px ${Math.max(8, 220 * view.z)}px, ${Math.max(4, 24 * view.z)}px ${Math.max(4, 24 * view.z)}px`;
  }
  function saveView() { writeLocal('bt-view:' + key, view); }

  function fit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of shown) { const b = rectOf(r.id); if (!b) continue; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (x0 === Infinity) { view = { x: 40, y: 40, z: 1 }; applyView(); return; }
    const W = cork.clientWidth, H = cork.clientHeight, pad = 50;
    const z = clamp(Math.min((W - pad * 2) / (x1 - x0), (H - pad * 2 - 50) / (y1 - y0)), MIN_Z, 1.2);
    view = { z, x: (W - (x1 - x0) * z) / 2 - x0 * z, y: pad - y0 * z };
    applyView(); saveView();
  }

  function zoomAt(cx, cy, factor) {
    const z = clamp(view.z * factor, MIN_Z, MAX_Z), k = z / view.z;
    view = { z, x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k };
    applyView();
  }
  const toWorld = (cx, cy) => { const b = cork.getBoundingClientRect(); return { x: (cx - b.left - view.x) / view.z, y: (cy - b.top - view.y) / view.z }; };

  // The smallest section on this board that a point sits in (ignoring some ids).
  function frameAt(pt, skip = new Set()) {
    let best = null, bestArea = Infinity;
    for (const r of shown) {
      if (!isFrame(r.id) || skip.has(r.id)) continue;
      const b = rectOf(r.id);
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h && b.w * b.h < bestArea) { best = r.id; bestArea = b.w * b.h; }
    }
    return best;
  }

  // ---------- Pointer handling: pan, pinch, drag cards and sections, connect ----------

  const pointers = new Map();
  let gesture = null, lastTap = null;
  const capture = id => { try { cork.setPointerCapture(id); } catch (err) {} };

  cork.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    pop.hidden = true; menuEl.hidden = true;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { startPinch(); return; }
    if (e.target.closest('[data-tick]')) return;
    const pin = e.target.closest('[data-pin]');
    const link = e.target.closest('[data-link]');
    const twine = e.target.closest('[data-twine]');
    const fsize = e.target.closest('[data-fsize]');
    const fhead = e.target.closest('[data-fhead]');
    let card = e.target.closest('[data-card]');
    if (pin) {
      e.preventDefault(); capture(e.pointerId);
      gesture = { kind: 'connect', from: pin.dataset.pin };
      busy = true; return;
    }
    if (fsize) {
      capture(e.pointerId);
      const id = fsize.dataset.fsize;
      gesture = { kind: 'resize', id, sx: e.clientX, sy: e.clientY, start: { ...pos.get(id) } };
      busy = true; return;
    }
    // A string or tree line lying across a card: a drag still moves the card, a tap edits the line.
    const line = link || twine;
    if (line && !line.matches('.slabel')) card = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.closest?.('[data-card]'))?.closest('[data-card]') || null;
    capture(e.pointerId);
    if (card || fhead) {
      const id = card ? card.dataset.card : fhead.dataset.fhead;
      gesture = { kind: 'move', id, el: elOf(id), sx: e.clientX, sy: e.clientY, moved: false, line, starts: carried(id) };
      gesture.fromFrame = frameAt(centre(id), new Set([id, ...descIds(id)]));
    } else if (line) {
      gesture = { kind: 'tap-line', line, sx: e.clientX, sy: e.clientY };
    } else {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
    busy = true;
  });

  const descIds = id => api.index().descendants(id).map(r => r.id);

  // Moving a section carries everything sitting inside it.
  function carried(id) {
    const out = new Map([[id, { ...pos.get(id) }]]);
    if (!isFrame(id)) return out;
    const f = rectOf(id);
    for (const r of shown) {
      if (r.id === id) continue;
      const c = centre(r.id);
      if (c && c.x >= f.x && c.x <= f.x + f.w && c.y >= f.y && c.y <= f.y + f.h) out.set(r.id, { ...pos.get(r.id) });
    }
    return out;
  }

  cork.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.kind === 'pinch') { movePinch(); return; }
    if (!gesture) return;
    const g = gesture;
    if (g.kind === 'pan') {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      view.x = g.vx + dx; view.y = g.vy + dy; applyView();
    } else if (g.kind === 'move') {
      const dx = (e.clientX - g.sx) / view.z, dy = (e.clientY - g.sy) / view.z;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) < 4 / view.z) return;
      if (!g.moved) { g.moved = true; g.el?.classList.add('lifted'); }
      for (const [id, s] of g.starts) { pos.set(id, { ...s, x: Math.round(s.x + dx), y: Math.round(s.y + dy) }); const el = elOf(id); if (el) placeEl(el); }
      // Show which section it will land in.
      const into = frameAt(centre(g.id), new Set([g.id, ...descIds(g.id)]));
      for (const f of framesEl.querySelectorAll('.drop')) f.classList.remove('drop');
      if (into && into !== g.fromFrame) framesEl.querySelector(`[data-frame="${into}"]`)?.classList.add('drop');
      drawLines();
    } else if (g.kind === 'resize') {
      const w = Math.max(320, Math.round(g.start.w + (e.clientX - g.sx) / view.z));
      const h = Math.max(200, Math.round(g.start.h + (e.clientY - g.sy) / view.z));
      pos.set(g.id, { ...g.start, w, h });
      placeEl(elOf(g.id)); drawLines();
    } else if (g.kind === 'connect') {
      const a = pinPoint(g.from), b = toWorld(e.clientX, e.clientY);
      drawLines();
      if (a) lines.insertAdjacentHTML('beforeend', white()
        ? `<path class="redstring arrowline live" d="M${a.x} ${a.y} L${b.x} ${b.y}" marker-end="url(#bt-arrow)"/>`
        : `<path class="redstring live" d="${sag(a, b).d}"/>`);
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      const over = targetAt(e.clientX, e.clientY);
      if (over && over !== g.from) elOf(over)?.classList.add('target');
    }
  });

  const targetAt = (cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    return el?.closest?.('[data-card]')?.dataset.card || el?.closest?.('[data-fhead]')?.dataset.fhead || null;
  };

  const end = async e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture?.kind === 'pinch') { if (pointers.size < 2) { gesture = null; busy = false; saveView(); flush(); } return; }
    const g = gesture;
    gesture = null; busy = false;
    if (!g) return;
    const up = e.type === 'pointerup';
    if (g.kind === 'pan') {
      saveView();
      if (!g.moved && up) {
        const now = Date.now();
        if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 25) { lastTap = null; addAt('note', toWorld(e.clientX, e.clientY)); }
        else lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    } else if (g.kind === 'move') {
      g.el?.classList.remove('lifted');
      for (const f of framesEl.querySelectorAll('.drop')) f.classList.remove('drop');
      if (g.moved) await dropped(g);
      else if (up && g.line) lineTapped(g.line, e.clientX, e.clientY);
      else if (up) api.open(g.id);
    } else if (g.kind === 'resize') {
      await savePositions(new Map([[g.id, pos.get(g.id)]]));
    } else if (g.kind === 'connect') {
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      const over = targetAt(e.clientX, e.clientY);
      if (over && over !== g.from) connectMenu(g.from, over, e.clientX, e.clientY);
      drawLines();
    } else if (g.kind === 'tap-line' && up && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 8) {
      lineTapped(g.line, e.clientX, e.clientY);
    }
    flush();
  };
  cork.addEventListener('pointerup', end);
  cork.addEventListener('pointercancel', end);

  function startPinch() {
    if (gesture?.kind === 'move' && gesture.moved) dropped(gesture);
    gesture?.el?.classList.remove('lifted');
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, view: { ...view } };
    busy = true;
  }
  function movePinch() {
    const [a, b] = [...pointers.values()];
    const rect = cork.getBoundingClientRect(), g = gesture;
    const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const z = clamp(g.view.z * dist / g.dist, MIN_Z, MAX_Z), k = z / g.view.z;
    const ox = g.cx - rect.left, oy = g.cy - rect.top;
    view = { z, x: ox - (ox - g.view.x) * k + (cx - g.cx), y: oy - (oy - g.view.y) * k + (cy - g.cy) };
    applyView();
  }

  cork.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = cork.getBoundingClientRect();
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
    if (e.ctrlKey || mouseWheel) zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    else { view.x -= e.deltaX; view.y -= e.deltaY; applyView(); }
    clearTimeout(wheelTimer); wheelTimer = setTimeout(saveView, 300);
  }, { passive: false });
  let wheelTimer = null;
  cork.addEventListener('gesturestart', e => e.preventDefault());
  cork.addEventListener('gesturechange', e => e.preventDefault());

  cork.addEventListener('keydown', e => {
    if (e.target !== cork) return;
    const step = 60;
    if (e.key === 'ArrowLeft') view.x += step; else if (e.key === 'ArrowRight') view.x -= step;
    else if (e.key === 'ArrowUp') view.y += step; else if (e.key === 'ArrowDown') view.y -= step;
    else if (e.key === '+' || e.key === '=') zoomAt(cork.clientWidth / 2, cork.clientHeight / 2, 1.2);
    else if (e.key === '-') zoomAt(cork.clientWidth / 2, cork.clientHeight / 2, 1 / 1.2);
    else return;
    e.preventDefault(); applyView(); saveView();
  });

  function flush() { if (pendingRender) { pendingRender = false; render(); } }

  // ---------- Changes (all of them land in the real items, so the lists show them too) ----------

  async function savePositions(map) {
    for (const [id, p] of map) {
      const r = api.store.get(id);
      if (!r || !p) continue;
      const spot = { x: p.x, y: p.y, ...(p.w ? { w: p.w, h: p.h } : {}) };
      await api.store.update(id, { cork: { ...(r.data.cork || {}), [key]: spot } });
    }
  }

  // After a drag: keep everyone's spot, and if it moved into or out of a section, move it
  // into or out of that project too.
  async function dropped(g) {
    const map = new Map();
    // The first time anything moves here, every other card's automatic spot is kept too, so nothing jumps.
    for (const r of shown) if (!r.data.cork?.[key] && !g.starts.has(r.id)) map.set(r.id, pos.get(r.id));
    for (const id of g.starts.keys()) map.set(id, pos.get(id));
    await savePositions(map);
    const into = frameAt(centre(g.id), new Set([g.id, ...descIds(g.id)]));
    if (into === g.fromFrame) return;
    const r = api.store.get(g.id);
    const was = r.data.parent;
    const next = into || parentFor();
    if ((next || undefined) === (was || undefined)) return;
    await api.store.update(g.id, { parent: next || undefined });
    const I = api.index();
    const name = id => (id ? api.titleOf(I.byId.get(id) || { data: {} }) : 'Inbox');
    api.toast(into ? `Moved into “${name(into)}”` : `Moved out to “${name(next)}”`, 'Undo', () => api.store.update(g.id, { parent: was || undefined }));
  }

  // After dragging one card's pin or dot onto another: a string, or put one inside the other.
  function connectMenu(a, b, cx, cy) {
    const I = api.index();
    const A = I.byId.get(a), B = I.byId.get(b);
    if (!A || !B) return;
    const nameA = short(api.titleOf(A)), nameB = short(api.titleOf(B));
    const links = A.data.links || [];
    const tied = links.some(l => l.to === b) || (B.data.links || []).some(l => l.to === a);
    const can = (child, parent) => child !== parent && !I.descendants(child).some(r => r.id === parent) && I.byId.get(child).data.parent !== parent;
    const opts = [];
    if (!tied) opts.push({ label: white() ? 'Connect with an arrow' : 'Tie a red string', fn: () => { writeLocal('bt-hint-seen', true); return api.store.update(a, { links: [...links, { to: b }] }); } });
    if (can(b, a)) opts.push({ label: `Put “${nameB}” inside “${nameA}”`, fn: () => nest(b, a) });
    if (can(a, b)) opts.push({ label: `Put “${nameA}” inside “${nameB}”`, fn: () => nest(a, b) });
    if (!opts.length) { api.toast('Those two are already connected.'); return; }
    menu(cx, cy, opts);
  }

  async function nest(child, parent) {
    const was = api.store.get(child).data.parent;
    await api.store.update(child, { parent });
    api.toast(`“${short(api.titleOf(api.store.get(child)))}” is now inside “${short(api.titleOf(api.store.get(parent)))}”`, 'Undo', () => api.store.update(child, { parent: was || undefined }));
  }

  function lineTapped(line, cx, cy) {
    if (line.dataset.link) return openStringPop(line.dataset.link, cx, cy);
    // A tree line: offer to take the child out of its parent.
    const I = api.index();
    const child = I.byId.get(line.dataset.twine), parent = child && I.parentOf(child);
    if (!child || !parent) return;
    const up = I.parentOf(parent);
    menu(cx, cy, [{ label: `Take “${short(api.titleOf(child))}” out of “${short(api.titleOf(parent))}”`, danger: true, fn: async () => {
      const was = child.data.parent;
      await api.store.update(child.id, { parent: up ? up.id : undefined });
      api.toast(`Moved to ${up ? '“' + short(api.titleOf(up)) + '”' : 'Inbox'}`, 'Undo', () => api.store.update(child.id, { parent: was }));
    } }]);
  }

  function menu(cx, cy, opts) {
    menuActions = opts;
    menuEl.innerHTML = opts.map((o, i) => `<button data-m="${i}" class="${o.danger ? 'danger' : ''}">${esc(o.label)}</button>`).join('') + '<button data-m="x" class="cancel">Cancel</button>';
    menuEl.hidden = false;
    const b = host.getBoundingClientRect();
    menuEl.style.left = clamp(cx - b.left - 20, 8, b.width - menuEl.offsetWidth - 8) + 'px';
    menuEl.style.top = clamp(cy - b.top + 10, 8, b.height - menuEl.offsetHeight - 8) + 'px';
  }
  menuEl.addEventListener('click', async e => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    menuEl.hidden = true;
    if (b.dataset.m !== 'x') await menuActions[+b.dataset.m]?.fn();
  });

  function openStringPop(link, cx, cy) {
    const [from, to] = link.split('|');
    const l = (api.store.get(from)?.data.links || []).find(x => x.to === to);
    if (!l) return;
    popLink = { from, to };
    const b = host.getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = clamp(cx - b.left - 130, 8, b.width - 268) + 'px';
    pop.style.top = clamp(cy - b.top + 12, 8, b.height - 60) + 'px';
    const input = pop.querySelector('input');
    input.value = l.label || '';
    if (matchMedia('(pointer: fine)').matches) input.focus();
  }
  async function saveString(remove) {
    if (!popLink) return;
    const { from, to } = popLink;
    const links = api.store.get(from)?.data.links || [];
    const label = pop.querySelector('input').value.trim();
    pop.hidden = true; popLink = null;
    if (remove) {
      await api.store.update(from, { links: links.filter(l => l.to !== to) });
      api.toast(white() ? 'Arrow removed.' : 'String cut.', 'Undo', () => api.store.update(from, { links }));
    } else await api.store.update(from, { links: links.map(l => (l.to === to ? { to, ...(label ? { label } : {}) } : l)) });
  }
  pop.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) saveString(b.dataset.s === 'remove'); });
  pop.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') saveString(false); if (e.key === 'Escape') { pop.hidden = true; popLink = null; } });

  const viewCentre = () => toWorld(cork.getBoundingClientRect().left + cork.clientWidth / 2, cork.getBoundingClientRect().top + cork.clientHeight / 3);

  async function addAt(type, at) {
    const p = at || viewCentre();
    const parent = frameAt(p) || parentFor();
    const id = await api.newItem(type, parent || undefined, { cork: { [key]: { x: Math.round(p.x - CARD_W / 2), y: Math.round(p.y) } } });
    api.open(id);
  }

  async function addSection() {
    const c = viewCentre();
    const parent = frameAt(c) || parentFor();
    const id = await api.newItem('project', parent || undefined, { title: 'New section', cork: { [key]: { x: Math.round(c.x - FRAME_W / 2), y: Math.round(c.y - 60), w: FRAME_W, h: FRAME_H } } });
    api.open(id);
  }

  host.querySelector('.boardbar').addEventListener('click', async e => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    const w = cork.clientWidth / 2, h = cork.clientHeight / 2;
    const a = b.dataset.b;
    if (a === 'in') { zoomAt(w, h, 1.25); saveView(); }
    else if (a === 'out') { zoomAt(w, h, 0.8); saveView(); }
    else if (a === 'fit') fit();
    else if (a === 'twine') { showTwine = !showTwine; writeLocal('bt-twine', showTwine); b.classList.toggle('on', showTwine); drawLines(); }
    else if (a === 'add-note') addAt('note');
    else if (a === 'add-task') addAt('task');
    else if (a === 'add-section') addSection();
    else if (a === 'place') api.placePicker(key, shown.map(r => r.id), async id => {
      const c = viewCentre();
      const r = api.store.get(id);
      await api.store.update(id, { cork: { ...(r.data.cork || {}), [key]: { x: Math.round(c.x - CARD_W / 2), y: Math.round(c.y) } } });
    });
    else if (a === 'tidy') {
      // Cards brought in from elsewhere and sections keep their spot; the rest go back into a tree.
      const moved = shown.filter(r => r.data.cork?.[key] && autoIds.has(r.id) && !r.data.cork[key].w);
      const before = new Map(moved.map(r => [r.id, r.data.cork]));
      for (const r of moved) { const c = { ...r.data.cork }; delete c[key]; await api.store.update(r.id, { cork: Object.keys(c).length ? c : undefined }); }
      setTimeout(fit, 50);
      api.toast('Cards laid out as a tree.', 'Undo', async () => { for (const [id, c] of before) await api.store.update(id, { cork: c }); });
    }
  });

  return {
    show(boardKey) {
      if (boardKey !== key || !cardsEl.children.length && !framesEl.children.length) {
        key = boardKey;
        const saved = readLocal('bt-view:' + key, null);
        render();
        if (saved) { view = saved; applyView(); } else requestAnimationFrame(fit);
      } else render();
    },
    refresh: render,
    // Turn a project shown on this board into a section (or back into a card).
    async toggleFrame(id) {
      const r = api.store.get(id);
      if (!r) return;
      const p = pos.get(id) || viewCentre();
      const cur = r.data.cork?.[key];
      const spot = cur?.w ? { x: p.x, y: p.y } : { x: p.x, y: p.y, w: FRAME_W, h: FRAME_H };
      await api.store.update(id, { cork: { ...(r.data.cork || {}), [key]: spot } });
    },
    isFrameHere: id => !!api.store.get(id)?.data.cork?.[key]?.w,
    get key() { return key; },
  };
}

const short = s => (s.length > 28 ? s.slice(0, 26) + '…' : s);

// Speckled cork, drawn once: dark and light flecks of different sizes on a see-through tile
// (the cork colour underneath comes from the theme). Flecks near an edge are drawn again on
// the opposite side so the tile repeats without seams.
function corkTexture(size = 220) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const dot = (x, y, r, color) => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      if (x + ox < -r || x + ox > size + r || y + oy < -r || y + oy > size + r) continue;
      g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fillStyle = color; g.fill();
    }
  };
  for (let i = 0; i < 70; i++) dot(rnd() * size, rnd() * size, 4 + rnd() * 9, `rgba(70, 40, 10, ${0.03 + rnd() * 0.05})`);
  for (let i = 0; i < 1400; i++) dot(rnd() * size, rnd() * size, 0.4 + rnd() * 1.3, `rgba(55, 30, 5, ${0.18 + rnd() * 0.35})`);
  for (let i = 0; i < 500; i++) dot(rnd() * size, rnd() * size, 0.4 + rnd() * 0.9, `rgba(255, 236, 200, ${0.12 + rnd() * 0.25})`);
  return c.toDataURL('image/png');
}

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function readLocal(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } }
function writeLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
