// Printing and exporting. A list (a project, a section, Today…) becomes a tidy A4 PDF in two
// columns (as few pages as it'll go on), a page to print, plain text, or a CSV for Excel. A board
// becomes a picture (PNG), a drawing you can scale (SVG), a one-page PDF, or a print.
//
// The PDFs are written here, with no library: text in Helvetica (any letter in Western European
// languages; emoji and other scripts are left out of the PDF, but print keeps them), and a board
// as one picture on the page.

const enc = new TextEncoder();
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Saving a file ----------

// On a phone: the share sheet (Save to Files, Mail, AirDrop, open in another app…). On a computer: a download.
export async function saveFile(blob, name, { share = matchMedia('(pointer: coarse)').matches } = {}) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      // (the tap that asked for it has "worn off" while the file was made: the caller can offer a button)
      if (e.name === 'NotAllowedError') return 'needs-tap';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return 'downloaded';
}
export const fileName = (s, ext) => (String(s || 'Brain Tree').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Brain Tree') + '.' + ext;

// ---------- Printing ----------

// Prints some HTML on its own (everything else on the page is hidden while it prints).
export function printHTML(html, { landscape = false } = {}) {
  let host = document.getElementById('printout');
  if (!host) { host = document.createElement('div'); host.id = 'printout'; document.body.append(host); }
  host.innerHTML = `<style>@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 11mm; }</style>` + html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); host.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // (pictures in it need a moment to load before the print preview is made)
  setTimeout(() => { try { window.print(); } finally { setTimeout(() => { if (!matchMedia('print').matches) done(); }, 1500); } }, 250);
}

// ---------- A list as text, CSV and a printable page ----------
// doc: { title, sub, groups: [{ name, tone, items: [{ kind, title, done, due, dueText, late, where, steps: [{title, done}], lines: [{t, text, done, rows}] }] }] }

