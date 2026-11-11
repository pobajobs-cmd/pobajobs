"""Web routes for the Gridfinity workspace (tool scanning, bins, baseplates).

gui.py hands any /api/tools*, /api/bins*, /tools/ and /scans/ request here.
Slow work (3D scans, meshing) runs in one background job at a time that the
page polls, like the map jobs.
"""
from __future__ import annotations

import json
import re
import threading
import time
import traceback
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UPLOADS = ROOT / "cache" / "scans" / "uploads"
LAYOUTS = ROOT / "bins"
OUT_SUB = "gridfinity"
JOB = {"id": 0, "running": False, "kind": None, "result": None, "error": None, "status": "", "started": 0.0,
       "cancel": threading.Event()}
_LOCK = threading.Lock()


def _clean(s: str, n=40) -> str:
    return re.sub(r"[^A-Za-z0-9_\- ]", "", str(s or ""))[:n].strip()


def _start(kind, fn):
    if JOB["running"]:
        raise RuntimeError(f"Still busy ({JOB['status'] or JOB['kind']}) - wait or press Cancel.")
    JOB.update(id=JOB["id"] + 1, running=True, kind=kind, result=None, error=None, status="Starting...",
               started=time.time())
    JOB["cancel"].clear()
    jid = JOB["id"]

    def prog(msg=None):
        if JOB["cancel"].is_set():
            return False
        if msg:
            JOB["status"] = msg
        return True

    def run():
        try:
            res = fn(prog)
            if JOB["id"] == jid:
                JOB["result"] = res
        except Exception as e:  # noqa: BLE001
            if JOB["id"] == jid:
                JOB["error"] = "Cancelled." if type(e).__name__ == "Cancelled" else str(e)
                if type(e).__name__ != "Cancelled":
                    traceback.print_exc()
        finally:
            if JOB["id"] == jid:
                JOB["running"] = False
                JOB["status"] = ""
    threading.Thread(target=run, daemon=True).start()
    return {"started": True, "id": jid}


def _prog_raise(prog):
    """toolscan's progress callback only reports; make cancel raise there too."""
    from .gridfinity import Cancelled

    def p(msg=None):
        if prog(msg) is False:
            raise Cancelled()
    return p


def _tool_extra(rec):
    """Add finger-scoop suggestions (cached in tool.json) for the editor."""
    from . import toolscan as TS
    from .gridfinity import scoop_points
    if "scoops" not in rec:
        try:
            r2, mask, _ = TS.get_tool(rec["id"])
            rec["scoops"] = scoop_points(r2, mask)
            td = TS.TOOLS_DIR / rec["id"]
            saved = json.loads((td / "tool.json").read_text())
            saved["scoops"] = rec["scoops"]
            (td / "tool.json").write_text(json.dumps(saved))
        except (OSError, ValueError, KeyError):
            rec["scoops"] = {}
    return rec


def handle_get(h, path, q, out_dir: Path) -> bool:
    """Returns True if the request was handled."""
    from . import toolscan as TS
    if path == "/api/tools":
        h._json({"tools": [_tool_extra(t) for t in TS.list_tools()]})
    elif path.startswith("/tools/") or path.startswith("/scans/"):
        base = TS.TOOLS_DIR if path.startswith("/tools/") else TS.SCAN_DIR
        parts = path.split("/")[2:]
        if len(parts) != 2 or not all(re.fullmatch(r"[A-Za-z0-9_\-.]+", p) and ".." not in p for p in parts):
            h._send(404, b"not found", "text/plain")
            return True
        f = base / parts[0] / parts[1]
        if not f.is_file() or f.suffix.lower() not in (".jpg", ".png", ".json"):
            h._send(404, b"not found", "text/plain")
            return True
        h._send(200, f.read_bytes(), "image/jpeg" if f.suffix == ".jpg" else "image/png"
                if f.suffix == ".png" else "application/json", {"Cache-Control": "no-cache"})
    elif path == "/api/tools/outline":
        tol = min(3.0, max(0.1, float(q.get("tol", ["0.4"])[0])))
        if q.get("tid"):
            h._json(TS.tool_outline(_clean(q["tid"][0], 20), tol))
        else:
            h._json(TS.candidate_outline(_clean(q.get("sid", [""])[0], 40), int(q.get("cid", ["0"])[0]),
                                         float(q.get("thick", ["0"])[0] or 0), q.get("parallax", ["1"])[0] == "1", tol))
    elif path == "/api/tools/sheet":
        size = TS.valid_sheet(q.get("size", ["A4"])[0])
        p = ROOT / "cache" / f"scan_sheet_{size}.pdf"
        p.parent.mkdir(exist_ok=True)
        if not p.exists() or p.stat().st_mtime < Path(TS.__file__).stat().st_mtime:
            TS.make_sheet_pdf(p, size)
        h._send(200, p.read_bytes(), "application/pdf",
                {"Content-Disposition": f'inline; filename="Geominals scan sheet {size}.pdf"'})
    elif path == "/api/bins/status":
        h._json({k: v for k, v in JOB.items() if k != "cancel"} |
                {"seconds": round(time.time() - JOB["started"]) if JOB["running"] else None})
    elif path == "/api/bins/layouts":
        out = []
        if LAYOUTS.exists():
            for f in sorted(LAYOUTS.glob("*.json"), key=lambda p: -p.stat().st_mtime):
                try:
                    d = json.loads(f.read_text())
                    out.append({"name": f.stem, "gx": d["layout"].get("gx"), "gy": d["layout"].get("gy"),
                                "items": len(d["layout"].get("items", [])), "saved": f.stat().st_mtime})
                except (OSError, ValueError, KeyError):
                    pass
        h._json({"layouts": out})
    elif path == "/api/bins/layout":
        f = LAYOUTS / (_clean(q.get("name", [""])[0]) + ".json")
        if not f.is_file():
            h._json({"error": "Not found"}, 404)
        else:
            h._json(json.loads(f.read_text()))
    else:
        return False
    return True


