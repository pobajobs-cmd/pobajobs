// (0.7.9) Files as pictures, so a board looks like a real corkboard with the papers pinned up:
// a PDF's page (or just the part of it you picked), a photo or picture file, a video's frame, the
// start of a text or Word file, a spreadsheet's first rows, a slide, an audio file's waveform, what's
// in a zip. Made once when the file's added and kept like a photo (so other devices just show it),
// or made on this device for files added before there were previews.
//   previewKind(d)              what sort of picture a file can have, or null (it stays a tile)
//   openDocument(blob, d)       {kind, pages, render(page, width) -> canvas, close()}, or null
//   previewFrom(doc, opts)      {blob (JPEG), aspect (w/h), pages} for one page, maybe cropped
//   previewBlob(blob, d, opts)  the same, straight from the file
// opts: page (from 1), crop ('x,y,w,h' as fractions of the page).
// PDFs are drawn by Mozilla's pdf.js, fetched from jsDelivr the first time one's needed (and kept
// by the offline support after that). Nothing about the file leaves the device.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/';
const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

export function previewKind(d) {
  const n = (d?.name || '').toLowerCase(), m = (d?.mime || '').toLowerCase();
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (m.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|svg)$/.test(n)) return 'image';
  if (m.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/.test(n)) return 'video';
  if (m.startsWith('audio/') || /\.(mp3|m4a|wav|aac|ogg|oga|flac|opus)$/.test(n)) return 'audio';
  if (/\.(csv|tsv)$/.test(n) || /\/(csv|tab-separated-values)$/.test(m)) return 'table';
  if (n.endsWith('.docx') || m.includes('wordprocessingml')) return 'docx';
  if (n.endsWith('.xlsx') || m.includes('spreadsheetml')) return 'xlsx';
  if (n.endsWith('.pptx') || m.includes('presentationml')) return 'pptx';
  if (/\.(odt|ods|odp|odg)$/.test(n) || m.includes('opendocument')) return 'odf';
  if (/\.(pages|numbers|key)$/.test(n)) return 'iwork';
  if (n.endsWith('.zip') || m === 'application/zip' || m === 'application/x-zip-compressed') return 'zip';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml' || /\.(txt|md|markdown|json|xml|html?|js|mjs|ts|css|py|log|ini|cfg|ya?ml|toml|c|cpp|h|java|rb|go|rs|sh|bat|ps1|gcode|nc|tap|srt|vtt)$/.test(n)) return 'text';
  return null;
}
// The shape a file's picture usually is (width / height), before it's been made.
export const KIND_ASPECT = { pdf: 0.75, docx: 0.75, text: 0.75, zip: 0.75, odf: 0.75, iwork: 1, image: 4 / 3, video: 16 / 9, pptx: 16 / 9, audio: 2.6, table: 1.6, xlsx: 1.6 };

export function parseCrop(s) {
  const v = String(s || '').split(',').map(Number);
  if (v.length !== 4 || v.some(n => !Number.isFinite(n) || n < 0 || n > 1)) return null;
  const [x, y, w, h] = v;
  return w > 0.02 && h > 0.02 && x + w <= 1.0001 && y + h <= 1.0001 ? { x, y, w, h } : null;
}
export const cropStr = c => (c ? [c.x, c.y, c.w, c.h].map(n => +n.toFixed(4)).join(',') : '');

// ---------- Opening a file ----------

let pdfjsP = null;
function pdfjs() {
  pdfjsP ??= import(PDFJS + 'pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs'; return m; });
  pdfjsP.catch(() => { pdfjsP = null; });
  return pdfjsP;
}

export async function openDocument(blob, d) {
  const kind = previewKind(d);
  if (!kind || !blob) return null;
  if (kind === 'pdf') {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
    return {
      kind, pages: doc.numPages,
      async render(page, width) {
        const p = await doc.getPage(Math.min(Math.max(1, page || 1), doc.numPages));
        const v1 = p.getViewport({ scale: 1 });
        const scale = Math.min(width / v1.width, 4800 / Math.max(v1.width, v1.height));
        const vp = p.getViewport({ scale });
        const c = canvasOf(vp.width, vp.height), g = c.getContext('2d');
        g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, c.width, c.height);
        await p.render({ canvasContext: g, viewport: vp }).promise;
        p.cleanup();
        return c;
      },
      close() { doc.destroy(); },
    };
  }
  const c = await pictureOf(blob, d, kind);
  if (!c) return null;
  return { kind, pages: 1, render: async (page, width) => scaled(c, width), close() {} };
}

