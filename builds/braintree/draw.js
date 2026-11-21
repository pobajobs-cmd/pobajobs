// Drawings, in the spirit of draw.io: boxes, circles, diamonds and text you can type in, arrows
// that stay joined to what they connect when you move things, and a freehand pen.
// A drawing lives inside a note (so a note can mix text, photos, clips and drawings) as
//   <div data-draw='{"v":1,"s":[…]}'></div>
// and is drawn as SVG on light paper wherever the note shows: the note itself, its board card.
// openDrawing() is the full-screen editor. With a "stage" (0.7.2) it opens over a board instead,
// see-through, moving with the board, so you draw straight onto it (board.js turns the result
// into a drawing card that sits exactly where you drew it).
//
// Shapes ("s"), in drawing order:
//   {id, k: box|ellipse|diamond|triangle|star|text, x, y, w, h, t: label, f: fill colour, c: ink colour, z: text size 1-3}
//   {id, k: line, a, b, t: label, c, e: arrow|none|both, d: dashed, cv: curved}   a/b: a shape id (joined) or [x, y]
//   {id, k: pen, p: [x0, y0, x1, y1, …], c, w: width, hl: highlighter (see-through)}

export const FILLS = { white: '#FFFFFF', yellow: '#FFF0A8', orange: '#FFD9B3', pink: '#FFD0DD', purple: '#E3D5FF', blue: '#CFE4FF', green: '#CDEFD2' };
export const INKS = { ink: '#26292E', red: '#C8372D', blue: '#2F6FC8', green: '#2E8B3E', orange: '#D9661F', purple: '#7E3FA6', yellow: '#E8B21E' };
const PAPER = '#FFFEFA';
const FONT = 16, LINE_H = 20, CHAR_W = 8.4;
const TEXT_K = { 1: 0.8, 2: 1, 3: 1.5 };   // text sizes: small, normal, large
const BOXES = ['box', 'ellipse', 'diamond', 'triangle', 'star', 'text'];
// The colours a drawing is shown in: on paper, or (on a board) the board's own ink.
const ON_PAPER = { ink: INKS.ink, paper: PAPER };
const inkOf = (c, th) => (c === 'ink' || !(c in INKS) ? th.ink : INKS[c]);
const FONT_STACK = "-apple-system, 'Segoe UI', system-ui, sans-serif";

// ---------- Saved form ----------

// Only what's expected survives (drawings come back from other devices and from pasted notes).
export function cleanDrawing(raw) {
  let d = raw;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return null; } }
  if (!d || !Array.isArray(d.s)) return null;
  const num = v => (Number.isFinite(+v) ? Math.max(-100000, Math.min(100000, Math.round(+v))) : 0);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const okId = v => typeof v === 'string' && /^[A-Za-z0-9]{1,24}$/.test(v);
  const ink = v => (v in INKS ? v : 'ink');
  const out = [], ids = new Set();
  for (const s of d.s.slice(0, 800)) {
    if (!s || !okId(s.id) || ids.has(s.id)) continue;
    if (BOXES.includes(s.k)) out.push({ id: s.id, k: s.k, x: num(s.x), y: num(s.y), w: Math.max(10, num(s.w)), h: Math.max(10, num(s.h)), t: str(s.t, 400), f: s.f in FILLS ? s.f : '', c: ink(s.c), ...(+s.z in TEXT_K && +s.z !== 2 ? { z: +s.z } : {}) });
    else if (s.k === 'line') {
      const end = e => (okId(e) ? e : Array.isArray(e) ? [num(e[0]), num(e[1])] : null);
      const a = end(s.a), b = end(s.b);
      if (!a || !b) continue;
      out.push({ id: s.id, k: 'line', a, b, t: str(s.t, 120), c: ink(s.c), e: ['arrow', 'none', 'both'].includes(s.e) ? s.e : 'arrow', d: s.d ? 1 : 0, ...(s.cv ? { cv: 1 } : {}) });
    } else if (s.k === 'pen') {
      const p = Array.isArray(s.p) ? s.p.slice(0, 8000).map(num) : [];
      if (p.length % 2) p.pop();
      if (p.length < 4) continue;
      out.push({ id: s.id, k: 'pen', p, c: ink(s.c), w: Math.max(1, Math.min(32, num(s.w) || 3)), ...(s.hl ? { hl: 1 } : {}) });
    } else continue;
    ids.add(s.id);
  }
  // An arrow joined to something that isn't there any more goes too.
  return { v: 1, s: out.filter(s => s.k !== 'line' || ((typeof s.a !== 'string' || ids.has(s.a)) && (typeof s.b !== 'string' || ids.has(s.b)))) };
}

export function drawDivHTML(d) {
  const div = document.createElement('div');
  div.setAttribute('data-draw', JSON.stringify(d));
  return div.outerHTML;
}

