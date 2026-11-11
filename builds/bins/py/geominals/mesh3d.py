"""Watertight meshes for 3D printing, built straight from pixel masks.

Every inside pixel becomes a column: a top face, a bottom face, and side
walls wherever its neighbour is outside. Corners are shared between
neighbouring pixels, so the result is closed and manifold (every edge
belongs to exactly two triangles) - slicers accept it without repair.
Variable-height tops (lithophanes) are smoothed by averaging the heights
around each corner.
"""
from __future__ import annotations

import io
import struct
import zipfile
from pathlib import Path

import numpy as np


def fix_diagonals(mask: np.ndarray) -> np.ndarray:
    """Pixels touching only at a corner make non-manifold edges. Fill one
    pixel of every such checkerboard pair (repeat until none are left)."""
    m = np.asarray(mask, bool).copy()
    for _ in range(20):
        a, b, c, d = m[:-1, :-1], m[:-1, 1:], m[1:, :-1], m[1:, 1:]
        diag = a & d & ~b & ~c            # top-left + bottom-right
        anti = b & c & ~a & ~d            # top-right + bottom-left
        if not (diag.any() or anti.any()):
            break
        m[:-1, 1:] |= diag
        m[:-1, :-1] |= anti
    return m


def column_mesh(mask: np.ndarray, z0, z1, px: float) -> np.ndarray:
    """Triangles (N,3,3) in mm for `mask` extruded from z0 up to z1.

    z0 and z1 are numbers, or HxW arrays of per-pixel bottom / top heights
    (a shaped underside like a Gridfinity foot, or a shaped top). Heights are
    averaged round each pixel corner, so neighbouring pixels share vertices
    and the mesh stays closed.
    Image row 0 ends up at the back (largest Y), so it reads correctly
    when viewed from above.
    """
    m = fix_diagonals(mask)
    H, W = m.shape
    if not m.any():
        return np.zeros((0, 3, 3), np.float32)
    added = m & ~np.asarray(mask, bool)

    def corner_field(z, grow):
        if np.isscalar(z):
            return np.full((H + 1, W + 1), float(z), np.float32)
        z = np.asarray(z, np.float64)
        if added.any():                      # pixels filled by fix_diagonals take a neighbour's height
            from scipy import ndimage as ndi
            fill = (ndi.maximum_filter(np.where(mask, z, -np.inf), 3) if grow
                    else -ndi.maximum_filter(np.where(mask, -z, -np.inf), 3))
            z = np.where(added, fill, z)
            z[~np.isfinite(z)] = 0.0
        zp = np.where(m, z, 0).astype(np.float64)
        cnt = m.astype(np.float64)
        S = np.zeros((H + 1, W + 1))
        C = np.zeros((H + 1, W + 1))
        for dy in (0, 1):
            for dx in (0, 1):
                S[dy:dy + H, dx:dx + W] += zp
                C[dy:dy + H, dx:dx + W] += cnt
        return (S / np.maximum(C, 1)).astype(np.float32)

    ztc = corner_field(z1, True)
    zbc = corner_field(z0, False)
    ztc = np.maximum(ztc, zbc + 0.05)
    X = np.arange(W + 1, dtype=np.float32) * px
    Y = (H - np.arange(H + 1, dtype=np.float32)) * px
    ys, xs = np.nonzero(m)

    def P(yy, xx, top):
        z = ztc[yy, xx] if top else zbc[yy, xx]
        return np.stack([X[xx], Y[yy], z], -1)

    corners = {}
    for name, (dy, dx) in dict(a=(0, 0), b=(0, 1), c=(1, 1), d=(1, 0)).items():
        corners[name + "t"] = P(ys + dy, xs + dx, True)
        corners[name + "b"] = P(ys + dy, xs + dx, False)
    k = corners
    groups = [
        (np.stack([k["at"], k["bt"], k["ct"]], 1), (0, 0, 1)),
        (np.stack([k["at"], k["ct"], k["dt"]], 1), (0, 0, 1)),
        (np.stack([k["ab"], k["bb"], k["cb"]], 1), (0, 0, -1)),
        (np.stack([k["ab"], k["cb"], k["db"]], 1), (0, 0, -1)),
    ]
    pad = np.pad(m, 1)
    edges = [  # (outside neighbour test, corner p, corner q, outward direction)
        (~pad[ys, xs + 1], "a", "b", (0, 1, 0)),        # pixel above (towards +Y)
        (~pad[ys + 2, xs + 1], "d", "c", (0, -1, 0)),   # pixel below
        (~pad[ys + 1, xs], "a", "d", (-1, 0, 0)),       # left
        (~pad[ys + 1, xs + 2], "b", "c", (1, 0, 0)),    # right
    ]
    for sel, p, q, out in edges:
        if not sel.any():
            continue
        pt, qt, pb, qb = k[p + "t"][sel], k[q + "t"][sel], k[p + "b"][sel], k[q + "b"][sel]
        groups.append((np.stack([pt, qt, qb], 1), out))
        groups.append((np.stack([pt, qb, pb], 1), out))
    tris = []
    for t, out in groups:
        n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
        flip = (n @ np.asarray(out, np.float32)) < 0
        t = t.copy()
        t[flip, 1], t[flip, 2] = t[flip, 2].copy(), t[flip, 1].copy()
        tris.append(t)
    return np.concatenate(tris).astype(np.float32)


