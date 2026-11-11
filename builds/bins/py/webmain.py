"""Runs inside the browser (Pyodide, in a Web Worker) and answers the Bins
page's requests the way gui.py does on the PC, using the same binsapi.py.

The worker writes each request body to /tmp/req, calls handle(), sends the
reply (body in /tmp/resp), then calls run_pending() for any slow job the
request started - so the page gets "started" straight away and polls, just
like on the PC. There are no threads in the browser, so binsapi's background
thread is swapped for one that runs after the reply has gone.
"""
from __future__ import annotations

import io
import json
import mimetypes
import sys
import threading
import traceback
import types
import zipfile
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import js  # the worker's global scope

sys.path.insert(0, "/app")
from geominals import binsapi  # noqa: E402

ROOT = Path("/app")
OUT_DIR = ROOT / "output"
REQ, RESP = Path("/tmp/req"), Path("/tmp/resp")

_PENDING: list = []


class _AfterReplyThread:
    """threading.Thread stand-in: start() queues the work until the reply is sent."""

    def __init__(self, group=None, target=None, name=None, args=(), kwargs=None, daemon=None):
        self._target, self._args, self._kwargs = target, args, kwargs or {}

    def start(self):
        _PENDING.append(self)

    def run(self):
        if self._target:
            self._target(*self._args, **self._kwargs)

    def join(self, timeout=None):
        pass

    def is_alive(self):
        return False


binsapi.threading = types.SimpleNamespace(Thread=_AfterReplyThread, Event=threading.Event, Lock=threading.Lock)


class _ReportingJob(dict):
    """binsapi.JOB that also tells the page each progress message, so the
    progress line keeps moving while Python is busy."""

    def __setitem__(self, k, v):
        super().__setitem__(k, v)
        if k == "status" and v:
            js.gmProgress(str(v))


binsapi.JOB = _ReportingJob(binsapi.JOB)


class _Handler:
    def __init__(self, body: bytes):
        self.body, self.status, self.ctype, self.headers, self.out = body, 200, "application/json", {}, b""

    def _send(self, code=200, body=b"", ctype="application/json", headers=None):
        self.status, self.out, self.ctype = code, body, ctype
        self.headers = dict(headers or {})

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj).encode())

    def _body(self) -> bytes:
        return self.body


def _out_path(rel: str):
    p = (OUT_DIR / unquote(rel)).resolve()
    try:
        p.relative_to(OUT_DIR.resolve())
    except ValueError:
        return None
    return p


def _files_or_zip(h: _Handler, path: str, q: dict) -> bool:
    if path.startswith("/files/"):
        p = _out_path(path[len("/files/"):])
        if p is None or not p.is_file():
            h._send(404, b"not found", "text/plain")
        else:
            h._send(200, p.read_bytes(), mimetypes.guess_type(p.name)[0] or "application/octet-stream",
                    {"Content-Disposition": f'inline; filename="{p.name}"'})
        return True
    if path == "/api/zip":
        p = _out_path(q.get("folder", [""])[0])
        if p is None or not p.is_dir():
            h._send(404, b"not found", "text/plain")
            return True
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in sorted(p.rglob("*")):
                if f.is_file():
                    z.write(f, f.relative_to(p))
        h._send(200, buf.getvalue(), "application/zip", {"Content-Disposition": f'attachment; filename="{p.name}.zip"'})
        return True
    return False


def handle(method: str, url: str) -> str:
    u = urlparse(url)
    q = parse_qs(u.query)
    body = REQ.read_bytes() if REQ.exists() else b""
    h = _Handler(body)
    try:
        if method == "GET":
            if not _files_or_zip(h, u.path, q) and not binsapi.handle_get(h, u.path, q, OUT_DIR):
                h._send(404, b"not found", "text/plain")
        elif not binsapi.handle_post(h, u.path, q, OUT_DIR):
            h._send(404, b"not found", "text/plain")
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        h._json({"error": str(e) or e.__class__.__name__, "trace": traceback.format_exc()[-3000:]}, 500)
    RESP.write_bytes(h.out or b"")
    return json.dumps({"status": h.status, "ctype": h.ctype, "headers": h.headers,
                       "jobs": len(_PENDING)})


def run_pending() -> str:
    """Run the job(s) the last request started. Returns the job's outcome for the page's log."""
    kind = None
    while _PENDING:
        _PENDING.pop(0).run()
        kind = binsapi.JOB.get("kind")
    err = binsapi.JOB.get("error")
    return json.dumps({"kind": kind, "error": err})
