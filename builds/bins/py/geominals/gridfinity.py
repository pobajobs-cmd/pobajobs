"""Gridfinity bins and baseplates with cut-outs for scanned tools.

Everything is built as height fields on a fine grid (default 0.5 mm) and
meshed with mesh3d.column_mesh, which keeps the result watertight:

* the underside (feet with the standard 0.8 / 1.8 / 2.15 mm profile, optional
  6 x 2 mm magnet holes) is the bottom height field;
* the top (stacking lip, tool pockets, finger scoops, hollows for loose bits,
  debossed labels) is the top height field.

Layout coordinates are millimetres from the bin's back-left corner, x to the
right and y towards the front (the same way round as the editor shows it).
"""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, asdict, fields
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

from . import toolscan as TS
from .mesh3d import column_mesh, write_stl, write_3mf, preview_image, is_watertight

PITCH = 42.0          # grid
GAP = 0.5             # bins are 0.5 mm smaller than the grid
UNIT_H = 7.0          # height unit
FOOT_H = 4.75         # foot profile height
FOOT_BOTTOM = 0.8     # lower chamfer
FOOT_VERT = 1.8
FOOT_TOP = 2.15       # upper chamfer
CORNER_R = 3.75
MAG_OFF = 13.0        # magnet / screw holes from the cell centre
LIP_H = 4.4
LIP_DROP = 0.6        # solid inserts sit this far below the lip so a stacked bin's feet clear them
FLOOR_ABOVE_FEET = 1.2
PLATE_H = 4.65        # baseplate socket profile (0.7 / 1.8 / 2.15)
COLOURS = ["#6f8fb3", "#c9a227", "#b55d4c", "#5f9e6e", "#8a6bb0"]
ACCENT = "#e8b43a"


class Cancelled(Exception):
    pass


def _tick(progress, msg):
    if progress and progress(msg) is False:
        raise Cancelled()


@dataclass
class BinOpts:
    gx: int = 0                    # grid units across (0 = auto)
    gy: int = 0                    # grid units front to back (0 = auto)
    units: int = 0                 # height in 7 mm units (0 = just deep enough)
    res: float = 0.5               # mm per grid point
    clearance: float = 0.8         # gap round each tool
    spacing: float = 3.0           # wall between pockets when auto-arranging
    lip: bool = True
    magnets: bool = False
    magnet_d: float = 6.5
    magnet_h: float = 2.4
    scoop_d: float = 22.0
    hollows: bool = True           # dig out leftover space for loose bits
    hollow_min: float = 14.0       # narrowest hollow worth having
    hollow_wall: float = 1.6
    hollow_fillet: float = 4.0     # rounded bottom edge so bits slide out
    hollow_depth: float = 0.0      # 0 = as deep as the floor allows
    label: str = ""
    label_pos: str = "front"       # front / back
    label_mm: float = 7.0
    names: bool = True             # tool names engraved in the pocket floors
    max_units: int = 6
    rot45: bool = False            # also try diagonal placements when arranging
    bed_w: float = 256.0           # printer bed, so auto-sized bins still fit
    bed_h: float = 256.0
    screws: bool = False           # 3 mm screw holes above the magnets (screw bins to a baseplate)
    chamfer: float = 0.6           # bevel round the top edge of pockets and hollows
    proud: float = 0.0             # leave tools standing this far above the top, easier to grab
    hollow_grid: float = 0.0       # divide hollows into trays every N mm (0 = one big hollow)
    colour_floor: bool = False     # pocket floors as a second colour (AMS shadow board)
    colour_text: bool = False      # label and names filled flush in a second colour
    accent_mm: float = 0.6
    lid: bool = False              # also make a lid that sits on the stacking lip
    fit_test: bool = True          # thin plate of just the pocket outlines to test the fit first
    paper: bool = True             # 1:1 paper template PDF
    cost_kg: float = 20.0          # filament price per kg for the estimate
    tab: bool = False              # pickup tab on the back that holds a label insert
    tab_w: float = 0.6             # fraction of the bin width
    tab_h: float = 10.0            # how far it stands above the top
    tab_text: str = ""             # text on the label insert (blank = use the bin label)


def opts_from(d: dict) -> BinOpts:
    o = BinOpts()
    for f in fields(BinOpts):
        if f.name in d and d[f.name] is not None:
            v = d[f.name]
            t = f.type if isinstance(f.type, str) else f.type.__name__
            try:
                setattr(o, f.name, bool(v) if t == "bool" else int(float(v)) if t == "int"
                        else float(v) if t == "float" else str(v)[:60])
            except (TypeError, ValueError):
                pass
    o.res = min(1.0, max(0.25, o.res))
    o.max_units = min(10, max(1, o.max_units))
    o.accent_mm = min(2.0, max(0.2, o.accent_mm))
    return o


def estimate(tris_list, volume_mm3, cost_kg=20.0):
    """Rough filament use: 2 walls / 4 top-bottom layers (~0.9 mm skin) plus 15 % infill, PLA."""
    area = 0.0
    for t in tris_list:
        if len(t):
            area += float(np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1).sum() / 2)
    skin = min(volume_mm3, area * 0.9)
    used = skin + 0.15 * max(0.0, volume_mm3 - skin)
    g = used * 1.24 / 1000
    return {"grams": round(g), "cost": round(g * cost_kg / 1000, 2), "solid_cm3": round(volume_mm3 / 1000, 1),
            "hours": round(g / 22.0 + 0.3, 1)}


# ----------------------------------------------------------------- helpers
def _rrect_sdf(X, Y, cx, cy, hw, hh, r):
    qx = np.abs(X - cx) - (hw - r)
    qy = np.abs(Y - cy) - (hh - r)
    out = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)
    return out - r


def _disk(r_px):
    r = max(1, int(round(r_px)))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def _dilate(m, r_px):
    if r_px <= 0.25:
        return m.copy()
    return ndi.distance_transform_edt(~m) <= r_px


def _erode(m, r_px):
    if r_px <= 0.25:
        return m.copy()
    return ndi.distance_transform_edt(m) > r_px


def bin_size(gx, gy):
    return gx * PITCH - GAP, gy * PITCH - GAP


def interior_margin(o: BinOpts) -> float:
    """Distance from the outside edge that pockets must keep clear of."""
    return (LIP_H - 0.7 - FOOT_VERT + 0.7 + LIP_DROP + 1.0) if o.lip else 2.0


TAB_D = 12.0          # pickup tab: depth from the back edge


def back_reserve(o) -> float:
    """Strip along the back kept clear of pockets because the pickup tab overhangs it."""
    return TAB_D + 1.0 if getattr(o, "tab", False) else 0.0


def label_band(o: BinOpts, W, H):
    """(y0, y1) of the strip reserved for the bin label, or None."""
    if not o.label.strip() or o.label_pos not in ("front", "back"):
        return None
    m = interior_margin(o)
    hgt = o.label_mm + 3
    mb = max(m, back_reserve(o))
    return (H - m - hgt, H - m) if o.label_pos == "front" else (mb, mb + hgt)


def pickup_tab(X, Y, W, Zb, tab_w=0.6, tab_h=10.0):
    """A tab rising from the back wall: grab the bin by it. Its sloped front
    face has a 0.8 mm recess that holds a label insert (or a paper label).
    The underside is 45 degrees, so it prints without supports. Returns
    (mask, bottom, top, insert size (w, l))."""
    D = TAB_D
    tw = max(20.0, min(W - 2.0, W * tab_w))
    m = (_rrect_sdf(X, Y, W / 2, D / 2 - 3, tw / 2, D / 2 + 3, 3.0) <= 0) & (Y >= 0)
    yy = np.clip(Y, 0, D)
    z1 = Zb + tab_h - (tab_h - 2.0) * (yy / D)
    z0 = np.minimum(Zb - 6.0 + yy, z1 - 2.0)
    rec = (np.abs(X - W / 2) <= tw / 2 - 3) & (Y >= 1.5) & (Y <= D - 1.5) & m
    z1 = np.where(rec, z1 - 0.8, z1)
    slope = math.sqrt(1 + ((tab_h - 2.0) / D) ** 2)
    return m, z0.astype(np.float32), z1.astype(np.float32), (tw - 6 - 0.4, (D - 3) * slope - 0.4)