// The same drawing made k times bigger and moved by (dx, dy): its shapes, ends and pen lines.
export function moveDrawing(d, k, dx, dy) {
  const r = v => Math.round(v);
  return { v: 1, s: d.s.map(s => {
    if (BOXES.includes(s.k)) return { ...s, x: r(s.x * k + dx), y: r(s.y * k + dy), w: Math.max(10, r(s.w * k)), h: Math.max(10, r(s.h * k)) };
    if (s.k === 'line') { const pt = e => (Array.isArray(e) ? [r(e[0] * k + dx), r(e[1] * k + dy)] : e); return { ...s, a: pt(s.a), b: pt(s.b) }; }
    if (s.k === 'pen') return { ...s, p: s.p.map((v, i) => r(v * k + (i % 2 ? dy : dx))), w: Math.max(1, Math.min(32, r(s.w * k))) };
    return s;
  }) };
}

// ---------- Geometry ----------

const mapOf = d => new Map(d.s.map(s => [s.id, s]));
const mid = s => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });

// Where a line from a shape's middle towards a point leaves the shape's outline.
function edgePoint(s, to) {
  const c = mid(s), hw = s.w / 2, hh = s.h / 2;
  const dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) return c;
  const t = s.k === 'ellipse' || s.k === 'star' || s.k === 'triangle' ? 1 / Math.hypot(dx / hw, dy / hh)
    : s.k === 'diamond' ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
    : Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return { x: c.x + dx * t, y: c.y + dy * t };
}

export function lineEnds(l, map) {
  const A = typeof l.a === 'string' ? map.get(l.a) : null, B = typeof l.b === 'string' ? map.get(l.b) : null;
  const pa = A ? mid(A) : { x: l.a[0], y: l.a[1] }, pb = B ? mid(B) : { x: l.b[0], y: l.b[1] };
  return { p1: A ? edgePoint(A, pb) : pa, p2: B ? edgePoint(B, pa) : pb };
}

function bounds(d) {
  const map = mapOf(d);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const s of d.s) {
    if (BOXES.includes(s.k)) { add(s.x, s.y); add(s.x + s.w, s.y + s.h); }
    else if (s.k === 'line') { const { p1, p2 } = lineEnds(s, map); add(p1.x, p1.y); add(p2.x, p2.y); }
    else if (s.k === 'pen') for (let i = 0; i < s.p.length; i += 2) add(s.p[i] - s.w, s.p[i + 1] - s.w), add(s.p[i] + s.w, s.p[i + 1] + s.w);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// SVG text doesn't wrap, so labels are broken into lines by an average letter width.
function wrap(text, width, k = 1) {
  const max = Math.max(3, Math.floor(width / (CHAR_W * k))), out = [];
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if (!line) line = word;
      else if ((line + ' ' + word).length <= max) line += ' ' + word;
      else { out.push(line); line = word; }
      while (line.length > max) { out.push(line.slice(0, max)); line = line.slice(max); }
    }
    out.push(line);
  }
  return out;
}
// A text shape is as big as its words.
function fitText(s) {
  const k = TEXT_K[s.z] || 1;
  const lines = wrap(s.t || ' ', Math.max(60, s.w - 12), k);
  s.h = Math.max(LINE_H * k + 12, lines.length * LINE_H * k + 12);
}

// ---------- Drawing it ----------

function labelSVG(text, cx, cy, width, color, k = 1) {
  if (!text) return '';
  const lines = wrap(text, width, k), lh = LINE_H * k;
  const top = cy - (lines.length * lh) / 2 + lh * 0.74;
  return `<text x="${f(cx)}" y="${f(top)}" text-anchor="middle" font-size="${f(FONT * k)}" font-family="${FONT_STACK}" style="fill:${color}">${lines.map((l, i) => `<tspan x="${f(cx)}" dy="${i ? f(lh) : 0}">${esc(l || ' ')}</tspan>`).join('')}</text>`;
}

