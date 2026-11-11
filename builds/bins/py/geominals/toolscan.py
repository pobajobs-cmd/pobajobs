"""Tool scanning for Gridfinity bins - all local, OpenCV only.

* Outline from one photo: lay tools on paper (plain A4/A3/Letter, or the
  printable Geominals scan sheet with markers), photograph from above. The
  paper (or the markers) gives the scale and fixes the perspective, then the
  tools are separated from the white paper and traced in millimetres.
* 3D from a few photos: the scan sheet's markers let us work out where the
  camera was for every photo (and its focal length), so photos from four
  sides can be combined by "visual hull" carving into a height map of the
  tool. Lay the tool upside down so the side that sits in the pocket faces
  the camera.
"""
from __future__ import annotations

import json
import math
import shutil
import time
import uuid
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = ROOT / "tools"
SCAN_DIR = ROOT / "cache" / "scans"
SHEETS = {"A4": (210.0, 297.0), "A3": (297.0, 420.0), "Letter": (215.9, 279.4)}
MARKER_MM = 18.0
MARGIN_MM = 8.0
PPM = 6.0                      # pixels per mm when straightening a photo
DICT = cv2.aruco.DICT_4X4_100


def sheet_dims(sheet) -> tuple:
    """'A4' / 'A3' / 'Letter', or a custom size written '200x150' (mm)."""
    if isinstance(sheet, (tuple, list)):
        return float(sheet[0]), float(sheet[1])
    if sheet in SHEETS:
        return SHEETS[sheet]
    import re
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*", str(sheet))
    if m:
        w, h = float(m.group(1)), float(m.group(2))
        if 40 <= w <= 1500 and 40 <= h <= 1500:
            return w, h
    raise ValueError(f"Unknown paper size {sheet!r} - use A4, A3, Letter or a custom size like 200x150.")


def valid_sheet(sheet) -> str:
    try:
        sheet_dims(sheet)
        return str(sheet).replace(" ", "")
    except ValueError:
        return "A4"


# ------------------------------------------------------------------ sheet
def marker_layout(sheet: str = "A4") -> list:
    """(id, x, y) top-left corners in mm of the markers round the sheet edge."""
    W, H = sheet_dims(sheet)
    m, s = MARGIN_MM, MARKER_MM
    xs = np.linspace(m, W - m - s, max(2, round((W - 2 * m) / 48) + 1))
    ys = np.linspace(m, H - m - s, max(2, round((H - 2 * m) / 48) + 1))
    pos = [(x, ys[0]) for x in xs] + [(xs[-1], y) for y in ys[1:]] + \
          [(x, ys[-1]) for x in xs[-2::-1]] + [(xs[0], y) for y in ys[-2:0:-1]]
    return [(i, float(x), float(y)) for i, (x, y) in enumerate(pos)]


def work_area(sheet: str = "A4"):
    """The blank middle of the scan sheet (x0, y0, x1, y1 in mm)."""
    W, H = sheet_dims(sheet)
    inset = MARGIN_MM + MARKER_MM + 4
    return inset, inset, W - inset, H - inset


