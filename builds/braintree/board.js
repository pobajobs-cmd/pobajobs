// The board: every project has one. The project's name is the banner across the top, its
// to-dos, notes and sub-projects are cards, and its sections are labelled frames you drop
// cards into. Four looks, each with its own kind of string:
//   Corkboard   tilted paper and push pins; red wool that sags from pin to pin
//   Whiteboard  flat sticky notes; wobbly marker arrows
//   Blueprint   outlined boxes on a blue grid; ruled lines that turn at right angles
//   Notebook    taped paper slips on dotted paper; fine ink-pen arrows
//
// Nothing here is board-only. Every card is a real item, so the lists show the same thing:
//   where a card sits:  data.cork[projectId] = {x, y}
//   a section:          an item of type "section" inside the project, data.cork[projectId] = {x, y, w, h}.
//                       Cards dropped in it go inside it; in the lists it's a heading in the project.
//   strings:            data.links = [{to, label}], listed under "Strings" on each item
//   "put inside":       data.parent, the same tree the lists show. What's inside a card is listed on it.

import { sanitize, firstPhoto, escHtml as esc } from './editor.js';

const CARD_W = 220, GAP = 28, PAD = 24, HEAD = 46;
const SECTION_W = 2 * PAD + 2 * CARD_W + GAP, SECTION_H = 320;
const MIN_Z = 0.15, MAX_Z = 2.5;
export const COLOURS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'white'];
const PINS = ['#D23B2F', '#2E8B3E', '#2F6FC8', '#E8B21E', '#8E44AD', '#E4702A'];
const WORDS = {
  corkboard: { tie: 'Tie a red string', cut: 'String cut.', hint: 'Drag a card’s pin onto another card to tie a string between them.' },
  whiteboard: { tie: 'Draw an arrow', cut: 'Arrow rubbed out.', hint: 'Drag the dot on a card’s edge onto another card to draw an arrow.' },
  blueprint: { tie: 'Draw a line', cut: 'Line removed.', hint: 'Drag the dot on a card’s edge onto another card to draw a line.' },
  notebook: { tie: 'Draw an arrow', cut: 'Arrow rubbed out.', hint: 'Drag the dot on a card’s edge onto another card to draw an arrow.' },
};
const LABEL_RX = { corkboard: 3, whiteboard: 11, blueprint: 0, notebook: 4 };