def label_insert(text, w, l, res=0.2):
    """Flat label for the tab's recess: 0.8 mm plate, text raised 0.4 mm
    (print it in a contrasting colour, or change filament at 0.8 mm)."""
    nx, ny = max(4, int(round(w / res))), max(4, int(round(l / res)))
    m = np.ones((ny, nx), bool)
    top = np.full((ny, nx), 0.8, np.float32)
    if text.strip():
        txt = text_mask(text.strip(), min(l * 0.62, 9) / res, max_w_px=(w - 3) / res)
        g = _stamp(m.shape, txt, ny // 2 - txt.shape[0] // 2, nx // 2 - txt.shape[1] // 2)
        top[g] = 1.2
    return column_mesh(m, 0.0, top, res)


def add_tab(o, X, Y, W, Htop, mask, r, outdir, stem, text, parts, files, notes, offset):
    """Pickup tab shell (merged into the bin) + label insert. Returns (tris, volume)."""
    Zb = Htop + (LIP_H if o.lip else 0.0)
    tm, t0, t1, (iw, il) = pickup_tab(X, Y, (mask.shape[1]) * r, Zb, o.tab_w, o.tab_h)
    tm &= mask
    tt = column_mesh(tm, t0, t1, r)
    vol = float(((t1 - t0) * tm).sum() * r * r)
    ins = label_insert(text, iw, il) + np.array([offset, 0, 0], np.float32)
    write_stl(outdir / f"{stem}_label_insert.stl", ins, stem + "_label")
    files.append(f"{stem}_label_insert.stl")
    parts.append({"name": "label insert", "file": f"{stem}_label_insert.stl", "colour": "#f2f0e8"})
    notes.append(f"Pickup tab: grab the bin by it. The label insert ({iw:.0f} x {il:.0f} mm) presses into its "
                 "recess - print it in a contrasting colour (or swap filament at 0.8 mm for 2-colour text). "
                 "Bins can't stack on top of a tabbed bin.")
    return tt, vol + float(il * iw * 0.9)


# ------------------------------------------------------------ tool shapes
def _tool_bits(tid, cache):
    if tid not in cache:
        rec, mask, hm = TS.get_tool(tid)
        cache[tid] = (rec, mask, hm)
    return cache[tid]


def _local_grid(item, rec, mask, X, Y):
    """Map grid points to tool-mask pixel coordinates for a placed item."""
    ppm = rec.get("ppm", TS.PPM)
    h, w = mask.shape
    a = math.radians(float(item.get("rot", 0)))
    ca, sa = math.cos(a), math.sin(a)
    dx, dy = X - float(item["x"]), Y - float(item["y"])
    # inverse of world = R(rot) * (local - centre) + pos   (y down, rot clockwise)
    lx = ca * dx + sa * dy
    ly = -sa * dx + ca * dy
    if item.get("mirror"):
        lx = -lx
    return (lx * ppm + w / 2).astype(np.float32), (ly * ppm + h / 2).astype(np.float32)


def place_tool(item, rec, mask, hm, X, Y):
    """The tool's mask (and height map) sampled onto the bin grid."""
    u, v = _local_grid(item, rec, mask, X, Y)
    m = cv2.remap(mask.astype(np.float32), u, v, cv2.INTER_LINEAR, borderValue=0) > 0.5
    hh = None
    if hm is not None:
        hh = cv2.remap(hm.astype(np.float32), u, v, cv2.INTER_LINEAR, borderValue=0) * m
    return m, hh


def tool_depth(rec, hm, mask):
    if hm is not None and mask.any():
        return float(np.percentile(hm[mask], 98))
    return float(rec.get("depth", 10.0))


def scoop_points(rec, mask):
    """Suggested finger-scoop spots (tool-local mm from the centre) on the
    long sides of the tool, where a finger can get under it."""
    ppm = rec.get("ppm", TS.PPM)
    h, w = mask.shape
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return {}
    cx = int(round(xs.mean()))
    out = {}
    # pick the column near the balance point where the tool is narrowest-but-solid,
    # so the scoop lands on a grabbable part (a shaft rather than a fat handle)
    cols = [c for c in range(max(0, cx - int(15 * ppm)), min(w, cx + int(15 * ppm) + 1), max(1, int(ppm)))]
    best = None
    for c in cols:
        col = np.flatnonzero(mask[:, c])
        if len(col) < 2:
            continue
        key = abs(c - cx) / ppm * 0.4 + (col[-1] - col[0]) / ppm * 0.2
        if best is None or key < best[0]:
            best = (key, c, col[0], col[-1])
    if best is None:
        return {}
    _, c, top, bot = best
    out["top"] = [round((c - w / 2) / ppm, 1), round((top - h / 2) / ppm, 1)]
    out["bottom"] = [round((c - w / 2) / ppm, 1), round((bot - h / 2) / ppm, 1)]
    out["left"] = [round((xs.min() - w / 2) / ppm, 1), round((ys[xs == xs.min()].mean() - h / 2) / ppm, 1)]
    out["right"] = [round((xs.max() - w / 2) / ppm, 1), round((ys[xs == xs.max()].mean() - h / 2) / ppm, 1)]
    return out


def _to_world(item, lx, ly):
    a = math.radians(float(item.get("rot", 0)))
    if item.get("mirror"):
        lx = -lx
    return (float(item["x"]) + math.cos(a) * lx - math.sin(a) * ly,
            float(item["y"]) + math.sin(a) * lx + math.cos(a) * ly)


def item_scoops(item, rec, mask, o: BinOpts):
    """World positions (x, y, diameter) of the scoops an item asks for."""
    which = item.get("scoop", "top")
    if which in (None, "", "none"):
        return []
    pts = scoop_points(rec, mask)
    names = ["top", "bottom"] if which == "both" else ["left", "right"] if which == "ends" else [which]
    out = []
    for n in names:
        if n in pts:
            x, y = _to_world(item, *pts[n])
            out.append((x, y, float(item.get("scoop_d") or o.scoop_d)))
    return out


# ------------------------------------------------------------------ text
def text_mask(text, height_px, max_w_px=None):
    """Bold-ish text rendered to a bool mask (rows x cols), cap height ~height_px."""
    size = max(8, int(height_px * 1.35))
    font = TS._font(size)
    im = Image.new("L", (int(size * 0.75 * max(1, len(text))) + 20, int(size * 1.6) + 10), 0)
    d = ImageDraw.Draw(im)
    d.text((10, 5), text, fill=255, font=font, stroke_width=max(0, int(size * 0.04)), stroke_fill=255)
    a = np.asarray(im) > 127
    if not a.any():
        return a[:1, :1]
    ys, xs = np.nonzero(a)
    a = a[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    s = height_px / max(1, a.shape[0])
    if max_w_px and a.shape[1] * s > max_w_px:
        s = max_w_px / a.shape[1]
    nh, nw = max(1, int(round(a.shape[0] * s))), max(1, int(round(a.shape[1] * s)))
    return cv2.resize(a.astype(np.float32), (nw, nh), interpolation=cv2.INTER_AREA) > 0.45


def _stamp(shape, txt, ry, rx):
    """Paste a small mask into an empty canvas at (row, col), clipped to the edges."""
    g = np.zeros(shape, bool)
    th, tw = txt.shape
    a0, b0 = max(0, ry), max(0, rx)
    a1, b1 = min(shape[0], ry + th), min(shape[1], rx + tw)
    if a1 > a0 and b1 > b0:
        g[a0:a1, b0:b1] = txt[a0 - ry:a1 - ry, b0 - rx:b1 - rx]
    return g


# ------------------------------------------------------------ the bin
def _feet_bottom(gx, gy, X, Y, o: BinOpts):
    e = np.full(X.shape, 1e9, np.float32)
    half_b = (PITCH - GAP) / 2 - (FOOT_BOTTOM + FOOT_TOP)
    rb = CORNER_R - (FOOT_BOTTOM + FOOT_TOP)
    for i in range(gx):
        for j in range(gy):
            cx, cy = i * PITCH + (PITCH - GAP) / 2, j * PITCH + (PITCH - GAP) / 2
            e = np.minimum(e, _rrect_sdf(X, Y, cx, cy, half_b, half_b, rb))
    z0 = np.where(e <= 0, 0.0,
                  np.where(e <= FOOT_BOTTOM, e,
                           np.where(e <= FOOT_BOTTOM + FOOT_TOP, FOOT_BOTTOM + FOOT_VERT + (e - FOOT_BOTTOM), FOOT_H)))
    z0 = z0.astype(np.float32)
    if o.magnets:
        r = o.magnet_d / 2
        for i in range(gx):
            for j in range(gy):
                cx, cy = i * PITCH + (PITCH - GAP) / 2, j * PITCH + (PITCH - GAP) / 2
                for sx in (-1, 1):
                    for sy in (-1, 1):
                        hole = (X - cx - sx * MAG_OFF) ** 2 + (Y - cy - sy * MAG_OFF) ** 2 <= r * r
                        z0[hole] = np.maximum(z0[hole], o.magnet_h)
    return z0


def _lip_top(d, Htop, o: BinOpts):
    if not o.lip:
        return np.full(d.shape, Htop, np.float32)
    lip = np.where(d < 0.7, LIP_H - d, (LIP_H - 0.7 - FOOT_VERT + 0.7) - d)
    return (Htop + np.maximum(lip, -LIP_DROP)).astype(np.float32)


def _fit_units(depth_needed, o: BinOpts):
    floor0 = FOOT_H + FLOOR_ABOVE_FEET
    inner = depth_needed + 0.6 + floor0 + (LIP_DROP if o.lip else 0)
    return max(2, int(math.ceil(inner / UNIT_H - 1e-6)))


def make_bin(layout: dict, o: BinOpts, outdir: Path, stem: str = "bin", progress=None) -> dict:
    """Build the bin described by `layout` = {gx, gy, items:[{tool, x, y, rot,
    mirror, depth, shape, scoop}], scoops:[{x, y, d}]} and write STL/3MF."""
    gx = int(layout.get("gx") or o.gx or 2)
    gy = int(layout.get("gy") or o.gy or 2)
    W, H = bin_size(gx, gy)
    r = o.res
    nx, ny = int(round(W / r)), int(round(H / r))
    X, Y = np.meshgrid((np.arange(nx) + 0.5) * r, (np.arange(ny) + 0.5) * r)
    outer = _rrect_sdf(X, Y, W / 2, H / 2, W / 2, H / 2, CORNER_R)
    mask = outer <= 0
    d_in = -outer
    margin = interior_margin(o)
    interior = d_in >= margin
    notes = []
    cache = {}
    _tick(progress, "Placing the tools...")

    # every tool on the grid, and the depth it needs
    placed = []
    deepest = 0.0
    for k, it in enumerate(layout.get("items", [])):
        try:
            rec, tm, hm = _tool_bits(it["tool"], cache)
        except (OSError, KeyError, ValueError):
            notes.append(f"Tool {it.get('tool')} is missing from the library - skipped.")
            continue
        m, hh = place_tool(it, rec, tm, hm, X, Y)
        if not m.any():
            notes.append(f"{rec['name']} is outside the bin - skipped.")
            continue
        m, flat_only = fit_shape(m, it.get("fit", "exact"), r)
        use_shape = hh is not None and it.get("shape", True) and not flat_only
        tdepth = tool_depth(rec, hm, tm) if use_shape else float(rec.get("depth", 10))
        depth = float(it.get("depth") or rec.get("depth") or tdepth)
        depth = max(1.0, depth - o.proud)
        placed.append(dict(it=it, rec=rec, tm=tm, m=m, hh=hh if use_shape else None, tdepth=tdepth, depth=depth))
        deepest = max(deepest, depth)

    units = o.units or int(layout.get("units") or 0) or _fit_units(deepest, o)
    Htop = units * UNIT_H
    Tin = Htop - (LIP_DROP if o.lip else 0.0)
    floor_min = FOOT_H + FLOOR_ABOVE_FEET
    top = _lip_top(d_in, Htop, o)
    z0 = _feet_bottom(gx, gy, X, Y, o)
    rpx = lambda mm: mm / r                               # noqa: E731

    _tick(progress, "Cutting the pockets...")
    pockets = np.zeros(mask.shape, bool)
    for p in placed:
        it, rec, m = p["it"], p["rec"], p["m"]
        pocket = _dilate(m, rpx(o.clearance + float(it.get("extra") or 0)))
        if it.get("islands", True):
            # keep solid islands inside holes in the tool (e.g. a spanner's ring)
            # if they're big enough to survive printing; otherwise fill them
            holes = ndi.binary_fill_holes(pocket) & ~pocket
            if holes.any():
                keep = ndi.binary_opening(holes, structure=_disk(rpx(1.5)))
                pocket = ndi.binary_fill_holes(pocket) & ~keep
        else:
            pocket = ndi.binary_fill_holes(pocket)
        outside = pocket & (~interior | (Y < back_reserve(o)))
        if outside.sum() * r * r > 4:
            notes.append(f"{rec['name']} runs into the bin wall - move it or use a bigger bin.")
        pocket &= mask & (d_in >= 1.2)
        depth = p["depth"]
        if p["hh"] is not None:
            # widen a little more than the clearance, then smooth: the scan's bumps become a
            # clean floor that's never shallower than the tool
            hd = ndi.grey_dilation(p["hh"], footprint=_disk(rpx(o.clearance + 1.0)))
            hd = ndi.gaussian_filter(hd, rpx(0.6))
            fl = Tin - depth + (p["tdepth"] - hd) - 0.4
            fl = np.minimum(fl, Tin - 1.0)
        else:
            fl = np.full(mask.shape, Tin - depth, np.float32)
        short = float((floor_min - fl[pocket]).max()) if pocket.any() else 0.0
        if short > 0.3:
            notes.append(f"{rec['name']}: the bin isn't deep enough - it will stand about {short:.1f} mm "
                         "higher than planned. Add a height unit to sink it fully.")
        fl = np.maximum(fl, floor_min)
        top = np.where(pocket, np.minimum(top, fl), top)
        pockets |= pocket
        p["pocket"] = pocket
        p["floor"] = fl

    # second-colour parts (AMS): bottom/top of each coloured column
    acc = np.zeros(mask.shape, bool)
    acc_lo = np.zeros(mask.shape, np.float32)
    acc_hi = np.zeros(mask.shape, np.float32)
    name_px = np.zeros(mask.shape, bool)

    def acc_fill(g, lo, hi):
        acc[g] = True
        acc_lo[g] = lo[g] if np.ndim(lo) else lo
        acc_hi[g] = hi[g] if np.ndim(hi) else hi

    # tool names engraved in each pocket floor (under the tool, like a shadow board)
    if o.names:
        for p in placed:
            name = (p["it"].get("label") or p["rec"]["name"]).strip()
            if not name:
                continue
            tm, rec, it = p["tm"], p["rec"], p["it"]
            ppm = rec.get("ppm", TS.PPM)
            core = _erode(tm, 2.0 * ppm)
            if core.sum() < (8 * ppm) ** 2 * 0.5:
                continue
            ys, xs = np.nonzero(core)
            prof = core.sum(0)
            span = prof[prof > 0]
            band_mm = min(6.0, float(np.median(span)) / ppm * 0.6) if len(span) else 0
            if band_mm < 3.0:
                continue
            h_, w_ = tm.shape
            lx = ((xs.min() + xs.max()) / 2 - w_ / 2) / ppm
            ly = (float(np.median(ys)) - h_ / 2) / ppm
            wx, wy = _to_world(it, lx, ly)
            txt = text_mask(name, band_mm / r, max_w_px=(xs.max() - xs.min()) / ppm * 0.8 / r)
            th, tw = txt.shape
            ang = float(it.get("rot", 0)) % 180
            if ang > 90:
                ang -= 180
            a = math.radians(ang)
            dx, dy = X - wx, Y - wy
            u = ((math.cos(a) * dx + math.sin(a) * dy) / r + tw / 2).astype(np.float32)
            v = ((-math.sin(a) * dx + math.cos(a) * dy) / r + th / 2).astype(np.float32)
            g = cv2.remap(txt.astype(np.float32), u, v, cv2.INTER_LINEAR, borderValue=0) > 0.5
            cw, _ = place_tool(it, rec, core, None, X, Y)
            g &= cw & p["pocket"] & (top - 0.5 >= floor_min)
            if o.colour_floor:
                name_px |= g                               # left as a gap in the coloured floor
            else:
                top = np.where(g, top - 0.5, top)
                if o.colour_text:
                    acc_fill(g, top, top + 0.5)

    _tick(progress, "Finger scoops...")
    scoops = []
    for p in placed:
        scoops += item_scoops(p["it"], p["rec"], p["tm"], o)
    for s in layout.get("scoops", []):
        scoops.append((float(s["x"]), float(s["y"]), float(s.get("d") or o.scoop_d)))
    scoop_any = np.zeros(mask.shape, bool)
    for sx, sy, sd in scoops:
        R = sd / 2
        dd = np.hypot(X - sx, Y - sy)
        disc = (dd < R) & (d_in >= margin - 0.6)
        if not disc.any():
            continue
        under = pockets & (dd < R * 0.6)
        zf = float(np.percentile(top[under], 30)) if under.any() else max(floor_min, Tin - 12)
        zf = max(zf, floor_min)
        bowl = zf + (Tin - zf) * (1 - np.sqrt(np.clip(1 - (dd / R) ** 2, 0, 1)))
        top = np.where(disc, np.minimum(top, bowl), top)
        scoop_any |= disc

    band = label_band(o, W, H)
    lab_mask = np.zeros(mask.shape, bool)
    if band:
        _tick(progress, "Label...")
        y0, y1 = band
        rows = (Y >= y0) & (Y <= y1)
        clear = rows & interior & ~_dilate(pockets | scoop_any, rpx(1.2))
        cols = np.flatnonzero(clear.any(0))
        if len(cols):
            # longest run of clear columns across the band
            runs, start = [], cols[0]
            for a, b in zip(cols[:-1], cols[1:]):
                if b != a + 1:
                    runs.append((start, a))
                    start = b
            runs.append((start, cols[-1]))
            c0, c1 = max(runs, key=lambda t: t[1] - t[0])
            txt = text_mask(o.label.strip(), rpx(o.label_mm), max_w_px=(c1 - c0) - rpx(4))
            th, tw = txt.shape
            ry0 = int(round(((y0 + y1) / 2) / r)) - th // 2
            rx0 = (c0 + c1) // 2 - tw // 2
            if tw < 6 or th < 4:
                notes.append("No room for the label - leave a strip along the "
                             f"{o.label_pos} or make the bin bigger.")
            else:
                g = _stamp(mask.shape, txt, ry0, rx0) & clear
                top = np.where(g, top - 0.6, top)
                if o.colour_text:
                    acc_fill(g, top, top + 0.6)
                lab_mask[ry0 - 2:ry0 + th + 2, rx0 - 2:rx0 + tw + 2] = True
                if tw * r < len(o.label) * o.label_mm * 0.45:
                    notes.append("Label text was shrunk to fit.")

    hollow = np.zeros(mask.shape, bool)
    if o.hollows:
        _tick(progress, "Hollows for loose bits...")
        free = interior & ~_dilate(pockets | scoop_any, rpx(o.hollow_wall))
        if band:
            free &= ~((Y >= band[0] - 1) & (Y <= band[1] + 1))
        free &= ~_dilate(lab_mask, rpx(1.0))
        hollow = ndi.binary_opening(free, structure=_disk(rpx(o.hollow_min / 2)))
        lab, n = ndi.label(hollow)
        if n:
            sizes = ndi.sum(hollow, lab, range(1, n + 1)) * r * r
            keep = np.isin(lab, 1 + np.flatnonzero(sizes >= o.hollow_min ** 2 * 1.2))
            hollow &= keep
        if hollow.any():
            zf = floor_min if not o.hollow_depth else max(floor_min, Tin - o.hollow_depth)
            f = min(o.hollow_fillet, (Tin - zf) * 0.9)
            dist = ndi.distance_transform_edt(hollow) * r
            t = np.clip(f - dist, 0, f)
            zh = zf + f - np.sqrt(np.maximum(0, f * f - t * t))
            if o.hollow_grid >= 10:
                # divider walls across big hollows: lines every N mm, only where the hollow is wide
                gx_l = np.abs(((X + o.hollow_grid / 2) % o.hollow_grid) - o.hollow_grid / 2) < 0.6
                gy_l = np.abs(((Y + o.hollow_grid / 2) % o.hollow_grid) - o.hollow_grid / 2) < 0.6
                wall = (gx_l | gy_l) & hollow & (dist > 3.0)
                zh = np.where(wall, Tin - 1.0, zh)
            top = np.where(hollow, np.minimum(top, zh), top)
            n_h = int(ndi.label(hollow)[1])
            notes.append(f"{n_h} hollow(s) for loose bits, {Tin - zf:.0f} mm deep.")

    # bevel round pocket and hollow edges: easier to drop tools in, and looks finished
    if o.chamfer > 0:
        cav = pockets | hollow
        dist_out = ndi.distance_transform_edt(~cav) * r
        flat = (top >= Tin - 0.01) & interior & (dist_out < o.chamfer) & ~cav & ~acc
        top = np.where(flat, np.minimum(top, Tin - (o.chamfer - dist_out)), top)

    # second colour on the pocket floors: a thin layer you see when the tool is out
    if o.colour_floor:
        flr = pockets & ~scoop_any & ~acc
        flr &= ~_dilate(~pockets, rpx(0.4))                # keep it off the walls
        t = o.accent_mm
        okp = flr & (top - t >= z0 + 0.6) & ~name_px
        acc_fill(okp, top - t, top.copy())
        top = np.where(okp | (name_px & (top - t >= z0 + 0.6)), top - t, top)

    top = np.maximum(top, z0 + 0.6)
    if o.screws:
        z0 = _screw_holes(gx, gy, X, Y, z0, top)
    _tick(progress, "Meshing...")
    tris = column_mesh(mask, z0, top, r)
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob(f"{stem}*"):
        if old.suffix in (".stl", ".3mf", ".pdf", ".png"):
            old.unlink()
    fn = f"{stem}.stl"
    parts = [{"name": stem, "file": fn, "colour": COLOURS[0]}]
    files = [fn]
    vol = float(((top - z0) * mask).sum() * r * r)
    if o.tab:
        tt, tv = add_tab(o, X, Y, W, Htop, mask, r, outdir, stem, o.tab_text or o.label, parts, files, notes,
                         -(W / 2 + 40))
        tris = np.concatenate([tris, tt])               # overlapping shells: slicers merge them
        vol += tv
    write_stl(outdir / fn, tris, stem)
    bodies = [(stem, tris, COLOURS[0])]
    all_tris = [tris]
    acc &= acc_hi > acc_lo + 0.05
    if acc.any():
        at = column_mesh(acc, acc_lo, acc_hi, r)
        write_stl(outdir / f"{stem}_colour.stl", at, stem + "_colour")
        bodies.append((stem + "_colour", at, ACCENT))
        parts.append({"name": "second colour", "file": f"{stem}_colour.stl", "colour": ACCENT})
        files.append(f"{stem}_colour.stl")
        vol += float(((acc_hi - acc_lo) * acc).sum() * r * r)
        all_tris.append(at)
        notes.append("Two colours: load the .3mf as one object with 2 parts and give 'second colour' "
                     "another filament (the .stl files line up too).")
    write_3mf(outdir / f"{stem}.3mf", bodies)
    files.append(f"{stem}.3mf")
    est = estimate(all_tris, vol, o.cost_kg)
    if o.lid:
        _tick(progress, "Lid...")
        lt, lvol = make_lid_mesh(gx, gy, o)
        lt = lt + np.array([W + 8, 0, 0], np.float32)          # beside the bin in the viewer
        write_stl(outdir / f"{stem}_lid.stl", lt, stem + "_lid")
        parts.append({"name": "lid", "file": f"{stem}_lid.stl", "colour": COLOURS[3]})
        files.append(f"{stem}_lid.stl")
        est_l = estimate([lt], lvol, o.cost_kg)
        est = {k: round(est[k] + est_l[k], 2) for k in est}
    if o.fit_test and placed:
        # 1.6 mm plate with the pocket outlines cut through: prints in minutes, try the tools in it
        ft = column_mesh(mask & ~pockets, 0.0, 1.6, r)
        write_stl(outdir / f"{stem}_fittest.stl", ft, stem + "_fittest")
        files.append(f"{stem}_fittest.stl")
    if o.paper and placed:
        try:
            files += paper_template(mask, pockets | scoop_any, hollow, r, outdir / f"{stem}_template.pdf",
                                    title=f"{stem} - {gx} x {gy} bin, 1:1")
        except Exception as e:  # noqa: BLE001 - nice to have
            notes.append(f"Paper template skipped ({e}).")
    prev = preview_image([np.where(mask, top, 0)] + ([np.where(acc, acc_hi, 0)] if acc.any() else []), r,
                         [COLOURS[0], ACCENT][:1 + bool(acc.any())], 900)
    prev.save(outdir / f"{stem}_preview.png")
    files.append(f"{stem}_preview.png")
    info = {"gx": gx, "gy": gy, "units": units, "height_mm": round(Htop + (LIP_H if o.lip else 0), 1),
            "size_mm": [round(W, 1), round(H, 1)], "tools": len(placed), "scoops": len(scoops),
            "triangles": int(sum(len(t) for t in all_tris)), "notes": notes, "estimate": est,
            "files": files, "part_info": parts, "preview": f"{stem}_preview.png"}
    (outdir / f"{stem}.json").write_text(json.dumps({"layout": layout, "opts": asdict(o), "result": info}))
    return info


def fit_shape(m, fit, r):
    """Pocket outline variants: exact, smooth (fills small notches), hull
    (convex: easiest to drop in), box (rectangle round the tool).
    Returns (mask, flat_floor_only)."""
    if fit == "exact" or not m.any():
        return m, False
    u8 = m.astype(np.uint8)
    if fit == "smooth":
        k = int(round(3.0 / r)) * 2 + 1
        return cv2.morphologyEx(u8, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0, False
    pts = cv2.findNonZero(u8)
    out = np.zeros_like(u8)
    if fit == "hull":
        cv2.fillPoly(out, [cv2.convexHull(pts)], 1)
    else:
        cv2.fillPoly(out, [np.round(cv2.boxPoints(cv2.minAreaRect(pts))).astype(np.int32)], 1)
    return out > 0, True


def _screw_holes(gx, gy, X, Y, z0, top, d=3.0, depth=6.0):
    for i in range(gx):
        for j in range(gy):
            cx, cy = i * PITCH + (PITCH - GAP) / 2, j * PITCH + (PITCH - GAP) / 2
            for sx in (-1, 1):
                for sy in (-1, 1):
                    hole = (X - cx - sx * MAG_OFF) ** 2 + (Y - cy - sy * MAG_OFF) ** 2 <= (d / 2) ** 2
                    z0 = np.where(hole, np.maximum(z0, np.minimum(depth, top - 1.0)), z0)
    return z0


def make_lid_mesh(gx, gy, o: BinOpts, stackable=True):
    """A lid: Gridfinity feet that drop into the bin's stacking lip, a 1.6 mm
    top, and (stackable) a shallow baseplate profile on top so another bin
    can sit on it."""
    W, H = bin_size(gx, gy)
    r = o.res
    nx, ny = int(round(W / r)), int(round(H / r))
    X, Y = np.meshgrid((np.arange(nx) + 0.5) * r, (np.arange(ny) + 0.5) * r)
    mask = _rrect_sdf(X, Y, W / 2, H / 2, W / 2, H / 2, CORNER_R) <= 0
    z0 = _feet_bottom(gx, gy, X, Y, o)
    base = FOOT_H + 1.6
    top = np.full(X.shape, base, np.float32)
    if stackable:
        e = np.full(X.shape, -1e9, np.float32)
        for i in range(gx):
            for j in range(gy):
                cx, cy = i * PITCH + (PITCH - GAP) / 2, j * PITCH + (PITCH - GAP) / 2
                e = np.maximum(e, -_rrect_sdf(X, Y, cx, cy, PITCH / 2, PITCH / 2, 4.0))
        prof = np.where(e <= 0, PLATE_H, np.where(e < 0.7, PLATE_H - e,
                                                  np.where(e < 2.85, 2.15 - (e - 0.7), 0.0)))
        top = top + prof.astype(np.float32)
    if o.screws:
        z0 = _screw_holes(gx, gy, X, Y, z0, top)
    tris = column_mesh(mask, z0, top, r)
    return tris, float(((top - z0) * mask).sum() * r * r)


def paper_template(mask, cut, hollow, r, path: Path, title=""):
    """1:1 outline of the bin on A4 pages (tiled when bigger) to lay the
    tools on before printing anything. Includes a 50 mm check bar."""
    from PIL import ImageFont
    dpi = 200
    ppmm = dpi / 25.4
    pw, ph = 210, 297
    area_w, area_h = pw - 20, ph - 30
    Hm, Wm = mask.shape[0] * r, mask.shape[1] * r
    nx, ny = max(1, math.ceil(Wm / area_w)), max(1, math.ceil(Hm / area_h))
    big = Image.new("L", (int(Wm * ppmm) + 2, int(Hm * ppmm) + 2), 255)
    def edges(m):
        e = m & ~ndi.binary_erosion(m)
        return cv2.resize(e.astype(np.uint8) * 255, big.size, interpolation=cv2.INTER_NEAREST)
    arr = np.asarray(big).copy()
    fillc = cv2.resize((cut & mask).astype(np.uint8), big.size, interpolation=cv2.INTER_NEAREST) > 0
    fillh = cv2.resize((hollow & mask).astype(np.uint8), big.size, interpolation=cv2.INTER_NEAREST) > 0
    arr[fillh] = 225
    arr[fillc] = 200
    for m in (mask, cut & mask, hollow & mask):
        e = cv2.dilate(edges(m), np.ones((3, 3), np.uint8)) > 0
        arr[e] = 0
    big = Image.fromarray(arr)
    pages = []
    font = TS._font(28)
    for j in range(ny):
        for i in range(nx):
            pg = Image.new("L", (int(pw * ppmm), int(ph * ppmm)), 255)
            crop = big.crop((int(i * area_w * ppmm), int(j * area_h * ppmm),
                             int(min(Wm, (i + 1) * area_w) * ppmm), int(min(Hm, (j + 1) * area_h) * ppmm)))
            pg.paste(crop, (int(10 * ppmm), int(20 * ppmm)))
            d = ImageDraw.Draw(pg)
            d.text((int(10 * ppmm), int(5 * ppmm)), f"{title}  -  page {j * nx + i + 1}/{nx * ny} "
                   f"(column {i + 1}, row {j + 1}).  Print at 100% / actual size.", fill=0, font=font)
            y = int((ph - 6) * ppmm)
            d.line([(int(10 * ppmm), y), (int(60 * ppmm), y)], fill=0, width=4)
            for k in range(6):
                x = int((10 + 10 * k) * ppmm)
                d.line([(x, y - 12), (x, y + 12)], fill=0, width=3)
            d.text((int(63 * ppmm), y - 16), "50 mm - check this with a ruler", fill=0, font=font)
            if nx * ny > 1:
                d.rectangle([int(10 * ppmm), int(20 * ppmm), int((10 + area_w) * ppmm), int((20 + area_h) * ppmm)],
                            outline=160, width=2)
            pages.append(pg.convert("RGB"))
    pages[0].save(path, save_all=True, append_images=pages[1:], resolution=dpi)
    return [path.name]


# ------------------------------------------------------------ auto layout
def _footprint(rec, mask, rot, mirror, o: BinOpts, res=1.0, scoop="top", fit="exact", extra=0.0):
    """Occupancy (at `res` mm) of a tool rotated by `rot`, including clearance,
    half the spacing and its scoops. Returns (fp, cx, cy) with the tool centre
    at (cx, cy) in footprint pixels."""
    ppm = rec.get("ppm", TS.PPM)
    h, w = mask.shape
    diag = math.hypot(w, h) / ppm + 2 * (o.clearance + o.spacing / 2) + o.scoop_d + 4
    n = int(math.ceil(diag / res)) | 1
    c = n * res / 2
    X, Y = np.meshgrid((np.arange(n) + 0.5) * res, (np.arange(n) + 0.5) * res)
    item = {"x": c, "y": c, "rot": rot, "mirror": mirror, "scoop": scoop}
    m, _ = place_tool(item, rec, mask, None, X, Y)
    m, _ = fit_shape(m, fit, res)
    fp = _dilate(m, (o.clearance + float(extra or 0) + o.spacing / 2) / res + 0.8)       # +0.8 px: the coarse grid loses a little
    for sx, sy, sd in item_scoops(item, rec, mask, o):
        fp |= np.hypot(X - sx, Y - sy) <= sd / 2 + 1.0       # scoop spills slightly past the pocket
    ys, xs = np.nonzero(fp)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return fp[y0:y1, x0:x1], c / res - x0, c / res - y0


def _fft_free(occ, fp):
    """Positions (top-left) where fp fits without touching occ."""
    from scipy.signal import fftconvolve
    if fp.shape[0] > occ.shape[0] or fp.shape[1] > occ.shape[1]:
        return np.zeros((0, 0), bool)
    hit = fftconvolve(occ.astype(np.float32), fp[::-1, ::-1].astype(np.float32), mode="valid")
    return hit < 0.5


def arrange(items: list, o: BinOpts, gx=0, gy=0, progress=None) -> dict:
    """Pack tools [{tool, qty, scoop, mirror}] into the smallest bin that fits
    (or the given size). Returns a layout for make_bin."""
    cache = {}
    want = []
    for it in items:
        rec, tm, hm = _tool_bits(it["tool"], cache)
        for _ in range(max(1, min(20, int(it.get("qty", 1))))):
            want.append((it, rec, tm))
    if not want:
        raise ValueError("Add some tools first.")
    want.sort(key=lambda t: -t[2].sum() / t[1].get("ppm", TS.PPM) ** 2)
    rots = (0, 90, 180, 270, 45, 135, 225, 315) if o.rot45 else (0, 90, 180, 270)
    fps = {}
    kf = lambda it, rec: (rec["id"], it.get("mirror", False), it.get("scoop", "top"),   # noqa: E731
                          it.get("fit", "exact"), float(it.get("extra") or 0))
    for it, rec, tm in want:
        key = kf(it, rec)
        if key not in fps:
            fps[key] = [(rot,) + _footprint(rec, tm, rot, it.get("mirror", False), o, 1.0, it.get("scoop", "top"),
                                            it.get("fit", "exact"), it.get("extra") or 0) for rot in rots]
    # candidate sizes, smallest area first, squarer first
    if gx and gy:
        sizes = [(gx, gy)]
    else:
        lo = o.max_units
        sizes = sorted(((a, b) for a in range(1, lo + 1) for b in range(1, lo + 1)
                        if (not gx or a == gx) and (not gy or b == gy)),
                       key=lambda s: (s[0] * s[1], abs(s[0] - s[1]), -s[0]))
        bw, bh = sorted((o.bed_w, o.bed_h))
        sizes = [s for s in sizes if sorted(bin_size(*s))[0] <= bw and sorted(bin_size(*s))[1] <= bh]
        need = sum(fps[kf(i, r)][0][1].sum() for i, r, _ in want)
        sizes = [s for s in sizes if (bin_size(*s)[0] - 8) * (bin_size(*s)[1] - 8) >= need * 0.95]
    margin = interior_margin(o) - 0.5

    def pack(sx, sy, skip):
        W, H = bin_size(sx, sy)
        nx, ny = int(W), int(H)
        Xg, Yg = np.meshgrid(np.arange(nx) + 0.5, np.arange(ny) + 0.5)
        d_in = -_rrect_sdf(Xg, Yg, W / 2, H / 2, W / 2, H / 2, CORNER_R)
        wall = d_in < margin - o.spacing / 2                # the spacing half-band may overlap the wall margin
        occ = wall.copy()
        if back_reserve(o):
            occ |= Yg < back_reserve(o) + o.spacing / 2
        band = label_band(o, W, H)
        bandm = np.zeros_like(occ)
        if band:
            bandm = (Yg >= band[0] + o.spacing / 2) & (Yg <= band[1] - o.spacing / 2 + 1)
            occ |= bandm
        placed, left = [], []
        for it, rec, tm in want:
            opts = fps[kf(it, rec)]
            best = None
            for rot, fp, cx, cy in opts:
                free = _fft_free(occ, fp)
                if not free.size or not free.any():
                    continue
                ys, xs = np.nonzero(free)
                score = (ys + fp.shape[0]) * 1000 + xs           # fill rows: lowest bottom edge, then leftmost
                k = int(np.argmin(score))
                cand = (score[k], rot, xs[k], ys[k], fp, cx, cy)
                if best is None or cand[0] < best[0]:
                    best = cand
            if best is None:
                if not skip:
                    return None, None
                left.append({k: it.get(k) for k in ("tool", "scoop", "mirror", "depth", "shape", "fit", "extra")
                             if it.get(k) is not None} | {"name": rec["name"]})
                continue
            _, rot, x0, y0, fp, cx, cy = best
            occ[y0:y0 + fp.shape[0], x0:x0 + fp.shape[1]] |= fp
            placed.append({k: it.get(k) for k in ("fit", "extra", "label") if it.get(k) is not None} |
                          {"tool": rec["id"], "x": float(x0 + cx), "y": float(y0 + cy), "rot": rot,
                           "mirror": bool(it.get("mirror", False)), "scoop": it.get("scoop", "top"),
                           "depth": it.get("depth"), "shape": it.get("shape", True), "name": rec["name"]})
        if placed:
            # centre the group in the bin
            used = occ & ~wall & ~bandm
            ys, xs = np.nonzero(used)
            lo_x = (~wall[ny // 2]).argmax()
            hi_x = nx - (~wall[ny // 2][::-1]).argmax()
            lo_y = max((~wall[:, nx // 2]).argmax(), back_reserve(o) + o.spacing / 2)
            hi_y = ny - (~wall[:, nx // 2][::-1]).argmax()
            if band and o.label_pos == "front":
                hi_y = min(hi_y, band[0] + o.spacing / 2)
            elif band:
                lo_y = max(lo_y, band[1] - o.spacing / 2 + 1)
            sx_ = ((lo_x + hi_x) - (xs.min() + xs.max() + 1)) / 2
            sy_ = ((lo_y + hi_y) - (ys.min() + ys.max() + 1)) / 2
            for p in placed:
                p["x"] = round(p["x"] + sx_, 1)
                p["y"] = round(p["y"] + sy_, 1)
        return placed, left

    for sx, sy in sizes:
        _tick(progress, f"Trying a {sx} x {sy} bin...")
        placed, _ = pack(sx, sy, False)
        if placed is not None:
            return {"gx": sx, "gy": sy, "items": placed, "scoops": [], "leftover": []}
    # too much for one bin: fill the biggest bin allowed and hand back the rest for the next bin
    if gx and gy:
        big = (gx, gy)
    else:
        bw, bh = sorted((o.bed_w, o.bed_h))
        cands = [(a, b) for a in range(1, o.max_units + 1) for b in range(1, o.max_units + 1)
                 if (not gx or a == gx) and (not gy or b == gy)
                 and sorted(bin_size(a, b))[0] <= bw and sorted(bin_size(a, b))[1] <= bh]
        if not cands:
            raise ValueError("No bin size fits the printer bed with those limits.")
        big = max(cands, key=lambda s: (s[0] * s[1], -abs(s[0] - s[1])))
    placed, left = pack(*big, True)
    if not placed:
        raise ValueError("The biggest tool doesn't fit in any bin that fits your bed - tick 'try diagonals' "
                         "or raise the bin/bed limits.")
    return {"gx": big[0], "gy": big[1], "items": placed, "scoops": [], "leftover": left}


# -------------------------------------------------------------- baseplate
def _parse(cls, d: dict, strlen=60):
    o = cls()
    for f in fields(cls):
        if f.name in d and d[f.name] is not None:
            v = d[f.name]
            t = f.type if isinstance(f.type, str) else f.type.__name__
            try:
                setattr(o, f.name, bool(v) if t == "bool" else int(float(v)) if t == "int"
                        else float(v) if t == "float" else str(v)[:strlen])
            except (TypeError, ValueError):
                pass
    if hasattr(o, "res"):
        o.res = min(1.0, max(0.25, o.res))
    return o


PLATE_FLOOR = {"light": 0.0, "solid": 2.6, "magnet": 3.4, "screw": 3.4}


@dataclass
class PlateOpts:
    gx: int = 3
    gy: int = 3
    drawer_w: float = 0.0          # fill a drawer: inside width/depth in mm (0 = just gx x gy)
    drawer_d: float = 0.0
    style: str = "light"           # light / solid / magnet / screw (magnets + countersunk screw per cell)
    magnet_d: float = 6.5
    magnet_h: float = 2.4
    connectors: bool = True        # dog-bone clips joining tiles (solid styles)
    bed_w: float = 256.0
    bed_h: float = 256.0
    res: float = 0.5
    fit: float = 0.5               # leave this much gap to the drawer walls
    cost_kg: float = 20.0


def plate_opts_from(d: dict) -> PlateOpts:
    o = _parse(PlateOpts, d, 20)
    if o.style not in PLATE_FLOOR:
        o.style = "light"
    return o


CLIP_OFF, CLIP_R, CLIP_BAR = 5.0, 3.5, 2.0       # dog-bone: lobes 5 mm each side of the seam


def _dogbone(X, Y, sx, sy, vertical):
    """Dog-bone shape centred on a seam point; vertical seam = lobes left/right."""
    if vertical:
        return ((np.hypot(X - sx - CLIP_OFF, Y - sy) <= CLIP_R) | (np.hypot(X - sx + CLIP_OFF, Y - sy) <= CLIP_R) |
                ((np.abs(Y - sy) <= CLIP_BAR) & (np.abs(X - sx) <= CLIP_OFF)))
    return ((np.hypot(X - sx, Y - sy - CLIP_OFF) <= CLIP_R) | (np.hypot(X - sx, Y - sy + CLIP_OFF) <= CLIP_R) |
            ((np.abs(X - sx) <= CLIP_BAR) & (np.abs(Y - sy) <= CLIP_OFF)))


def make_baseplate(o: PlateOpts, outdir: Path, stem: str = "baseplate", progress=None) -> dict:
    """Baseplate(s) with the standard socket profile, split into tiles that
    fit the printer bed. With a drawer size it fills the drawer: as many whole
    cells as fit, centred, with solid padding out to the walls."""
    notes = []
    if o.drawer_w and o.drawer_d:
        gx = max(1, int((o.drawer_w - 2 * o.fit) // PITCH))
        gy = max(1, int((o.drawer_d - 2 * o.fit) // PITCH))
        tw, th = o.drawer_w - 2 * o.fit, o.drawer_d - 2 * o.fit
    else:
        gx, gy = max(1, o.gx), max(1, o.gy)
        tw, th = gx * PITCH, gy * PITCH
    padx, pady = (tw - gx * PITCH) / 2, (th - gy * PITCH) / 2

    def splits(n, pad, bed):                  # cells per tile so each tile fits the bed (padding on the outer ones)
        per = max(1, int((bed - 2 * pad) // PITCH)) if n * PITCH + 2 * pad > bed else n
        per = max(1, min(per, int(bed // PITCH)))
        k = math.ceil(n / per)
        base, extra = divmod(n, k)
        return [base + (1 if i < extra else 0) for i in range(k)]
    sx, sy = splits(gx, padx, o.bed_w), splits(gy, pady, o.bed_h)
    floor = PLATE_FLOOR[o.style]
    clips = o.connectors and floor >= 2.5 and len(sx) * len(sy) > 1
    recess = floor - 0.8
    r = o.res
    parts, files = [], []
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob(f"{stem}*"):
        if old.suffix in (".stl", ".3mf"):
            old.unlink()
    tris_all, vol, all_t = 0, 0.0, []
    bodies = []
    n_clips = 0
    y_off = 0.0
    for j, cy_n in enumerate(sy):
        x_off = 0.0
        for i, cx_n in enumerate(sx):
            _tick(progress, f"Baseplate tile {j * len(sx) + i + 1}/{len(sx) * len(sy)}...")
            lpad = padx if i == 0 else 0.0
            rpad = padx if i == len(sx) - 1 else 0.0
            tpad = pady if j == 0 else 0.0
            bpad = pady if j == len(sy) - 1 else 0.0
            Wt = cx_n * PITCH + lpad + rpad
            Ht = cy_n * PITCH + tpad + bpad
            nx, ny = int(round(Wt / r)), int(round(Ht / r))
            X, Y = np.meshgrid((np.arange(nx) + 0.5) * r, (np.arange(ny) + 0.5) * r)
            # distance inward from the nearest socket edge (cells 42 mm, corner r 4)
            e = np.full(X.shape, -1e9, np.float32)
            centres = [(lpad + a * PITCH + PITCH / 2, tpad + b * PITCH + PITCH / 2)
                       for a in range(cx_n) for b in range(cy_n)]
            for cxm, cym in centres:
                e = np.maximum(e, -_rrect_sdf(X, Y, cxm, cym, PITCH / 2, PITCH / 2, 4.0))
            prof = np.where(e <= 0, PLATE_H,
                            np.where(e < 0.7, PLATE_H - e,
                                     np.where(e < 2.85, 2.15 - (e - 0.7), 0.0)))
            top = (floor + prof).astype(np.float32)
            z0 = np.zeros(X.shape, np.float32)
            m = np.ones(X.shape, bool)
            if not (lpad or rpad or tpad or bpad) and len(sx) * len(sy) == 1:
                m = _rrect_sdf(X, Y, Wt / 2, Ht / 2, Wt / 2, Ht / 2, 4.0) <= 0     # rounded outside corners
            if o.style == "light":
                m &= ~(e >= 2.85 - 0.25)
                top = np.maximum(top, 0.8)
            if o.style in ("magnet", "screw"):
                for cxm, cym in centres:
                    for ssx in (-1, 1):
                        for ssy in (-1, 1):
                            hole = (X - cxm - ssx * MAG_OFF) ** 2 + (Y - cym - ssy * MAG_OFF) ** 2 <= (o.magnet_d / 2) ** 2
                            top[hole] = floor - o.magnet_h
            if o.style == "screw":
                # countersunk hole in each cell's middle to screw the plate into the drawer
                for cxm, cym in centres:
                    dd = np.hypot(X - cxm, Y - cym)
                    top = np.where(dd < 4.4, np.minimum(top, floor - np.maximum(0, 4.4 - dd)), top)
                    m &= dd >= 2.2
            if clips:
                cuts = np.zeros(X.shape, bool)
                ys_c = [tpad + b * PITCH + PITCH / 2 for b in range(cy_n)]
                xs_c = [lpad + a * PITCH + PITCH / 2 for a in range(cx_n)]
                if i > 0:
                    for yc in ys_c:
                        cuts |= _dogbone(X, Y, 0.0, yc, True)
                if i < len(sx) - 1:
                    for yc in ys_c:
                        cuts |= _dogbone(X, Y, Wt, yc, True)
                    n_clips += len(ys_c)
                if j > 0:
                    for xc in xs_c:
                        cuts |= _dogbone(X, Y, xc, 0.0, False)
                if j < len(sy) - 1:
                    for xc in xs_c:
                        cuts |= _dogbone(X, Y, xc, Ht, False)
                    n_clips += len(xs_c)
                z0 = np.where(cuts & m, recess, z0)
            top = np.maximum(top, z0 + 0.6)
            tris = column_mesh(m, z0, top, r)
            vol += float(((top - z0) * m).sum() * r * r)
            all_t.append(tris)
            # place tiles where they go in the drawer (row 0 = back), 1 mm apart so the seams show
            tris = tris + np.array([x_off, -y_off - Ht, 0], np.float32)
            x_off += Wt + 1.0
            nm = f"{stem}_{j + 1}{chr(65 + i)}" if len(sx) * len(sy) > 1 else stem
            write_stl(outdir / f"{nm}.stl", tris, nm)
            files.append(f"{nm}.stl")
            col = COLOURS[(i + j) % len(COLOURS)]
            parts.append({"name": nm, "file": f"{nm}.stl", "colour": col,
                          "cells": [cx_n, cy_n], "size_mm": [round(Wt, 1), round(Ht, 1)]})
            bodies.append((nm, tris, col))
            tris_all += len(tris)
        y_off += Ht + 1.0
    write_3mf(outdir / f"{stem}.3mf", bodies)
    files.append(f"{stem}.3mf")
    if clips and n_clips:
        # the clips themselves: a little smaller than the recess, laid out in a row
        cr = 0.25
        nx_, ny_ = int(round(2 * (CLIP_OFF + CLIP_R + 1) / cr)), int(round(2 * (CLIP_R + 1) / cr))
        Xc, Yc = np.meshgrid((np.arange(nx_) + 0.5) * cr, (np.arange(ny_) + 0.5) * cr)
        shape = _dogbone(Xc, Yc, nx_ * cr / 2, ny_ * cr / 2, True)
        shape = _erode(shape, 0.15 / cr)
        one = column_mesh(shape, 0.0, 2 * recess - 0.3, cr)
        allc = [one + np.array([0, -k * (2 * CLIP_R + 4), 0], np.float32) for k in range(n_clips)]
        write_stl(outdir / f"{stem}_clips.stl", np.concatenate(allc), stem + "_clips")
        files.append(f"{stem}_clips.stl")
        parts.append({"name": f"{n_clips} clips", "file": f"{stem}_clips.stl", "colour": "#d0d0d0"})
        all_t.append(np.concatenate(allc))
        vol += float(shape.sum() * cr * cr * (2 * recess - 0.3) * n_clips)
        notes.append(f"{n_clips} dog-bone clips join the tiles: press them into the slots underneath "
                     "(they print standing flat, no supports).")
    elif o.connectors and len(sx) * len(sy) > 1 and floor < 2.5:
        notes.append("Connector clips need a solid style (Light plates are too thin) - tiles just butt together.")
    if len(sx) * len(sy) > 1:
        notes.append(f"Split into {len(sx) * len(sy)} tiles to fit a {o.bed_w:.0f} x {o.bed_h:.0f} mm bed "
                     "(letters run left to right, numbers back to front).")
    if padx > 0.5 or pady > 0.5:
        notes.append(f"Padding {padx:.1f} mm each side and {pady:.1f} mm front/back fills the drawer.")
    if o.style == "screw":
        notes.append("Countersunk holes take 4 mm wood screws (one per cell is plenty - use the corners).")
    return {"gx": gx, "gy": gy, "tiles": len(sx) * len(sy), "size_mm": [round(tw, 1), round(th, 1)],
            "height_mm": round(floor + PLATE_H, 2), "files": files, "part_info": parts,
            "triangles": tris_all, "notes": notes, "estimate": estimate(all_t, vol, o.cost_kg)}


# ---------------------------------------------------------- storage bins
@dataclass
class StoreOpts:
    gx: int = 2
    gy: int = 1
    units: int = 6
    cols: int = 2                  # compartments across
    rows: int = 1                  # compartments front to back
    divider: float = 1.2
    divider_h: float = 1.0         # divider height as a fraction (lower ones are easier to reach over)
    scoop: bool = True             # curved floor at the front of each compartment
    scoop_r: float = 0.0           # 0 = auto
    tabs: bool = True              # angled label tab at the back of each compartment
    tab_d: float = 13.0
    labels: str = ""               # comma separated, engraved on the tabs
    lip: bool = True
    magnets: bool = False
    magnet_d: float = 6.5
    magnet_h: float = 2.4
    screws: bool = False
    colour_text: bool = False
    accent_mm: float = 0.6
    lid: bool = False
    res: float = 0.5
    cost_kg: float = 20.0
    tab: bool = False              # pickup tab with a label insert on the back
    tab_w: float = 0.6
    tab_h: float = 10.0
    tab_text: str = ""


def store_opts_from(d: dict) -> StoreOpts:
    o = _parse(StoreOpts, d, 400)
    o.cols, o.rows = min(12, max(1, o.cols)), min(12, max(1, o.rows))
    o.gx, o.gy = min(10, max(1, o.gx)), min(10, max(1, o.gy))
    o.units = min(30, max(2, o.units))
    o.divider_h = min(1.0, max(0.2, o.divider_h))
    return o


def make_storage(o: StoreOpts, outdir: Path, stem: str = "storage", progress=None) -> dict:
    """A classic open bin split into compartments, with finger scoops along
    the front of each and angled label tabs at the back."""
    gx, gy = o.gx, o.gy
    W, H = bin_size(gx, gy)
    r = o.res
    nx, ny = int(round(W / r)), int(round(H / r))
    X, Y = np.meshgrid((np.arange(nx) + 0.5) * r, (np.arange(ny) + 0.5) * r)
    outer = _rrect_sdf(X, Y, W / 2, H / 2, W / 2, H / 2, CORNER_R)
    mask, d_in = outer <= 0, -outer
    bo = BinOpts(lip=o.lip, magnets=o.magnets, magnet_d=o.magnet_d, magnet_h=o.magnet_h, screws=o.screws, res=r)
    Htop = o.units * UNIT_H
    Tin = Htop - (LIP_DROP if o.lip else 0.0)
    floor = FOOT_H + FLOOR_ABOVE_FEET
    notes = []
    _tick(progress, "Walls and compartments...")
    z0 = _feet_bottom(gx, gy, X, Y, bo)
    top = _lip_top(d_in, Htop, bo)
    wall = (LIP_H - 0.7 - FOOT_VERT + 0.7 + LIP_DROP) if o.lip else 1.2
    inside = d_in >= wall
    x0, x1, y0, y1 = wall, W - wall, wall, H - wall
    cw, ch = (x1 - x0) / o.cols, (y1 - y0) / o.rows
    hd = o.divider / 2
    comps = []
    div = np.zeros(mask.shape, bool)
    for a in range(1, o.cols):
        div |= np.abs(X - (x0 + a * cw)) < hd
    for b in range(1, o.rows):
        div |= np.abs(Y - (y0 + b * ch)) < hd
    div &= inside
    zdiv = floor + (Tin - floor) * o.divider_h
    top = np.where(inside, floor, top)
    top = np.where(div, zdiv, top)
    tab_m = np.zeros(mask.shape, bool)
    tab_lo = np.zeros(mask.shape, np.float32)
    tab_hi = np.zeros(mask.shape, np.float32)
    acc = np.zeros(mask.shape, bool)
    acc_lo = np.zeros(mask.shape, np.float32)
    acc_hi = np.zeros(mask.shape, np.float32)
    labels = [t.strip() for t in o.labels.split(",")] if o.labels.strip() else []
    tab_d = min(o.tab_d, ch * 0.4, (Tin - floor) - 3)
    for b in range(o.rows):
        for a in range(o.cols):
            cx0 = x0 + a * cw + (hd if a else 0)
            cx1 = x0 + (a + 1) * cw - (hd if a < o.cols - 1 else 0)
            cy0 = y0 + b * ch + (hd if b else 0)
            cy1 = y0 + (b + 1) * ch - (hd if b < o.rows - 1 else 0)
            cell = (X >= cx0) & (X < cx1) & (Y >= cy0) & (Y < cy1) & inside & ~div
            comps.append((cx1 - cx0, cy1 - cy0))
            if o.scoop:
                R = o.scoop_r or min((cy1 - cy0) * 0.5, (Tin - floor) * 0.7, 25)
                t = cy1 - Y
                sc = cell & (t < R)
                zs = floor + R - np.sqrt(np.maximum(0, R * R - (R - np.clip(t, 0, R)) ** 2))
                top = np.where(sc, np.maximum(top, zs), top)
            if o.tabs and tab_d >= 6:
                # separate shell with a 45 degree underside, so it prints without supports
                t = Y - cy0
                tm = (X >= cx0 - 0.3) & (X < cx1 + 0.3) & (t >= -0.6) & (t < tab_d) & mask
                lo = np.minimum(Tin - tab_d + np.maximum(t, 0), Tin - 1.2)
                tab_m |= tm
                tab_lo = np.where(tm, lo, tab_lo)
                tab_hi = np.where(tm, Tin - 0.02, tab_hi)          # not coplanar with the walls
                k = b * o.cols + a
                if k < len(labels) and labels[k]:
                    txt = text_mask(labels[k], min(tab_d * 0.55, 8) / r, max_w_px=(cx1 - cx0 - 4) / r)
                    th_, tw_ = txt.shape
                    ry = int(round((cy0 + (tab_d - 1.2) / 2) / r)) - th_ // 2
                    rx = int(round(((cx0 + cx1) / 2) / r)) - tw_ // 2
                    g = _stamp(mask.shape, txt, ry, rx) & tm
                    tab_hi = np.where(g, Tin - 0.6, tab_hi)
                    if o.colour_text:
                        acc[g] = True
                        acc_lo[g] = Tin - 0.6
                        acc_hi[g] = Tin
    top = np.maximum(top, z0 + 0.6)
    if o.screws:
        z0 = _screw_holes(gx, gy, X, Y, z0, top)
    _tick(progress, "Meshing...")
    tris = column_mesh(mask, z0, top, r)
    vol = float(((top - z0) * mask).sum() * r * r)
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob(f"{stem}*"):
        if old.suffix in (".stl", ".3mf", ".png"):
            old.unlink()
    pre_parts, pre_files = [], []
    if o.tab:
        tt, tv = add_tab(o, X, Y, W, Htop, mask, r, outdir, stem, o.tab_text, pre_parts, pre_files, notes,
                         -(W / 2 + 40))
        tris = np.concatenate([tris, tt])
        vol += tv
    if tab_m.any():
        tt = column_mesh(tab_m, tab_lo, tab_hi, r)
        tris = np.concatenate([tris, tt])                 # overlapping shells: slicers merge them
        vol += float(((tab_hi - tab_lo) * tab_m).sum() * r * r)
    write_stl(outdir / f"{stem}.stl", tris, stem)
    files = [f"{stem}.stl"] + pre_files
    parts = [{"name": stem, "file": f"{stem}.stl", "colour": COLOURS[0]}] + pre_parts
    bodies = [(stem, tris, COLOURS[0])]
    all_t = [tris]
    if acc.any():
        at = column_mesh(acc, acc_lo, acc_hi, r)
        write_stl(outdir / f"{stem}_colour.stl", at, stem + "_colour")
        files.append(f"{stem}_colour.stl")
        parts.append({"name": "second colour", "file": f"{stem}_colour.stl", "colour": ACCENT})
        bodies.append((stem + "_colour", at, ACCENT))
        all_t.append(at)
    write_3mf(outdir / f"{stem}.3mf", bodies)
    files.append(f"{stem}.3mf")
    est = estimate(all_t, vol, o.cost_kg)
    if o.lid:
        lt, lvol = make_lid_mesh(gx, gy, bo)
        lt = lt + np.array([W + 8, 0, 0], np.float32)
        write_stl(outdir / f"{stem}_lid.stl", lt, stem + "_lid")
        files.append(f"{stem}_lid.stl")
        parts.append({"name": "lid", "file": f"{stem}_lid.stl", "colour": COLOURS[3]})
        e2 = estimate([lt], lvol, o.cost_kg)
        est = {k: round(est[k] + e2[k], 2) for k in est}
    preview_image([np.where(mask, top, 0), np.where(tab_m, tab_hi, 0)], r, [COLOURS[0], COLOURS[0]], 900).save(
        outdir / f"{stem}_preview.png")
    files.append(f"{stem}_preview.png")
    if o.tabs and tab_d < 6:
        notes.append("Compartments too shallow for label tabs - left them off.")
    if o.lip:
        notes.append("Walls are solid under the stacking lip (stronger, no supports).")
    cwmm, chmm = comps[0]
    return {"gx": gx, "gy": gy, "units": o.units, "size_mm": [round(W, 1), round(H, 1)],
            "height_mm": round(Htop + (LIP_H if o.lip else 0), 1), "compartments": len(comps),
            "compartment_mm": [round(cwmm, 1), round(chmm, 1), round(Tin - floor, 1)],
            "files": files, "part_info": parts, "preview": f"{stem}_preview.png",
            "triangles": int(sum(len(t) for t in all_t)), "notes": notes, "estimate": est}


# ------------------------------------------------------------ hole holders
@dataclass
class HoleOpts:
    sizes: str = "1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10"
    shape: str = "round"           # round / hex (hex: size = across the flats)
    fit: float = 0.3               # added to each diameter so things drop in
    depth: float = 15.0            # hole depth for a 0 mm bit...
    depth_k: float = 1.0           # ...plus this much per mm of diameter
    gap: float = 2.5               # wall between holes
    order: str = "ascending"       # ascending / given
    labels: bool = True
    label_mm: float = 3.5
    tiers: bool = True             # rows step up towards the back so every label shows
    step: float = 4.0
    gx: int = 0
    gy: int = 0
    units: int = 0
    max_units: int = 6
    bed_w: float = 256.0
    bed_h: float = 256.0
    lip: bool = True
    magnets: bool = False
    magnet_d: float = 6.5
    magnet_h: float = 2.4
    screws: bool = False
    lid: bool = False
    colour_text: bool = False
    label: str = ""                # bin label along the front
    label_mm2: float = 6.0
    tab: bool = False
    tab_w: float = 0.6
    tab_h: float = 10.0
    tab_text: str = ""
    res: float = 0.25
    cost_kg: float = 20.0


def hole_opts_from(d: dict) -> HoleOpts:
    o = _parse(HoleOpts, d, 600)
    o.shape = o.shape if o.shape in ("round", "hex") else "round"
    o.gap = max(1.0, o.gap)
    return o


def parse_sizes(text: str) -> list:
    """'1, 1.5, 3mm, 1/8in, 0.25", M6' -> [(mm, label)]. Inches by 'in' or '"'.
    Mn means an n mm bolt/bit. Labels keep what you typed (without units)."""
    import re
    out = []
    for tok in re.split(r"[,;\s]+", text.strip()):
        if not tok:
            continue
        t = tok.lower().replace("mm", "")
        inch = t.endswith("in") or t.endswith('"')
        t = t.rstrip('in"')
        lab = tok.replace("mm", "")
        if t.startswith("m") and t[1:].replace(".", "", 1).isdigit():
            t = t[1:]
        try:
            if "/" in t:
                whole = 0.0
                if "-" in t:                             # 1-1/2in
                    w_, t = t.split("-", 1)
                    whole = float(w_)
                a, b = t.split("/", 1)
                v = whole + float(a) / float(b)
            else:
                v = float(t)
        except (ValueError, ZeroDivisionError):
            continue
        mm = v * 25.4 if inch else v
        if 0.3 <= mm <= 60:
            out.append((mm, lab.rstrip('"').replace("in", "")))
    if not out:
        raise ValueError("No sizes I could read - list them like: 1, 1.5, 2, 3mm, 1/8in, M6")
    return out


def plan_holes(o: HoleOpts) -> dict:
    """Where every hole goes (flowing in rows from the front-left), the bin
    size (smallest that fits the bed, unless given) and its height."""
    sizes = parse_sizes(o.sizes)
    if o.order == "ascending":
        sizes = sorted(sizes, key=lambda t: t[0])
    holes = []
    for mm, lab in sizes:
        d = mm + o.fit
        span = d / math.cos(math.radians(30)) if o.shape == "hex" else d     # hex: corner to corner
        lw = (len(lab) * o.label_mm * 0.62 + 1.0) if o.labels else 0.0
        holes.append({"mm": round(mm, 3), "label": lab, "d": round(d, 3), "span": span,
                      "cell_w": max(span + o.gap, lw + 1.0), "depth": round(o.depth + o.depth_k * mm, 1)})
    lab_h = (o.label_mm + 1.6) if o.labels else 0.0

    def flow(W, H):
        m = interior_margin(o)
        x0, x1 = m + 0.5, W - m - 0.5
        y_back = max(m, back_reserve(o)) + 0.5
        y_front = H - m - 0.5 - ((o.label_mm2 + 3) if o.label.strip() else 0)
        rows, cur, wsum = [], [], 0.0
        for h in holes:
            if cur and wsum + h["cell_w"] > x1 - x0:
                rows.append(cur)
                cur, wsum = [], 0.0
            if h["cell_w"] > x1 - x0:
                return None
            cur.append(h)
            wsum += h["cell_w"]
        if cur:
            rows.append(cur)
        heights = [max(h["span"] for h in row) + lab_h + o.gap for row in rows]
        if sum(heights) > y_front - y_back:
            return None
        # rows from the front; spread the spare depth evenly between them
        spare = (y_front - y_back - sum(heights)) / (len(rows) + 1)
        placed, y = [], y_front
        bounds = []
        for i, (row, rh) in enumerate(zip(rows, heights)):
            y -= spare + rh
            used = sum(h["cell_w"] for h in row)
            gapx = ((x1 - x0) - used) / (len(row) + 1)
            x = x0 + gapx
            yc = y + o.gap / 2 + max(h["span"] for h in row) / 2
            for h in row:
                placed.append(h | {"x": round(x + h["cell_w"] / 2, 2), "y": round(yc, 2), "row": i})
                x += h["cell_w"] + gapx
            bounds.append((y - spare / 2, y + rh + spare / 2))
        return placed, bounds, len(rows)

    if o.gx and o.gy:
        sizes_try = [(o.gx, o.gy)]
    else:
        bw, bh = sorted((o.bed_w, o.bed_h))
        sizes_try = sorted(((a, b) for a in range(1, o.max_units + 1) for b in range(1, o.max_units + 1)
                            if (not o.gx or a == o.gx) and (not o.gy or b == o.gy)
                            and sorted(bin_size(a, b))[0] <= bw and sorted(bin_size(a, b))[1] <= bh),
                           key=lambda s: (s[0] * s[1], abs(s[0] - s[1]), -s[0]))
    for gx, gy in sizes_try:
        W, H = bin_size(gx, gy)
        res = flow(W, H)
        if res:
            placed, bounds, nrows = res
            break
    else:
        raise ValueError("Those holes don't fit in a bin that fits your bed - fewer sizes, a smaller gap, "
                         "or raise the size limits.")
    floor_min = FOOT_H + FLOOR_ABOVE_FEET
    steps = [(nrows - 1 - h["row"]) * (o.step if o.tiers else 0) for h in placed]   # front row lowest
    need = max(floor_min + h["depth"] + 0.4 + st for h, st in zip(placed, steps))
    units = o.units or max(2, int(math.ceil((need + (LIP_DROP if o.lip else 0)) / UNIT_H - 1e-6)))
    return {"gx": gx, "gy": gy, "size_mm": [round(W, 1), round(H, 1)], "units": units, "rows": nrows,
            "holes": placed, "row_bounds": bounds, "need_mm": round(need, 1)}


def make_holes(o: HoleOpts, outdir: Path, stem: str = "holes", progress=None) -> dict:
    _tick(progress, "Planning the holes...")
    plan = plan_holes(o)
    gx, gy, units = plan["gx"], plan["gy"], plan["units"]
    W, H = bin_size(gx, gy)
    r = o.res
    nx, ny = int(round(W / r)), int(round(H / r))
    X, Y = np.meshgrid((np.arange(nx) + 0.5) * r, (np.arange(ny) + 0.5) * r)
    outer = _rrect_sdf(X, Y, W / 2, H / 2, W / 2, H / 2, CORNER_R)
    mask, d_in = outer <= 0, -outer
    bo = BinOpts(lip=o.lip, magnets=o.magnets, magnet_d=o.magnet_d, magnet_h=o.magnet_h, screws=o.screws, res=r,
                 tab=o.tab, tab_w=o.tab_w, tab_h=o.tab_h)
    Htop = units * UNIT_H
    Tin = Htop - (LIP_DROP if o.lip else 0.0)
    floor_min = FOOT_H + FLOOR_ABOVE_FEET
    notes = []
    z0 = _feet_bottom(gx, gy, X, Y, bo)
    top = _lip_top(d_in, Htop, bo)
    nrows = plan["rows"]
    margin = interior_margin(bo)
    inside = d_in >= (margin - 1.0 if o.lip else 0.0)
    # tiers: each row's top, stepping down towards the front
    tier = np.full(mask.shape, Tin, np.float32)
    if o.tiers and nrows > 1:
        for i, (y0, y1) in enumerate(plan["row_bounds"]):
            zt = Tin - (nrows - 1 - i) * o.step
            sel = (Y >= y0) & (Y < y1) if i else (Y >= y0)        # row 0 (front) runs to the front wall
            tier = np.where(sel, np.minimum(tier, zt), tier)
        notes.append(f"{nrows} rows stepping up {o.step:g} mm towards the back so every size shows.")
    top = np.where(inside, np.minimum(top, tier), top)
    acc = np.zeros(mask.shape, bool)
    acc_lo = np.zeros(mask.shape, np.float32)
    acc_hi = np.zeros(mask.shape, np.float32)
    _tick(progress, f"Drilling {len(plan['holes'])} holes...")
    for h in plan["holes"]:
        zt = Tin - ((nrows - 1 - h["row"]) * o.step if o.tiers else 0)
        dx, dy = X - h["x"], Y - h["y"]
        if o.shape == "hex":       # flats top and bottom
            ax, ay = np.abs(dx), np.abs(dy)
            rad = np.maximum(ay, ax * math.cos(math.radians(30)) + ay * 0.5)     # distance in "across flats" terms
        else:
            rad = np.hypot(dx, dy)
        R = h["d"] / 2
        fl = max(floor_min, zt - h["depth"])
        if zt - h["depth"] < floor_min - 0.2:
            notes.append(f"{h['label']}: hole limited to {zt - floor_min:.0f} mm deep - add a height unit for more.")
        hole = rad <= R
        cham = (rad > R) & (rad <= R + 0.6)
        top = np.where(hole, fl, top)
        top = np.where(cham, np.minimum(top, zt - (R + 0.6 - rad)), top)
        if o.labels:
            txt = text_mask(h["label"], o.label_mm / r, max_w_px=(h["cell_w"] - 0.5) / r)
            ry = int(round((h["y"] + h["span"] / 2 + 0.9 + o.label_mm / 2) / r)) - txt.shape[0] // 2
            rx = int(round(h["x"] / r)) - txt.shape[1] // 2
            g = _stamp(mask.shape, txt, ry, rx) & inside & (np.abs(top - zt) < 0.01)
            top = np.where(g, top - 0.5, top)
            if o.colour_text:
                acc[g] = True
                acc_lo[g] = top[g]
                acc_hi[g] = top[g] + 0.5
    if o.label.strip():
        y1 = H - margin - 0.5
        y0 = y1 - (o.label_mm2 + 3)
        txt = text_mask(o.label.strip(), o.label_mm2 / r, max_w_px=(W - 2 * margin - 6) / r)
        ry = int(round(((y0 + y1) / 2) / r)) - txt.shape[0] // 2
        rx = nx // 2 - txt.shape[1] // 2
        g = _stamp(mask.shape, txt, ry, rx) & inside
        top = np.where(g, top - 0.6, top)
        if o.colour_text:
            acc[g] = True
            acc_lo[g] = top[g]
            acc_hi[g] = top[g] + 0.6
    top = np.maximum(top, z0 + 0.6)
    if o.screws:
        z0 = _screw_holes(gx, gy, X, Y, z0, top)
    _tick(progress, "Meshing...")
    tris = column_mesh(mask, z0, top, r)
    vol = float(((top - z0) * mask).sum() * r * r)
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob(f"{stem}*"):
        if old.suffix in (".stl", ".3mf", ".png"):
            old.unlink()
    parts, files = [{"name": stem, "file": f"{stem}.stl", "colour": COLOURS[0]}], [f"{stem}.stl"]
    if o.tab:
        tt, tv = add_tab(bo, X, Y, W, Htop, mask, r, outdir, stem, o.tab_text or o.label, parts, files, notes,
                         -(W / 2 + 40))
        tris = np.concatenate([tris, tt])
        vol += tv
    write_stl(outdir / f"{stem}.stl", tris, stem)
    bodies = [(stem, tris, COLOURS[0])]
    all_t = [tris]
    if acc.any():
        at = column_mesh(acc, acc_lo, acc_hi, r)
        write_stl(outdir / f"{stem}_colour.stl", at, stem + "_colour")
        files.append(f"{stem}_colour.stl")
        parts.append({"name": "second colour", "file": f"{stem}_colour.stl", "colour": ACCENT})
        bodies.append((stem + "_colour", at, ACCENT))
        all_t.append(at)
    write_3mf(outdir / f"{stem}.3mf", bodies)
    files.append(f"{stem}.3mf")
    est = estimate(all_t, vol, o.cost_kg)
    if o.lid:
        lt, lvol = make_lid_mesh(gx, gy, BinOpts(magnets=o.magnets, screws=o.screws, res=0.5))
        lt = lt + np.array([W + 8, 0, 0], np.float32)
        write_stl(outdir / f"{stem}_lid.stl", lt, stem + "_lid")
        files.append(f"{stem}_lid.stl")
        parts.append({"name": "lid", "file": f"{stem}_lid.stl", "colour": COLOURS[3]})
        e2 = estimate([lt], lvol, o.cost_kg)
        est = {k: round(est[k] + e2[k], 2) for k in est}
    preview_image([np.where(mask, top, 0)], r, [COLOURS[0]], 900).save(outdir / f"{stem}_preview.png")
    files.append(f"{stem}_preview.png")
    return {"gx": gx, "gy": gy, "units": units, "size_mm": [round(W, 1), round(H, 1)],
            "height_mm": round(Htop + (LIP_H if o.lip else 0), 1), "holes": len(plan["holes"]), "rows": nrows,
            "files": files, "part_info": parts, "preview": f"{stem}_preview.png",
            "triangles": int(sum(len(t) for t in all_t)), "notes": notes, "estimate": est, "plan": plan}