def _font(size):
    for name in ("arial.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def make_sheet_pdf(path: Path, sheet: str = "A4") -> Path:
    """The printable scan sheet: markers round the edge, a blank middle for
    the tools and a 100 mm bar to check it printed at the right size."""
    W, H = sheet_dims(sheet)
    dpi = 300
    k = dpi / 25.4
    img = Image.new("L", (int(round(W * k)), int(round(H * k))), 255)
    d = ImageDraw.Draw(img)
    dic = cv2.aruco.getPredefinedDictionary(DICT)
    for mid, x, y in marker_layout(sheet):
        side = int(round(MARKER_MM * k))
        mk = cv2.aruco.generateImageMarker(dic, mid, side)
        img.paste(Image.fromarray(mk), (int(round(x * k)), int(round(y * k))))
    x0, y0, x1, y1 = work_area(sheet)
    d.rectangle([x0 * k, y0 * k, x1 * k, y1 * k], outline=215, width=3)
    f = _font(int(3.2 * k))
    d.text((x0 * k + 10, y0 * k + 10), f"Geominals scan sheet - {sheet} - print at 100% (no 'fit to page')",
           font=f, fill=150)
    # 100 mm check bar
    bx, by = x0 + 4, y1 - 10
    d.rectangle([bx * k, by * k, (bx + 100) * k, (by + 1.2) * k], fill=0)
    for t in range(0, 101, 10):
        d.rectangle([(bx + t) * k - 2, (by - (2.5 if t % 50 else 4)) * k, (bx + t) * k + 2, by * k], fill=0)
    d.text((bx * k, (by + 2) * k), "100 mm - measure this to check the print scale", font=_font(int(2.6 * k)), fill=110)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PDF", resolution=dpi)
    return path


# --------------------------------------------------------------- images
def load_photo(path) -> np.ndarray:
    im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    a = np.asarray(im)
    s = 2600 / max(a.shape[:2])
    if s < 1:
        a = cv2.resize(a, (int(a.shape[1] * s), int(a.shape[0] * s)), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(a[..., ::-1])            # BGR


def exif_focal_px(path, width_px: int):
    try:
        ex = Image.open(path).getexif()
        f35 = ex.get_ifd(0x8769).get(41989) or ex.get(41989)
        if f35:
            return float(f35) / 36.0 * width_px
    except Exception:  # noqa: BLE001
        pass
    return None


def detect_markers(img: np.ndarray, sheet: str):
    """Image points and sheet points (mm) of every scan-sheet marker corner found."""
    dic = cv2.aruco.getPredefinedDictionary(DICT)
    params = cv2.aruco.DetectorParameters()
    params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
    det = cv2.aruco.ArucoDetector(dic, params)
    corners, ids, _ = det.detectMarkers(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
    lay = {i: (x, y) for i, x, y in marker_layout(sheet)}
    img_pts, obj_pts, found = [], [], []
    if ids is not None:
        for c, i in zip(corners, ids.ravel()):
            if int(i) not in lay:
                continue
            x, y = lay[int(i)]
            s = MARKER_MM
            obj_pts += [(x, y), (x + s, y), (x + s, y + s), (x, y + s)]
            img_pts += list(c.reshape(4, 2))
            found.append(int(i))
    return np.array(img_pts, np.float64).reshape(-1, 2), np.array(obj_pts, np.float64).reshape(-1, 2), found


def _order_quad(q):
    q = np.asarray(q, np.float64).reshape(4, 2)
    s, d = q.sum(1), np.diff(q, axis=1).ravel()
    return np.array([q[np.argmin(s)], q[np.argmin(d)], q[np.argmax(s)], q[np.argmax(d)]])


def find_paper(img: np.ndarray):
    """Corners (tl, tr, br, bl) of the largest bright sheet of paper, or None."""
    g = cv2.GaussianBlur(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), (7, 7), 0)
    _, th = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cs, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return None
    c = max(cs, key=cv2.contourArea)
    if cv2.contourArea(c) < 0.1 * img.shape[0] * img.shape[1]:
        return None
    hull = cv2.convexHull(c)
    for eps in (0.01, 0.02, 0.03, 0.05):
        ap = cv2.approxPolyDP(hull, eps * cv2.arcLength(hull, True), True)
        if len(ap) == 4:
            return _order_quad(ap)
    return _order_quad(cv2.boxPoints(cv2.minAreaRect(hull)))


def orient_quad(q, sheet):
    """Turn the corner order so the quad's long side matches the sheet's."""
    W, H = sheet_dims(sheet)
    q = np.asarray(q, np.float64)
    e1, e2 = np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[3] - q[0])
    if (e1 > e2) != (W > H):
        q = np.roll(q, -1, axis=0)
    return q


def sheet_homography(img: np.ndarray, sheet: str):
    """Homography sheet-mm -> image px, how it was found, and markers seen."""
    ip, op, found = detect_markers(img, sheet)
    if len(found) >= 3:
        Hm, _ = cv2.findHomography(op, ip, cv2.RANSAC, 4.0)
        if Hm is not None:
            return Hm, "markers", found
    q = find_paper(img)
    if q is None:
        raise ValueError("Couldn't find the paper or the scan-sheet markers. Photograph from above with the whole "
                         "sheet in view, on a darker surface.")
    W, H = sheet_dims(sheet)
    q = orient_quad(q, sheet)
    dst = np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float64)
    Hm = cv2.getPerspectiveTransform(dst.astype(np.float32), q.astype(np.float32))
    return Hm, "paper", []


def straighten(img: np.ndarray, Hm, sheet: str, ppm: float = PPM) -> np.ndarray:
    W, H = sheet_dims(sheet)
    S = np.diag([ppm, ppm, 1.0])
    M = S @ np.linalg.inv(Hm)                            # image -> sheet px
    return cv2.warpPerspective(img, M, (int(W * ppm), int(H * ppm)), flags=cv2.INTER_AREA,
                               borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))


# ----------------------------------------------------------- segmenting
def _paper_model(lab: np.ndarray, valid: np.ndarray):
    """Smooth paper brightness (lighting falls off across the sheet)."""
    L = lab[..., 0].astype(np.float32)
    H, W = L.shape
    yy, xx = np.mgrid[0:H, 0:W]
    sel = valid & (L > np.percentile(L[valid], 35))
    for _ in range(3):
        ys, xs = np.nonzero(sel)
        if len(ys) > 40000:
            k = np.random.default_rng(0).choice(len(ys), 40000, replace=False)
            ys, xs = ys[k], xs[k]
        xn, yn = xs / W, ys / H
        A = np.c_[np.ones_like(xn), xn, yn, xn * xn, yn * yn, xn * yn]
        coef, *_ = np.linalg.lstsq(A, L[ys, xs], rcond=None)
        X, Y = xx / W, yy / H
        bg = coef[0] + coef[1] * X + coef[2] * Y + coef[3] * X * X + coef[4] * Y * Y + coef[5] * X * Y
        sel = valid & (L > bg - 12)
    ab = lab[..., 1:].astype(np.float32)
    ab0 = np.median(ab[sel], axis=0) if sel.any() else np.array([128, 128], np.float32)
    return bg.astype(np.float32), ab0


