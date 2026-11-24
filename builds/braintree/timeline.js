// (0.9.0) Timeline: every project and dated to-do as a bar across the weeks, grouped by project.
// Drag a bar to move its dates (drag an end to change just that one); tap it to open it. On a touch
// screen, hold a bar for a moment first (so a swipe still scrolls).

import { escHtml as esc } from './editor.js';
function readLocal(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch (e) { return f; } }
function writeLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

const ZOOMS = { weeks: 34, months: 11 };
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const diff = (a, b) => Math.round((parse(b) - parse(a)) / DAY);

export function createTimeline(host, api) {
  let zoom = readLocal('bt-tl-zoom', 'weeks') in ZOOMS ? readLocal('bt-tl-zoom', 'weeks') : 'weeks';
  let range = null, drag = null, firstShow = true;
  host.innerHTML = `
    <header class="boardhead tlhead">
      <button class="back" data-act="back-nav" aria-label="Lists"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Lists</span></button>
      <h2>Timeline</h2>
      <div class="seg tlzoom" role="group" aria-label="Zoom">${Object.keys(ZOOMS).map(z => `<button data-tlzoom="${z}">${z[0].toUpperCase() + z.slice(1)}</button>`).join('')}</div>
      <button class="tltoday">Today</button>
    </header>
    <div class="tlscroll"><div class="tlgrid"></div></div>
    <p class="tlhint"></p>`;
  const scroller = host.querySelector('.tlscroll'), grid = host.querySelector('.tlgrid'), hint = host.querySelector('.tlhint');
  const labelW = () => (host.clientWidth < 600 ? 112 : 190);

  function rows() {
    const I = api.index(), t = api.today();
    const dated = r => (r.data.type === 'task' || r.data.type === 'project') && (r.data.due || r.data.start);
    const tops = I.work.filter(r => r.data.type === 'project' && !I.project(r) && !api.locked(r));
    const groups = [];
    for (const p of tops.sort((a, b) => (a.data.done ? 1 : 0) - (b.data.done ? 1 : 0) || (a.data.order || 0) - (b.data.order || 0))) {
      const items = I.descendants(p.id).filter(dated).filter(r => !r.data.done || (r.data.doneAt || '').slice(0, 10) >= addDays(t, -30));
      if (!items.length && !dated(p)) continue;
      if (p.data.done && !items.some(r => !r.data.done)) continue;
      groups.push({ p, items: items.sort((a, b) => key(a).localeCompare(key(b))) });
    }
    const loose = I.work.filter(r => dated(r) && !I.project(r) && r.data.type === 'task' && !r.data.done);
    if (loose.length) groups.push({ p: null, items: loose.sort((a, b) => key(a).localeCompare(key(b))) });
    return groups;
  }
  const key = r => r.data.start || r.data.due;
  const span = r => {
    const s = r.data.start || r.data.due, e = r.data.due || r.data.start;
    return s <= e ? [s, e] : [e, s];
  };

  function computeRange(groups) {
    const t = api.today();
    let a = addDays(t, -14), b = addDays(t, zoom === 'weeks' ? 70 : 200);
    for (const g of groups) for (const r of [g.p, ...g.items]) {
      if (!r || !(r.data.due || r.data.start)) continue;
      const [s, e] = span(r);
      if (s < a) a = s; if (e > b) b = e;
    }
    a = a < addDays(t, -180) ? addDays(t, -180) : a;
    b = b > addDays(t, 540) ? addDays(t, 540) : b;
    // start on a Monday, a little before; end a little after
    a = addDays(a, -((parse(a).getDay() + 6) % 7) - 7);
    return { a, days: diff(a, b) + 21 };
  }

  function draw() {
    const groups = rows(), t = api.today(), I = api.index(), dw = ZOOMS[zoom], lw = labelW();
    range = computeRange(groups);
    const W = range.days * dw, x = s => diff(range.a, s) * dw;
    for (const b of host.querySelectorAll('[data-tlzoom]')) b.classList.toggle('on', b.dataset.tlzoom === zoom);
    // Header: months, and days (weeks zoom) or week starts (months zoom).
    let months = '', days = '', shade = '';
    for (let i = 0; i < range.days; i++) {
      const s = addDays(range.a, i), d = parse(s);
      if (d.getDate() === 1 || i === 0) months += `<span class="tlmonth" style="left:${i * dw}px">${esc(d.toLocaleDateString(undefined, { month: 'long', ...(d.getMonth() === 0 || i === 0 ? { year: 'numeric' } : {}) }))}</span>`;
      if (zoom === 'weeks') days += `<span class="tlday ${s === t ? 'now' : ''} ${[0, 6].includes(d.getDay()) ? 'we' : ''}" style="left:${i * dw}px;width:${dw}px">${d.getDate()}<small>${d.toLocaleDateString(undefined, { weekday: 'narrow' })}</small></span>`;
      else if (d.getDay() === 1) days += `<span class="tlday" style="left:${i * dw}px">${d.getDate()}</span>`;
      if ([0, 6].includes(d.getDay()) && zoom === 'weeks') shade += `<i class="tlwe" style="left:${i * dw}px;width:${dw}px"></i>`;
      else if (d.getDay() === 1 && zoom === 'months') shade += `<i class="tlwk" style="left:${i * dw}px"></i>`;
    }
    const bar = (r, cls = '') => {
      const [s, e] = span(r), d = r.data, late = !d.done && d.due && d.due < t, wait = api.isWaiting(r);
      const left = x(s), w = Math.max(dw, (diff(s, e) + 1) * dw), title = api.titleOf(r);
      const inside = w > Math.min(240, title.length * 7 + 26);
      return `<div class="tlbar t-${d.type} ${d.color ? 'c-' + d.color : ''} ${d.done ? 'is-done' : ''} ${late ? 'late' : ''} ${wait ? 'waiting' : ''} ${cls} ${inside ? '' : 'out'}" data-tl="${r.id}" style="left:${left}px;width:${w}px" title="${esc(title)} · ${esc(d.start && d.due && d.start !== d.due ? api.fmtDay(d.start) + ' → ' + api.fmtDay(d.due) : api.fmtDay(d.due || d.start))}">
        <i class="tlh l" data-edge="start"></i><span>${esc(title)}</span><i class="tlh r" data-edge="end"></i></div>`;
    };
    let body = '', y = 0;
    const lines = [];
    for (const g of groups) {
      const name = g.p ? api.titleOf(g.p) : 'Not in a project';
      lines.push(`<div class="tlrow tlgroup" style="top:${y}px"><span class="tllabel" ${g.p ? `data-tlopen="${g.p.id}"` : ''}>${esc(name)}</span>${g.p && (g.p.data.due || g.p.data.start) ? bar(g.p, 'proj') : ''}</div>`);
      y += 40;
      for (const r of g.items) {
        const par = I.parentOf(r), where = par && g.p && par.id !== g.p.id ? api.titleOf(par) : '';
        lines.push(`<div class="tlrow" style="top:${y}px"><span class="tllabel small" data-tlopen="${r.id}">${esc(api.titleOf(r))}${where ? `<em>${esc(where)}</em>` : ''}</span>${bar(r)}</div>`);
        y += 34;
      }
    }
    body = lines.join('');
    grid.style.setProperty('--lw', lw + 'px');
    grid.style.width = (W + lw) + 'px';
    grid.innerHTML = `
      <div class="tltop"><div class="tlcorner"></div><div class="tlscale" style="width:${W}px"><div class="tlmonths">${months}</div><div class="tldays">${days}</div></div></div>
      <div class="tlbody" style="height:${Math.max(y, 80)}px">
        <div class="tlcanvas" style="left:${lw}px;width:${W}px">${shade}<i class="tlnow" style="left:${x(t) + dw / 2}px"></i></div>
        ${body}
      </div>`;
    // bars sit in the canvas's coordinates
    for (const b of grid.querySelectorAll('.tlbar')) b.style.left = (parseFloat(b.style.left) + lw) + 'px';
    hint.textContent = !groups.length ? 'Nothing has dates yet. Give to-dos and projects a start or due date and they show up here.' : '';
    hint.hidden = !!groups.length;
    if (firstShow) { firstShow = false; requestAnimationFrame(goToday); }
  }

  function goToday() {
    if (!range) return;
    const dw = ZOOMS[zoom];
    scroller.scrollLeft = Math.max(0, diff(range.a, api.today()) * dw - 3 * dw * (zoom === 'weeks' ? 1 : 2));
  }

  // ----- dragging bars -----
  host.addEventListener('pointerdown', e => {
    const b = e.target.closest('.tlbar');
    if (!b || e.button > 0) return;
    const r = api.index().byId.get(b.dataset.tl);
    if (!r) return;
    const edge = e.target.closest('[data-edge]')?.dataset.edge || 'move';
    drag = { id: r.id, el: b, x0: e.clientX, y0: e.clientY, edge, data: { start: r.data.start, due: r.data.due }, ok: e.pointerType !== 'touch', moved: false, pid: e.pointerId, left: parseFloat(b.style.left), width: parseFloat(b.style.width) };
    if (!drag.ok) drag.timer = setTimeout(() => { if (drag) { drag.ok = true; b.classList.add('lift'); navigator.vibrate?.(8); } }, 330);
  });
  host.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.ok) { if (Math.hypot(dx, dy) > 8) { clearTimeout(drag.timer); drag = null; } return; }
    if (!drag.moved && Math.abs(dx) < 4) return;
    if (!drag.moved) { drag.moved = true; drag.el.classList.add('lift'); try { drag.el.setPointerCapture(e.pointerId); } catch (err) {} }
    const dw = ZOOMS[zoom], n = Math.round(dx / dw);
    drag.n = n;
    const { left, width } = drag;
    if (drag.edge === 'move') drag.el.style.left = (left + n * dw) + 'px';
    else if (drag.edge === 'start') { const w = Math.max(dw, width - n * dw); drag.el.style.left = (left + width - w) + 'px'; drag.el.style.width = w + 'px'; }
    else drag.el.style.width = Math.max(dw, width + n * dw) + 'px';
  });
  // While a bar is held on a touch screen, the page mustn't scroll.
  host.addEventListener('touchmove', e => { if (drag?.ok) e.preventDefault(); }, { passive: false });
  const end = e => {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    const d = drag; drag = null;
    clearTimeout(d.timer);
    d.el.classList.remove('lift');
    if (!d.moved) { if (e?.type === 'pointerup' && (d.ok || Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8)) api.open(d.id); return; }
    const n = d.n || 0;
    if (!n) { draw(); return; }
    const { start, due } = d.data, patch = {};
    if (d.edge === 'move') { if (start) patch.start = addDays(start, n); if (due) patch.due = addDays(due, n); }
    else if (d.edge === 'start') {
      if (start && due) { patch.start = addDays(start, n); if (patch.start > due) patch.start = due; }
      else if (due) { patch.start = addDays(due, n); if (patch.start > due) { patch.start = undefined; patch.due = addDays(due, n); } }
      else patch.start = addDays(start, n);
    } else {
      if (due) { patch.due = addDays(due, n); if (start && patch.due < start) patch.due = start; }
      else { patch.due = addDays(start, n); if (patch.due < start) { patch.start = patch.due; patch.due = start; } }
    }
    api.store.update(d.id, patch);
    const r = api.index().byId.get(d.id);
    api.toast(`${api.titleOf(r)}: ${patch.start && patch.due ? api.fmtDay(patch.start) + ' → ' + api.fmtDay(patch.due) : api.fmtDay(patch.due || patch.start || due || start)}`, 'Undo', () => api.store.update(d.id, d.data));
  };
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', e => { if (drag) { const d = drag; drag = null; clearTimeout(d.timer); d.el.classList.remove('lift'); draw(); } });
  host.addEventListener('click', e => {
    const z = e.target.closest('[data-tlzoom]');
    if (z) { zoom = z.dataset.tlzoom; writeLocal('bt-tl-zoom', zoom); draw(); goToday(); return; }
    if (e.target.closest('.tltoday')) { scroller.scrollTo({ left: Math.max(0, diff(range.a, api.today()) * ZOOMS[zoom] - 3 * ZOOMS[zoom]), behavior: 'smooth' }); return; }
    const o = e.target.closest('[data-tlopen]');
    if (o) api.open(o.dataset.tlopen);
  });
  host.addEventListener('contextmenu', e => { const b = e.target.closest('.tlbar'); if (b) { e.preventDefault(); api.menu?.(b.dataset.tl); } });

  return {
    show() { if (!drag) draw(); },
  };
}
