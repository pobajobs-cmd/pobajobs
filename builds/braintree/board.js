// The board: every project has one. The project's name is the banner across the top, its
// to-dos, notes and sub-projects are cards, and its sections are labelled frames you drop
// cards into. Eleven looks, each with its own kind of string:
//   Corkboard   tilted paper and push pins; red wool that sags from pin to pin
//   Whiteboard  flat sticky notes; wobbly marker arrows
//   Blueprint   outlined boxes on a blue grid; ruled lines that turn at right angles
//   Notebook    taped paper slips on dotted paper; fine ink-pen arrows
//   (0.7) Circuit board: copper traces with pads; City map: transit lines between stations;
//   Neon: glowing tubes; Minimal: thin lines, no edges; Hacker: piped terminal windows;
//   Chalkboard: chalk arrows; Space: constellations
//
// Nothing here is board-only. Every card is a real item, so the lists show the same thing:
//   where a card sits:  data.cork[projectId] = {x, y}
//   a section:          an item of type "section" inside the project, data.cork[projectId] = {x, y, w, h}.
//                       Cards dropped in it go inside it; in the lists it's a heading in the project.
//   strings:            data.links = [{to, label, also}], listed under "Strings" on each item.
//                       also (0.7.1) = more cards joined to that string where its label is (a T junction)
//   "put inside":       data.parent, the same tree the lists show. What's inside a card is listed on it.

import { sanitize, escHtml as esc } from './editor.js';
import { clipOf, clipFaceHTML, iframeHTML, clipDivHTML } from './media.js';
import { cleanDrawing, drawingSVG, drawDivHTML, drawingBox, moveDrawing, openDrawing } from './draw.js';
import { cleanSheet, sheetTableHTML, sheetDivHTML } from './sheet.js';
import { docInfo, linkInfo, docTileHTML, linkTileHTML, docDivHTML, linkDivHTML, fileKind } from './attach.js';
import { previewKind, KIND_ASPECT } from './preview.js';
import { TRANS_NAMES, FX, LOOKS, SIZES, timeline, totalTime, openPlayer } from './record.js';
import { terms, matchItem } from './search.js';
import { money, costOf, tagChips } from './plan.js';

const CARD_W = 220, GAP = 28, PAD = 24, HEAD = 46;
const SECTION_W = 2 * PAD + 2 * CARD_W + GAP, SECTION_H = 320;
const MIN_Z = 0.15, MAX_Z = 2.5;
export const COLOURS = ['yellow', 'orange', 'pink', 'purple', 'blue', 'green', 'white'];
const PINS = ['#D23B2F', '#2E8B3E', '#2F6FC8', '#E8B21E', '#8E44AD', '#E4702A'];
// The String button and what it asks you to tap are the same on every look, so it's always easy to
// find (0.7.1: it used to be renamed Trace, Pipe, Neon… to suit the look). What's said when a
// string is tied or cut still suits the look.
const TIE = { btn: 'String', first: 'Tap a card to start a string from, or a string’s label to branch it', next: 'Now tap the card to tie it to' };
const WORDS = {
  corkboard: { ...TIE, tie: 'Tie a red string', cut: 'String cut.', done: 'Tied with a red string.', hint: 'Drag a card’s pin onto another card, or tap String, to tie them together.' },
  whiteboard: words('Draw an arrow', 'Arrow rubbed out.', 'Arrow drawn.'),
  blueprint: words('Draw a line', 'Line removed.', 'Line drawn.'),
  notebook: words('Draw an arrow', 'Arrow rubbed out.', 'Arrow drawn.'),
  circuit: words('Route a trace', 'Trace removed.', 'Trace routed.'),
  city: words('Run a transit line', 'Line closed.', 'Line opened.'),
  neon: words('Bend a neon tube', 'Tube switched off.', 'Tube lit.'),
  minimal: words('Draw a line', 'Line removed.', 'Line drawn.'),
  hacker: words('Pipe one into the other', 'Pipe killed.', 'Piped.'),
  chalkboard: words('Chalk an arrow', 'Arrow wiped off.', 'Arrow chalked.'),
  space: words('Join the stars', 'Constellation broken.', 'Stars joined.'),
};
function words(tie, cut, done) {
  return { ...TIE, tie, cut, done, hint: 'Drag the dot on a card’s edge onto another card, or tap String, to tie them together.' };
}
const LABEL_RX = { corkboard: 3, whiteboard: 11, blueprint: 0, notebook: 4, circuit: 0, city: 5, neon: 11, minimal: 6, hacker: 0, chalkboard: 4, space: 11 };
// The class each look's strings are drawn with (and the dashed one that follows your finger).
const WIRE_CLASS = { whiteboard: 'marker', blueprint: 'rule', notebook: 'pen', circuit: 'trace', city: 'metro', neon: 'tube', minimal: 'thin', hacker: 'pipe', chalkboard: 'chalk', space: 'starline' };
// City lines and neon tubes come in a few colours (each string keeps its own), unless you've picked one.
const LINE_COLOURS = {
  city: ['#E2382F', '#0060A8', '#00843D', '#F39C12', '#8E44AD', '#E4007C', '#00A0B0', '#7A5230'],
  neon: ['#FF3EA5', '#22E3FF', '#39FF9A', '#B98CFF', '#FFB03B', '#FF5B5B'],
};