function arrowHead(tip, from, color) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x), L = 13, W = 0.42;
  return `<path d="M${f(tip.x)} ${f(tip.y)}L${f(tip.x - L * Math.cos(a - W))} ${f(tip.y - L * Math.sin(a - W))}L${f(tip.x - L * Math.cos(a + W))} ${f(tip.y - L * Math.sin(a + W))}Z" style="fill:${color}"/>`;
}
// A star's or a triangle's corners, inside its box.
function polyPts(s) {
  if (s.k === 'triangle') return [[s.x + s.w / 2, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
  const cx = s.x + s.w / 2, cy = s.y + s.h / 2, out = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; out.push([cx + Math.cos(a) * r * s.w / 2, cy + Math.sin(a) * r * s.h / 2 + s.h * 0.05]); }
  return out;
}
// A line's path: straight, or (curved) bowed out to one side; and where its arrowheads point from.
function linePath(p1, p2, curved) {
  if (!curved) return { d: `M${f(p1.x)} ${f(p1.y)}L${f(p2.x)} ${f(p2.y)}`, from1: p2, from2: p1, mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 } };
  const c = { x: (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.25, y: (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.25 };
  return { d: `M${f(p1.x)} ${f(p1.y)}Q${f(c.x)} ${f(c.y)} ${f(p2.x)} ${f(p2.y)}`, from1: c, from2: c, mid: { x: (p1.x + 2 * c.x + p2.x) / 4, y: (p1.y + 2 * c.y + p2.y) / 4 } };
}

// ui: draw for the editor (tap targets, and leave out the label being typed).
function shapesSVG(d, ui = null, th = ON_PAPER) {
  const map = mapOf(d);
  let out = '';
  for (const s of d.s) {
    const ink = inkOf(s.c, th);
    const tag = ui ? ` data-id="${s.id}"` : '';
    const label = !ui || ui.editing !== s.id;
    if (s.k === 'pen') {
      const pts = [];
      for (let i = 0; i < s.p.length; i += 2) pts.push({ x: s.p[i], y: s.p[i + 1] });
      const dd = smooth(pts);
      out += `<path d="${dd}" style="fill:none;stroke:${ink}" stroke-width="${s.w}"${s.hl ? ' stroke-opacity="0.38"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
      if (ui) out += `<path${tag} d="${dd}" fill="none" stroke="transparent" stroke-width="${Math.max(16, s.w + 12)}" stroke-linecap="round"/>`;
    } else if (s.k === 'line') {
      const { p1, p2 } = lineEnds(s, map);
      const lp = linePath(p1, p2, s.cv), dd = lp.d;
      out += `<path d="${dd}" style="fill:none;stroke:${ink}" stroke-width="2.2" ${s.d ? 'stroke-dasharray="7 6"' : ''} stroke-linecap="round"/>`;
      if (s.e !== 'none') out += arrowHead(p2, lp.from1, ink);
      if (s.e === 'both') out += arrowHead(p1, lp.from2, ink);
      if (ui) out += `<path${tag} d="${dd}" fill="none" stroke="transparent" stroke-width="18"/>`;
      if (s.t && label) {
        const m = lp.mid, lines = wrap(s.t, 150);
        const w = Math.min(160, Math.max(...lines.map(l => l.length)) * CHAR_W + 12), h = lines.length * LINE_H + 6;
        out += `<rect x="${f(m.x - w / 2)}" y="${f(m.y - h / 2)}" width="${f(w)}" height="${f(h)}" rx="4" style="fill:${th.paper}"${tag}/>` + labelSVG(s.t, m.x, m.y, 150, ink);
      }
    } else {
      const fill = FILLS[s.f] || (ui ? 'transparent' : 'none');
      const common = `${tag} style="fill:${fill};stroke:${s.k === 'text' ? 'none' : ink}" stroke-width="2" stroke-linejoin="round"`;
      if (s.k === 'ellipse') out += `<ellipse cx="${f(s.x + s.w / 2)}" cy="${f(s.y + s.h / 2)}" rx="${f(s.w / 2)}" ry="${f(s.h / 2)}"${common}/>`;
      else if (s.k === 'diamond') out += `<polygon points="${f(s.x + s.w / 2)},${s.y} ${s.x + s.w},${f(s.y + s.h / 2)} ${f(s.x + s.w / 2)},${s.y + s.h} ${s.x},${f(s.y + s.h / 2)}"${common}/>`;
      else if (s.k === 'triangle' || s.k === 'star') out += `<polygon points="${polyPts(s).map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}"${common}/>`;
      else out += `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.k === 'text' ? 0 : 8}"${common}/>`;
      const lw = s.k === 'box' || s.k === 'text' ? s.w - 12 : s.k === 'triangle' || s.k === 'star' ? s.w * 0.5 : s.w * 0.68;
      if (label) out += labelSVG(s.t, s.x + s.w / 2, s.y + s.h / 2 + (s.k === 'triangle' ? s.h * 0.18 : 0), lw, ink, s.k === 'text' ? TEXT_K[s.z] || 1 : 1);
    }
  }
  return out;
}

// The finished drawing as a picture (for the note and its card).
// bare (0.7.2): drawn straight on a board, with no paper behind it, in the board's own ink
// (currentColor, set by the board) so it shows on dark boards too.
export function drawingSVG(d, { bare = false } = {}) {
  const { x, y, w, h } = drawingBox(d, bare);
  const th = bare ? { ink: 'currentColor', paper: 'var(--sketch-paper, #FFFEFA)' } : ON_PAPER;
  return `<svg class="drawing" viewBox="${f(x)} ${f(y)} ${f(w)} ${f(h)}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Drawing">${bare ? '' : `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${PAPER}"/>`}${shapesSVG(d, null, th)}</svg>`;
}
// The area a drawing's picture shows: around everything in it, with a little room.
export function drawingBox(d, bare = false) {
  const b = bounds(d) || { x: 0, y: 0, w: 240, h: 120 };
  const pad = bare ? 14 : 18, w = Math.max(bare ? 40 : 160, b.w + pad * 2), h = Math.max(bare ? 30 : 90, b.h + pad * 2);
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

// ---------- The editor ----------

const ICON = {
  select: '<path d="M6 3l12 9-5.5 1L9.5 19z"/>',
  box: '<rect x="3.5" y="6" width="17" height="12" rx="2.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
  diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
  text: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  line: '<path d="M4 20L19 5M11 5h8v8"/>',
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  triangle: '<path d="M12 4l9 16H3z"/>',
  star: '<path d="M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.3L12 17l-5.6 3.2 1.3-6.3L3 9.6l6.3-.7z"/>',
  marker: '<path d="M5 19l3-1 9-9-2-2-9 9z"/><path d="M14 6l2-2 4 4-2 2"/><path d="M4 21h9" stroke-width="3.2" opacity="0.45"/>',
  eraser: '<path d="M8.5 19.5L3.8 14.8a1.6 1.6 0 0 1 0-2.3l8.3-8.3a1.6 1.6 0 0 1 2.3 0l5.6 5.6a1.6 1.6 0 0 1 0 2.3l-7.4 7.4zM8.5 19.5H20M7 11l6 6"/>',
  colour: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9" r="1.4"/><circle cx="14.5" cy="8.5" r="1.4"/><circle cx="16" cy="13.5" r="1.4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const TOOLS = [['select', 'Select and move'], ['pen', 'Pen'], ['marker', 'Highlighter'], ['line', 'Arrow'], ['text', 'Text'], ['box', 'Box'], ['ellipse', 'Circle'], ['diamond', 'Diamond'], ['triangle', 'Triangle'], ['star', 'Star'], ['eraser', 'Eraser']];
const HINTS = {
  select: 'Tap something to pick it, tap it again to type in it. Drag the background to move around.',
  box: 'Tap or drag to add a box.', ellipse: 'Tap or drag to add a circle.', diamond: 'Tap or drag to add a diamond.',
  triangle: 'Tap or drag to add a triangle.', star: 'Tap or drag to add a star.',
  text: 'Tap where the text should go.', line: 'Drag from one shape to another to join them with an arrow.',
  pen: 'Draw freehand. Colours has the pen sizes.', marker: 'A see-through highlighter. Colours has its sizes.', eraser: 'Drag over anything to rub it out.',
};
const PEN_W = { pen: { s: 2, m: 3, l: 6 }, marker: { s: 10, m: 16, l: 26 } };

// Opens full screen. Resolves with the drawing when you press Done, or null if you cancel.
// stage (0.7.2): draw on a board instead. The editor is see-through and the board moves with it:
//   stage.getView(svgRect) -> where to start (the board's own view), stage.setView(view, svgRect)
//   as you move around, stage.ink / stage.paper: the board's colours for black ink and labels.
export function openDrawing({ drawing = null, title = 'Drawing', stage = null } = {}) {
  return new Promise(resolve => {
    const pad = document.createElement('div');
    pad.id = 'drawpad';
    if (stage) {
      pad.classList.add('onboard');
      // (just over the board, so the lists beside it on a computer stay put)
      if (stage.rect) Object.assign(pad.style, { inset: 'auto', left: stage.rect.left + 'px', top: stage.rect.top + 'px', width: stage.rect.width + 'px', height: stage.rect.height + 'px' });
    }
    const th = stage ? { ink: stage.ink || INKS.ink, paper: stage.paper || PAPER } : ON_PAPER;
    pad.innerHTML = `
      <header class="dhead"><button type="button" data-d="cancel">Cancel</button><h2>${esc(title)}</h2><button type="button" class="primary" data-d="done">Done</button></header>
      <div class="dwrap">
        <svg class="dcanvas"><g class="vp"><g class="dshapes"></g><g class="dui"></g></g></svg>
        <textarea class="dtext" hidden rows="1" spellcheck="true"></textarea>
        <p class="dhint"></p>
        <div class="dpal" hidden></div>
      </div>
      <footer class="dtools">
        ${TOOLS.map(([k, name]) => `<button type="button" data-tool="${k}" title="${name}" aria-label="${name}"><svg viewBox="0 0 24 24">${ICON[k]}</svg></button>`).join('')}
        <span class="sep"></span>
        <button type="button" data-d="colour" title="Colours" aria-label="Colours"><svg viewBox="0 0 24 24">${ICON.colour}</svg></button>
        <button type="button" data-d="undo" title="Undo" aria-label="Undo"><svg viewBox="0 0 24 24">${ICON.undo}</svg></button>
        <button type="button" data-d="redo" title="Redo" aria-label="Redo"><svg viewBox="0 0 24 24">${ICON.redo}</svg></button>
        <button type="button" data-d="delete" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24">${ICON.trash}</svg></button>
      </footer>`;
    document.body.append(pad);
    const wrapEl = pad.querySelector('.dwrap'), svg = pad.querySelector('.dcanvas'), vp = pad.querySelector('.vp');
    const shapesEl = pad.querySelector('.dshapes'), uiEl = pad.querySelector('.dui');
    const ta = pad.querySelector('.dtext'), hint = pad.querySelector('.dhint'), pal = pad.querySelector('.dpal');

    let d = cleanDrawing(drawing) || { v: 1, s: [] };
    const original = JSON.stringify(d);
    let snap = original;
    const past = [], future = [];
    let tool = 'select', sel = null, editing = null;
    let view = { x: 0, y: 0, z: 1 };
    let fill = 'white', ink = 'ink', hlInk = 'yellow', penSize = 'm', textSize = 2;
    const get = id => d.s.find(s => s.id === id);
    const nid = () => Math.random().toString(36).slice(2, 10);

    function commit() {
      const now = JSON.stringify(d);
      if (now === snap) return;
      past.push(snap); if (past.length > 120) past.shift();
      snap = now; future.length = 0;
    }
    function undo(back) {
      const from = back ? past : future, to = back ? future : past;
      if (!from.length) return;
      to.push(snap); snap = from.pop(); d = JSON.parse(snap); sel = null; draw();
    }

    // ---- drawing the editor ----
    function draw(extra = '') {
      vp.setAttribute('transform', `translate(${f(view.x)} ${f(view.y)}) scale(${view.z})`);
      wrapEl.style.backgroundPosition = `${view.x}px ${view.y}px`;
      wrapEl.style.backgroundSize = `${24 * view.z}px ${24 * view.z}px`;
      if (stage) stage.setView(view, svg.getBoundingClientRect());   // the board moves with you
      shapesEl.innerHTML = shapesSVG(d, { editing }, th) + extra;
      const s = sel && get(sel), k = 1 / view.z;
      let ui = '';
      if (s && BOXES.includes(s.k)) {
        ui += `<rect class="dsel" x="${s.x - 5 * k}" y="${s.y - 5 * k}" width="${s.w + 10 * k}" height="${s.h + 10 * k}" stroke-width="${1.5 * k}" stroke-dasharray="${5 * k} ${4 * k}"/>`;
        ui += `<circle class="dhandle" data-h="size" cx="${s.x + s.w}" cy="${s.y + s.h}" r="${9 * k}" stroke-width="${2 * k}"/>`;
      } else if (s && s.k === 'line') {
        const { p1, p2 } = lineEnds(s, mapOf(d));
        ui += `<circle class="dhandle" data-h="a" cx="${f(p1.x)}" cy="${f(p1.y)}" r="${9 * k}" stroke-width="${2 * k}"/><circle class="dhandle" data-h="b" cx="${f(p2.x)}" cy="${f(p2.y)}" r="${9 * k}" stroke-width="${2 * k}"/>`;
      } else if (s && s.k === 'pen') {
        const b = bounds({ s: [s] });
        ui += `<rect class="dsel" x="${b.x - 4 * k}" y="${b.y - 4 * k}" width="${b.w + 8 * k}" height="${b.h + 8 * k}" stroke-width="${1.5 * k}" stroke-dasharray="${5 * k} ${4 * k}"/>`;
      }
      uiEl.innerHTML = ui;
      for (const b of pad.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === tool);
      pad.querySelector('[data-d=undo]').disabled = !past.length;
      pad.querySelector('[data-d=redo]').disabled = !future.length;
      pad.querySelector('[data-d=delete]').disabled = !sel;
      hint.textContent = !d.s.length && tool === 'select' ? (stage ? 'Draw straight onto the board: pick the pen, a shape or an arrow below.' : 'Pick a shape, arrow or the pen below to start.') : HINTS[tool];
      if (editing) placeText();
    }

    function fit() {
      const b = bounds(d), W = wrapEl.clientWidth, H = wrapEl.clientHeight;
      if (!b) { view = { x: W / 2 - 150, y: H / 3, z: 1 }; return; }
      const z = Math.min(1.4, Math.max(0.2, Math.min((W - 60) / (b.w || 1), (H - 90) / (b.h || 1))));
      view = { z, x: W / 2 - (b.x + b.w / 2) * z, y: H / 2 - (b.y + b.h / 2) * z };
    }

    const toWorld = (cx, cy) => { const r = svg.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z }; };
    const r1 = n => Math.round(n);
    // The shape (not arrow or pen line) under a point, ignoring some.
    const shapeAt = (cx, cy, skip) => {
      for (const el of document.elementsFromPoint(cx, cy)) {
        const id = el.closest?.('[data-id]')?.dataset.id;
        const s = id && get(id);
        if (s && BOXES.includes(s.k) && s.id !== skip) return s;
      }
      return null;
    };

    // ---- typing in a shape ----
    function editText(id) {
      const s = get(id);
      if (!s || s.k === 'pen') return;
      editing = id;
      ta.value = s.t || '';
      ta.hidden = false;
      draw();
      ta.focus();
      ta.select();
    }
    function placeText() {
      const s = get(editing);
      if (!s) return;
      let box;
      if (s.k === 'line') { const { p1, p2 } = lineEnds(s, mapOf(d)); box = { x: (p1.x + p2.x) / 2 - 80, y: (p1.y + p2.y) / 2 - 20, w: 160, h: 40 }; }
      else box = { x: s.x, y: s.y, w: Math.max(s.w, 80), h: Math.max(s.h, 36) };
      Object.assign(ta.style, { left: view.x + box.x * view.z + 'px', top: view.y + box.y * view.z + 'px', width: box.w * view.z + 'px', height: box.h * view.z + 'px', fontSize: FONT * view.z + 'px', lineHeight: LINE_H * view.z + 'px', color: INKS[s.c] || INKS.ink });
    }
    function endText() {
      if (!editing) return;
      const s = get(editing);
      editing = null;
      ta.hidden = true;
      if (s && s.k === 'text' && !s.t.trim()) d.s = d.s.filter(x => x !== s);
      commit(); draw();
    }
    ta.addEventListener('input', () => { const s = get(editing); if (!s) return; s.t = ta.value.slice(0, 400); if (s.k === 'text') fitText(s); draw(); });
    ta.addEventListener('blur', endText);
    ta.addEventListener('keydown', e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ta.blur(); } });

    function remove(id) {
      d.s = d.s.filter(s => s.id !== id && !(s.k === 'line' && (s.a === id || s.b === id)));
      if (sel === id) sel = null;
    }

    // ---- pointer: draw, move, resize, join, pan, pinch ----
    const pointers = new Map();
    let g = null;
    // The eraser: whatever's under it goes (and arrows joined to it).
    function rubOut(cx, cy, gg) {
      for (const el of document.elementsFromPoint(cx, cy)) {
        if (!svg.contains(el)) continue;
        const id = el.closest?.('[data-id]')?.dataset.id;
        if (id && get(id)) { remove(id); gg.n++; draw(); return; }
      }
    }
    svg.addEventListener('pointerdown', e => {
      if (editing) ta.blur();
      pal.hidden = true;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { svg.setPointerCapture(e.pointerId); } catch (err) {}
      if (pointers.size === 2) {
        if (g?.s && (g.k === 'pen' || g.k === 'line' || g.k === 'make')) remove(g.s.id);   // a second finger means zoom, not draw
        const [a, b] = [...pointers.values()];
        g = { k: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: { ...view } };
        draw(); return;
      }
      const p = toWorld(e.clientX, e.clientY);
      const handle = e.target.closest('[data-h]');
      const hitId = e.target.closest('[data-id]')?.dataset.id;
      if (handle && sel) { g = { k: handle.dataset.h, id: sel, p0: p, o: structuredClone(get(sel)) }; return; }
      if (tool === 'select') {
        if (hitId) { const was = sel === hitId; sel = hitId; g = { k: 'move', id: hitId, p0: p, o: structuredClone(get(hitId)), was, moved: false }; }
        else { sel = null; g = { k: 'pan', sx: e.clientX, sy: e.clientY, v: { ...view } }; }
      } else if (tool === 'pen' || tool === 'marker') {
        const s = tool === 'pen' ? { id: nid(), k: 'pen', p: [r1(p.x), r1(p.y)], c: ink, w: PEN_W.pen[penSize] }
          : { id: nid(), k: 'pen', p: [r1(p.x), r1(p.y)], c: hlInk, w: PEN_W.marker[penSize], hl: 1 };
        d.s.push(s); g = { k: 'pen', s };
      } else if (tool === 'eraser') {
        g = { k: 'erase', n: 0 };
        rubOut(e.clientX, e.clientY, g);
      } else if (tool === 'line') {
        const from = shapeAt(e.clientX, e.clientY);
        const s = { id: nid(), k: 'line', a: from ? from.id : [r1(p.x), r1(p.y)], b: [r1(p.x), r1(p.y)], t: '', c: ink, e: 'arrow', d: 0 };
        d.s.push(s); g = { k: 'line', s, p0: p };
      } else if (tool === 'text') {
        g = { k: 'text', p0: p };
      } else {
        const s = { id: nid(), k: tool, x: r1(p.x), y: r1(p.y), w: 1, h: 1, t: '', f: fill, c: ink };
        d.s.push(s); g = { k: 'make', s, p0: p };
      }
      draw();
    });

    svg.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!g) return;
      if (g.k === 'pinch') {
        if (pointers.size < 2) return;
        const [a, b] = [...pointers.values()], r = svg.getBoundingClientRect();
        const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const z = Math.max(0.15, Math.min(4, g.v.z * dist / g.dist)), k = z / g.v.z;
        const ox = g.cx - r.left, oy = g.cy - r.top;
        view = { z, x: ox - (ox - g.v.x) * k + (cx - g.cx), y: oy - (oy - g.v.y) * k + (cy - g.cy) };
        draw(); return;
      }
      if (g.k === 'pan') { view.x = g.v.x + e.clientX - g.sx; view.y = g.v.y + e.clientY - g.sy; draw(); return; }
      if (g.k === 'erase') { rubOut(e.clientX, e.clientY, g); return; }
      const p = toWorld(e.clientX, e.clientY);
      const s = g.s || get(g.id);
      if (!s) return;
      const dx = p.x - (g.p0?.x ?? p.x), dy = p.y - (g.p0?.y ?? p.y);
      if (g.k === 'move') {
        if (!g.moved && Math.hypot(dx, dy) * view.z < 4) return;
        g.moved = true;
        if (BOXES.includes(s.k)) { s.x = r1(g.o.x + dx); s.y = r1(g.o.y + dy); }
        else if (s.k === 'pen') s.p = g.o.p.map((v, i) => r1(v + (i % 2 ? dy : dx)));
        else if (s.k === 'line') {
          if (Array.isArray(g.o.a)) s.a = [r1(g.o.a[0] + dx), r1(g.o.a[1] + dy)];
          if (Array.isArray(g.o.b)) s.b = [r1(g.o.b[0] + dx), r1(g.o.b[1] + dy)];
        }
      } else if (g.k === 'size') {
        s.w = Math.max(24, r1(g.o.w + dx)); s.h = Math.max(20, r1(g.o.h + dy));
        if (s.k === 'text') fitText(s);
      } else if (g.k === 'a' || g.k === 'b') {
        const other = s[g.k === 'a' ? 'b' : 'a'];
        const over = shapeAt(e.clientX, e.clientY, typeof other === 'string' ? other : null);
        s[g.k] = over ? over.id : [r1(p.x), r1(p.y)];
      } else if (g.k === 'pen') {
        const n = s.p.length;
        if (Math.hypot(p.x - s.p[n - 2], p.y - s.p[n - 1]) * view.z > 2) s.p.push(r1(p.x), r1(p.y));
      } else if (g.k === 'line') {
        const over = shapeAt(e.clientX, e.clientY, typeof s.a === 'string' ? s.a : null);
        s.b = over ? over.id : [r1(p.x), r1(p.y)];
      } else if (g.k === 'make') {
        s.x = r1(Math.min(g.p0.x, p.x)); s.y = r1(Math.min(g.p0.y, p.y));
        s.w = r1(Math.abs(dx)); s.h = r1(Math.abs(dy));
      }
      draw();
    });

    const up = e => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (g?.k === 'pinch') { if (!pointers.size) g = null; return; }
      const gg = g; g = null;
      if (!gg) return;
      if (gg.k === 'make') {
        const s = gg.s;
        if (s.w < 14 && s.h < 14) {   // a tap: a shape of the usual size, centred where you tapped
          const [w, h] = s.k === 'diamond' ? [130, 90] : s.k === 'ellipse' ? [130, 80] : s.k === 'triangle' ? [120, 100] : s.k === 'star' ? [110, 105] : [150, 70];
          Object.assign(s, { w, h, x: r1(gg.p0.x - w / 2), y: r1(gg.p0.y - h / 2) });
        }
        s.w = Math.max(24, s.w); s.h = Math.max(20, s.h);
        sel = s.id; tool = 'select'; commit();
      } else if (gg.k === 'text') {
        const s = { id: nid(), k: 'text', x: r1(gg.p0.x - 90), y: r1(gg.p0.y - 16), w: 180, h: 32, t: '', f: '', c: ink, ...(textSize !== 2 ? { z: textSize } : {}) };
        fitText(s);
        d.s.push(s); sel = s.id; tool = 'select';
        draw(); editText(s.id); return;
      } else if (gg.k === 'line') {
        const s = gg.s, { p1, p2 } = lineEnds(s, mapOf(d));
        if ((typeof s.a === 'string' && s.a === s.b) || Math.hypot(p2.x - p1.x, p2.y - p1.y) < 12) remove(s.id);
        else { sel = s.id; commit(); }
      } else if (gg.k === 'pen') {
        const s = gg.s;
        if (s.p.length < 4) s.p.push(s.p[0] + 1, s.p[1]);   // a dot
        const pts = [];
        for (let i = 0; i < s.p.length; i += 2) pts.push({ x: s.p[i], y: s.p[i + 1] });
        s.p = simplify(pts, 1.2 / view.z).flatMap(q => [q.x, q.y]);
        commit();
      } else if (gg.k === 'erase') {
        if (gg.n) commit();
      } else if (gg.k === 'move') {
        if (gg.moved) commit();
        else if (gg.was && e.type === 'pointerup') { draw(); editText(gg.id); return; }
      } else if (gg.k === 'size' || gg.k === 'a' || gg.k === 'b') commit();
      draw();
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('dblclick', e => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) { sel = id; editText(id); } });
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40)) {
        const z = Math.max(0.15, Math.min(4, view.z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)))), k = z / view.z;
        const ox = e.clientX - r.left, oy = e.clientY - r.top;
        view = { z, x: ox - (ox - view.x) * k, y: oy - (oy - view.y) * k };
      } else { view.x -= e.deltaX; view.y -= e.deltaY; }
      draw();
    }, { passive: false });
    for (const ev of ['gesturestart', 'gesturechange']) svg.addEventListener(ev, e => e.preventDefault());

    // ---- colours (and, for an arrow, its ends and dashes) ----
    // (0.7.2: and sizes, for the pen, the highlighter and text; curved arrows)
    function showPalette() {
      const s = sel && get(sel);
      const marking = s ? s.k === 'pen' && s.hl : tool === 'marker';
      const curFill = s ? (BOXES.includes(s.k) && s.k !== 'text' ? s.f : null) : ['select', 'box', 'ellipse', 'diamond', 'triangle', 'star'].includes(tool) ? fill : null;
      const curInk = s ? s.c : marking ? hlInk : ink;
      const sw = (kind, key, colour) => `<button type="button" class="dsw ${key === (kind === 'f' ? curFill : curInk) ? 'on' : ''}" data-${kind}="${key}" style="--sw:${colour}" aria-label="${key || 'No fill'}">${key ? '' : '×'}</button>`;
      const opt = (attr, v, label, on) => `<button type="button" class="dopt ${on ? 'on' : ''}" data-${attr}="${v}">${label}</button>`;
      const penKind = s ? (s.k === 'pen' ? (s.hl ? 'marker' : 'pen') : null) : tool === 'pen' || tool === 'marker' ? tool : null;
      const curPen = s?.k === 'pen' ? Object.entries(PEN_W[penKind]).find(([, w]) => w === s.w)?.[0] : penSize;
      const textNow = s ? (s.k === 'text' ? s.z || 2 : null) : tool === 'text' ? textSize : null;
      pal.innerHTML = `
        ${curFill !== null ? `<div class="drow"><span>Fill</span>${sw('f', '', 'transparent')}${Object.entries(FILLS).map(([k, c]) => sw('f', k, c)).join('')}</div>` : ''}
        <div class="drow"><span>${s?.k === 'line' ? 'Arrow' : marking ? 'Highlight' : s?.k === 'pen' ? 'Pen' : 'Lines'}</span>${Object.entries(INKS).map(([k, c]) => sw('i', k, c)).join('')}</div>
        ${penKind ? `<div class="drow"><span>Size</span>${opt('pw', 's', 'Thin', curPen === 's')}${opt('pw', 'm', 'Medium', curPen === 'm')}${opt('pw', 'l', 'Thick', curPen === 'l')}</div>` : ''}
        ${textNow ? `<div class="drow"><span>Text</span>${opt('tz', 1, 'Small', textNow === 1)}${opt('tz', 2, 'Normal', textNow === 2)}${opt('tz', 3, 'Big', textNow === 3)}</div>` : ''}
        ${s?.k === 'line' ? `<div class="drow"><span>Ends</span>
          <button type="button" class="dopt ${s.e === 'arrow' ? 'on' : ''}" data-e="arrow">→</button><button type="button" class="dopt ${s.e === 'both' ? 'on' : ''}" data-e="both">↔</button><button type="button" class="dopt ${s.e === 'none' ? 'on' : ''}" data-e="none">—</button>
          <button type="button" class="dopt ${s.d ? 'on' : ''}" data-dash>Dashed</button><button type="button" class="dopt ${s.cv ? 'on' : ''}" data-curve>Curved</button></div>` : ''}`;
      pal.hidden = false;
    }
    pal.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const s = sel && get(sel);
      const marking = s ? s.k === 'pen' && s.hl : tool === 'marker';
      if (b.dataset.f !== undefined) { if (s) s.f = b.dataset.f; else fill = b.dataset.f; }
      else if (b.dataset.i !== undefined) { if (s) s.c = b.dataset.i; else if (marking) hlInk = b.dataset.i; else ink = b.dataset.i; }
      else if (b.dataset.pw) { if (s?.k === 'pen') s.w = PEN_W[s.hl ? 'marker' : 'pen'][b.dataset.pw]; else penSize = b.dataset.pw; }
      else if (b.dataset.tz) { const z = +b.dataset.tz; if (s?.k === 'text') { if (z === 2) delete s.z; else s.z = z; fitText(s); } else textSize = z; }
      else if (b.dataset.e && s) s.e = b.dataset.e;
      else if (b.dataset.dash !== undefined && s) s.d = s.d ? 0 : 1;
      else if (b.dataset.curve !== undefined && s) { if (s.cv) delete s.cv; else s.cv = 1; }
      commit(); draw(); showPalette();
    });

    // ---- buttons and keys ----
    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      pad.remove();
      resolve(result);
    }
    pad.querySelector('.dtools').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tool) { tool = b.dataset.tool; if (tool !== 'select') sel = null; pal.hidden = true; draw(); }
      else if (b.dataset.d === 'colour') { if (pal.hidden) showPalette(); else pal.hidden = true; }
      else if (b.dataset.d === 'undo') undo(true);
      else if (b.dataset.d === 'redo') undo(false);
      else if (b.dataset.d === 'delete' && sel) { remove(sel); commit(); draw(); pal.hidden = true; }
    });
    pad.querySelector('.dhead').addEventListener('click', e => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      if (editing) ta.blur();
      if (b.dataset.d === 'done') close(d);
      else if (JSON.stringify(d) === original || confirm('Throw away the changes to this drawing?')) close(null);
    });
    function onKey(e) {
      if (editing) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel); commit(); draw(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(!e.shiftKey); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(false); }
      else if (e.key === 'Escape') { e.preventDefault(); if (!pal.hidden) pal.hidden = true; else if (sel) { sel = null; draw(); } }
      else return;
      e.stopPropagation();
    }
    document.addEventListener('keydown', onKey, true);

    // On a board: start from where the board is (and pick the pen, since that's what you came for).
    requestAnimationFrame(() => {
      if (stage) { view = stage.getView(svg.getBoundingClientRect()); if (!d.s.length) tool = 'pen'; }
      else fit();
      draw();
    });
  });
}

// ---------- Helpers ----------

const f = n => Math.round(n * 10) / 10;
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// A smooth path through points.
function smooth(pts) {
  if (pts.length < 3) return `M${f(pts[0].x)} ${f(pts[0].y)}` + pts.slice(1).map(p => `L${f(p.x)} ${f(p.y)}`).join('');
  let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

// Fewer points along a pen line, same shape (Ramer–Douglas–Peucker).
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1e-9;
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = Math.abs((b.x - a.x) * (a.y - pts[i].y) - (a.x - pts[i].x) * (b.y - a.y)) / len;
    if (dist > far) { far = dist; at = i; }
  }
  if (far <= eps) return [a, b];
  return simplify(pts.slice(0, at + 1), eps).slice(0, -1).concat(simplify(pts.slice(at), eps));
}
