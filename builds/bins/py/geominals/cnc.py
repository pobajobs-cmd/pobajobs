"""CNC router output: plain G-code for GRBL / FluidNC and Marlin machines
(V1 Engineering MPCNC / LowRider / Primo, Shapeoko-style GRBL boards...).

Three jobs:
* profile  - cut shapes out of a sheet (tool offset outside the material,
             holes inside), several depth passes, holding tabs;
* pocket   - clear areas to a depth (concentric passes, then a clean edge);
* carve    - a 3D relief from a height map: flat-bit roughing in levels,
             ball-nose parallel finishing, then the outline cut out.
Plus engrave (follow lines at a shallow depth) for score lines and numbers.

Origin: X0 Y0 = bottom-left corner of the stock / sheet, Z0 = top of the
stock. Units mm. Only straight moves (G0/G1), which every controller runs.

Offsets come from distance fields on a fine grid (0.05-0.2 mm), contoured
with sub-pixel accuracy - no geometry library needed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, fields, asdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi


@dataclass
class CncOpts:
    controller: str = "grbl"        # grbl (GRBL / FluidNC / grblHAL) / marlin (V1 Marlin boards)
    spindle: str = "manual"         # manual (router switched by hand) / m3 (M3/M5 relay or VFD)
    rpm: int = 18000
    pause_start: bool = False       # M0 at the start: "switch the router on"
    tool_d: float = 3.175           # cutting / roughing end mill
    finish_d: float = 3.175         # ball-nose for 3D finishing
    engrave_d: float = 1.0          # V-bit tip or small end mill for engraving
    engrave_depth: float = 0.5
    feed: float = 900.0             # mm/min
    plunge: float = 300.0
    stepdown: float = 1.0           # depth per pass
    stepover: float = 0.4           # fraction of the tool for pockets / roughing
    finish_step: float = 0.5        # mm between ball-nose finishing passes
    safe_z: float = 5.0
    through: float = 0.3            # cut this far into the spoilboard
    allowance: float = 0.5          # roughing leaves this much for the finish pass
    tabs: bool = True
    tab_w: float = 6.0
    tab_h: float = 1.5
    direction: str = "conventional"  # conventional (gentler on light machines) / climb
    work_w: float = 0.0             # machine working area (0 = don't check)
    work_h: float = 0.0
    rapid: float = 3000.0           # for the time estimate


def cnc_opts_from(d: dict) -> CncOpts:
    o = CncOpts()
    for f in fields(CncOpts):
        if d and f.name in d and d[f.name] is not None:
            t = f.type if isinstance(f.type, str) else f.type.__name__
            try:
                v = d[f.name]
                setattr(o, f.name, bool(v) if t == "bool" else int(float(v)) if t == "int"
                        else float(v) if t == "float" else str(v)[:20])
            except (TypeError, ValueError):
                pass
    o.controller = o.controller if o.controller in ("grbl", "marlin") else "grbl"
    o.spindle = o.spindle if o.spindle in ("manual", "m3") else "manual"
    o.direction = o.direction if o.direction in ("conventional", "climb") else "conventional"
    o.tool_d = min(25.0, max(0.3, o.tool_d))
    o.finish_d = min(25.0, max(0.3, o.finish_d))
    o.stepdown = min(20.0, max(0.1, o.stepdown))
    o.stepover = min(0.9, max(0.05, o.stepover))
    o.finish_step = min(5.0, max(0.05, o.finish_step))
    o.feed, o.plunge = max(10.0, o.feed), max(5.0, o.plunge)
    o.safe_z = max(1.0, o.safe_z)
    return o


# ---------------------------------------------------------------- writer
class GWriter:
    def __init__(self, o: CncOpts, title: str, tool: str, stock, notes=()):
        self.o, self.lines = o, []
        self.x = self.y = 0.0
        self.z = o.safe_z
        self.f = None
        self.cut = self.rapid_len = self.plunge_len = 0.0
        self.paths = []                    # for the preview: (kind, [(x, y, z)...])
        self._cur = None
        self.minx = self.miny = 1e9
        self.maxx = self.maxy = -1e9
        self.minz = 0.0
        w, h, t = stock
        c = lambda s: self.lines.append(f"({s})")          # noqa: E731
        c(f"Geominals - {title}")
        c(f"Tool: {tool}")
        c(f"Stock: {w:.1f} x {h:.1f} x {t:.1f} mm")
        c("Origin: X0 Y0 = bottom-left corner of the stock, Z0 = TOP of the stock")
        for n in notes:
            c(n)
        self.lines.append("G21 G90 G17 G94" if o.controller == "grbl" else "G21 G90")
        self.lines.append(f"G0 Z{o.safe_z:.3f}")
        if o.spindle == "m3":
            self.lines.append(f"M3 S{o.rpm}")
            self.lines.append("G4 P3" if o.controller == "grbl" else "G4 S3")
        elif o.pause_start:
            c("Switch the router on, then resume")
            self.lines.append("M0")
        else:
            c("Switch the router on before starting")

    def _feed(self, f):
        if f != self.f:
            self.f = f
            return f" F{f:.0f}"
        return ""

    def rapid_xy(self, x, y):
        if self.z < self.o.safe_z - 1e-6:
            self.lift()
        if abs(x - self.x) > 1e-4 or abs(y - self.y) > 1e-4:
            self.lines.append(f"G0 X{x:.3f} Y{y:.3f}")
            self.rapid_len += math.hypot(x - self.x, y - self.y)
            self.x, self.y = x, y
        self._cur = None

    def lift(self):
        if self.z < self.o.safe_z - 1e-6:
            self.lines.append(f"G0 Z{self.o.safe_z:.3f}")
            self.rapid_len += self.o.safe_z - self.z
            self.z = self.o.safe_z
        self._cur = None

    def down(self, z):
        """Rapid to just above the surface, then plunge."""
        if self.z > 1.0:
            self.lines.append("G0 Z1.000")
            self.rapid_len += self.z - 1.0
            self.z = 1.0
        if z < self.z:
            self.lines.append(f"G1 Z{z:.3f}" + self._feed(self.o.plunge))
            self.plunge_len += self.z - z
            self.z = z
        self.minz = min(self.minz, z)

    def to(self, x, y, z=None):
        z = self.z if z is None else z
        if z < self.z - 1e-6 and abs(x - self.x) < 1e-6 and abs(y - self.y) < 1e-6:
            return self.down(z)
        parts = "G1"
        if abs(x - self.x) > 1e-4:
            parts += f" X{x:.3f}"
        if abs(y - self.y) > 1e-4:
            parts += f" Y{y:.3f}"
        if abs(z - self.z) > 1e-4:
            parts += f" Z{z:.3f}"
        if parts == "G1":
            return
        d = math.sqrt((x - self.x) ** 2 + (y - self.y) ** 2 + (z - self.z) ** 2)
        f = self.o.plunge if z < self.z - 0.05 and math.hypot(x - self.x, y - self.y) < abs(z - self.z) else self.o.feed
        self.lines.append(parts + self._feed(f))
        self.cut += d
        if self._cur is None:
            self._cur = [(self.x, self.y, self.z)]
            self.paths.append(self._cur)
        self._cur.append((x, y, z))
        self.x, self.y, self.z = x, y, z
        self.minx, self.maxx = min(self.minx, x), max(self.maxx, x)
        self.miny, self.maxy = min(self.miny, y), max(self.maxy, y)
        self.minz = min(self.minz, z)

    def comment(self, s):
        self.lines.append(f"({s})")

    def finish(self):
        self.lift()
        if self.o.spindle == "m3":
            self.lines.append("M5")
        self.lines.append("G0 X0 Y0")
        if self.o.controller == "grbl":
            self.lines.append("M2")
        return "\n".join(self.lines) + "\n"

    def minutes(self):
        o = self.o
        return (self.cut / o.feed + self.plunge_len / o.plunge + self.rapid_len / o.rapid) * 1.15


# ---------------------------------------------------------- geometry help
def _grid_res(w, h, fine=0.1, max_px=9e6):
    return max(fine, math.sqrt(max(1.0, w * h) / max_px))


def raster(polys, w, h, res, even_odd=True):
    """Polygons (mm, y down) -> mask on a grid of `res` mm, 1 px border."""
    import cv2
    nx, ny = int(math.ceil(w / res)) + 2, int(math.ceil(h / res)) + 2
    m = np.zeros((ny, nx), np.uint8)
    ps = [np.round((np.asarray(p, np.float64) / res + 0.5) * 16).astype(np.int32) for p in polys if len(p) >= 3]
    if ps:
        cv2.fillPoly(m, ps, 1, lineType=cv2.LINE_8, shift=4)
    return m > 0


class Grid:
    """Maps between array indices of a field and machine mm (y up).
    Pixel (row i, col j) has its centre at x = (j - off + 0.5) * res,
    y = H_mm - (i - off + 0.5) * res."""
    def __init__(self, res, off, H_mm):
        self.res, self.off, self.H = res, off, H_mm

    def to_m(self, cols, rows):
        return np.c_[(cols - self.off + 0.5) * self.res, self.H - (rows - self.off + 0.5) * self.res]

    def to_idx(self, xy):
        xy = np.atleast_2d(xy)
        return xy[:, 0] / self.res + self.off - 0.5, (self.H - xy[:, 1]) / self.res + self.off - 0.5


def loops_at(field, level, g: Grid, outside_high=False):
    """Closed iso-lines of a distance field, in machine mm. The border is
    padded with the field's 'outside' value so the grid edge isn't traced."""
    from skimage import measure
    out = []
    pad = float(field.max()) if outside_high else float(field.min())
    for c in measure.find_contours(np.pad(field, 1, mode="constant", constant_values=pad), level):
        if len(c) < 4 or np.hypot(*(c[0] - c[-1])) > 1e-6:
            continue
        c = measure.approximate_polygon(c, 0.02 / g.res)
        loop = g.to_m(c[:, 1] - 1, c[:, 0] - 1)[:-1]
        if len(loop) >= 3:
            out.append(loop)
    return out


def _area(p):
    return 0.5 * float(np.dot(p[:, 0], np.roll(p[:, 1], -1)) - np.dot(p[:, 1], np.roll(p[:, 0], -1)))


def orient(loop, field, g: Grid, climb, low_is_material=True):
    """Run the loop so the material is on the right (climb, with an M3 /
    clockwise spindle) or on the left (conventional)."""
    from scipy.ndimage import map_coordinates
    q = np.roll(loop, -1, axis=0)
    seg = q - loop
    L = np.linalg.norm(seg, axis=1)
    k = int(np.argmax(L))
    mid = (loop[k] + q[k]) / 2
    t = seg[k] / max(L[k], 1e-9)
    right = np.array([t[1], -t[0]])
    eps = max(g.res * 0.8, 0.05)
    cols, rows = g.to_idx(np.array([mid + right * eps, mid - right * eps]))
    v = map_coordinates(field, [rows, cols], order=1, mode="nearest")
    material_right = (v[0] < v[1]) if low_is_material else (v[0] > v[1])
    return loop if material_right == climb else loop[::-1]


def _start_at(loop, xy):
    i = int(np.argmin(np.hypot(loop[:, 0] - xy[0], loop[:, 1] - xy[1])))
    return np.roll(loop, -i, axis=0)


def _resample(loop, step=1.0):
    q = np.vstack([loop, loop[:1]])
    seg = np.diff(q, axis=0)
    L = np.linalg.norm(seg, axis=1)
    out = []
    for a, d, l in zip(q[:-1], seg, L):
        n = max(1, int(math.ceil(l / step)))
        for j in range(n):
            out.append(a + d * (j / n))
    out.append(q[-1])
    return np.array(out)


def _depths(total, step):
    n = max(1, int(math.ceil(total / step - 1e-6)))
    return [-(total * (i + 1) / n) for i in range(n)]


def _order_loops(loops, inner_first=True):
    """Holes and small pieces first (so parts stay held), then travel-short."""
    import cv2
    info = []
    for i, l in enumerate(loops):
        info.append((abs(_area(l)), i))
    info.sort()
    idx = [i for _, i in info]
    # nearest-neighbour within the area order: process in batches of similar containment level
    contained = []
    for i in idx:
        c = 0
        pt = (float(loops[i][0, 0]), float(loops[i][0, 1]))
        for j in idx:
            if j != i and abs(_area(loops[j])) > abs(_area(loops[i])):
                if cv2.pointPolygonTest(loops[j].astype(np.float32), pt, False) > 0:
                    c += 1
        contained.append((-c, i))
    levels = {}
    for c, i in contained:
        levels.setdefault(c, []).append(i)
    out, pos = [], np.zeros(2)
    for c in sorted(levels):                     # deepest-nested first
        rest = levels[c][:]
        while rest:
            j = min(rest, key=lambda i: float(np.min(np.hypot(*(loops[i] - pos).T))))
            rest.remove(j)
            out.append(j)
            pos = loops[j][0]
    return out


# ------------------------------------------------------------------ jobs
def profile(gw: GWriter, material, res, H_mm, depth, o: CncOpts, label="cut"):
    """Cut round every edge of `material` (bool grid, y down, 1 px border):
    outside its outer edges, inside its holes, `depth` deep with tabs."""
    r = o.tool_d / 2
    d_out = ndi.distance_transform_edt(~material) * res
    d_in = ndi.distance_transform_edt(material) * res
    sdf = (d_out - d_in).astype(np.float32)               # + outside the material
    g = Grid(res, 1, H_mm)
    loops = loops_at(sdf, r, g, outside_high=True)
    if not loops:
        return 0, 0
    loops = [orient(l, sdf, g, o.direction == "climb") for l in loops]
    order = _order_loops(loops)
    zs = _depths(depth, o.stepdown)
    z_tab = -depth + o.tab_h
    n_tabs = 0
    for i in order:
        loop = _start_at(loops[i], (gw.x, gw.y))
        P = float(np.sum(np.linalg.norm(np.diff(np.vstack([loop, loop[:1]]), axis=0), axis=1)))
        k = 0
        if o.tabs and o.tab_h > 0 and P > 40:
            k = int(min(8, max(2, round(P / 140))))
        pts = _resample(loop, 1.0) if k else np.vstack([loop, loop[:1]])
        s = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
        in_tab = np.zeros(len(pts), bool)
        if k:
            half = (o.tab_w + o.tool_d) / 2
            for j in range(k):
                c = (j + 0.5) * P / k
                in_tab |= np.abs(s - c) <= half
            n_tabs += k
        gw.rapid_xy(*pts[0])
        for z in zs:
            gw.down(z) if gw.z > z else None
            for (x, y), tab in zip(pts[1:], in_tab[1:]):
                zz = max(z, z_tab) if (tab and z < z_tab) else z
                gw.to(x, y, zz)
            if gw.z < z - 1e-6 or gw.z > z + 1e-6:
                gw.to(pts[0][0], pts[0][1], z)
        gw.lift()
    return len(order), n_tabs


def pocket(gw: GWriter, region, res, H_mm, depth, o: CncOpts, start_z=0.0):
    """Clear `region` (bool grid, y down, 1 px border) to `depth` below start_z:
    concentric rings from the middle out, every depth pass, finishing on the edge.
    Returns the area (mm2) the tool can't reach."""
    r = o.tool_d / 2
    d_in = (ndi.distance_transform_edt(region) * res).astype(np.float32)
    step = max(res, o.tool_d * o.stepover)
    levels = []
    lv = r
    while lv < float(d_in.max()):
        levels.append(lv)
        lv += step
    if not levels:
        return float(region.sum() * res * res)
    rings = []
    g = Grid(res, 1, H_mm)
    for lv in reversed(levels):                          # inside first
        for loop in loops_at(d_in, lv, g):
            rings.append(orient(loop, d_in, g, o.direction == "climb"))
    reach = ndi.distance_transform_edt(~(d_in >= r)) * res <= r + res
    missed = float((region & ~reach).sum() * res * res)
    for z in _depths(depth, o.stepdown):
        z += start_z
        for loop in rings:
            loop = _start_at(loop, (gw.x, gw.y))
            far = math.hypot(loop[0][0] - gw.x, loop[0][1] - gw.y)
            if gw.z < o.safe_z and far < o.tool_d * 1.05 and gw.z <= z + 1e-6:
                gw.to(loop[0][0], loop[0][1], z)        # step straight across to the next ring
            else:
                gw.rapid_xy(*loop[0])
                gw.down(z)
            for x, y in loop[1:]:
                gw.to(x, y, z)
            gw.to(loop[0][0], loop[0][1], z)
        gw.lift()
    return missed


