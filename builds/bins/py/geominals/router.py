"""Router templates for cutting tool pockets in foam (or wood) by hand.

Internal: a plate with holes. A flush-trim / pattern bit's bearing (or a
guide bushing) runs round the inside of each hole and the bit cuts the
pocket. Corners and slots narrower than the bit can't be reached, so the
holes are widened just enough there ("relief") that nothing is left behind.

External: shaped pieces the bearing runs round the outside of, to cut a
shape out (a foam insert's outline, a tool-shaped blank...).

Outputs: SVG and DXF (laser: red = cut, blue = engrave), a smooth 3D-print
STL (extruded from the outlines, not pixel steps, so the bearing runs
smoothly), a 1:1 paper PDF and a preview.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, fields
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.spatial import Delaunay

from . import gridfinity as G
from . import toolscan as TS
from .mesh3d import write_stl, is_watertight


@dataclass
class RouterOpts:
    mode: str = "internal"         # internal (pockets) / external (cut round shapes)
    guide: str = "bearing"         # bearing (flush / pattern bit) / bushing (template guide)
    bit_d: float = 6.35
    bushing_od: float = 10.0
    clearance: float = 0.8         # round each tool, like the bins
    relief: bool = True            # widen spots the bit can't reach
    margin: float = 30.0           # plate border round the holes
    thickness: float = 6.0         # plate thickness (3D print) - match your sheet for laser
    holes: bool = True             # corner holes to screw / pin the template down
    foam_w: float = 0.0            # template size (0 = fit the tools + margin)
    foam_h: float = 0.0
    scoops: bool = True            # include the bin's finger scoops as round cut-outs
    res: float = 0.1
    bed_w: float = 256.0
    bed_h: float = 256.0
    cnc: bool = False              # also G-code to pocket the foam / wood directly on a CNC
    foam_t: float = 0.0            # stock thickness for the CNC cut-out (0 = pockets only)


def router_opts_from(d: dict) -> RouterOpts:
    o = G._parse(RouterOpts, d, 20)
    o.mode = o.mode if o.mode in ("internal", "external") else "internal"
    o.guide = o.guide if o.guide in ("bearing", "bushing") else "bearing"
    o.bit_d = min(30.0, max(1.0, o.bit_d))
    o.bushing_od = max(o.bit_d, o.bushing_od)
    o.res = min(0.3, max(0.05, o.res))
    return o


def _disk_edt(m, r_px, grow=True):
    if r_px <= 0.3:
        return m.copy()
    if grow:
        return ndi.distance_transform_edt(~m) <= r_px
    return ndi.distance_transform_edt(m) > r_px


# ------------------------------------------------------------ outlines
def contours(mask, res, origin=(0.0, 0.0), tol=0.04):
    """Closed polygons (mm) of a mask's edges, sub-pixel and simplified."""
    from skimage import measure
    f = np.pad(mask.astype(np.float32), 2)
    f = ndi.gaussian_filter(f, 0.7)
    out = []
    for c in measure.find_contours(f, 0.5):
        c = measure.approximate_polygon(c, tol / res)
        if len(c) < 4:
            continue
        pts = np.c_[(c[:, 1] - 2 + 0.5) * res + origin[0], (c[:, 0] - 2 + 0.5) * res + origin[1]][:-1]
        area = 0.5 * (np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1)))
        if abs(area) > 1.0:
            out.append(pts)
    return out


def _inside(polys, pts):
    """Even-odd point-in-polygon for many points against many polygons."""
    inside = np.zeros(len(pts), bool)
    x, y = pts[:, 0], pts[:, 1]
    for p in polys:
        px, py = p[:, 0], p[:, 1]
        qx, qy = np.roll(px, -1), np.roll(py, -1)
        cross = np.zeros(len(pts), bool)
        for x1, y1, x2, y2 in zip(px, py, qx, qy):
            if y1 == y2:
                continue
            c = ((y1 > y) != (y2 > y)) & (x < (x2 - x1) * (y - y1) / (y2 - y1) + x1)
            cross ^= c
        inside ^= cross
    return inside