def segment(img: np.ndarray, valid: np.ndarray, sens: float = 0.5) -> np.ndarray:
    """Things that aren't paper. sens 0..1: higher catches paler tools (and more shadow)."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    bg, ab0 = _paper_model(lab, valid)
    L = lab[..., 0].astype(np.float32)
    dark = np.clip((bg - L) / np.maximum(bg, 1) * 100, 0, None)
    chroma = np.hypot(lab[..., 1].astype(np.float32) - ab0[0], lab[..., 2].astype(np.float32) - ab0[1])
    score = dark + 1.4 * chroma
    v = score[valid]
    otsu, _ = cv2.threshold(np.clip(v, 0, 255).astype(np.uint8).reshape(-1, 1), 0, 255,
                            cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    thr = max(6.0, float(otsu) * (1.6 - 1.2 * sens))
    m = (score > thr) & valid
    k = max(1, int(round(0.8 * PPM)))
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((k, k), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3 * k, 3 * k), np.uint8)) > 0
    # fill specks and small gaps, but keep real holes (a spanner's ring, scissor handles)
    holes = ndi.binary_fill_holes(m) & ~m
    if holes.any():
        lab, n = ndi.label(holes)
        sizes = ndi.sum(holes, lab, range(1, n + 1)) / PPM ** 2
        small = np.isin(lab, 1 + np.flatnonzero(sizes < 40.0))
        m |= small
    return m


def _sheet_valid(sheet: str, method: str, ppm: float = PPM) -> np.ndarray:
    W, H = sheet_dims(sheet)
    v = np.ones((int(H * ppm), int(W * ppm)), bool)
    e = int(3 * ppm)
    v[:e], v[-e:], v[:, :e], v[:, -e:] = False, False, False, False
    if method == "markers":
        for _, x, y in marker_layout(sheet):
            a, b = int((x - 2) * ppm), int((y - 2) * ppm)
            s = int((MARKER_MM + 4) * ppm)
            v[max(b, 0):b + s, max(a, 0):a + s] = False
    return v


def _contours_mm(mask: np.ndarray, ppm: float) -> list:
    """Outer outline + holes (mm) of a mask, smooth and simplified."""
    from skimage import measure
    f = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), 1.0)
    out = []
    for c in measure.find_contours(f, 0.5):
        c = measure.approximate_polygon(c, 0.6)
        if len(c) >= 4:
            out.append(np.c_[(c[:, 1] - 2) / ppm, (c[:, 0] - 2) / ppm])
    return out


def components(mask: np.ndarray, min_area_mm2: float = 60.0, ppm: float = PPM) -> list:
    lab, n = ndi.label(mask)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab)):
        cm = lab[sl] == i + 1
        if cm.sum() / ppm ** 2 < min_area_mm2:
            continue
        if sl[0].start <= 1 or sl[1].start <= 1 or sl[0].stop >= mask.shape[0] - 1 or sl[1].stop >= mask.shape[1] - 1:
            continue                                     # touches the edge: table, not a tool
        out.append((sl, cm))
    return out


# --------------------------------------------------------- tool records
def _normalise(mask: np.ndarray, ppm: float):
    """Rotate a tool mask so its long axis is horizontal; crop with a margin.
    Returns (mask, angle_deg, M) where M maps original px -> new px."""
    ys, xs = np.nonzero(mask)
    pts = np.c_[xs, ys].astype(np.float64)
    (cx, cy), _, ang = cv2.minAreaRect(pts.astype(np.float32))
    best = None
    for a in (ang, -ang, ang + 90, -ang + 90):
        M = cv2.getRotationMatrix2D((cx, cy), a, 1.0)
        rp = pts @ M[:, :2].T + M[:, 2]
        w, h = np.ptp(rp[:, 0]), np.ptp(rp[:, 1])
        key = (round(w * h, -1), -w)
        if w >= h * 0.98 and (best is None or key < best[0]):
            best = (key, a, M, rp)
    _, a, M, rp = best
    pad = 6 * ppm
    x0, y0 = rp.min(0) - pad
    x1, y1 = rp.max(0) + pad
    M = M.copy()
    M[:, 2] -= (x0, y0)
    size = (int(math.ceil(x1 - x0)) + 1, int(math.ceil(y1 - y0)) + 1)
    rot = cv2.warpAffine(mask.astype(np.uint8), M, size, flags=cv2.INTER_NEAREST) > 0
    return rot, a, M


def _thumb(img_crop, mask, path, height=None):
    vis = img_crop.copy()
    if height is not None:
        hn = np.clip(height / max(height.max(), 1e-6), 0, 1)
        cm = cv2.applyColorMap((hn * 255).astype(np.uint8), cv2.COLORMAP_TURBO)
        vis = np.where(mask[..., None], (0.35 * vis + 0.65 * cm).astype(np.uint8), (vis * 0.45).astype(np.uint8))
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(vis, cs, -1, (40, 170, 255), 2)
    s = 480 / max(vis.shape[:2])
    if s < 1:
        vis = cv2.resize(vis, (int(vis.shape[1] * s), int(vis.shape[0] * s)), interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path), vis)


def paper_corners(photo: Path, sheet: str = "A4") -> dict:
    """Where the paper is in the photo, for the user to check and adjust.
    Corners are in the coordinates of the 'view' image saved next to it."""
    img = load_photo(photo)
    h, w = img.shape[:2]
    view = Path(str(photo) + ".view.jpg")
    cv2.imwrite(str(view), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
    W, H = sheet_dims(sheet)
    method, n = "none", 0
    try:
        Hm, method, found = sheet_homography(img, sheet)
        n = len(found)
        q = cv2.perspectiveTransform(np.array([[[0, 0], [W, 0], [W, H], [0, H]]], np.float64), Hm)[0]
    except ValueError:
        # nothing found: a sensible starting box the user can drag onto the paper
        aspect = W / H
        bh = 0.7 * h
        bw = min(0.7 * w, bh * aspect)
        bh = bw / aspect
        q = np.array([[w / 2 - bw / 2, h / 2 - bh / 2], [w / 2 + bw / 2, h / 2 - bh / 2],
                      [w / 2 + bw / 2, h / 2 + bh / 2], [w / 2 - bw / 2, h / 2 + bh / 2]])
    return {"w": w, "h": h, "view": view.name, "corners": np.round(q, 1).tolist(), "method": method, "markers": n,
            "sheet_mm": [W, H]}


def camera_pose(img_shape, Hm, sheet, photo=None):
    """Camera position over the sheet (mm) from the paper's homography.
    Focal length: the photo's EXIF if it has one, else from the homography
    (only reliable for tilted shots), else a typical phone lens."""
    h, w = img_shape[:2]
    f, src = None, "typical phone lens"
    if photo is not None:
        f = exif_focal_px(photo, max(h, w))
        if f:
            src = "photo's EXIF"
    if not f:
        ests = [e for e in _focal_from_h(Hm, w / 2, h / 2) if 0.5 < e / max(h, w) < 2.0]
        if ests:
            f, src = float(np.median(ests)), "paper's perspective"
    if not f:
        f = 0.78 * max(h, w)
    W, Hs = sheet_dims(sheet)
    obj = np.array([[0, 0, 0], [W, 0, 0], [W, Hs, 0], [0, Hs, 0], [W / 2, Hs / 2, 0]], np.float64)
    img_pts = cv2.perspectiveTransform(obj[None, :, :2], Hm)[0]
    K = np.array([[f, 0, w / 2], [0, f, h / 2], [0, 0, 1.0]])
    ok, rv, tv = cv2.solvePnP(obj, img_pts, K, None, flags=cv2.SOLVEPNP_ITERATIVE)
    if not ok:
        return None
    R, _ = cv2.Rodrigues(rv)
    C = -R.T @ tv.ravel()
    return {"x": round(float(C[0]), 1), "y": round(float(C[1]), 1), "h": round(abs(float(C[2])), 1),
            "tilt": round(math.degrees(math.acos(min(1.0, abs(R[2, 2])))), 1), "focal_from": src}


def parallax_correct(mask, M, cam, thick_mm, ppm=PPM):
    """Tall tools look bigger in a photo (their top is nearer the camera) and
    show their sides away from the lens. Keep only what's inside both the
    outline and the outline shrunk towards the point under the camera by
    (H - t) / H - roughly the tool's real footprint."""
    if not cam or not thick_mm or cam["h"] <= thick_mm * 2:
        return mask
    k = (cam["h"] - float(thick_mm)) / cam["h"]
    n = np.asarray(M) @ np.array([cam["x"] * ppm, cam["y"] * ppm, 1.0])
    A = np.array([[1 / k, 0, n[0] * (1 - 1 / k)], [0, 1 / k, n[1] * (1 - 1 / k)]])
    shrunk = cv2.warpAffine(mask.astype(np.uint8), A, (mask.shape[1], mask.shape[0]),
                            flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP) > 0
    return mask & shrunk