def handle_post(h, path, q, out_dir: Path) -> bool:
    from . import toolscan as TS
    from . import gridfinity as G
    if not (path.startswith("/api/tools") or path.startswith("/api/bins")):
        return False
    if path == "/api/tools/upload":
        body = h._body()
        if len(body) < 1000:
            return h._json({"error": "That photo looks empty."}, 400) or True
        UPLOADS.mkdir(parents=True, exist_ok=True)
        # tidy uploads older than a day
        for old in UPLOADS.glob("*"):
            if old.stat().st_mtime < time.time() - 86400:
                old.unlink(missing_ok=True)
        ext = ".png" if body[:4] == b"\x89PNG" else ".jpg"
        name = uuid.uuid4().hex[:12] + ext
        (UPLOADS / name).write_bytes(body)
        h._json({"file": name})
        return True
    req = json.loads(h._body() or b"{}")
    if path == "/api/tools/detect":
        files = [UPLOADS / f for f in req.get("files", []) if re.fullmatch(r"[0-9a-f]{12}\.(jpg|png)", str(f))]
        files = [f for f in files if f.is_file()]
        if not files:
            raise ValueError("Upload a photo first.")
        sheet = TS.valid_sheet(req.get("sheet", "A4"))
        sens = min(1.0, max(0.0, float(req.get("sens", 0.5))))
        corners = req.get("corners")
        if corners is not None:
            corners = [[float(a), float(b)] for a, b in corners][:4]
            if len(corners) != 4:
                corners = None
        min_area = float(req.get("min_area", 60))
        if req.get("mode") == "3d" and len(files) >= 2:
            max_h = float(req.get("max_h") or 0)
            h._json(_start("scan3d", lambda prog: TS.scan3d(files, sheet, sens, min_area=min_area,
                                                            progress=_prog_raise(prog), max_h=max_h)))
        else:
            if req.get("mode") == "3d":
                raise ValueError("A 3D scan needs at least 2 photos (ideally one from above and 6-8 round the sides).")
            h._json(_start("outline", lambda prog: (prog("Finding the tools..."),
                                                    TS.outline_scan(files[0], sheet, sens, min_area, corners))[1]))
    elif path == "/api/tools/corners":
        f = str(req.get("file", ""))
        if not re.fullmatch(r"[0-9a-f]{12}\.(jpg|png)", f) or not (UPLOADS / f).is_file():
            raise ValueError("Upload the photo first.")
        h._json(TS.paper_corners(UPLOADS / f, TS.valid_sheet(req.get("sheet", "A4"))))
    elif path == "/api/tools/outline-save":
        polys = [[[float(x), float(y)] for x, y in p][:4000] for p in (req.get("polys") or [])][:200]
        if req.get("tid"):
            h._json(_tool_extra(TS.save_tool_outline(_clean(req["tid"], 20), polys)))
        else:
            h._json(TS.save_candidate_outline(_clean(req.get("sid"), 40), int(req.get("cid", 0)), polys))
    elif path == "/api/bins/router":
        from . import router as RT
        o = RT.router_opts_from(req.get("opts") or {})
        name = _clean(req.get("name") or "router_template").replace(" ", "_") or "router_template"
        folder = out_dir / OUT_SUB / name
        layout = req.get("layout") if req.get("source") == "layout" else None
        tid = _clean(req.get("tid"), 20) if req.get("source") == "tool" else None
        bo = G.opts_from(req.get("bin_opts") or {})

        def work(prog):
            info = RT.make_router(o, folder, name, layout=layout, tid=tid, bin_opts=bo, progress=prog,
                                  cnc=req.get("cnc") or {})
            return info | {"folder": str(folder), "rel": folder.relative_to(out_dir).as_posix(), "kind": "router"}
        h._json(_start("router", work))
    elif path == "/api/tools/save":
        sid = _clean(req.get("sid"), 40)
        rec = TS.save_tool(sid, int(req.get("cid", 0)), str(req.get("name", "Tool")),
                           float(req.get("depth") or 0), bool(req.get("flip")), bool(req.get("parallax", True)))
        h._json(_tool_extra(rec))
    elif path == "/api/tools/update":
        h._json(TS.update_tool(_clean(req.get("id"), 20), name=req.get("name"), depth=req.get("depth")))
    elif path == "/api/tools/delete":
        TS.delete_tool(_clean(req.get("id"), 20))
        h._json({"ok": True})
    elif path == "/api/tools/manual":
        rec = TS.manual_tool(str(req.get("name", "")), str(req.get("shape", "rect")),
                             max(2.0, min(400.0, float(req.get("w", 20)))),
                             max(2.0, min(400.0, float(req.get("h", 20)))),
                             max(1.0, min(200.0, float(req.get("depth", 10)))))
        h._json(_tool_extra(rec))
    elif path == "/api/tools/import":
        f = str(req.get("file", ""))
        if not re.fullmatch(r"[0-9a-f]{12}\.(jpg|png)", f) or not (UPLOADS / f).is_file():
            raise ValueError("Upload the picture first.")
        rec = TS.import_outline(UPLOADS / f, str(req.get("name", "")), float(req.get("length_mm") or 0),
                                float(req.get("dpi") or 0), max(1.0, min(200.0, float(req.get("depth") or 10))),
                                min(1.0, max(0.0, float(req.get("sens", 0.5)))))
        h._json(_tool_extra(rec))
    elif path == "/api/bins/holes-plan":
        h._json(G.plan_holes(G.hole_opts_from(req.get("opts") or {})))
    elif path == "/api/bins/holes":
        o = G.hole_opts_from(req.get("opts") or {})
        name = _clean(req.get("name") or "holes").replace(" ", "_") or "holes"
        folder = out_dir / OUT_SUB / name

        def work(prog):
            info = G.make_holes(o, folder, name, progress=prog)
            return info | {"folder": str(folder), "rel": folder.relative_to(out_dir).as_posix(), "kind": "holes"}
        h._json(_start("holes", work))
    elif path == "/api/bins/storage":
        o = G.store_opts_from(req.get("opts") or {})
        name = _clean(req.get("name") or "storage").replace(" ", "_") or "storage"
        folder = out_dir / OUT_SUB / name

        def work(prog):
            info = G.make_storage(o, folder, name, progress=prog)
            return info | {"folder": str(folder), "rel": folder.relative_to(out_dir).as_posix(), "kind": "storage"}
        h._json(_start("storage", work))
    elif path == "/api/bins/arrange":
        o = G.opts_from(req.get("opts") or {})
        h._json(G.arrange(req.get("items") or [], o, int(req.get("gx") or 0), int(req.get("gy") or 0)))
    elif path == "/api/bins/make":
        o = G.opts_from(req.get("opts") or {})
        layout = req.get("layout") or {}
        name = _clean(req.get("name") or "bin").replace(" ", "_") or "bin"
        folder = out_dir / OUT_SUB / name

        def work(prog):
            info = G.make_bin(layout, o, folder, name, progress=prog)
            LAYOUTS.mkdir(exist_ok=True)
            (LAYOUTS / f"{name}.json").write_text(json.dumps({"layout": layout, "opts": req.get("opts") or {}}))
            return info | {"folder": str(folder), "rel": folder.relative_to(out_dir).as_posix(), "kind": "bin"}
        h._json(_start("bin", work))
    elif path == "/api/bins/save-layout":
        name = _clean(req.get("name") or "bin").replace(" ", "_") or "bin"
        LAYOUTS.mkdir(exist_ok=True)
        (LAYOUTS / f"{name}.json").write_text(json.dumps({"layout": req.get("layout") or {},
                                                          "opts": req.get("opts") or {}}))
        h._json({"ok": True, "name": name})
    elif path == "/api/bins/baseplate":
        o = G.plate_opts_from(req.get("opts") or {})
        name = _clean(req.get("name") or "baseplate").replace(" ", "_") or "baseplate"
        folder = out_dir / OUT_SUB / name

        def work(prog):
            info = G.make_baseplate(o, folder, name, progress=prog)
            return info | {"folder": str(folder), "rel": folder.relative_to(out_dir).as_posix(), "kind": "plate"}
        h._json(_start("plate", work))
    elif path == "/api/bins/cancel":
        JOB["cancel"].set()
        h._json({"ok": True})
    else:
        h._send(404, b"not found", "text/plain")
    return True
