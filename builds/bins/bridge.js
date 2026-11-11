// Bin maker: glue between the Bins page (written for the PC's web server) and Python
// running in the browser. It
//  - registers sw.js so the page's /api/... requests come here instead of the network,
//  - runs Geominals' Python in a Web Worker (pyworker.js) and passes requests to it,
//  - keeps the progress line moving while Python is busy, and makes Cancel work
//    (by restarting Python - your saved tools are kept),
//  - turns links to generated files into downloads,
//  - sends error reports and timings to pobajobs.co.uk so problems can be found.
(function () {
  "use strict";
  const VERSION = document.currentScript.dataset.v || "dev";
  const VIRTUAL = /^\/(api|files|tools|scans)\//;
  const JOB_START = new Set(["/api/tools/detect", "/api/bins/router", "/api/bins/holes", "/api/bins/storage",
                             "/api/bins/make", "/api/bins/baseplate"]);
  const SESSION = Math.random().toString(36).slice(2, 10);

  // ------------------------------------------------------------ reporting
  const REPORTS = [];
  function report(kind, msg, detail) {
    REPORTS.push({ t: new Date().toISOString(), kind, msg: String(msg || "").slice(0, 1000),
                   detail: detail == null ? null : String(detail).slice(0, 4000) });
    if (REPORTS.length > 200) REPORTS.splice(0, REPORTS.length - 200);
    clearTimeout(report.t); report.t = setTimeout(flush, 4000);
  }
  function payload(events) {
    return JSON.stringify({ session: SESSION, ver: VERSION, events,
      env: { ua: navigator.userAgent, mem: navigator.deviceMemory || null, cores: navigator.hardwareConcurrency || null,
             w: window.innerWidth, h: window.innerHeight } });
  }
  function flush(beacon) {
    if (!REPORTS.length) return;
    const events = REPORTS.splice(0, 50);
    const body = payload(events);
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/binmaker/report", new Blob([body], { type: "application/json" }));
      else fetch("/api/binmaker/report", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch (e) { /* never let reporting break the page */ }
    if (REPORTS.length) setTimeout(flush, 1000);
  }
  addEventListener("pagehide", () => flush(true));
  addEventListener("error", (e) => report("js-error", e.message, e.error && e.error.stack || `${e.filename}:${e.lineno}`));
  addEventListener("unhandledrejection", (e) => report("js-error", e.reason && e.reason.message || String(e.reason), e.reason && e.reason.stack));

  // ------------------------------------------------------------ boot screen
  let bootEl = null;
  function bootScreen(text, sub) {
    if (!bootEl) {
      bootEl = document.createElement("div");
      bootEl.id = "gmBoot";
      bootEl.innerHTML = '<div class="box"><div class="spin"></div><b></b><span></span></div>';
      document.body.append(bootEl);
    }
    bootEl.querySelector("b").textContent = text;
    bootEl.querySelector("span").textContent = sub || "";
    bootEl.style.display = "flex";
  }
  const hideBoot = () => { if (bootEl) bootEl.style.display = "none"; };

  // ------------------------------------------------------------ the Python worker
  let worker = null, workerReady = false, nextId = 1, bootT0 = 0, restarts = 0;
  const pending = new Map();                 // request id -> resolve
  const JOB = { running: false, kind: null, status: "", started: 0, override: null };

  function startWorker(reason) {
    workerReady = false;
    bootT0 = performance.now();
    worker = new Worker(`pyworker.js?v=${VERSION}`);
    worker.onmessage = onWorker;
    worker.onerror = (e) => { report("worker-error", e.message, `${e.filename}:${e.lineno}`); };
    if (reason) bootScreen("Restarting the bin maker…", reason);
  }
  function restartWorker(reason, kind) {
    restarts++;
    try { worker.terminate(); } catch (e) { /* gone */ }
    for (const [, res] of pending) res(jsonReply(503, { error: "The bin maker restarted - try that again." }));
    pending.clear();
    JOB.running = false;
    if (kind) report(kind, reason);
    startWorker(reason);
  }
  function onWorker(ev) {
    const m = ev.data;
    if (m.type === "boot") { if (!workerReady) bootScreen("Loading the bin maker…", m.status + (restarts ? "" : " The first visit downloads about 60 MB; after that it's cached.")); }
    else if (m.type === "ready") {
      workerReady = true; hideBoot();
      report("boot", `ready in ${m.seconds.toFixed(1)} s`, restarts ? `restart #${restarts}` : null);
    } else if (m.type === "fatal") {
      report("fatal", "Python failed to start", m.error);
      bootScreen("The bin maker couldn't start in this browser.", String(m.error).split("\n")[0] + " - try Chrome or Edge on a computer.");
    } else if (m.type === "progress") { JOB.status = m.status; }
    else if (m.type === "job") {
      if (m.running) { JOB.running = true; }
      else {
        JOB.running = false;
        report(m.error ? "job-error" : "job", `${m.kind || JOB.kind}: ${m.error || "done"} in ${(m.ms / 1000).toFixed(1)} s`);
      }
    } else if (m.type === "res") {
      const res = pending.get(m.id);
      pending.delete(m.id);
      if (m.status >= 500) report("server-error", `${m.path || ""} ${new TextDecoder().decode(m.body).slice(0, 600)}`, m.crash || null);
      if (m.crash && /fatally failed|memory access out of bounds|RangeError|Out of memory/i.test(m.crash)) {
        if (res) res(m);
        restartWorker("Python ran out of memory or crashed; restarting it. Your saved tools are kept.", "crash");
        return;
      }
      if (res) res(m);
    }
  }
  function toWorker(method, url, body) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, (m) => resolve(m));
      worker.postMessage({ type: "req", id, method, url, body }, body ? [body] : []);
    });
  }
  function jsonReply(status, obj) {
    return { status, ctype: "application/json", headers: {}, body: new TextEncoder().encode(JSON.stringify(obj)).buffer };
  }

  // ------------------------------------------------------------ routing
  let META = null;
  async function route(method, url, body) {
    const u = new URL(url);
    const p = u.pathname;
    if (p === "/api/meta") {
      META = META || await (await fetch(`meta.json?v=${VERSION}`)).json();
      return jsonReply(200, META);
    }
    if (p === "/api/job") return jsonReply(200, { running: false });
    if (p === "/api/map/status") return jsonReply(200, { status: "", id: 0, running: false, result: null, error: null });
    if (p === "/api/install-status") return jsonReply(200, { running: false, done: true, ok: true, log: "" });
    if (p === "/api/open-folder") return jsonReply(200, { ok: true });
    if (p === "/api/bins/status") {
      if (JOB.override) { const o = JOB.override; JOB.override = null; return jsonReply(200, o); }
      if (JOB.running) {
        return jsonReply(200, { running: true, kind: JOB.kind, status: JOB.status || "Working…", result: null, error: null,
                                seconds: Math.round((Date.now() - JOB.started) / 1000) });
      }
    }
    if (p === "/api/bins/cancel" && JOB.running) {
      restartWorker("Cancelling…", null);
      report("cancel", `${JOB.kind} cancelled after ${Math.round((Date.now() - JOB.started) / 1000)} s`);
      JOB.override = { running: false, kind: JOB.kind, status: "", result: null, error: "Cancelled." };
      return jsonReply(200, { ok: true });
    }
    if (method === "POST" && JOB_START.has(p)) {
      JOB.kind = p.split("/").pop(); JOB.status = "Starting…"; JOB.started = Date.now();
    }
    const t = performance.now();
    const r = await toWorker(method, url, body);
    if (r.jobs) JOB.running = true;
    const ms = performance.now() - t;
    if (ms > 20000 && !r.jobs) report("slow", `${method} ${p} took ${(ms / 1000).toFixed(1)} s`);
    if (r.status >= 500) r.path = p;
    return r;
  }

  // the service worker forwards the page's requests here
  function onSwMessage(ev) {
    const m = ev.data;
    if (!m || m.type !== "req") return;
    const port = ev.ports[0];
    route(m.method, m.url, m.body).then(
      (r) => port.postMessage({ status: r.status, ctype: r.ctype, headers: r.headers, body: r.body }, [r.body]),
      (e) => { report("bridge-error", e.message, e.stack); const r = jsonReply(500, { error: e.message }); port.postMessage(r, [r.body]); });
  }

  // links to generated files (STL, 3MF, PDF, zip): fetch them here and save/open them,
  // because a normal link would leave the page and miss the service worker
  document.addEventListener("click", async (e) => {
    const a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    const u = new URL(a.getAttribute("href"), location.href);
    if (u.origin !== location.origin || !VIRTUAL.test(u.pathname)) return;
    e.preventDefault(); e.stopPropagation();
    const save = a.hasAttribute("download") || u.pathname === "/api/zip";
    const win = save ? null : window.open("", "_blank");
    try {
      const r = await fetch(u.href);
      if (!r.ok) { let msg = r.statusText; try { msg = (await r.json()).error || msg; } catch (x) { /* not json */ } throw new Error(msg); }
      const blob = await r.blob();
      const href = URL.createObjectURL(blob);
      if (win) win.location.href = href;
      else {
        const cd = r.headers.get("Content-Disposition") || "";
        const name = a.getAttribute("download") || (cd.match(/filename="([^"]+)"/) || [])[1] || u.pathname.split("/").pop();
        const d = document.createElement("a"); d.href = href; d.download = name; document.body.append(d); d.click(); d.remove();
      }
      setTimeout(() => URL.revokeObjectURL(href), 120000);
      report("download", u.pathname.split("/").pop(), `${(blob.size / 1e6).toFixed(2)} MB`);
    } catch (err) {
      if (win) win.close();
      report("download-error", err.message, u.pathname);
      if (typeof window.toast === "function") window.toast(err.message);
    }
  }, true);

  // ------------------------------------------------------------ start
  async function start() {
    bootScreen("Loading the bin maker…", "Getting ready…");
    if (!("serviceWorker" in navigator)) {
      report("fatal", "no service worker support");
      return bootScreen("This browser can't run the bin maker.", "It needs service workers (not available in some private windows). Try Chrome, Edge, Firefox or Safari normally.");
    }
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    startWorker();
    try {
      const reg = await navigator.serviceWorker.register(`sw.js?v=${VERSION}`, { scope: "./" });
      if (!navigator.serviceWorker.controller) {
        await new Promise((res) => {
          navigator.serviceWorker.addEventListener("controllerchange", res, { once: true });
          // a hard refresh skips the service worker: ask it to take this page over
          navigator.serviceWorker.ready.then((r) => setTimeout(() => r.active && r.active.postMessage("claim"), 500));
        });
      }
      reg.update().catch(() => {});
    } catch (e) {
      report("fatal", "service worker failed", e.stack || e.message);
      return bootScreen("The bin maker couldn't start.", e.message);
    }
    // now run the Bins page itself
    const app = document.getElementById("gmApp");
    const s = document.createElement("script");
    s.textContent = app.textContent;
    document.body.append(s);
    // capture the messages the page shows people (most errors end up here)
    if (typeof window.toast === "function") {
      const orig = window.toast;
      window.toast = function (msg) { report("toast", msg); return orig.apply(this, arguments); };
    }
    if (!workerReady) bootScreen("Loading the bin maker…", "Starting Python…");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
