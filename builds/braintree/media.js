// YouTube clips: a video, or just the part of it between two times.
// In a note a clip is saved as <div data-yt="VIDEO_ID" data-start="60" data-end="180" data-title="…"></div>
// and shown as its picture with a play button. The video itself only loads when you press play
// (through youtube-nocookie.com, YouTube's no-tracking-until-you-play address).

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
export const isVideoId = id => ID_RE.test(id || '');

// Any YouTube link (watch, youtu.be, shorts, live, embed, the phone and music sites), with its
// ?t= start time if it has one.
export function parseYouTube(text) {
  let u;
  try { u = new URL(String(text || '').trim()); } catch (e) { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else { const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/); if (m) id = m[1]; }
  }
  if (!isVideoId(id)) return null;
  const t = u.searchParams.get('t') || u.searchParams.get('start') || (u.hash.match(/t=([^&]+)/) || [])[1];
  const end = parseTime(u.searchParams.get('end'));
  return { id, start: parseTime(t), end: end || null, title: '' };
}

// "90", "1:30", "1.30" (handy on a phone keypad), "1:02:30", "1m30s" -> seconds. Blank -> null.
export function parseTime(s) {
  s = String(s ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return +s;
  let m = s.match(/^(\d+)[:.](\d{1,2})(?:[:.](\d{1,2}))?$/);
  if (m) return m[3] !== undefined ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return NaN;
}

export function fmtTime(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function rangeText(c) {
  if (c.start && c.end) return `${fmtTime(c.start)} – ${fmtTime(c.end)}`;
  if (c.end) return `0:00 – ${fmtTime(c.end)}`;
  if (c.start) return `from ${fmtTime(c.start)}`;
  return '';
}

export const thumbUrl = id => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
export const watchUrl = c => `https://www.youtube.com/watch?v=${c.id}${c.start ? '&t=' + c.start + 's' : ''}`;
export function embedUrl(c, autoplay = true) {
  const q = new URLSearchParams({ playsinline: '1', rel: '0', modestbranding: '1' });
  if (c.start) q.set('start', c.start);
  if (c.end) q.set('end', c.end);
  if (autoplay) q.set('autoplay', '1');
  return `https://www.youtube-nocookie.com/embed/${c.id}?${q}`;
}
export const iframeHTML = (c, autoplay = true) =>
  `<iframe src="${embedUrl(c, autoplay)}" title="${esc(c.title || 'YouTube video')}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

// Reading and writing the saved form.
export function clipOf(el) {
  const id = el.getAttribute('data-yt');
  if (!isVideoId(id)) return null;
  const num = a => { const v = el.getAttribute(a); return v && /^\d+$/.test(v) ? +v : null; };
  return { id, start: num('data-start'), end: num('data-end'), title: el.getAttribute('data-title') || '' };
}
export function writeClip(el, c) {
  el.setAttribute('data-yt', c.id);
  for (const [a, v] of [['data-start', c.start], ['data-end', c.end], ['data-title', c.title]]) {
    if (v) el.setAttribute(a, String(v)); else el.removeAttribute(a);
  }
}
export function clipDivHTML(c) {
  const d = document.createElement('div');
  writeClip(d, c);
  return d.outerHTML;
}

// What a clip looks like before it plays: its picture, a play button, its name and times.
export function clipFaceHTML(c, { edit = false, big = false } = {}) {
  const range = rangeText(c);
  return `<img class="cthumb" src="${thumbUrl(c.id)}" alt="" loading="lazy" draggable="false">
    <button type="button" class="cplay" data-play aria-label="Play${c.title ? ' ' + esc(c.title) : ''}"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></button>
    <span class="cinfo">${c.title ? `<b>${esc(c.title)}</b>` : '<b>YouTube</b>'}${range ? `<i>${esc(range)}</i>` : ''}</span>
    ${big ? '<button type="button" class="cbig" data-big aria-label="Watch bigger" title="Watch bigger"><svg viewBox="0 0 24 24"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg></button>' : ''}
    ${edit ? '<button type="button" class="cedit" data-clipedit>Times</button>' : ''}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