def extrude(polys, height):
    """Watertight mesh of polygons (with holes, even-odd) extruded to `height`.
    Triangulated by conforming Delaunay: boundary edges missing from the
    triangulation get split until they're all there."""
    segs_pts = [np.asarray(p, np.float64) for p in polys]
    for _ in range(12):
        pts = np.concatenate(segs_pts)
        tri = Delaunay(pts)
        edges = set()
        for a, b, c in tri.simplices:
            edges |= {(min(a, b), max(a, b)), (min(b, c), max(b, c)), (min(a, c), max(a, c))}
        new, missing, off = [], 0, 0
        for p in segs_pts:
            n = len(p)
            idx = np.arange(n) + off
            out = []
            for k in range(n):
                i, j = idx[k], idx[(k + 1) % n]
                out.append(p[k])
                if (min(i, j), max(i, j)) not in edges:
                    out.append((p[k] + p[(k + 1) % n]) / 2)
                    missing += 1
            new.append(np.array(out))
            off += n
        segs_pts = new
        if not missing:
            break
    pts = np.concatenate(segs_pts)
    tri = Delaunay(pts)
    T = tri.simplices
    cen = pts[T].mean(1)
    keep = _inside(segs_pts, cen)
    T = T[keep]
    P2 = pts[T]                                          # (n,3,2)
    # orient counter-clockwise for the top
    cr = (P2[:, 1, 0] - P2[:, 0, 0]) * (P2[:, 2, 1] - P2[:, 0, 1]) - (P2[:, 1, 1] - P2[:, 0, 1]) * (P2[:, 2, 0] - P2[:, 0, 0])
    T[cr < 0] = T[cr < 0][:, [0, 2, 1]]
    P2 = pts[T]
    z1 = np.full(P2.shape[:2] + (1,), float(height))
    z0 = np.zeros(P2.shape[:2] + (1,))
    top = np.concatenate([P2, z1], 2)
    bot = np.concatenate([P2[:, [0, 2, 1]], z0], 2)
    walls = []
    for p in segs_pts:
        q = np.roll(p, -1, axis=0)
        mid = (p + q) / 2
        d = q - p
        nrm = np.c_[d[:, 1], -d[:, 0]] / (np.linalg.norm(d, axis=1, keepdims=True) + 1e-12)
        probe = mid + nrm * 0.01
        out_is_right = ~_inside(segs_pts, probe)          # material on the left when the right side is outside
        a0 = np.c_[p, np.zeros(len(p))]
        b0 = np.c_[q, np.zeros(len(p))]
        a1 = np.c_[p, np.full(len(p), height)]
        b1 = np.c_[q, np.full(len(p), height)]
        t1 = np.stack([a0, b0, b1], 1)
        t2 = np.stack([a0, b1, a1], 1)
        flip = ~out_is_right
        t1[flip] = t1[flip][:, [0, 2, 1]]
        t2[flip] = t2[flip][:, [0, 2, 1]]
        walls += [t1, t2]
    tris = np.concatenate([top, bot] + walls).astype(np.float32)
    # make wall normals face out (cheap fix: compare with the probe direction)
    return tris


# ----------------------------------------------------------- the shapes
def shapes_from_layout(layout, bo: G.BinOpts, o: RouterOpts, res):
    """Pocket masks (one per tool, plus scoops) on a grid covering the bin,
    with names and depths. Grid origin is the bin's back-left corner."""
    gx, gy = int(layout.get("gx") or 2), int(layout.get("gy") or 2)
    W, H = G.bin_size(gx, gy)
    nx, ny = int(round(W / res)), int(round(H / res))
    X, Y = np.meshgrid((np.arange(nx) + 0.5) * res, (np.arange(ny) + 0.5) * res)
    cache, shapes = {}, []
    for it in layout.get("items", []):
        try:
            rec, tm, hm = G._tool_bits(it["tool"], cache)
        except (OSError, KeyError, ValueError):
            continue
        m, _ = G.place_tool(it, rec, tm, None, X, Y)
        m, _ = G.fit_shape(m, it.get("fit", "exact"), res)
        if not m.any():
            continue
        p = _disk_edt(m, (o.clearance + float(it.get("extra") or 0)) / res)
        depth = float(it.get("depth") or rec.get("depth") or 10)
        shapes.append({"name": it.get("label") or rec["name"], "mask": p, "depth": depth})
        if o.scoops:
            for sx, sy, sd in G.item_scoops(it, rec, tm, bo):
                shapes.append({"name": "scoop", "mask": np.hypot(X - sx, Y - sy) <= sd / 2, "depth": depth})
    for s in layout.get("scoops", []) if o.scoops else []:
        sd = float(s.get("d") or bo.scoop_d)
        shapes.append({"name": "scoop", "mask": np.hypot(X - float(s["x"]), Y - float(s["y"])) <= sd / 2,
                       "depth": 15.0})
    return shapes, (W, H)


