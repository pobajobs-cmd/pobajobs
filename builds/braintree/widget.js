// (0.9.1) The home screen widget. iPhone home-screen web apps can't have widgets of their own, so
// Brain Tree hands you a short script for the free Scriptable app, which draws one in every size
// (small, medium, large, extra large on an iPad, and the lock screen's round, rectangular and
// inline ones) from the server's read-only widget address (GET /api/braintree/widget/<key>).
// The script carries the address and your theme's colours (light and dark).

export function widgetScript({ url, light, dark, name = 'Brain Tree' }) {
  const col = (k, fb) => `Color.dynamic(new Color(${JSON.stringify(light[k] || fb)}), new Color(${JSON.stringify(dark[k] || fb)}))`;
  return `// ${name} widget for Scriptable. Made by Brain Tree (Settings → Home screen widget).
// Long-press the widget → Edit Widget → Script: this one. It works in every size.
const FEED = ${JSON.stringify(url)};
const C = { bg: ${col('bg')}, card: ${col('card')}, ink: ${col('ink')}, soft: ${col('soft')}, accent: ${col('accent')}, late: ${col('string')} };
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const dayName = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' }); };

let data = null, problem = '';
try {
  const req = new Request(FEED + '?day=' + ymd(new Date()));
  req.timeoutInterval = 15;
  data = await req.loadJSON();
  if (data.error) { problem = data.error; data = null; }
  else Keychain.set('braintree-widget', JSON.stringify(data));
} catch (e) {
  // no signal: show the last one we had
  try { data = JSON.parse(Keychain.get('braintree-widget')); problem = 'Offline'; } catch (e2) { problem = 'Can’t reach Brain Tree'; }
}

const fam = config.widgetFamily || 'large';
const w = new ListWidget();
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
if (data?.app) w.url = data.app;
const n = data ? data.today.length : 0;
const txt = (stack, s, size, color, bold = false, lines = 1) => {
  const t = stack.addText(s);
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  if (color) t.textColor = color;
  t.lineLimit = lines;
  return t;
};

if (fam === 'accessoryInline') {
  txt(w, data ? (n ? n + ' for today · ' + data.today[0].title : 'Nothing due today') : problem, 12);
} else if (fam === 'accessoryCircular') {
  w.addAccessoryWidgetBackground = true;
  const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
  const a = s.addStack(); a.addSpacer(); txt(a, data ? String(n) : '–', 22, null, true); a.addSpacer();
  const b = s.addStack(); b.addSpacer(); txt(b, 'today', 9); b.addSpacer();
} else if (fam === 'accessoryRectangular') {
  txt(w, data ? (n ? n + ' for today' + (data.late ? ' (' + data.late + ' late)' : '') : 'Nothing due today') : problem, 13, null, true);
  for (const it of (data?.today || []).slice(0, 2)) txt(w, '• ' + it.title, 12);
} else {
  w.backgroundColor = C.bg;
  const big = fam === 'large' || fam === 'extraLarge';
  w.setPadding(14, 14, 12, 14);
  const head = w.addStack(); head.centerAlignContent();
  txt(head, ${JSON.stringify(name)}, 11, C.soft, true);
  head.addSpacer();
  if (data && data.late) txt(head, data.late + ' late', 11, C.late, true);
  w.addSpacer(4);
  if (!data) { txt(w, problem, 13, C.ink, false, 3); }
  else {
    const top = w.addStack(); top.bottomAlignContent();
    txt(top, String(n), fam === 'small' ? 34 : 28, C.accent, true);
    top.addSpacer(6);
    txt(top, n === 1 ? 'thing for today' : 'things for today', 12, C.soft);
    w.addSpacer(6);
    const max = fam === 'small' ? 3 : fam === 'medium' ? 3 : fam === 'extraLarge' ? 12 : 8;
    const row = it => {
      const r = w.addStack(); r.centerAlignContent(); r.spacing = 6;
      const dot = r.addStack(); dot.size = new Size(7, 7); dot.cornerRadius = 3.5; dot.backgroundColor = it.due < data.day ? C.late : C.accent;
      txt(r, it.title, fam === 'small' ? 12 : 13, C.ink);
      if (fam !== 'small' && it.project) { r.addSpacer(); txt(r, it.project, 10, C.soft); }
      w.addSpacer(3);
    };
    for (const it of data.today.slice(0, max)) row(it);
    if (data.today.length > max) txt(w, '+ ' + (data.today.length - max) + ' more', 11, C.soft);
    if (!n) txt(w, 'Nothing due. Enjoy it.', 13, C.soft);
    if (big && data.soon.length) {
      w.addSpacer(8);
      txt(w, 'COMING UP', 10, C.soft, true);
      w.addSpacer(3);
      for (const it of data.soon.slice(0, fam === 'extraLarge' ? 8 : 4)) {
        const r = w.addStack(); r.spacing = 6;
        const d = txt(r, dayName(it.due), 11, C.accent, true); d.lineLimit = 1;
        txt(r, it.title, 12, C.ink);
        w.addSpacer(2);
      }
    }
    if (data.waiting && fam !== 'small') { w.addSpacer(4); txt(w, data.waiting + ' waiting on something', 10, C.soft); }
  }
  w.addSpacer();
}

if (config.runsInWidget) Script.setWidget(w);
else if (fam === 'small') await w.presentSmall(); else if (fam === 'medium') await w.presentMedium(); else await w.presentLarge();
Script.complete();
`;
}