export async function previewFrom(doc, { page = 1, crop = null } = {}) {
  const cr = parseCrop(crop);
  // (drawn bigger when it's a snippet, so the part you picked is still sharp)
  let c = await doc.render(page, cr ? Math.min(4000, 1100 / cr.w) : 1100);
  if (cr) {
    const x = Math.round(cr.x * c.width), y = Math.round(cr.y * c.height), w = Math.max(1, Math.round(cr.w * c.width)), h = Math.max(1, Math.round(cr.h * c.height));
    const out = canvasOf(w, h);
    out.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
    c = out;
  }
  c = scaled(c, Math.min(1200, c.width), 1800);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  return blob && { blob, aspect: Math.round(1000 * c.width / c.height) / 1000, pages: doc.pages };
}

export async function previewBlob(blob, d, opts) {
  const doc = await openDocument(blob, d);
  if (!doc) return null;
  try { return await previewFrom(doc, opts); } finally { doc.close(); }
}

// ---------- Each kind as a picture ----------

async function pictureOf(blob, d, kind) {
  switch (kind) {
    case 'image': return imagePic(blob);
    case 'video': return videoPic(blob);
    case 'audio': return audioPic(blob, d);
    case 'text': return textPic(blob, d);
    case 'table': return tablePage(parseDelimited(await blob.slice(0, 60000).text(), /\.tsv$/i.test(d.name || '') || /tab-separated/.test(d.mime || '') ? '\t' : null));
    case 'docx': return docxPic(blob);
    case 'xlsx': return xlsxPic(blob);
    case 'pptx': return pptxPic(blob);
    case 'odf': case 'iwork': return thumbFromZip(blob);
    case 'zip': return zipPic(blob, d);
  }
  return null;
}

async function imagePic(blob) {
  let src = null;
  try { src = await createImageBitmap(blob); } catch (e) { src = await loadImage(blob); }   // (HEIC opens on an iPhone this way)
  if (!src) return null;
  const w = src.width, h = src.height, k = Math.min(1, 2400 / Math.max(w, h));
  const c = canvasOf(w * k, h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  src.close?.();
  return c;
}
function loadImage(blob) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

async function videoPic(blob) {
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const url = URL.createObjectURL(blob);
  try {
    v.src = url; v.load();
    await once(v, 'loadeddata', 10000);
    v.currentTime = Math.min(1, (v.duration || 2) * 0.1);
    await once(v, 'seeked', 10000);
    if (!v.videoWidth) return null;
    const k = Math.min(1, 1280 / v.videoWidth);
    const c = canvasOf(v.videoWidth * k, v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c;
  } catch (e) { return null; } finally { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); }
}
const once = (el, ev, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timed out')), ms); el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true }); el.addEventListener('error', () => { clearTimeout(t); rej(new Error('cannot play')); }, { once: true }); });

async function audioPic(blob, d) {
  if (blob.size > 30 * 1048576) return null;
  const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC) return null;
  const ac = new AC(1, 44100, 44100);
  const data = await blob.arrayBuffer();
  const buf = await new Promise((res, rej) => { const p = ac.decodeAudioData(data, res, rej); p?.then?.(res, rej); });
  const ch = buf.getChannelData(0), bars = 72, step = Math.max(1, Math.floor(ch.length / bars));
  const peaks = [];
  for (let i = 0; i < bars; i++) { let m = 0; for (let j = i * step, e = Math.min(ch.length, j + step); j < e; j += 16) m = Math.max(m, Math.abs(ch[j])); peaks.push(m); }
  const top = Math.max(0.01, ...peaks);
  const W = 1040, H = 400, c = canvasOf(W, H), g = c.getContext('2d');
  g.fillStyle = '#F5F1E8'; g.fillRect(0, 0, W, H);
  const bw = (W - 80) / bars;
  g.fillStyle = '#6E56A8';
  peaks.forEach((p, i) => { const h = Math.max(6, (p / top) * (H * 0.62)); roundRect(g, 40 + i * bw + bw * 0.18, H * 0.43 - h / 2, bw * 0.64, h, bw * 0.3); g.fill(); });
  g.fillStyle = '#4B4357'; g.font = `600 34px ${SANS}`;
  const s = Math.round(buf.duration);
  g.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, 40, H - 36);
  g.textAlign = 'right'; g.font = `400 30px ${SANS}`;
  g.fillText(clipText(g, (d?.name || '').replace(/\.[a-z0-9]+$/i, ''), W - 260), W - 40, H - 36);
  return c;
}

