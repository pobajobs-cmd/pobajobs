// (0.9.7) Seamless textures for the board looks, made once on the device (like the corkboard's):
// a bed of moss, light caustics under water, wooden planks, a pegboard, newsprint, lying snow and
// a nebula. Every one wraps at its edges (its noise and shapes repeat with the tile), so the board
// can tile it with no seams. Each comes back as a data: address, kept for the session.

const cache = new Map();
const rng = seed => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const smooth = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

// Value noise that repeats every S pixels: octaves of lattices n, 2n, 4n…
function noise(S, base, octaves, rnd) {
  const layers = [];
  for (let o = 0, n = base; o < octaves; o++, n *= 2) { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rnd(); layers.push({ n, g, amp: 0.5 ** o }); }
  const total = layers.reduce((a, l) => a + l.amp, 0);
  return (x, y) => {
    let v = 0;
    for (const { n, g, amp } of layers) {
      const fx = (x / S) * n, fy = (y / S) * n, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
      const a = x0 % n, b = (x0 + 1) % n, c = y0 % n, d = (y0 + 1) % n;
      v += amp * mix(mix(g[c * n + a], g[c * n + b], tx), mix(g[d * n + a], g[d * n + b], tx), ty);
    }
    return v / total;
  };
}

function paint(S, fn, opaque = true) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), im = g.createImageData(S, S), p = im.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const [r, gg, b, a = 255] = fn(x, y), i = (y * S + x) * 4;
    p[i] = r; p[i + 1] = gg; p[i + 2] = b; p[i + 3] = opaque ? 255 : a;
  }
  g.putImageData(im, 0, 0);
  return c.toDataURL('image/png');
}

const MAKERS = {
  // A bed of moss: clumps (low noise), fine fronds (high noise), bright tips and dark hollows.
  moss() {
    const S = 320, r = rng(11), lo = noise(S, 5, 3, r), hi = noise(S, 40, 3, r), tip = noise(S, 80, 2, r);
    return paint(S, (x, y) => {
      const v = lo(x, y) * 0.6 + hi(x, y) * 0.4, t = tip(x, y);
      let R = mix(24, 70, v), G = mix(44, 112, v), B = mix(16, 34, v);
      if (t > 0.66) { const k = Math.min(1, (t - 0.66) * 4); R = mix(R, 160, k * 0.7); G = mix(G, 190, k * 0.7); B = mix(B, 80, k * 0.7); }
      if (v < 0.36) { const k = (0.36 - v) * 3; R *= 1 - k * 0.6; G *= 1 - k * 0.6; B *= 1 - k * 0.6; }
      return [R, G, B];
    });
  },
  // Caustics: the bright network sunlight makes through waves (the edges of a wavy cell pattern).
  caustic() {
    const S = 384, r = rng(5), N = 6, pts = [], warp = noise(S, 5, 2, r), warp2 = noise(S, 5, 2, r);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([(i + r()) * S / N, (j + r()) * S / N]);
    const cell = S / N;
    return paint(S, (x, y) => {
      const wx = x + (warp(x, y) - 0.5) * 70, wy = y + (warp2(x, y) - 0.5) * 70;
      const ci = Math.floor(((wx % S) + S) % S / cell), cj = Math.floor(((wy % S) + S) % S / cell);
      let f1 = 1e9, f2 = 1e9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (ci + di + N) % N, jj = (cj + dj + N) % N, [px, py] = pts[jj * N + ii];
        // (the nearest copy of the point, across the tile's edges)
        let dx = ((wx - px) % S + S * 1.5) % S - S / 2, dy = ((wy - py) % S + S * 1.5) % S - S / 2;
        const d = Math.hypot(dx, dy);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      // (soft wavy lines, brighter where they meet, and a faint glow over the cells)
      const e = f2 - f1, k = Math.max(0, 1 - e / 11);
      return [215, 250, 255, Math.round(k ** 2.6 * 130 + Math.max(0, 1 - f1 / (cell * 0.75)) * 10)];
    }, false);
  },
  // Dark wooden planks with grain and a seam between each.
  wood() {
    const S = 256, r = rng(3), grain = noise(S, 2, 3, r), fine = noise(S, 32, 2, r), planks = 4, w = S / planks, tone = [0, 0, 0, 0].map(() => r());
    return paint(S, (x, y) => {
      const k = Math.floor(x / w), lx = x - k * w;
      const g = Math.sin((lx / w * 7 + grain(x * 0.15 + k * 40, y) * 6) * Math.PI * 2) * 0.5 + 0.5;
      const v = 0.55 + tone[k] * 0.25 + g * 0.18 + (fine(x, y) - 0.5) * 0.2;
      let R = 92 * v, G = 62 * v, B = 42 * v;
      if (lx < 1.5 || lx > w - 1.5) { R *= 0.45; G *= 0.45; B *= 0.45; }
      return [R, G, B];
    });
  },
  // Hardboard with holes every 24 px, each with a shadow and a lit lower edge.
  peg() {
    const S = 192, r = rng(9), fib = noise(S, 48, 2, r), mot = noise(S, 6, 2, r), step = 24;
    return paint(S, (x, y) => {
      const v = 0.82 + (mot(x, y) - 0.5) * 0.16 + (fib(x, y) - 0.5) * 0.12;
      let R = 201 * v, G = 169 * v, B = 122 * v;
      const cx = Math.round(x / step) * step, cy = Math.round(y / step) * step, dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d < 3.4) { const lit = (dy + dx) / 6; R = 50 + lit * 30; G = 34 + lit * 22; B = 18 + lit * 14; }
      else if (d < 4.6) { const k = (dy + dx) > 0 ? 1.12 : 0.8; R *= k; G *= k; B *= k; }
      return [R, G, B];
    });
  },
  // Newsprint: grey-cream with grain and the odd fibre.
  paper() {
    const S = 256, r = rng(21), g1 = noise(S, 64, 2, r), g2 = noise(S, 8, 2, r);
    return paint(S, (x, y) => { const v = 1 + (g1(x, y) - 0.5) * 0.07 + (g2(x, y) - 0.5) * 0.05; return [239 * v, 235 * v, 225 * v]; });
  },
  // Lying snow: soft drifts and sparkles (see-through, over the sky).
  snow() {
    const S = 256, r = rng(31), drift = noise(S, 4, 3, r), sp = noise(S, 64, 1, r);
    return paint(S, (x, y) => { const d = drift(x, y), s = sp(x, y); return [255, 255, 255, Math.round(Math.max(0, d - 0.45) * 160 + (s > 0.86 ? (s - 0.86) * 1800 : 0))]; }, false);
  },
  // A faint nebula behind the stars (see-through).
  nebula() {
    const S = 512, r = rng(41), a = noise(S, 3, 4, r), b = noise(S, 4, 4, r);
    return paint(S, (x, y) => { const u = a(x, y), v = b(x, y), k = Math.max(0, u - 0.5) * 2; return [mix(90, 200, v), mix(60, 90, u), mix(180, 255, v), Math.round(k * k * 120)]; }, false);
  },
};

export function texture(name) {
  if (!cache.has(name)) { try { cache.set(name, MAKERS[name]()); } catch (e) { cache.set(name, ''); } }
  return cache.get(name);
}