def engrave(gw: GWriter, lines, H_mm, o: CncOpts):
    """Follow polylines (mm, y down) at the engraving depth."""
    z = -abs(o.engrave_depth)
    pos = np.array([gw.x, gw.y])
    rest = [np.c_[np.asarray(l)[:, 0], H_mm - np.asarray(l)[:, 1]] for l in lines if len(l) >= 2]
    n = 0
    while rest:
        j = min(range(len(rest)), key=lambda i: min(np.hypot(*(rest[i][0] - pos)), np.hypot(*(rest[i][-1] - pos))))
        l = rest.pop(j)
        if np.hypot(*(l[-1] - pos)) < np.hypot(*(l[0] - pos)):
            l = l[::-1]
        if np.hypot(*(l[0] - np.array([gw.x, gw.y]))) > 0.05 or gw.z > z:
            gw.rapid_xy(*l[0])
            gw.down(z)
        for x, y in l[1:]:
            gw.to(x, y, z)
        pos = l[-1]
        n += 1
        gw.lift()
    return n


def _simplify(xs, zs, tol):
    """Douglas-Peucker on a z(x) profile: keep the points needed to stay
    within tol of every original point."""
    n = len(xs)
    keep = np.zeros(n, bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        t = (xs[a + 1:b] - xs[a]) / (xs[b] - xs[a] if xs[b] != xs[a] else 1)
        line = zs[a] + (zs[b] - zs[a]) * t
        err = np.abs(zs[a + 1:b] - line)
        k = int(np.argmax(err))
        if err[k] > tol:
            m = a + 1 + k
            keep[m] = True
            stack += [(a, m), (m, b)]
    return keep


def _ball(R, res):
    k = int(math.ceil(R / res))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1] * res
    d2 = xx ** 2 + yy ** 2
    fp = d2 <= R * R
    st = np.where(fp, np.sqrt(np.maximum(0, R * R - d2)) - R, -1e6)
    return fp, st