export function listText(doc) {
  const out = [doc.title, ...(doc.sub ? [doc.sub] : []), ''];
  for (const g of doc.groups) {
    if (g.name) out.push('', g.name.toUpperCase());
    for (const it of g.items) {
      const box = it.kind === 'task' ? (it.done ? '[x] ' : '[ ] ') : it.kind === 'project' ? '» ' : '• ';
      out.push(box + it.title + (it.dueText ? ` (${it.dueText})` : '') + (it.where ? ` · ${it.where}` : ''));
      for (const s of it.steps || []) out.push(`    ${s.done ? '[x]' : '[ ]'} ${s.title}`);
      for (const l of it.lines || []) {
        if (l.t === 'rows') for (const r of l.rows) out.push('    ' + r.join(' | '));
        else out.push('    ' + (l.t === 'check' ? (l.done ? '[x] ' : '[ ] ') : l.t === 'li' ? '- ' : '') + l.text);
      }
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export function listCSV(doc) {
  const rows = [['Type', 'Title', 'Done', 'Due', 'Group', 'Where', 'Notes']];
  const kindName = { task: 'To-do', note: 'Note', project: 'Project', section: 'Section' };
  for (const g of doc.groups) for (const it of g.items) {
    const notes = (it.lines || []).map(l => (l.t === 'rows' ? l.rows.map(r => r.join(' | ')).join('\n') : (l.t === 'check' ? (l.done ? '[x] ' : '[ ] ') : '') + l.text)).join('\n');
    rows.push([kindName[it.kind] || '', it.title, it.kind === 'task' ? (it.done ? 'Yes' : 'No') : '', it.due || '', g.name || '', it.where || '', notes]);
    for (const s of it.steps || []) rows.push(['Step', s.title, s.done ? 'Yes' : 'No', '', g.name || '', it.title, '']);
  }
  // (a BOM so Excel reads £ and accents properly)
  return '﻿' + rows.map(r => r.map(v => (/[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
}

export function listPrintHTML(doc) {
  const item = it => {
    const box = it.kind === 'task' ? `<i class="pbox ${it.done ? 'on' : ''}"></i>` : `<i class="pk ${it.kind}"></i>`;
    const lines = (it.lines || []).map(l => l.t === 'rows'
      ? `<table class="psheet">${l.rows.map((r, i) => `<tr>${r.map(v => `<${i === 0 && l.head ? 'th' : 'td'}>${esc(v)}</${i === 0 && l.head ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table>`
      : `<p class="pl ${l.t}">${l.t === 'check' ? `<i class="pbox s ${l.done ? 'on' : ''}"></i>` : l.t === 'li' ? '• ' : ''}${esc(l.text)}</p>`).join('');
    const steps = (it.steps || []).map(s => `<p class="pl check"><i class="pbox s ${s.done ? 'on' : ''}"></i>${esc(s.title)}</p>`).join('');
    return `<div class="pit ${it.kind} ${it.done ? 'done' : ''}"><div class="pt">${box}<b>${esc(it.title)}</b>${it.where ? `<small>${esc(it.where)}</small>` : ''}${it.dueText ? `<span class="pd ${it.late ? 'late' : ''}">${esc(it.dueText)}</span>` : ''}</div>${steps}${lines}</div>`;
  };
  return `<div class="plist">
    <header><h1>${esc(doc.title)}</h1>${doc.sub ? `<p>${esc(doc.sub)}</p>` : ''}</header>
    <div class="pcols">${doc.groups.filter(g => g.items.length).map(g => `<section>${g.name ? `<h2 class="${g.tone || ''}">${esc(g.name)}</h2>` : ''}${g.items.map(item).join('')}</section>`).join('')}</div>
  </div>`;
}

// ---------- PDF writing ----------

// Text into the PDF's own letters (WinAnsi): Western European letters and the usual punctuation.
const WIN = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159 };
const SWAP = { '→': '->', '←': '<-', '✓': 'v', '✔': 'v', '×': 'x', '≥': '>=', '≤': '<=', ' ': ' ', ' ': ' ', '​': '' };
function pdfText(s) {
  let out = '';
  for (const ch of String(s).normalize('NFC')) {
    const sw = SWAP[ch];
    if (sw != null) { out += sw; continue; }
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out += ch === '(' || ch === ')' || ch === '\\' ? '\\' + ch : ch;
    else if (c >= 160 && c <= 255) out += '\\' + c.toString(8).padStart(3, '0');
    else if (WIN[ch]) out += '\\' + WIN[ch].toString(8).padStart(3, '0');
    // (anything else, like emoji, is left out)
  }
  return out;
}
// What's printable of a string (for measuring).
const printable = s => [...String(s).normalize('NFC')].map(ch => SWAP[ch] ?? ((ch.codePointAt(0) >= 32 && ch.codePointAt(0) < 127) || (ch.codePointAt(0) >= 160 && ch.codePointAt(0) <= 255) || WIN[ch] ? ch : '')).join('');

// Helvetica widths (Arial on Windows has the very same), measured on a canvas.
const ctx = document.createElement('canvas').getContext('2d');
function width(s, size, bold) {
  ctx.font = `${bold ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
  return ctx.measureText(printable(s)).width * size / 100;
}
function wrap(s, size, bold, max) {
  const words = printable(s).split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const w of words) {
    const tryLine = line ? line + ' ' + w : w;
    if (width(tryLine, size, bold) <= max || !line) {
      if (!line && width(w, size, bold) > max) {
        // One very long word: break it.
        let part = '';
        for (const ch of w) { if (width(part + ch, size, bold) > max && part) { lines.push(part); part = ''; } part += ch; }
        line = part;
      } else line = tryLine;
    } else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

// Puts objects together into a PDF file. pages: [{ w, h, content: string, images: [name] }]; images: { name: { w, h, data: Uint8Array (JPEG) } }
function buildPDF(pages, images = {}) {
  const objs = [];   // [bytes]
  const add = body => { objs.push(body); return objs.length; };
  const catalog = add(null), pagesObj = add(null);
  const fontR = add(enc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'));
  const fontB = add(enc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'));
  const imgRef = {};
  for (const [name, im] of Object.entries(images)) {
    const head = enc.encode(`<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>\nstream\n`);
    imgRef[name] = add(concat([head, im.data, enc.encode('\nendstream')]));
  }
  const kids = [];
  for (const p of pages) {
    const body = enc.encode(p.content);
    const content = add(concat([enc.encode(`<< /Length ${body.length} >>\nstream\n`), body, enc.encode('\nendstream')]));
    const xo = (p.images || []).map(n => `/${n} ${imgRef[n]} 0 R`).join(' ');
    kids.push(add(enc.encode(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f2(p.w)} ${f2(p.h)}] /Contents ${content} 0 R /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> >>`)));
  }
  objs[catalog - 1] = enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objs[pagesObj - 1] = enc.encode(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  const parts = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let off = parts[0].length;
  const offsets = [];
  objs.forEach((o, i) => {
    const head = enc.encode(`${i + 1} 0 obj\n`), tail = enc.encode('\nendobj\n');
    offsets.push(off);
    parts.push(head, o, tail);
    off += head.length + o.length + tail.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info << /Producer (Brain Tree) /Creator (Brain Tree) >> >>\nstartxref\n${off}\n%%EOF\n`;
  parts.push(enc.encode(xref));
  return new Blob(parts, { type: 'application/pdf' });
}
function concat(arrs) { const n = arrs.reduce((s, a) => s + a.length, 0), out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
const f2 = n => (Math.round(n * 100) / 100).toString();
const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => f2(v / 255)).join(' '); };

// A list on A4 pages in two columns, as tight as it reads well.
export function listPDF(doc, { accent = '#C98A00', late = '#C8372D' } = {}) {
  const W = 595.28, H = 841.89, M = 32, GUT = 18, COLW = (W - 2 * M - GUT) / 2;
  const S = { body: 8.6, small: 7.4, head: 8.2, title: 15 };
  const pages = [];
  let page = null, col = 0, y = 0;
  const top = () => (pages.length === 1 ? M + 46 : M + 10);
  const newPage = () => { page = { w: W, h: H, ops: [] }; pages.push(page); col = 0; y = top(); };
  const x0 = () => M + col * (COLW + GUT);
  const room = h => {
    if (y + h <= H - M - 14) return;
    if (col === 0) { col = 1; y = top(); } else newPage();
  };
  const text = (s, x, yy, size, bold, colour = '#1F1D1A') => page.ops.push(`BT /${bold ? 'F2' : 'F1'} ${f2(size)} Tf ${rgb(colour)} rg ${f2(x)} ${f2(H - yy)} Td (${pdfText(s)}) Tj ET`);
  const rect = (x, yy, w, h, fill, stroke) => page.ops.push(`${fill ? rgb(fill) + ' rg ' : ''}${stroke ? rgb(stroke) + ' RG 0.7 w ' : ''}${f2(x)} ${f2(H - yy - h)} ${f2(w)} ${f2(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
  const tickBox = (x, yy, size, done) => {
    rect(x, yy, size, size, done ? '#5F5A52' : null, '#8A847A');
    if (done) page.ops.push(`1 1 1 RG 1 w ${f2(x + size * 0.2)} ${f2(H - yy - size * 0.55)} m ${f2(x + size * 0.42)} ${f2(H - yy - size * 0.78)} l ${f2(x + size * 0.82)} ${f2(H - yy - size * 0.25)} l S`);
  };

  newPage();
  // Heading on the first page.
  text(doc.title, M, M + 14, S.title, true);
  if (doc.sub) text(doc.sub, M, M + 30, S.small + 0.6, false, '#6F6A62');
  page.ops.push(`${rgb('#D8D3CA')} RG 0.8 w ${f2(M)} ${f2(H - M - 38)} m ${f2(W - M)} ${f2(H - M - 38)} l S`);

  for (const g of doc.groups) {
    if (!g.items.length) continue;
    if (g.name) {
      room(16 + 14);
      rect(x0(), y, COLW, 13, g.tone === 'late' ? '#F7DCD9' : '#ECE8E1');
      text(g.name.toUpperCase(), x0() + 4, y + 9.3, 6.8, true, g.tone === 'late' ? late : '#3A352E');
      y += 16;
    }
    for (const it of g.items) {
      const indent = 11, maxW = COLW - indent - (it.dueText ? width(it.dueText, S.small, false) + 6 : 0);
      const tl = wrap(it.title + (it.where ? '  · ' + it.where : ''), S.body, it.kind !== 'task', maxW);
      const lh = S.body * 1.28;
      room(tl.length * lh + 2);
      const xx = x0();
      if (it.kind === 'task') tickBox(xx, y + 1.2, 7, it.done);
      else rect(xx + 1.5, y + 2.5, 4, 4, it.kind === 'project' ? '#3F6FB5' : accent);
      tl.forEach((l, i) => text(l, xx + indent, y + S.body + i * lh - 1, S.body, it.kind !== 'task', it.done ? '#8A847A' : '#1F1D1A'));
      if (it.dueText) text(it.dueText, xx + COLW - width(it.dueText, S.small, false), y + S.body - 1, S.small, false, it.late ? late : '#6F6A62');
      y += tl.length * lh + 1.5;
      // Steps, and what a note says (checklists, lists, tables), smaller underneath.
      const sub = [...(it.steps || []).map(s => ({ t: 'check', text: s.title, done: s.done })), ...(it.lines || [])];
      for (const l of sub) {
        if (l.t === 'rows') {
          const rows = l.rows.slice(0, 60), ncol = Math.max(...rows.map(r => r.length));
          const cw = (COLW - indent) / Math.max(1, ncol);
          for (const [ri, r] of rows.entries()) {
            room(S.small * 1.35);
            r.forEach((v, ci) => {
              let s = printable(v);
              while (s && width(s, S.small, false) > cw - 3) s = s.slice(0, -1);
              text(s, xx + indent + ci * cw, y + S.small, S.small, ri === 0 && l.head, '#3A352E');
            });
            y += S.small * 1.35;
          }
          y += 2;
          continue;
        }
        const lead = l.t === 'check' ? 9 : l.t === 'li' ? 7 : 0;
        const ll = wrap(l.text, S.small, l.t === 'h', COLW - indent - lead);
        for (const [i, line] of ll.entries()) {
          room(S.small * 1.3);
          if (i === 0 && l.t === 'check') tickBox(xx + indent, y + 1, 5.6, l.done);
          if (i === 0 && l.t === 'li') text('•', xx + indent + 1, y + S.small, S.small, false, '#6F6A62');
          text(line, xx + indent + lead, y + S.small, S.small, l.t === 'h', l.done ? '#9A9488' : '#4A453D');
          y += S.small * 1.3;
        }
      }
      if (sub.length) y += 2;
      y += 2.5;
    }
    y += 4;
  }
  // Page numbers.
  pages.forEach((p, i) => p.ops.push(`BT /F1 6.5 Tf ${rgb('#9A9488')} rg ${f2(M)} ${f2(M - 14)} Td (${pdfText(doc.title)} \\267 ${i + 1} of ${pages.length}) Tj ET`));
  return buildPDF(pages.map(p => ({ w: p.w, h: p.h, content: p.ops.join('\n') })));
}

// A picture (JPEG) on one A4 page, turned whichever way suits it.
export async function imagePDF(jpeg, w, h, title = '') {
  const data = new Uint8Array(await jpeg.arrayBuffer());
  const land = w > h;
  const PW = land ? 841.89 : 595.28, PH = land ? 595.28 : 841.89, M = 24;
  const k = Math.min((PW - 2 * M) / w, (PH - 2 * M - (title ? 14 : 0)) / h);
  const iw = w * k, ih = h * k, x = (PW - iw) / 2, y = M + (PH - 2 * M - ih - (title ? 14 : 0)) / 2;
  const ops = [];
  if (title) ops.push(`BT /F2 9 Tf ${rgb('#3A352E')} rg ${f2(M)} ${f2(PH - M + 4)} Td (${pdfText(title)}) Tj ET`);
  ops.push(`q ${f2(iw)} 0 0 ${f2(ih)} ${f2(x)} ${f2(y)} cm /Im1 Do Q`);
  return buildPDF([{ w: PW, h: PH, content: ops.join('\n'), images: ['Im1'] }], { Im1: { w, h, data } });
}

// ---------- A board as a picture ----------

// An SVG (as text) drawn onto a canvas. Everything in it must be inside it (pictures as data: links).
export function svgToCanvas(svg, w, h, scale) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t draw the board as a picture.')); };
    img.src = url;
  });
}
export const canvasBlob = (c, type, q) => new Promise(r => c.toBlob(r, type, q));