export function createBoard(host, api) {
  // api: { store, index(), open(id), openBoard(id), selected(), today(), fmtDay(s), progress(id), titleOf(r), toast(msg, label, fn), newItem(type, parent, extra), placePicker(key, exclude, onPick), style() }
  host.innerHTML = `
    <header class="boardhead">
      <button class="back" data-act="back-nav"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Lists</span></button>
      <h2></h2>
      <button class="iconbtn bfind" aria-label="Find on this board" title="Find on this board (/)"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg></button>
      <button class="iconbtn bexport" data-act="export-board" aria-label="Print or export the board" title="Print or export"><svg viewBox="0 0 24 24"><path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg></button>
      <button class="tolist" data-act="board-list">List view</button>
      <button class="iconbtn bsettings" data-act="settings" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg></button>
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
      <div class="media"></div>
    </div>
    <div class="boardbar">
      <button data-b="add" class="addbtn" title="Add a note, to-do, section, YouTube clip or drawing">+ Add</button>
      <button data-b="tie" title="Tap one card, then another, to connect them">String</button>
      <button data-b="draw" title="Draw straight onto the board">Draw</button>
      <button data-b="rec" class="recbtn" title="Make a video of the board: shots, moves and effects">Record</button>
      <span class="sep"></span>
      <button data-b="tidy" title="Lay everything out neatly again">Tidy</button>
      <span class="sep"></span>
      <button data-b="out" aria-label="Zoom out">−</button>
      <button data-b="fit" title="Fit everything on screen">Fit</button>
      <button data-b="in" aria-label="Zoom in">+</button>
    </div>
    <div class="stringpop" hidden><input placeholder="Label (optional)" maxlength="40"><button data-s="save">Save</button><button data-s="branch" title="Join another card to this string">Branch</button><button data-s="auto" title="Let the autorouter find its way again" hidden>Auto</button><button data-s="remove" class="danger">Remove</button><button data-s="dir" class="dirbtn" title="Tap to change which way it points"></button><p class="pophint">Drag the string or its dots to reshape it. Double-tap a big dot to take that turn out.</p></div>
    <div class="boardmenu" hidden></div>
    <p class="boardhint" hidden></p>
    <div class="tidytip" hidden></div>`;
  const cork = host.querySelector('.cork');
  const world = host.querySelector('.world');
  const lines = host.querySelector('.strings .lines');
  const framesEl = host.querySelector('.frames');
  const cardsEl = host.querySelector('.cards');
  const pop = host.querySelector('.stringpop');
  const menuEl = host.querySelector('.boardmenu');
  const hint = host.querySelector('.boardhint');
  const mediaEl = host.querySelector('.media');
  cork.style.setProperty('--cork-tex', `url(${corkTexture()})`);
  let playing = null;               // {id, el, clip}: the clip playing on its card (one at a time)

  let key = null;                 // the project whose board this is
  let view = { x: 40, y: 40, z: 1 };
  let pos = new Map();            // id -> {x, y, w?, h?}: cards, sections, and the banner (under the project's id)
  const heights = new Map();      // card heights as last drawn
  let cards = [], frames = [], frameIds = new Set(), guests = new Set();
  let busy = false, pendingRender = false, needsFit = false;
  let popLink = null, menuActions = [];
  let tying = false, tieFrom = null;   // "String" mode: tap one card, then the one to tie it to
                                       // (tieFrom 'L:from|to' = a string picked, to branch it to a card)
  let tieOnce = false;                 // String mode just for one branch (from a string's Branch button)
  let sketching = null;                // a drawing on the board being changed (its card is hidden meanwhile)
  const isSketch = r => !!r?.data.sketch;
  const junctions = new Map();         // 'from|to' -> where that string's label (and its branches) sit
  const shown = new Map();             // (0.7.6) 'from|to' -> the string as drawn (its corners in .pts)
  let selString = null;                // (0.7.6) the string showing its dots to shape it by
  let viaDraft = null, lastViaTap = null;   // (the shape while it's being dragged; a tap on a dot, for double-taps)
  const look = () => (api.style() in WORDS ? api.style() : 'corkboard');
  const words = () => WORDS[look()];
  const isFrame = id => frameIds.has(id);
  // Each card's size on this board (data.cork[key].s, 1 = normal); it grows from its top-left corner.
  const scales = new Map();
  const sc = id => scales.get(id) || 1;
  const cw = id => CARD_W * sc(id);

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
    const h = id => heights.get(id) || 140 * sc(id);
    const saved = r => { const p = r.data.cork?.[key]; return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { ...p } : null; };
    const rank = r => ({ task: 0, note: 1, project: 2 }[r.data.type] ?? 3);
    const order = (a, b) => rank(a) - rank(b) || (a.data.order || 0) - (b.data.order || 0) || (a.data.created || '').localeCompare(b.data.created || '');
    const kidsOf = s => cards.filter(c => c.data.parent === s.id);
    const pack = (list, cols) => {
      const colY = Array(cols).fill(0), at = new Map();
      const colW = Math.max(CARD_W, ...list.map(r => cw(r.id)));
      for (const r of list) {
        let c = 0;
        for (let i = 1; i < cols; i++) if (colY[i] < colY[c] - 1) c = i;
        at.set(r.id, { x: c * (colW + GAP), y: colY[c] });
        colY[c] += h(r.id) + GAP;
      }
      return { at, w: cols * (colW + GAP) - GAP, h: Math.max(0, Math.max(...colY) - GAP) };
    };

    for (const s of frames) { const p = saved(s); if (p && p.w) out.set(s.id, p); }
    const savedFrameAt = pt => { let best = null, area = Infinity; for (const s of frames) { const f = out.get(s.id); if (f && inRect(f, pt) && f.w * f.h < area) { best = s.id; area = f.w * f.h; } } return best; };
    for (const c of cards) {
      const p = saved(c);
      if (!p) continue;
      const where = savedFrameAt({ x: p.x + cw(c.id) / 2, y: p.y + h(c.id) / 2 });
      const home = frameIds.has(c.data.parent) ? c.data.parent : null;
      if (where === home) out.set(c.id, { x: p.x, y: p.y });
    }

    // Nothing of this project's own placed yet (a new board, or one just tidied): laid out by what's
    // strung to what (0.7.2). Cards brought in from elsewhere keep their spots; this goes under them.
    // (drawings on the board don't count: they stay where they were drawn, and the rest is laid out as usual)
    const sketchIds = new Set(cards.filter(isSketch).map(r => r.id));
    if (![...out.keys()].some(id => !guests.has(id) && !sketchIds.has(id)) && (cards.length || frames.length)) {
      let gx = Infinity, gy = -Infinity;
      for (const [id, p] of out) if (guests.has(id)) { gx = Math.min(gx, p.x); gy = Math.max(gy, p.y + h(id)); }
      const sm = autoTidy(cards.filter(c => !out.has(c.id)));
      const dx = gx === Infinity ? 0 : gx, dy = gy === -Infinity ? 0 : gy + 90;
      for (const [id, p] of sm) out.set(id, { ...p, x: p.x + dx, y: p.y + dy });
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
      for (const k of kidsOf(s)) { const p = out.get(k.id); if (p) { f.w = Math.max(f.w, p.x + cw(k.id) + PAD - f.x); f.h = Math.max(f.h, p.y + h(k.id) + PAD - f.y); } }
    }

    // The banner: where you put it (data.cork.banner on the project), or centred over the top of everything.
    const bp = I.byId.get(key)?.data.cork?.banner;
    if (bp && Number.isFinite(bp.x) && Number.isFinite(bp.y)) out.set(key, { x: bp.x, y: bp.y });
    else {
      let lx = Infinity, rx = -Infinity, ty = Infinity;
      for (const [id, p] of out) { lx = Math.min(lx, p.x); rx = Math.max(rx, p.x + (p.w || cw(id))); ty = Math.min(ty, p.y); }
      const bw = heights.get('banner:w') || 300, bh = heights.get('banner:h') || 70;
      out.set(key, lx === Infinity ? { x: 0, y: -bh - 40 } : { x: Math.round((lx + rx) / 2 - bw / 2), y: Math.round(ty - bh - 60) });
    }
    return out;
  }

  // ---------- Tidy (0.7.5) ----------
  // A board laid out to be read, sections first as whole blocks, then the cards inside each:
  //  - things go in the order they flow (what feeds into what), reading left to right and down
  //  - what's strung together sits together
  //  - strings cross each other, and cards that aren't theirs, as little as possible
  //  - the whole board is about the shape of the screen it's tidied on
  // It starts from the flow order, then tries swapping sections, swapping cards within sections
  // and making sections narrower or wider, keeping each change that scores tidier. (0.7.8: scored
  // with strings where they're really drawn, from a few starts; then, on looks that route, with the
  // strings routed by the autorouter, like a circuit board's autoplacer: see routedUntidiness. 0.7.9:
  // tried packed tight as well as in neat rows, see place and gridOf; and a card strung only to things
  // outside its section is tried out of it, and the move suggested: see strandedCards.)
  //   tidyAll(todo):  everything laid out from scratch (Tidy everything, and a board nothing's been placed on)
  //   tidyInside():   sections stay where they are; the cards in each are rearranged

  const TG = 96;   // the gap between sections (room for strings to pass)
  const hOf = id => heights.get(id) || 140 * sc(id);
  const rankOf = r => ({ task: 0, note: 1, project: 2 }[r.data.type] ?? 3);
  const byOrder = (a, b) => rankOf(a) - rankOf(b) || (a.data.order || 0) - (b.data.order || 0) || (a.data.created || '').localeCompare(b.data.created || '');
  const screenShape = () => clamp(cork.clientWidth / Math.max(1, cork.clientHeight - 60), 0.45, 2.4) || 1.6;

  // The strings between these things, as one-way ties: from → to, and from → each of its branches.
  function tiesAmong(ids) {
    const out = [];
    for (const r of [...frames, ...cards]) {
      if (!ids.has(r.id)) continue;
      for (const l of r.data.links || []) {
        if (ids.has(l.to) && l.to !== r.id) out.push([r.id, l.to]);
        for (const c of l.also || []) if (ids.has(c) && c !== r.id) out.push([r.id, c]);
      }
    }
    return out;
  }

  // (0.7.8) The strings among these things as they're drawn: from → to, with any branches.
  function stringsAmong(ids) {
    const out = [];
    for (const r of [...frames, ...cards]) {
      if (!ids.has(r.id)) continue;
      for (const l of r.data.links || []) {
        if (!ids.has(l.to) || l.to === r.id) continue;
        out.push({ a: r.id, b: l.to, also: (l.also || []).filter(c => ids.has(c) && c !== r.id && c !== l.to) });
      }
    }
    return out;
  }

  // Do two straight lines cross (not just meet at an end)?
  function segsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }

  // How hard an arrangement is to read, as one number: lower is tidier. pos: id -> {x, y, w?, h?}.
  // (0.7.8) Each string is judged where it's really drawn: from the side of its card facing the other
  // (not the middle), and a branch from halfway along its string (where the label and knot go) to its
  // card. So two strings from the same card that would cross (one leaving above the other, then
  // passing under it) count as crossing, and Tidy moves a card to stop it if it can.
  // (rough: the quicker, smoother 0.7.5 way, middle to middle, where strings from the same card never
  // count as crossing: a good start for the search, which is then finished the drawn way)
  function untidiness(pos, strs, A, rough = false) {
    const box = id => { const p = pos.get(id); return p && { x: p.x, y: p.y, w: p.w ?? cw(id), h: p.h ?? hOf(id) }; };
    const mid = id => { const b = box(id); return b && { x: b.x + b.w / 2, y: b.y + (isFrame(id) ? HEAD / 2 : b.h / 2) }; };
    const side = id => { const b = box(id); return b && (isFrame(id) ? { ...b, h: HEAD } : b); };   // (a section's strings go to its name)
    const back = (p, q) => q.y < p.y - 80 || (Math.abs(q.y - p.y) <= 80 && q.x < p.x - 80);
    let s = 0;
    const segs = [];   // [p, q, which string, the cards it's tied to]
    if (rough) {
      let n = 0;
      for (const t of strs) for (const c of [t.b, ...t.also]) {
        const p = mid(t.a), q = mid(c);
        if (!p || !q) continue;
        s += Math.hypot(q.x - p.x, q.y - p.y);
        if (back(p, q)) s += 800;
        segs.push([p, q, n++, new Set([t.a, c])]);
      }
    }
    else strs.forEach((t, n) => {
      const A0 = side(t.a), B0 = side(t.b);
      if (!A0 || !B0) return;
      const { p0, p3 } = facing(A0, B0, 0), tied = new Set([t.a, t.b, ...t.also]);
      s += Math.hypot(p3.x - p0.x, p3.y - p0.y);                                                // short strings
      if (back(mid(t.a), mid(t.b))) s += 800;                                                    // ones running backwards
      segs.push([p0, p3, n, tied]);
      if (!t.also.length) return;
      const J = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
      for (const c of t.also) {
        const C = side(c);
        if (!C) continue;
        const q = facing({ x: J.x, y: J.y, w: 0, h: 0 }, C, 0).p3;
        s += Math.hypot(q.x - J.x, q.y - J.y);
        if (back(mid(t.a), mid(c))) s += 800;
        segs.push([J, q, n, tied]);
      }
    });
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {       // strings crossing strings
      const [p1, q1, n1, t1] = segs[i], [p2, q2, n2, t2] = segs[j];
      if (n1 === n2 || (rough && [...t1].some(id => t2.has(id)))) continue;
      if (segsCross(p1, q1, p2, q2)) s += 700;
    }
    const others = [];
    for (const id of pos.keys()) if (!isFrame(id) && id !== key) { const b = box(id); others.push({ id, x: b.x + 10, y: b.y + 10, w: b.w - 20, h: b.h - 20 }); }
    for (const [p, q, , tied] of segs) for (const o of others) if (!tied.has(o.id) && segHits(p, q, o)) s += 900;   // strings over other cards
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of pos.keys()) { const b = box(id); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    if (x0 < Infinity) s += Math.max(x1 - x0, (y1 - y0) * A) * 1.2;                           // fits the screen
    return s;
  }

  // (0.7.8) The same, but with the strings really routed: like a circuit board's autoplacer, the
  // cards are put where this arrangement has them (for a moment), the autorouter routes every string
  // and branch, and what comes out is measured: crossings, length, turns. Slower, so Tidy only uses
  // it to choose between its best few layouts and then nudge the best one, on the looks that route.
  // (null on a look that doesn't route its strings)
  function routedUntidiness(cand, strs, A) {
    if (!ROUND_LOOKS.has(look())) return null;
    const saved = new Map([...cand.keys()].map(id => [id, pos.get(id)]));
    const ob = obstacles, fb = frameBoxes;
    try {
      for (const [id, p] of cand) pos.set(id, { ...(pos.get(id) || {}), ...p });
      frameBoxes = frames.filter(r => cand.has(r.id)).map(r => { const b = rectOf(r.id); return b && { id: r.id, x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }; }).filter(Boolean);
      obstacles = cards.filter(r => cand.has(r.id) && !isSketch(r)).map(r => { const b = rectOf(r.id); return b && { id: r.id, x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 }; }).filter(Boolean);
      if (!obstacles.length) return null;
      const jobs = routeJobs().filter(j => cand.has(j.from) && cand.has(j.to));
      for (const j of jobs) { j.via = null; j.also = j.also.filter(c => cand.has(c)); }   // (as Tidy leaves them: shaped strings routed afresh)
      const map = computeRoutes(jobs), lines = [];
      jobs.forEach((j, n) => {
        const s = map.get(j.k);
        if (s?.pts) lines.push({ P: s.pts, n });
        for (const c of j.also) { const b = map.get(j.k + '+' + c); if (b?.s?.pts) lines.push({ P: b.s.pts, n }); }
      });
      let s = untidiness(cand, [], A), turns = 0, crossings = 0;          // (how it fits the screen)
      for (const L of lines) {
        const P = L.P;
        s += polyLen(P);
        for (let i = 1; i < P.length - 1; i++) {
          let d = Math.abs(Math.atan2(P[i + 1].y - P[i].y, P[i + 1].x - P[i].x) - Math.atan2(P[i].y - P[i - 1].y, P[i].x - P[i - 1].x));
          if (d > Math.PI) d = 2 * Math.PI - d;
          if (d > 0.5) turns++;
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const p of P) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        L.bb = { x0, y0, x1, y1 };
      }
      for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
        const a = lines[i], b = lines[j];
        if (a.n === b.n || a.bb.x1 < b.bb.x0 || b.bb.x1 < a.bb.x0 || a.bb.y1 < b.bb.y0 || b.bb.y1 < a.bb.y0) continue;
        for (let p = 1; p < a.P.length; p++) for (let q = 1; q < b.P.length; q++) if (segsCross(a.P[p - 1], a.P[p], b.P[q - 1], b.P[q])) crossings++;
      }
      // (and strings running backwards, as before)
      const mid = id => { const b = rectOf(id); return b && { x: b.x + b.w / 2, y: b.y + (isFrame(id) ? HEAD / 2 : b.h / 2) }; };
      for (const t of strs) for (const c of [t.b, ...t.also]) {
        const p = mid(t.a), q = mid(c);
        if (p && q && (q.y < p.y - 80 || (Math.abs(q.y - p.y) <= 80 && q.x < p.x - 80))) s += 800;
      }
      return s + turns * 12 + crossings * 700;
    } finally {
      for (const [id, p] of saved) if (p) pos.set(id, p); else pos.delete(id);
      obstacles = ob; frameBoxes = fb;
    }
  }

  // (0.7.7) Room for labels: how wide the label is on a string between two cards (either way round).
  // (a string that points needs a bit more, so its arrowheads show either side of the label)
  let labelRoom = new Map();
  function measureLabelRoom() {
    labelRoom = new Map();
    for (const r of [...frames, ...cards]) for (const l of r.data.links || []) if (l.label) {
      const d = dirOf(l), w = labelSize(l.label).w + (d === 'both' ? 48 : d === 'none' ? 0 : 26);
      for (const k of [r.id + '|' + l.to, l.to + '|' + r.id]) { const o = labelRoom.get(k); labelRoom.set(k, { w: Math.max(o?.w || 0, w), points: !!o?.points || d !== 'none' }); }
    }
  }
  const roomBetween = (a, b) => labelRoom.get(a + '|' + b)?.w || 0;
  const pointsBetween = (a, b) => !!labelRoom.get(a + '|' + b)?.points;

  // Cards in reading order: left to right, then the next row down. (0.7.7: where a labelled string
  // joins two cards side by side, the gap between those columns is wide enough for its label, up to
  // a point; one above the other, the gap between those rows is.)
  function gridOf(list, cols, stack = true) {
    const colW = Math.max(CARD_W, ...list.map(r => cw(r.id)));
    const rows = [];
    for (let i = 0; i < list.length; i += cols) rows.push(list.slice(i, i + cols));
    const colGap = new Array(Math.max(0, cols - 1)).fill(GAP), rowGap = new Array(Math.max(0, rows.length - 1)).fill(GAP);
    rows.forEach((row, i) => row.forEach((r, j) => {
      const right = row[j + 1], below = rows[i + 1]?.[j];
      if (right) { const w = roomBetween(r.id, right.id); if (w) colGap[j] = Math.max(colGap[j], Math.min(200, w + 30)); }
      if (below && roomBetween(r.id, below.id)) rowGap[i] = Math.max(rowGap[i], pointsBetween(r.id, below.id) ? 72 : 50);
    }));
    // (0.7.9, stack) Each column stacks its own cards, so a short card doesn't leave a gap under it
    // the height of the tallest card in its row. (The gap above a card is the one its row would have.)
    const place = new Map(), colY = new Array(cols).fill(0);
    let w = 0;
    rows.forEach((row, i) => {
      let x = 0;
      const top = i ? Math.max(...colY) : 0;
      row.forEach((r, j) => {
        const y = !i ? 0 : (stack ? colY[j] : top) + (rowGap[i - 1] ?? GAP);
        place.set(r.id, { x, y });
        colY[j] = y + hOf(r.id);
        x += colW + (colGap[j] ?? 0);
      });
      w = Math.max(w, x - (colGap[row.length - 1] ?? 0));
    });
    return { place, w, h: Math.max(0, ...colY) };
  }

  // Things in the order they flow: each after what feeds into it (where strings go round in a
  // circle, whatever has fewest coming in goes first), and next to what it was strung to just before;
  // otherwise in the order they're in the list.
  function flowOrder(nodes, w) {
    const left = [...nodes], out = [];
    while (left.length) {
      let bi = 0, best = Infinity;
      left.forEach((n, i) => {
        let inn = 0, outw = 0, near = 0;
        for (const o of left) if (o !== n) { inn += w(o, n); outw += w(n, o); }
        for (let k = out.length - 1, f = 1; k >= 0 && f > 0.1; k--, f /= 2) near += (w(out[k], n) + w(n, out[k])) * f;
        const v = inn * 1000 - near * 50 - outw * 4 + i * 20;
        if (v < best) { best = v; bi = i; }
      });
      out.push(left.splice(bi, 1)[0]);
    }
    return out;
  }

  // (0.7.9) par: cards to lay out as if they were somewhere else (id -> a section's id, or the
  // project's for not in a section), so Tidy can see how the board would look with them moved.
  // How tidy the layout it settles on is (lower is tidier) is left in tidyScore.
  let tidyScore = 0;
  function tidyAll(todo, budget = 400, par = null) {
    measureLabelRoom();
    const A = screenShape(), tall = A < 0.9, maxCols = tall ? 2 : 3;
    const ids = new Set([...frames, ...todo].map(r => r.id));
    const ties = tiesAmong(ids), strs = stringsAmong(ids);
    const wt = new Map();
    for (const [a, b] of ties) wt.set(a + '>' + b, (wt.get(a + '>' + b) || 0) + 1);
    const w = (a, b) => wt.get(a + '>' + b) || 0;
    const cardFlow = list => flowOrder([...list].sort(byOrder), (a, b) => w(a.id, b.id));
    const P = c => (par?.has(c.id) ? par.get(c.id) : c.data.parent);
    const parentOf = id => { const c = todo.find(c => c.id === id); return c && P(c); };
    const inSection = id => frameIds.has(id) || frameIds.has(parentOf(id));

    // The blocks to place: each section with its cards; loose cards strung into a section, one by
    // one (so they can sit beside it); loose cards strung only to each other, as a group; and the
    // rest in one block at the end.
    const units = [];
    for (const s of [...frames].sort((a, b) => (a.data.order || 0) - (b.data.order || 0))) {   // (in their list order)
      const kids = cardFlow(todo.filter(c => P(c) === s.id));
      units.push({ frame: s, members: kids, cols: Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(kids.length)))) });
    }
    const loose = todo.filter(c => !frameIds.has(P(c))).sort(byOrder);
    const linked = id => ties.filter(([a, b]) => a === id || b === id).map(([a, b]) => (a === id ? b : a));
    for (const c of loose.filter(c => linked(c.id).some(inSection))) units.push({ members: [c], cols: 1 });
    const rest = loose.filter(c => !linked(c.id).some(inSection)), seen = new Set(), single = [];
    for (const c of rest) {
      if (seen.has(c.id)) continue;
      const group = [], stack = [c];
      seen.add(c.id);
      while (stack.length) {
        const x = stack.pop();
        group.push(x);
        for (const y of linked(x.id)) { const r = rest.find(z => z.id === y); if (r && !seen.has(y)) { seen.add(y); stack.push(r); } }
      }
      if (group.length > 1) units.push({ members: cardFlow(group), cols: Math.min(maxCols, Math.ceil(Math.sqrt(group.length))) });
      else single.push(c);
    }
    if (single.length) units.push({ members: single, cols: Math.min(tall ? 2 : 4, Math.max(1, Math.ceil(Math.sqrt(single.length)))), last: true });

    let tight = false;   // (0.7.9: see place)
    const build = u => {
      const g = gridOf(u.members, u.cols, tight);
      if (u.frame) {
        u.w = Math.max(320, g.w + 2 * PAD); u.h = Math.max(220, HEAD + PAD + g.h + PAD);
        u.place = new Map([[u.frame.id, { x: 0, y: 0, w: u.w, h: u.h }]]);
        for (const [id, p] of g.place) u.place.set(id, { x: PAD + p.x, y: HEAD + PAD + p.y });
      } else { u.w = g.w; u.h = g.h; u.place = g.place; }
    };
    units.forEach(build);
    const unitOf = new Map();
    for (const u of units) for (const id of u.place.keys()) unitOf.set(id, u);
    const uw = (U, V) => { let n = 0; for (const [a, b] of ties) if (unitOf.get(a) === U && unitOf.get(b) === V) n++; return n; };
    const order = flowOrder(units.filter(u => !u.last), uw);
    const lastU = units.find(u => u.last);
    if (lastU) order.push(lastU);

    // Rows to read along, as wide as suits the screen. (0.7.9, tight: each block goes as high as the
    // blocks above it allow, like a skyline, rather than every row starting under the tallest block
    // of the row before, so a block under a short one tucks up instead of leaving a gap; and the cards
    // in each section stack by column, see gridOf. It's tried both ways, tight and in neat rows, and
    // whichever comes out tidier on this screen is kept: tight usually wins on a phone.)
    const area = units.reduce((t, u) => t + (u.w + TG) * (u.h + TG), 0);
    const widest = Math.max(...units.map(u => u.w));
    let rowW = Math.max(widest, Math.sqrt(area * A));
    const place = () => {
      const pos = new Map(), sky = [];
      let x = 0, rowY = 0, rowB = 0;
      for (const u of order) {
        if (x > 0 && x + u.w > rowW) { x = 0; rowY = rowB + TG; }
        let y = 0;
        if (!tight) { y = rowY; rowB = Math.max(rowB, y + u.h); }
        else for (const s of sky) if (s.x0 < x + u.w + TG / 2 && s.x1 > x - TG / 2) y = Math.max(y, s.y + TG);
        for (const [id, p] of u.place) pos.set(id, { ...p, x: x + p.x, y: y + p.y });
        sky.push({ x0: x, x1: x + u.w, y: y + u.h });
        x += u.w + TG;
      }
      return pos;
    };
    let best = Infinity, rough = false;
    const score = () => untidiness(place(), strs, A, rough);
    const keep = undo => { const s = score(); if (s < best - 1) { best = s; return true; } undo(); return false; };
    // (rows a bit narrower or wider, if that suits the screen better)
    const tryWidths = () => {
      const base = rowW;
      for (const k of [0.7, 0.85, 1.2, 1.45, 1.75]) {
        const was = rowW;
        rowW = Math.max(widest, base * k);
        keep(() => { rowW = was; });
      }
    };
    const improve = until => {
      for (let pass = 0; pass < 5 && performance.now() < until; pass++) {
        let better = false;
        for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
          if (order[i].last || order[j].last) continue;
          [order[i], order[j]] = [order[j], order[i]];
          if (keep(() => { [order[i], order[j]] = [order[j], order[i]]; })) better = true;
        }
        for (const u of units) {
          const m = u.members;
          for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
            [m[i], m[j]] = [m[j], m[i]]; build(u);
            if (keep(() => { [m[i], m[j]] = [m[j], m[i]]; build(u); })) better = true;
          }
          for (const c of [u.cols - 1, u.cols + 1]) {
            if (c < 1 || c > maxCols || c > m.length || u.last) continue;
            const was = u.cols; u.cols = c; build(u);
            if (keep(() => { u.cols = was; build(u); })) better = true;
          }
        }
        if (!better) break;
      }
    };
    // (0.7.8) Swapping one thing at a time can get stuck in a layout that's only tidier than its
    // neighbours, so it goes a few ways and keeps the tidiest it finds: the rough way first and then
    // finished the drawn way, and the drawn way from scratch at a few row widths.
    // (0.7.9: and each of those packed tight and in neat rows.)
    const snap = () => ({ order: [...order], members: units.map(u => [...u.members]), cols: units.map(u => u.cols), rowW, tight, score: best });
    const restore = s => { tight = s.tight; order.splice(0, order.length, ...s.order); units.forEach((u, i) => { u.members = [...s.members[i]]; u.cols = s.cols[i]; build(u); }); rowW = s.rowW; best = s.score; };
    const start = snap(), base = rowW, found = [];
    for (const t of [false, true]) for (const [k, r] of [[1, true], [1, false], [0.75, false], [1.4, false]]) {
      restore({ ...start, tight: t });
      rowW = Math.max(widest, base * k);
      rough = r; best = score();
      tryWidths(); improve(performance.now() + 100); tryWidths();
      if (rough) { rough = false; best = score(); improve(performance.now() + 100); tryWidths(); }
      found.push(snap());
    }
    found.sort((a, b) => a.score - b.score);
    restore(found[0]);
    // (0.7.8) Then with the strings really routed (see routedUntidiness): each of these different
    // layouts nudged (cards swapped, sections narrower or wider, sections swapped) while that's
    // tidier, and the tidiest kept. (So a layout that suits the screen gets the chance to lose its
    // crossings, rather than one that doesn't winning because it has none.)
    const same = (s, t) => s.rowW === t.rowW && s.tight === t.tight && s.order.every((u, i) => u === t.order[i]) && s.cols.every((c, i) => c === t.cols[i]) && s.members.every((m, i) => m.every((c, j) => c === t.members[i][j]));
    let tries = found.filter((s, i) => !found.slice(0, i).some(t => same(s, t)));
    let bestR = routedUntidiness(place(), strs, A);
    tidyScore = bestR ?? best;
    if (bestR != null && budget > 0) {
      // (0.7.9: all of them routed as they are, and the best three nudged, so each gets time enough)
      for (const s of tries) { restore(s); s.routed = routedUntidiness(place(), strs, A); }
      tries = tries.sort((a, b) => a.routed - b.routed).slice(0, 3);
      const t0 = performance.now();
      let top = null;
      tries.forEach((s, n) => {
        restore(s);
        bestR = s.routed;
        nudge(t0 + budget * (n + 1) / tries.length);
        const r = snap();
        r.routed = bestR;
        if (!top || r.routed < top.routed) top = r;
      });
      restore(top);
      tidyScore = top.routed;
    }
    return place();
    function nudge(until) {
      const keepR = undo => { const v = routedUntidiness(place(), strs, A); if (v < bestR - 1) { bestR = v; return true; } undo(); return false; };
      for (let pass = 0; pass < 4 && performance.now() < until; pass++) {
        let better = false;
        for (const u of units) {
          const m = u.members;
          for (let i = 0; i < m.length && performance.now() < until; i++) for (let j = i + 1; j < m.length; j++) {
            [m[i], m[j]] = [m[j], m[i]]; build(u);
            if (keepR(() => { [m[i], m[j]] = [m[j], m[i]]; build(u); })) better = true;
          }
          for (const c of [u.cols - 1, u.cols + 1]) {
            if (c < 1 || c > maxCols || c > m.length || u.last || performance.now() > until) continue;
            const was = u.cols; u.cols = c; build(u);
            if (keepR(() => { u.cols = was; build(u); })) better = true;
          }
        }
        for (let i = 0; i < order.length && performance.now() < until; i++) for (let j = i + 1; j < order.length; j++) {
          if (order[i].last || order[j].last) continue;
          [order[i], order[j]] = [order[j], order[i]];
          if (keepR(() => { [order[i], order[j]] = [order[j], order[i]]; })) better = true;
        }
        if (!better) break;
      }
    }
  }

  function tidyInside() {
    measureLabelRoom();
    const A = screenShape();
    const pos = new Map();
    for (const r of [...frames, ...cards]) { const b = rectOf(r.id); if (b) pos.set(r.id, isFrame(r.id) ? { x: b.x, y: b.y, w: b.w, h: b.h } : { x: b.x, y: b.y }); }
    const ties = tiesAmong(new Set(pos.keys())), strs = stringsAmong(new Set(pos.keys()));
    const wt = new Map();
    for (const [a, b] of ties) wt.set(a + '>' + b, (wt.get(a + '>' + b) || 0) + 1);
    const w = (a, b) => wt.get(a + '>' + b) || 0;
    const secs = [];
    for (const s of frames) {
      const f = pos.get(s.id);
      if (!f) continue;
      const kids = flowOrder(cards.filter(c => c.data.parent === s.id && !guests.has(c.id) && !isSketch(c)).sort(byOrder), (a, b) => w(a.id, b.id));
      const colW = Math.max(CARD_W, ...kids.map(r => cw(r.id)));
      secs.push({ s, f, kids, cols: Math.max(1, Math.min(kids.length || 1, Math.floor((f.w - 2 * PAD + GAP) / (colW + GAP)))) });
    }
    let stack = true;   // (0.7.9: cards stacked by column, or in neat rows if that's tidier, at the end)
    const apply = sec => {
      const g = gridOf(sec.kids, sec.cols, stack);
      for (const [id, p] of g.place) pos.set(id, { x: sec.f.x + PAD + p.x, y: sec.f.y + HEAD + PAD + p.y });
      sec.f.w = Math.max(320, g.w + 2 * PAD, sec.w0 ?? (sec.w0 = sec.f.w));
      sec.f.h = Math.max(220, HEAD + PAD + g.h + PAD);
    };
    secs.forEach(apply);
    const search = (rough, until) => {
      let best = untidiness(pos, strs, A, rough);
      for (let pass = 0; pass < 5 && performance.now() < until; pass++) {
        let better = false;
        for (const sec of secs) {
          const m = sec.kids;
          for (let i = 0; i < m.length; i++) for (let j = i + 1; j < m.length; j++) {
            [m[i], m[j]] = [m[j], m[i]]; apply(sec);
            const s = untidiness(pos, strs, A, rough);
            if (s < best - 1) { best = s; better = true; } else { [m[i], m[j]] = [m[j], m[i]]; apply(sec); }
          }
        }
        if (!better) break;
      }
    };
    // (0.7.8: the rough way then finished the drawn way, or the drawn way from scratch, whichever's tidier)
    const kidsNow = () => secs.map(sec => [...sec.kids]);
    const setKids = ks => secs.forEach((sec, i) => { sec.kids = [...ks[i]]; apply(sec); });
    const start = kidsNow();
    search(true, performance.now() + 150); search(false, performance.now() + 150);
    const first = kidsNow(), firstScore = untidiness(pos, strs, A), firstR = routedUntidiness(pos, strs, A);
    setKids(start); search(false, performance.now() + 150);
    let bestR = routedUntidiness(pos, strs, A);
    if (bestR != null ? bestR > firstR : untidiness(pos, strs, A) > firstScore) { setKids(first); bestR = firstR; }
    // (0.7.8) Then with the strings really routed (see routedUntidiness), cards swapped while that's tidier.
    if (bestR != null) {
      const until = performance.now() + 400;
      for (let pass = 0; pass < 4 && performance.now() < until; pass++) {
        let better = false;
        for (const sec of secs) {
          const m = sec.kids;
          for (let i = 0; i < m.length && performance.now() < until; i++) for (let j = i + 1; j < m.length; j++) {
            [m[i], m[j]] = [m[j], m[i]]; apply(sec);
            const v = routedUntidiness(pos, strs, A);
            if (v < bestR - 1) { bestR = v; better = true; } else { [m[i], m[j]] = [m[j], m[i]]; apply(sec); }
          }
        }
        if (!better) break;
      }
    }
    {
      const now = bestR ?? untidiness(pos, strs, A);
      stack = false; secs.forEach(apply);
      const rows = routedUntidiness(pos, strs, A) ?? untidiness(pos, strs, A);
      if (rows >= now - 1) { stack = true; secs.forEach(apply); }
    }
    const out = new Map();
    for (const sec of secs) { out.set(sec.s.id, pos.get(sec.s.id)); for (const k of sec.kids) out.set(k.id, pos.get(k.id)); }
    return out;
  }

  // A board nothing's been placed on is laid out the same way, worked out once (until something
  // on it changes) rather than at every redraw.
  let autoCache = null;
  function autoTidy(todo) {
    const sig = JSON.stringify([key, look(), Math.round(screenShape() * 10), todo.map(r => [r.id, r.data.parent || '', Math.round(hOf(r.id)), sc(r.id)]), frames.map(f => f.id), tiesAmong(new Set([...frames, ...todo].map(r => r.id))),
      [...frames, ...todo].flatMap(r => (r.data.links || []).filter(l => l.label).map(l => r.id + l.to + l.label.length + (l.dir || '')))]);
    if (autoCache?.sig !== sig) autoCache = { sig, out: tidyAll(todo, 250) };
    return new Map([...autoCache.out].map(([id, p]) => [id, { ...p }]));
  }

  // ---------- Drawing ----------

  function render() {
    if (busy) { pendingRender = true; return; }
    if (!key || !cork.clientWidth) { stopPlay(); return; }     // hidden (a phone showing an item): drawn when it's back
    const I = api.index();
    const proj = I.byId.get(key);
    if (!proj) return;
    ({ cardList: cards, frameList: frames, guestIds: guests } = members(I));
    frameIds = new Set(frames.map(f => f.id));
    scales.clear();
    // (a drawing on the board can be any size: it's as big as it was drawn)
    for (const r of cards) { const v = +r.data.cork?.[key]?.s; if (v && Math.abs(v - 1) > 0.01) scales.set(r.id, isSketch(r) ? clamp(v, 0.15, 8) : clamp(v, 0.5, 3)); }
    const t = api.today(), sel = api.selected();
    host.querySelector('.boardhead h2').textContent = api.titleOf(proj);
    framesEl.innerHTML = frames.map(r => frameHTML(r, I, sel)).join('');
    cardsEl.innerHTML = bannerHTML(proj, sel) + cards.map(r => cardHTML(r, I, t, sel)).join('');
    // Measure first (a card is the same size wherever it goes), then lay out.
    for (const el of cardsEl.querySelectorAll('.pbody')) if (el.scrollHeight > el.clientHeight + 2) el.classList.add('clip');
    for (const el of cardsEl.children) {
      if (el.dataset.banner !== undefined) { heights.set('banner:w', el.offsetWidth); heights.set('banner:h', el.offsetHeight); }
      else heights.set(el.dataset.card, el.offsetHeight * sc(el.dataset.card));
    }
    pos = layout(I);
    for (const el of [...framesEl.children].sort((a, b) => area(b.dataset.frame) - area(a.dataset.frame))) framesEl.append(el);
    for (const el of framesEl.children) placeEl(el);
    for (const el of cardsEl.children) placeEl(el);
    placeMedia();
    for (const img of cardsEl.querySelectorAll('img[data-thumb]')) api.store.fileUrl(img.dataset.thumb).then(u => { if (u) img.src = u; else img.remove(); });
    // (0.7.9) files with no picture of their own yet: made on this device (see app.js docPreviewUrl)
    for (const img of cardsEl.querySelectorAll('img[data-docpv]')) {
      const cid = img.closest('[data-card]')?.dataset.card;
      const d = cid && cardBody(api.store.get(cid)?.data.body).docs.find(x => x.id === img.dataset.docpv);
      if (d && api.docPreview) api.docPreview(d).then(u => { if (u) img.src = u; else img.remove(); }); else img.remove();
    }
    const hasLinks = [...cards, ...frames].some(r => (r.data.links || []).length);
    const tieBtn = host.querySelector('[data-b=tie]');
    tieBtn.textContent = words().btn;
    tieBtn.classList.toggle('on', tying);
    if (tying) {
      const lk = tieFrom?.startsWith('L:') ? tieFrom.slice(2) : null, lb = lk && linkOf(lk);
      hint.textContent = lb ? `Now tap the card to join to ${lb.label ? `“${short(lb.label)}”` : 'that string'} (or tap it again to let go).`
        : tieFrom && I.byId.get(tieFrom) ? `${words().next} (or tap “${short(api.titleOf(I.byId.get(tieFrom)))}” again to let go).` : `${words().first}.`;
      hint.hidden = false;
    }
    else if (!cards.length && !frames.length) { hint.textContent = 'Nothing here yet. Add a note, a to-do or a section below.'; hint.hidden = false; }
    else { hint.textContent = words().hint; hint.hidden = cards.length < 2 || hasLinks || readLocal('bt-hint-seen', false); }
    drawLines();
    if (needsFit) { needsFit = false; fit(); } else applyView();
    if (findQ) runFind(findQ, false);
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
    // A drawing made on the board: just the drawing, see-through, exactly as big as it was drawn.
    if (d.sketch) {
      const m = cardBody(d.body).media;
      if (m?.kind === 'draw' && m.d) return `
      <div class="pcard t-note sketch ${sel === r.id ? 'on' : ''} ${tieFrom === r.id ? 'tiefrom' : ''} ${scales.has(r.id) ? 'scaled' : ''} ${sketching === r.id ? 'sketching' : ''}" data-card="${r.id}" style="--pin:${PINS[hash(r.id) % PINS.length]}${scales.has(r.id) ? ';--s:' + sc(r.id) : ''}">
        <span class="pin" data-pin="${r.id}" title="Drag onto another card to connect"></span>
        <div class="pdraw">${drawingSVG(m.d, { bare: true })}</div>
        <span class="csize" data-csize="${r.id}" title="Drag to make it bigger or smaller"></span>
      </div>`;
    }
    // A locked project shows only its name until it's unlocked (its notes are part of what's hidden).
    const locked = type === 'project' && !!api.locked?.(r);
    const { html: body, media, more, minis = [] } = locked ? {} : cardBody(d.body);
    const chips = [];
    const prog = type === 'project' && !locked ? api.progress(r.id) : null;
    if (locked) chips.push(`<span class="chip locked"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Locked</span>`);
    else if (type === 'project') {
      if (prog.total) chips.push(`<span class="chip">${prog.done}/${prog.total}</span>`);
      if (d.start || d.due) chips.push(`<span class="chip ${!d.done && d.due && d.due < t ? 'late' : ''}">${d.start ? api.fmtDay(d.start) : '…'} → ${d.due ? api.fmtDay(d.due) : '…'}</span>`);
    } else if (d.due && type === 'task') chips.push(`<span class="chip ${!d.done && d.due < t ? 'late' : d.due === t ? 'now' : ''}">${api.fmtDay(d.due)}</span>`);
    // (0.9.0) what it costs, and what it's waiting on
    if (type === 'task' && +d.cost) chips.push(`<span class="chip money">${money(d.cost)}</span>`);
    if (type === 'project' && !locked) { const c = costOf(api.index(), r.id); if (c.n) chips.push(`<span class="chip money">${money(c.spent)} of ${money(c.planned)}</span>`); }
    const waits = type === 'task' && !d.done && api.isWaiting?.(r) ? api.waitingOn(r) : null;
    if (waits) chips.unshift(`<span class="chip wait" title="Waiting on ${esc(waits.join(', '))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/></svg>Waiting on ${esc(short(waits[0]))}${waits.length > 1 ? ` +${waits.length - 1}` : ''}</span>`);
    if (guests.has(r.id)) { const p = I.project(r); chips.push(`<span class="chip guest">From ${esc(p ? short(api.titleOf(p)) : 'Inbox')}</span>`); }
    // (a clip already shows its video's name, so a note named after it doesn't repeat it)
    const sameAsClip = media?.kind === 'clip' && (d.title || '').trim() === (media.clip.title || '').trim();
    const showTitle = type !== 'note' || ((d.title || '').trim() && !sameAsClip) || (!body && !media);
    const kids = type === 'project' ? [] : (I.kids.get(r.id) || []);
    const n = hash(r.id);
    // The note's first photo, clip or drawing is the card's picture.
    const pic = !media ? ''
      : media.kind === 'photo' ? `<img class="polaroid" data-thumb="${media.id}" alt="">`
      : media.kind === 'clip' ? `<div class="pclip">${clipFaceHTML(media.clip, { big: true })}</div>`
      : media.kind === 'sheet' ? `<div class="psheet">${sheetTableHTML(media.sheet, { maxRows: 10, maxCols: 6 })}</div>`
      : media.kind === 'doc' ? docPicHTML(media.doc)
      : media.kind === 'link' ? `<div class="ptile" data-linkopen title="Open the link">${linkTileHTML(media.link)}</div>`
      : `<div class="pdraw">${drawingSVG(media.d)}</div>`;
    return `
      <div class="pcard t-${type} ${d.color ? 'c-' + d.color : ''} ${d.done ? 'is-done' : ''} ${waits ? 'waiting' : ''} ${sel === r.id ? 'on' : ''} ${tieFrom === r.id ? 'tiefrom' : ''} ${playing?.id === r.id ? 'playing' : ''} ${scales.has(r.id) ? 'scaled' : ''}" data-card="${r.id}" style="--tilt:${((n % 7) - 3) * 0.6}deg;--pin:${PINS[n % PINS.length]}${scales.has(r.id) ? ';--s:' + sc(r.id) : ''}">
        <span class="pin" data-pin="${r.id}" title="Drag onto another card to connect"></span>
        ${pic}
        ${showTitle ? `<div class="ptitle">${type === 'task' ? `<button class="tick ${d.done ? 'done' : ''}" data-tick="${r.id}" aria-label="Done"></button>` : ''}<span>${tagChips(esc(api.titleOf(r)))}</span></div>` : ''}
        ${body ? `<div class="pbody">${body}</div>` : ''}
        ${minis.length ? `<div class="pminis">${minis.map(m => `<span class="pmini${m.doc ? ' paper' : ''}">${m.id ? `<img data-thumb="${esc(m.id)}" alt="">` : m.doc.pv ? `<img data-thumb="${esc(m.doc.pv)}" alt="">` : `<img data-docpv="${esc(m.doc.id)}" alt="">`}</span>`).join('')}</div>` : ''}
        ${more ? `<p class="pmore">${esc(more)}</p>` : ''}
        ${kids.length ? kidsHTML(kids) : ''}
        ${prog && prog.total ? `<span class="pbar"><i style="width:${Math.round(100 * prog.done / prog.total)}%"></i></span>` : ''}
        ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
        ${type === 'project' && !locked ? `<span class="openboard" data-openboard="${r.id}">Open its board ›</span>` : ''}
        <span class="csize" data-csize="${r.id}" title="Drag to make it bigger or smaller"></span>
      </div>`;
  }

  // (0.7.9) A file pinned up as what it looks like: a PDF's page (or the part of it you picked), a
  // picture, a video's frame, a spreadsheet's first rows… (see preview.js), with its kind and name on
  // a label along the bottom. Its picture's shape is known before it loads, so the card doesn't
  // change size. Just its tile if it's a kind with no picture, or you chose that.
  function docPicHTML(d) {
    const kind = previewKind(d);
    if (d.pv === 'off' || !kind) return `<div class="ptile" data-docopen title="Open the file">${docTileHTML({ ...d, pv: undefined, page: undefined, crop: undefined })}</div>`;
    const k = fileKind(d.name, d.mime), a = clamp(+d.pva || KIND_ASPECT[kind] || 0.75, 0.62, 2.6);
    return `<div class="pdoc k-${kind}" data-docopen title="Open the file" style="--pva:${Math.round(a * 1000) / 1000}">
      <span class="dpage"><img class="docpv" ${d.pv ? `data-thumb="${esc(d.pv)}"` : `data-docpv="${esc(d.id)}"`} alt=""></span>
      <span class="dlabel"><b style="--k:${k.colour}">${esc(k.label)}</b><span>${esc(d.name)}</span></span></div>`;
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
      <div class="frame ${r.data.color ? 'c-' + r.data.color : ''} ${sel === r.id ? 'on' : ''} ${tieFrom === r.id ? 'tiefrom' : ''}" data-frame="${r.id}" style="--pin:${PINS[hash(r.id) % PINS.length]}">
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
    return { x: p.x, y: p.y, w: p.w || el.offsetWidth * sc(id), h: p.h || el.offsetHeight * sc(id) };
  };
  const centre = id => { const r = rectOf(id); return r && { x: r.x + r.w / 2, y: r.y + (isFrame(id) ? HEAD / 2 : r.h / 2) }; };
  // Corkboard: where a card's push pin is (top middle), or a section's (on its label).
  const pinPoint = id => {
    const r = rectOf(id);
    if (!r) return null;
    if (!isFrame(id)) return { x: r.x + r.w / 2, y: r.y + 10 * sc(id) };
    const head = elOf(id).querySelector('.fhead'), pin = head.querySelector('.fpin');
    return { x: r.x + head.offsetLeft + pin.offsetLeft + pin.offsetWidth / 2, y: r.y + head.offsetTop + pin.offsetTop + pin.offsetHeight / 2 };
  };

  // ---------- Strings, one kind per look ----------

  // Corkboard wool: sags under its own weight, more the further it goes.
  function sag(a, b, extra = 0) {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const droop = Math.min(140, 18 + dist * 0.18) + extra;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 + droop;
    // (line: the curve as points, for labels and arrowheads to follow)
    const line = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16, u = 1 - t; line.push({ x: u * u * a.x + 2 * u * t * mx + t * t * b.x, y: u * u * a.y + 2 * u * t * my + t * t * b.y }); }
    return { d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`, mid: { x: mx, y: (a.y + b.y) / 4 + my / 2 }, line };
  }

  // The sides of two boxes that face each other, and where on them a string leaves and arrives.
  // (0.7.2) Anywhere along the side, not only its middle: level where the two cards overlap,
  // otherwise aimed at the other card, keeping clear of the corners.
  function facing(A, B, gap) {
    const ac = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, bc = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const dx = bc.x - ac.x, dy = bc.y - ac.y;
    const along = (a0, al, b0, bl, toB, toA) => {
      const lo = Math.max(a0 + al * 0.2, b0 + bl * 0.2), hi = Math.min(a0 + al * 0.8, b0 + bl * 0.8);
      if (lo <= hi) { const m = Math.round((lo + hi) / 2); return [m, m]; }
      return [clamp(toB, a0 + al * 0.2, a0 + al * 0.8), clamp(toA, b0 + bl * 0.2, b0 + bl * 0.8)];
    };
    if (Math.abs(dx) * (A.h + B.h) > Math.abs(dy) * (A.w + B.w)) {
      const s = Math.sign(dx) || 1, [ya, yb] = along(A.y, A.h, B.y, B.h, bc.y, ac.y);
      return { horiz: true, p0: { x: s > 0 ? A.x + A.w : A.x, y: ya }, n0: { x: s, y: 0 }, p3: { x: s > 0 ? B.x - gap : B.x + B.w + gap, y: yb }, n3: { x: -s, y: 0 } };
    }
    const s = Math.sign(dy) || 1, [xa, xb] = along(A.x, A.w, B.x, B.w, bc.x, ac.x);
    return { horiz: false, p0: { x: xa, y: s > 0 ? A.y + A.h : A.y }, n0: { x: 0, y: s }, p3: { x: xb, y: s > 0 ? B.y - gap : B.y + B.h + gap }, n3: { x: 0, y: -s } };
  }

  // Whiteboard marker, notebook pen and chalk: a curve drawn by hand.
  function inked(A, B, seed, opts) {
    const { p0, n0, p3, n3 } = facing(A, B, 5);
    const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
    const k = Math.max(40, dist * 0.4);
    const p1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k }, p2 = { x: p3.x + n3.x * k, y: p3.y + n3.y * k };
    const N = Math.max(12, Math.min(40, Math.round(dist / 14)));
    const raw = [];
    for (let i = 0; i <= N; i++) raw.push(cubic(p0, p1, p2, p3, i / N));
    return inkPath(raw, seed, opts);
  }
  // Hand-drawn along a line of points: a little wobble (none at the ends), an open arrowhead.
  function inkPath(raw, seed, { amp, head, cls }) {
    const N = raw.length - 1;
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
    // (bare: without its arrowhead, for a string set to point another way: see withArrows)
    return { d, mid: pts[Math.round(N / 2)], pts: raw, bare: `<path class="wire ${cls}" d="${d}"/>`, html: `<path class="wire ${cls}" d="${d}"/><path class="wire ${cls}" d="${hd}"/>` };
  }

  // Corners of a route: straight runs that turn at right angles, or (city lines, traces) run at 45°
  // between two straight ends when there's room.
  function routePts(A, B, gap, diagonal) {
    const { p0, p3, horiz } = facing(A, B, gap);
    const dx = p3.x - p0.x, dy = p3.y - p0.y;
    if (diagonal && horiz && Math.abs(dx) >= Math.abs(dy)) { const run = (Math.abs(dx) - Math.abs(dy)) / 2 * Math.sign(dx); return [p0, { x: p0.x + run, y: p0.y }, { x: p3.x - run, y: p3.y }, p3]; }
    if (diagonal && !horiz && Math.abs(dy) >= Math.abs(dx)) { const run = (Math.abs(dy) - Math.abs(dx)) / 2 * Math.sign(dy); return [p0, { x: p0.x, y: p0.y + run }, { x: p3.x, y: p3.y - run }, p3]; }
    if (horiz) { const mx = Math.round((p0.x + p3.x) / 2); return [p0, { x: mx, y: p0.y }, { x: mx, y: p3.y }, p3]; }
    const my = Math.round((p0.y + p3.y) / 2);
    return [p0, { x: p0.x, y: my }, { x: p3.x, y: my }, p3];
  }
  // A path through route corners, each corner cut at 45° (cut) or rounded (round), at most r long.
  function cornered(pts, r, round) {
    let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], b = pts[i + 1];
      const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(b.x - p.x, b.y - p.y), k = Math.min(r, la / 2, lb / 2);
      if (k < 0.5) { d += `L${f(p.x)} ${f(p.y)}`; continue; }
      const p1 = { x: p.x - (p.x - a.x) / la * k, y: p.y - (p.y - a.y) / la * k }, p2 = { x: p.x + (b.x - p.x) / lb * k, y: p.y + (b.y - p.y) / lb * k };
      d += `L${f(p1.x)} ${f(p1.y)}` + (round ? `Q${f(p.x)} ${f(p.y)} ${f(p2.x)} ${f(p2.y)}` : `L${f(p2.x)} ${f(p2.y)}`);
    }
    const z = pts[pts.length - 1];
    return d + `L${f(z.x)} ${f(z.y)}`;
  }
  // Halfway along a route (where its label goes), or any fraction t of the way.
  const alongMid = pts => alongAt(pts, 0.5);
  function alongAt(pts, t) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    let left = len * t;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l > 0 && l >= left) return { x: a.x + (b.x - a.x) * left / l, y: a.y + (b.y - a.y) * left / l };
      left -= l;
    }
    return pts[pts.length - 1];
  }
  // ---------- Where labels go (0.7.7) ----------
  // A string's label goes on a clear stretch of it: not over a card or a section's name, not on
  // another label, and over as few other strings as it can (every look). If the string has no
  // room (two cards close together), the label sits just beside it, in the nearest clear space,
  // with a dotted line back to the string. Shortest strings are placed first (they have least
  // room). Tidy leaves room for labels between cards, and the autorouter keeps other strings from
  // running under them. (A knot where branches meet, on a string with no label, is placed the same
  // way, but only on the string.)
  const labelSize = label => ({ w: label.length * 7.2 + 16, h: 22 });
  function labelBlocks() {
    const out = [];
    for (const id of [key, ...cards.filter(r => !isSketch(r)).map(r => r.id)]) { const b = rectOf(id); if (b) out.push({ x: b.x - 3, y: b.y - 3, w: b.w + 6, h: b.h + 6 }); }
    for (const r of frames) { const b = rectOf(r.id); if (b) out.push({ x: b.x, y: b.y, w: b.w, h: HEAD - 8 }); }   // (a section's name)
    return out;
  }
  const boxHit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  // The nearest point on a line of points to p.
  function nearestOn(pts, p) {
    let best = pts[0], bd = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1) : 0, q = { x: a.x + dx * t, y: a.y + dy * t }, d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  function labelSpot(s, label, placed, blocks, others, knot = false) {
    const pts = s.line || s.pts;
    if (!pts || pts.length < 2) return { x: s.mid.x, y: s.mid.y };
    const { w, h } = knot ? { w: 14, h: 14 } : labelSize(label);
    const boxAt = p => ({ x: p.x - w / 2 - 3, y: p.y - h / 2 - 3, w: w + 6, h: h + 6 });
    const cost = p => {
      const b = boxAt(p);
      let c = 0;
      for (const o of blocks) if (boxHit(b, o)) c += 1e6;
      for (const o of placed) if (boxHit(b, o)) c += 1e6;
      for (const o of others) for (let i = 1; i < o.length; i++) if (segHits(o[i - 1], o[i], b)) { c += 60; break; }
      return c;
    };
    // Spots to try, the most natural first: along the string, then beside it, then further round.
    const cands = [];
    for (const t of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82]) cands.push({ p: alongAt(pts, t), base: Math.abs(t - 0.5) * 40 });
    if (!knot) {
      for (const t of [0.5, 0.36, 0.64, 0.22, 0.78]) {
        const P = alongAt(pts, t), a = alongAt(pts, Math.max(0, t - 0.04)), b = alongAt(pts, Math.min(1, t + 0.04));
        const tl = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / tl, ny = (b.x - a.x) / tl;
        const half = Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;
        for (const k of [1, 1.8, 2.8, 4.2]) for (const sg of [1, -1]) {
          const d = (half + 9) * k;
          cands.push({ p: { x: P.x + nx * d * sg, y: P.y + ny * d * sg }, base: 120 + d + Math.abs(t - 0.5) * 60, beside: true });
        }
      }
      const P = alongAt(pts, 0.5);
      for (const r of [70, 110, 160, 220]) for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; cands.push({ p: { x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r * 0.6 }, base: 160 + r, beside: true }); }
    }
    cands.sort((a, b) => a.base - b.base);
    let best = cands[0], bestC = Infinity;
    for (const c of cands) {
      if (c.base >= bestC) break;        // (nothing after this can do better)
      const v = c.base + cost(c.p);
      if (v < bestC) { bestC = v; best = c; }
    }
    placed.push(boxAt(best.p));
    const out = { x: best.p.x, y: best.p.y, w, h };
    if (best.beside) out.anchor = nearestOn(pts, best.p);
    return out;
  }
  // Labels (and knots) for a list of strings ({s, label, knot}), each given its spot (.at).
  function placeLabels(list, blocks = labelBlocks()) {
    const placed = [], lines = list.map(it => it.s.line || it.s.pts || []);
    const order = list.map((_, i) => i).filter(i => list[i].label || list[i].knot).sort((a, b) => polyLen(lines[a]) - polyLen(lines[b]));
    for (const i of order) list[i].at = labelSpot(list[i].s, list[i].label, placed, blocks, lines.filter((_, k) => k !== i), !list[i].label);
    return list;
  }
  // Every string's label as it's drawn: off arrowheads too, so a short string's arrow isn't hidden
  // under its label. (The autorouter works its branches out from the same spots: see computeRoutes.)
  function labelsAsDrawn(items) {
    const blocks = labelBlocks();
    for (const it of items) blocks.push(...headZones(it.s, dirOf(it.l), look()));
    return placeLabels(items, blocks);
  }

  // ---------- Which way a string points (0.7.7) ----------
  // data.links[].dir: 'to' (an arrowhead at the card it was tied to), 'from' (at the card it was
  // tied from), 'both' or 'none'. Left unset, it's the look's own: an arrow at the far end on the
  // looks that draw one. Branches follow their string.
  const ARROW_LOOKS = new Set(['blueprint', 'hacker', 'minimal', 'whiteboard', 'notebook', 'chalkboard']);
  const DIRS = ['to', 'from', 'both', 'none'];
  const dirOf = l => (DIRS.includes(l?.dir) ? l.dir : ARROW_LOOKS.has(look()) ? 'to' : 'none');
  // (how far back from each end an arrowhead's tip goes, clear of the dot, pad, station, star or pin there)
  const TIP_BACK = { corkboard: [9, 9], city: [8, 8], circuit: [6.5, 6.5], space: [8, 8], blueprint: [4.5, 0] };
  function backAlong(P, d) {
    for (let i = P.length - 1; i > 0; i--) {
      const a = P[i], b = P[i - 1], l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l >= d) return { x: a.x + (b.x - a.x) * d / l, y: a.y + (b.y - a.y) * d / l };
      d -= l;
    }
    return P[0];
  }
  // An arrowhead at the end of a line of points, drawn the look's way.
  function arrowHead(P, L, lc, back) {
    const tip = backAlong(P, back), base = backAlong(P, back + 12), ang = Math.atan2(tip.y - base.y, tip.x - base.x);
    const at = (len, side) => ({ x: tip.x - len * Math.cos(ang) + side * Math.sin(ang), y: tip.y - len * Math.sin(ang) - side * Math.cos(ang) });
    const tri = (len, half, cls = 'shead') => { const a = at(len, half), b = at(len, -half); return `<path class="${cls}" ${lc || ''} d="M${f(tip.x)} ${f(tip.y)}L${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}z"/>`; };
    const vee = (len, cls) => { const a = at(len, len * 0.5), b = at(len, -len * 0.5); const d = `M${f(a.x)} ${f(a.y)}L${f(tip.x)} ${f(tip.y)}L${f(b.x)} ${f(b.y)}`; return cls.map(c => `<path class="wire ${c}" ${lc || ''} d="${d}"/>`).join(''); };
    if (L === 'whiteboard') return vee(15, ['marker']);
    if (L === 'chalkboard') return vee(15, ['chalk']);
    if (L === 'notebook') return vee(11, ['pen']);
    if (L === 'neon') return vee(14, ['tube glow', 'tube']);
    if (L === 'city') return tri(17, 8.5);
    if (L === 'corkboard') return tri(15, 7);
    if (L === 'circuit') return tri(13, 6);
    if (L === 'space') return tri(10, 4.5);
    return tri(10, 4.5, 'arrowhead');   // (blueprint, hacker, minimal: like their usual arrow)
  }
  // A string (or branch) drawn pointing the way it's set to. startGap: how far its start is hidden
  // (a branch starts under its string's label).
  function withArrows(s, dir, L, startGap = 0) {
    let html = (s.bare ?? s.html).replace(/ marker-end="url\(#bt-arrow\)"/g, '');
    const P = s.line || s.pts;
    if (!P || P.length < 2 || dir === 'none') return html;
    const [b0, b1] = TIP_BACK[L] || [1, 0];
    if (dir === 'to' || dir === 'both') html += arrowHead(P, L, s.lc, b1);
    if (dir === 'from' || dir === 'both') html += arrowHead([...P].reverse(), L, s.lc, Math.max(b0, startGap));
    return html;
  }
  // Where a string's arrowheads are (boxes round them), for labels to keep off.
  function headZones(s, dir, L) {
    const P = s.line || s.pts, out = [];
    if (!P || P.length < 2 || dir === 'none') return out;
    const [b0, b1] = TIP_BACK[L] || [1, 0], zone = c => ({ x: c.x - 11, y: c.y - 11, w: 22, h: 22 });
    if (dir === 'to' || dir === 'both') out.push(zone(backAlong(P, b1 + 8)));
    if (dir === 'from' || dir === 'both') out.push(zone(backAlong([...P].reverse(), b0 + 8)));
    return out;
  }
  // How far along a line of points it first comes out of a box.
  function outOf(P, box) {
    let n = 0;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], l = Math.hypot(b.x - a.x, b.y - a.y), k = Math.max(1, Math.ceil(l / 2));
      for (let j = 1; j <= k; j++) { const x = a.x + (b.x - a.x) * j / k, y = a.y + (b.y - a.y) * j / k; if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) return n + l * j / k; }
      n += l;
    }
    return n;
  }
  // A route with its corners rounded, as points every few pixels (for the hand-drawn looks).
  function bendPts(pts, r, step) {
    const out = [pts[0]];
    const lineTo = (a, b) => { const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / step)); for (let i = 1; i <= n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }); };
    let cur = pts[0];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], p = pts[i], b = pts[i + 1];
      const la = Math.hypot(p.x - a.x, p.y - a.y), lb = Math.hypot(b.x - p.x, b.y - p.y), k = Math.min(r, la / 2, lb / 2);
      if (k < 0.5) continue;
      const p1 = { x: p.x - (p.x - a.x) / la * k, y: p.y - (p.y - a.y) / la * k }, p2 = { x: p.x + (b.x - p.x) / lb * k, y: p.y + (b.y - p.y) / lb * k };
      lineTo(cur, p1);
      const n = Math.max(3, Math.round(k * 1.6 / step));
      for (let j = 1; j <= n; j++) { const t = j / n, u = 1 - t; out.push({ x: u * u * p1.x + 2 * u * t * p.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * p.y + t * t * p2.y }); }
      cur = p2;
    }
    lineTo(cur, pts[pts.length - 1]);
    return out;
  }

  function wire(fromId, toId, via) {
    if (via?.length) return viaWire(fromId, toId, via);   // (0.7.6: shaped by hand)
    if (look() === 'corkboard') {
      const a = pinPoint(fromId), b = pinPoint(toId);
      return a && b ? wool(a, b) : null;
    }
    // (all the strings routed together by the autorouter, when nothing's being dragged: see computeRoutes)
    const routed = routeMap?.get(fromId + '|' + toId);
    if (routed) return { ...routed };
    const A = rectOf(fromId), B = rectOf(toId);
    if (!A || !B) return null;
    const seed = fromId + '>' + toId;
    return dodge(shape(A, B, seed), A, B, new Set([fromId, toId]), seed, seed);
  }
  // A branch: from where a string's label sits (J) to another card, drawn like the look's strings
  // (from a point instead of a card) and, for city lines and neon, in the same colour as the string.
  function branchWire(J, toId, stringKey) {
    if (look() === 'corkboard') { const b = pinPoint(toId); return b ? wool(J, b) : null; }
    const B = rectOf(toId);
    if (!B) return null;
    const A = { x: J.x, y: J.y, w: 0, h: 0 }, seed = stringKey + '+' + toId;
    return dodge(shape(A, B, seed, stringKey), A, B, new Set([toId]), seed, stringKey);
  }
  function wool(a, b) {
    const s = sag(a, b);
    return { ...s, pts: [a, b], mids: [{ ...s.mid, ins: 0 }], html: `<path class="wire wool" d="${s.d}"/><path class="wire twist" d="${s.d}"/>` };
  }
  const lineColour = (L, key) => (LINE_COLOURS[L] && !api.ownWire?.() ? `style="--lc:${LINE_COLOURS[L][hash(key) % LINE_COLOURS[L].length]}"` : '');
  const GAP_AT_END = { blueprint: 7, circuit: 9, city: 9, hacker: 8, minimal: 7, neon: 4, space: 2 };

  // The look's string between two boxes; seedKey picks its wobble, colourKey its colour.
  function shape(A, B, seedKey, colourKey = seedKey) {
    const L = look(), gap = GAP_AT_END[L] ?? 5;
    if (L === 'blueprint' || L === 'hacker') return alongPts(routePts(A, B, gap, false), seedKey, colourKey);
    if (L === 'circuit' || L === 'city') return alongPts(routePts(A, B, gap, true), seedKey, colourKey);
    if (L === 'minimal' || L === 'space') { const { p0, p3 } = facing(A, B, gap); return alongPts([p0, p3], seedKey, colourKey); }
    if (L === 'neon') {
      // A glass tube bent in one smooth curve.
      const lc = lineColour(L, colourKey);
      const { p0, n0, p3, n3 } = facing(A, B, gap), k = Math.max(40, Math.hypot(p3.x - p0.x, p3.y - p0.y) * 0.45);
      const p1 = { x: p0.x + n0.x * k, y: p0.y + n0.y * k }, p2 = { x: p3.x + n3.x * k, y: p3.y + n3.y * k };
      const d = `M${f(p0.x)} ${f(p0.y)}C${f(p1.x)} ${f(p1.y)} ${f(p2.x)} ${f(p2.y)} ${f(p3.x)} ${f(p3.y)}`;
      const pts = [];
      for (let i = 0; i <= 14; i++) pts.push(cubic(p0, p1, p2, p3, i / 14));
      return { d, mid: cubic(p0, p1, p2, p3, 0.5), pts, lc, html: `<path class="wire tube glow" ${lc} d="${d}"/><path class="wire tube" ${lc} d="${d}"/>` };
    }
    if (L === 'chalkboard') return inked(A, B, hash(seedKey), { amp: 2.2, head: 15, cls: 'chalk' });
    return inked(A, B, hash(seedKey), L === 'whiteboard' ? { amp: 2.6, head: 15, cls: 'marker' } : { amp: 1.2, head: 11, cls: 'pen' });
  }

  // A string along a route (a list of corners), drawn the look's way.
  function alongPts(pts, seedKey, colourKey) {
    const L = look(), lc = lineColour(L, colourKey), a = pts[0], z = pts[pts.length - 1];
    const out = (d, html) => ({ d, mid: alongMid(pts), pts, lc, html });
    if (L === 'blueprint') { const d = cornered(pts, 0, false); return out(d, `<path class="wire rule" d="${d}" marker-end="url(#bt-arrow)"/><circle class="wire-dot" cx="${f(a.x)}" cy="${f(a.y)}" r="3.5"/>`); }
    if (L === 'circuit') { const d = cornered(pts, 14, false); return out(d, `<path class="wire trace" d="${d}"/><circle class="pad" cx="${f(a.x)}" cy="${f(a.y)}" r="5"/><circle class="pad" cx="${f(z.x)}" cy="${f(z.y)}" r="5"/>`); }
    if (L === 'city') { const d = cornered(pts, 26, true); return out(d, `<path class="wire metro" ${lc} d="${d}"/><circle class="station" ${lc} cx="${f(a.x)}" cy="${f(a.y)}" r="6.5"/><circle class="station" ${lc} cx="${f(z.x)}" cy="${f(z.y)}" r="6.5"/>`); }
    if (L === 'hacker') { const d = cornered(pts, 0, false); return out(d, `<path class="wire pipe" d="${d}" marker-end="url(#bt-arrow)"/>`); }
    if (L === 'minimal') { const d = cornered(pts, 14, true); return out(d, `<path class="wire thin" d="${d}" marker-end="url(#bt-arrow)"/>`); }
    if (L === 'space') {
      const d = cornered(pts, 0, false), star = p => `<circle class="star halo" cx="${f(p.x)}" cy="${f(p.y)}" r="7"/><circle class="star" cx="${f(p.x)}" cy="${f(p.y)}" r="3"/>`;
      return out(d, `<path class="wire starline" d="${d}"/>${star(a)}${star(z)}`);
    }
    if (L === 'neon') { const d = cornered(pts, 40, true); return out(d, `<path class="wire tube glow" ${lc} d="${d}"/><path class="wire tube" ${lc} d="${d}"/>`); }
    const o = L === 'chalkboard' ? { amp: 2.2, head: 15, cls: 'chalk' } : L === 'whiteboard' ? { amp: 2.6, head: 15, cls: 'marker' } : { amp: 1.2, head: 11, cls: 'pen' };
    return { ...inkPath(bendPts(pts, 34, 14), hash(seedKey), o), pts };   // (pts: just the corners)
  }

  // ---------- Strings that go round cards (0.7.2) ----------
  // On every look but Corkboard (wool crosses things, like the real thing) and Space (a
  // constellation is a straight line), a string whose usual way would cross another card takes
  // the shortest tidy way round instead: out of whichever side of its card suits, then straight
  // runs with right-angle turns (rounded or cut the look's way), keeping clear of the cards between.
  const ROUND_LOOKS = new Set(['whiteboard', 'blueprint', 'notebook', 'circuit', 'city', 'neon', 'minimal', 'hacker', 'chalkboard']);
  let obstacles = null;   // the cards (and the banner) to keep clear of, a little bigger than drawn
  let frameBoxes = null;  // (0.7.4) the sections: a string goes round one it isn't in, if that's not far
  let routeMap = null;    // every string's route, worked out together (0.7.6: by the autorouter, see computeRoutes)

  function segHits(p, q, r) {
    let t0 = 0, t1 = 1;
    const dx = q.x - p.x, dy = q.y - p.y;
    for (const [pp, qq] of [[-dx, p.x - r.x], [dx, r.x + r.w - p.x], [-dy, p.y - r.y], [dy, r.y + r.h - p.y]]) {
      if (pp === 0) { if (qq <= 0) return false; continue; }
      const t = qq / pp;
      if (pp < 0) { if (t >= t1) return false; if (t > t0) t0 = t; }
      else { if (t <= t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-6;
  }
  const crosses = (pts, obs) => { for (let i = 1; i < pts.length; i++) for (const o of obs) if (segHits(pts[i - 1], pts[i], o)) return true; return false; };
  const holds = (A, B) => A.w && B.x >= A.x && B.y >= A.y && B.x + B.w <= A.x + A.w && B.y + B.h <= A.y + A.h;

  function dodge(s, A, B, skip, seedKey, colourKey) {
    if (!s?.pts || !obstacles || !ROUND_LOOKS.has(look()) || holds(A, B) || holds(B, A)) return s;
    const obs = obstacles.filter(o => !skip.has(o.id));
    // (sections the string isn't in: from or to one of their cards, or the section itself)
    const ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    const soft = (frameBoxes || []).filter(fr => !skip.has(fr.id) && !inRect(fr, ca) && !inRect(fr, cb));
    if (!crosses(s.pts, obs) && !crosses(s.pts, soft)) return s;
    const r = findRoute(A, B, obs, GAP_AT_END[look()] ?? 5, soft);
    return r ? alongPts(r.pts, seedKey, colourKey) : s;
  }

  // (crossing a card costs a lot; going through a section the string isn't in costs a little, so it
  // goes round unless that's a long way; 0.7.5: crossing another string, or running along on top
  // of one, costs a little too.) Returns {pts, score, pen}: pen is what the route still crosses.
  const STRING_CROSS = 160, STRING_ALONG = 3;
  function stringCost(p, q, others) {
    let c = 0;
    for (const o of others) {
      if (segsCross(p, q, o.p, o.q)) { c += STRING_CROSS; continue; }
      // (lying along another string, a few pixels apart, costs by the length shared)
      const flat = Math.abs(p.y - q.y) < 0.5 && Math.abs(o.p.y - o.q.y) < 0.5 && Math.abs(p.y - o.p.y) < 7;
      const upright = Math.abs(p.x - q.x) < 0.5 && Math.abs(o.p.x - o.q.x) < 0.5 && Math.abs(p.x - o.p.x) < 7;
      if (flat) c += Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(o.p.x, o.q.x)) - Math.max(Math.min(p.x, q.x), Math.min(o.p.x, o.q.x))) * STRING_ALONG;
      else if (upright) c += Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(o.p.y, o.q.y)) - Math.max(Math.min(p.y, q.y), Math.min(o.p.y, o.q.y))) * STRING_ALONG;
    }
    return c;
  }
  function findRoute(A, B, obs, gap, soft = [], others = []) {
    const M = 16, BEND = 40, CROSS = 5000, THROUGH = 700;
    const ca = { x: A.x + A.w / 2, y: A.y + A.h / 2 }, cb = { x: B.x + B.w / 2, y: B.y + B.h / 2 };
    // Where a string may leave (or reach) a card: any side but the one facing right away, at the
    // point along it nearest the other card.
    const ports = (X, to) => {
      if (!X.w && !X.h) return [{ p: { x: X.x, y: X.y }, n: null }];
      const ay = clamp(to.y, X.y + X.h * 0.2, X.y + X.h * 0.8), ax = clamp(to.x, X.x + X.w * 0.2, X.x + X.w * 0.8);
      return [
        { p: { x: X.x + X.w, y: ay }, n: { x: 1, y: 0 } }, { p: { x: X.x, y: ay }, n: { x: -1, y: 0 } },
        { p: { x: ax, y: X.y + X.h }, n: { x: 0, y: 1 } }, { p: { x: ax, y: X.y }, n: { x: 0, y: -1 } },
      ].filter(q => (to.x - q.p.x) * q.n.x + (to.y - q.p.y) * q.n.y > -Math.max(X.w, X.h) * 0.3);
    };
    const pa = ports(A, cb), pb = ports(B, ca);
    // The cards at either end: only the first and last bit of the string may touch them.
    const ends = [A, B].filter(X => X.w || X.h).map(X => ({ x: X.x + 2, y: X.y + 2, w: X.w - 4, h: X.h - 4 }));
    const x0 = Math.min(A.x, B.x) - 260, x1 = Math.max(A.x + A.w, B.x + B.w) + 260, y0 = Math.min(A.y, B.y) - 260, y1 = Math.max(A.y + A.h, B.y + B.h) + 260;
    const near = obs.filter(o => o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0);
    const nearSoft = soft.filter(o => o.x < x1 && o.x + o.w > x0 && o.y < y1 && o.y + o.h > y0);
    const nearStrings = others.filter(o => Math.max(o.p.x, o.q.x) > x0 && Math.min(o.p.x, o.q.x) < x1 && Math.max(o.p.y, o.q.y) > y0 && Math.min(o.p.y, o.q.y) < y1);
    const xs = new Set(), ys = new Set();
    for (const o of [...near, ...ends, ...nearSoft]) { xs.add(Math.round(o.x - M)); xs.add(Math.round(o.x + o.w + M)); ys.add(Math.round(o.y - M)); ys.add(Math.round(o.y + o.h + M)); }
    // (and just beside other strings' straight runs, so a string can run alongside rather than on top)
    for (const o of nearStrings) {
      if (Math.abs(o.p.x - o.q.x) < 0.5) { xs.add(Math.round(o.p.x - 10)); xs.add(Math.round(o.p.x + 10)); }
      if (Math.abs(o.p.y - o.q.y) < 0.5) { ys.add(Math.round(o.p.y - 10)); ys.add(Math.round(o.p.y + 10)); }
    }
    let best = null, bestScore = Infinity, bestPen = 0;
    const tryRoute = (a, b, S, T, mid) => {
      const raw = [a.p, S, ...mid, T, b.e];
      const pts = [raw[0]];
      for (const p of raw.slice(1)) { const q = pts[pts.length - 1]; if (Math.abs(p.x - q.x) > 0.5 || Math.abs(p.y - q.y) > 0.5) pts.push(p); }
      for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].x - pts[i - 1].x) > 0.5 && Math.abs(pts[i].y - pts[i - 1].y) > 0.5) return;   // straight runs only
      for (let i = pts.length - 2; i > 0; i--) { const p = pts[i - 1], q = pts[i], r = pts[i + 1]; if ((Math.abs(p.x - q.x) < 0.5 && Math.abs(q.x - r.x) < 0.5) || (Math.abs(p.y - q.y) < 0.5 && Math.abs(q.y - r.y) < 0.5)) pts.splice(i, 1); }
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
      const base = len + (pts.length - 2) * BEND;
      if (base >= bestScore) return;
      let pen = 0;
      for (let i = 1; i < pts.length && base + pen < bestScore; i++) {
        const p = pts[i - 1], q = pts[i];
        for (const o of near) if (segHits(p, q, o)) pen += CROSS;
        for (const o of nearSoft) if (segHits(p, q, o)) pen += THROUGH;
        // (the cards at the ends: not crossed except by the bit leaving or reaching them)
        if (i > 1 && i < pts.length - 1) for (const o of ends) if (segHits(p, q, o)) pen += CROSS;
        if (nearStrings.length) pen += stringCost(p, q, nearStrings);
      }
      if (base + pen < bestScore) { bestScore = base + pen; best = pts; bestPen = pen; }
    };
    const startOf = a => (a.n ? { x: a.p.x + a.n.x * M, y: a.p.y + a.n.y * M } : a.p);
    for (const a of pa) a.S = startOf(a);
    for (const b of pb) { b.S = startOf(b); b.e = b.n ? { x: b.p.x + b.n.x * gap, y: b.p.y + b.n.y * gap } : b.p; }
    // Up to two turns between the ends.
    for (const a of pa) for (const b of pb) {
      const S = a.S, T = b.S;
      tryRoute(a, b, S, T, []);
      tryRoute(a, b, S, T, [{ x: T.x, y: S.y }]);
      tryRoute(a, b, S, T, [{ x: S.x, y: T.y }]);
      for (const x of [...xs, Math.round((S.x + T.x) / 2)]) tryRoute(a, b, S, T, [{ x, y: S.y }, { x, y: T.y }]);
      for (const y of [...ys, Math.round((S.y + T.y) / 2)]) tryRoute(a, b, S, T, [{ x: S.x, y }, { x: T.x, y }]);
    }
    // Still crossing something (a card, a section it isn't in, another string): one more turn, using the closest ways past.
    if (bestPen >= STRING_CROSS) {
      const mx = (ca.x + cb.x) / 2, my = (ca.y + cb.y) / 2;
      const cx = [...xs].sort((p, q) => Math.abs(p - mx) - Math.abs(q - mx)).slice(0, 8);
      const cy = [...ys].sort((p, q) => Math.abs(p - my) - Math.abs(q - my)).slice(0, 8);
      for (const a of pa) for (const b of pb) for (const x of cx) for (const y of cy) {
        tryRoute(a, b, a.S, b.S, [{ x, y: a.S.y }, { x, y }, { x: b.S.x, y }]);
        tryRoute(a, b, a.S, b.S, [{ x: a.S.x, y }, { x, y }, { x, y: b.S.y }]);
      }
    }
    return best && { pts: best, score: bestScore, pen: bestPen };
  }

  // ---------- The autorouter (0.7.6) ----------
  // Like a circuit-board autorouter. The board is a grid of 16 px squares; a string can't go
  // through a card, and finds the cheapest way from its card to the other: each square costs 1,
  // each turn 3, a square inside a section it isn't in 1.5 more, crossing another string 20 and
  // running along on top of one 4 a square. So it takes extra turns to get round things rather
  // than cross them (unless that's a long way round), and strings routed side by side keep a
  // square apart, like tracks. Strings go one after another (shortest first), then each again
  // with all the others in place. A string a look draws its own way (a curve, a straight line)
  // keeps that if it gets through cleanly. Shaped strings (data.links[].via, see below) keep their
  // shape, and the others go round them. It's worked out just after a redraw, once nothing's moving.
  const CELL = 16, ROUTE_TURN = 3, ROUTE_SOFT = 1.5, ROUTE_CROSS = 20, ROUTE_ALONG = 4, ROUTE_LABEL = 14;   // (0.7.7: a square under another string's label)
  const ORTHO_LOOKS = new Set(['blueprint', 'hacker']), OCTO_LOOKS = new Set(['circuit', 'city']);   // (right angles; right angles and 45°)
  const polyLen = pts => { let n = 0; for (let i = 1; i < (pts || []).length; i++) n += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return n; };

  function routingGrid() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of [...obstacles, ...(frameBoxes || [])]) { x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x + o.w); y1 = Math.max(y1, o.y + o.h); }
    if (x0 === Infinity) return null;
    const gx0 = Math.floor((x0 - 320) / CELL) * CELL, gy0 = Math.floor((y0 - 320) / CELL) * CELL;
    const cols = Math.ceil((x1 + 320 - gx0) / CELL), rows = Math.ceil((y1 + 320 - gy0) / CELL), N = cols * rows;
    const G = { gx0, gy0, cols, rows, owner: new Int32Array(N), sect: new Int32Array(N), usedH: new Uint8Array(N), usedV: new Uint8Array(N), lab: new Uint8Array(N), obsIndex: new Map(), secIndex: new Map() };
    // (the squares whose middle is inside a box)
    const cover = (o, fn) => {
      const c0 = Math.max(0, Math.ceil((o.x - gx0) / CELL - 0.5)), c1 = Math.min(cols - 1, Math.floor((o.x + o.w - gx0) / CELL - 0.5));
      const r0 = Math.max(0, Math.ceil((o.y - gy0) / CELL - 0.5)), r1 = Math.min(rows - 1, Math.floor((o.y + o.h - gy0) / CELL - 0.5));
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * cols + c);
    };
    obstacles.forEach((o, i) => { G.obsIndex.set(o.id, i + 1); cover(o, k => { G.owner[k] = G.owner[k] ? -1 : i + 1; }); });
    // (smaller sections over bigger ones)
    (frameBoxes || []).map((fr, j) => [fr, j]).sort((a, b) => b[0].w * b[0].h - a[0].w * a[0].h)
      .forEach(([fr, j]) => { G.secIndex.set(fr.id, j + 1); cover(fr, k => { G.sect[k] = j + 1; }); });
    // (0.7.7) where labels sit: n = 1 marks one, -1 takes it off
    G.markLabel = (at, n) => { if (at) cover({ x: at.x - at.w / 2 - 4, y: at.y - at.h / 2 - 4, w: at.w + 8, h: at.h + 8 }, k => { G.lab[k] = Math.max(0, Math.min(255, G.lab[k] + n)); }); };
    return G;
  }
  const cellAt = (G, x, y) => { const c = Math.floor((x - G.gx0) / CELL), r = Math.floor((y - G.gy0) / CELL); return c >= 0 && r >= 0 && c < G.cols && r < G.rows ? r * G.cols + c : -1; };
  // The squares along a path, each with whether the path runs across (flat) or up and down there.
  function walkCells(G, pts, fn) {
    let last = -1;
    for (let i = 1; i < (pts || []).length; i++) {
      const p = pts[i - 1], q = pts[i], steps = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / (CELL / 2)));
      const flat = Math.abs(q.x - p.x) >= Math.abs(q.y - p.y);
      for (let s = 0; s <= steps; s++) {
        const k = cellAt(G, p.x + (q.x - p.x) * s / steps, p.y + (q.y - p.y) * s / steps);
        if (k >= 0 && k !== last) { last = k; fn(k, flat); }
      }
    }
  }
  // Mark (n = 1) or unmark (n = -1) the squares a string runs through, for the strings after it.
  const markRoute = (G, pts, n) => walkCells(G, pts, (k, flat) => { const a = flat ? G.usedH : G.usedV; a[k] = Math.max(0, Math.min(255, a[k] + n)); });
  // What a path costs as it is (a look's own curve or line): cards it goes through, sections, strings.
  function pathPenalty(G, pts, ia, ib, sa, sb) {
    let pen = 0;
    walkCells(G, pts, (k, flat) => {
      const o = G.owner[k];
      if (o && o !== ia && o !== ib) pen += 1000;
      if (G.sect[k] && G.sect[k] !== sa && G.sect[k] !== sb) pen += ROUTE_SOFT;
      pen += (flat ? G.usedV[k] : G.usedH[k]) * ROUTE_CROSS + (flat ? G.usedH[k] : G.usedV[k]) * ROUTE_ALONG + G.lab[k] * ROUTE_LABEL;
    });
    return pen;
  }

  // The cheapest way between two boxes (A* over the squares; state = square and the way it's going).
  function autoroute(G, A, B, ia, ib, sa, sb, gap, wide = false) {
    const { gx0, gy0, cols, rows, owner, sect, usedH, usedV, lab } = G;
    const col = x => Math.floor((x - gx0) / CELL), row = y => Math.floor((y - gy0) / CELL);
    const cxOf = c => gx0 + (c + 0.5) * CELL, cyOf = r => gy0 + (r + 0.5) * CELL;
    const m = wide ? 1e7 : 480;
    const wx0 = Math.max(0, col(Math.min(A.x, B.x) - m)), wx1 = Math.min(cols - 1, col(Math.max(A.x + A.w, B.x + B.w) + m));
    const wy0 = Math.max(0, row(Math.min(A.y, B.y) - m)), wy1 = Math.min(rows - 1, row(Math.max(A.y + A.h, B.y + B.h) + m));
    const W = wx1 - wx0 + 1, H = wy1 - wy0 + 1;
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];   // right, down, left, up
    const free = k => owner[k] === 0;
    // Where a string can leave a card, or arrive at one: the squares just outside each side, not
    // too near the corners, a little dearer the further from the point facing the other card.
    const sides = (X, other, leaving) => {
      if (!X.w && !X.h) { const c = col(X.x), r = row(X.y); return [0, 1, 2, 3].map(d => ({ c, r, d, at: { x: X.x, y: X.y }, cost: 0 })).filter(s => s.c >= wx0 && s.c <= wx1 && s.r >= wy0 && s.r <= wy1); }
      const out = [], g = leaving ? 0 : gap;
      const R = Math.floor((X.x + X.w + 6 - gx0) / CELL - 0.5) + 1, Lc = Math.ceil((X.x - 6 - gx0) / CELL - 0.5) - 1;
      const Bt = Math.floor((X.y + X.h + 6 - gy0) / CELL - 0.5) + 1, T = Math.ceil((X.y - 6 - gy0) / CELL - 0.5) - 1;
      const aimY = clamp(other.y + other.h / 2, X.y + X.h * 0.2, X.y + X.h * 0.8), aimX = clamp(other.x + other.w / 2, X.x + X.w * 0.2, X.x + X.w * 0.8);
      for (let r = row(X.y + X.h * 0.15); r <= row(X.y + X.h * 0.85); r++) {
        const cost = Math.abs(cyOf(r) - aimY) / CELL * 0.3;
        out.push({ c: R, r, d: leaving ? 0 : 2, at: { x: X.x + X.w + g, y: cyOf(r) }, cost }, { c: Lc, r, d: leaving ? 2 : 0, at: { x: X.x - g, y: cyOf(r) }, cost });
      }
      for (let c = col(X.x + X.w * 0.15); c <= col(X.x + X.w * 0.85); c++) {
        const cost = Math.abs(cxOf(c) - aimX) / CELL * 0.3;
        out.push({ c, r: Bt, d: leaving ? 1 : 3, at: { x: cxOf(c), y: X.y + X.h + g }, cost }, { c, r: T, d: leaving ? 3 : 1, at: { x: cxOf(c), y: X.y - g }, cost });
      }
      return out.filter(s => s.c >= wx0 && s.c <= wx1 && s.r >= wy0 && s.r <= wy1 && free(s.r * cols + s.c));
    };
    const goals = new Map();
    for (const s of sides(B, A, false)) { const k = s.r * cols + s.c; if (!goals.has(k)) goals.set(k, []); goals.get(k).push(s); }
    if (!goals.size) return wide ? null : autoroute(G, A, B, ia, ib, sa, sb, gap, true);
    const bx0 = col(B.x), bx1 = col(B.x + B.w), by0 = row(B.y), by1 = row(B.y + B.h);
    const hOf = (c, r) => Math.max(0, bx0 - c, c - bx1) + Math.max(0, by0 - r, r - by1);
    const gs = new Float32Array(W * H * 4).fill(Infinity), prev = new Int32Array(W * H * 4).fill(-1);
    const heapF = [], heapS = [];
    const push = (f, s) => {
      let i = heapF.length; heapF.push(f); heapS.push(s);
      while (i > 0) { const p = (i - 1) >> 1; if (heapF[p] <= f) break; heapF[i] = heapF[p]; heapS[i] = heapS[p]; i = p; }
      heapF[i] = f; heapS[i] = s;
    };
    const pop = () => {
      const f = heapF[0], s = heapS[0], lf = heapF.pop(), ls = heapS.pop(), n = heapF.length;
      if (n) {
        let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m2 = i, mf = lf; if (l < n && heapF[l] < mf) { m2 = l; mf = heapF[l]; } if (r < n && heapF[r] < mf) { m2 = r; } if (m2 === i) break; heapF[i] = heapF[m2]; heapS[i] = heapS[m2]; i = m2; }
        heapF[i] = lf; heapS[i] = ls;
      }
      return [f, s];
    };
    const sid = (c, r, d) => (((r - wy0) * W + (c - wx0)) << 2) | d;
    const seeds = new Map();
    for (const s of sides(A, B, true)) { const st = sid(s.c, s.r, s.d); if (s.cost < gs[st]) { gs[st] = s.cost; seeds.set(st, s); push(s.cost + hOf(s.c, s.r), st); } }
    let end = null, bestCost = Infinity, n = 0;
    while (heapF.length) {
      const [fv, st] = pop();
      if (fv >= bestCost || ++n > 80000) break;
      const g = gs[st], d = st & 3, cell = st >> 2, c = wx0 + cell % W, r = wy0 + ((cell / W) | 0);
      if (g + hOf(c, r) < fv - 1e-3) continue;   // (an old entry: a cheaper way here was found since)
      const k = r * cols + c, gl = goals.get(k);
      if (gl) for (const s of gl) { const tot = g + s.cost + (d !== s.d ? ROUTE_TURN : 0); if (tot < bestCost) { bestCost = tot; end = { st, s }; } }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === ((d + 2) & 3)) continue;
        const nc = c + DX[nd], nr = r + DY[nd];
        if (nc < wx0 || nc > wx1 || nr < wy0 || nr > wy1) continue;
        const nk = nr * cols + nc;
        if (!free(nk)) continue;
        let cost = 1 + (nd !== d ? ROUTE_TURN : 0);
        if (sect[nk] && sect[nk] !== sa && sect[nk] !== sb) cost += ROUTE_SOFT;
        cost += (nd & 1 ? usedH[nk] * ROUTE_CROSS + usedV[nk] * ROUTE_ALONG : usedV[nk] * ROUTE_CROSS + usedH[nk] * ROUTE_ALONG) + lab[nk] * ROUTE_LABEL;
        const ns = sid(nc, nr, nd), ng = g + cost;
        if (ng < gs[ns]) { gs[ns] = ng; prev[ns] = st; push(ng + hOf(nc, nr), ns); }
      }
    }
    if (!end) return wide ? null : autoroute(G, A, B, ia, ib, sa, sb, gap, true);
    // Back along the way it came, keeping only the corners.
    const path = [];
    for (let st = end.st; st >= 0; st = prev[st]) path.push(st);
    path.reverse();
    const pts = [seeds.get(path[0]).at];
    path.forEach((st, i) => {
      const cell = st >> 2, p = { x: cxOf(wx0 + cell % W), y: cyOf(wy0 + ((cell / W) | 0)) };
      if (i === 0 || i === path.length - 1 || (path[i + 1] & 3) !== (st & 3)) pts.push(p);
    });
    pts.push(end.s.at);
    const out = [pts[0]];
    for (const p of pts.slice(1)) { const q = out[out.length - 1]; if (Math.abs(p.x - q.x) > 0.5 || Math.abs(p.y - q.y) > 0.5) out.push(p); }
    for (let i = out.length - 2; i > 0; i--) { const p = out[i - 1], q = out[i], r = out[i + 1]; if ((Math.abs(p.x - q.x) < 0.5 && Math.abs(q.x - r.x) < 0.5) || (Math.abs(p.y - q.y) < 0.5 && Math.abs(q.y - r.y) < 0.5)) out.splice(i, 1); }
    return { pts: out, cost: bestCost };
  }

  // ---------- Shaped strings (0.7.6) ----------
  // A string you've shaped by hand keeps its turns: data.links[].via = [[x, y], …] on the board.
  // Its ends still follow the cards (leaving from the side facing its first turn); on a look with
  // right-angle strings (blueprint, hacker) each stretch turns a corner if needed (circuit traces and
  // city lines a 45° one), and on Corkboard the wool hangs between pins at the turns.
  const viaPts = via => (via || []).map(v => (Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y }));
  function viaWire(fromId, toId, via) {
    const P = viaPts(via), seed = fromId + '>' + toId;
    if (look() === 'corkboard') { const a = pinPoint(fromId), b = pinPoint(toId); return a && b ? woolThrough([a, ...P, b]) : null; }
    const A = rectOf(fromId), B = rectOf(toId);
    if (!A || !B) return null;
    const L = look(), dot = p => ({ x: p.x, y: p.y, w: 0, h: 0 });
    const fa = facing(A, dot(P[0]), 0), fb = facing(dot(P[P.length - 1]), B, GAP_AT_END[L] ?? 5);
    let pts = [fa.p0, ...P, fb.p3];
    if (ORTHO_LOOKS.has(L)) pts = orthoThrough(pts, fa.horiz);
    else if (OCTO_LOOKS.has(L)) pts = octoThrough(pts, fa.horiz);
    return alongPts(pts, seed, seed);
  }
  // The same with 45° turns: straight on the way it was going, then a diagonal to the next point.
  function octoThrough(pts, horiz) {
    const out = [pts[0]];
    let h = horiz;
    for (const q of pts.slice(1)) {
      const p = out[out.length - 1], dx = q.x - p.x, dy = q.y - p.y, ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax > 0.5 && ay > 0.5 && Math.abs(ax - ay) > 0.5) {
        if (ax > ay) out.push(h ? { x: q.x - Math.sign(dx) * ay, y: p.y } : { x: p.x + Math.sign(dx) * ay, y: q.y }); 
        else out.push(h ? { x: q.x, y: p.y + Math.sign(dy) * ax } : { x: p.x, y: q.y - Math.sign(dy) * ax });
      }
      h = Math.abs(q.y - out[out.length - 1].y) < 0.5;
      out.push(q);
    }
    return out;
  }
  // Points joined by straight runs that turn at right angles: each stretch goes the other way to the last.
  function orthoThrough(pts, horiz) {
    const out = [pts[0]];
    let h = horiz;
    for (const q of pts.slice(1)) {
      const p = out[out.length - 1];
      if (Math.abs(p.x - q.x) > 0.5 && Math.abs(p.y - q.y) > 0.5) out.push(h ? { x: q.x, y: p.y } : { x: p.x, y: q.y });
      else h = Math.abs(p.y - q.y) > 0.5;
      out.push(q);
    }
    return out;
  }
  // Corkboard wool through pins at its turns, hanging between each.
  function woolThrough(pts) {
    let d = '';
    const parts = [];
    for (let i = 1; i < pts.length; i++) { const s = sag(pts[i - 1], pts[i]); parts.push(s); d += i === 1 ? s.d : ' ' + s.d.slice(s.d.indexOf('Q')); }
    const pins = pts.slice(1, -1).map(p => `<circle class="pinhead" cx="${f(p.x)}" cy="${f(p.y)}" r="5.5" style="fill:#9C968B"/>`).join('');
    return { d, line: parts.flatMap((s, i) => (i ? s.line.slice(1) : s.line)), mid: parts[Math.floor((parts.length - 1) / 2)].mid, pts, mids: parts.map((s, i) => ({ ...s.mid, ins: i })), html: `<path class="wire wool" d="${d}"/><path class="wire twist" d="${d}"/>${pins}` };
  }

  // ---------- All the strings, routed together ----------
  let routeCache = null, routeTimer = 0, routeNow = false;
  function routeJobs() {
    const jobs = [];
    for (const r of [...frames, ...cards]) for (const l of r.data.links || []) {
      const A = rectOf(r.id), B = rectOf(l.to);
      if (A && B && r.id !== l.to) jobs.push({ k: `${r.id}|${l.to}`, from: r.id, to: l.to, A, B, l, via: viaOf(l), label: l.label || '', also: (l.also || []).filter(c => c !== r.id && c !== l.to && rectOf(c)) });
    }
    return jobs;
  }
  function routeSig(jobs) {
    const R = b => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)];
    return look() + JSON.stringify([jobs.map(j => [j.k, R(j.A), R(j.B), j.via || 0, j.label.length, j.also.join(','), j.l.dir || '']), obstacles.map(o => [o.id, ...R(o)]), (frameBoxes || []).map(o => [o.id, ...R(o)]), api.ownWire?.() || 0]);
  }
  function computeRoutes(jobs) {
    const map = new Map(), G = routingGrid();
    if (!G) return map;
    const gap = GAP_AT_END[look()] ?? 5;
    const secOf = X => { const k = cellAt(G, X.x + X.w / 2, X.y + X.h / 2); return k >= 0 ? G.sect[k] : 0; };
    // (shaped strings first: they stay as they are, and the others keep clear of them)
    for (const j of jobs) if (j.via?.length) { const s = viaWire(j.from, j.to, j.via); map.set(j.k, s); markRoute(G, s?.pts, 1); }
    const auto = jobs.filter(j => !j.via?.length);
    for (const j of auto) {
      j.seed = j.from + '>' + j.to; j.own = shape(j.A, j.B, j.seed); j.ownLen = polyLen(j.own?.pts);
      j.ia = G.obsIndex.get(j.from) || 0; j.ib = G.obsIndex.get(j.to) || 0;
      j.sa = G.secIndex.get(j.from) || secOf(j.A); j.sb = G.secIndex.get(j.to) || secOf(j.B);
    }
    auto.sort((a, b) => a.ownLen - b.ownLen);
    const one = j => {
      const s = j.own;
      if (!s?.pts || holds(j.A, j.B) || holds(j.B, j.A)) return s;
      if (pathPenalty(G, s.pts, j.ia, j.ib, j.sa, j.sb) < 8) return s;   // (the look's own way gets through cleanly)
      const r = autoroute(G, j.A, j.B, j.ia, j.ib, j.sa, j.sb, gap);
      return r ? alongPts(r.pts, j.seed, j.seed) : s;
    };
    for (const j of auto) { const s = one(j); map.set(j.k, s); markRoute(G, s?.pts, 1); }
    // (0.7.7) Where the labels go with these routes: the second pass keeps other strings from under them.
    if (jobs.some(j => j.label)) {
      const list = placeLabels(jobs.filter(j => map.get(j.k)?.pts).map(j => ({ j, s: map.get(j.k), label: j.label })));
      for (const it of list) if (it.at) { it.j.at = it.at; G.markLabel(it.at, 1); }
    }
    for (const j of auto) {
      G.markLabel(j.at, -1); markRoute(G, map.get(j.k)?.pts, -1);   // (not its own label, or itself)
      const s = one(j); map.set(j.k, s);
      markRoute(G, s?.pts, 1); G.markLabel(j.at, 1);
    }
    // (0.7.8) Branches, routed too: from where the label (or knot) is drawn, to each of the other
    // cards, round the cards and across as few strings as they can, like the strings themselves.
    // (kept with that spot: if the label's drawn somewhere else, the branch is drawn the quick way)
    if (jobs.some(j => j.also.length)) {
      for (const j of jobs) G.markLabel(j.at, -1);
      const items = labelsAsDrawn(jobs.filter(j => map.get(j.k)).map(j => ({ j, l: j.l, s: map.get(j.k), label: j.label, knot: !j.label && j.also.length > 0 })));
      for (const it of items) G.markLabel(it.at, 1);
      for (const { j, s, at } of items) {
        if (!j.also.length) continue;
        const J = at || s.mid, P = { x: J.x, y: J.y, w: 0, h: 0 }, ck = j.from + '>' + j.to;
        const sJ = secOf(P);
        G.markLabel(at, -1);
        for (const c of j.also) {
          const C = rectOf(c), seed = ck + '+' + c;
          if (!C) continue;
          const ic = G.obsIndex.get(c) || 0, sc = G.secIndex.get(c) || secOf(C);
          let b = shape(P, C, seed, ck);
          if (b?.pts && !holds(C, P) && pathPenalty(G, b.pts, 0, ic, sJ, sc) >= 8) {
            const r = autoroute(G, P, C, 0, ic, sJ, sc, gap);
            if (r) b = alongPts(r.pts, seed, ck);
          }
          if (!b) continue;
          map.set(j.k + '+' + c, { s: b, J: { x: J.x, y: J.y } });
          markRoute(G, b.pts, 1);
        }
        G.markLabel(at, 1);
      }
    }
    return map;
  }

  function drawLines() {
    const L = look();
    const on = new Set([...cards, ...frames].map(r => r.id));
    let html = '';
    const labels = [];
    junctions.clear();
    // (not drawings on the board: strings may cross those, like anything drawn on it)
    frameBoxes = ROUND_LOOKS.has(L) ? frames.map(r => { const b = rectOf(r.id); return b && { id: r.id, x: b.x - 4, y: b.y - 4, w: b.w + 8, h: b.h + 8 }; }).filter(Boolean) : null;
    obstacles = ROUND_LOOKS.has(L) ? [key, ...cards.filter(r => !isSketch(r)).map(r => r.id)].map(id => { const b = rectOf(id); return b && { id, x: b.x - 6, y: b.y - 6, w: b.w + 12, h: b.h + 12 }; }).filter(Boolean) : null;
    // (while a card or section is being dragged, each string just finds its own way: quicker)
    const dragging = gesture && ['move', 'scale', 'resize'].includes(gesture.kind);
    // (0.7.6) The autorouter's routes, once worked out (just after this, if anything's changed)
    routeMap = null;
    if (ROUND_LOOKS.has(L) && !dragging) {
      const jobs = routeJobs(), sig = routeSig(jobs);
      if (routeCache?.sig === sig) routeMap = routeCache.map;
      else if (routeNow) { routeCache = { sig, map: computeRoutes(jobs) }; routeMap = routeCache.map; }
      else {
        clearTimeout(routeTimer);
        routeTimer = setTimeout(() => {
          if (!lines.isConnected || (gesture && ['move', 'scale', 'resize'].includes(gesture.kind))) return;
          routeNow = true;
          try { drawLines(); } finally { routeNow = false; }
        }, 40);
      }
    }
    shown.clear();
    let handles = '';
    // Every string first, then their labels (0.7.7: placed knowing where all the strings go)
    const items = [];
    for (const r of [...frames, ...cards]) for (const l of r.data.links || []) {
      if (!on.has(l.to)) continue;
      const id = `${r.id}|${esc(l.to)}`;
      const via = viaNow(r, l, id), s = wire(r.id, l.to, via);
      if (!s) continue;
      const branches = (l.also || []).filter(c => on.has(c) && c !== r.id && c !== l.to);
      items.push({ r, l, id, via, s, label: l.label, knot: !l.label && (branches.length > 0 || tieFrom === 'L:' + id), branches });
    }
    labelsAsDrawn(items);
    for (const { r, l, id, via, s, at, branches } of items) {
      const J = at || s.mid;
      junctions.set(id, J);
      shown.set(id, s);
      const sel = selString === id, dir = DIRS.includes(l.dir) ? l.dir : null;
      // (0.8.0: each string, with its branches, in a group of its own, data-sw, so a recording can trace it)
      html += `<path class="wire hit" data-link="${id}" d="${s.d}"/>${sel ? `<path class="selglow" d="${s.d}"/>` : ''}<g data-sw="${id}">${dir ? withArrows(s, dir, L) : s.html}`;
      if (sel) handles = shapeHandles(id, s, via);
      // Branches: more cards joined to this string where its label is, like a T junction.
      const box = at ? { x: J.x - at.w / 2 - 2, y: J.y - at.h / 2 - 2, w: at.w + 4, h: at.h + 4 } : null;
      for (const c of branches) {
        const rb = routeMap?.get(r.id + '|' + l.to + '+' + c);   // (0.7.8: routed from this same spot)
        const b = rb && Math.abs(rb.J.x - J.x) < 0.5 && Math.abs(rb.J.y - J.y) < 0.5 ? { ...rb.s } : branchWire(J, c, r.id + '>' + l.to);
        if (!b) continue;
        html += `<path class="wire hit" data-branch="${id}|${esc(c)}" d="${b.d}"/><g class="branch">${dir ? withArrows(b, dir, L, box ? outOf(b.line || b.pts || [], box) + 2 : 0) : b.html}</g>`;
      }
      html += '</g>';
      const picked = tieFrom === 'L:' + id ? ' picked' : '';
      const lab = [];
      // (a label beside its string: a dotted line back to it)
      if (at?.anchor) {
        const A = at.anchor, bx = clamp(A.x, J.x - at.w / 2, J.x + at.w / 2), by = clamp(A.y, J.y - at.h / 2, J.y + at.h / 2);
        if (Math.hypot(A.x - bx, A.y - by) > 4) lab.push(`<path class="leader" ${s.lc || ''} d="M${f(A.x)} ${f(A.y)}L${f(bx)} ${f(by)}"/><circle class="ldot" ${s.lc || ''} cx="${f(A.x)}" cy="${f(A.y)}" r="2.6"/>`);
      }
      if (l.label) lab.push(`<g class="slabel${picked}" data-link="${id}" ${s.lc || ''} transform="translate(${f(J.x)} ${f(J.y)})"><rect x="${-l.label.length * 3.6 - 8}" y="-11" width="${l.label.length * 7.2 + 16}" height="22" rx="${LABEL_RX[L]}"/><text text-anchor="middle" y="4">${esc(l.label)}</text></g>`);
      // (no label: a knot where the branches meet, which works like a label)
      else if (branches.length || picked) lab.push(`<circle class="junction${picked}" data-link="${id}" ${s.lc || ''} cx="${f(J.x)}" cy="${f(J.y)}" r="6"/>`);
      if (lab.length) labels.push(`<g data-sl="${id}">${lab.join('')}</g>`);   // (0.8.0: its label, for a recording)
    }
    let pins = '';
    // (a drawing on the board only gets a pin when a string is tied to it)
    const strung = new Set();
    for (const r of [...frames, ...cards]) for (const l of r.data.links || []) if (on.has(l.to)) { strung.add(r.id); strung.add(l.to); for (const c of l.also || []) strung.add(c); }
    if (L === 'corkboard') for (const r of [...frames, ...cards]) {
      if (r.id === sketching || (isSketch(r) && !strung.has(r.id))) continue;
      const a = pinPoint(r.id);
      if (a) pins += `<circle class="pinhead" cx="${a.x}" cy="${a.y}" r="8" style="fill:${PINS[hash(r.id) % PINS.length]}"/><circle class="pinshine" cx="${a.x - 2.5}" cy="${a.y - 2.5}" r="2.4"/>`;
    }
    lines.innerHTML = html + pins + labels.join('') + handles;
  }

  // ---------- Shaping a string by hand (0.7.6) ----------
  // Tap a string and it shows dots: a big one at each turn (drag to move it, double-tap to take it
  // out), a small one along each stretch (drag to put in a new turn). Or just pull the string: on a
  // right-angle look that moves the stretch you grabbed, otherwise it puts a turn where you grabbed.
  // The shape is kept for this board (data.links[].via[board]); the string's menu has Auto to hand
  // it back to the autorouter.
  const viaOf = l => (Array.isArray(l?.via?.[key]) && l.via[key].length ? l.via[key] : null);
  // (what a string's shape is right now: while it's being shaped, or carried along with both its ends)
  function viaNow(r, l, id) {
    if (viaDraft?.k === id) return viaDraft.via;
    const v = viaOf(l), g = gesture;
    if (!v || g?.kind !== 'move' || !g.moved) return v;
    const a = g.starts.get(r.id), b = g.starts.get(l.to), p = pos.get(r.id);
    if (!a || !b || !p) return v;
    const dx = p.x - a.x, dy = p.y - a.y;
    return dx || dy ? v.map(([x, y]) => [x + dx, y + dy]) : v;
  }
  // The turns to shape from: the string's own (shaped before), or the corners of its route (unless
  // it's a curve, which starts from none).
  function shapeBase(s, via) {
    if (via?.length) return viaPts(via);
    const D = s.pts || [];
    return D.length <= 8 ? D.slice(1, -1).map(p => ({ x: p.x, y: p.y })) : [];
  }
  // Where a new turn on stretch j of a drawn string (D) goes in its list of turns (C).
  const sameAt = (a, b) => Math.abs(a.x - b.x) < 0.6 && Math.abs(a.y - b.y) < 0.6;
  function insertAt(D, C, j) {
    let n = 0;
    for (let i = 1; i <= j && i < D.length; i++) if (C.some(c => sameAt(c, D[i]))) n++;
    return Math.min(n, C.length);
  }
  function shapeHandles(id, s, via) {
    const C = shapeBase(s, via), D = s.pts || [];
    const dot = (cls, attr, p, r) => `<g class="${cls}" ${attr} transform="translate(${f(p.x)} ${f(p.y)})"><g class="hz"><circle class="hhit" r="18"/><circle class="hdot" r="${r}"/></g></g>`;
    const mids = s.mids || (!via?.length && D.length > 8 ? [{ ...alongMid(D), ins: 0 }]
      : D.slice(1).map((q, j) => { const p = D[j]; return Math.hypot(q.x - p.x, q.y - p.y) > 44 ? { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, ins: insertAt(D, C, j) } : null; }).filter(Boolean));
    let h = '';
    for (const m of mids) h += dot('addh', `data-addvia="${id}|${m.ins}"`, m, 4.5);
    C.forEach((c, i) => { h += dot('viah', `data-via="${id}|${i}"`, c, 6.5); });
    return h;
  }
  const splitHandle = v => { const parts = v.split('|'), n = +parts.pop(); return [parts.join('|'), n]; };
  const segDist = (p, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy, t = L2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / L2, 0, 1) : 0;
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  // Starting to shape: from a dot (el), or from pulling the string itself (id, grabbed at a point on the board).
  function startShape(el, id, at) {
    let n = 0, add = false;
    if (el) { add = el.dataset.addvia != null; [id, n] = splitHandle(el.dataset.via ?? el.dataset.addvia); }
    const s = shown.get(id), l = linkOf(id);
    if (!s || !l) return null;
    const C = shapeBase(s, viaOf(l)), D = s.pts || [];
    const g = { kind: 'via', id, idx: n, seg: null, axis: null, grab: at, sx: 0, sy: 0, moved: !el, add, had: !!viaOf(l) };
    if (!el) {
      // (the stretch grabbed: on a right-angle look, a straight stretch between two turns moves as one)
      let j = 0, best = Infinity;
      for (let i = 1; i < D.length; i++) { const d = segDist(at, D[i - 1], D[i]); if (d < best) { best = d; j = i - 1; } }
      const ia = C.findIndex(c => sameAt(c, D[j])), ib = D[j + 1] ? C.findIndex(c => sameAt(c, D[j + 1])) : -1;
      const L = look(), flat = D[j + 1] && Math.abs(D[j].y - D[j + 1].y) < 0.5, upright = D[j + 1] && Math.abs(D[j].x - D[j + 1].x) < 0.5;
      if ((ORTHO_LOOKS.has(L) || OCTO_LOOKS.has(L)) && ia >= 0 && ib >= 0 && (flat || upright)) { g.seg = [ia, ib]; g.axis = flat ? 'y' : 'x'; }
      else { g.idx = s.mids || (!viaOf(l) && D.length > 8) ? (s.mids ? Math.min(j, C.length) : 0) : insertAt(D, C, j); C.splice(g.idx, 0, { x: at.x, y: at.y }); }
    } else if (add) C.splice(n, 0, { x: at.x, y: at.y });
    g.start = C.map(p => ({ ...p }));
    g.via = g.start;
    return g;
  }
  // Following the finger: snapped to an 8 px grid, and level with the turn either side if it's close.
  function moveShape(g, at) {
    const dx = at.x - g.grab.x, dy = at.y - g.grab.y, snap = v => Math.round(v / 8) * 8;
    const via = g.start.map(p => ({ ...p }));
    if (g.seg) for (const i of g.seg) { if (g.axis === 'y') via[i].y = snap(g.start[i].y + dy); else via[i].x = snap(g.start[i].x + dx); }
    else {
      const p = { x: snap(g.start[g.idx].x + dx), y: snap(g.start[g.idx].y + dy) };
      const ends = shown.get(g.id)?.pts || [];
      for (const q of [via[g.idx - 1] || ends[0], via[g.idx + 1] || ends[ends.length - 1]]) {
        if (!q) continue;
        if (Math.abs(p.x - q.x) < 10) p.x = q.x;
        if (Math.abs(p.y - q.y) < 10) p.y = q.y;
      }
      via[g.idx] = p;
    }
    g.via = via;
    viaDraft = { k: g.id, via: via.map(p => [p.x, p.y]) };
    drawLines();
  }
  async function saveVia(id, via, quiet) {
    const [from, to] = id.split('|'), r = api.store.get(from);
    if (!r) return;
    const links = r.data.links || [], pts = (via || []).map(p => (Array.isArray(p) ? p : [p.x, p.y]).map(Math.round));
    const next = links.map(l => {
      if (l.to !== to) return l;
      const v = { ...(l.via || {}) };
      if (pts.length) v[key] = pts; else delete v[key];
      const n = { ...l, via: v };
      if (!Object.keys(v).length) delete n.via;
      return n;
    });
    await api.store.update(from, { links: next });
    if (!quiet) api.toast(pts.length ? 'String reshaped.' : 'String handed back to the autorouter.', 'Undo', () => api.store.update(from, { links }));
  }

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    // Zoomed out, pins and connect dots grow so they stay big enough for a finger.
    world.style.setProperty('--iz', clamp(1 / view.z, 1, 2.4).toFixed(2));
    cork.style.backgroundPosition = `${view.x}px ${view.y}px`;
    cork.style.backgroundSize = `${Math.max(8, 220 * view.z)}px ${Math.max(8, 220 * view.z)}px, ${Math.max(4, 24 * view.z)}px ${Math.max(4, 24 * view.z)}px`;
    placeMedia();
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
    // (0.7.6) A dot on a string being shaped: move that turn, or put in a new one
    const dotEl = e.target.closest('[data-via], [data-addvia]');
    if (dotEl) {
      e.preventDefault(); capture(e.pointerId);
      gesture = startShape(dotEl, null, toWorld(e.clientX, e.clientY));
      if (gesture) { gesture.sx = e.clientX; gesture.sy = e.clientY; busy = true; }
      return;
    }
    // (anything but that string lets go of it)
    if (selString && e.target.closest('[data-link]')?.dataset.link !== selString) { selString = null; drawLines(); }
    if (e.target.closest('[data-tick], [data-ci], [data-openboard], [data-play], [data-big], [data-mclose], [data-mbig], .ptile[data-docopen], [data-linkopen]')) return;   // their own tap
    // (0.7.9: a file's picture drags its card like a photo does; a tap on it opens the file, see end)
    const link = e.target.closest('[data-link], [data-branch]');
    // A string's label (or the knot where its branches meet): tap to edit, drag onto a card to branch.
    const knot = !!link?.matches('.slabel, .junction');
    // Strings end on pins, so a string's tap area can lie over a pin: the pin wins (or no card
    // that already has a string could start another one).
    const pin = e.target.closest('[data-pin]') || (link && !knot ? under(e.clientX, e.clientY, '[data-pin]') : null);
    const fsize = e.target.closest('[data-fsize]');
    const csize = e.target.closest('[data-csize]');
    const fhead = e.target.closest('[data-fhead]');
    let card = e.target.closest('[data-card]');
    if (pin) {
      e.preventDefault(); capture(e.pointerId);
      gesture = { kind: 'connect', from: pin.dataset.pin };
      busy = true; return;
    }
    if (csize) {
      e.preventDefault(); capture(e.pointerId);
      const id = csize.dataset.csize, el = elOf(id);
      gesture = { kind: 'scale', id, el, sx: e.clientX, sy: e.clientY, s0: sc(id), w0: el.offsetWidth * sc(id), h0: el.offsetHeight * sc(id) };
      busy = true; return;
    }
    if (fsize) {
      capture(e.pointerId);
      const id = fsize.dataset.fsize;
      gesture = { kind: 'resize', id, sx: e.clientX, sy: e.clientY, start: { ...pos.get(id) } };
      busy = true; return;
    }
    // A string lying across a card: a drag still moves the card, a tap edits the string.
    if (link && !knot) card = under(e.clientX, e.clientY, '[data-card]');
    capture(e.pointerId);
    if (knot) {
      e.preventDefault();
      gesture = { kind: 'label', link: link.dataset.link, sx: e.clientX, sy: e.clientY, moved: false };
    } else if (card || fhead) {
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
      placeMedia();
      // Show which section a card will land in.
      for (const fr of framesEl.querySelectorAll('.drop')) fr.classList.remove('drop');
      if (!isFrame(g.id) && g.id !== key) { const into = frameAt(centre(g.id)); if (into) framesEl.querySelector(`[data-frame="${into}"]`)?.classList.add('drop'); }
      drawLines();
    } else if (g.kind === 'scale') {
      // Bigger or smaller from the top-left corner: as far as the drag goes across and down, on average.
      const byW = (g.w0 + (e.clientX - g.sx) / view.z) / g.w0, byH = (g.h0 + (e.clientY - g.sy) / view.z) / g.h0;
      const s2 = isSketch(api.store.get(g.id)) ? clamp(Math.round(g.s0 * (byW + byH) / 2 * 100) / 100, 0.15, 8) : clamp(Math.round(g.s0 * (byW + byH) / 2 * 20) / 20, 0.5, 3);
      g.s = s2;
      if (Math.abs(s2 - 1) > 0.01) scales.set(g.id, s2); else scales.delete(g.id);
      g.el.classList.toggle('scaled', scales.has(g.id));
      g.el.style.setProperty('--s', s2);
      heights.set(g.id, g.el.offsetHeight * s2);
      drawLines(); placeMedia();
    } else if (g.kind === 'resize') {
      const w = Math.max(320, Math.round(g.start.w + (e.clientX - g.sx) / view.z));
      const h = Math.max(200, Math.round(g.start.h + (e.clientY - g.sy) / view.z));
      pos.set(g.id, { ...g.start, w, h });
      placeEl(elOf(g.id)); drawLines();
    } else if (g.kind === 'connect') {
      const b = toWorld(e.clientX, e.clientY);
      drawLines();
      const A = rectOf(g.from), a = look() === 'corkboard' ? pinPoint(g.from) : A && { x: A.x + A.w / 2, y: A.y + A.h / 2 };
      if (a) lines.insertAdjacentHTML('beforeend', liveLine(a, b));
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      const over = targetAt(e.clientX, e.clientY);
      if (over && over !== g.from) elOf(over)?.classList.add('target');
    } else if (g.kind === 'label') {
      // Dragging a label out: a branch follows your finger to the card it'll join.
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 6) return;
      g.moved = true;
      const b = toWorld(e.clientX, e.clientY);
      drawLines();
      const J = junctions.get(g.link);
      if (J) lines.insertAdjacentHTML('beforeend', liveLine(J, b));
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      const over = targetAt(e.clientX, e.clientY);
      if (over && canBranch(g.link, over)) elOf(over)?.classList.add('target');
    } else if (g.kind === 'tap-line') {
      // (0.7.6) Pulling a string reshapes it (not a branch, or in String mode)
      if (tying || !g.line.dataset.link || Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 7) return;
      const s2 = startShape(null, g.line.dataset.link, toWorld(g.sx, g.sy));
      if (!s2) return;
      s2.sx = g.sx; s2.sy = g.sy;
      gesture = s2; selString = s2.id;
      moveShape(s2, toWorld(e.clientX, e.clientY));
    } else if (g.kind === 'via') {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 5) return;
      g.moved = true;
      moveShape(g, toWorld(e.clientX, e.clientY));
    }
  });
  // The dashed string that follows your finger while you tie or branch.
  const liveLine = (a, b) => (look() === 'corkboard' ? `<path class="wire wool live" d="${sag(a, b).d}"/>`
    : `<path class="wire ${WIRE_CLASS[look()] || 'pen'} live" d="M${f(a.x)} ${f(a.y)}L${f(b.x)} ${f(b.y)}"/>`);

  // The card (or section label) under a point, looking through any strings lying on top.
  const under = (cx, cy, sel) => {
    for (const el of document.elementsFromPoint(cx, cy)) { const hit = el.closest?.(sel); if (hit) return hit; }
    return null;
  };
  const targetAt = (cx, cy) => {
    const c = under(cx, cy, '[data-card], [data-fhead]');
    if (!c || c.dataset.banner !== undefined) return null;
    return c.dataset.card || c.dataset.fhead;
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
      if (!g.moved && up && tying) setTying(false);          // a tap on the empty board ends String mode
      else if (!g.moved && up) {
        const now = Date.now();
        if (lastTap && now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 25) { lastTap = null; addAt('note', toWorld(e.clientX, e.clientY)); }
        else lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    } else if (g.kind === 'move') {
      g.el?.classList.remove('lifted');
      for (const fr of framesEl.querySelectorAll('.drop')) fr.classList.remove('drop');
      if (g.moved) await settle(g);
      else if (up && recMode) recTap(g.line ? 'string' : 'card', g.line ? (g.line.dataset.link || stringOf(g.line.dataset.branch)) : g.id);   // (0.8.0)
      else if (up && tying) { if (g.id !== key) await tieTap(g.id); }
      else if (up && g.line) await tapLine(g.line, e.clientX, e.clientY);
      else if (up && isSketch(api.store.get(g.id))) drawOnBoard(g.id);    // a drawing on the board: change it there
      else if (up && g.down?.closest?.('.pdoc[data-docopen]')) { const m = cardBody(api.store.get(g.id)?.data.body).media; if (m?.doc) api.openDoc(m.doc); else api.open(g.id); }
      else if (up) { const sub = g.down?.closest?.('[data-sub]'); api.open(sub ? sub.dataset.sub : g.id); }
    } else if (g.kind === 'scale') {
      if (g.s != null && g.s !== g.s0) await setScale(g.id, g.s);
    } else if (g.kind === 'resize') {
      await settle({ id: g.id, starts: new Map([[g.id, null]]) });
    } else if (g.kind === 'connect') {
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      const over = targetAt(e.clientX, e.clientY);
      if (over && over !== g.from) connectMenu(g.from, over, e.clientX, e.clientY);
      else if (up && tying) await tieTap(g.from);           // in String mode a tap on a pin picks that card
      drawLines();
    } else if (g.kind === 'tap-line' && up && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 8) {
      if (recMode) recTap('string', g.line.dataset.link || stringOf(g.line.dataset.branch));
      else await tapLine(g.line, e.clientX, e.clientY);
    } else if (g.kind === 'via') {
      viaDraft = null;
      selString = g.id;
      if (g.moved) await saveVia(g.id, g.via, g.had);
      else if (up && !g.add) {
        // (a turn's dot tapped twice: that turn comes out)
        const now = Date.now();
        if (lastViaTap?.k === g.id && lastViaTap.i === g.idx && now - lastViaTap.t < 450) { lastViaTap = null; await saveVia(g.id, g.start.filter((_, i) => i !== g.idx)); }
        else { lastViaTap = { k: g.id, i: g.idx, t: now }; drawLines(); }
      } else drawLines();
    } else if (g.kind === 'label') {
      for (const c of host.querySelectorAll('.target')) c.classList.remove('target');
      if (g.moved) {
        const over = up && targetAt(e.clientX, e.clientY);
        if (!over || !(await addBranch(g.link, over))) drawLines();
      } else if (up && recMode) recTap('string', g.link);
      else if (up) await tapString(g.link, e.clientX, e.clientY);
    }
    flush();
  };

  // A tap on a string edits it (or, in String mode, picks it to branch); a tap on a branch offers
  // to open the card at its end or take that card off the string.
  const stringOf = branchId => branchId.split('|').slice(0, 2).join('|');
  async function tapLine(el, cx, cy) {
    if (el.dataset.branch && !tying) branchMenu(el.dataset.branch, cx, cy);
    else await tapString(el.dataset.branch ? stringOf(el.dataset.branch) : el.dataset.link, cx, cy);
  }
  async function tapString(link, cx, cy) {
    if (!tying) { openStringPop(link, cx, cy); return; }
    const card = tieFrom && !tieFrom.startsWith('L:') ? tieFrom : null;
    if (card) { tieFrom = null; if (!(await addBranch(link, card))) render(); return; }
    if (tieOnce && tieFrom === 'L:' + link) { setTying(false); return; }   // let go of a one-off branch
    tieFrom = tieFrom === 'L:' + link ? null : 'L:' + link;
    render();
  }
  function linkOf(link) {
    const [from, to] = link.split('|');
    return (api.store.get(from)?.data.links || []).find(l => l.to === to) || null;
  }
  function canBranch(link, c) {
    const [from, to] = link.split('|'), l = linkOf(link);
    return !!l && c !== key && c !== from && c !== to && !(l.also || []).includes(c);
  }
  async function addBranch(link, c) {
    const [from, to] = link.split('|');
    const r = api.store.get(from), l = linkOf(link);
    if (!r || !l || c === key) return false;
    if (!canBranch(link, c)) { api.toast(c === from || c === to || (l.also || []).includes(c) ? 'That card is already on this string.' : 'That can’t join this string.'); return false; }
    const links = r.data.links || [];
    writeLocal('bt-hint-seen', true);
    await api.store.update(from, { links: links.map(x => (x.to === to ? { ...x, also: [...(x.also || []), c] } : x)) });
    api.toast(`“${short(api.titleOf(api.store.get(c)))}” joined to ${l.label ? `“${short(l.label)}”` : 'the string'}.`, 'Undo', () => api.store.update(from, { links }));
    return true;
  }
  async function removeBranch(branchId) {
    const [from, to, c] = branchId.split('|');
    const links = api.store.get(from)?.data.links || [];
    const next = links.map(x => {
      if (x.to !== to) return x;
      const y = { ...x, also: (x.also || []).filter(id => id !== c) };
      if (!y.also.length) delete y.also;
      return y;
    });
    await api.store.update(from, { links: next });
    api.toast('Branch taken off.', 'Undo', () => api.store.update(from, { links }));
  }
  function branchMenu(branchId, cx, cy) {
    const c = branchId.split('|')[2], name = short(api.titleOf(api.store.get(c) || { data: {} }));
    menu(cx, cy, [
      { label: `Open “${name}”`, fn: () => api.open(c) },
      { label: `Take “${name}” off this string`, danger: true, fn: () => removeBranch(branchId) },
    ]);
  }
  // From the string's own menu: the next card you tap joins it.
  // (just the one: once it's joined, String mode ends again)
  function startBranch(link) {
    tying = true; tieFrom = 'L:' + link; tieOnce = true; selString = null;
    host.classList.add('tying');
    render();
  }
  cork.addEventListener('pointerup', end);
  cork.addEventListener('pointercancel', end);

  // Taps that belong to something on a card: a checklist box, "Open its board", a clip's buttons.
  cork.addEventListener('click', e => {
    const box = e.target.closest('[data-ci]');
    if (box) { toggleCheck(box.closest('[data-card]').dataset.card, +box.dataset.ci); return; }
    const ob = e.target.closest('[data-openboard]');
    if (ob) { api.openBoard(ob.dataset.openboard); return; }
    const card = e.target.closest('[data-card]')?.dataset.card;
    if (e.target.closest('[data-play]') && card) { startPlay(card); return; }
    if (e.target.closest('[data-big]') && card) { const m = cardBody(api.store.get(card)?.data.body).media; if (m?.clip) { stopPlay(); api.bigVideo(m.clip); } return; }
    if (e.target.closest('[data-mclose]')) { stopPlay(); return; }
    if (e.target.closest('.ptile[data-docopen]') && card) { const m = cardBody(api.store.get(card)?.data.body).media; if (m?.doc) api.openDoc(m.doc); return; }
    if (e.target.closest('[data-linkopen]') && card) { const m = cardBody(api.store.get(card)?.data.body).media; if (m?.link) window.open(m.link.url, '_blank', 'noopener,noreferrer'); return; }
    if (e.target.closest('[data-mbig]') && playing) { const c = playing.clip; stopPlay(); api.bigVideo(c); }
  });

  // ---------- A clip playing on its card ----------
  // The player sits in its own layer over the board (the cards are redrawn whenever anything
  // changes, which would restart a video inside one), centred on the card's picture. It isn't
  // shrunk with the board: zoomed out, the picture can be a few dozen pixels wide, too small for
  // YouTube's controls (and an iPhone needs a tap on YouTube's own play button). So it's at least
  // a comfortable size, and follows the card as the board moves.
  function startPlay(id) {
    const m = cardBody(api.store.get(id)?.data.body).media;
    if (m?.kind !== 'clip') return;
    stopPlay();
    const el = document.createElement('div');
    el.className = 'mplay';
    el.innerHTML = iframeHTML(m.clip) + `
      <button type="button" class="mclose" data-mclose aria-label="Stop the video">✕</button>
      <button type="button" class="mbig" data-mbig aria-label="Watch bigger" title="Watch bigger"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button>`;
    mediaEl.append(el);
    playing = { id, el, clip: m.clip };
    elOf(id)?.classList.add('playing');
    placeMedia();
  }
  function stopPlay() {
    if (!playing) return;
    playing.el.remove();
    elOf(playing.id)?.classList.remove('playing');
    playing = null;
  }
  function placeMedia() {
    if (!playing) return;
    const card = elOf(playing.id), box = card?.querySelector('.pclip'), p = pos.get(playing.id);
    if (!box || !p) { stopPlay(); return; }
    const W = cork.clientWidth, H = cork.clientHeight, m = 12;
    const k = sc(playing.id), sw = box.offsetWidth * k * view.z;
    const w = Math.round(Math.min(W - 2 * m, Math.max(sw, Math.min(400, W * 0.9)))), h = Math.round(w * 9 / 16);
    const cx = view.x + (p.x + (box.offsetLeft + box.offsetWidth / 2) * k) * view.z;
    const cy = view.y + (p.y + (box.offsetTop + box.offsetHeight / 2) * k) * view.z;
    const left = clamp(cx - w / 2, m, Math.max(m, W - w - m)), top = clamp(cy - h / 2, m + 14, Math.max(m + 14, H - h - m));
    Object.assign(playing.el.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
  }

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
      const spot = (id, p) => {
        const r = api.store.get(id), slot = id === key ? 'banner' : key;
        if (r && p) add(id, { cork: { ...(r.data.cork || {}), [slot]: { ...(r.data.cork?.[slot]?.s ? { s: r.data.cork[slot].s } : {}), ...spotOf(p) } } });
      };
      // Whatever was placed automatically (or a section that grew) keeps the spot it has now, so nothing jumps.
      for (const r of [...cards, ...frames]) {
        const s = r.data.cork?.[key], p = pos.get(r.id);
        if (p && (!s || s.x !== p.x || s.y !== p.y || (p.w && (s.w !== p.w || s.h !== p.h)))) spot(r.id, p);
      }
      for (const id of g.starts.keys()) spot(id, pos.get(id));
      // (0.7.6) A string shaped by hand between two things moved together (in a section) moves with them.
      for (const r of [...frames, ...cards]) {
        const ls = r.data.links || [], a = g.starts.get(r.id), p = pos.get(r.id);
        if (!a || !p || !ls.some(viaOf)) continue;
        const dx = p.x - a.x, dy = p.y - a.y;
        if (!dx && !dy) continue;
        const next = ls.map(l => (viaOf(l) && g.starts.get(l.to) ? { ...l, via: { ...l.via, [key]: viaOf(l).map(([x, y]) => [x + dx, y + dy]) } } : l));
        add(r.id, { links: next });
      }
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

  // A card's size on this board, kept with its spot.
  async function setScale(id, s2) {
    const r = api.store.get(id);
    if (!r) return;
    const p = pos.get(id), cur = { ...(r.data.cork?.[key] || {}), ...(p ? { x: p.x, y: p.y } : {}) };
    if (Math.abs(s2 - 1) < 0.01) delete cur.s; else cur.s = s2;
    await api.store.update(id, { cork: { ...(r.data.cork || {}), [key]: cur } });
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

  // String mode: the first tap picks a card, the second ties it to another. It stays on for more
  // until you tap the button again or the empty board.
  function setTying(on) {
    tying = on; tieFrom = null; tieOnce = false; selString = null;
    host.classList.toggle('tying', on);
    render();
  }
  async function tieTap(id) {
    if (tieFrom?.startsWith('L:')) {
      const link = tieFrom.slice(2);
      tieFrom = null;
      const ok = await addBranch(link, id);
      if (ok && tieOnce) setTying(false); else if (!ok) render();
      return;
    }
    if (!tieFrom || tieFrom === id) { tieFrom = tieFrom === id ? null : id; render(); return; }
    const a = tieFrom, b = id;
    tieFrom = null;
    const A = api.store.get(a), B = api.store.get(b);
    if (!A || !B) { render(); return; }
    const links = A.data.links || [];
    if (links.some(l => l.to === b) || (B.data.links || []).some(l => l.to === a)) { api.toast('Those two are already connected.'); render(); return; }
    writeLocal('bt-hint-seen', true);
    await api.store.update(a, { links: [...links, { to: b }] });
    api.toast(words().done, 'Undo', () => api.store.update(a, { links }));
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

  // A small menu where you tapped (or, with above, just above that point: for the toolbar).
  function menu(cx, cy, opts, above = false) {
    menuActions = opts;
    menuEl.innerHTML = opts.map((o, i) => `<button data-m="${i}" class="${o.danger ? 'danger' : ''}">${o.icon || ''}<span>${esc(o.label)}</span></button>`).join('') + '<button data-m="x" class="cancel"><span>Cancel</span></button>';
    menuEl.hidden = false;
    const b = host.getBoundingClientRect();
    menuEl.style.left = clamp(cx - b.left - 20, 8, b.width - menuEl.offsetWidth - 8) + 'px';
    menuEl.style.top = clamp(above ? cy - b.top - menuEl.offsetHeight - 10 : cy - b.top + 10, 8, b.height - menuEl.offsetHeight - 8) + 'px';
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
    pop.querySelector('[data-s="auto"]').hidden = !viaOf(l);
    showDir(l);
    if (selString !== link) { selString = link; drawLines(); }   // (its dots, to shape it by)
    const b = host.getBoundingClientRect();
    pop.hidden = false;
    // (0.7.6) Below where you tapped, or above, or to one side: wherever it covers least of the
    // string and its dots, so they can still be dragged.
    const pw = pop.offsetWidth, ph = pop.offsetHeight, pts = [];
    const glow = lines.querySelector('.selglow'), m = glow?.getScreenCTM();
    if (glow && m) { const L = glow.getTotalLength(); for (let i = 0; i <= 40; i++) { const q = glow.getPointAtLength(L * i / 40); pts.push(new DOMPoint(q.x, q.y).matrixTransform(m)); } }
    for (const d of lines.querySelectorAll('.viah .hdot, .addh .hdot')) { const r = d.getBoundingClientRect(); for (let i = 0; i < 3; i++) pts.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); }
    const spots = [[cx - pw / 2, cy + 16], [cx - pw / 2, cy - ph - 16], [cx + 28, cy - ph / 2], [cx - pw - 28, cy - ph / 2]]
      .map(([x, y]) => [clamp(x - b.left, 8, b.width - pw - 8), clamp(y - b.top, 8, b.height - ph - 8)]);
    let best = spots[0], fewest = Infinity;
    for (const [x, y] of spots) {
      const n = pts.filter(p => p.x > b.left + x - 12 && p.x < b.left + x + pw + 12 && p.y > b.top + y - 12 && p.y < b.top + y + ph + 12).length;
      if (n < fewest) { fewest = n; best = [x, y]; }
    }
    pop.style.left = best[0] + 'px';
    pop.style.top = best[1] + 'px';
    const input = pop.querySelector('input');
    input.value = l.label || '';
    if (matchMedia('(pointer: fine)').matches) input.focus();
  }
  // The string menu's arrow button, saying which way the string points now.
  function showDir(l) {
    if (!popLink) return;
    const name = id => `“${short(api.titleOf(api.store.get(id) || { data: {} }))}”`, d = dirOf(l);
    pop.querySelector('[data-s="dir"]').innerHTML = `<span class="dirico">${{ to: '→', from: '←', both: '↔', none: '—' }[d]}</span>` + esc(
      d === 'to' ? `Points to ${name(popLink.to)}` : d === 'from' ? `Points to ${name(popLink.from)}` : d === 'both' ? 'Points both ways' : 'No arrows');
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
    } else await api.store.update(from, { links: links.map(l => { if (l.to !== to) return l; const n = { ...l, label }; if (!label) delete n.label; return n; }) });
  }
  pop.addEventListener('click', async e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'dir') {
      // (0.7.7) Which way it points: each tap the next of to → from → both → none
      if (!popLink) return;
      const { from, to } = popLink, links = api.store.get(from)?.data.links || [], l = links.find(x => x.to === to);
      if (!l) return;
      const next = { to: 'from', from: 'both', both: 'none', none: 'to' }[dirOf(l)];
      await api.store.update(from, { links: links.map(x => (x.to === to ? { ...x, dir: next } : x)) });
      showDir({ ...l, dir: next });
      return;
    }
    if (b.dataset.s === 'auto') {
      const link = popLink && `${popLink.from}|${popLink.to}`, typed = pop.querySelector('input').value.trim();
      if (!link) return;
      if (typed !== (linkOf(link)?.label || '')) await saveString(false); else { pop.hidden = true; popLink = null; }
      await saveVia(link, []);
      return;
    }
    if (b.dataset.s !== 'branch') { if (b.dataset.s === 'remove') selString = null; saveString(b.dataset.s === 'remove'); return; }
    const link = popLink && `${popLink.from}|${popLink.to}`;
    if (!link) return;
    const typed = pop.querySelector('input').value.trim(), was = linkOf(link)?.label || '';
    if (typed !== was) await saveString(false); else { pop.hidden = true; popLink = null; }
    startBranch(link);
  });
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

  function placeExisting() {
    const I = api.index();
    api.placePicker(key, [key, ...I.descendants(key).map(r => r.id), ...cards.map(r => r.id)], async id => {
      const c = viewCentre();
      const r = api.store.get(id);
      await api.store.update(id, { cork: { ...(r.data.cork || {}), [key]: { x: Math.round(c.x - CARD_W / 2), y: Math.round(c.y) } } });
    });
  }

  // A clip or a drawing on the board is a note holding it (so it's in the lists too).
  // (These cards are big, so they go in the nearest empty space rather than on top of others.)
  async function addClip() {
    const at = freeSpot(CARD_W, 160, viewCentre());
    const c = await api.pickClip(null);
    if (!c || c === 'remove') return;
    await api.newItem('note', key, { title: c.title || 'YouTube clip', body: clipDivHTML(c), cork: { [key]: at } });
  }
  // Drawing straight onto the board (0.7.2): the drawing editor opens over the board, see-through,
  // and moves with it. Done makes (or changes) a drawing card exactly where and as big as you drew:
  // a note with data.sketch, its drawing in board coordinates, its spot and size on this board.
  // Tapping one opens it here again; rubbing everything out removes it.
  async function drawOnBoard(id = null) {
    if (tying) setTying(false);
    menuEl.hidden = true; pop.hidden = true;
    const r = id && api.store.get(id);
    let start = null;
    if (r) {
      const m = cardBody(r.data.body).media;
      if (m?.kind !== 'draw' || !m.d) { api.open(id); return; }
      // Where it is now (it may have been moved or made bigger): back into board coordinates.
      const box = drawingBox(m.d, true), p = pos.get(id), k = cw(id) / box.w;
      start = p ? moveDrawing(m.d, k, p.x - box.x * k, p.y - box.y * k) : m.d;
      sketching = id; render();
    }
    const cs = getComputedStyle(cork);
    const dr = await openDrawing({ drawing: start, title: r ? 'Change the drawing' : 'Draw on the board', stage: {
      ink: cs.getPropertyValue('--sketch-ink').trim() || '#26292E',
      paper: cs.getPropertyValue('--sketch-paper').trim() || '#FFFEFA',
      rect: host.getBoundingClientRect(),
      getView: svgRect => { const c = cork.getBoundingClientRect(); return { z: view.z, x: view.x + c.left - svgRect.left, y: view.y + c.top - svgRect.top }; },
      setView: (v, svgRect) => { const c = cork.getBoundingClientRect(); view = { z: v.z, x: v.x + svgRect.left - c.left, y: v.y + svgRect.top - c.top }; applyView(); },
    } });
    sketching = null;
    saveView();
    if (!dr) { render(); return; }
    if (!dr.s.length) {
      if (r) {
        await api.store.update(id, { trashed: new Date().toISOString() });
        api.toast('Drawing rubbed out.', 'Undo', () => api.store.update(id, { trashed: undefined }));
      } else render();
      return;
    }
    const box = drawingBox(dr, true), s = Math.round(box.w / CARD_W * 1000) / 1000;
    const spot = { x: Math.round(box.x), y: Math.round(box.y), ...(Math.abs(s - 1) > 0.01 ? { s } : {}) };
    if (r) await api.store.update(id, { body: drawDivHTML(dr), cork: { ...(r.data.cork || {}), [key]: spot } });
    else await api.newItem('note', frameAt({ x: box.x + box.w / 2, y: box.y + box.h / 2 }) || key, { title: 'Drawing', sketch: true, body: drawDivHTML(dr), cork: { [key]: spot } });
  }

  async function addSheet() {
    const at = freeSpot(CARD_W, 200, viewCentre());
    const sh = await api.sheet(null, 'New spreadsheet');
    if (!sh || sh === 'remove') return;
    await api.newItem('note', key, { title: 'Spreadsheet', body: sheetDivHTML(sh), cork: { [key]: at } });
  }
  // Files from the device: each one a note holding it (photos as photos).
  function addFiles() {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.addEventListener('change', async () => {
      let at = freeSpot(CARD_W, 120, viewCentre());
      for (const file of input.files) {
        try {
          let body, title = file.name.replace(/\.[a-z0-9]{1,5}$/i, '');
          if (/^image\/(jpeg|png|webp|gif)$/.test(file.type)) body = `<p><img data-file="${await api.store.addPhoto(file)}" alt=""></p>`;
          else body = docDivHTML(await (api.addDoc || api.store.addDoc)(file));   // (0.7.9: with its picture)
          await api.newItem('note', key, { title, body, cork: { [key]: at } });
          at = { x: at.x + CARD_W + GAP, y: at.y };
        } catch (e) { api.toast(e.message || String(e)); }
      }
    });
    input.click();
  }
  async function addWebLink() {
    const at = freeSpot(CARD_W, 90, viewCentre());
    const l = await api.pickLink(null);
    if (!l || l === 'remove') return;
    await api.newItem('note', key, { title: l.title || '', body: linkDivHTML(l), cork: { [key]: at } });
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
    // Tidy and Fit ask first (0.7.2), so a stray tap doesn't rearrange or move the board.
    else if (a === 'fit' || a === 'tidy') {
      if (!menuEl.hidden) { menuEl.hidden = true; return; }
      if (tying) setTying(false);
      const r = b.getBoundingClientRect();
      menu(r.left + 10, r.top, a === 'fit'
        ? [{ label: 'Fit everything on screen', fn: () => fit() }]
        : [
          { label: 'Tidy everything (sections and cards)', fn: () => tidy('all') },
          ...(frames.length ? [{ label: 'Tidy inside sections (sections stay put)', fn: () => tidy('inside') }] : []),
          { label: 'Tidy strings only (cards stay put)', fn: () => tidyStrings() },
        ], true);
    }
    else if (a === 'add') {
      if (!menuEl.hidden) { menuEl.hidden = true; return; }
      if (tying) setTying(false);
      const r = b.getBoundingClientRect();
      const ic = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
      menu(r.left + 20, r.top, [
        { label: 'Note', icon: ic('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/>'), fn: () => addAt('note') },
        { label: 'To-do', icon: ic('<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>'), fn: () => addAt('task') },
        { label: 'Section', icon: ic('<path d="M4 9V6a1 1 0 0 1 1-1h3M16 5h3a1 1 0 0 1 1 1v3M20 15v3a1 1 0 0 1-1 1h-3M8 19H5a1 1 0 0 1-1-1v-3"/>'), fn: () => addSection() },
        { label: 'YouTube clip', icon: ic('<rect x="2.5" y="5.5" width="19" height="13" rx="3.5"/><path d="M10 9v6l5-3z"/>'), fn: () => addClip() },
        { label: 'Drawing (on the board)', icon: ic('<rect x="3" y="4" width="7" height="5" rx="1"/><circle cx="17" cy="17" r="3.5"/><path d="M6.5 9v4.5a3 3 0 0 0 3 3H13"/>'), fn: () => drawOnBoard() },
        { label: 'Spreadsheet', icon: ic('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 15h18M9 4v16M15 4v16"/>'), fn: () => addSheet() },
        { label: 'File (PDF, Word, Excel…)', icon: ic('<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 17.2a1.6 1.6 0 0 1-2.3-2.3L15 7.3"/>'), fn: () => addFiles() },
        { label: 'Link to a document or page', icon: ic('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'), fn: () => addWebLink() },
        { label: 'Something already in Brain Tree', icon: ic('<path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/>'), fn: () => placeExisting() },
      ], true);
    }
    else if (a === 'tie') setTying(!tying);
    else if (a === 'draw') drawOnBoard();
    else if (a === 'rec') setRecMode(!recMode);
  });

  // (0.7.5) Tidy works the layout out once and saves it (see "Tidy" above). 'all': everything laid
  // out again; cards brought in from elsewhere keep their spots (that's what keeps them here), and
  // so do drawings made on the board (they were drawn where they are). 'inside': sections stay put.
  const tidyTodo = () => cards.filter(r => !guests.has(r.id) && !(isSketch(r) && Number.isFinite(r.data.cork?.[key]?.x)));
  // Everything laid out again (par: cards as if somewhere else, see tidyAll), under any cards brought
  // in from elsewhere.
  function layoutAll(todo, budget = 400, par = null) {
    const out = tidyAll(todo, budget, par);
    let gx = Infinity, gy = -Infinity;
    for (const r of cards) if (guests.has(r.id)) { const p = pos.get(r.id); if (p) { gx = Math.min(gx, p.x); gy = Math.max(gy, p.y + hOf(r.id)); } }
    if (gy > -Infinity) for (const p of out.values()) { p.x += gx; p.y += gy + 90; }
    return out;
  }

  async function tidy(mode) {
    if (busy) return;
    tipToken++; hideTip();
    let out, moved = [], base = 0;
    if (mode === 'inside') out = tidyInside();
    else {
      const todo = tidyTodo();
      out = layoutAll(todo); base = tidyScore;
      if (api.tidyMove?.()) ({ out, moved } = moveStranded(todo, out, base));
    }
    const undo = await applyLayout(out, mode, moved);
    api.toast(mode === 'inside' ? 'Tidied inside the sections.' : moved.length ? 'Board tidied: ' + movedWords(moved) : 'Board tidied.', 'Undo', undo);
    if (mode !== 'inside' && !api.tidyMove?.()) suggestLater(base);
  }

  // (0.7.9) Cards stranded in their section: every string they have goes to something outside it
  // (a "needed before" to a card in another section, say). Tidy never moves a card out of its
  // section by itself (sections are headings in the list too), so it tries each such card out of
  // its section, and in the section its strings go to, and if the board comes out clearly tidier it
  // suggests that (or, if Settings → Boards say so, just does it).
  function strandedCards() {
    const on = new Map([...frames, ...cards].map(r => [r.id, r]));
    const ends = new Map();
    const tie = (a, b) => { if (a === b || !on.has(a) || !on.has(b)) return; for (const [x, y] of [[a, b], [b, a]]) { if (!ends.has(x)) ends.set(x, new Set()); ends.get(x).add(y); } };
    for (const r of on.values()) for (const l of r.data.links || []) { tie(r.id, l.to); for (const c of l.also || []) { tie(r.id, c); tie(l.to, c); } }
    const secOf = id => (frameIds.has(id) ? id : frameIds.has(on.get(id)?.data.parent) ? on.get(id).data.parent : null);
    const out = [];
    for (const c of cards) {
      const S = c.data.parent;
      if (!frameIds.has(S) || guests.has(c.id) || isSketch(c) || !ends.has(c.id)) continue;
      const to = [...ends.get(c.id)];
      if (to.some(id => secOf(id) === S)) continue;
      // (only the odd one out: the rest of its section is strung together and it isn't part of that.
      // A section where nothing's strung together, like a shopping list, is just what it's about.)
      const sibs = cards.filter(k => k !== c && k.data.parent === S && !isSketch(k));
      if (!sibs.some(k => [...(ends.get(k.id) || [])].some(id => id !== c.id && on.get(id)?.data.parent === S))) continue;
      const secs = new Set(to.map(secOf));
      out.push({ c, from: S, into: secs.size === 1 && [...secs][0] ? [...secs][0] : null });
    }
    return out;
  }
  // The moves to try: in the section its strings go to (if they all go to one), and out of its section.
  // (a card you've said to keep where it is isn't suggested again: remembered on this device)
  const keptThere = () => new Set(readLocal('bt-tidy-kept', {})[key] || []);
  function keepThere(id) { const all = readLocal('bt-tidy-kept', {}); all[key] = [...new Set([...(all[key] || []), id])].slice(-200); writeLocal('bt-tidy-kept', all); }
  function strandedTries() {
    const list = [], kept = keptThere();
    for (const s of strandedCards().filter(s => !kept.has(s.c.id)).slice(0, 3)) {
      if (s.into) list.push({ c: s.c, from: s.from, to: s.into });
      list.push({ c: s.c, from: s.from, to: key });
    }
    return list;
  }
  function tryMove(todo, t, budget = 150) {
    const out = layoutAll(todo, budget, new Map([[t.c.id, t.to]]));
    return { ...t, out, score: tidyScore };
  }
  const clearlyTidier = (s, base) => s < base - Math.max(100, base * 0.05);
  const movedWords = moved => moved.map(m => `“${short(api.titleOf(m.c))}” ${m.to === key ? `taken out of “${short(api.titleOf(api.store.get(m.from)))}”` : `moved into “${short(api.titleOf(api.store.get(m.to)))}”`}`).join('; ') + '.';

  // (Settings say just do it) The tidiest move for each stranded card, all of them if that's tidier still.
  function moveStranded(todo, out, base) {
    const good = strandedTries().map(t => tryMove(todo, t)).filter(r => clearlyTidier(r.score, base)).sort((a, b) => a.score - b.score);
    const pick = [], seen = new Set();
    for (const g of good) if (!seen.has(g.c.id)) { seen.add(g.c.id); pick.push(g); }
    if (!pick.length) return { out, moved: [] };
    if (pick.length > 1) {
      const all = layoutAll(todo, 150, new Map(pick.map(g => [g.c.id, g.to])));
      if (tidyScore < pick[0].score) return { out: all, moved: pick };
    }
    return { out: pick[0].out, moved: [pick[0]] };
  }

  // (Settings say suggest it, the usual) Worked out a moment after the board's tidied, a move at a
  // time so the board stays usable, then shown as a tip over the board.
  let tipToken = 0;
  const tipEl = host.querySelector('.tidytip');
  function hideTip() { tipEl.hidden = true; tipEl.innerHTML = ''; }
  let tipTried = [];   // (what was tried and how much tidier, in %, for testing)
  function suggestLater(base) {
    const token = ++tipToken, k0 = key, todo = tidyTodo(), tries = strandedTries(), good = [];
    tipTried = [];
    if (!tries.length) return;
    let i = 0;
    const step = () => {
      if (token !== tipToken || key !== k0) return;
      if (busy) { setTimeout(step, 200); return; }
      if (i < tries.length) {
        const r = tryMove(todo, tries[i++]);
        tipTried.push({ c: api.titleOf(r.c), to: r.to === key ? 'out' : api.titleOf(api.store.get(r.to)), gain: Math.round(1000 * (base - r.score) / base) / 10 });
        if (clearlyTidier(r.score, base)) good.push(r);
        setTimeout(step, 30);
        return;
      }
      showTip(good.sort((a, b) => a.score - b.score));
    };
    setTimeout(step, 700);
  }
  function showTip(good) {
    if (!good.length) { hideTip(); return; }
    const c = good[0].c, mine = good.filter(g => g.c === c), rest = good.filter(g => g.c !== c);
    const name = id => `“${esc(short(api.titleOf(api.store.get(id))))}”`;
    tipEl.innerHTML = `
      <p><b>Tidy tip:</b> ${name(c.id)} is only strung to cards outside ${name(c.data.parent)}. ${mine[0].to === key ? 'Taken out of it' : `Moved into ${name(mine[0].to)}`}, the board would be tidier.</p>
      <div class="tbtns">${mine.map((g, n) => `<button data-tip="${n}" class="${n ? '' : 'primary'}">${g.to === key ? 'Take it out' : `Move into ${name(g.to)}`}</button>`).join('')}
        ${rest.length ? '<button data-tip="next">Next tip</button>' : ''}<button data-tip="keep" class="dim" title="Tidy won’t suggest moving this card again">Keep it there</button><button data-tip="no" class="x" aria-label="Not now">×</button></div>`;
    tipEl.hidden = false;
    tipEl.onclick = async e => {
      const b = e.target.closest('[data-tip]');
      if (!b || busy) return;
      if (b.dataset.tip === 'next') { showTip(rest); return; }
      if (b.dataset.tip === 'keep') { keepThere(c.id); if (rest.length) showTip(rest); else { tipToken++; hideTip(); } return; }
      tipToken++; hideTip();
      if (b.dataset.tip === 'no') return;
      const g = mine[+b.dataset.tip];
      if (!api.store.get(g.c.id) || api.store.get(g.c.id).data.parent !== g.from) return;   // (moved meanwhile)
      const undo = await applyLayout(g.out, 'all', [g]);
      api.toast(movedWords([g]).replace(/^./, s => s.toUpperCase()), 'Undo', undo);
    };
  }

  // A layout saved, with any cards moved to another section (moved: [{c, from, to}]). Gives back
  // what puts it all as it was.
  async function applyLayout(out, mode, moved = []) {
    const ids = [...out.keys()].filter(id => api.store.get(id));
    const before = new Map(ids.map(id => [id, api.store.get(id).data.cork]));
    const parents = new Map(moved.map(m => [m.c.id, m.to]));
    const parentsBefore = new Map(moved.map(m => [m.c.id, m.from]));
    const proj = api.store.get(key), banner = proj?.data.cork;
    // (0.7.6) Strings shaped by hand: moved along if both ends moved the same way, otherwise handed
    // back to the autorouter (the shape was for where things were).
    const shapedBefore = new Map(), shapedNext = new Map();
    for (const r of [...frames, ...cards]) {
      const ls = r.data.links || [];
      if (!ls.some(viaOf)) continue;
      const d = id => { const a = pos.get(id), b = out.get(id); return a && b ? [Math.round(b.x - a.x), Math.round(b.y - a.y)] : [0, 0]; };
      let changed = false;
      const next = ls.map(l => {
        const v = viaOf(l);
        if (!v) return l;
        const [ax, ay] = d(r.id), [bx, by] = d(l.to);
        if (!ax && !ay && !bx && !by) return l;
        changed = true;
        const via = { ...l.via };
        if (ax === bx && ay === by) via[key] = v.map(([x, y]) => [x + ax, y + ay]); else delete via[key];
        const n = { ...l, via };
        if (!Object.keys(via).length) delete n.via;
        return n;
      });
      if (changed) { shapedBefore.set(r.id, ls); shapedNext.set(r.id, next); }
    }
    busy = true;
    try {
      for (const id of ids) {
        const r = api.store.get(id), p = out.get(id), s = r.data.cork?.[key]?.s;   // (a card keeps its size)
        const spot = isFrame(id) ? { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.w), h: Math.round(p.h) } : { x: Math.round(p.x), y: Math.round(p.y), ...(s ? { s } : {}) };
        await api.store.update(id, { cork: { ...(r.data.cork || {}), [key]: spot }, ...(parents.has(id) ? { parent: parents.get(id) } : {}) });
      }
      for (const [id, links] of shapedNext) await api.store.update(id, { links });
      // (the banner goes back over the middle of it all)
      if (mode !== 'inside' && banner?.banner) { const c = { ...banner }; delete c.banner; await api.store.update(key, { cork: Object.keys(c).length ? c : undefined }); }
    } finally { busy = false; }
    needsFit = mode !== 'inside'; render();
    return async () => {
      for (const [id, c] of before) await api.store.update(id, { cork: c, ...(parentsBefore.has(id) ? { parent: parentsBefore.get(id) } : {}) });
      for (const [id, links] of shapedBefore) await api.store.update(id, { links });
      if (mode !== 'inside' && banner?.banner) await api.store.update(key, { cork: banner });
    };
  }

  // (0.7.8) Tidy strings: the cards stay put and every string is routed again by the autorouter,
  // including the ones shaped by hand (which lose their shape on this board; Undo puts it back).
  // Strings nobody's shaped are routed like this all the time anyway, whenever something moves.
  async function tidyStrings() {
    if (busy) return;
    const before = new Map();
    for (const r of [...frames, ...cards]) if ((r.data.links || []).some(viaOf)) before.set(r.id, r.data.links);
    let n = 0;
    busy = true;
    try {
      for (const [id, ls] of before) {
        const next = ls.map(l => {
          if (!viaOf(l)) return l;
          n++;
          const via = { ...l.via };
          delete via[key];
          const m = { ...l, via };
          if (!Object.keys(via).length) delete m.via;
          return m;
        });
        await api.store.update(id, { links: next });
      }
    } finally { busy = false; }
    selString = null; pop.hidden = true; pendingRender = false;
    routeCache = null; routeNow = true;
    try { render(); } finally { routeNow = false; }
    if (n) api.toast(`Strings tidied: ${n === 1 ? 'the one' : `the ${n}`} you'd shaped went back to the autorouter.`, 'Undo', async () => { for (const [id, links] of before) await api.store.update(id, { links }); });
    else api.toast('Strings tidied. (They route themselves round the cards whenever something moves.)');
  }

  // ---------- Record mode (0.8.0): the board as a video (see record.js) ----------
  // Record on the board bar: a strip of shots along the bottom, and a frame over the board showing
  // what the camera sees. Tap a card, section or string to add a shot of it (after the one picked);
  // tap a shot to go to it and change it: how long, how it gets there, what happens, a caption, or
  // "Use this view" to frame it as it is on screen. Recordings are kept on the project (data.recs).
  let recMode = false, recId = null, recSel = -1, recTween = 0;
  const recEls = {};
  const recs = () => (api.store.get(key)?.data.recs || []).filter(r => r && Array.isArray(r.shots));
  const recNow = () => recs().find(r => r.id === recId) || null;
  const rid = () => Math.random().toString(36).slice(2, 10);
  async function saveRec(rec) {
    const all = recs(), i = all.findIndex(r => r.id === rec.id);
    if (i < 0) all.push(rec); else all[i] = rec;
    await api.store.update(key, { recs: all });
  }
  const recAspect = rec => { const [w, h] = SIZES[rec?.aspect] || SIZES['16:9']; return w / h; };

  // What a shot is of, on the board now (null if it's gone).
  const stringIds = () => { const out = new Map(), on = new Set([...cards, ...frames].map(r => r.id)); for (const r of [...frames, ...cards]) for (const l of r.data.links || []) if (on.has(l.to)) out.set(`${r.id}|${l.to}`, [r.id, l.to]); return out; };
  function boardRect() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of [key, ...cards.map(r => r.id), ...frames.map(r => r.id)]) { const b = rectOf(id); if (!b) continue; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return x0 === Infinity ? { x: 0, y: 0, w: 800, h: 600 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function targetRect(s) {
    if (s.k === 'board') return boardRect();
    if (s.k === 'view') return { x: s.at.dx, y: s.at.dy, w: 0, h: 0 };
    if (s.k === 'string') {
      const sh = shown.get(s.tid), pts = sh?.pts || sh?.line;
      const ends = (stringIds().get(s.tid) || []).map(rectOf).filter(Boolean);
      if (!ends.length) return null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts || []) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      for (const b of ends) { x0 = Math.min(x0, b.x + b.w * 0.25); y0 = Math.min(y0, b.y + b.h * 0.25); x1 = Math.max(x1, b.x + b.w * 0.75); y1 = Math.max(y1, b.y + b.h * 0.75); }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    return rectOf(s.tid);
  }
  // A frame round something: all of it in view, with some board round it.
  function frameAround(r, A, k = 1.45) {
    const w = Math.max(r.w * k, r.h * k * A, 300);
    return { dx: 0, dy: 0, w: Math.round(w) };
  }
  function frameOf(s, A) {
    const r = targetRect(s);
    if (!r) return null;
    if (s.k === 'view') return { cx: s.at.dx, cy: s.at.dy, w: s.at.w };
    return { cx: r.x + r.w / 2 + (s.at?.dx || 0), cy: r.y + r.h / 2 + (s.at?.dy || 0), w: s.at?.w || frameAround(r, A).w };
  }
  // The strings a shot traces: a string's own, or every string to or from a card or section.
  function tracedBy(s) {
    if (!s.fx?.trace) return [];
    const all = stringIds();
    if (s.k === 'string') return all.has(s.tid) ? [s.tid] : [];
    if (s.k === 'card' || s.k === 'section') return [...all].filter(([, ends]) => ends.includes(s.tid)).map(([id]) => id);
    return [];
  }
  const shotName = s => s.k === 'board' ? 'The whole board' : s.k === 'view' ? 'A view' : s.k === 'string'
    ? (() => { const [a, b] = s.tid.split('|'); const l = (api.store.get(a)?.data.links || []).find(x => x.to === b); return l?.label ? `“${l.label}”` : `${short(api.titleOf(api.store.get(a) || { data: {} }))} → ${short(api.titleOf(api.store.get(b) || { data: {} }))}`; })()
    : short(api.titleOf(api.store.get(s.tid) || { data: {} }));

  // Everything record.js needs to draw a recording: the board as a picture (without the strings it
  // traces and the cards it drops in, which come separately), and where things are.
  async function recordScene(rec) {
    const A = recAspect(rec), shots = (rec.shots || []).filter(s => targetRect(s));
    if (!shots.length) throw new Error('Add a shot first: tap a card, section or string.');
    const seenL = new Set(), seenC = new Set();
    const per = shots.map(s => ({
      links: tracedBy(s).filter(id => !seenL.has(id) && seenL.add(id)),
      reveal: s.fx?.reveal && s.k === 'card' && !seenC.has(s.tid) && seenC.add(s.tid) ? [s.tid] : [],
    }));
    const defs = host.querySelector('.strings defs');
    const ex = await exportSVG({
      hideLinks: seenL, hideCards: seenC,
      collect: (ox, oy) => {
        const w = r => ({ x: r.left - ox, y: r.top - oy, w: r.width, h: r.height });
        const links = new Map();
        for (const id of seenL) {
          const g = lines.querySelector(`[data-sw="${id}"]`), hit = lines.querySelector(`path.hit[data-link="${id}"]`), lab = lines.querySelector(`[data-sl="${id}"]`);
          if (!g || !hit) continue;
          links.set(id, { d: hit.getAttribute('d'), len: hit.getTotalLength(), box: grow(w(g.getBoundingClientRect()), 26), markup: inlineNode(g),
            label: lab ? { box: grow(w(lab.getBoundingClientRect()), 6), markup: inlineNode(lab) } : null });
        }
        const geo = new Map();
        for (const s of shots) {
          if (s.k !== 'card' || geo.has(s.tid)) continue;
          const el = elOf(s.tid);
          if (!el) continue;
          const t = el.querySelector('.ptitle span'), titles = [];
          if (t?.firstChild) { const rg = document.createRange(); rg.selectNodeContents(t); const seen = []; for (const r of rg.getClientRects()) { if (r.width < 2) continue; const last = seen[seen.length - 1]; if (last && Math.abs(last.top - r.top) < r.height / 2) { last.right = Math.max(last.right, r.right); last.left = Math.min(last.left, r.left); } else seen.push({ left: r.left, right: r.right, top: r.top, height: r.height }); } for (const r of seen) titles.push({ x: r.left - ox, y: r.top - oy, w: r.right - r.left, h: r.height }); }
          const tick = el.querySelector(`.tick[data-tick="${s.tid}"]`), media = el.querySelector('.polaroid, .pdoc .dpage, .pclip, .pdraw, .psheet');
          geo.set(s.tid, { titles, tick: tick && !tick.classList.contains('done') ? w(tick.getBoundingClientRect()) : null, media: media ? w(media.getBoundingClientRect()) : null, rect: w(el.getBoundingClientRect()) });
        }
        return { links, geo, defs: defs ? inlineNode(defs) : '' };
      },
    });
    const { links: L, geo, defs: defsMarkup } = ex.extra;
    const base = await svgImage(ex.svg);
    const scene = { size: SIZES[rec.aspect] || SIZES['16:9'], bg: ex.bg && ex.bg !== 'rgba(0, 0, 0, 0)' ? ex.bg : getComputedStyle(cork).backgroundColor || '#222', look: rec.look || 'none',
      base: { img: base, x0: ex.x0, y0: ex.y0, w: ex.w, h: ex.h }, links: new Map(), cards: new Map(), shots: [] };
    for (const [id, l] of L) {
      scene.links.set(id, { img: await svgImage(boxSVG(defsMarkup + l.markup, l.box)), box: l.box, path: new Path2D(l.d), len: l.len,
        label: l.label ? { img: await svgImage(boxSVG(defsMarkup + l.label.markup, l.label.box)), box: l.label.box } : null });
    }
    for (const id of seenC) {
      const g = geo.get(id), r = g?.rect || rectOf(id), box = grow(r, 30);
      scene.cards.set(id, { img: await svgImage(boxSVG(ex.cards.get(id) || '', box)), box, rect: r });
    }
    scene.shots = shots.map((s, i) => {
      const g = geo.get(s.tid) || {};
      return { ...s, fx: s.fx || {}, frame: frameOf(s, A), rect: s.k === 'view' ? (() => { const f2 = frameOf(s, A); return { x: f2.cx - f2.w * 0.3, y: f2.cy - f2.w * 0.3 / A, w: f2.w * 0.6, h: f2.w * 0.6 / A }; })() : targetRect(s),
        media: g.media || null, titles: g.titles || [], tick: s.fx?.tick ? g.tick || null : null, links: per[i].links, reveal: per[i].reveal };
    });
    return scene;
  }
  const grow = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 });
  const boxSVG = (markup, b) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${Math.ceil(b.w)}" height="${Math.ceil(b.h)}" viewBox="${f(b.x)} ${f(b.y)} ${Math.ceil(b.w)} ${Math.ceil(b.h)}">${markup}</svg>`;
  function svgImage(svg) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The board couldn’t be drawn for the recording.')); };
      img.src = url;
    });
  }

  // ----- the editor -----
  function setRecMode(on) {
    recMode = on;
    host.classList.toggle('rec', on);
    if (!on) { for (const el of Object.values(recEls)) el.remove(); for (const k in recEls) delete recEls[k]; removeEventListener('resize', recLayout); render(); return; }
    if (tying) setTying(false);
    if (!findEl.hidden) closeFind();
    let all = recs();
    if (!all.length) {
      const rec = { id: rid(), name: 'Recording 1', aspect: cork.clientWidth < cork.clientHeight ? '9:16' : '16:9', look: 'none', audio: null, shots: [] };
      all = [rec]; saveRec(rec);
    }
    if (!all.some(r => r.id === recId)) recId = all[0].id;
    recSel = -1;
    recEls.frame = Object.assign(document.createElement('div'), { className: 'recframe' });
    recEls.panel = Object.assign(document.createElement('div'), { className: 'recpanel' });
    recEls.sheet = Object.assign(document.createElement('div'), { className: 'recsheet', hidden: true });
    cork.append(recEls.frame);
    host.append(recEls.sheet, recEls.panel);
    recEls.panel.addEventListener('click', recPanelClick);
    recEls.sheet.addEventListener('click', recSheetClick);
    recEls.sheet.addEventListener('change', recSheetChange);
    addEventListener('resize', recLayout);
    recDraw();
  }
  function recDraw() {
    const rec = recNow();
    if (!rec || !recEls.panel) return;
    const tl = timeline(rec.shots);
    recEls.panel.innerHTML = `
      <div class="rprow">
        <button data-r="pick" class="rpname" title="Recordings">● ${esc(short(rec.name || 'Recording'))} ▾</button>
        <button data-r="aspect" title="Shape of the video">${rec.aspect === '9:16' ? '▯ 9:16' : '▭ 16:9'}</button>
        <button data-r="look" title="A look over the whole video">${esc(LOOKS[rec.look] || 'Plain')}</button>
        <button data-r="audio" title="A voiceover to time the shots to">♪ ${rec.audio ? esc(short(rec.audio.name.replace(/\.[a-z0-9]+$/i, ''))) : 'Voiceover'}</button>
        <button data-r="play" class="primary" ${rec.shots.length ? '' : 'disabled'}>▶ Play</button>
        <button data-r="video" ${rec.shots.length ? '' : 'disabled'}>Make video</button>
        <button data-r="done">Done</button>
      </div>
      <div class="rpshots">${rec.shots.map((s, i) => `<button data-shot="${i}" class="${i === recSel ? 'on' : ''}${targetRect(s) ? '' : ' gone'}"><b>${i + 1}</b><span>${esc(shotName(s))}</span><small>${(tl[i].end - tl[i].t0).toFixed(1)} s${fxIcons(s)}</small></button>`).join('')}
        <button data-r="add" class="rpadd">+ Shot</button></div>
      <p class="rphint">${rec.shots.length ? `${rec.shots.length} shot${rec.shots.length === 1 ? '' : 's'}, ${totalTime(rec.shots).toFixed(1)} s. ` : ''}Tap a card, section or string to add a shot of it.</p>`;
    recEls.panel.querySelector('.rpshots .on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    recSheet();
    recLayout();
  }
  const fxIcons = s => { const f2 = s.fx || {}, ic = { spot: '◐', circle: '◯', focus: '◎', hl: '▬', under: '_', trace: '〰', tick: '✓', reveal: '↓', kb: '⤢', shake: '≈', flash: '✦' }; const t = Object.keys(ic).filter(k => f2[k]).map(k => ic[k]).join(''); return (t ? ' · ' + t : '') + (s.cap?.text ? ' · “”' : ''); };
  function recSheet() {
    const rec = recNow(), s = rec?.shots[recSel];
    if (!s) { recEls.sheet.hidden = true; return; }
    const isTask = s.k === 'card' && api.store.get(s.tid)?.data.type === 'task';
    const fxOk = k => !((k === 'tick' && !isTask) || (k === 'reveal' && s.k !== 'card') || (k === 'trace' && !['card', 'section', 'string'].includes(s.k)) || (['hl', 'under'].includes(k) && s.k !== 'card'));
    recEls.sheet.innerHTML = `
      <div class="rshead"><b>Shot ${recSel + 1}</b><span>${esc(shotName(s))}</span><button data-q="close" aria-label="Close">✕</button></div>
      <div class="rsrow"><span>Stays</span><div class="rsdur"><button data-q="dur-">−</button><b>${(s.dur || 3).toFixed(1)} s</b><button data-q="dur+">+</button></div></div>
      ${recSel ? `<div class="rsrow"><span>Gets there</span><div class="seg rsseg">${Object.entries(TRANS_NAMES).map(([k, n]) => `<button data-trans="${k}" class="${(s.trans || 'glide') === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>` : ''}
      <div class="rsfx">${FX.filter(([k]) => fxOk(k)).map(([k, n]) => `<button data-fx="${k}" class="${s.fx?.[k] ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="rscap"><input data-cap="text" placeholder="Caption (optional)" maxlength="120" value="${esc(s.cap?.text || '')}">
        <div class="seg rsseg"><button data-capstyle="type" class="${(s.cap?.style || 'type') === 'type' ? 'on' : ''}">Typewriter</button><button data-capstyle="lower" class="${s.cap?.style === 'lower' ? 'on' : ''}">Lower third</button></div>
        ${s.cap?.style === 'lower' ? `<input data-cap="sub" placeholder="Second line (optional)" maxlength="80" value="${esc(s.cap?.sub || '')}">` : ''}</div>
      <div class="rsbtns"><button data-q="frame" title="Frame this shot as the board is in the frame now">Use this view</button><button data-q="left" ${recSel ? '' : 'disabled'} aria-label="Earlier">◀</button><button data-q="right" ${recSel < rec.shots.length - 1 ? '' : 'disabled'} aria-label="Later">▶</button><button data-q="from">▶ From here</button><button data-q="del" class="danger">Delete</button></div>`;
    recEls.sheet.hidden = false;
  }
  // The camera's frame: as big as fits above the panel (and the shot's settings).
  function recFrameRect() {
    const W = cork.clientWidth, H = cork.clientHeight, cb = cork.getBoundingClientRect();
    const top = Math.min(...[recEls.panel, recEls.sheet].filter(el => el && !el.hidden).map(el => el.getBoundingClientRect().top)) - cb.top;
    const avail = { x: 12, y: 12, w: W - 24, h: Math.max(80, Math.min(H, top) - 24) };
    const A = recAspect(recNow());
    const w = Math.min(avail.w, avail.h * A), h = w / A;
    return { x: avail.x + (avail.w - w) / 2, y: avail.y + (avail.h - h) / 2, w, h };
  }
  function recLayout() {
    if (!recEls.frame) return;
    host.style.setProperty('--rp-h', recEls.panel.offsetHeight + 8 + 'px');
    const r = recFrameRect();
    // (the whole board, with the frame's edges as a dark border round it, so outside the frame is dimmed)
    const W = cork.clientWidth, H = cork.clientHeight;
    Object.assign(recEls.frame.style, { width: W + 'px', height: H + 'px', borderWidth: `${r.y}px ${W - r.x - r.w}px ${H - r.y - r.h}px ${r.x}px` });
  }
  // Show a shot: the board moved so its frame fills the camera frame.
  function recShow(i, animate = true) {
    const rec = recNow(), s = rec?.shots[i];
    if (!s) return;
    const fr = frameOf(s, recAspect(rec));
    if (!fr) { api.toast('What this shot was of isn’t on the board any more.'); return; }
    const o = recFrameRect(), z = o.w / fr.w;
    const to = { z, x: o.x + o.w / 2 - fr.cx * z, y: o.y + o.h / 2 - fr.cy * z }, from = { ...view };
    cancelAnimationFrame(recTween);
    if (!animate) { view = to; applyView(); return; }
    const t0 = performance.now();
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / 320), e = p * p * (3 - 2 * p);
      const lz = Math.exp(Math.log(from.z) + (Math.log(to.z) - Math.log(from.z)) * e);
      // (the frame's middle on the board, moved smoothly, at the zoom of the moment)
      const fc = { x: (o.x + o.w / 2 - from.x) / from.z, y: (o.y + o.h / 2 - from.y) / from.z };
      const cx = fc.x + (fr.cx - fc.x) * e, cy = fc.y + (fr.cy - fc.y) * e;
      view = { z: lz, x: o.x + o.w / 2 - cx * lz, y: o.y + o.h / 2 - cy * lz }; applyView();
      if (p < 1) recTween = requestAnimationFrame(step); else saveView();
    };
    recTween = requestAnimationFrame(step);
  }
  async function recAdd(k, tid) {
    const rec = recNow();
    if (!rec) return;
    const s = { sid: rid(), k, tid: tid || null, at: { dx: 0, dy: 0, w: 0 }, dur: 3, trans: 'glide', fx: {}, cap: null };
    const A = recAspect(rec);
    if (k === 'view') { const o = recFrameRect(); s.at = { dx: Math.round((o.x + o.w / 2 - view.x) / view.z), dy: Math.round((o.y + o.h / 2 - view.y) / view.z), w: Math.round(o.w / view.z) }; }
    else { const r = targetRect(s); if (!r) return; s.at = frameAround(r, A, k === 'board' ? 1.08 : k === 'section' ? 1.2 : 1.45); }
    if (k === 'string') s.fx.trace = true;
    const at = recSel >= 0 ? recSel + 1 : rec.shots.length;
    rec.shots.splice(at, 0, s);
    recSel = at;
    await saveRec(rec);
    recDraw(); recShow(at);
  }
  // A tap on the board in Record mode: a shot of what was tapped.
  function recTap(kind, id) {
    if (kind === 'string') return recAdd('string', id);
    if (id === key) return recAdd('board');
    return recAdd(isFrame(id) ? 'section' : 'card', id);
  }
  async function recPanelClick(e) {
    const b = e.target.closest('[data-r], [data-shot]');
    if (!b) return;
    const rec = recNow();
    if (b.dataset.shot != null) { const i = +b.dataset.shot; recSel = recSel === i ? -1 : i; recDraw(); if (recSel >= 0) recShow(recSel); return; }
    const r = b.getBoundingClientRect(), a = b.dataset.r;
    if (a === 'done') setRecMode(false);
    else if (a === 'add') menu(r.left, r.top, [
      { label: 'This view (as it is in the frame)', fn: () => recAdd('view') },
      { label: 'The whole board', fn: () => recAdd('board') },
    ], true);
    else if (a === 'aspect') { rec.aspect = rec.aspect === '9:16' ? '16:9' : '9:16'; await saveRec(rec); recDraw(); if (recSel >= 0) recShow(recSel, false); }
    else if (a === 'look') menu(r.left, r.top, Object.entries(LOOKS).map(([k, n]) => ({ label: (rec.look === k ? '✓ ' : '') + n, fn: async () => { rec.look = k; await saveRec(rec); recDraw(); } })), true);
    else if (a === 'pick') menu(r.left, r.top, [
      ...recs().map(x => ({ label: (x.id === recId ? '✓ ' : '') + x.name, fn: () => { recId = x.id; recSel = -1; recDraw(); } })),
      { label: 'New recording', fn: async () => { const n = { id: rid(), name: `Recording ${recs().length + 1}`, aspect: rec.aspect, look: rec.look, audio: null, shots: [] }; await saveRec(n); recId = n.id; recSel = -1; recDraw(); } },
      { label: 'Rename this recording', fn: async () => { const name = prompt('Name this recording', rec.name); if (name?.trim()) { rec.name = name.trim().slice(0, 60); await saveRec(rec); recDraw(); } } },
      { label: 'Delete this recording', danger: true, fn: async () => { if (!confirm(`Delete “${rec.name}”? Its shots go too.`)) return; const left = recs().filter(x => x.id !== rec.id); await api.store.update(key, { recs: left.length ? left : undefined }); if (!left.length) { setRecMode(false); return; } recId = left[0].id; recSel = -1; recDraw(); api.toast('Recording deleted.', 'Undo', async () => { await saveRec(rec); }); } },
    ], true);
    else if (a === 'audio') {
      const pick = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*,.mp3,.m4a,.wav,.aac,.ogg'; input.onchange = async () => { const file = input.files[0]; if (!file) return; try { rec.audio = await api.store.addDoc(file); await saveRec(rec); recDraw(); api.toast('Voiceover added. Tap it again to time the shots to it.'); } catch (err) { api.toast(err.message || String(err)); } }; input.click(); };
      if (!rec.audio) pick();
      else menu(r.left, r.top, [
        { label: 'Time the shots to it (tap along)', fn: () => recPlay('time') },
        { label: 'Use a different voiceover', fn: pick },
        { label: 'Take the voiceover off', danger: true, fn: async () => { rec.audio = null; await saveRec(rec); recDraw(); } },
      ], true);
    }
    else if (a === 'play') recPlay('play');
    else if (a === 'video') recPlay('video');
  }
  async function recSheetClick(e) {
    const rec = recNow(), s = rec?.shots[recSel];
    if (!s) return;
    const b = e.target.closest('[data-q], [data-trans], [data-fx], [data-capstyle]');
    if (!b) return;
    const q = b.dataset.q;
    if (q === 'close') { recSel = -1; recDraw(); return; }
    if (q === 'dur-' || q === 'dur+') s.dur = clamp(Math.round(((s.dur || 3) + (q === 'dur+' ? 0.5 : -0.5)) * 10) / 10, 0.5, 30);
    else if (b.dataset.trans) s.trans = b.dataset.trans;
    else if (b.dataset.fx) { s.fx = { ...(s.fx || {}) }; if (s.fx[b.dataset.fx]) delete s.fx[b.dataset.fx]; else s.fx[b.dataset.fx] = true; }
    else if (b.dataset.capstyle) s.cap = { ...(s.cap || { text: '' }), style: b.dataset.capstyle };
    else if (q === 'frame') {
      const o = recFrameRect(), cx = (o.x + o.w / 2 - view.x) / view.z, cy = (o.y + o.h / 2 - view.y) / view.z, w = o.w / view.z;
      if (s.k === 'view') s.at = { dx: Math.round(cx), dy: Math.round(cy), w: Math.round(w) };
      else { const r = targetRect(s); if (r) s.at = { dx: Math.round(cx - r.x - r.w / 2), dy: Math.round(cy - r.y - r.h / 2), w: Math.round(w) }; }
      api.toast('Shot framed as it is now.');
    }
    else if (q === 'left' || q === 'right') { const j = recSel + (q === 'left' ? -1 : 1); [rec.shots[recSel], rec.shots[j]] = [rec.shots[j], rec.shots[recSel]]; recSel = j; }
    else if (q === 'del') { const was = [...rec.shots]; rec.shots.splice(recSel, 1); recSel = Math.min(recSel, rec.shots.length - 1); await saveRec(rec); recDraw(); api.toast('Shot deleted.', 'Undo', async () => { rec.shots = was; await saveRec(rec); recDraw(); }); return; }
    else if (q === 'from') { recPlay('play', timeline(rec.shots)[recSel]?.t0 || 0); return; }
    await saveRec(rec); recDraw();
  }
  async function recSheetChange(e) {
    const rec = recNow(), s = rec?.shots[recSel], inp = e.target.closest('[data-cap]');
    if (!s || !inp) return;
    s.cap = { style: 'type', ...(s.cap || {}), [inp.dataset.cap]: inp.value.trim() };
    if (!s.cap.text && !s.cap.sub) s.cap = null;
    await saveRec(rec); recDraw();
  }
  async function recPlay(mode, from = 0) {
    const rec = recNow();
    if (!rec?.shots.length) return;
    let audio = null;
    if (rec.audio) { audio = await api.store.docBlob(rec.audio); if (!audio) api.toast('The voiceover isn’t on this device yet, and there’s no signal to fetch it.'); }
    if (mode === 'time' && !audio) return;
    openPlayer({
      prepare: () => recordScene(rec), rec, from, mode, audio, toast: m => api.toast(m),
      saveFile: (blob, name) => (api.saveFile ? api.saveFile(blob, name) : null),
      onTimes: async ends => {
        const tl = timeline(rec.shots);
        let prev = 0;
        rec.shots.forEach((s, i) => { if (ends[i] == null) return; s.dur = clamp(Math.round((ends[i] - prev - tl[i].tr) * 10) / 10, 0.5, 60); prev = ends[i]; });
        await saveRec(rec); recDraw();
        api.toast('Shots timed to the voiceover.');
      },
    });
  }

  // ---------- The board as a picture (for export and print) ----------
  // Drawn from what's on screen: for a moment the board is shown flat (no tilt) at 100%, and each
  // section, card and the banner is copied into SVG: its boxes (fill, borders, corners), its text
  // line by line where the browser put it, its pictures, then the strings on top. (Shadows and
  // decorations like tape aren't copied.)
  // (0.8.0, for a recording) opts: hideLinks (strings left off), hideCards (cards left off, their
  // drawing given back in .cards), collect(ox, oy) (called while the board is flat at 100%, so where
  // things are on screen, less ox, oy, is where they are on the board: its result is given back in .extra)
  async function exportSVG(opts = {}) {
    if (!key || !cork.clientWidth) throw new Error('Open the board first.');
    stopPlay();
    const savedView = { ...view };
    host.classList.add('exporting');
    view = { x: 0, y: 0, z: 1 }; applyView();
    // (every string routed, and none showing its shaping dots)
    selString = null; pop.hidden = true; routeNow = true;
    try { drawLines(); } finally { routeNow = false; }
    const hidden = [];
    for (const id of opts.hideLinks || []) for (const el of lines.querySelectorAll(`[data-sw="${id}"], [data-sl="${id}"]`)) { el.style.display = 'none'; hidden.push(el); }
    const cardsOut = new Map();
    try {
      const cb = cork.getBoundingClientRect(), ox = cb.left, oy = cb.top;
      // Pictures go inside the file (as data), so it stands on its own.
      const pics = new Map();
      for (const img of host.querySelectorAll('.world img[src]')) {
        if (pics.has(img.src)) continue;
        try { const b = await (await fetch(img.src, { mode: 'cors' })).blob(); pics.set(img.src, await dataURL(b)); } catch (e) { pics.set(img.src, null); }
      }
      const fm = document.createElement('canvas').getContext('2d');
      const num = v => parseFloat(v) || 0;
      const clear = c => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c);
      let out = '', x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const grow = (x, y, w, h) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };

      const walk = (el, k, clip) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return '';
        let s = '';
        const op = num(cs.opacity);
        if (op === 0) return '';
        const r = el.getBoundingClientRect(), x = r.left - ox, y = r.top - oy, w = r.width, h = r.height;
        if (el.matches('.scaled')) k *= num(cs.getPropertyValue('--s')) || 1;
        // The box: its fill and borders (each side on its own when they differ).
        if (w && h && !el.matches('.pin, .csize, .fsize, .fpin')) {
          const rad = Math.min(num(cs.borderTopLeftRadius) * k, w / 2, h / 2);
          const fill = cs.backgroundColor;
          const bw = ['Top', 'Right', 'Bottom', 'Left'].map(sd => (cs[`border${sd}Style`] === 'none' ? 0 : num(cs[`border${sd}Width`]) * k));
          const bc = ['Top', 'Right', 'Bottom', 'Left'].map(sd => cs[`border${sd}Color`]);
          const same = bw.every(v => v === bw[0]) && bc.every(c => c === bc[0]);
          if (!clear(fill)) s += `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(rad)}" fill="${fill}"/>`;
          if (same && bw[0] && !clear(bc[0])) s += `<rect x="${f(x + bw[0] / 2)}" y="${f(y + bw[0] / 2)}" width="${f(w - bw[0])}" height="${f(h - bw[0])}" rx="${f(Math.max(0, rad - bw[0] / 2))}" fill="none" stroke="${bc[0]}" stroke-width="${f(bw[0])}"${cs.borderTopStyle === 'dashed' ? ` stroke-dasharray="${f(bw[0] * 3)} ${f(bw[0] * 2)}"` : ''}/>`;
          else if (!same) {
            const sides = [[x, y + bw[0] / 2, x + w, y + bw[0] / 2], [x + w - bw[1] / 2, y, x + w - bw[1] / 2, y + h], [x, y + h - bw[2] / 2, x + w, y + h - bw[2] / 2], [x + bw[3] / 2, y, x + bw[3] / 2, y + h]];
            sides.forEach((l, i) => { if (bw[i] && !clear(bc[i])) s += `<path d="M${f(l[0])} ${f(l[1])}L${f(l[2])} ${f(l[3])}" stroke="${bc[i]}" stroke-width="${f(bw[i])}"/>`; });
          }
        }
        // A list's bullet or number (the browser draws those itself, outside the element).
        if (el.tagName === 'LI' && cs.display === 'list-item' && cs.listStyleType !== 'none' && h) {
          const size = num(cs.fontSize) * k, lh = (num(cs.lineHeight) || num(cs.fontSize) * 1.4) * k;
          if (cs.listStyleType === 'decimal') s += `<text x="${f(x - size * 0.4)}" y="${f(y + lh / 2 + size * 0.35)}" text-anchor="end" font-family="${esc(cs.fontFamily)}" font-size="${f(size)}" fill="${cs.color}">${[...el.parentNode.children].indexOf(el) + 1}.</text>`;
          else s += `<circle cx="${f(x - size * 0.7)}" cy="${f(y + lh / 2)}" r="${f(size * 0.17)}" fill="${cs.color}"/>`;
        }
        if (cs.overflow !== 'visible' || cs.overflowY !== 'visible') clip =clip ? { l: Math.max(clip.l, x), t: Math.max(clip.t, y), r: Math.min(clip.r, x + w), b: Math.min(clip.b, y + h) } : { l: x, t: y, r: x + w, b: y + h };
        if (el.tagName === 'IMG') {
          const d = pics.get(el.src);
          s += d ? `<image href="${d}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="xMidYMid slice"/>` : `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="#3A3A3A"/>`;
          return op < 1 ? `<g opacity="${op}">${s}</g>` : s;
        }
        if (el.tagName.toLowerCase() === 'svg') {
          if (w && h && !el.closest('.pin')) s += `<svg x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" viewBox="${el.getAttribute('viewBox') || `0 0 ${w} ${h}`}" overflow="hidden">${inlineSVG(el)}</svg>`;
          return op < 1 ? `<g opacity="${op}">${s}</g>` : s;
        }
        for (const n of el.childNodes) {
          if (n.nodeType === 1) s += walk(n, k, clip);
          else if (n.nodeType === 3 && n.textContent.trim()) s += textLines(n, cs, k, clip);
        }
        return op < 1 ? `<g opacity="${op}">${s}</g>` : s;
      };

      // A text node, line by line where the browser broke it.
      const textLines = (node, cs, k, clip) => {
        const size = num(cs.fontSize) * k, font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
        fm.font = font;
        const m = fm.measureText('Hg'), asc = m.fontBoundingBoxAscent || size * 0.8, desc = m.fontBoundingBoxDescent || size * 0.2;
        const upper = cs.textTransform === 'uppercase', strike = /line-through/.test(cs.textDecorationLine || cs.textDecoration);
        const lines = [], range = document.createRange(), re = /\S+/g, txt = node.textContent;
        let mt;
        while ((mt = re.exec(txt))) {
          range.setStart(node, mt.index); range.setEnd(node, mt.index + mt[0].length);
          const rr = range.getClientRects()[0];
          if (!rr || !rr.width) continue;
          const wx = rr.left - ox, wy = rr.top - oy;
          if (clip && (wy + rr.height / 2 > clip.b || wx + rr.width / 2 > clip.r + 1)) continue;
          const last = lines[lines.length - 1];
          if (last && Math.abs(last.y - wy) < rr.height / 2) { last.words.push(mt[0]); last.r = wx + rr.width; }
          else lines.push({ x: wx, y: wy, h: rr.height, r: wx + rr.width, words: [mt[0]] });
        }
        let s = '';
        for (const l of lines) {
          const base = l.y + (l.h - (asc + desc)) / 2 + asc;
          let t = l.words.join(' ');
          if (upper) t = t.toUpperCase();
          s += `<text x="${f(l.x)}" y="${f(base)}" font-family="${esc(cs.fontFamily)}" font-size="${f(size)}" font-weight="${cs.fontWeight}"${cs.fontStyle !== 'normal' ? ` font-style="${cs.fontStyle}"` : ''}${num(cs.letterSpacing) ? ` letter-spacing="${f(num(cs.letterSpacing) * k)}"` : ''} fill="${cs.color}" textLength="${f(l.r - l.x)}" lengthAdjust="spacingAndGlyphs">${esc(t)}</text>`;
          if (strike) s += `<path d="M${f(l.x)} ${f(base - size * 0.3)}H${f(l.r)}" stroke="${cs.color}" stroke-width="${f(Math.max(1, size / 14))}"/>`;
          grow(l.x, l.y, l.r - l.x, l.h);
        }
        return s;
      };

      // Sections first (under everything), then cards and the banner.
      for (const el of framesEl.children) { const r = el.getBoundingClientRect(); grow(r.left - ox, r.top - oy, r.width, r.height); out += walk(el, 1, null); }
      for (const el of cardsEl.children) {
        const r = el.getBoundingClientRect(); grow(r.left - ox, r.top - oy, r.width, r.height);
        const tilt = parseFloat(el.style.getPropertyValue('--tilt')) || 0, body = walk(el, 1, null);
        const keepTilt = ['corkboard', 'notebook', 'chalkboard'].includes(look()) && tilt && !el.dataset.banner;
        const one = keepTilt ? `<g transform="rotate(${tilt} ${f(r.left - ox + r.width / 2)} ${f(r.top - oy + r.height / 2)})">${body}</g>` : body;
        if (opts.hideCards?.has(el.dataset.card)) cardsOut.set(el.dataset.card, one); else out += one;
      }
      // Strings on top, with their look written onto each line.
      const strings = host.querySelector('.strings');
      try { const bb = lines.getBBox(); if (bb.width || bb.height) grow(bb.x, bb.y, bb.width, bb.height); } catch (e) {}
      out += `<g>${inlineSVG(strings, true)}</g>`;

      if (x0 === Infinity) throw new Error('There’s nothing on this board yet.');
      const pad = 40;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
      const bgc = getComputedStyle(cork).backgroundColor;
      const tex = look() === 'corkboard' ? cork.style.getPropertyValue('--cork-tex').replace(/^url\(["']?|["']?\)$/g, '') : '';
      const bg = `<rect x="${f(x0)}" y="${f(y0)}" width="${W}" height="${H}" fill="${bgc}"/>` + (tex ? `<defs><pattern id="bt-cork" width="220" height="220" patternUnits="userSpaceOnUse"><image href="${tex}" width="220" height="220"/></pattern></defs><rect x="${f(x0)}" y="${f(y0)}" width="${W}" height="${H}" fill="url(#bt-cork)"/>` : '');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="${f(x0)} ${f(y0)} ${W} ${H}">${bg}${out}</svg>`;
      for (const el of hidden) el.style.display = '';
      const extra = opts.collect ? await opts.collect(ox, oy) : null;
      return { svg, w: W, h: H, x0, y0, bg: bgc, cards: cardsOut, extra };
    } finally {
      for (const el of hidden) el.style.display = '';
      host.classList.remove('exporting');
      view = savedView; applyView();
    }
  }

  // ----- (0.8.1) Find on this board -----
  // The magnifier at the top: type, and what matches stays bright while everything else fades back;
  // ‹ › (or Enter, Shift+Enter) go from one to the next in reading order, and the board glides to each.
  let findQ = '', findHits = [], findAt = 0, findTween = 0;
  const findEl = Object.assign(document.createElement('div'), { className: 'boardfind', hidden: true });
  findEl.innerHTML = `<svg viewBox="0 0 24 24" class="fic"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
    <input type="search" placeholder="Find on this board" autocomplete="off" enterkeyhint="search" aria-label="Find on this board">
    <span class="fcount" aria-live="polite"></span>
    <button data-f="prev" aria-label="Previous match" title="Previous (Shift+Enter)"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
    <button data-f="next" aria-label="Next match" title="Next (Enter)"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
    <button data-f="close" aria-label="Stop finding"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  host.append(findEl);
  const findIn = findEl.querySelector('input'), findBtn = host.querySelector('.bfind');
  function openFind() {
    if (recMode) setRecMode(false);
    if (tying) setTying(false);
    findEl.hidden = false;
    findEl.style.top = (host.querySelector('.boardhead').offsetHeight + 10) + 'px';
    findBtn.classList.add('on');
    findIn.focus(); findIn.select();
    if (findIn.value.trim()) runFind(findIn.value);
  }
  function closeFind() {
    findEl.hidden = true; findQ = ''; findHits = []; findAt = 0;
    findBtn.classList.remove('on');
    markFind();
  }
  // jump: go to the first match (as you type); otherwise (the board was drawn again) stay on the one you're on.
  function runFind(q, jump = true) {
    const was = findHits[findAt];
    findQ = q.trim();
    const ts = terms(findQ);
    findHits = !ts.length ? [] : [...frames, ...cards]
      .filter(r => matchItem(r, api.titleOf(r), ts))
      .map(r => ({ id: r.id, b: rectOf(r.id) })).filter(x => x.b)
      .sort((a, b) => (Math.round(a.b.y / 140) - Math.round(b.b.y / 140)) || (a.b.x - b.b.x))
      .map(x => x.id);
    findAt = jump ? 0 : Math.max(0, findHits.indexOf(was));
    markFind();
    if (jump && findHits.length) findGo(0);
  }
  function markFind() {
    host.classList.toggle('finding', !!findQ);
    const set = new Set(findHits), now = findHits[findAt];
    for (const el of [...cardsEl.children, ...framesEl.children]) {
      const id = el.dataset.card || el.dataset.frame;
      el.classList.toggle('fhit', set.has(id));
      el.classList.toggle('fnow', !!findQ && id === now);
    }
    findEl.querySelector('.fcount').textContent = !findQ ? '' : findHits.length ? `${findAt + 1} of ${findHits.length}` : 'None';
    findEl.classList.toggle('none', !!findQ && !findHits.length);
  }
  function findGo(i) {
    if (!findHits.length) return;
    findAt = (i + findHits.length) % findHits.length;
    markFind();
    const b = rectOf(findHits[findAt]);
    if (!b) return;
    // Close enough to read (or the whole of it, if it's big), in the middle of what's left of the screen.
    const W = cork.clientWidth, H = cork.clientHeight, top = findEl.offsetTop + findEl.offsetHeight - cork.offsetTop + 10, bottom = 70;
    const z = clamp(Math.min(Math.max(view.z, 0.8), (W - 40) / b.w, (H - top - bottom) / b.h), MIN_Z, MAX_Z);
    const sx = W / 2, sy = top + (H - top - bottom) / 2, from = { ...view }, t0 = performance.now();
    const fc = { x: (sx - from.x) / from.z, y: (sy - from.y) / from.z }, tc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    cancelAnimationFrame(findTween);
    const step = () => {
      const p = Math.min(1, (performance.now() - t0) / 380), e = p * p * (3 - 2 * p);
      const lz = Math.exp(Math.log(from.z) + (Math.log(z) - Math.log(from.z)) * e);
      const cx = fc.x + (tc.x - fc.x) * e, cy = fc.y + (tc.y - fc.y) * e;
      view = { z: lz, x: sx - cx * lz, y: sy - cy * lz }; applyView();
      if (p < 1) findTween = requestAnimationFrame(step); else saveView();
    };
    findTween = requestAnimationFrame(step);
  }
  findBtn.addEventListener('click', () => (findEl.hidden ? openFind() : closeFind()));
  findIn.addEventListener('input', () => runFind(findIn.value));
  findIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); findGo(findAt + (e.shiftKey ? -1 : 1)); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
  });
  findEl.addEventListener('click', e => {
    const f = e.target.closest('[data-f]')?.dataset.f;
    if (f === 'prev') findGo(findAt - 1);
    else if (f === 'next') findGo(findAt + 1);
    else if (f === 'close') closeFind();
  });

  return {
    exportSVG,
    find: openFind,
    show(boardKey) {
      if (boardKey !== key) {
        if (recMode) setRecMode(false);
        if (!findEl.hidden) closeFind();
        key = boardKey;
        tipToken++; hideTip();
        heights.clear();
        tying = false; tieFrom = null; host.classList.remove('tying');
        stopPlay();
        const saved = readLocal('bt-view:' + key, null);
        if (saved) { view = saved; needsFit = false; } else needsFit = true;
        applyView();
      }
      render();
    },
    refresh: render,
    redrawStrings: drawLines,
    routeStrings: () => { routeCache = null; routeNow = true; try { drawLines(); } finally { routeNow = false; } },
    shownStrings: () => shown,
    routedBranches: () => [...(routeMap || new Map())].filter(([k]) => k.includes('+')).map(([k, v]) => ({ k, d: v.s.d })),
    tipTried: () => tipTried,
    get key() { return key; },
  };
}