def shapes_from_tool(tid, o: RouterOpts, res):
    rec, tm, _ = TS.get_tool(tid)
    ppm = rec.get("ppm", TS.PPM)
    h, w = tm.shape
    W, H = w / ppm, h / ppm
    nx, ny = int(round(W / res)), int(round(H / res))
    m = cv2.resize(tm.astype(np.float32), (nx, ny), interpolation=cv2.INTER_LINEAR) > 0.5
    m = _disk_edt(m, o.clearance / res)
    return [{"name": rec["name"], "mask": m, "depth": float(rec.get("depth", 10))}], (W, H)


# ------------------------------------------------------------- template
def make_router(o: RouterOpts, outdir: Path, stem: str, layout=None, tid=None, bin_opts=None, progress=None,
                cnc=None) -> dict:
    G._tick(progress, "Gathering the shapes...")
    bo = bin_opts or G.BinOpts()
    r = o.res
    if layout:
        # keep the raster manageable for big bins
        W0, H0 = G.bin_size(int(layout.get("gx") or 2), int(layout.get("gy") or 2))
        r = max(r, math.sqrt((W0 + 2 * o.margin) * (H0 + 2 * o.margin) / 9e6))
        shapes, (W, H) = shapes_from_layout(layout, bo, o, r)
    elif tid:
        shapes, (W, H) = shapes_from_tool(tid, o, r)
    else:
        raise ValueError("Pick a bin layout or a tool.")
    if not shapes:
        raise ValueError("No tools to make a template for.")
    union = np.zeros(shapes[0]["mask"].shape, bool)
    for s in shapes:
        union |= s["mask"]
    ys, xs = np.nonzero(union)
    bx0, bx1, by0, by1 = xs.min() * r, (xs.max() + 1) * r, ys.min() * r, (ys.max() + 1) * r
    # template canvas: tools' bounds (or the foam size, centred) plus the margin
    cw = (o.foam_w if o.foam_w > 0 else (bx1 - bx0)) + 2 * o.margin
    ch = (o.foam_h if o.foam_h > 0 else (by1 - by0)) + 2 * o.margin
    ox = (bx0 + bx1) / 2 - cw / 2                         # canvas origin in shape-grid mm
    oy = (by0 + by1) / 2 - ch / 2
    nx, ny = int(round(cw / r)), int(round(ch / r))
    sx, sy = int(round(-ox / r)), int(round(-oy / r))

    def place(m):
        out = np.zeros((ny, nx), bool)
        hh, ww = m.shape
        a0, b0 = max(0, sy), max(0, sx)
        a1, b1 = min(ny, sy + hh), min(nx, sx + ww)
        if a1 > a0 and b1 > b0:
            out[a0:a1, b0:b1] = m[a0 - sy:a1 - sy, b0 - sx:b1 - sx]
        return out
    P = place(union)
    if P.sum() < union.sum() * 0.98:
        raise ValueError("The foam size is smaller than the tools - make it bigger or set it to 0.")
    rb = o.bit_d / 2 / r
    g = (o.bit_d / 2 if o.guide == "bearing" else o.bushing_od / 2) / r
    notes, warn = [], []
    G._tick(progress, "Working out the router path...")
    tol = max(1.0, 0.25 / r)                              # ignore pixel-level slivers

    def significant(m):
        m = ndi.binary_opening(m, iterations=int(round(tol)))
        lab, n = ndi.label(m)
        if n:
            sz = ndi.sum(m, lab, range(1, n + 1)) * r * r
            m &= np.isin(lab, 1 + np.flatnonzero(sz >= 0.8))
        return m
    if o.mode == "internal":
        Q = ndi.distance_transform_edt(P) >= rb + 0.5     # bit centres whose cutter stays inside the pockets
        cut = ndi.distance_transform_edt(~Q) <= rb + 0.5
        missed = significant(P & ~cut)
        if o.relief and missed.any():
            # let the bit reach every corner: centres in the missed bits, pulled back as far as they can go
            reach = ndi.distance_transform_edt(~missed) <= rb * 0.5
            Q |= reach & P
            cut = ndi.distance_transform_edt(~Q) <= rb + 0.5
        hole = _disk_edt(Q, g) if g > 0.3 else Q
        # what the router really cuts through this hole
        Qr = (ndi.distance_transform_edt(hole) >= g + 0.5) if g > 0.3 else hole
        cut = ndi.distance_transform_edt(~Qr) <= rb + 0.5
        cut |= hole & (g <= 0.3)
        over = significant(cut & ~P)
        missed = significant(P & ~cut)
        plate = np.ones((ny, nx), bool)
        rr = min(6.0, o.margin / 3)
        Yg, Xg = np.mgrid[0:ny, 0:nx]
        plate &= G._rrect_sdf((Xg + 0.5) * r, (Yg + 0.5) * r, cw / 2, ch / 2, cw / 2, ch / 2, rr) <= 0
        if o.holes and o.margin >= 12:
            for cxm in (o.margin / 2, cw - o.margin / 2):
                for cym in (o.margin / 2, ch - o.margin / 2):
                    plate &= np.hypot((Xg + 0.5) * r - cxm, (Yg + 0.5) * r - cym) > 2.25
        template = plate & ~hole
        if (hole & ~_disk_edt(plate, 3.0 / r, grow=False)).any():
            warn.append("A hole runs too close to the template's edge - add margin.")
    else:
        # external: keep the shapes, the bearing runs round the outside of each piece
        # each shape on its own (a round bit leaves its inside corners filled: a closing)
        keep = np.zeros_like(P)
        template = np.zeros_like(P)
        for sh in shapes:
            if sh["name"] == "scoop":
                continue
            pm = place(sh["mask"])
            grown = _disk_edt(pm, rb)
            keep |= _disk_edt(grown, rb, grow=False)
            template |= _disk_edt(grown, g, grow=False) if g > 0.3 else _disk_edt(grown, rb, grow=False)
        P = np.zeros_like(P)
        for sh in shapes:
            if sh["name"] != "scoop":
                P |= place(sh["mask"])
        cut = ~keep
        over = P & ~keep
        missed = keep & ~P
        if o.holes:
            # a small hole in each piece to pin it down
            lab, n = ndi.label(template)
            for i in range(1, n + 1):
                d = ndi.distance_transform_edt(lab == i)
                if d.max() * r > 6:
                    cy_, cx_ = np.unravel_index(np.argmax(d), d.shape)
                    Yg, Xg = np.mgrid[0:ny, 0:nx]
                    template &= np.hypot(Xg - cx_, Yg - cy_) * r > 2.25
    a_over, a_miss = over.sum() * r * r, missed.sum() * r * r
    n_pieces = int(ndi.label(template)[1])
    if o.mode == "internal" and n_pieces > 1:
        bits = ndi.label(template)[0]
        sizes = ndi.sum(template, bits, range(1, n_pieces + 1)) * r * r
        small = int((sizes < sizes.max() * 0.5).sum())
        if o.guide == "bushing" and any(sz < 40 for sz in sizes):
            warn.append("Some pockets are closer together than the bushing allows - the wall between them would be "
                        f"cut away. Space the tools at least {o.bushing_od - o.bit_d + 2:.0f} mm apart, or use a bearing bit.")
        if small:
            notes.append(f"{small} loose island(s) (inside tool rings etc.): cut them out too and stick them in place "
                         "with double-sided tape before routing.")
    if o.mode == "internal":
        if a_miss > 3:
            warn.append(f"{a_miss:.0f} mm² of tight corners the {o.bit_d:g} mm bit can't reach "
                        "(tick 'reach every corner' or use a smaller bit).")
        if a_over > 1:
            notes.append(f"The bit cuts {a_over:.0f} mm² extra in tight corners so the tools still fit (red on the preview).")
    else:
        if a_miss > 1:
            notes.append(f"Inside corners will be rounded to the bit's {o.bit_d / 2:g} mm radius ({a_miss:.0f} mm² left on).")
    off = (o.bushing_od - o.bit_d) / 2 if o.guide == "bushing" else 0.0
    if off:
        notes.append(f"Template is offset {off:.2f} mm for the {o.bushing_od:g} mm bushing - use only with that bushing and a {o.bit_d:g} mm bit.")
    else:
        notes.append(f"Use a {o.bit_d:g} mm flush-trim / pattern bit with a bearing the same size as the cutter "
                     f"(template at least {max(6, o.thickness):g} mm thick so the bearing rides on it).")
    depths = sorted({(s['name'], round(s['depth'], 1)) for s in shapes if s['name'] != 'scoop'})
    if depths:
        notes.append("Route depths: " + ", ".join(f"{n} {d:g} mm" for n, d in depths) + ".")
    if max(cw, ch) > max(o.bed_w, o.bed_h) or min(cw, ch) > min(o.bed_w, o.bed_h):
        warn.append(f"The template is {cw:.0f} × {ch:.0f} mm - bigger than the {o.bed_w:.0f} × {o.bed_h:.0f} bed. "
                    "Laser it, or print the paper PDF onto hardboard.")

    G._tick(progress, "Writing the files...")
    outdir.mkdir(parents=True, exist_ok=True)
    for old in outdir.glob(f"{stem}*"):
        old.unlink()
    polys = contours(template, r)
    files = []
    # SVG for the laser: cut red, engrave blue (bit info + names)
    texts = [(cw / 2, min(o.margin / 2, 8) + 2, f"{o.mode} · {o.guide} · {o.bit_d:g} mm bit"
              + (f" · {o.bushing_od:g} mm bushing" if off else ""))]
    for s in shapes:
        if s["name"] == "scoop":
            continue
        pm = place(s["mask"])
        if pm.any():
            yy, xx = np.nonzero(pm)
            texts.append(((xx.mean() + 0.5) * r, ((yy.max() + 1) * r + 4) if o.mode == "internal" else (yy.mean() * r),
                          f"{s['name']} {s['depth']:g} mm"))
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{cw:.2f}mm" height="{ch:.2f}mm" viewBox="0 0 {cw:.3f} {ch:.3f}">',
           '<g fill="none" stroke="#ff0000" stroke-width="0.1">']
    for p in polys:
        svg.append('<path d="M' + " L".join(f"{x:.3f},{y:.3f}" for x, y in p) + ' Z"/>')
    svg.append('</g><g fill="#0000ff" font-family="Arial, sans-serif" font-size="3.5" text-anchor="middle">')
    for x, y, t in texts:
        svg.append(f'<text x="{x:.2f}" y="{min(ch - 2, y):.2f}">{_esc(t)}</text>')
    svg.append('</g></svg>')
    (outdir / f"{stem}.svg").write_text("\n".join(svg))
    files.append(f"{stem}.svg")
    (outdir / f"{stem}.dxf").write_text(_dxf(polys, ch))
    files.append(f"{stem}.dxf")
    # smooth 3D-print plate
    G._tick(progress, "3D-print version...")
    try:
        tris = extrude(polys_ccw_y_up(polys, ch), o.thickness)
        write_stl(outdir / f"{stem}.stl", tris, stem)
        files.append(f"{stem}.stl")
        if not is_watertight(tris):
            warn.append("The 3D-print mesh may need a repair in the slicer.")
    except Exception as e:  # noqa: BLE001
        warn.append(f"3D-print version skipped ({e}).")
        tris = None
    # 1:1 paper, tiled over A4
    try:
        files += G.paper_template(np.ones_like(template), ~template, np.zeros_like(template), r,
                                  outdir / f"{stem}_paper.pdf", title=f"{stem} router template, 1:1")
    except Exception as e:  # noqa: BLE001
        warn.append(f"Paper PDF skipped ({e}).")
    # preview: template grey, pockets outlined, extra cut red, missed orange
    vis = np.full((ny, nx, 3), 235, np.uint8)
    vis[template] = (150, 160, 175)
    vis[over & ~template] = (225, 80, 70)
    vis[missed] = (240, 160, 40)
    edge = P & ~ndi.binary_erosion(P, iterations=max(1, int(0.4 / r)))
    vis[edge] = (30, 30, 30)
    im = Image.fromarray(vis)
    im.thumbnail((1200, 1200))
    d = ImageDraw.Draw(im)
    d.text((8, 8), f"{cw:.0f} x {ch:.0f} mm", fill=(40, 40, 40))
    im.save(outdir / f"{stem}_preview.png")
    files.append(f"{stem}_preview.png")
    if o.cnc and cnc is not None:
        f2, n2, w2 = cnc_pockets(shapes, place, cw, ch, r, o, cnc, outdir, stem, progress)
        files += f2
        notes += n2
        warn += w2
    info = {"size_mm": [round(cw, 1), round(ch, 1)], "mode": o.mode, "files": files, "preview": f"{stem}_preview.png",
            "notes": notes, "warnings": warn, "pieces": n_pieces,
            "part_info": [{"name": "template", "file": f"{stem}.stl", "colour": "#c9a227"}] if tris is not None else [],
            "triangles": int(len(tris)) if tris is not None else 0}
    return info


