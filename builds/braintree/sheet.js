// Spreadsheets: a small grid of cells inside a note (so it's on the board as a card, and in the
// lists), with sums and other formulas like a spreadsheet app. Saved in the note as
//   <div data-sheet='{"v":1,"c":[["Item","Cost"],["Paint","12.50"],["Total","=SUM(B2:B3)"]],"h":1}'></div>
// c is the rows of cells as typed (a formula starts with =), h: 1 when the first row is a heading.
// Copy cells in Excel, Numbers or Google Sheets and paste them into any cell; a CSV file opens too.
//
// Formulas: + - * / ^ (power) & (join text) % and comparisons (= <> < > <= >=), cells like B3 or
// $B$3, ranges like B2:B9, and SUM AVERAGE (AVG) MIN MAX COUNT COUNTA PRODUCT ROUND ABS SQRT
// IF AND OR NOT CONCAT LEN UPPER LOWER. Problems show as #REF! #DIV/0! #NAME? #VALUE! #CYCLE!

const MAX_ROWS = 300, MAX_COLS = 26, MAX_CELL = 1000;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const colName = i => String.fromCharCode(65 + i);

// Checks a saved sheet (it comes from a note, so it might be anything). null if it isn't one.
export function cleanSheet(raw) {
  let s = raw;
  if (typeof raw === 'string') { try { s = JSON.parse(raw); } catch (e) { return null; } }
  if (!s || typeof s !== 'object' || !Array.isArray(s.c)) return null;
  const rows = s.c.slice(0, MAX_ROWS).map(r => (Array.isArray(r) ? r.slice(0, MAX_COLS).map(v => String(v ?? '').slice(0, MAX_CELL)) : []));
  const cols = Math.max(1, ...rows.map(r => r.length));
  const c = (rows.length ? rows : [['']]).map(r => [...r, ...Array(cols - r.length).fill('')]);
  return { v: 1, c, h: s.h ? 1 : 0 };
}

export const sheetDivHTML = s => `<div data-sheet='${esc(JSON.stringify(cleanSheet(s)))}'></div>`;
export const blankSheet = () => ({ v: 1, h: 1, c: [['', '', ''], ['', '', ''], ['', '', ''], ['', '', '']] });

// ---------- Working out the cells ----------

// A number as typed: "12", "1,200.50", "£12.50", "-3", "15%". null if it isn't one.
function numberOf(s) {
  const t = String(s).trim();
  if (!t) return null;
  const m = /^([-+]?)\s*[£$€]?\s*([-+]?)(\d{1,3}(?:,\d{3})+|\d*)(\.\d+)?\s*(%?)$/.exec(t);
  if (!m || (!m[3] && !m[4])) return null;
  let n = parseFloat((m[3] || '0').replace(/,/g, '') + (m[4] || ''));
  if (m[1] === '-' || m[2] === '-') n = -n;
  return m[5] ? n / 100 : n;
}

class SheetError { constructor(code) { this.code = code; } toString() { return this.code; } }
const E = code => new SheetError(code);
const isErr = v => v instanceof SheetError;

