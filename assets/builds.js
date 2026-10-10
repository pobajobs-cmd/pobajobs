// pobajobs Builds: reads the build logs from the repo's builds/log folder.
// Each build is a Markdown file (Pages CMS writes them, or add one by hand):
//
//   ---
//   title: "Workshop LED controller"
//   date: "2026-11-02"
//   summary: "One line for the list."
//   status: "In progress"              (Planning / In progress / Finished / Abandoned (for now))
//   tags: "Smart home, Electronics"    (comma separated)
//   cover: "/images/builds/led.jpg"    (optional photo)
//   video: "https://youtu.be/..."      (optional)
//   parts: |                           (one per line: qty | part | notes | link)
//     1 | ESP32 dev board | | https://...
//     2m | WS2812B LED strip | 60 LEDs per metre |
//   files: |                           (one per line: label | path or link)
//     Enclosure (STL) | /builds/files/enclosure.stl
//   placeholder: false                 (true shows an "Example" label)
//   ---
//   The write-up goes here, in Markdown.
//
// Nothing here needs editing when you add a build: it reads whatever is in the folder.

const BUILDS_REPO = 'pobajobs-cmd/pobajobs';
const BUILDS_BRANCH = 'main';
const BUILDS_FOLDER = 'builds/log';

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const data = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if (/^[|>][-+]?$/.test(val)) {
      // Block scalar: the indented lines that follow
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === '')) block.push(lines[++i]);
      const indent = Math.min(...block.filter(l => l.trim()).map(l => l.match(/^\s*/)[0].length), 99);
      val = block.map(l => l.slice(indent)).join(val[0] === '>' ? ' ' : '\n').replace(/\s+$/, '');
    } else if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1).replace(/''/g, "'");
    }
    data[m[1]] = val;
  }
  return { data, body: match[2].trim() };
}

function rows(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split('|').map(c => c.trim()));
}

function toBuild(slug, data, body) {
  return {
    slug,
    title: data.title || slug,
    date: data.date || slug.slice(0, 10),
    summary: data.summary || '',
    status: data.status || '',
    tags: (data.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    cover: data.cover || '',
    video: data.video || '',
    parts: rows(data.parts).map(([qty = '', part = '', notes = '', link = '']) => ({ qty, part, notes, link })).filter(p => p.part),
    files: rows(data.files).map(([label = '', href = '']) => ({ label, href })).filter(f => f.href),
    placeholder: data.placeholder === 'true',
    body: body || '',
  };
}

async function fetchBuildFile(name) {
  const res = await fetch(`https://raw.githubusercontent.com/${BUILDS_REPO}/${BUILDS_BRANCH}/${BUILDS_FOLDER}/${name}`);
  if (!res.ok) throw new Error('Could not load ' + name);
  return res.text();
}

async function fetchBuilds() {
  try {
    // No "?ref=" on this address: some ad blockers block any address ending in "/log?..."
    // (the repo's default branch is main anyway).
    const res = await fetch(`https://api.github.com/repos/${BUILDS_REPO}/contents/${BUILDS_FOLDER}`);
    if (!res.ok) return [];
    const items = await res.json();
    const files = Array.isArray(items) ? items.filter(i => i.type === 'file' && i.name.endsWith('.md')) : [];
    const builds = await Promise.all(files.map(async f => {
      try { const { data, body } = parseFrontmatter(await fetchBuildFile(f.name)); return toBuild(f.name.replace(/\.md$/, ''), data, body); }
      catch (e) { return null; }
    }));
    return builds.filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) {
    return [];
  }
}

async function fetchBuild(slug) {
  const { data, body } = parseFrontmatter(await fetchBuildFile(`${slug}.md`));
  return toBuild(slug, data, body);
}

function fmtBuildDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return isNaN(d) ? dateStr : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escHtml(t) {
  return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function youTubeId(url) {
  const m = (url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  return m ? m[1] : '';
}