def polys_ccw_y_up(polys, ch):
    """SVG y runs down; the 3D model's y runs up (so it reads the same from above)."""
    return [np.c_[p[:, 0], ch - p[:, 1]] for p in polys]


def _esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _dxf(polys, ch):
    """Minimal R12 DXF: one closed POLYLINE per outline, mm, y up."""
    out = ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", "4", "0", "ENDSEC",
           "0", "SECTION", "2", "ENTITIES"]
    for p in polys:
        out += ["0", "POLYLINE", "8", "CUT", "66", "1", "70", "1"]
        for x, y in p:
            out += ["0", "VERTEX", "8", "CUT", "10", f"{x:.4f}", "20", f"{ch - y:.4f}"]
        out += ["0", "SEQEND"]
    out += ["0", "ENDSEC", "0", "EOF"]
    return "\n".join(out) + "\n"


def cnc_pockets(shapes, place, cw, ch, r, o: RouterOpts, cnc: dict, outdir: Path, stem: str, progress=None):
    """G-code to cut the pockets straight into foam or wood (no template
    needed), each tool to its own depth, then optionally cut the insert out."""
    from . import cnc as C
    co = C.cnc_opts_from(cnc)
    files, notes, warn = [], [], []
    by_depth = {}
    for sh in shapes:
        pm = place(sh["mask"])
        if pm.any():
            d = round(float(sh["depth"]), 1)
            by_depth[d] = by_depth.get(d, np.zeros_like(pm)) | pm
    stock_t = max(o.foam_t, max(by_depth) if by_depth else 0)
    if o.foam_t > 0 and by_depth and max(by_depth) > o.foam_t - 3:
        warn.append(f"CNC: the deepest pocket is {max(by_depth):g} mm but the stock is {o.foam_t:g} mm - "
                    "it would cut (nearly) through. Use thicker foam, or lower that tool's pocket depth.")
    gw = C.GWriter(co, f"{stem} - pockets", f"{co.tool_d:g} mm end mill", (cw, ch, stock_t),
                   ["Each pocket to its own depth: " + ", ".join(f"{d:g} mm" for d in sorted(by_depth))])
    missed = 0.0
    for i, d in enumerate(sorted(by_depth)):
        G._tick(progress, f"CNC: pockets {d:g} mm deep ({i + 1}/{len(by_depth)})...")
        missed += C.pocket(gw, np.pad(by_depth[d], 1), r, ch, d, co)
    files.append(C.write(gw, outdir / f"{stem}_cnc_1_pockets.nc"))
    C.check_area(gw, co, warn, "pockets")
    gws = [gw]
    mins = gw.minutes()
    if o.foam_t > 0:
        # cut the insert to the foam size (or the template size without its border)
        fw = o.foam_w if o.foam_w > 0 else cw - 2 * o.margin
        fh = o.foam_h if o.foam_h > 0 else ch - 2 * o.margin
        Yg, Xg = np.mgrid[0:int(round(ch / r)), 0:int(round(cw / r))]
        rect = (np.abs((Xg + 0.5) * r - cw / 2) <= fw / 2) & (np.abs((Yg + 0.5) * r - ch / 2) <= fh / 2)
        gc = C.GWriter(co, f"{stem} - cut out the insert", f"{co.tool_d:g} mm end mill", (cw, ch, o.foam_t),
                       [f"Insert {fw:.1f} x {fh:.1f} mm"])
        C.profile(gc, np.pad(rect, 1), r, ch, o.foam_t + co.through, co)
        files.append(C.write(gc, outdir / f"{stem}_cnc_2_cutout.nc"))
        gws.append(gc)
        mins += gc.minutes()
    C.preview(gws, cw, ch, outdir / f"{stem}_cnc.png", "CNC: blue = pockets" + (", orange = cut out" if len(gws) > 1 else ""))
    files.append(f"{stem}_cnc.png")
    notes.append(f"CNC: pockets cut straight into the stock with a {co.tool_d:g} mm bit - about {mins:.0f} min. "
                 f"Stock {cw:.0f} x {ch:.0f} mm; zero X/Y on its bottom-left corner and Z on its top.")
    if missed > 3:
        warn.append(f"CNC: {missed:.0f} mm² of corners are tighter than the {co.tool_d:g} mm bit can reach - "
                    "a smaller bit gets them, or they're fine in squashy foam.")
    return files, notes, warn
