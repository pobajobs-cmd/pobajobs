// pobajobs: charity stream ticker, shared by every page.
// When the stream date is set, put it here, e.g. '2026-11-14T10:00' (UK time). Leave '' while it's TBA.
// The ticker counts down, says "Live now" during the 24 hours, thanks everyone after,
// and removes itself on 1 December 2026.
//
// Each page adds it with:
//   <script src="/assets/stream.js" data-flag="Incoming" data-href="/gaming/#charity" data-sep="&#9670;" defer></script>
// and styles .ticker / .flag / .lane / .track / .grp / .hot in its own CSS.
const STREAM_START = '';

(function () {
  const me = document.currentScript;
  const opts = (me && me.dataset) || {};
  const now = () => new Date();
  if (now() >= new Date('2026-12-01T00:00:00')) return;
  const start = STREAM_START ? new Date(STREAM_START) : null;
  const pad = n => String(n).padStart(2, '0');

  function countdown() {
    const t = now();
    if (start) {
      const ms = start - t;
      if (ms <= 0 && t - start < 24 * 3600e3) return 'Live now on Twitch';
      if (ms <= 0) return 'Thank you for the support';
      const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60;
      return `T-minus ${d}d ${pad(h)}h ${pad(m)}m`;
    }
    const d = Math.ceil((new Date('2026-11-01T00:00:00') - t) / 864e5);
    return d > 0 ? `T-minus ${d} day${d === 1 ? '' : 's'} to November` : 'Date dropping soon';
  }

  const live = start && now() >= start && now() - start < 24 * 3600e3;
  const bar = document.createElement('a');
  bar.className = 'ticker';
  bar.href = live ? 'https://www.twitch.tv/pobajobs' : (opts.href || '/gaming/#charity');
  if (live) { bar.target = '_blank'; bar.rel = 'noopener'; }
  bar.setAttribute('aria-label', '24-hour charity stream for Breakthrough T1D, November 2026');
  bar.innerHTML = `<span class="flag">${live ? 'Live' : (opts.flag || 'Incoming')}</span><span class="lane" aria-hidden="true"><span class="track"></span></span>`;
  const track = bar.querySelector('.track');
  const sep = opts.sep || '&#9670;';

  function build() {
    const items = [`<span class="hot">${countdown()}</span>`, '24-hour charity stream', 'In support of Breakthrough T1D',
      'Diabetes Awareness Month',
      start ? start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Date TBA', 'For Kylo'];
    const grp = '<span class="grp">' + items.map(x => (x.startsWith('<') ? x : `<span>${x}</span>`) + `<i>${sep}</i>`).join('') + '</span>';
    const half = grp.repeat(3);          // wide enough for big screens
    track.innerHTML = half + half;       // two identical halves = seamless loop
  }
  build();
  const mount = () => document.body.prepend(bar);
  document.body ? mount() : document.addEventListener('DOMContentLoaded', mount);
  setInterval(build, 60000);
})();
