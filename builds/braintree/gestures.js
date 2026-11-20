// Finger (and mouse) gestures for list rows and the sidebar's projects, like iPhone apps:
// - swipe a row left to delete it, right for quick actions and "More"
// - hold a row (or right-click it) for its menu; keep holding and move to drag it into place
// - with a mouse, drag a row to put it in order
// The app says what each row offers and what a drop means; this file only does the finger work.

const HOLD_MS = 450;   // how long a press must be to pick a row up (about iOS's own)
const SLOP = 9;        // how far a finger can wander before it counts as a move
const BTN_W = 74;      // width of each swipe button

export function createGestures(o) {
  // o.rows       selector for the rows that respond
  // o.scrollers  selector for the scrolling boxes they sit in (for scrolling while dragging)
  // o.actions(el)       -> { lead: [...], trail: [...] } buttons for a swipe, or null
  // o.run(el, id)       a swipe button (or a full swipe) was used
  // o.menu(el)          hold or right-click
  // o.slots(el)         -> places it can be dropped [{ y(), x() -> [left, right], ...anything }], or null
  // o.drop(el, slot)    dropped on a slot
  // o.dragEnd()         after any drag, dropped or not
  // o.idle()            no gesture going on any more (the app holds redraws until then)
  let g = null;          // the gesture in progress
  let open = null;       // a row left swiped open: { el, key, sx }
  let eat = false;       // swallow the click that follows a gesture
  let lastTouch = 0;

  const idOf = el => el.dataset.open || el.dataset.project || '';
  const keyOf = el => (el.closest('[id]')?.id || '') + '|' + idOf(el);
  const findKey = key => {
    const [host, id] = key.split('|');
    return [...(document.getElementById(host)?.querySelectorAll(o.rows) || [])].find(e => idOf(e) === id) || null;
  };

  function setX(el, sx, animate) {
    el.classList.toggle('swiping', !animate);
    el.style.setProperty('--sx', sx + 'px');
    const lead = el.querySelector(':scope > .swipe-acts.lead'), trail = el.querySelector(':scope > .swipe-acts.trail');
    // Past the full-swipe point the first button takes the whole width, like Mail.
    const full = Math.abs(sx) > fullAt(el, sx > 0 ? lead : trail);
    lead?.classList.toggle('full', sx > 0 && full);
    trail?.classList.toggle('full', sx < 0 && full);
  }
  const widthOf = acts => (acts ? acts.children.length * BTN_W : 0);
  const fullAt = (el, acts) => Math.max(widthOf(acts) + 60, el.offsetWidth * 0.62);

  function addActs(el, acts) {
    el.classList.add('swipeable');
    if (el.querySelector(':scope > .swipe-acts')) return;
    const btn = a => `<button type="button" data-swipe="${a.id}" class="sw-${a.tone || 'grey'}">${a.icon || ''}<span>${a.label}</span></button>`;
    el.insertAdjacentHTML('beforeend', `<div class="swipe-acts lead">${acts.lead.map(btn).join('')}</div><div class="swipe-acts trail">${acts.trail.map(btn).join('')}</div>`);
  }

  function close(el, now) {
    if (!el) return;
    if (open?.el === el) open = null;
    setX(el, 0, !now);
    const tidy = () => {
      if (el.style.getPropertyValue('--sx') !== '0px') return;   // swiped again meanwhile
      el.classList.remove('swipeable', 'swiping');
      el.querySelectorAll(':scope > .swipe-acts').forEach(a => a.remove());
      el.style.removeProperty('--sx');
    };
    if (now) tidy(); else setTimeout(tidy, 260);
  }

  function fire(el, id, full) {
    if (full) {
      // Slide it the rest of the way, then act (a deleted row then disappears on the redraw).
      const sx = parseFloat(el.style.getPropertyValue('--sx')) || 0;
      setX(el, Math.sign(sx) * el.offsetWidth, true);
      setTimeout(() => { o.run(el, id); close(el, true); }, 170);
    } else { close(el); o.run(el, id); }
  }

  function done() {
    g = null;
    o.idle?.();
  }

  // ---------- Press ----------

  document.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') lastTouch = Date.now();
    eat = false;
    if (g) return;
    // A row left open closes on the next touch anywhere except its own buttons (and that touch does nothing else).
    if (open && !e.target.closest('.swipe-acts')) {
      if (open.el.isConnected) { close(open.el); eat = true; return; }
      open = null;
    }
    if (e.button !== 0) return;
    const el = e.target.closest(o.rows);
    if (!el) return;
    const hit = e.target.closest('button, input, select, textarea, a[href], label');
    if (hit && hit !== el && el.contains(hit)) return;   // ticks, + buttons and the like keep working
    g = { el, id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mode: 'press' };
    if (g.type !== 'mouse') g.timer = setTimeout(lift, HOLD_MS);
  }, true);

  function lift() {
    if (!g || g.mode !== 'press') return;
    g.mode = 'held';
    g.el.classList.add('lifted');
    try { navigator.vibrate?.(8); } catch (err) {}
  }

  document.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX; g.y = e.clientY;
    const dx = g.x - g.x0, dy = g.y - g.y0, far = Math.hypot(dx, dy) > SLOP;
    if (g.mode === 'press') {
      if (!far) return;
      clearTimeout(g.timer);
      if (g.type === 'mouse') { if (!startDrag()) done(); return; }
      if (Math.abs(dx) > Math.abs(dy) * 1.2 && (g.acts = o.actions(g.el)) && (dx > 0 ? g.acts.lead.length : g.acts.trail.length)) {
        g.mode = 'swipe';
        g.shift = -Math.sign(dx) * SLOP;   // no jump when it starts
        addActs(g.el, g.acts);
        swipeTo(dx);
      } else done();   // it's a scroll: leave it to the browser
      return;
    }
    if (g.mode === 'held') { if (far) startDrag(); return; }
    if (g.mode === 'swipe') { swipeTo(dx); return; }
    if (g.mode === 'drag') moveDrag();
  }, true);

  function swipeTo(dx) {
    let sx = dx + g.shift;
    if (!g.acts.lead.length) sx = Math.min(0, sx);
    if (!g.acts.trail.length) sx = Math.max(0, sx);
    setX(g.el, sx, false);
  }

  function release(e, cancelled) {
    if (!g || e.pointerId !== g.id) return;
    clearTimeout(g.timer);
    const G = g;
    g = null;
    G.el.classList.remove('lifted');
    if (G.mode === 'held') { if (!cancelled) { eat = true; o.menu(G.el); } }
    else if (G.mode === 'swipe') { eat = true; settle(G, cancelled); }
    else if (G.mode === 'drag') { eat = true; endDrag(G, cancelled); }
    o.idle?.();
  }
  document.addEventListener('pointerup', e => release(e, false), true);
  document.addEventListener('pointercancel', e => release(e, true), true);

  function settle(G, cancelled) {
    const el = G.el, sx = parseFloat(el.style.getPropertyValue('--sx')) || 0;
    const lead = el.querySelector(':scope > .swipe-acts.lead'), trail = el.querySelector(':scope > .swipe-acts.trail');
    const acts = sx > 0 ? lead : trail, list = sx > 0 ? G.acts.lead : G.acts.trail, w = widthOf(acts);
    if (cancelled || !list.length || Math.abs(sx) < w / 2) { close(el); return; }
    if (Math.abs(sx) > fullAt(el, acts)) { fire(el, (sx > 0 ? list[0] : list[list.length - 1]).id, true); return; }
    const to = Math.sign(sx) * w;
    setX(el, to, true);
    open = { el, key: keyOf(el), sx: to };
  }

  // ---------- Drag into place ----------

  function startDrag() {
    const slots = o.slots(g.el);
    if (!slots || !slots.length) return false;
    const r = g.el.getBoundingClientRect();
    g.mode = 'drag';
    g.slots = slots;
    g.offY = g.y0 - r.top;
    g.ghost = g.el.cloneNode(true);
    g.ghost.classList.add('dragghost');
    g.ghost.classList.remove('lifted', 'on', 'swipeable');
    g.ghost.removeAttribute('id');
    Object.assign(g.ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.append(g.ghost);
    g.el.classList.remove('lifted');
    g.el.classList.add('dragging');
    g.line = document.createElement('div');
    g.line.className = 'dropline';
    document.body.append(g.line);
    g.scroller = g.el.closest(o.scrollers);
    document.body.classList.add('is-dragging');
    moveDrag();
    const tick = () => {
      if (!g || g.mode !== 'drag') return;
      const sc = g.scroller;
      if (sc) {
        // Near the top or bottom edge: scroll, faster the closer it gets.
        const b = sc.getBoundingClientRect(), edge = 56;
        const v = g.y < b.top + edge ? -Math.ceil((b.top + edge - g.y) / 4) : g.y > b.bottom - edge ? Math.ceil((g.y - b.bottom + edge) / 4) : 0;
        if (v) { const before = sc.scrollTop; sc.scrollTop += v; if (sc.scrollTop !== before) moveDrag(); }
      }
      g.raf = requestAnimationFrame(tick);
    };
    g.raf = requestAnimationFrame(tick);
    return true;
  }

  function moveDrag() {
    g.ghost.style.top = (g.y - g.offY) + 'px';
    let best = null, bd = Infinity;
    for (const s of g.slots) { const d = Math.abs(s.y() - g.y); if (d < bd) { bd = d; best = s; } }
    g.slot = best;
    if (best) {
      const [x0, x1] = best.x();
      Object.assign(g.line.style, { top: (best.y() - 1.5) + 'px', left: x0 + 'px', width: Math.max(20, x1 - x0) + 'px' });
    }
  }

  function endDrag(G, cancelled) {
    cancelAnimationFrame(G.raf);
    G.ghost.remove();
    G.line.remove();
    G.el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    if (!cancelled && G.slot) o.drop(G.el, G.slot);
    o.dragEnd?.();
  }

  // Keep the page still while a row is held, swiped or dragged (the browser would scroll it).
  document.addEventListener('touchmove', e => { if (g && g.mode !== 'press') e.preventDefault(); }, { passive: false });

  // ---------- Clicks ----------

  window.addEventListener('click', e => {
    const b = e.target.closest('.swipe-acts [data-swipe]');
    if (b) {
      e.stopPropagation(); e.preventDefault();
      const el = b.closest(o.rows);
      if (el) fire(el, b.dataset.swipe, false);
      return;
    }
    if (eat) { eat = false; e.stopPropagation(); e.preventDefault(); }
  }, true);

  document.addEventListener('contextmenu', e => {
    const el = e.target.closest(o.rows);
    if (!el) return;
    e.preventDefault();
    if (Date.now() - lastTouch < 1500) return;   // a held finger: handled above
    o.menu(el);
  });

  return {
    busy: () => !!g,
    // After a redraw: put a row that was swiped open back the way it was.
    restore() {
      if (!open || open.el.isConnected) return;
      const el = findKey(open.key), acts = el && o.actions(el);
      if (!el || !acts) { open = null; return; }
      addActs(el, acts);
      setX(el, open.sx, false);
      open.el = el;
    },
    closeAll() { if (open?.el.isConnected) close(open.el); open = null; },
  };
}