export function createBoard(host, api) {
  // api: { store, index(), open(id), openBoard(id), selected(), today(), fmtDay(s), progress(id), titleOf(r), toast(msg, label, fn), newItem(type, parent, extra), placePicker(key, exclude, onPick), style() }
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
      <button data-b="add-section" title="New section: a labelled area you drop cards into">+ Section</button>
      <button data-b="place" title="Bring in something from another project or the Inbox">Pin<span class="long"> existing</span></button>
      <span class="sep"></span>
      <button data-b="tidy" title="Lay everything out neatly again">Tidy</button>
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

  let key = null;                 // the project whose board this is
  let view = { x: 40, y: 40, z: 1 };
  let pos = new Map();            // id -> {x, y, w?, h?}: cards, sections, and the banner (under the project's id)
  const heights = new Map();      // card heights as last drawn
  let cards = [], frames = [], frameIds = new Set(), guests = new Set();
  let busy = false, pendingRender = false, needsFit = false;
  let popLink = null, menuActions = [];
  const look = () => (api.style() in WORDS ? api.style() : 'corkboard');
  const words = () => WORDS[look()];
  const isFrame = id => frameIds.has(id);

  // ---------- What goes on a board ----------

  // The project's own to-dos, notes and sub-projects, its sections and what's in them, plus
  // anything from elsewhere you've pinned here. Things inside a card are listed on the card.
  function members(I) {
    const cardList = [], frameList = [], guestIds = new Set();
    const seen = new Set([key]);
    const add = (r, list) => { if (r && I.alive(r) && !seen.has(r.id)) { seen.add(r.id); list.push(r); } };
    for (const r of I.kids.get(key) || []) {
      if (r.data.type === 'section') {
        add(r, frameList);
        for (const c of I.kids.get(r.id) || []) if (c.data.type !== 'section') add(c, cardList);
      } else add(r, cardList);
    }
    const inside = new Set(I.descendants(key).map(r => r.id));
    for (const r of I.live) {
      if (r.data.cork?.[key] && !inside.has(r.id) && r.id !== key && r.data.type !== 'section' && r.data.type !== 'pref') { add(r, cardList); guestIds.add(r.id); }
    }
    return { cardList, frameList, guestIds };
  }

  // Saved spots are kept as long as they still match the lists: a card in a section has to sit
  // in that section, and one that isn't in a section can't sit inside one. Anything else (new,
  // or moved from the lists) is placed: inside its section if it has one, otherwise in a block
  // under everything that's already placed. Sections grow to fit what's in them.
  function layout(I) {
    const out = new Map();
    const h = id => heights.get(id) || 140;
    const saved = r => { const p = r.data.cork?.[key]; return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { ...p } : null; };
    const rank = r => ({ task: 0, note: 1, project: 2 }[r.data.type] ?? 3);
    const order = (a, b) => rank(a) - rank(b) || (a.data.order || 0) - (b.data.order || 0) || (a.data.created || '').localeCompare(b.data.created || '');
    const kidsOf = s => cards.filter(c => c.data.parent === s.id);
    const pack = (list, cols) => {
      const colY = Array(cols).fill(0), at = new Map();
      for (const r of list) {
        let c = 0;
        for (let i = 1; i < cols; i++) if (colY[i] < colY[c] - 1) c = i;
        at.set(r.id, { x: c * (CARD_W + GAP), y: colY[c] });
        colY[c] += h(r.id) + GAP;
      }
      return { at, w: cols * (CARD_W + GAP) - GAP, h: Math.max(0, Math.max(...colY) - GAP) };
    };

    for (const s of frames) { const p = saved(s); if (p && p.w) out.set(s.id, p); }
    const savedFrameAt = pt => { let best = null, area = Infinity; for (const s of frames) { const f = out.get(s.id); if (f && inRect(f, pt) && f.w * f.h < area) { best = s.id; area = f.w * f.h; } } return best; };
    for (const c of cards) {
      const p = saved(c);
      if (!p) continue;
      const where = savedFrameAt({ x: p.x + CARD_W / 2, y: p.y + h(c.id) / 2 });
      const home = frameIds.has(c.data.parent) ? c.data.parent : null;
      if (where === home) out.set(c.id, { x: p.x, y: p.y });
    }

    // Sections already on the board: new things go under what's in them.
    for (const s of frames) {
      const f = out.get(s.id);
      if (!f) continue;
      const kids = kidsOf(s), loose = kids.filter(k => !out.has(k.id)).sort(order);
      if (!loose.length) continue;
      const cols = Math.max(1, Math.floor((f.w - 2 * PAD + GAP) / (CARD_W + GAP)));
      let y0 = f.y + HEAD + PAD;
      for (const k of kids) if (out.has(k.id)) y0 = Math.max(y0, out.get(k.id).y + h(k.id) + GAP);
      const b = pack(loose, cols);
      for (const [id, p] of b.at) out.set(id, { x: f.x + PAD + p.x, y: y0 + p.y });
    }

    // Everything still without a spot: shelves, left to right, under what's placed.
    let minX = Infinity, maxY = -Infinity;
    for (const [id, p] of out) { minX = Math.min(minX, p.x); maxY = Math.max(maxY, p.y + (p.h || h(id))); }
    const x0 = minX === Infinity ? 0 : minX;
    let x = x0, y = maxY === -Infinity ? 0 : maxY + 90, shelf = 0;
    const put = (w, hh) => {
      if (x > x0 && x + w > x0 + 1700) { x = x0; y += shelf + 70; shelf = 0; }
      const at = { x, y };
      x += w + 70; shelf = Math.max(shelf, hh);
      return at;
    };
    const loose = cards.filter(c => !out.has(c.id) && !frameIds.has(c.data.parent)).sort(order);
    if (loose.length) {
      const b = pack(loose, Math.min(4, Math.max(1, Math.ceil(Math.sqrt(loose.length)))));
      const at = put(b.w, b.h);
      for (const [id, p] of b.at) out.set(id, { x: at.x + p.x, y: at.y + p.y });
    }
    // Sections not on the board yet (made in the lists) come with their cards packed inside.
    for (const s of frames.filter(fr => !out.has(fr.id)).sort(order)) {
      const kids = kidsOf(s).sort(order);
      const b = pack(kids, Math.min(3, Math.max(1, Math.ceil(Math.sqrt(kids.length)))));
      const w = Math.max(320, b.w + 2 * PAD), hh = Math.max(220, HEAD + PAD + b.h + PAD);
      const at = put(w, hh);
      out.set(s.id, { x: at.x, y: at.y, w, h: hh });
      for (const [id, p] of b.at) out.set(id, { x: at.x + PAD + p.x, y: at.y + HEAD + PAD + p.y });
    }

    // Sections stretch to hold their cards (on screen; the size is saved when you move or resize one).
    for (const s of frames) {
      const f = out.get(s.id);
      for (const k of kidsOf(s)) { const p = out.get(k.id); if (p) { f.w = Math.max(f.w, p.x + CARD_W + PAD - f.x); f.h = Math.max(f.h, p.y + h(k.id) + PAD - f.y); } }
    }

    // The banner: where you put it (data.cork.banner on the project), or centred over the top of everything.
    const bp = I.byId.get(key)?.data.cork?.banner;
    if (bp && Number.isFinite(bp.x) && Number.isFinite(bp.y)) out.set(key, { x: bp.x, y: bp.y });
    else {
      let lx = Infinity, rx = -Infinity, ty = Infinity;
      for (const [id, p] of out) { lx = Math.min(lx, p.x); rx = Math.max(rx, p.x + (p.w || CARD_W)); ty = Math.min(ty, p.y); }
      const bw = heights.get('banner:w') || 300, bh = heights.get('banner:h') || 70;
      out.set(key, lx === Infinity ? { x: 0, y: -bh - 40 } : { x: Math.round((lx + rx) / 2 - bw / 2), y: Math.round(ty - bh - 60) });
    }
    return out;
  }

  // ---------- Drawing ----------

  function render() {
    if (busy) { pendingRender = true; return; }
    if (!key || !cork.clientWidth) return;     // hidden (a phone showing an item): drawn when it's back
    const I = api.index();
    const proj = I.byId.get(key);
    if (!proj) return;
    ({ cardList: cards, frameList: frames, guestIds: guests } = members(I));
    frameIds = new Set(frames.map(f => f.id));
    const t = api.today(), sel = api.selected();
    host.querySelector('.boardhead h2').textContent = api.titleOf(proj);
    framesEl.innerHTML = frames.map(r => frameHTML(r, I, sel)).join('');
    cardsEl.innerHTML = bannerHTML(proj, sel) + cards.map(r => cardHTML(r, I, t, sel)).join('');
    // Measure first (a card is the same size wherever it goes), then lay out.
    for (const el of cardsEl.querySelectorAll('.pbody')) if (el.scrollHeight > el.clientHeight + 2) el.classList.add('clip');
    for (const el of cardsEl.children) {
      if (el.dataset.banner !== undefined) { heights.set('banner:w', el.offsetWidth); heights.set('banner:h', el.offsetHeight); }
      else heights.set(el.dataset.card, el.offsetHeight);
    }
    pos = layout(I);
    for (const el of [...framesEl.children].sort((a, b) => area(b.dataset.frame) - area(a.dataset.frame))) framesEl.append(el);
    for (const el of framesEl.children) placeEl(el);
    for (const el of cardsEl.children) placeEl(el);
    for (const img of cardsEl.querySelectorAll('img[data-thumb]')) api.store.fileUrl(img.dataset.thumb).then(u => { if (u) img.src = u; else img.remove(); });
    const hasLinks = [...cards, ...frames].some(r => (r.data.links || []).length);
    if (!cards.length && !frames.length) { hint.textContent = 'Nothing here yet. Add a note, a to-do or a section below.'; hint.hidden = false; }
    else { hint.textContent = words().hint; hint.hidden = cards.length < 2 || hasLinks || readLocal('bt-hint-seen', false); }
    drawLines();
    if (needsFit) { needsFit = false; fit(); } else applyView();
  }
  const area = id => { const p = pos.get(id); return (p?.w || 0) * (p?.h || 0); };

  function bannerHTML(proj, sel) {
    const d = proj.data;
    const { total, done } = api.progress(key);
    const bits = [];
    if (d.start || d.due) bits.push(`${d.start ? api.fmtDay(d.start) : '…'} → ${d.due ? api.fmtDay(d.due) : '…'}`);
    if (total) bits.push(`${done} of ${total} done`);
    return `
      <div class="pbanner ${sel === key ? 'on' : ''} ${d.done ? 'is-done' : ''}" data-card="${key}" data-banner>
        <span class="bcap">Project</span>
        <span class="btitle">${esc(api.titleOf(proj))}</span>
        ${bits.length ? `<span class="bsub">${esc(bits.join(' · '))}</span>` : ''}
      </div>`;
  }

  function cardHTML(r, I, t, sel) {
    const d = r.data, type = d.type || 'note';
    const photo = firstPhoto(d.body);
    const chips = [];
    const prog = type === 'project' ? api.progress(r.id) : null;
    if (type === 'project') {
      if (prog.total) chips.push(`<span class="chip">${prog.done}/${prog.total}</span>`);
      if (d.start || d.due) chips.push(`<span class="chip ${!d.done && d.due && d.due < t ? 'late' : ''}">${d.start ? api.fmtDay(d.start) : '…'} → ${d.due ? api.fmtDay(d.due) : '…'}</span>`);
    } else if (d.due && type === 'task') chips.push(`<span class="chip ${!d.done && d.due < t ? 'late' : d.due === t ? 'now' : ''}">${api.fmtDay(d.due)}</span>`);
    if (guests.has(r.id)) { const p = I.project(r); chips.push(`<span class="chip guest">From ${esc(p ? short(api.titleOf(p)) : 'Inbox')}</span>`); }
    const body = bodyHTML(d.body);
    const showTitle = type !== 'note' || (d.title || '').trim() || !body;
    const kids = type === 'project' ? [] : (I.kids.get(r.id) || []);
    const n = hash(r.id);
    return `
      <div class="pcard t-${type} ${d.color ? 'c-' + d.color : ''} ${d.done ? 'is-done' : ''} ${sel === r.id ? 'on' : ''}" data-card="${r.id}" style="--tilt:${((n % 7) - 3) * 0.6}deg;--pin:${PINS[n % PINS.length]}">
        <span class="pin" data-pin="${r.id}" title="Drag onto another card to connect"></span>
        ${photo ? `<img class="polaroid" data-thumb="${photo}" alt="">` : ''}
        ${showTitle ? `<div class="ptitle">${type === 'task' ? `<button class="tick ${d.done ? 'done' : ''}" data-tick="${r.id}" aria-label="Done"></button>` : ''}<span>${esc(api.titleOf(r))}</span></div>` : ''}
        ${body ? `<div class="pbody">${body}</div>` : ''}
        ${kids.length ? kidsHTML(kids) : ''}
        ${prog && prog.total ? `<span class="pbar"><i style="width:${Math.round(100 * prog.done / prog.total)}%"></i></span>` : ''}
        ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
        ${type === 'project' ? `<span class="openboard" data-openboard="${r.id}">Open its board ›</span>` : ''}
      </div>`;
  }

  // Things inside a card: open to-dos first, a few at most.
  function kidsHTML(kids) {
    const list = [...kids].sort((a, b) => (a.data.done ? 1 : 0) - (b.data.done ? 1 : 0) || (a.data.type === 'task' ? 0 : 1) - (b.data.type === 'task' ? 0 : 1));
    const shown = list.slice(0, 6), more = list.length - shown.length;
    return `<ul class="pkids">${shown.map(k => `
      <li data-sub="${k.id}" class="${k.data.done ? 'done' : ''}">${k.data.type === 'task' ? `<button class="tick ${k.data.done ? 'done' : ''}" data-tick="${k.id}" aria-label="Done"></button>` : `<i class="kdot t-${k.data.type}"></i>`}<span>${esc(api.titleOf(k))}</span></li>`).join('')}
      ${more ? `<li class="kmore">+ ${more} more</li>` : ''}</ul>`;
  }

  function frameHTML(r, I, sel) {
    const n = (I.kids.get(r.id) || []).length;
    return `
      <div class="frame ${r.data.color ? 'c-' + r.data.color : ''} ${sel === r.id ? 'on' : ''}" data-frame="${r.id}" style="--pin:${PINS[hash(r.id) % PINS.length]}">
        <div class="fhead" data-fhead="${r.id}"><span class="fname">${esc(api.titleOf(r))}</span>${n ? `<span class="fcount">${n}</span>` : ''}
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
  const centre = id => { const r = rectOf(id); return r && { x: r.x + r.w / 2, y: r.y + (isFrame(id) ? HEAD / 2 : r.h / 2) }; };
  // Corkboard: where a card's push pin is (top middle), or a section's (on its label).
  const pinPoint = id => {
    const r = rectOf(id);
    if (!r) return null;
    if (!isFrame(id)) return { x: r.x + r.w / 2, y: r.y + 10 };
    const head = elOf(id).querySelector('.fhead'), pin = head.querySelector('.fpin');
    return { x: r.x + head.offsetLeft + pin.offsetLeft + pin.offsetWidth / 2, y: r.y + head.offsetTop + pin.offsetTop + pin.offsetHeight / 2 };
  };

  // ---------- Strings, one kind per look ----------

  // Corkboard wool: sags under its own weight, more the further it goes.
  function sag(a, b, extra = 0) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const droop = Math.min(140, 18 + dist * 0.18) + extra;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + droop;
    return { d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`, mid: { x: mx, y: (a.y + b.y) / 4 + my / 2 } };
  }

  // The sides of two boxes that face each other.
  function facing(A, B, gap) {
    const ac = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, bc = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const dx = bc.x - ac.x, dy = bc.y - ac.y;
    if (Math.abs(dx) * (A.h + B.h) > Math.abs(dy) * (A.w + B.w)) {
      const s = Math.sign(dx) || 1;
      return { horiz: true, p0: { x: s > 0 ? A.x + A.w : A.x, y: ac.y }, n0: { x: s, y: 0 }, p3: { x: s > 0 ? B.x - gap : B.x + B.w + gap, y: bc.y }, n3: { x: -s, y: 0 } };
    }
    const s = Math.sign(dy) || 1;
    return { horiz: false, p0: { x: ac.x, y: s > 0 ? A.y + A.h : A.y }, n0: { x: 0, y: s }, p3: { x: bc.x, y: s > 0 ? B.y - gap : B.y + B.h + gap }, n3: { x: 0, y: -s } };
  }

  // Whiteboard marker and notebook pen: a curve drawn by hand (a little wobble, open arrowhead).
  function inked(A, B, seed, { amp, head, cls }) {
    const { p0, n0, p3, n3 } = facing(A, B, 5);
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const k = Math.max(40, dist * 0.4);
    const p1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k }, p2 = { x: p3.x + n3.x * k, y: p3.y + n3.y * k };
    const N = Math.max(12, Math.min(40, Math.round(dist / 14)));
    const raw = [];
    for (let i = 0; i <= N; i++) raw.push(cubic(p0, p1, p2, p3, i / N));
    const rnd = rng(seed);
    const f1 = 1.1 + rnd() * 1.3, f2 = 2.8 + rnd() * 2.4, s1 = rnd() * 6.28, s2 = rnd() * 6.28;
    const pts = raw.map((p, i) => {
      const t = i / N, a = raw[Math.max(0, i - 1)], b = raw[Math.min(N, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const off = amp * Math.pow(Math.sin(Math.PI * t), 0.7) * (0.65 * Math.sin(t * f1 * 6.283 + s1) + 0.35 * Math.sin(t * f2 * 6.283 + s2));
      return { x: p.x - (b.y - a.y) / len * off, y: p.y + (b.x - a.x) / len * off };
    });
    const tip = pts[N];
    let back = pts[N - 1];
    for (let i = N - 1; i >= 0; i--) { back = pts[i]; if (Math.hypot(tip.x - back.x, tip.y - back.y) >= head) break; }
    const ang = Math.atan2(tip.y - back.y, tip.x - back.x), spread = 0.47;
    const hd = `M${f(tip.x - head * Math.cos(ang - spread))} ${f(tip.y - head * Math.sin(ang - spread))}L${f(tip.x)} ${f(tip.y)}L${f(tip.x - head * Math.cos(ang + spread))} ${f(tip.y - head * Math.sin(ang + spread))}`;
    const d = smooth(pts);
    return { d, mid: pts[Math.round(N / 2)], html: `<path class="wire ${cls}" d="${d}"/><path class="wire ${cls}" d="${hd}"/>` };
  }

  // Blueprint: straight ruled lines that turn at right angles, a dot where they start.
  function ruled(A, B) {
    const { p0, p3, horiz } = facing(A, B, 7);
    let d, mid;
    if (horiz) { const mx = Math.round((p0.x + p3.x) / 2); d = `M${p0.x} ${p0.y}H${mx}V${p3.y}H${p3.x}`; mid = { x: mx, y: (p0.y + p3.y) / 2 }; }
    else { const my = Math.round((p0.y + p3.y) / 2); d = `M${p0.x} ${p0.y}V${my}H${p3.x}V${p3.y}`; mid = { x: (p0.x + p3.x) / 2, y: my }; }
    return { d, mid, html: `<path class="wire rule" d="${d}" marker-end="url(#bt-arrow)"/><circle class="wire-dot" cx="${p0.x}" cy="${p0.y}" r="3.5"/>` };
  }

  function wire(fromId, toId) {
    const L = look();
    if (L === 'corkboard') {
      const a = pinPoint(fromId), b = pinPoint(toId);
      if (!a || !b) return null;
      const s = sag(a, b);
      return { ...s, html: `<path class="wire wool" d="${s.d}"/><path class="wire twist" d="${s.d}"/>` };
    }
    const A = rectOf(fromId), B = rectOf(toId);
    if (!A || !B) return null;
    if (L === 'blueprint') return ruled(A, B);
    return inked(A, B, hash(fromId + '>' + toId), L === 'whiteboard' ? { amp: 2.6, head: 15, cls: 'marker' } : { amp: 1.2, head: 11, cls: 'pen' });
  }

  function drawLines() {
    const L = look();
    const on = new Set([...cards, ...frames].map(r => r.id));
    let html = '';
    const labels = [];
    for (const r of [...frames, ...cards]) for (const l of r.data.links || []) {
      if (!on.has(l.to)) continue;
      const s = wire(r.id, l.to);
      if (!s) continue;
      const id = `${r.id}|${esc(l.to)}`;
      html += `<path class="wire hit" data-link="${id}" d="${s.d}"/>${s.html}`;
      if (l.label) labels.push(`<g class="slabel" data-link="${id}" transform="translate(${f(s.mid.x)} ${f(s.mid.y)})"><rect x="${-l.label.length * 3.6 - 8}" y="-11" width="${l.label.length * 7.2 + 16}" height="22" rx="${LABEL_RX[L]}"/><text text-anchor="middle" y="4">${esc(l.label)}</text></g>`);
    }
    let pins = '';
    if (L === 'corkboard') for (const r of [...frames, ...cards]) {
      const a = pinPoint(r.id);
      if (a) pins += `<circle class="pinhead" cx="${a.x}" cy="${a.y}" r="8" style="fill:${PINS[hash(r.id) % PINS.length]}"/><circle class="pinshine" cx="${a.x - 2.5}" cy="${a.y - 2.5}" r="2.4"/>`;
    }
    lines.innerHTML = html + pins + labels.join('');
  }

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    cork.style.backgroundPosition = `${view.x}px ${view.y}px`;
    cork.style.backgroundSize = `${Math.max(8, 220 * view.z)}px ${Math.max(8, 220 * view.z)}px, ${Math.max(4, 24 * view.z)}px ${Math.max(4, 24 * view.z)}px`;
  }
  function saveView() { if (key) writeLocal('bt-view:' + key, view); }

  function fit() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of [key, ...cards.map(r => r.id), ...frames.map(r => r.id)]) { const b = rectOf(id); if (!b) continue; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
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

  // The smallest section a point sits in (ignoring some ids).
  function frameAt(pt, skip = new Set()) {
    if (!pt) return null;
    let best = null, bestArea = Infinity;
    for (const r of frames) {
      if (skip.has(r.id)) continue;
      const b = rectOf(r.id);
      if (b && inRect(b, pt) && b.w * b.h < bestArea) { best = r.id; bestArea = b.w * b.h; }
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
    if (e.target.closest('[data-tick], [data-ci], [data-openboard]')) return;   // their own tap
    const pin = e.target.closest('[data-pin]');
    const link = e.target.closest('[data-link]');
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
    // A string lying across a card: a drag still moves the card, a tap edits the string.
    if (link && !link.matches('.slabel')) card = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.closest?.('[data-card]'))?.closest('[data-card]') || null;
    capture(e.pointerId);
    if (card || fhead) {
      const id = card ? card.dataset.card : fhead.dataset.fhead;
      gesture = { kind: 'move', id, el: elOf(id), sx: e.clientX, sy: e.clientY, moved: false, line: link, down: e.target, starts: carried(id) };
    } else if (link) {
      gesture = { kind: 'tap-line', line: link, sx: e.clientX, sy: e.clientY };
    } else {
      gesture = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
    busy = true;
  });

  // Moving a section carries everything in it.
  function carried(id) {
    const out = new Map([[id, { ...pos.get(id) }]]);
    if (isFrame(id)) for (const c of cards) if (c.data.parent === id && pos.has(c.id)) out.set(c.id, { ...pos.get(c.id) });
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
      // Show which section a card will land in.
      for (const fr of framesEl.querySelectorAll('.drop')) fr.classList.remove('drop');
      if (!isFrame(g.id) && g.id !== key) { const into = frameAt(centre(g.id)); if (into) framesEl.querySelector(`[data-frame="${into}"]`)?.classList.add('drop'); }
      drawLines();
    } else if (g.kind === 'resize') {
      const w = Math.max(320, Math.round(g.start.w + (e.clientX - g.sx) / view.z));
      const h = Math.max(200, Math.round(g.start.h + (e.clientY - g.sy) / view.z));
      pos.set(g.id, { ...g.start, w, h });
      placeEl(elOf(g.id)); drawLines();
    } else if (g.kind === 'connect') {
      const b = toWorld(e.clientX, e.clientY);
      drawLines();
      if (look() === 'corkboard') { const a = pinPoint(g.from); if (a) lines.insertAdjacentHTML('beforeend', `<path class="wire wool live" d="${sag(a, b).d}"/>`); }
      else { const A = rectOf(g.from); if (A) lines.insertAdjacentHTML('beforeend', `<path class="wire ${look() === 'whiteboard' ? 'marker' : look() === 'blueprint' ? 'rule' : 'pen'} live" d="M${A.x + A.w / 2} ${A.y + A.h / 2}L${b.x} ${b.y}"/>`); }
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      const over = targetAt(e.clientX, e.clientY);
      if (over && over !== g.from) elOf(over)?.classList.add('target');
    }
  });

  const targetAt = (cx, cy) => {
    const el = document.elementFromPoint(cx, cy);
    const c = el?.closest?.('[data-card]');
    if (c && c.dataset.banner === undefined) return c.dataset.card;
    return el?.closest?.('[data-fhead]')?.dataset.fhead || null;
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
      for (const fr of framesEl.querySelectorAll('.drop')) fr.classList.remove('drop');
      if (g.moved) await settle(g);
      else if (up && g.line) openStringPop(g.line.dataset.link, e.clientX, e.clientY);
      else if (up) { const sub = g.down?.closest?.('[data-sub]'); api.open(sub ? sub.dataset.sub : g.id); }
    } else if (g.kind === 'resize') {
      await settle({ id: g.id, starts: new Map([[g.id, null]]) });
    } else if (g.kind === 'connect') {
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      const over = targetAt(e.clientX, e.clientY);
      if (over && over !== g.from) connectMenu(g.from, over, e.clientX, e.clientY);
      drawLines();
    } else if (g.kind === 'tap-line' && up && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 8) {
      openStringPop(g.line.dataset.link, e.clientX, e.clientY);
    }
    flush();
  };
  cork.addEventListener('pointerup', end);
  cork.addEventListener('pointercancel', end);

  // Taps that belong to something on a card: a checklist box, "Open its board".
  cork.addEventListener('click', e => {
    const box = e.target.closest('[data-ci]');
    if (box) { toggleCheck(box.closest('[data-card]').dataset.card, +box.dataset.ci); return; }
    const ob = e.target.closest('[data-openboard]');
    if (ob) api.openBoard(ob.dataset.openboard);
  });

  function startPinch() {
    if (gesture?.kind === 'move' && gesture.moved) settle(gesture);
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

  const spotOf = p => ({ x: p.x, y: p.y, ...(p.w ? { w: p.w, h: p.h } : {}) });

  // After a drag or resize: keep the spots, and make "inside a section" match what you see.
  // A card dropped in a section goes into it; one dragged out goes back to the project. A section
  // moved or resized over cards takes them in, and lets go of any it no longer covers.
  async function settle(g) {
    busy = true;
    try {
      const I = api.index();
      const patch = new Map();
      const add = (id, p) => patch.set(id, { ...(patch.get(id) || {}), ...p });
      const spot = (id, p) => { const r = api.store.get(id); if (r && p) add(id, { cork: { ...(r.data.cork || {}), [id === key ? 'banner' : key]: spotOf(p) } }); };
      // Whatever was placed automatically (or a section that grew) keeps the spot it has now, so nothing jumps.
      for (const r of [...cards, ...frames]) {
        const s = r.data.cork?.[key], p = pos.get(r.id);
        if (p && (!s || s.x !== p.x || s.y !== p.y || (p.w && (s.w !== p.w || s.h !== p.h)))) spot(r.id, p);
      }
      for (const id of g.starts.keys()) spot(id, pos.get(id));
      const before = new Map(), moves = [];
      const reparent = (id, to) => {
        const r = api.store.get(id);
        if (!r || (r.data.parent || null) === (to || null)) return;
        before.set(id, { parent: r.data.parent, cork: r.data.cork });
        add(id, { parent: to });
        moves.push([id, to, r.data.parent]);
      };
      if (isFrame(g.id)) {
        const fr = rectOf(g.id);
        for (const c of cards) {
          const p = centre(c.id);
          if (!p) continue;
          if (c.data.parent !== g.id && inRect(fr, p) && frameAt(p) === g.id) reparent(c.id, g.id);
          else if (c.data.parent === g.id && !inRect(fr, p)) reparent(c.id, frameAt(p) || key);
        }
      } else if (g.id !== key) {
        const into = frameAt(centre(g.id));
        const now = api.store.get(g.id)?.data.parent;
        if (into && into !== now) reparent(g.id, into);
        else if (!into && frameIds.has(now)) reparent(g.id, key);
      }
      for (const [id, p] of patch) await api.store.update(id, p);
      if (moves.length) {
        const name = id => short(api.titleOf(I.byId.get(id) || { data: {} }));
        const [id, to, was] = moves[0];
        const msg = moves.length > 1 ? `${moves.length} cards moved` : to === key ? `Taken out of “${name(was)}”` : `Moved into “${name(to)}”${guests.has(id) ? ` (now in “${name(key)}”)` : ''}`;
        api.toast(msg, 'Undo', async () => { for (const [bid, b] of before) await api.store.update(bid, { parent: b.parent, cork: b.cork }); });
      }
    } finally { busy = false; flush(); }
  }

  // After dragging one card's pin or dot onto another: a string, or put one inside the other.
  function connectMenu(a, b, cx, cy) {
    const I = api.index();
    const A = I.byId.get(a), B = I.byId.get(b);
    if (!A || !B) return;
    const links = A.data.links || [];
    const tied = links.some(l => l.to === b) || (B.data.links || []).some(l => l.to === a);
    const can = (child, parent) => child !== parent && child !== key && I.byId.get(child).data.type !== 'section'
      && !I.descendants(child).some(r => r.id === parent) && I.byId.get(child).data.parent !== parent;
    const label = (child, parent) => {
      const c = short(api.titleOf(I.byId.get(child))), p = short(api.titleOf(I.byId.get(parent)));
      return I.byId.get(parent).data.type === 'section' ? `Put “${c}” in the “${p}” section` : `Put “${c}” inside “${p}”`;
    };
    const opts = [];
    if (!tied) opts.push({ label: words().tie, fn: () => { writeLocal('bt-hint-seen', true); return api.store.update(a, { links: [...links, { to: b }] }); } });
    if (can(b, a)) opts.push({ label: label(b, a), fn: () => nest(b, a) });
    if (can(a, b)) opts.push({ label: label(a, b), fn: () => nest(a, b) });
    if (!opts.length) { api.toast('Those two are already connected.'); return; }
    menu(cx, cy, opts);
  }

  // Into a section it's placed inside the frame; into a card it's listed on that card.
  async function nest(child, parent) {
    const r = api.store.get(child);
    const was = { parent: r.data.parent, cork: r.data.cork };
    const cork2 = { ...(r.data.cork || {}) };
    delete cork2[key];
    await api.store.update(child, { parent, cork: Object.keys(cork2).length ? cork2 : undefined });
    api.toast(`“${short(api.titleOf(r))}” is now inside “${short(api.titleOf(api.store.get(parent)))}”`, 'Undo', () => api.store.update(child, was));
  }

  async function toggleCheck(id, idx) {
    const r = api.store.get(id);
    if (!r) return;
    const doc = new DOMParser().parseFromString('<body>' + sanitize(r.data.body || '') + '</body>', 'text/html');
    const li = doc.body.querySelectorAll('ul.checklist > li')[idx];
    if (!li) return;
    if (li.getAttribute('data-checked') === 'true') li.removeAttribute('data-checked'); else li.setAttribute('data-checked', 'true');
    await api.store.update(id, { body: doc.body.innerHTML });
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
      api.toast(words().cut, 'Undo', () => api.store.update(from, { links }));
    } else await api.store.update(from, { links: links.map(l => (l.to === to ? { to, ...(label ? { label } : {}) } : l)) });
  }
  pop.addEventListener('click', e => { const b = e.target.closest('[data-s]'); if (b) saveString(b.dataset.s === 'remove'); });
  pop.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') saveString(false); if (e.key === 'Escape') { pop.hidden = true; popLink = null; } });

  const viewCentre = () => toWorld(cork.getBoundingClientRect().left + cork.clientWidth / 2, cork.getBoundingClientRect().top + cork.clientHeight / 3);

  async function addAt(type, at) {
    const p = at || viewCentre();
    const parent = frameAt(p) || key;
    const id = await api.newItem(type, parent, { cork: { [key]: { x: Math.round(p.x - CARD_W / 2), y: Math.round(p.y) } } });
    api.open(id);
  }

  // A new section goes in the nearest empty space, so it doesn't swallow cards by accident.
  function freeSpot(w, h, near) {
    const boxes = [key, ...cards.map(r => r.id), ...frames.map(r => r.id)].map(rectOf).filter(Boolean);
    // (with room above it for a label that sits over the top edge)
    const clear = (x, y) => !boxes.some(b => x < b.x + b.w + 24 && x + w + 24 > b.x && y - 48 < b.y + b.h + 24 && y + h + 24 > b.y);
    const x0 = Math.round(near.x - w / 2), y0 = Math.round(near.y - h / 3);
    const tries = [];
    for (let i = -14; i <= 14; i++) for (let j = -14; j <= 14; j++) tries.push([i * 60, j * 60]);
    tries.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    for (const [dx, dy] of tries) if (clear(x0 + dx, y0 + dy)) return { x: x0 + dx, y: y0 + dy };
    let maxY = 0; for (const b of boxes) maxY = Math.max(maxY, b.y + b.h);
    return { x: x0, y: maxY + 80 };
  }

  async function addSection() {
    const at = freeSpot(SECTION_W, SECTION_H, viewCentre());
    const id = await api.newItem('section', key, { title: 'New section', cork: { [key]: { ...at, w: SECTION_W, h: SECTION_H } } });
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
    else if (a === 'add-note') addAt('note');
    else if (a === 'add-task') addAt('task');
    else if (a === 'add-section') addSection();
    else if (a === 'place') {
      const I = api.index();
      api.placePicker(key, [key, ...I.descendants(key).map(r => r.id), ...cards.map(r => r.id)], async id => {
        const c = viewCentre();
        const r = api.store.get(id);
        await api.store.update(id, { cork: { ...(r.data.cork || {}), [key]: { x: Math.round(c.x - CARD_W / 2), y: Math.round(c.y) } } });
      });
    } else if (a === 'tidy') {
      // Cards brought in from elsewhere keep their spot (that's what keeps them here); the rest are laid out again.
      const I = api.index();
      const slot = r => (r.id === key ? 'banner' : key);
      const mine = [I.byId.get(key), ...frames, ...cards.filter(r => !guests.has(r.id))].filter(r => r?.data.cork?.[slot(r)]);
      const before = new Map(mine.map(r => [r.id, r.data.cork]));
      busy = true;
      try {
        for (const r of mine) { const c = { ...r.data.cork }; delete c[slot(r)]; await api.store.update(r.id, { cork: Object.keys(c).length ? c : undefined }); }
      } finally { busy = false; }
      needsFit = true; render();
      api.toast('Board tidied.', 'Undo', async () => { for (const [id, c] of before) await api.store.update(id, { cork: c }); });
    }
  });

  return {
    show(boardKey) {
      if (boardKey !== key) {
        key = boardKey;
        heights.clear();
        const saved = readLocal('bt-view:' + key, null);
        if (saved) { view = saved; needsFit = false; } else needsFit = true;
        applyView();
      }
      render();
    },
    refresh: render,
    get key() { return key; },
  };
}