def outline_scan(photo: Path, sheet: str = "A4", sens: float = 0.5, min_area: float = 60.0,
                 corners=None) -> dict:
    """Find every tool in one top-down photo. Returns a scan id with candidates
    (outline, size, preview) waiting to be named and saved. `corners` are the
    paper's corners (tl, tr, br, bl) in the photo if the user placed them."""
    img = load_photo(photo)
    if corners is not None and len(corners) == 4:
        W, H = sheet_dims(sheet)
        q = np.asarray(corners, np.float32).reshape(4, 2)
        dst = np.array([[0, 0], [W, 0], [W, H], [0, H]], np.float32)
        Hm = cv2.getPerspectiveTransform(dst, q)
        _, _, found = detect_markers(img, sheet) if sheet in SHEETS else (None, None, [])
        method = "markers" if len(found) >= 3 else "paper"
    else:
        Hm, method, found = sheet_homography(img, sheet)
    flat = straighten(img, Hm, sheet)
    valid = _sheet_valid(sheet, method)
    mask = segment(flat, valid, sens)
    cam = camera_pose(img.shape, Hm, sheet, photo)
    sid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    sd = SCAN_DIR / sid
    sd.mkdir(parents=True, exist_ok=True)
    cands = []
    comps = components(mask, min_area)
    for k, (sl, cm) in enumerate(comps):
        full = np.zeros_like(mask)
        full[sl] = cm
        nm, ang, M = _normalise(full, PPM)
        crop = cv2.warpAffine(flat, M, (nm.shape[1], nm.shape[0]), flags=cv2.INTER_AREA)
        np.save(sd / f"c{k}_mask.npy", nm)
        cv2.imwrite(str(sd / f"c{k}_crop.jpg"), crop)
        _thumb(crop, nm, sd / f"c{k}_thumb.jpg")
        h, w = nm.shape
        cands.append({"cid": k, "size_mm": [round(w / PPM, 1), round(h / PPM, 1)],
                      "area_cm2": round(cm.sum() / PPM ** 2 / 100, 1), "thumb": f"c{k}_thumb.jpg",
                      "M": np.asarray(M).round(6).tolist()})
    # whole-sheet preview with every candidate numbered
    vis = flat.copy()
    for k, (sl, cm) in enumerate(comps):
        full = np.zeros(mask.shape, np.uint8)
        full[sl] = cm
        cs, _ = cv2.findContours(full, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        cv2.drawContours(vis, cs, -1, (40, 170, 255), 3)
        cy, cx = sl[0].start + (sl[0].stop - sl[0].start) // 2, sl[1].start + (sl[1].stop - sl[1].start) // 2
        cv2.putText(vis, str(k + 1), (cx - 12, cy + 12), cv2.FONT_HERSHEY_SIMPLEX, 1.6, (0, 0, 255), 4)
    cv2.imwrite(str(sd / "sheet.jpg"), cv2.resize(vis, (vis.shape[1] // 2, vis.shape[0] // 2)))
    meta = {"sid": sid, "sheet": str(sheet), "method": "corners" if corners is not None else method,
            "markers": len(found), "candidates": cands, "kind": "outline", "camera": cam}
    (sd / "scan.json").write_text(json.dumps(meta))
    return meta


# ------------------------------------------------------- outline editing
def polys_mm(mask: np.ndarray, ppm: float, tol_mm: float = 0.4) -> list:
    """Editable outline: closed polygons in mm (outer edges and holes) with
    roughly one node per tol_mm of deviation."""
    from skimage import measure
    f = ndi.gaussian_filter(np.pad(mask, 2).astype(np.float32), 0.8)
    out = []
    for c in measure.find_contours(f, 0.5):
        c = measure.approximate_polygon(c, max(0.3, tol_mm * ppm))
        if len(c) < 4:
            continue
        pts = np.c_[(c[:, 1] - 2) / ppm, (c[:, 0] - 2) / ppm][:-1]       # drop the repeated end point
        area = 0.5 * abs(np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1)))
        if area >= 2.0:
            out.append(pts.round(2).tolist())
    return out


def raster_polys(polys, shape, ppm: float) -> np.ndarray:
    """Polygons in mm -> mask (even-odd, so a polygon inside another is a hole)."""
    m = np.zeros(shape, np.uint8)
    ps = [np.round(np.asarray(p, np.float64) * ppm * 8).astype(np.int32) for p in polys if len(p) >= 3]
    if ps:
        cv2.fillPoly(m, ps, 1, lineType=cv2.LINE_8, shift=3)
    return m > 0


def _cand_mask(sd: Path, cid: int, meta: dict, thick=None, parallax=True):
    edited = sd / f"c{cid}_mask_edit.npy"
    if edited.exists():
        return np.load(edited), True
    m = np.load(sd / f"c{cid}_mask.npy")
    cand = next((c for c in meta.get("candidates", []) if c["cid"] == cid), {})
    if parallax and thick and meta.get("camera") and "M" in cand:
        m = parallax_correct(m, cand["M"], meta["camera"], thick)
    return m, False


def candidate_outline(sid: str, cid: int, thick: float = 0.0, parallax: bool = True, tol: float = 0.4) -> dict:
    sd = SCAN_DIR / sid
    meta = json.loads((sd / "scan.json").read_text())
    m, edited = _cand_mask(sd, cid, meta, thick, parallax)
    h, w = m.shape
    return {"w_mm": w / PPM, "h_mm": h / PPM, "image": f"/scans/{sid}/c{cid}_crop.jpg",
            "polys": polys_mm(m, PPM, tol), "edited": edited}


def save_candidate_outline(sid: str, cid: int, polys) -> dict:
    sd = SCAN_DIR / sid
    m0 = np.load(sd / f"c{cid}_mask.npy")
    m = raster_polys(polys, m0.shape, PPM)
    if m.sum() < PPM ** 2 * 4:
        raise ValueError("That outline is empty - keep at least one shape.")
    np.save(sd / f"c{cid}_mask_edit.npy", m)
    crop = cv2.imread(str(sd / f"c{cid}_crop.jpg"))
    hf = sd / f"c{cid}_height.npy"
    _thumb(crop, m, sd / f"c{cid}_thumb.jpg", np.load(hf) * m if hf.exists() else None)
    h, w = m.shape
    ys, xs = np.nonzero(m)
    return {"ok": True, "size_mm": [round((xs.max() - xs.min()) / PPM, 1), round((ys.max() - ys.min()) / PPM, 1)]}


def tool_outline(tid: str, tol: float = 0.4) -> dict:
    rec, m, _ = get_tool(tid)
    ppm = rec.get("ppm", PPM)
    h, w = m.shape
    return {"w_mm": w / ppm, "h_mm": h / ppm, "image": f"/tools/{rec['id']}/photo.jpg", "polys": polys_mm(m, ppm, tol),
            "edited": bool(rec.get("edited"))}


def save_tool_outline(tid: str, polys) -> dict:
    td = TOOLS_DIR / "".join(ch for ch in tid if ch.isalnum())
    rec, m0, hm = get_tool(tid)
    ppm = rec.get("ppm", PPM)
    m = raster_polys(polys, m0.shape, ppm)
    if m.sum() < ppm ** 2 * 4:
        raise ValueError("That outline is empty - keep at least one shape.")
    np.save(td / "mask.npy", m)
    if hm is not None:
        # new areas borrow the nearest known height, removed areas drop out
        known = hm > 0
        if known.any():
            idx = ndi.distance_transform_edt(~known, return_distances=False, return_indices=True)
            hm = hm[idx[0], idx[1]]
        np.save(td / "height.npy", (hm * m).astype(np.float32))
    photo = cv2.imread(str(td / "photo.jpg"))
    _thumb(photo, m, td / "thumb.jpg", (hm * m) if hm is not None else None)
    rec["outline"] = [c.round(2).tolist() for c in _contours_mm(m, ppm)]
    rec["edited"] = True
    rec.pop("scoops", None)
    rec["created"] = time.time()
    (td / "tool.json").write_text(json.dumps(rec))
    return rec


# ------------------------------------------------------------- 3D scan
def _focal_from_h(Hm, cx, cy):
    """Focal length (px) from one plane homography, square pixels, known centre."""
    T = np.array([[1, 0, -cx], [0, 1, -cy], [0, 0, 1.0]])
    h = T @ Hm
    h1, h2 = h[:, 0], h[:, 1]
    ests = []
    d1 = h1[2] * h2[2]
    if abs(d1) > 1e-12:
        v = -(h1[0] * h2[0] + h1[1] * h2[1]) / d1
        if v > 0:
            ests.append(math.sqrt(v))
    d2 = h1[2] ** 2 - h2[2] ** 2
    if abs(d2) > 1e-12:
        v = -(h1[0] ** 2 + h1[1] ** 2 - h2[0] ** 2 - h2[1] ** 2) / d2
        if v > 0:
            ests.append(math.sqrt(v))
    return ests


def scan3d(photos: list, sheet: str = "A4", sens: float = 0.5, zmax: float = 60.0, min_area: float = 60.0,
           progress=None, max_h: float = 0.0) -> dict:
    """Height maps of the tools from 3-6 photos of the scan sheet: one from
    straight above plus several from round the sides (about 40-60 degrees from
    flat). The tools should lie upside down."""
    views = []
    for ph in photos:
        img = load_photo(ph)
        ip, op, found = detect_markers(img, sheet)
        if len(found) < 4:
            continue
        views.append({"path": ph, "img": img, "ip": ip, "op": op, "found": found})
    if len(views) < 2:
        raise ValueError("Need at least 2 photos where the scan-sheet markers are visible (4 or more markers each).")
    # focal length: from the angled views' homographies (and EXIF as a hint)
    fs = []
    for v in views:
        h_, w_ = v["img"].shape[:2]
        v["c"] = (w_ / 2, h_ / 2)
        Hm, _ = cv2.findHomography(v["op"], v["ip"], cv2.RANSAC, 4.0)
        v["H"] = Hm
        fs += [f / max(h_, w_) for f in _focal_from_h(Hm, *v["c"]) if 0.3 < f / max(h_, w_) < 3]
    if not fs:
        ex = exif_focal_px(views[0]["path"], max(views[0]["img"].shape[:2]))
        fs = [ex / max(views[0]["img"].shape[:2])] if ex else [0.85]
    frel = float(np.median(fs))
    W, Hs = sheet_dims(sheet)
    for v in views:
        h_, w_ = v["img"].shape[:2]
        f = frel * max(h_, w_)
        K = np.array([[f, 0, v["c"][0]], [0, f, v["c"][1]], [0, 0, 1.0]])
        obj = np.c_[v["op"], np.zeros(len(v["op"]))]
        ok, rv, tv = cv2.solvePnP(obj, v["ip"], K, None, flags=cv2.SOLVEPNP_ITERATIVE)
        R, _ = cv2.Rodrigues(rv)
        v.update(K=K, R=R, t=tv.ravel())
        v["tilt"] = math.degrees(math.acos(min(1.0, abs(R[2, 2]))))       # 0 = straight down
        proj, _ = cv2.projectPoints(obj, rv, tv, K, None)
        v["err"] = float(np.sqrt(np.mean(np.sum((proj.reshape(-1, 2) - v["ip"]) ** 2, 1))))
    top = min(views, key=lambda v: v["tilt"])
    if progress:
        progress("Finding the tools in the top view...")
    flat = straighten(top["img"], top["H"], sheet)
    valid = _sheet_valid(sheet, "markers")
    tmask = segment(flat, valid, sens)
    comps = components(tmask, min_area)
    # silhouettes in every view (only trusted inside the blank middle of the sheet)
    x0, y0, x1, y1 = work_area(sheet)
    for v in views:
        img = v["img"]
        h_, w_ = img.shape[:2]
        quad = cv2.perspectiveTransform(np.array([[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]], np.float64), v["H"])[0]
        inside = np.zeros((h_, w_), np.uint8)
        cv2.fillConvexPoly(inside, np.round(quad).astype(np.int32), 1)
        inside = cv2.erode(inside, np.ones((9, 9), np.uint8)) > 0
        v["paper"] = inside
        v["sil"] = segment(img, inside, sens) if inside.any() else inside
        v["sil"] = cv2.dilate(v["sil"].astype(np.uint8), np.ones((5, 5), np.uint8)) > 0   # be generous
    sid = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:4]
    sd = SCAN_DIR / sid
    sd.mkdir(parents=True, exist_ok=True)
    res_xy, res_z = 0.75, 0.5
    zs = np.arange(res_z / 2, zmax, res_z)
    cands = []
    for k, (sl, cm) in enumerate(comps):
        if progress:
            progress(f"Carving tool {k + 1}/{len(comps)} from {len(views)} photos...")
        full = np.zeros(tmask.shape, bool)
        full[sl] = cm
        # carve on a grid in sheet mm
        ys, xs = np.nonzero(full)
        gx0, gx1 = xs.min() / PPM - 3, xs.max() / PPM + 3
        gy0, gy1 = ys.min() / PPM - 3, ys.max() / PPM + 3
        gxs = np.arange(gx0, gx1, res_xy)
        gys = np.arange(gy0, gy1, res_xy)
        GX, GY = np.meshgrid(gxs, gys)
        foot = cv2.remap(full.astype(np.float32), (GX * PPM).astype(np.float32), (GY * PPM).astype(np.float32),
                         cv2.INTER_LINEAR) > 0.5
        cols = np.flatnonzero(foot.ravel())
        keep = np.ones((len(cols), len(zs)), bool)
        seen = np.zeros((len(cols), len(zs)), np.int16)
        X = GX.ravel()[cols]
        Y = GY.ravel()[cols]
        for v in views:
            if v is top or v["tilt"] < 12:
                continue                                  # straight-down views say nothing about height
            for zi, z in enumerate(zs):
                P = np.c_[X, Y, np.full(len(X), -z)]
                cam = P @ v["R"].T + v["t"]
                uv = cam[:, :2] / cam[:, 2:3] * v["K"][0, 0] + np.array(v["c"])
                u = np.round(uv[:, 0]).astype(int)
                w_ = np.round(uv[:, 1]).astype(int)
                h_, wd = v["sil"].shape
                inimg = (u >= 0) & (u < wd) & (w_ >= 0) & (w_ < h_)
                known = np.zeros(len(u), bool)
                known[inimg] = v["paper"][w_[inimg], u[inimg]]
                sil = np.zeros(len(u), bool)
                sil[inimg] = v["sil"][w_[inimg], u[inimg]]
                keep[:, zi] &= ~known | sil
                seen[:, zi] += known
        # height = how many levels stay solid going up from the paper
        carved = ~keep
        first = np.where(carved.any(1), carved.argmax(1), len(zs))
        hcol = (first * res_z).astype(np.float32)
        # columns no photo could see the top of (off the sheet in every view) borrow their neighbours' height
        top_seen = seen[np.arange(len(cols)), np.clip(first - 1, 0, len(zs) - 1)] > 0
        hm_all = np.full(foot.shape, np.nan, np.float32)
        hm_all.ravel()[cols] = np.where(top_seen | (first == 0), hcol, np.nan)
        bad = np.isnan(hm_all) & foot
        if bad.any() and (~np.isnan(hm_all) & foot).any():
            idx = ndi.distance_transform_edt(np.isnan(hm_all) | ~foot, return_distances=False, return_indices=True)
            hm_all[bad] = hm_all[idx[0][bad], idx[1][bad]]
        hcol = np.nan_to_num(hm_all.ravel()[cols])
        if max_h:
            hcol = np.minimum(hcol, max_h)
        hm = np.zeros(foot.shape, np.float32)
        hm.ravel()[cols] = hcol
        hm = ndi.median_filter(hm, 3) * foot
        # tool record on the same normalised grid as the outline (PPM px/mm)
        nm, ang, M = _normalise(full, PPM)
        hm_px = cv2.warpAffine(cv2.resize(hm, (int(len(gxs) * res_xy * PPM), int(len(gys) * res_xy * PPM)),
                                          interpolation=cv2.INTER_LINEAR),
                               _shift_affine(M, gx0 * PPM, gy0 * PPM), (nm.shape[1], nm.shape[0]),
                               flags=cv2.INTER_LINEAR) * nm
        crop = cv2.warpAffine(flat, M, (nm.shape[1], nm.shape[0]), flags=cv2.INTER_AREA)
        np.save(sd / f"c{k}_mask.npy", nm)
        np.save(sd / f"c{k}_height.npy", hm_px.astype(np.float32))
        cv2.imwrite(str(sd / f"c{k}_crop.jpg"), crop)
        _thumb(crop, nm, sd / f"c{k}_thumb.jpg", hm_px)
        h, w = nm.shape
        cands.append({"cid": k, "size_mm": [round(w / PPM, 1), round(h / PPM, 1)],
                      "height_mm": round(float(np.percentile(hm_px[nm], 98)) if nm.any() else 0, 1),
                      "thumb": f"c{k}_thumb.jpg", "has_height": True})
    cv2.imwrite(str(sd / "sheet.jpg"), cv2.resize(flat, (flat.shape[1] // 2, flat.shape[0] // 2)))
    meta = {"sid": sid, "sheet": sheet, "method": "markers", "kind": "3d", "candidates": cands,
            "views": len(views), "angled_views": sum(1 for v in views if v["tilt"] >= 12 and v is not top),
            "focal": round(frel, 3), "reproj_px": round(float(np.median([v["err"] for v in views])), 2)}
    (sd / "scan.json").write_text(json.dumps(meta))
    return meta


def _shift_affine(M, dx, dy):
    """M maps sheet px -> tool px; return the map for a grid that starts at (dx, dy) sheet px."""
    M2 = M.copy()
    M2[:, 2] = M[:, :2] @ np.array([dx, dy]) + M[:, 2]
    return M2


# --------------------------------------------------------------- library
def save_tool(sid: str, cid: int, name: str, depth: float = 0.0, flip: bool = False, parallax: bool = True) -> dict:
    sd = SCAN_DIR / sid
    meta = json.loads((sd / "scan.json").read_text())
    tid = uuid.uuid4().hex[:10]
    td = TOOLS_DIR / tid
    td.mkdir(parents=True, exist_ok=True)
    mask, edited = _cand_mask(sd, cid, meta, depth if not meta.get("kind") == "3d" else 0, parallax)
    if flip:                                                # photographed upside down: mirror it
        mask = mask[:, ::-1]
    np.save(td / "mask.npy", mask)
    hfile = sd / f"c{cid}_height.npy"
    has_h = hfile.exists()
    if has_h:
        hm = np.load(hfile)
        hm = hm[:, ::-1] if flip else hm
        np.save(td / "height.npy", (hm * mask).astype(np.float32))
    crop = cv2.imread(str(sd / f"c{cid}_crop.jpg"))
    if flip:
        crop = crop[:, ::-1]
    cv2.imwrite(str(td / "photo.jpg"), crop)
    _thumb(crop, mask, td / "thumb.jpg", np.load(td / "height.npy") if has_h else None)
    h, w = mask.shape
    if not depth:
        depth = float(np.percentile(np.load(td / "height.npy")[mask], 98)) if has_h else 10.0
    rec = {"id": tid, "name": name.strip()[:60] or "Tool", "ppm": PPM, "size_mm": [round(w / PPM, 1), round(h / PPM, 1)],
           "depth": round(float(depth), 1), "has_height": has_h, "flip": bool(flip), "created": time.time(),
           "outline": [c.round(2).tolist() for c in _contours_mm(mask, PPM)]}
    (td / "tool.json").write_text(json.dumps(rec))
    return rec


def list_tools() -> list:
    out = []
    if TOOLS_DIR.exists():
        for f in sorted(TOOLS_DIR.glob("*/tool.json"), key=lambda p: p.stat().st_mtime):
            try:
                out.append(json.loads(f.read_text()))
            except (OSError, ValueError):
                pass
    return out


def get_tool(tid: str):
    td = TOOLS_DIR / "".join(ch for ch in tid if ch.isalnum())
    rec = json.loads((td / "tool.json").read_text())
    mask = np.load(td / "mask.npy")
    hm = np.load(td / "height.npy") if (td / "height.npy").exists() else None
    return rec, mask, hm


def update_tool(tid: str, **kw) -> dict:
    td = TOOLS_DIR / "".join(ch for ch in tid if ch.isalnum())
    rec = json.loads((td / "tool.json").read_text())
    for k in ("name", "depth"):
        if k in kw and kw[k] is not None:
            rec[k] = kw[k] if k == "name" else round(float(kw[k]), 1)
    (td / "tool.json").write_text(json.dumps(rec))
    return rec


def delete_tool(tid: str) -> None:
    td = TOOLS_DIR / "".join(ch for ch in tid if ch.isalnum())
    if td.is_dir() and td.parent == TOOLS_DIR:
        shutil.rmtree(td)


def manual_tool(name: str, shape: str, w: float, h: float, depth: float) -> dict:
    """A simple tool typed in by size (rectangle, rounded rectangle, circle) for
    things you can't easily photograph, e.g. a battery or a tape measure."""
    ppm = PPM
    pad = int(6 * ppm)
    if shape == "hex":
        h = w / math.cos(math.radians(30))            # corner to corner
        w, h = h, w
    W, H = int(w * ppm) + 2 * pad, int(h * ppm) + 2 * pad
    m = np.zeros((H, W), np.uint8)
    if shape == "circle":
        cv2.ellipse(m, (W // 2, H // 2), (int(w * ppm / 2), int(h * ppm / 2)), 0, 0, 360, 1, -1)
    elif shape == "hex":
        # w = across the flats (a 1/4" hex bit is 6.35), flats top and bottom
        R = w * ppm / 2 / math.cos(math.radians(30))
        pts = [(W / 2 + R * math.cos(math.radians(a)), H / 2 + R * math.sin(math.radians(a))) for a in range(0, 360, 60)]
        cv2.fillPoly(m, [np.round(np.array(pts)).astype(np.int32)], 1)
    else:
        r = int(min(w, h) * ppm * (0.25 if shape == "rounded" else 0.0))
        x0, y0, x1, y1 = pad, pad, W - pad, H - pad
        cv2.rectangle(m, (x0 + r, y0), (x1 - r, y1), 1, -1)
        cv2.rectangle(m, (x0, y0 + r), (x1, y1 - r), 1, -1)
        if r:
            for cx, cy in ((x0 + r, y0 + r), (x1 - r, y0 + r), (x0 + r, y1 - r), (x1 - r, y1 - r)):
                cv2.circle(m, (cx, cy), r, 1, -1)
    mask = m > 0
    tid = uuid.uuid4().hex[:10]
    td = TOOLS_DIR / tid
    td.mkdir(parents=True, exist_ok=True)
    np.save(td / "mask.npy", mask)
    photo = np.full((H, W, 3), 235, np.uint8)
    photo[mask] = (120, 120, 120)
    cv2.imwrite(str(td / "photo.jpg"), photo)
    _thumb(photo, mask, td / "thumb.jpg")
    rec = {"id": tid, "name": name.strip()[:60] or shape.title(), "ppm": ppm,
           "size_mm": [round(W / ppm, 1), round(H / ppm, 1)], "depth": round(float(depth), 1),
           "has_height": False, "flip": False, "created": time.time(),
           "outline": [c.round(2).tolist() for c in _contours_mm(mask, ppm)]}
    (td / "tool.json").write_text(json.dumps(rec))
    return rec


def import_outline(path, name: str, length_mm: float = 0.0, dpi: float = 0.0, depth: float = 10.0,
                   sens: float = 0.5) -> dict:
    """A tool from a picture of its outline: a flatbed scan (give the DPI), a
    transparent PNG, or a dark silhouette on white (give its real length).
    Takes the biggest shape in the picture."""
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if "A" in im.getbands() and np.asarray(im.getchannel("A")).min() < 128:
        mask = np.asarray(im.getchannel("A")) > 127
    else:
        g = np.asarray(im.convert("L"), np.float32)
        g = cv2.GaussianBlur(g, (0, 0), max(1.0, max(g.shape) / 1500))
        t, _ = cv2.threshold(g.astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        t = t + (sens - 0.5) * 60
        mask = g < t
        if mask.mean() > 0.6:                          # light shape on a dark background
            mask = ~mask
    lab, n = ndi.label(mask)
    if not n:
        raise ValueError("Couldn't find a shape in that picture - use a dark tool on a white background.")
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    keep = lab == 1 + int(np.argmax(sizes))
    keep = ndi.binary_opening(keep, iterations=1)
    ys, xs = np.nonzero(keep)
    if dpi and dpi > 20:
        src_ppm = dpi / 25.4
    elif length_mm and length_mm > 1:
        (cx, cy), (rw, rh), _ = cv2.minAreaRect(np.c_[xs, ys].astype(np.float32))
        src_ppm = max(rw, rh) / length_mm
    else:
        raise ValueError("Give the tool's real length in mm, or the scanner's DPI.")
    s_ = PPM / src_ppm
    crop = keep[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    small = cv2.resize(crop.astype(np.float32), (max(2, int(round(crop.shape[1] * s_))),
                                                 max(2, int(round(crop.shape[0] * s_)))),
                       interpolation=cv2.INTER_AREA) > 0.5
    full = np.pad(small, int(10 * PPM))
    nm, ang, M = _normalise(full, PPM)
    tid = uuid.uuid4().hex[:10]
    td = TOOLS_DIR / tid
    td.mkdir(parents=True, exist_ok=True)
    np.save(td / "mask.npy", nm)
    photo = np.full(nm.shape + (3,), 235, np.uint8)
    photo[nm] = (110, 110, 110)
    cv2.imwrite(str(td / "photo.jpg"), photo)
    _thumb(photo, nm, td / "thumb.jpg")
    h, w = nm.shape
    rec = {"id": tid, "name": name.strip()[:60] or "Imported tool", "ppm": PPM,
           "size_mm": [round(w / PPM, 1), round(h / PPM, 1)], "depth": round(float(depth), 1),
           "has_height": False, "flip": False, "created": time.time(), "source": "import",
           "outline": [c.round(2).tolist() for c in _contours_mm(nm, PPM)]}
    (td / "tool.json").write_text(json.dumps(rec))
    return rec