// ---------- Note bodies on cards ----------

// The note as it reads on a card: text, lists and checklists (tickable), links as plain text.
// Its first photo, clip or drawing ("media") becomes the card's picture; any others are counted.
// Remembered, since boards redraw often.
const bodyCache = new Map();
function cardBody(html) {
  if (!html) return { html: '', media: null, minis: [], docs: [], more: '' };
  if (bodyCache.has(html)) return bodyCache.get(html);
  const doc = new DOMParser().parseFromString('<body>' + sanitize(html) + '</body>', 'text/html');
  const b = doc.body;
  let media = null;
  const extra = { photo: 0, clip: 0, draw: 0, sheet: 0, doc: 0, link: 0 };
  // (0.7.9) More photos and files than the first are pinned up too, small, along the bottom (a few;
  // any more are counted). docs: every file in it, for making their pictures.
  const minis = [], docs = [];
  for (const el of b.querySelectorAll('img[data-file], div[data-yt], div[data-draw], div[data-sheet], div[data-doc], div[data-weblink]')) {
    const m = el.tagName === 'IMG' ? { kind: 'photo', id: el.getAttribute('data-file') }
      : el.hasAttribute('data-yt') ? { kind: 'clip', clip: clipOf(el) }
      : el.hasAttribute('data-sheet') ? { kind: 'sheet', sheet: cleanSheet(el.getAttribute('data-sheet')) }
      : el.hasAttribute('data-doc') ? { kind: 'doc', doc: docInfo(el) }
      : el.hasAttribute('data-weblink') ? { kind: 'link', link: linkInfo(el) }
      : { kind: 'draw', d: cleanDrawing(el.getAttribute('data-draw')) };
    if (m.doc) docs.push(m.doc);
    if (!media && (m.id || m.clip || m.d || m.sheet || m.doc || m.link)) media = m;
    else if (minis.length < 4 && (m.id || (m.doc && m.doc.pv !== 'off' && previewKind(m.doc)))) minis.push(m);
    else extra[m.kind]++;
  }
  for (const el of b.querySelectorAll('img, div[data-yt], div[data-draw], div[data-sheet], div[data-doc], div[data-weblink]')) el.remove();
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
  const out = b.textContent.trim() || b.querySelector('li') ? b.innerHTML.trim() : '';
  const words = { photo: ['photo', 'photos'], clip: ['clip', 'clips'], draw: ['drawing', 'drawings'], sheet: ['spreadsheet', 'spreadsheets'], doc: ['file', 'files'], link: ['link', 'links'] };
  const more = Object.entries(extra).filter(([, n]) => n).map(([k, n]) => `${n} ${words[k][n === 1 ? 0 : 1]}`).join(', ');
  const res = { html: out, media, minis, docs, more: more ? `+ ${more} more inside` : '' };
  if (bodyCache.size > 400) bodyCache.clear();
  bodyCache.set(html, res);
  return res;
}

