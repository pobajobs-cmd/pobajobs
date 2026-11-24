// (0.9.0) The page a read-only link opens: a snapshot of one project (its list, and a picture of its
// board), fetched with the link's token. Everything is shown as plain text.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const day = s => (s ? parse(s).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '');
const money = n => '£' + (Math.round(n * 100) / 100).toLocaleString('en-GB', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

const token = location.hash.slice(1);
let snap = null, tab = 'list';

async function load() {
  if (!/^[A-Za-z0-9_-]{20,48}$/.test(token)) { $('#main').innerHTML = '<p class="msg">This link isn’t complete. Ask for it again.</p>'; return; }
  try {
    const res = await fetch('/api/braintree/share/' + token, { cache: 'no-store' });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'Couldn’t open it.');
    snap = out;
  } catch (e) { $('#main').innerHTML = `<p class="msg">${esc(e.message === 'Failed to fetch' ? 'No signal: try again in a moment.' : e.message)}</p>`; return; }
  tab = snap.board ? 'board' : 'list';
  document.title = snap.title + ' · Brain Tree';
  draw();
}

function draw() {
  const s = snap, today = s.today;
  const bits = [];
  if (s.start || s.due) bits.push(`<span>${s.start ? esc(day(s.start)) : '…'} → ${s.due ? esc(day(s.due)) : '…'}</span>`);
  if (s.progress?.total) bits.push(`<span>${s.progress.done} of ${s.progress.total} done<span class="bar"><i style="width:${Math.round(100 * s.progress.done / s.progress.total)}%"></i></span></span>`);
  if (s.cost) bits.push(`<span>${esc(money(s.cost.spent))} spent of ${esc(money(s.cost.planned))}${s.cost.budget ? ` (budget ${esc(money(s.cost.budget))})` : ''}</span>`);
  bits.push(`<span>As of ${esc(new Date(s.made).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>`);
  $('#head').innerHTML = `<p class="from">Shared from Brain Tree</p><h1>${esc(s.title)}</h1><p class="sub">${bits.join('')}</p>
    ${s.board ? `<div class="tabs" role="tablist"><button data-tab="board" class="${tab === 'board' ? 'on' : ''}">Board</button><button data-tab="list" class="${tab === 'list' ? 'on' : ''}">List</button></div>` : ''}`;
  if (tab === 'board' && s.board) {
    $('#main').innerHTML = `<div class="board"><img src="${esc(s.board.img)}" width="${+s.board.w || ''}" height="${+s.board.h || ''}" alt="The project’s board"></div><p class="hint">Tap the picture to see it full size.</p>`;
    return;
  }
  const item = it => {
    const late = !it.done && it.due && it.due < today;
    const meta = [it.cost ? money(it.cost) : '', it.check ? it.check + ' ticked' : '', it.due ? day(it.due) : it.start ? 'from ' + day(it.start) : ''].filter(Boolean).join(' · ');
    return `<div class="item ${it.done ? 'done' : ''}"><div class="line">${it.type === 'task' ? `<span class="tick ${it.done ? 'done' : ''}"></span>` : `<span class="kind">${esc(it.type === 'project' ? 'Project' : it.kind || 'Note')}</span>`}
      <span class="t">${esc(it.title)}</span>${meta ? `<span class="meta ${late ? 'late' : ''}">${esc(meta)}</span>` : ''}</div>
      ${it.waiting?.length ? `<p class="wait">Waiting on ${esc(it.waiting.join(', '))}</p>` : ''}
      ${it.steps?.length ? `<ul class="steps">${it.steps.map(st => `<li class="${st.done ? 'done' : ''}">${st.done ? '✓' : '○'} ${esc(st.title)}</li>`).join('')}</ul>` : ''}
      ${it.text && it.text !== it.title ? `<p class="txt">${esc(it.text)}</p>` : ''}</div>`;
  };
  $('#main').innerHTML = (s.notes ? `<p class="notes">${esc(s.notes)}</p>` : '') + s.groups.filter(g => g.items.length).map(g => `<section class="group">${g.name ? `<h2>${esc(g.name)}</h2>` : ''}${g.items.map(item).join('')}</section>`).join('')
    || '<p class="msg">Nothing in it yet.</p>';
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) { tab = t.dataset.tab; draw(); return; }
  const b = e.target.closest('.board img');
  if (b) b.parentElement.classList.toggle('big');
});
window.addEventListener('hashchange', () => location.reload());
load();