// ---------- Note bodies on cards ----------

// The note as it reads on a card: text, lists and checklists (tickable), links as plain text,
// photos left out (the first one is the card's picture). Remembered, since boards redraw often.
const bodyCache = new Map();
function bodyHTML(html) {
  if (!html) return '';
  if (bodyCache.has(html)) return bodyCache.get(html);
  const doc = new DOMParser().parseFromString('<body>' + sanitize(html) + '</body>', 'text/html');
  const b = doc.body;
  const photos = b.querySelectorAll('img').length;
  for (const img of b.querySelectorAll('img')) img.remove();
  for (const el of b.querySelectorAll('p, div')) if (!el.textContent.trim() && !el.querySelector('ul, ol, hr')) el.remove();
  for (const h of b.querySelectorAll('h1, h2, h3')) { const p = doc.createElement('p'); p.className = 'ph'; p.append(...h.childNodes); h.replaceWith(p); }
  for (const a of b.querySelectorAll('a')) { const s = doc.createElement('span'); s.className = 'plink'; s.append(...a.childNodes); a.replaceWith(s); }
  b.querySelectorAll('ul.checklist > li').forEach((li, i) => {
    const box = doc.createElement('i'), text = doc.createElement('span');
    box.className = 'cbox'; box.dataset.ci = i;
    text.append(...li.childNodes);
    li.append(box, text);
    if (li.getAttribute('data-checked') === 'true') li.className = 'on';
  });
  let out = b.textContent.trim() || b.querySelector('li') ? b.innerHTML.trim() : '';
  if (photos > 1) out += `<p class="pmore">+ ${photos - 1} more photo${photos === 2 ? '' : 's'}</p>`;
  if (bodyCache.size > 400) bodyCache.clear();
  bodyCache.set(html, out);
  return out;
}

// ---------- Helpers ----------

const short = s => (s.length > 28 ? s.slice(0, 26) + '…' : s);
const inRect = (b, p) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const f = n => Math.round(n * 10) / 10;
function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return { x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y };
}
// A smooth path through points (Catmull-Rom as curves).
function smooth(pts) {
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}
function rng(seed) { let s = (seed % 2147483646) + 1; return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; }

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
function readLocal(k, fb) { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch (e) { return fb; } }
function writeLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
