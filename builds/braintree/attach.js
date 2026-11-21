// Files and links in a note (and so on a board): any kind of file from the device (PDFs, Word,
// Excel, PowerPoint, text, zips, audio…) and links to documents kept elsewhere (Google Docs,
// OneDrive, Dropbox, any web page). Shown as tiles with what kind of thing it is.
//   a file   <div data-doc="id" data-name="Quote.pdf" data-size="123456" data-mime="application/pdf" data-parts="1"></div>
//   a link   <div data-weblink="https://…" data-title="Budget"></div>
// The file itself is kept like a photo (on the device, uploaded in pieces of under 2 MB: see store.js).

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What kind of file, by its name or type: a short label and a colour for its tile.
const KINDS = [
  [/\.pdf$|\/pdf$/i, 'PDF', '#D93025'],
  [/\.(docx?|odt|rtf|pages)$|word|opendocument\.text/i, 'Word', '#2B579A'],
  [/\.(xlsx?|ods|numbers|csv|tsv)$|excel|spreadsheet|\/csv$/i, 'Sheet', '#1E7145'],
  [/\.(pptx?|odp|key)$|powerpoint|presentation/i, 'Slides', '#D24726'],
  [/\.(zip|rar|7z|gz|tar)$|zip|compressed/i, 'Zip', '#6B6B6B'],
  [/\.(mp3|m4a|wav|aac|ogg|flac)$|^audio\//i, 'Audio', '#8E44AD'],
  [/\.(mp4|mov|m4v|webm|avi)$|^video\//i, 'Video', '#C0392B'],
  [/\.(png|jpe?g|gif|webp|heic|svg)$|^image\//i, 'Image', '#2E86C1'],
  [/\.(txt|md|json|xml|html?|js|css|py)$|^text\//i, 'Text', '#5D6D7E'],
];
export function fileKind(name = '', mime = '') {
  for (const [re, label, colour] of KINDS) if (re.test(name) || re.test(mime)) return { label, colour };
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(name) || [])[1];
  return { label: ext ? ext.toUpperCase() : 'File', colour: '#7A7A7A' };
}

export function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' bytes';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
}

// Well-known places documents live, so a link says what it is.
const SERVICES = [
  [/^https:\/\/([a-z0-9-]+\.)?claude\.(ai|com)\//, 'Claude chat', '#D97757'],
  [/docs\.google\.com\/document/, 'Google Doc', '#4285F4'],
  [/docs\.google\.com\/spreadsheets/, 'Google Sheet', '#0F9D58'],
  [/docs\.google\.com\/presentation/, 'Google Slides', '#F4B400'],
  [/docs\.google\.com\/forms/, 'Google Form', '#7248B9'],
  [/drive\.google\.com/, 'Google Drive', '#1FA463'],
  [/(onedrive\.live\.com|1drv\.ms)/, 'OneDrive', '#0078D4'],
  [/sharepoint\.com/, 'SharePoint', '#038387'],
  [/dropbox\.com/, 'Dropbox', '#0061FF'],
  [/icloud\.com/, 'iCloud', '#3693F3'],
  [/figma\.com/, 'Figma', '#A259FF'],
  [/(notion\.so|notion\.site)/, 'Notion', '#111111'],
  [/canva\.com/, 'Canva', '#00C4CC'],
  [/miro\.com/, 'Miro', '#E6B800'],
  [/github\.com/, 'GitHub', '#24292F'],
  [/trello\.com/, 'Trello', '#0079BF'],
  [/(youtube\.com|youtu\.be)/, 'YouTube', '#FF0000'],
  [/(amazon\.|amzn\.)/, 'Amazon', '#FF9900'],
];
export function linkService(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (e) { host = url; }
  for (const [re, name, colour] of SERVICES) if (re.test(url)) return { name, colour, host };
  return { name: host, colour: '#5D6D7E', host };
}

export const docInfo = el => ({ id: el.getAttribute('data-doc'), name: el.getAttribute('data-name') || 'File', size: +el.getAttribute('data-size') || 0, mime: el.getAttribute('data-mime') || 'application/octet-stream', parts: +el.getAttribute('data-parts') || 1 });
export const linkInfo = el => ({ url: el.getAttribute('data-weblink'), title: el.getAttribute('data-title') || '' });

export const docDivHTML = d => `<div data-doc="${esc(d.id)}" data-name="${esc(d.name)}" data-size="${d.size | 0}" data-mime="${esc(d.mime)}" data-parts="${d.parts | 0 || 1}"></div>`;
export const linkDivHTML = l => `<div data-weblink="${esc(l.url)}"${l.title ? ` data-title="${esc(l.title)}"` : ''}></div>`;
export function writeDoc(el, d) { for (const [k, v] of Object.entries({ doc: d.id, name: d.name, size: d.size | 0, mime: d.mime, parts: d.parts || 1 })) el.setAttribute('data-' + k, v); }
export function writeLink(el, l) { el.setAttribute('data-weblink', l.url); if (l.title) el.setAttribute('data-title', l.title); else el.removeAttribute('data-title'); }

const DOC_IC = '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';
const LINK_IC = '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';

// A file's tile: its kind (coloured), name and size.
export function docTileHTML(d, extra = '') {
  const k = fileKind(d.name, d.mime);
  return `<span class="tkind" style="--k:${k.colour}">${DOC_IC}<b>${esc(k.label)}</b></span><span class="tname"><b>${esc(d.name)}</b><small>${esc(fmtSize(d.size))}</small></span>${extra}`;
}
// A link's tile: where it is (Google Doc, Dropbox…), its name, its address.
export function linkTileHTML(l, extra = '') {
  const s = linkService(l.url);
  return `<span class="tkind link" style="--k:${s.colour}">${LINK_IC}</span><span class="tname"><b>${esc(l.title || s.name)}</b><small>${esc(l.title ? s.name : s.host)}</small></span>${extra}`;
}