def is_watertight(tris: np.ndarray) -> bool:
    """Every undirected edge used exactly twice, in opposite directions."""
    if not len(tris):
        return True
    v = np.round(tris.reshape(-1, 3), 4)
    _, idx = np.unique(v, axis=0, return_inverse=True)
    f = idx.reshape(-1, 3)
    e = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    directed = {tuple(x) for x in e.tolist()}
    if len(directed) != len(e):
        return False
    return all((b, a) in directed for a, b in directed)


def write_stl(path, tris: np.ndarray, name: str = "geominals") -> None:
    tris = np.asarray(tris, np.float32)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    rec = np.zeros(len(tris), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = n, tris
    with open(path, "wb") as fh:
        fh.write(name.encode()[:80].ljust(80, b" "))
        fh.write(struct.pack("<I", len(tris)))
        fh.write(rec.tobytes())


def write_3mf(path, bodies) -> None:
    """bodies: list of (name, triangles, '#rrggbb'). One object per body, so
    Bambu Studio / Orca / Prusa can give each its own filament."""
    out = io.StringIO()
    out.write('<?xml version="1.0" encoding="UTF-8"?>\n'
              '<model unit="millimeter" xml:lang="en-US" '
              'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n'
              ' <metadata name="Application">Geominals</metadata>\n <resources>\n'
              '  <basematerials id="1">\n')
    for name, _, col in bodies:
        out.write(f'   <base name="{name}" displaycolor="{col.upper()}FF"/>\n')
    out.write('  </basematerials>\n')
    for k, (name, tris, _) in enumerate(bodies):
        v = np.round(np.asarray(tris).reshape(-1, 3), 4)
        uv, idx = np.unique(v, axis=0, return_inverse=True)
        f = idx.reshape(-1, 3)
        out.write(f'  <object id="{k + 2}" type="model" name="{name}" pid="1" pindex="{k}">\n'
                  '   <mesh>\n    <vertices>\n')
        out.write("".join(f'     <vertex x="{x:.4f}" y="{y:.4f}" z="{z:.4f}"/>\n' for x, y, z in uv))
        out.write('    </vertices>\n    <triangles>\n')
        out.write("".join(f'     <triangle v1="{a}" v2="{b}" v3="{c}"/>\n' for a, b, c in f))
        out.write('    </triangles>\n   </mesh>\n  </object>\n')
    out.write(' </resources>\n <build>\n')
    for k in range(len(bodies)):
        out.write(f'  <item objectid="{k + 2}"/>\n')
    out.write(' </build>\n</model>\n')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/'
                   'package/2006/content-types"><Default Extension="rels" ContentType="application/'
                   'vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" '
                   'ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.'
                   'openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" '
                   'Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')
        z.writestr("3D/3dmodel.model", out.getvalue())


def preview_image(heights: list, px: float, colours: list, size: int = 900):
    """Shaded top-down render of stacked bodies (list of HxW height maps,
    0 where absent) for a quick look before slicing."""
    from PIL import Image
    H, W = heights[0].shape
    top = np.zeros((H, W))
    col = np.zeros((H, W, 3))
    for hmap, c in zip(heights, colours):
        rgb = np.array([int(c.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]) / 255.0
        sel = hmap >= top - 1e-6
        sel &= hmap > 0
        top = np.where(sel, hmap, top)
        col[sel] = rgb
    gy, gx = np.gradient(top / px)
    nrm = np.dstack([-gx, -gy, np.ones_like(top)])
    nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    light = np.array([-0.5, 0.6, 0.62])
    light /= np.linalg.norm(light)
    shade = np.clip(0.35 + 0.75 * (nrm @ light), 0, 1.15)
    img = np.clip(col * shade[..., None], 0, 1)
    img[top <= 0] = 1.0
    im = Image.fromarray((img * 255).astype(np.uint8))
    im.thumbnail((size, size), Image.LANCZOS)
    return im
