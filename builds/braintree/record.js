// (0.8.0) Record mode: a board as a video. A recording is a list of shots (like keyframes); each
// one is something on the board to look at, how long to stay, how to get there (glide, cut, whip,
// zoom out and in, fade) and what happens while it's there: a spotlight, a circle drawn round it,
// the focus racked onto it, its text highlighted or underlined, its strings traced card to card,
// a to-do ticked, a card dropped in, a slow Ken Burns push, a shake, a flash, a typewriter caption
// or a lower-third title. A film look (true crime, noir) goes over the whole thing.
//
// It's drawn on a canvas, from a picture of the board (board.js makes it: recordScene), so what you
// see playing is exactly what goes in the video file. The video is recorded as it plays (MediaRecorder:
// MP4 where the browser can, WebM otherwise), with the voiceover if there is one.
//
// A recording, kept on the project (data.recs):
//   { id, name, aspect: '9:16' | '16:9', look: 'none' | 'crime' | 'noir', audio: file info | null, shots: [shot] }
// A shot:
//   { sid, k: 'card' | 'section' | 'string' | 'board' | 'view', tid (what it's of: an id, or 'from|to'),
//     at: {dx, dy, w} (the frame: its middle from the thing's middle, and its width; for 'view' dx, dy
//     are the frame's middle on the board), dur (seconds it stays), trans, fx: {spot, circle, focus,
//     hl, under, trace, tick, reveal, kb, shake, flash: true/false}, cap: {text, style: 'type' | 'lower', sub} }