// Works out every cell. Returns { value(r, c), text(r, c) }.
export function evaluate(sheet) {
  const c = sheet.c, memo = new Map(), busy = new Set();
  const raw = (r, k) => (c[r] && c[r][k] != null ? c[r][k] : '');
  function value(r, k) {
    const key = r + ':' + k;
    if (memo.has(key)) return memo.get(key);
    const s = raw(r, k);
    let v;
    if (typeof s === 'string' && s.startsWith('=') && s.length > 1) {
      if (busy.has(key)) return E('#CYCLE!');
      busy.add(key);
      try { v = run(s.slice(1)); } catch (e) { v = isErr(e) ? e : E('#VALUE!'); }
      busy.delete(key);
    } else {
      const n = numberOf(s);
      v = n == null ? s : n;
    }
    memo.set(key, v);
    return v;
  }

  // ----- reading a formula -----
  function run(src) {
    const toks = tokens(src);
    let i = 0;
    const peek = () => toks[i], next = () => toks[i++];
    const want = t => { if (peek()?.t !== t) throw E('#VALUE!'); return next(); };
    const parseCmp = () => {
      let a = parseJoin();
      while (peek()?.t === 'cmp') { const op = next().v, b = parseJoin(); a = compare(op, a, b); }
      return a;
    };
    const parseJoin = () => {
      let a = parseAdd();
      while (peek()?.t === '&') { next(); const b = parseAdd(); a = text(scalar(a)) + text(scalar(b)); }
      return a;
    };
    const parseAdd = () => {
      let a = parseMul();
      while (peek()?.t === '+' || peek()?.t === '-') { const op = next().t, b = parseMul(); a = arith(op, a, b); }
      return a;
    };
    const parseMul = () => {
      let a = parsePow();
      while (peek()?.t === '*' || peek()?.t === '/') { const op = next().t, b = parsePow(); a = arith(op, a, b); }
      return a;
    };
    const parsePow = () => {
      const a = parseUnary();
      if (peek()?.t === '^') { next(); return arith('^', a, parsePow()); }
      return a;
    };
    const parseUnary = () => {
      if (peek()?.t === '-') { next(); return arith('*', -1, parseUnary()); }
      if (peek()?.t === '+') { next(); return parseUnary(); }
      let v = parseAtom();
      while (peek()?.t === '%') { next(); v = arith('/', v, 100); }
      return v;
    };
    const parseAtom = () => {
      const t = next();
      if (!t) throw E('#VALUE!');
      if (t.t === 'num') return t.v;
      if (t.t === 'str') return t.v;
      if (t.t === '(') { const v = parseCmp(); want(')'); return v; }
      if (t.t === 'range') return { range: t.v };
      if (t.t === 'ref') return value(t.v.r, t.v.c);
      if (t.t === 'name') {
        if (peek()?.t !== '(') { if (t.v === 'TRUE') return true; if (t.v === 'FALSE') return false; throw E('#NAME?'); }
        next();
        const args = [];
        if (peek()?.t !== ')') { args.push(parseCmp()); while (peek()?.t === ',') { next(); args.push(parseCmp()); } }
        want(')');
        return call(t.v, args);
      }
      throw E('#VALUE!');
    };
    const v = parseCmp();
    if (i < toks.length) throw E('#VALUE!');
    return scalar(v);
  }

  function tokens(src) {
    const out = [];
    let i = 0;
    const re = {
      space: /^\s+/, num: /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i, str: /^"((?:[^"]|"")*)"/,
      range: /^\$?([A-Z])\$?(\d{1,4}):\$?([A-Z])\$?(\d{1,4})/i, ref: /^\$?([A-Z])\$?(\d{1,4})(?![A-Z0-9(])/i,
      name: /^[A-Z][A-Z0-9.]*/i, cmp: /^(<>|<=|>=|=|<|>)/,
    };
    while (i < src.length) {
      const s = src.slice(i);
      let m;
      if ((m = re.space.exec(s))) { i += m[0].length; continue; }
      if ((m = re.num.exec(s))) { out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = re.str.exec(s))) { out.push({ t: 'str', v: m[1].replace(/""/g, '"') }); i += m[0].length; continue; }
      if ((m = re.range.exec(s))) {
        const a = { c: m[1].toUpperCase().charCodeAt(0) - 65, r: +m[2] - 1 }, b = { c: m[3].toUpperCase().charCodeAt(0) - 65, r: +m[4] - 1 };
        out.push({ t: 'range', v: { r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r), c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c) } });
        i += m[0].length; continue;
      }
      if ((m = re.ref.exec(s))) { out.push({ t: 'ref', v: { c: m[1].toUpperCase().charCodeAt(0) - 65, r: +m[2] - 1 } }); i += m[0].length; continue; }
      if ((m = re.name.exec(s))) { out.push({ t: 'name', v: m[0].toUpperCase() }); i += m[0].length; continue; }
      if ((m = re.cmp.exec(s))) { out.push({ t: 'cmp', v: m[0] }); i += m[0].length; continue; }
      if ('+-*/^&%(),;'.includes(s[0])) { out.push({ t: s[0] === ';' ? ',' : s[0] }); i++; continue; }
      throw E('#VALUE!');
    }
    return out;
  }

  // The cells a range covers (an empty cell counts as nothing).
  function cellsOf(rg) {
    const out = [];
    for (let r = rg.r0; r <= rg.r1; r++) for (let k = rg.c0; k <= rg.c1; k++) out.push(value(r, k));
    return out;
  }
  const scalar = v => {
    if (v && v.range) { const { r0, c0, r1, c1 } = v.range; if (r0 === r1 && c0 === c1) return value(r0, c0); throw E('#VALUE!'); }
    if (isErr(v)) throw v;
    return v;
  };
  const num = v => {
    v = scalar(v);
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v === '') return 0;
    const n = numberOf(v);
    if (n == null) throw E('#VALUE!');
    return n;
  };
  const text = v => (typeof v === 'number' ? fmt(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
  function arith(op, a, b) {
    const x = num(a), y = num(b);
    if (op === '+') return x + y;
    if (op === '-') return x - y;
    if (op === '*') return x * y;
    if (op === '/') { if (y === 0) throw E('#DIV/0!'); return x / y; }
    return Math.pow(x, y);
  }
  function compare(op, a, b) {
    a = scalar(a); b = scalar(b);
    const both = typeof a === 'number' && typeof b === 'number';
    const x = both ? a : text(a).toLowerCase(), y = both ? b : text(b).toLowerCase();
    return { '=': x === y, '<>': x !== y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[op];
  }
  // Numbers among the arguments (ranges skip text and blanks, like a spreadsheet app).
  function nums(args) {
    const out = [];
    for (const a of args) {
      if (a && a.range) { for (const v of cellsOf(a.range)) { if (isErr(v)) throw v; if (typeof v === 'number') out.push(v); } }
      else out.push(num(a));
    }
    return out;
  }
  function call(name, args) {
    const n = () => nums(args);
    switch (name) {
      case 'SUM': return n().reduce((s, x) => s + x, 0);
      case 'AVERAGE': case 'AVG': { const xs = n(); if (!xs.length) throw E('#DIV/0!'); return xs.reduce((s, x) => s + x, 0) / xs.length; }
      case 'MIN': { const xs = n(); return xs.length ? Math.min(...xs) : 0; }
      case 'MAX': { const xs = n(); return xs.length ? Math.max(...xs) : 0; }
      case 'COUNT': return n().length;
      case 'COUNTA': { let k = 0; for (const a of args) { if (a && a.range) k += cellsOf(a.range).filter(v => v !== '').length; else if (scalar(a) !== '') k++; } return k; }
      case 'PRODUCT': return n().reduce((s, x) => s * x, 1);
      case 'ROUND': { const x = num(args[0]), d = args[1] == null ? 0 : num(args[1]), p = Math.pow(10, d); return Math.round(x * p) / p; }
      case 'ABS': return Math.abs(num(args[0]));
      case 'SQRT': { const x = num(args[0]); if (x < 0) throw E('#VALUE!'); return Math.sqrt(x); }
      case 'IF': { const c = scalar(args[0]); const yes = typeof c === 'string' ? c !== '' : !!c; return yes ? (args[1] == null ? true : scalar(args[1])) : (args[2] == null ? false : scalar(args[2])); }
      case 'AND': return args.every(a => !!scalar(a));
      case 'OR': return args.some(a => !!scalar(a));
      case 'NOT': return !scalar(args[0]);
      case 'CONCAT': case 'CONCATENATE': return args.map(a => (a && a.range ? cellsOf(a.range).map(text).join('') : text(scalar(a)))).join('');
      case 'LEN': return text(scalar(args[0])).length;
      case 'UPPER': return text(scalar(args[0])).toUpperCase();
      case 'LOWER': return text(scalar(args[0])).toLowerCase();
      default: throw E('#NAME?');
    }
  }

  return {
    value,
    // What a cell shows: the result of a formula, otherwise what was typed.
    text(r, k) {
      const s = raw(r, k);
      if (!(typeof s === 'string' && s.startsWith('=') && s.length > 1)) return s;
      const v = value(r, k);
      return isErr(v) ? v.code : text(v);
    },
    isNumber(r, k) { const v = value(r, k); return typeof v === 'number'; },
    isError(r, k) { return isErr(value(r, k)); },
  };
}

// Numbers without float noise ("0.30000000000000004" is 0.3), at most 6 decimals.
function fmt(n) {
  if (!Number.isFinite(n)) return '#NUM!';
  const r = Math.round(n * 1e6) / 1e6;
  return Math.abs(r) >= 1e15 ? String(r) : r.toLocaleString(undefined, { maximumFractionDigits: 6, useGrouping: Math.abs(r) >= 10000 });
}

// The sheet as a plain table (for a note, a card, an export). maxRows/maxCols trim a big one.
export function sheetTableHTML(sheet, { maxRows = Infinity, maxCols = Infinity } = {}) {
  const s = cleanSheet(sheet);
  if (!s) return '';
  const ev = evaluate(s);
  const rows = s.c.length, cols = s.c[0].length;
  // Trailing empty rows and columns aren't shown.
  let lastR = rows - 1, lastC = cols - 1;
  while (lastR > 0 && s.c[lastR].every(v => !String(v).trim())) lastR--;
  while (lastC > 0 && s.c.every(r => !String(r[lastC] ?? '').trim())) lastC--;
  const R = Math.min(lastR + 1, maxRows), C = Math.min(lastC + 1, maxCols);
  let html = '<table class="sheettable"><tbody>';
  for (let r = 0; r < R; r++) {
    html += '<tr>';
    for (let k = 0; k < C; k++) {
      const tag = s.h && r === 0 ? 'th' : 'td';
      const cls = [ev.isNumber(r, k) ? 'n' : '', ev.isError(r, k) ? 'err' : ''].filter(Boolean).join(' ');
      html += `<${tag}${cls ? ` class="${cls}"` : ''}>${esc(ev.text(r, k))}</${tag}>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  const more = [lastR + 1 > R ? `${lastR + 1 - R} more row${lastR + 1 - R === 1 ? '' : 's'}` : '', lastC + 1 > C ? `${lastC + 1 - C} more column${lastC + 1 - C === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  return html + (more ? `<p class="sheetmore">+ ${more}</p>` : '');
}

// Plain text rows (for exports): what each cell shows.
export function sheetRows(sheet) {
  const s = cleanSheet(sheet);
  if (!s) return [];
  const ev = evaluate(s);
  let rows = s.c.map((row, r) => row.map((_, k) => ev.text(r, k)));
  while (rows.length > 1 && rows[rows.length - 1].every(v => !String(v).trim())) rows.pop();
  let last = rows[0].length - 1;
  while (last > 0 && rows.every(r => !String(r[last] ?? '').trim())) last--;
  return rows.map(r => r.slice(0, last + 1));
}

// ---------- CSV ----------

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
export function toCSV(rows) {
  return rows.map(r => r.map(v => (/[",\n\r]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
}

// ---------- The editor (full screen) ----------

const IC = {
  row: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M12 15v4M10 17h4"/></svg>',
  col: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M16 10h4M18 8v4"/></svg>',
  delrow: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 12h18M9 16h6"/></svg>',
  delcol: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M15 12h5"/></svg>',
  head: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18" stroke-width="3"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

// Resolves with the sheet when you press Done, 'remove' to take it out, or null if you cancel.
export function openSheet({ sheet = null, title = 'Spreadsheet', saveFile } = {}) {
  return new Promise(resolve => {
    let s = cleanSheet(sheet) || blankSheet();
    const original = JSON.stringify(s);
    let sel = { r: 0, c: 0 };
    const pad = document.createElement('div');
    pad.id = 'sheetpad';
    pad.innerHTML = `
      <header class="dhead"><button type="button" data-x="cancel">Cancel</button><h2>${esc(title)}</h2><button type="button" class="primary" data-x="done">Done</button></header>
      <div class="sbar"><span class="sref">A1</span><input class="sfx" placeholder="Type a value, or a formula like =SUM(B2:B6)" autocomplete="off" spellcheck="false" enterkeyhint="done"></div>
      <div class="sgridwrap"><table class="sgrid"></table></div>
      <p class="shint">Tip: copy cells in Excel or Google Sheets and paste them into a cell here. Formulas start with =, like =B2*C2 or =SUM(D2:D9).</p>
      <footer class="dtools">
        <button type="button" data-x="row" title="Add a row">${IC.row}<span>Row</span></button>
        <button type="button" data-x="col" title="Add a column">${IC.col}<span>Column</span></button>
        <button type="button" data-x="delrow" title="Delete the selected row">${IC.delrow}<span>Delete row</span></button>
        <button type="button" data-x="delcol" title="Delete the selected column">${IC.delcol}<span>Delete column</span></button>
        <span class="sep"></span>
        <button type="button" data-x="head" title="First row is a heading">${IC.head}<span>Heading</span></button>
        <button type="button" data-x="csv" title="Open a CSV file (Excel can save as CSV)">${IC.file}<span>Open CSV</span></button>
        ${saveFile ? `<button type="button" data-x="save" title="Save as a CSV file (opens in Excel)">${IC.save}<span>Save CSV</span></button>` : ''}
        ${sheet ? `<button type="button" data-x="remove" class="danger" title="Take the spreadsheet out of the note">${IC.trash}<span>Remove</span></button>` : ''}
        <input type="file" accept=".csv,text/csv,text/plain" hidden>
      </footer>`;
    document.body.append(pad);
    const grid = pad.querySelector('.sgrid'), fx = pad.querySelector('.sfx'), ref = pad.querySelector('.sref'), file = pad.querySelector('input[type=file]');

    const rows = () => s.c.length, cols = () => s.c[0].length;
    const cellEl = (r, c) => grid.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
    function draw() {
      const ev = evaluate(s);
      let html = `<thead><tr><th class="corner"></th>${s.c[0].map((_, c) => `<th class="${c === sel.c ? 'on' : ''}">${colName(c)}</th>`).join('')}</tr></thead><tbody>`;
      for (let r = 0; r < rows(); r++) {
        html += `<tr class="${s.h && r === 0 ? 'hrow' : ''}"><th class="${r === sel.r ? 'on' : ''}">${r + 1}</th>`;
        for (let c = 0; c < cols(); c++) {
          const cls = [ev.isNumber(r, c) ? 'n' : '', ev.isError(r, c) ? 'err' : '', r === sel.r && c === sel.c ? 'sel' : ''].filter(Boolean).join(' ');
          html += `<td><input data-r="${r}" data-c="${c}" class="${cls}" value="${esc(ev.text(r, c))}" autocomplete="off" spellcheck="false" enterkeyhint="next"></td>`;
        }
        html += '</tr>';
      }
      grid.innerHTML = html + '</tbody>';
      ref.textContent = colName(sel.c) + (sel.r + 1);
      if (document.activeElement !== fx) fx.value = s.c[sel.r]?.[sel.c] ?? '';
      pad.querySelector('[data-x=head]').classList.toggle('on', !!s.h);
    }
    // Typing in a cell edits what was typed (a formula shows as the formula while you're in it).
    function select(r, c, focus = true) {
      sel = { r: Math.max(0, Math.min(rows() - 1, r)), c: Math.max(0, Math.min(cols() - 1, c)) };
      for (const el of grid.querySelectorAll('.sel')) el.classList.remove('sel');
      for (const el of grid.querySelectorAll('th.on')) el.classList.remove('on');
      const el = cellEl(sel.r, sel.c);
      el?.classList.add('sel');
      grid.querySelector(`thead th:nth-child(${sel.c + 2})`)?.classList.add('on');
      grid.querySelector(`tbody tr:nth-child(${sel.r + 1}) th`)?.classList.add('on');
      ref.textContent = colName(sel.c) + (sel.r + 1);
      fx.value = s.c[sel.r][sel.c];
      if (focus && el) { el.focus(); el.select?.(); el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    }
    function setCell(r, c, v) {
      while (rows() <= r && rows() < MAX_ROWS) s.c.push(Array(cols()).fill(''));
      while (cols() <= c && cols() < MAX_COLS) s.c.forEach(row => row.push(''));
      if (r < rows() && c < cols()) s.c[r][c] = String(v).slice(0, MAX_CELL);
    }
    // Show results everywhere but the cell you're in.
    function refresh() {
      const ev = evaluate(s);
      for (const el of grid.querySelectorAll('input[data-r]')) {
        const r = +el.dataset.r, c = +el.dataset.c;
        if (el === document.activeElement) continue;
        el.value = ev.text(r, c);
        el.classList.toggle('n', ev.isNumber(r, c));
        el.classList.toggle('err', ev.isError(r, c));
      }
    }

    grid.addEventListener('focusin', e => {
      const el = e.target.closest('input[data-r]');
      if (!el) return;
      const r = +el.dataset.r, c = +el.dataset.c;
      if (r !== sel.r || c !== sel.c) select(r, c, false);
      el.value = s.c[r][c];
      el.select?.();
    });
    grid.addEventListener('input', e => {
      const el = e.target.closest('input[data-r]');
      if (!el) return;
      s.c[+el.dataset.r][+el.dataset.c] = el.value.slice(0, MAX_CELL);
      fx.value = el.value;
    });
    grid.addEventListener('focusout', e => { if (e.target.closest('input[data-r]')) setTimeout(refresh, 0); });
    grid.addEventListener('keydown', e => {
      const el = e.target.closest('input[data-r]');
      if (!el) return;
      const r = +el.dataset.r, c = +el.dataset.c;
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!e.shiftKey && r === rows() - 1 && rows() < MAX_ROWS) { s.c.push(Array(cols()).fill('')); draw(); }
        select(r + (e.shiftKey ? -1 : 1), c);
      } else if (e.key === 'ArrowDown') { e.preventDefault(); select(r + 1, c); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select(r - 1, c); }
      else if (e.key === 'Tab' && !e.shiftKey && c === cols() - 1 && r < rows() - 1) { e.preventDefault(); select(r + 1, 0); }
      else if (e.key === 'Escape') { e.preventDefault(); el.value = s.c[r][c]; el.blur(); }
    });
    // Pasting cells copied from a spreadsheet app (tab-separated rows) fills the grid from here.
    grid.addEventListener('paste', e => {
      const el = e.target.closest('input[data-r]');
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!el || !/[\t\n]/.test(text.replace(/\n$/, ''))) return;
      e.preventDefault();
      const block = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
      const r0 = +el.dataset.r, c0 = +el.dataset.c;
      block.forEach((row, i) => row.forEach((v, j) => setCell(r0 + i, c0 + j, v)));
      draw(); select(r0, c0);
    });
    fx.addEventListener('input', () => {
      s.c[sel.r][sel.c] = fx.value.slice(0, MAX_CELL);
      const el = cellEl(sel.r, sel.c);
      if (el) el.value = fx.value;
    });
    fx.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); refresh(); select(sel.r + 1 < rows() ? sel.r + 1 : sel.r, sel.c); } });
    fx.addEventListener('change', refresh);

    file.addEventListener('change', async () => {
      const f = file.files[0];
      file.value = '';
      if (!f) return;
      const data = parseCSV(await f.text()).slice(0, MAX_ROWS);
      if (!data.length) return;
      const has = s.c.some(r => r.some(v => String(v).trim()));
      if (has && !confirm('Replace what’s in this spreadsheet with the file?')) return;
      s = cleanSheet({ c: data, h: 1 });
      sel = { r: 0, c: 0 };
      draw();
    });

    pad.addEventListener('click', e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      const x = b.dataset.x;
      if (x === 'cancel') { if (JSON.stringify(s) !== original && !confirm('Leave without keeping your changes?')) return; close(null); }
      else if (x === 'done') close(s);
      else if (x === 'remove') { if (confirm('Take this spreadsheet out of the note?')) close('remove'); }
      else if (x === 'row') { if (rows() < MAX_ROWS) { s.c.splice(sel.r + 1, 0, Array(cols()).fill('')); draw(); select(sel.r + 1, sel.c); } }
      else if (x === 'col') { if (cols() < MAX_COLS) { s.c.forEach(row => row.splice(sel.c + 1, 0, '')); draw(); select(sel.r, sel.c + 1); } }
      else if (x === 'delrow') { if (rows() > 1) { s.c.splice(sel.r, 1); draw(); select(Math.min(sel.r, rows() - 1), sel.c); } }
      else if (x === 'delcol') { if (cols() > 1) { s.c.forEach(row => row.splice(sel.c, 1)); draw(); select(sel.r, Math.min(sel.c, cols() - 1)); } }
      else if (x === 'head') { s.h = s.h ? 0 : 1; draw(); }
      else if (x === 'csv') file.click();
      else if (x === 'save') saveFile?.(new Blob([toCSV(sheetRows(s))], { type: 'text/csv' }), (title || 'spreadsheet').replace(/[^\w\- ]+/g, '').trim() + '.csv');
    });

    function onKey(e) { if (e.key === 'Escape' && !e.target.closest?.('input[data-r]')) { e.preventDefault(); pad.querySelector('[data-x=cancel]').click(); } }
    document.addEventListener('keydown', onKey, true);
    function close(result) {
      document.removeEventListener('keydown', onKey, true);
      pad.remove();
      // Done with nothing in it: nothing to keep.
      if (result && result !== 'remove' && !result.c.some(r => r.some(v => String(v).trim()))) result = sheet ? 'remove' : null;
      resolve(result && result !== 'remove' ? cleanSheet(result) : result);
    }

    draw();
    setTimeout(() => select(0, 0), 30);
  });
}