async function textPic(blob, d) {
  const raw = (await blob.slice(0, 12000).text()).replace(/\r\n?/g, '\n');
  const n = (d?.name || '').toLowerCase();
  if (/\.(md|markdown)$/.test(n)) {
    const blocks = raw.split('\n').filter((l, i, a) => l.trim() || (a[i - 1] || '').trim()).slice(0, 80).map(l => {
      const h = /^(#{1,3})\s+(.*)$/.exec(l);
      const t = (h ? h[2] : l).replace(/\*\*|__|`/g, '').replace(/^\s*[-*+]\s+/, '• ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      return h ? { text: t, size: [0, 0.062, 0.05, 0.044][h[1].length], bold: true, gap: 0.3 } : { text: t, gap: 0.2 };
    });
    return textPage(blocks);
  }
  if (/\.(html?)$/.test(n) || /text\/html/.test(d?.mime || '')) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const blocks = [...doc.body.querySelectorAll('h1, h2, h3, p, li')].slice(0, 60).map(el => ({ text: (el.tagName === 'LI' ? '• ' : '') + el.textContent.trim().replace(/\s+/g, ' '), bold: /^H/.test(el.tagName), size: { H1: 0.062, H2: 0.05, H3: 0.044 }[el.tagName], gap: 0.3 })).filter(b => b.text);
    if (blocks.length) return textPage(blocks);
  }
  const prose = /\.(txt|log|srt|vtt)$/.test(n) || (/^text\/plain/.test(d?.mime || '') && !/\.(json|xml|js|py|css|ini|ya?ml|toml|c|cpp|h|java|rb|go|rs|sh|bat|ps1|gcode|nc|tap)$/.test(n));
  return prose ? textPage(raw.split('\n').slice(0, 120).map(t => ({ text: t, gap: 0.1 })))
    : textPage([{ text: raw.split('\n').slice(0, 90).join('\n'), mono: true }], { mono: true });
}

async function docxPic(blob) {
  const z = await unzip(blob);
  const xml = z && await z.text('word/document.xml');
  if (!xml) return thumbFromZip(blob, z);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const blocks = [];
  for (const p of [...doc.getElementsByTagNameNS(W, 'p')].slice(0, 120)) {
    let text = '';
    for (const t of p.getElementsByTagNameNS(W, '*')) { if (t.localName === 't') text += t.textContent; else if (t.localName === 'tab') text += '  '; else if (t.localName === 'br') text += '\n'; }
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
    const list = !!p.getElementsByTagNameNS(W, 'numPr')[0];
    const head = /^(Title|Heading1|Heading2|Heading3|Subtitle)$/i.exec(style.replace(/\s/g, ''));
    const bold = !!p.getElementsByTagNameNS(W, 'b')[0] && text.length < 90;
    if (!text.trim() && !blocks.length) continue;
    blocks.push({ text: (list ? '• ' : '') + text, bold: !!head || bold, size: head ? { title: 0.066, heading1: 0.054, heading2: 0.047, heading3: 0.042, subtitle: 0.046 }[head[1].toLowerCase()] : undefined, gap: head ? 0.35 : 0.45 });
  }
  return blocks.length ? textPage(blocks) : thumbFromZip(blob, z);
}

async function xlsxPic(blob) {
  const z = await unzip(blob);
  if (!z) return null;
  const ss = await z.text('xl/sharedStrings.xml');
  const strings = [];
  if (ss) for (const si of new DOMParser().parseFromString(ss, 'application/xml').getElementsByTagName('si')) strings.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
  const sheetName = z.names.filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0];
  const xml = sheetName && await z.text(sheetName);
  if (!xml) return thumbFromZip(blob, z);
  const rows = [];
  for (const row of [...new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('row')].slice(0, 18)) {
    const out = [];
    for (const c of row.getElementsByTagName('c')) {
      const col = colIndex(c.getAttribute('r') || ''), t = c.getAttribute('t');
      if (col > 7) continue;
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      out[col] = t === 's' ? strings[+v] ?? '' : t === 'inlineStr' ? [...c.getElementsByTagName('t')].map(x => x.textContent).join('') : t === 'b' ? (v === '1' ? 'TRUE' : 'FALSE') : fmtNum(v);
    }
    rows.push(Array.from(out, x => x ?? ''));
  }
  return rows.some(r => r.some(x => x)) ? tablePage(rows) : thumbFromZip(blob, z);
}
const colIndex = ref => { const m = /^([A-Z]+)/.exec(ref); if (!m) return 0; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const fmtNum = v => (v !== '' && Number.isFinite(+v) && /\.\d{5,}/.test(v) ? String(+(+v).toFixed(4)) : v);

async function pptxPic(blob) {
  const z = await unzip(blob);
  if (!z) return null;
  const thumb = await thumbFromZip(blob, z);   // (PowerPoint keeps a picture of the first slide)
  if (thumb) return thumb;
  const xml = await z.text('ppt/slides/slide1.xml');
  if (!xml) return null;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const paras = [...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'p')].map(p => [...p.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 't')].map(t => t.textContent).join('')).filter(t => t.trim());
  return textPage(paras.map((t, i) => ({ text: t, size: i ? 0.04 : 0.068, bold: !i, gap: i ? 0.3 : 0.8 })), { aspect: 16 / 9, margin: 0.07, trim: false });
}

// A picture kept inside the file (OpenDocument, Pages/Numbers/Keynote, Office when it saves one).
async function thumbFromZip(blob, z) {
  z ??= await unzip(blob);
  if (!z) return null;
  const pics = z.names.filter(n => /(^|\/)(thumbnail|preview)[^/]*\.(jpe?g|png)$/i.test(n)).sort((a, b) => z.entries.get(b).size - z.entries.get(a).size);
  for (const n of pics) {
    const bytes = await z.read(n);
    if (!bytes) continue;
    const c = await imagePic(new Blob([bytes], { type: /png$/i.test(n) ? 'image/png' : 'image/jpeg' }));
    if (c) return c;
  }
  return null;
}

async function zipPic(blob, d) {
  const z = await unzip(blob);
  if (!z) return null;
  const files = z.names.filter(n => !n.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store)/.test(n));
  const blocks = [{ text: `${files.length} file${files.length === 1 ? '' : 's'} in ${d?.name || 'this zip'}`, bold: true, gap: 0.6 }];
  for (const n of files.slice(0, 40)) blocks.push({ text: '▸ ' + n, gap: 0.05, size: 0.034 });
  if (files.length > 40) blocks.push({ text: `… and ${files.length - 40} more`, color: '#777' });
  return textPage(blocks);
}

function parseDelimited(text, sep) {
  const first = text.split('\n')[0] || '';
  sep ??= (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length && rows.length < 18; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if ((cell || row.length) && rows.length < 18) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- Drawing paper ----------

// A sheet of paper with text on it, big enough to read on a card. blocks: [{text, size (of the
// width), bold, mono, gap (lines after), color}]. A short one is cut off under its text (no taller
// than a page, no shorter than half its width), so a card doesn't carry a mostly empty page.
function textPage(blocks, { width = 1100, aspect = 0.75, mono = false, margin = 0.07, trim = true } = {}) {
  const W = width, H = Math.round(W / aspect), m = W * margin;
  const c = canvasOf(W, H), g = c.getContext('2d');
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H);
  g.textBaseline = 'alphabetic';
  let y = m, full = false;
  out: for (const b of blocks) {
    const size = W * (b.size || (b.mono || mono ? 0.03 : 0.038));
    g.font = `${b.bold ? 700 : 400} ${size}px ${b.mono || mono ? MONO : SANS}`;
    g.fillStyle = b.color || '#222222';
    const lines = b.mono || mono ? String(b.text).split('\n').map(l => clipText(g, l.replace(/\t/g, '    '), W - 2 * m, '')) : wrap(g, b.text, W - 2 * m);
    for (const line of lines) {
      if (y + size * 1.3 > H - m * 0.6) { full = true; break out; }
      g.fillText(line, m, y + size);
      y += size * 1.4;
    }
    y += size * (b.gap ?? 0.5);
  }
  if (!trim || full) return c;
  const h = Math.round(Math.max(W / 2, y + m * 0.6));
  if (h >= H) return c;
  const out = canvasOf(W, h);
  out.getContext('2d').drawImage(c, 0, 0);
  return out;
}

function tablePage(rows, { width = 1100 } = {}) {
  rows = rows.slice(0, 12).map(r => r.slice(0, 5).map(x => String(x ?? '')));
  if (!rows.length) return null;
  const cols = Math.max(1, ...rows.map(r => r.length));
  const pad = width * 0.025, rh = width * 0.072;
  const H = Math.round(Math.max(width / 2, pad * 2 + rh * rows.length));
  const c = canvasOf(width, H), g = c.getContext('2d');
  g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, width, H);
  const cw = (width - 2 * pad) / cols;
  g.fillStyle = '#E7EFE7'; g.fillRect(pad, pad, width - 2 * pad, rh);
  g.strokeStyle = '#CBD5CB'; g.lineWidth = 2;
  for (let i = 0; i <= rows.length; i++) { g.beginPath(); g.moveTo(pad, pad + i * rh); g.lineTo(width - pad, pad + i * rh); g.stroke(); }
  for (let j = 0; j <= cols; j++) { g.beginPath(); g.moveTo(pad + j * cw, pad); g.lineTo(pad + j * cw, pad + rows.length * rh); g.stroke(); }
  rows.forEach((r, i) => r.forEach((x, j) => {
    g.font = `${i ? 400 : 700} ${rh * 0.46}px ${SANS}`;
    g.fillStyle = '#1E1E1E';
    const num = i && /^-?[\d.,]+%?$/.test(x.trim());
    const t = clipText(g, x, cw - rh * 0.4);
    g.textAlign = num ? 'right' : 'left';
    g.fillText(t, num ? pad + (j + 1) * cw - rh * 0.2 : pad + j * cw + rh * 0.2, pad + i * rh + rh * 0.66);
  }));
  return c;
}

function wrap(g, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const t = line ? line + ' ' + word : word;
      if (!line || g.measureText(t).width <= maxW) line = t; else { out.push(line); line = word; }
    }
    out.push(clipText(g, line, maxW));
  }
  return out;
}
function clipText(g, s, maxW, ell = '…') {
  s = String(s);
  if (g.measureText(s).width <= maxW) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (g.measureText(s.slice(0, mid) + ell).width <= maxW) lo = mid; else hi = mid - 1; }
  return s.slice(0, lo) + ell;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
// A canvas no wider than w (and no taller than maxH): the same one if it already fits.
function scaled(c, w, maxH = Infinity) {
  const k = Math.min(1, w / c.width, maxH / c.height);
  if (k >= 0.999) return c;
  const out = canvasOf(c.width * k, c.height * k), g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

// ---------- Reading zips (Word, Excel, PowerPoint, OpenDocument and iWork files are zips) ----------

async function unzip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) return null;
  const count = dv.getUint16(e + 10, true), entries = new Map(), dec = new TextDecoder();
  let p = dv.getUint32(e + 16, true);
  for (let n = 0; n < count && p + 46 <= buf.length && dv.getUint32(p, true) === 0x02014b50; n++) {
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    entries.set(dec.decode(buf.subarray(p + 46, p + 46 + nl)), { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), size: dv.getUint32(p + 24, true), off: dv.getUint32(p + 42, true) });
    p += 46 + nl + xl + cl;
  }
  const read = async name => {
    const en = entries.get(name);
    if (!en || en.off + 30 > buf.length || dv.getUint32(en.off, true) !== 0x04034b50) return null;
    const start = en.off + 30 + dv.getUint16(en.off + 26, true) + dv.getUint16(en.off + 28, true);
    const raw = buf.subarray(start, start + en.csize);
    if (en.method === 0) return raw;
    if (en.method !== 8 || typeof DecompressionStream === 'undefined') return null;
    try { return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()); }
    catch (err) { return null; }
  };
  return { names: [...entries.keys()], entries, read, text: async n => { const b = await read(n); return b ? dec.decode(b) : null; } };
}
