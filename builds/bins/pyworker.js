// Bin maker: runs Geominals' Python (Pyodide) in a background thread of the page.
// The page (bridge.js) sends it requests; it answers them like the PC's web server would.
/* global loadPyodide */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
importScripts(PYODIDE + "pyodide.js");

let py = null, handle = null, runPending = null, skimage = null;
const say = (status) => postMessage({ type: "boot", status });
self.gmProgress = (status) => postMessage({ type: "progress", status });

const syncfs = (populate) => new Promise((res, rej) => py.FS.syncfs(populate, (e) => (e ? rej(e) : res())));

const ready = (async () => {
  const t0 = performance.now();
  say("Starting Python…");
  py = await loadPyodide({ indexURL: PYODIDE, stdout: (s) => console.log("[py]", s), stderr: (s) => console.warn("[py]", s) });
  say("Loading numpy, SciPy, OpenCV and Pillow…");
  await py.loadPackage(["numpy", "scipy", "opencv-python", "Pillow"]);
  say("Loading the bin maker…");
  const files = await (await fetch(`py/manifest.json?v=${VERSION}`)).json();
  py.FS.mkdirTree("/app/geominals");
  await Promise.all(files.map(async (f) => {
    const txt = await (await fetch(`py/${f}?v=${VERSION}`)).text();
    py.FS.writeFile("/app/" + f, txt);
  }));
  // your tools and saved layouts live in this browser (IndexedDB) and survive a reload
  for (const d of ["/app/tools", "/app/bins"]) {
    py.FS.mkdirTree(d);
    py.FS.mount(py.FS.filesystems.IDBFS, {}, d);
  }
  await syncfs(true);
  py.FS.mkdirTree("/tmp");
  py.runPython(py.FS.readFile("/app/webmain.py", { encoding: "utf8" }));
  handle = py.globals.get("handle");
  runPending = py.globals.get("run_pending");
  // only the photo scanner and router templates need scikit-image; fetch it in the background
  skimage = py.loadPackage(["scikit-image"]).catch((e) => console.warn("scikit-image failed", e));
  postMessage({ type: "ready", seconds: (performance.now() - t0) / 1000 });
})().catch((e) => {
  postMessage({ type: "fatal", error: String(e && e.stack || e) });
  throw e;
});

const needsSkimage = (method, path) => method !== "GET" || path.startsWith("/api/tools/outline");

// one request at a time, in order
let queue = Promise.resolve();
self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type !== "req") return;
  queue = queue.then(() => serve(m)).catch((e) => console.error(e));
};

async function serve(m) {
  let reply;
  try {
    await ready;
    const path = new URL(m.url).pathname;
    if (needsSkimage(m.method, path)) await skimage;
    if (m.body) py.FS.writeFile("/tmp/req", new Uint8Array(m.body));
    else { try { py.FS.unlink("/tmp/req"); } catch (e) { /* none */ } }
    const t = performance.now();
    const info = JSON.parse(handle(m.method, m.url));
    const body = py.FS.readFile("/tmp/resp");
    reply = { id: m.id, status: info.status, ctype: info.ctype, headers: info.headers, body: body.buffer,
              ms: Math.round(performance.now() - t), jobs: info.jobs };
    postMessage({ type: "res", ...reply }, [body.buffer]);
    if (info.jobs) {
      postMessage({ type: "job", running: true });
      const tj = performance.now();
      let out = { kind: null, error: null };
      try { out = JSON.parse(runPending()); } catch (e) { out.error = String(e); }
      postMessage({ type: "job", running: false, kind: out.kind, error: out.error, ms: Math.round(performance.now() - tj) });
    }
    if (m.method !== "GET" || info.jobs) await syncfs(false).catch((e) => console.warn("save failed", e));
  } catch (e) {
    const msg = String(e && e.message || e);
    const body = new TextEncoder().encode(JSON.stringify({ error: msg }));
    postMessage({ type: "res", id: m.id, status: 500, ctype: "application/json", headers: {}, body: body.buffer, crash: String(e && e.stack || e) }, [body.buffer]);
  }
}