// ---------- Helpers ----------

const dataURL = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
// An SVG's insides with the look written onto each element (fill, stroke…), so it's the same
// outside the app. (strings: leaves out the invisible lines that only catch taps)
function inlineSVG(svg, strings = false) {
  const clone = svg.cloneNode(true);
  copyLook([...svg.querySelectorAll('*')], [...clone.querySelectorAll('*')], strings);
  return clone.innerHTML;
}
// (0.8.0) One element of an SVG, with its look written onto it and everything in it (for a recording).
function inlineNode(el) {
  const clone = el.cloneNode(true);
  copyLook([el, ...el.querySelectorAll('*')], [clone, ...clone.querySelectorAll('*')], true);
  return clone.outerHTML;
}
function copyLook(src, dst, strings) {
  dst.forEach((d, i) => {
    const s = src[i], cs = getComputedStyle(s);
    if (strings && (s.classList.contains('hit') || s.classList.contains('live'))) { d.remove(); return; }
    if (cs.display === 'none') { d.remove(); return; }   // (0.8.0: what's not showing stays out)
    for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing']) {
      const v = cs.getPropertyValue(p);
      if (p === 'fill' || p === 'stroke' || (v && v !== 'none' && v !== 'normal')) d.setAttribute(p, v);
    }
    if (cs.textTransform === 'uppercase' && s.tagName.toLowerCase() === 'text') d.textContent = d.textContent.toUpperCase();
    d.removeAttribute('class'); d.removeAttribute('style'); d.removeAttribute('data-link');
  });
}

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