def carve(gw_rough: GWriter, gw_fin: GWriter, H, mask, px, T, o: CncOpts, progress=None):
    """3D relief: H = surface height (mm above the stock bottom) on a grid of
    px mm (y down), mask = where the model is. T = stock thickness."""
    Hm = np.where(mask, H, 0).astype(np.float32)
    ny, nx = Hm.shape
    H_mm = ny * px
    # --- roughing with the flat bit, level by level, leaving the allowance
    r = o.tool_d / 2 + 0.75 * px              # a little wider than the bit: paths sit between grid points
    kr = int(math.ceil(r / px))
    disk = np.hypot(*np.mgrid[-kr:kr + 1, -kr:kr + 1]) * px <= r
    P = kr + 2
    hi = ndi.grey_dilation(np.pad(Hm, P), footprint=disk)    # highest surface under the tool
    work = ndi.binary_dilation(np.pad(mask, P), iterations=1)
    g = Grid(px, P, H_mm)
    zs = _depths(T - float(Hm[mask].min()) - o.allowance if mask.any() else 0, o.stepdown)
    for i, z in enumerate(zs):
        if progress:
            progress(f"CNC roughing level {i + 1}/{len(zs)}...")
        free = work & (hi - T + o.allowance <= z + 1e-6)          # tool centre may go here at this level
        if not free.any():
            continue
        d_in = (ndi.distance_transform_edt(free) * px).astype(np.float32)
        step = max(px, o.tool_d * o.stepover)
        lv = px * 0.5
        loops = []
        while lv < float(d_in.max()):
            loops += [orient(l, d_in, g, o.direction == "climb") for l in loops_at(d_in, lv, g)]
            lv += step
        loops.reverse()
        for loop in loops:
            loop = _start_at(loop, (gw_rough.x, gw_rough.y))
            if gw_rough.z < o.safe_z and math.hypot(loop[0][0] - gw_rough.x, loop[0][1] - gw_rough.y) < o.tool_d * 1.05 \
                    and gw_rough.z <= z + 1e-6:
                gw_rough.to(loop[0][0], loop[0][1], z)
            else:
                gw_rough.rapid_xy(*loop[0])
                gw_rough.down(z)
            for x, y in loop[1:]:
                gw_rough.to(x, y, z)
            gw_rough.to(loop[0][0], loop[0][1], z)
        gw_rough.lift()
    # --- finishing with the ball nose: parallel passes along X, zig-zag
    R = o.finish_d / 2
    fp, st = _ball(R + 0.5 * px, px)          # a touch bigger: safe between grid points at steep edges
    k = fp.shape[0] // 2
    tip = ndi.grey_dilation(np.pad(Hm, k + 1), structure=np.where(fp, st, 0), footprint=fp)[k + 1:-k - 1, k + 1:-k - 1]
    tip = np.maximum(tip, 0.0)
    near = ndi.binary_dilation(mask, iterations=int(math.ceil(R / px)) + 1)
    rows = np.arange(0, ny, max(1, int(round(o.finish_step / px))))
    for n_, j in enumerate(rows):
        if progress and n_ % 25 == 0:
            progress(f"CNC finishing pass {n_ + 1}/{len(rows)}...")
        cols = np.flatnonzero(near[j])
        if not len(cols):
            continue
        # contiguous runs only (don't drag across gaps)
        runs = np.split(cols, np.flatnonzero(np.diff(cols) > 1) + 1)
        if n_ % 2:
            runs = [rr[::-1] for rr in runs[::-1]]
        y = H_mm - (j + 0.5) * px
        for rr in runs:
            zz = tip[j, rr] - T
            xs = (rr + 0.5) * px
            keep = _simplify(xs, zz, 0.01)                # fewer points where it's straight, never more than 0.01 mm off
            xs, zz = xs[keep], zz[keep]
            if math.hypot(xs[0] - gw_fin.x, y - gw_fin.y) > o.finish_step * 1.6 or gw_fin.z > zz[0] + 0.5:
                gw_fin.rapid_xy(xs[0], y)
                gw_fin.down(float(zz[0]))
            for x, z in zip(xs, zz):
                gw_fin.to(float(x), y, float(z))
    gw_fin.lift()