export const TRANS = { glide: 1.1, cut: 0, whip: 0.45, zoom: 1.7, fade: 0.9 };
export const TRANS_NAMES = { glide: 'Glide', cut: 'Cut', whip: 'Whip', zoom: 'Zoom out and in', fade: 'Fade' };
export const FX = [
  ['spot', 'Spotlight'], ['circle', 'Circle it'], ['focus', 'Rack focus'], ['hl', 'Highlight text'], ['under', 'Underline'],
  ['trace', 'Trace strings'], ['tick', 'Tick it'], ['reveal', 'Drop it in'], ['kb', 'Slow push in'], ['shake', 'Shake'], ['flash', 'Flash'],
];
export const LOOKS = { none: 'Plain', crime: 'True crime', noir: 'Noir' };
export const SIZES = { '9:16': [1080, 1920], '16:9': [1920, 1080] };

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const TYPE = '"Courier New", Courier, ui-monospace, monospace';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = p => { p = clamp(p, 0, 1); return p * p * (3 - 2 * p); };
const easeInOut = p => { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
const easeOutBack = p => { p = clamp(p, 0, 1); const c = 1.6; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
const lerp = (a, b, p) => a + (b - a) * p;
const lerpRect = (a, b, p) => ({ x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) });
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// When each shot starts moving (t0), gets there (t1) and ends (end), in seconds.
export function timeline(shots) {
  let t = 0;
  return shots.map((s, i) => {
    const tr = i ? (TRANS[s.trans] ?? TRANS.glide) : 0;
    const o = { ...s, i, t0: t, tr, t1: t + tr, end: t + tr + Math.max(0.5, s.dur || 3) };
    t = o.end;
    return o;
  });
}
export const totalTime = shots => { const tl = timeline(shots); return tl.length ? tl[tl.length - 1].end : 0; };

// ---------- Drawing a frame ----------

// scene (from board.js): { size: [W, H], bg, base: {img, x0, y0, w, h}, shots: [resolved shot],
//   links: Map(id -> {img, box, d, len, label: {img, box} | null}), cards: Map(id -> {img, box, rect}) }
// A resolved shot is a shot plus: frame {cx, cy, w}, rect (what it's of), media (its picture's
// rect, if any), titles (its title's lines), tick (its tick box), links (strings it traces), reveal
// (cards it drops in).
export function makeRenderer(scene, { scale = 1 } = {}) {
  const [W0, H0] = scene.size, W = Math.round(W0 * scale), H = Math.round(H0 * scale);
  const u = Math.min(W, H) / 1080;                       // (screen sizes are for a 1080-wide picture)
  const tl = timeline(scene.shots), total = tl.length ? tl[tl.length - 1].end : 0;
  const canvas = mk(W, H), g = canvas.getContext('2d');
  const tmp = mk(W, H), tg = tmp.getContext('2d');
  // (for a soft focus: the picture made smaller in steps, then bigger again, which blurs it smoothly)
  const steps = [2, 4, 8].map(k => mk(Math.max(2, Math.round(W / k)), Math.max(2, Math.round(H / k))));
  const soft = () => {
    let from = canvas;
    for (const c of steps) { const cg = c.getContext('2d'); cg.imageSmoothingQuality = 'high'; cg.drawImage(from, 0, 0, c.width, c.height); from = c; }
    const back = steps[1].getContext('2d'); back.drawImage(steps[2], 0, 0, steps[1].width, steps[1].height);
    return steps[1];
  };
  // (a dark board gets a highlighter that brightens rather than tints)
  const dark = (() => { const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(scene.bg || ''); return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 < 0.4 : false; })();
  const B = scene.base;
  // The board as one picture, not too big, for wide views (and close ones until their own is ready).
  const k0 = Math.min(2, 2600 / Math.max(B.w, B.h));
  const low = mk(B.w * k0, B.h * k0);
  low.getContext('2d').drawImage(B.img, 0, 0, low.width, low.height);
  // Each shot's own sharper piece of the board, made as it's needed (a few kept).
  const tiles = new Map();
  const tileFor = s => {
    if (tiles.has(s.i)) return tiles.get(s.i);
    const fw = s.frame.w * 1.2, fh = fw * H / W;
    const r = { x: s.frame.cx - fw / 2, y: s.frame.cy - fh / 2, w: fw, h: fh };
    const k = Math.min((W / s.frame.w) * (s.fx.kb ? 1.18 : 1), 4096 / Math.max(r.w, r.h));
    if (k <= k0 * 1.05) { tiles.set(s.i, null); return null; }
    const c = mk(r.w * k, r.h * k), cg = c.getContext('2d');
    cg.fillStyle = scene.bg; cg.fillRect(0, 0, c.width, c.height);
    cg.drawImage(B.img, r.x - B.x0, r.y - B.y0, r.w, r.h, 0, 0, c.width, c.height);
    const t = { c, r, k };
    tiles.set(s.i, t);
    if (tiles.size > 4) for (const key of tiles.keys()) { if (Math.abs(key - s.i) > 1) { tiles.delete(key); break; } }
    return t;
  };
  // Grain: a little noise, shifted every frame.
  const grain = mk(256, 256);
  { const gg = grain.getContext('2d'), d = gg.createImageData(256, 256); let seed = 7; for (let i = 0; i < d.data.length; i += 4) { seed = (seed * 16807) % 2147483647; const v = (seed % 255); d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; } gg.putImageData(d, 0, 0); }

  const shotAt = t => { for (const s of tl) if (t < s.end) return s; return tl[tl.length - 1]; };
  // Where the camera is for a shot as it arrives, and at its end (a slow push in moves it in).
  const camStart = s => ({ cx: s.frame.cx, cy: s.frame.cy, w: s.frame.w });
  const camEnd = s => {
    if (!s.fx.kb) return camStart(s);
    const to = s.media ? { x: s.media.x + s.media.w / 2, y: s.media.y + s.media.h / 2 } : { x: s.frame.cx, y: s.frame.cy };
    return { cx: lerp(s.frame.cx, to.x, 0.5), cy: lerp(s.frame.cy, to.y, 0.5), w: s.frame.w * 0.84 };
  };
  const camHold = (s, t) => { const a = camStart(s), b = camEnd(s), p = smooth((t - s.t1) / Math.max(0.5, s.end - s.t1)); return { cx: lerp(a.cx, b.cx, p), cy: lerp(a.cy, b.cy, p), w: lerp(a.w, b.w, p) }; };

  function camera(t) {
    const s = shotAt(t);
    let cam, blur = null, black = 0;
    if (t >= s.t1 || !s.i) cam = camHold(s, Math.max(t, s.t1));
    else {
      const prev = tl[s.i - 1], a = camEnd(prev), b = camStart(s), p = (t - s.t0) / s.tr;
      if (s.trans === 'fade') { cam = p < 0.5 ? a : b; black = 1 - Math.abs(2 * p - 1); }
      else if (s.trans === 'zoom') {
        const span = Math.max(a.w, b.w, Math.hypot(a.cx - b.cx, (a.cy - b.cy) * W / H) * 1.25 + Math.max(a.w, b.w));
        const mid = { cx: (a.cx + b.cx) / 2, cy: (a.cy + b.cy) / 2, w: span };
        const q = easeInOut(p < 0.5 ? p * 2 : (p - 0.5) * 2), [f, to] = p < 0.5 ? [a, mid] : [mid, b];
        cam = { cx: lerp(f.cx, to.cx, q), cy: lerp(f.cy, to.cy, q), w: Math.exp(lerp(Math.log(f.w), Math.log(to.w), q)) };
      } else {
        const q = easeInOut(p);
        const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy);
        const arc = s.trans === 'glide' ? 1 + 0.45 * Math.sin(Math.PI * clamp(p, 0, 1)) * clamp(dist / (a.w + b.w), 0, 1) : 1;
        cam = { cx: lerp(a.cx, b.cx, q), cy: lerp(a.cy, b.cy, q), w: Math.exp(lerp(Math.log(a.w), Math.log(b.w), q)) * arc };
        if (s.trans === 'whip') { const m = Math.sin(Math.PI * clamp(p, 0, 1)); blur = { dx: (b.cx - a.cx), dy: (b.cy - a.cy), m }; }
      }
    }
    // (a shake as a shot with one arrives)
    if (s.fx.shake && t >= s.t1 && t < s.t1 + 0.6) {
      const d = 1 - (t - s.t1) / 0.6, amp = cam.w * 0.012 * d;
      cam = { ...cam, cx: cam.cx + Math.sin(t * 73) * amp, cy: cam.cy + Math.cos(t * 61) * amp };
    }
    return { cam, s, blur, black };
  }

  // How strongly an effect that sits over a thing (spotlight, focus) shows, and round what: it
  // slides from one thing to the next between shots that both have it.
  function track(t, key) {
    const s = shotAt(t), prev = s.i ? tl[s.i - 1] : null;
    if (t < s.t1 && prev) {
      const p = easeInOut((t - s.t0) / s.tr);
      if (prev.fx[key] && s.fx[key]) return { a: 1, r: lerpRect(prev.rect, s.rect, p) };
      if (prev.fx[key]) return { a: 1 - smooth(p * 1.6), r: prev.rect };
      if (s.fx[key]) return { a: smooth((p - 0.5) * 2), r: s.rect };
      return null;
    }
    if (!s.fx[key]) return null;
    return { a: prev?.fx[key] && s.trans !== 'fade' && s.trans !== 'cut' ? 1 : smooth((t - s.t1) / 0.45), r: s.rect };
  }
  // A drawn-on effect (circle, highlight, underline): how far drawn, and how faded as the next shot comes.
  function drawn(t, s, start, len) {
    const next = tl[s.i + 1];
    const fade = t < s.end ? 1 : next && t < next.t1 ? 1 - smooth((t - s.end) / Math.max(0.2, next.tr * 0.6)) : 0;
    return { p: clamp((t - s.t1 - start) / len, 0, 1), a: fade };
  }

  function render(t, frameNo = 0) {
    t = clamp(t, 0, total);
    const { cam, s, blur, black } = camera(t);
    const S = W / cam.w;
    const toScreen = () => g.setTransform(S, 0, 0, S, W / 2 - cam.cx * S, H / 2 - cam.cy * S);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.fillStyle = scene.bg; g.fillRect(0, 0, W, H);
    toScreen();
    g.imageSmoothingQuality = 'high';
    g.drawImage(low, B.x0, B.y0, B.w, B.h);
    // the sharper pieces for this shot and its neighbours, where they're sharper than the whole
    for (const sh of [tl[s.i - 1], tl[s.i + 1], s]) {
      if (!sh) continue;
      const tile = tileFor(sh);
      if (tile && (sh === s || tile.k > S * 0.55)) g.drawImage(tile.c, tile.r.x, tile.r.y, tile.r.w, tile.r.h);
    }

    // Strings traced so far (a string traced in a shot isn't on the board until then).
    for (const sh of tl) for (const id of sh.links || []) {
      const L = scene.links.get(id);
      if (!L) continue;
      const start = sh.t1 + 0.1, dur = clamp(0.7 + L.len / 700, 0.9, 2.2), p = (t - start) / dur;
      if (p <= 0) continue;
      if (p >= 1) g.drawImage(L.img, L.box.x, L.box.y, L.box.w, L.box.h);
      else {
        tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, W, H);
        tg.setTransform(S, 0, 0, S, W / 2 - cam.cx * S, H / 2 - cam.cy * S);
        tg.drawImage(L.img, L.box.x, L.box.y, L.box.w, L.box.h);
        tg.globalCompositeOperation = 'destination-in';
        tg.lineWidth = 46; tg.lineCap = 'round'; tg.lineJoin = 'round';
        tg.setLineDash([Math.max(0.01, L.len * easeInOut(p)), L.len + 10]);
        tg.stroke(L.path);
        tg.setLineDash([]); tg.globalCompositeOperation = 'source-over';
        g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(tmp, 0, 0); toScreen();
      }
      // its label pops on as the string gets there
      if (L.label && p > 0.75) {
        const q = easeOutBack((p - 0.75) / 0.35), b = L.label.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        g.save(); g.globalAlpha = clamp((p - 0.75) / 0.15, 0, 1); g.translate(cx, cy); g.scale(q, q);
        g.drawImage(L.label.img, -b.w / 2, -b.h / 2, b.w, b.h); g.restore();
      }
    }
    // Cards dropped in (not on the board until their shot).
    for (const sh of tl) for (const id of sh.reveal || []) {
      const C = scene.cards.get(id);
      if (!C) continue;
      const start = sh.t1 + 0.05, p = (t - start) / 0.6;
      if (p <= 0) continue;
      const b = C.box, q = easeOutBack(p), drop = (1 - q) * -70, sc = lerp(1.12, 1, clamp(p * 1.4, 0, 1));
      g.save(); g.globalAlpha = clamp(p * 3, 0, 1);
      g.translate(b.x + b.w / 2, b.y + b.h / 2 + drop); g.scale(sc, sc);
      if (p < 1) { g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = 30 * (1 - p) * S; g.shadowOffsetY = 18 * (1 - p) * S; }
      g.drawImage(C.img, -b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
      // (a camera flash on it, like a polaroid being taken)
      if (p > 0.55 && p < 1.2) { g.save(); g.globalAlpha = 0.85 * (1 - clamp((p - 0.55) / 0.65, 0, 1)); g.fillStyle = '#FFFFFF'; g.fillRect(C.rect.x, C.rect.y, C.rect.w, C.rect.h); g.restore(); }
    }
    // To-dos ticked.
    for (const sh of tl) {
      if (!sh.fx.tick || !sh.tick) continue;
      const p = (t - sh.t1 - 0.55) / 0.5;
      if (p <= 0) continue;
      const r = sh.tick, cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.max(r.w, r.h) / 2 + 1;
      g.save(); g.translate(cx, cy);
      const q = easeOutBack(clamp(p * 1.6, 0, 1));
      g.scale(q, q); g.fillStyle = '#2E9E5B'; g.beginPath(); g.arc(0, 0, rad, 0, Math.PI * 2); g.fill(); g.scale(1 / q, 1 / q);
      g.strokeStyle = '#FFFFFF'; g.lineWidth = rad * 0.32; g.lineCap = 'round'; g.lineJoin = 'round';
      const pts = [[-0.45, 0.02], [-0.12, 0.33], [0.48, -0.32]].map(([x, y]) => [x * rad, y * rad]);
      const seg = clamp((p - 0.2) / 0.6, 0, 1);
      g.beginPath(); g.moveTo(...pts[0]);
      if (seg < 0.4) g.lineTo(lerp(pts[0][0], pts[1][0], seg / 0.4), lerp(pts[0][1], pts[1][1], seg / 0.4));
      else { g.lineTo(...pts[1]); g.lineTo(lerp(pts[1][0], pts[2][0], (seg - 0.4) / 0.6), lerp(pts[1][1], pts[2][1], (seg - 0.4) / 0.6)); }
      g.stroke(); g.restore();
    }
    // Text highlighted with a marker, or underlined.
    for (const sh of [tl[s.i - 1], s]) {
      if (!sh || !sh.titles?.length) continue;
      if (sh.fx.hl) {
        const { p, a } = drawn(t, sh, 0.25, 0.55 * sh.titles.length);
        if (p > 0 && a > 0) {
          g.save(); g.globalAlpha = (dark ? 0.42 : 0.5) * a; g.globalCompositeOperation = dark ? 'screen' : 'multiply'; g.fillStyle = dark ? '#E8C440' : '#FFE14D';
          sh.titles.forEach((r, i) => { const q = clamp(p * sh.titles.length - i, 0, 1); if (q > 0) g.fillRect(r.x - 3, r.y + r.h * 0.12, (r.w + 6) * q, r.h * 0.86); });
          g.restore();
        }
      }
      if (sh.fx.under) {
        const { p, a } = drawn(t, sh, sh.fx.hl ? 0.6 : 0.25, 0.5 * sh.titles.length);
        if (p > 0 && a > 0) {
          g.save(); g.globalAlpha = a; g.strokeStyle = '#E0312B'; g.lineCap = 'round'; g.lineWidth = Math.max(2.5, sh.titles[0].h * 0.14);
          sh.titles.forEach((r, i) => {
            const q = clamp(p * sh.titles.length - i, 0, 1);
            if (q <= 0) return;
            const y = r.y + r.h * 1.02, x0 = r.x - 2, x1 = r.x + r.w + 4;
            g.beginPath(); g.moveTo(x0, y + 1.5);
            for (let k = 1; k <= 12 * q; k++) g.lineTo(lerp(x0, x1, k / 12), y + Math.sin(k * 1.7 + i) * 1.4 - k * 0.12);
            g.stroke();
          });
          g.restore();
        }
      }
      if (sh.fx.circle) {
        const { p, a } = drawn(t, sh, 0.15, 0.75);
        if (p > 0 && a > 0) {
          const r = sh.rect, cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2 + 22, ry = r.h / 2 + 22;
          g.save(); g.globalAlpha = a; g.strokeStyle = '#E0312B'; g.lineCap = 'round'; g.lineJoin = 'round';
          g.lineWidth = Math.max(4, 7 / S * (W / 1080));
          g.shadowColor = 'rgba(0,0,0,0.25)'; g.shadowBlur = 4;
          g.beginPath();
          const n = 64, turns = 1.12 * p, seed = sh.i * 1.3;
          for (let k = 0; k <= n * turns; k++) {
            const th = -Math.PI * 0.6 + (k / n) * Math.PI * 2, wob = 1 + Math.sin(th * 3 + seed) * 0.025 + (k / n) * 0.05;
            const x = cx + Math.cos(th) * rx * wob, y = cy + Math.sin(th) * ry * wob;
            if (k) g.lineTo(x, y); else g.moveTo(x, y);
          }
          g.stroke(); g.restore();
        }
      }
    }

    // Focus racked onto the thing: everything else soft.
    const fo = track(t, 'focus');
    if (fo && fo.a > 0.01) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const blurred = soft();
      g.save();
      g.beginPath(); g.rect(0, 0, W, H);
      const r = rectToScreen(fo.r, cam, S, 14, W, H);
      roundRect(g, r.x, r.y, r.w, r.h, 12 * u);
      g.clip('evenodd');
      g.globalAlpha = fo.a; g.imageSmoothingQuality = 'high'; g.drawImage(blurred, 0, 0, W, H);
      g.restore();
      toScreen();
    }
    // A spotlight on it: everything else dark.
    const sp = track(t, 'spot');
    if (sp && sp.a > 0.01) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      const r = rectToScreen(sp.r, cam, S, 18, W, H);
      g.save(); g.globalAlpha = sp.a;
      g.beginPath(); g.rect(0, 0, W, H); roundRect(g, r.x, r.y, r.w, r.h, 16 * u);
      g.fillStyle = 'rgba(8, 6, 4, 0.68)'; g.fill('evenodd');
      const glow = g.createRadialGradient(r.x + r.w / 2, r.y + r.h / 2, Math.min(r.w, r.h) / 2, r.x + r.w / 2, r.y + r.h / 2, Math.max(r.w, r.h) * 0.9);
      glow.addColorStop(0, 'rgba(255, 240, 200, 0.10)'); glow.addColorStop(1, 'rgba(255, 240, 200, 0)');
      g.beginPath(); roundRect(g, r.x, r.y, r.w, r.h, 16 * u); g.fillStyle = glow; g.fill();
      g.restore();
    }

    // Screen effects.
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (blur && blur.m > 0.05) {
      tg.setTransform(1, 0, 0, 1, 0, 0); tg.globalCompositeOperation = 'copy'; tg.drawImage(canvas, 0, 0); tg.globalCompositeOperation = 'source-over';
      const len = Math.hypot(blur.dx, blur.dy) || 1, dx = blur.dx / len, dy = blur.dy / len, amt = blur.m * 60 * u;
      g.globalAlpha = 0.22;
      for (let k = -2; k <= 2; k++) if (k) g.drawImage(tmp, dx * amt * k / 2, dy * amt * k / 2);
      g.globalAlpha = 1;
    }
    caption(t, s);
    look(frameNo);
    if (s.fx.flash && t >= s.t1 && t < s.t1 + 0.4) { g.fillStyle = `rgba(255,255,255,${0.9 * (1 - (t - s.t1) / 0.4)})`; g.fillRect(0, 0, W, H); }
    if (black > 0) { g.fillStyle = `rgba(0,0,0,${black})`; g.fillRect(0, 0, W, H); }
    return canvas;
  }

  // Words on screen: typed out (typewriter), or a title sliding in at the bottom (lower third).
  function caption(t, s) {
    for (const sh of [tl[s.i - 1], s]) {
      const c = sh?.cap;
      if (!c?.text) continue;
      const next = tl[sh.i + 1];
      const a = t < sh.end ? smooth((t - sh.t1) / 0.25) : next && t < next.t1 ? 1 - smooth((t - sh.end) / 0.35) : 0;
      if (a <= 0 || t < sh.t1) continue;
      g.save(); g.globalAlpha = a;
      if (c.style === 'lower') {
        const p = easeOutBack(clamp((t - sh.t1 - 0.15) / 0.5, 0, 1)), x = lerp(-W * 0.6, 54 * u, p), y = H - (H > W ? 330 : 190) * u;
        g.font = `800 ${58 * u}px ${SANS}`; const tw = g.measureText(c.text).width;
        g.font = `500 ${34 * u}px ${SANS}`; const sw = c.sub ? g.measureText(c.sub).width : 0;
        const bw = Math.min(W - 108 * u, Math.max(tw, sw) + 56 * u);
        g.fillStyle = '#C7231C'; g.fillRect(x, y, 12 * u, c.sub ? 132 * u : 84 * u);
        g.fillStyle = 'rgba(12, 12, 14, 0.82)'; g.fillRect(x + 12 * u, y, bw, c.sub ? 132 * u : 84 * u);
        g.fillStyle = '#FFFFFF'; g.font = `800 ${58 * u}px ${SANS}`; g.fillText(fit(g, c.text, bw - 40 * u), x + 36 * u, y + 62 * u);
        if (c.sub) { g.fillStyle = '#E8C96A'; g.font = `500 ${34 * u}px ${SANS}`; g.fillText(fit(g, c.sub, bw - 40 * u), x + 36 * u, y + 110 * u); }
      } else {
        const n = Math.floor(clamp((t - sh.t1 - 0.25) * 24, 0, c.text.length)), shown = c.text.slice(0, n);
        const size = (H > W ? 54 : 50) * u, maxW = W - 140 * u;
        g.font = `700 ${size}px ${TYPE}`;
        const lines = wrap(g, c.text, maxW), shownLines = wrap(g, shown, maxW, lines);
        const lh = size * 1.3, bh = lines.length * lh + 44 * u, bw = Math.max(...lines.map(l => g.measureText(l).width)) + 60 * u;
        const y = H - (H > W ? 300 : 120) * u - bh, x = (W - bw) / 2;
        g.fillStyle = 'rgba(10, 10, 10, 0.78)'; g.fillRect(x, y, bw, bh);
        g.fillStyle = '#F4F1E6';
        shownLines.forEach((l, i) => g.fillText(l, x + 30 * u, y + 22 * u + size + i * lh));
        if (n < c.text.length || Math.floor(t * 2) % 2) {
          const li = Math.max(0, shownLines.length - 1), lw = g.measureText(shownLines[li] || '').width;
          g.fillRect(x + 30 * u + lw + 4 * u, y + 22 * u + li * lh + size * 0.18, size * 0.55, size * 0.95);
        }
      }
      g.restore();
    }
  }

  function look(frameNo) {
    const L = scene.look;
    if (!L || L === 'none') return;
    g.save();
    // colour drained (all of it for noir), a warm cast for true crime
    g.globalCompositeOperation = 'saturation'; g.globalAlpha = L === 'noir' ? 1 : 0.45; g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
    if (L === 'crime') { g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.12; g.fillStyle = '#C8823A'; g.fillRect(0, 0, W, H); }
    if (L === 'noir') { g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.25; g.fillStyle = '#303030'; g.fillRect(0, 0, W, H); }
    // film grain
    g.globalCompositeOperation = 'overlay'; g.globalAlpha = L === 'noir' ? 0.16 : 0.11;
    const pat = g.createPattern(grain, 'repeat'), ox = (frameNo * 97) % 256, oy = (frameNo * 61) % 256;
    g.translate(-ox, -oy); g.fillStyle = pat; g.fillRect(ox, oy, W, H); g.translate(ox, oy);
    // vignette
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    const vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${L === 'noir' ? 0.72 : 0.6})`);
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.restore();
  }

  return { canvas, render, total, timeline: tl, size: [W, H] };
}

// A board rectangle (with some room round it) where it is on the screen.
function rectToScreen(r, cam, S, pad, W, H) {
  return { x: W / 2 + (r.x - pad - cam.cx) * S, y: H / 2 + (r.y - pad - cam.cy) * S, w: (r.w + pad * 2) * S, h: (r.h + pad * 2) * S };
}
function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function fit(g, s, maxW) { if (g.measureText(s).width <= maxW) return s; while (s && g.measureText(s + '…').width > maxW) s = s.slice(0, -1); return s + '…'; }
// Lines of text no wider than maxW. (like: the same breaks as these lines, for text typed so far)
function wrap(g, text, maxW, like) {
  if (like) { const out = []; let left = text; for (const l of like) { if (!left) break; out.push(left.slice(0, l.length)); left = left.slice(l.length).replace(/^ /, ''); } return out; }
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) { const t = line ? line + ' ' + w : w; if (!line || g.measureText(t).width <= maxW) line = t; else { out.push(line + ' '); line = w; } }
  out.push(line);
  return out.map(l => l);
}

// ---------- Playing, timing and recording (a full-screen player) ----------

// opts: { prepare() -> scene, rec, from (seconds), mode: 'play' | 'time' | 'video', audio (Blob | null),
//   saveFile(blob, name), onTimes(ends: seconds each shot ends), toast(msg) }
export async function openPlayer(opts) {
  const el = document.createElement('div');
  el.className = 'recplayer';
  el.innerHTML = `<div class="rpstage"><p class="rpwait">Getting the board ready…</p></div>
    <div class="rpbar"><button class="rpplay" aria-label="Play or pause">▶</button><input class="rpseek" type="range" min="0" max="1000" value="0" aria-label="Where in the recording"><span class="rptime">0:00</span>
      <button class="rpnext" hidden>Next shot ▸</button><button class="rpclose" aria-label="Close">✕</button></div>`;
  document.body.append(el);
  const stage = el.querySelector('.rpstage'), playBtn = el.querySelector('.rpplay'), seek = el.querySelector('.rpseek'), time = el.querySelector('.rptime'), nextBtn = el.querySelector('.rpnext');
  let closed = false, raf = 0, playing = false, clock = 0, startedAt = 0, audioEl = null, audioUrl = null, ac = null, rec = null, frameNo = 0;
  const close = () => { if (closed) return; closed = true; cancelAnimationFrame(raf); try { rec?.state === 'recording' && rec.stop(); } catch (e) {} audioEl?.pause(); if (audioUrl) URL.revokeObjectURL(audioUrl); ac?.close?.(); el.remove(); };
  el.querySelector('.rpclose').onclick = () => { if (opts.mode === 'video' && rec && !confirm('Stop making the video?')) return; close(); };
  // (an audio context made now, while the tap that opened this still counts: phones need that)
  if (opts.audio && opts.mode === 'video') { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
  let R;
  try {
    const scene = await opts.prepare();
    if (closed) return;
    R = makeRenderer(scene, { scale: opts.mode === 'video' ? 1 : previewScale(scene.size) });
  } catch (e) { close(); opts.toast?.(e.message || String(e)); return; }
  stage.replaceChildren(R.canvas);
  R.canvas.className = 'rpcanvas';
  if (opts.audio) { audioUrl = URL.createObjectURL(opts.audio); audioEl = new Audio(audioUrl); audioEl.preload = 'auto'; }
  const now = () => (audioEl && playing && !audioEl.paused ? audioEl.currentTime : playing ? clock + (performance.now() - startedAt) / 1000 : clock);
  const show = t => { R.render(t, frameNo++); seek.value = String(Math.round(1000 * t / Math.max(0.01, R.total))); time.textContent = `${fmt(t)} / ${fmt(R.total)}`; };
  const loop = () => {
    if (closed) return;
    const t = now();
    show(Math.min(t, R.total));
    if (t >= R.total + (opts.mode === 'video' ? 0.4 : 0)) { pause(); clock = R.total; if (opts.mode === 'video') finishVideo(); else if (opts.mode === 'time') finishTiming(); return; }
    raf = requestAnimationFrame(loop);
  };
  const play = () => {
    if (playing) return;
    if (clock >= R.total - 0.05) clock = 0;
    playing = true; startedAt = performance.now(); playBtn.textContent = '❚❚';
    if (audioEl) { audioEl.currentTime = clock; audioEl.play().catch(() => {}); }
    raf = requestAnimationFrame(loop);
  };
  const pause = () => { if (!playing) return; clock = now(); playing = false; playBtn.textContent = '▶'; audioEl?.pause(); cancelAnimationFrame(raf); };
  playBtn.onclick = () => (playing ? pause() : play());
  R.canvas.onclick = () => { if (opts.mode !== 'video') playing ? pause() : play(); };
  seek.oninput = () => { pause(); clock = (+seek.value / 1000) * R.total; show(clock); };
  clock = clamp(opts.from || 0, 0, R.total);
  show(clock);

  // Timing to a voiceover: it plays, and each tap of "Next shot" ends the shot that's on.
  const ends = [];
  if (opts.mode === 'time') {
    nextBtn.hidden = false; seek.disabled = true;
    nextBtn.onclick = () => {
      const t = now();
      if (!playing) { play(); return; }
      ends.push(t);
      if (ends.length >= R.timeline.length) { pause(); finishTiming(); }
      nextBtn.textContent = ends.length + 1 >= R.timeline.length ? 'End ■' : 'Next shot ▸';
    };
    nextBtn.textContent = 'Start ▶';
    playBtn.hidden = true;
  }
  function finishTiming() {
    if (closed) return;
    const audioEnd = audioEl && Number.isFinite(audioEl.duration) ? audioEl.duration : null;
    if (ends.length < R.timeline.length) ends.push(audioEnd || now());
    close();
    opts.onTimes?.(ends);
  }

  // Making the video: recorded as it plays, at full size, with the voiceover.
  if (opts.mode === 'video') {
    playBtn.hidden = true; seek.disabled = true;
    if (!R.canvas.captureStream || typeof MediaRecorder === 'undefined') { close(); opts.toast?.('This browser can’t make videos. Try Chrome, Edge or Safari.'); return; }
    const stream = R.canvas.captureStream(30);
    if (audioEl && ac) {
      try {
        const src = ac.createMediaElementSource(audioEl), dst = ac.createMediaStreamDestination();
        src.connect(dst); src.connect(ac.destination);
        for (const tr of dst.stream.getAudioTracks()) stream.addTrack(tr);
        await ac.resume?.();
      } catch (e) {}
    }
    const type = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    const chunks = [];
    rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 10_000_000 });
    rec.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = async () => {
      if (!chunks.length) { if (!closed) close(); return; }
      const mime = rec.mimeType || type || 'video/webm', blob = new Blob(chunks, { type: mime });
      const name = `${(opts.rec.name || 'Recording').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Recording'}.${/mp4/.test(mime) ? 'mp4' : 'webm'}`;
      close();
      await opts.saveFile?.(blob, name);
    };
    el.classList.add('making');
    stage.insertAdjacentHTML('beforeend', '<p class="rpnote">Making the video as it plays. Keep this screen open.</p>');
    clock = 0; show(0);
    rec.start(500);
    setTimeout(play, 250);
  } else if (opts.mode !== 'time') play();

  function finishVideo() { try { rec?.requestData?.(); rec?.stop(); } catch (e) { close(); } }
  return { close };
}
// (previews are drawn a bit smaller on a phone, so they play smoothly)
const previewScale = ([w, h]) => clamp((Math.max(innerWidth, innerHeight) * Math.min(2, devicePixelRatio || 1)) / Math.max(w, h), 0.4, 1);