# --------------------------------------------------------------- preview
def preview(gws, w, h, path, title=""):
    """Top view of the toolpaths: deeper = darker; one colour per file."""
    cols = [(60, 130, 220), (220, 140, 40), (60, 170, 90), (200, 60, 90)]
    S = 1000 / max(w, h, 1)
    W, Hh = int(w * S) + 20, int(h * S) + 40
    im = Image.new("RGB", (W, Hh), (250, 250, 247))
    d = ImageDraw.Draw(im)
    d.rectangle([10, 30, 10 + w * S, 30 + h * S], outline=(170, 170, 170))
    for gi, gw in enumerate(gws):
        base = np.array(cols[gi % len(cols)])
        zmin = min(-0.1, gw.minz)
        for p in gw.paths:
            if len(p) < 2:
                continue
            a = np.asarray(p)
            if len(a) > 4000:
                a = a[:: int(len(a) / 4000) + 1]
            shade = np.clip(0.35 + 0.65 * (a[:, 2].mean() / zmin), 0.3, 1.0)
            c = tuple(int(v) for v in 255 - (255 - base) * shade)
            d.line([(10 + x * S, 30 + (h - y) * S) for x, y, _ in a], fill=c, width=1)
    d.text((10, 8), title, fill=(40, 40, 40))
    im.save(path)


def write(gw: GWriter, path: Path):
    path.write_text(gw.finish())
    return path.name


def check_area(gw: GWriter, o: CncOpts, warn: list, name: str):
    if o.work_w > 0 and o.work_h > 0 and (gw.maxx > o.work_w + 0.01 or gw.maxy > o.work_h + 0.01):
        warn.append(f"{name}: the job is {gw.maxx:.0f} x {gw.maxy:.0f} mm - bigger than the machine's "
                    f"{o.work_w:.0f} x {o.work_h:.0f} mm working area.")


def describe(o: CncOpts):
    return asdict(o)
