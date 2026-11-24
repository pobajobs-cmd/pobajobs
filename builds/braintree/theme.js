// Appearance: colour themes, light/dark, main and string colour, text style and size,
// board look. Saved as a hidden item ("pref-appearance") so it follows you to every
// device, and cached in localStorage so the page paints in the right colours before it loads.

export const THEMES = [
  { id: 'notepad', name: 'Notepad',
    light: { bg: '#F7F5F0', side: '#EFECE5', card: '#FFFFFF', ink: '#1F1D1A', soft: '#6F6A62', accent: '#C98A00', string: '#C8372D', on: '#1A1305', proj: '#3F6FB5', ok: '#2F8A4E' },
    dark: { bg: '#1C1B19', side: '#161513', card: '#252421', ink: '#EDEAE3', soft: '#A8A298', accent: '#E7B23A', string: '#EF6A5E', on: '#1A1305', proj: '#7FA8E8', ok: '#5CC283' } },
  { id: 'cork', name: 'Corkboard',
    light: { bg: '#EFE4D2', side: '#E5D6BE', card: '#FFFBF3', ink: '#2B2118', soft: '#6E5C48', accent: '#A0522D', string: '#C62828', on: '#FFFFFF', proj: '#3D6E8F', ok: '#3C7D4A' },
    dark: { bg: '#241C15', side: '#1C150F', card: '#30261C', ink: '#F1E6D6', soft: '#BDA88E', accent: '#D9894F', string: '#EF5B4C', on: '#1A1006', proj: '#86B4D6', ok: '#6CC28A' } },
  { id: 'blueprint', name: 'Blueprint',
    light: { bg: '#EEF3F7', side: '#E2EAF1', card: '#FFFFFF', ink: '#14324A', soft: '#4F6A80', accent: '#FF6B1A', string: '#D0402B', on: '#111111', proj: '#1F6FB2', ok: '#2F8A4E' },
    dark: { bg: '#11263A', side: '#0C1D2D', card: '#183149', ink: '#E6EEF5', soft: '#9DB3C6', accent: '#FF8A3D', string: '#FF6B57', on: '#111111', proj: '#6FB0F0', ok: '#5CC283' } },
  { id: 'forest', name: 'Forest',
    light: { bg: '#F2F5EF', side: '#E6ECE1', card: '#FFFFFF', ink: '#1D2A20', soft: '#5D6B5F', accent: '#2F7D4F', string: '#B5452B', on: '#FFFFFF', proj: '#3D6E8F', ok: '#2F7D4F' },
    dark: { bg: '#151C17', side: '#101511', card: '#1F2821', ink: '#E3EBE3', soft: '#9DB0A0', accent: '#5CC283', string: '#E86A50', on: '#0E1A12', proj: '#7FB3D5', ok: '#5CC283' } },
  { id: 'ink', name: 'Ink',
    light: { bg: '#FAFAFA', side: '#F0F0F0', card: '#FFFFFF', ink: '#111111', soft: '#555555', accent: '#111111', string: '#D32F2F', on: '#FFFFFF', proj: '#333333', ok: '#2F8A4E' },
    dark: { bg: '#0E0E0E', side: '#080808', card: '#1A1A1A', ink: '#F2F2F2', soft: '#A0A0A0', accent: '#F2F2F2', string: '#FF5A4F', on: '#111111', proj: '#CCCCCC', ok: '#5CC283' } },
  { id: 'dusk', name: 'Dusk',
    light: { bg: '#F6F3FA', side: '#ECE6F4', card: '#FFFFFF', ink: '#221B2E', soft: '#675C78', accent: '#7A4FD0', string: '#D9466F', on: '#FFFFFF', proj: '#3E7CC9', ok: '#2F8A4E' },
    dark: { bg: '#19151F', side: '#131018', card: '#241E2C', ink: '#ECE6F5', soft: '#ABA0BC', accent: '#A98BF0', string: '#F06A90', on: '#160F22', proj: '#7FB0F0', ok: '#5CC283' } },
  // 0.7: each of these has a board look to match (offered when you pick one).
  { id: 'circuit', name: 'Circuit board', look: 'circuit',
    light: { bg: '#EEF4EF', side: '#E1EBE3', card: '#FFFFFF', ink: '#10261B', soft: '#4E6A5A', accent: '#B8862B', string: '#C0392B', on: '#1A1305', proj: '#1F7A55', ok: '#2F8A4E' },
    dark: { bg: '#0C1F16', side: '#08170F', card: '#12291E', ink: '#E3F0E7', soft: '#93B3A0', accent: '#E0B252', string: '#FF7A5C', on: '#1A1305', proj: '#6FD3A5', ok: '#5CC283' } },
  { id: 'city', name: 'City', look: 'city',
    light: { bg: '#F2F2F0', side: '#E7E7E4', card: '#FFFFFF', ink: '#1B1D22', soft: '#5F636B', accent: '#0060A8', string: '#E2382F', on: '#FFFFFF', proj: '#00843D', ok: '#2F8A4E' },
    dark: { bg: '#14171D', side: '#0F1116', card: '#1D2129', ink: '#E9EBEF', soft: '#9AA1AD', accent: '#4DA3FF', string: '#FF6B5A', on: '#0A1420', proj: '#3DD68C', ok: '#5CC283' } },
  { id: 'neon', name: 'Neon', look: 'neon',
    light: { bg: '#FBF7FF', side: '#F2EAFB', card: '#FFFFFF', ink: '#1C1030', soft: '#6A5C80', accent: '#E0108A', string: '#0094B3', on: '#FFFFFF', proj: '#7B2FF7', ok: '#16A36A' },
    dark: { bg: '#0B0A12', side: '#07060C', card: '#151225', ink: '#F3EEFF', soft: '#A79CC2', accent: '#FF3EA5', string: '#22E3FF', on: '#1A0010', proj: '#B98CFF', ok: '#39FF9A' } },
  { id: 'minimal', name: 'Minimal', look: 'minimal', flat: true,
    light: { bg: '#FFFFFF', side: '#FAFAFA', card: '#FFFFFF', ink: '#18181B', soft: '#71717A', accent: '#18181B', string: '#EF4444', on: '#FFFFFF', proj: '#52525B', ok: '#16A34A' },
    dark: { bg: '#09090B', side: '#0E0E11', card: '#141417', ink: '#FAFAFA', soft: '#A1A1AA', accent: '#FAFAFA', string: '#F87171', on: '#09090B', proj: '#D4D4D8', ok: '#4ADE80' } },
  { id: 'hacker', name: 'Hacker', look: 'hacker', font: 'mono',
    light: { bg: '#F1F7F1', side: '#E5EFE5', card: '#FFFFFF', ink: '#0B2410', soft: '#4A6B50', accent: '#11823B', string: '#C0392B', on: '#FFFFFF', proj: '#1F6F8B', ok: '#11823B' },
    dark: { bg: '#050805', side: '#020402', card: '#0B120B', ink: '#B8FFC8', soft: '#5FAF72', accent: '#33FF66', string: '#FF5F57', on: '#021006', proj: '#5CD6FF', ok: '#33FF66' } },
];

export const FONTS = {
  system: { name: 'System', stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, Roboto, sans-serif" },
  rounded: { name: 'Rounded', stack: "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Segoe UI', system-ui, sans-serif" },
  serif: { name: 'Serif', stack: "ui-serif, 'New York', 'Iowan Old Style', Georgia, serif" },
  mono: { name: 'Mono', stack: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace" },
};
export const SIZES = { small: 15, normal: 16, large: 18 };
// Each board look brings its own background, cards and strings (see board.js).
export const LOOKS = {
  corkboard: { name: 'Corkboard', wire: () => null },                  // the theme's string colour
  whiteboard: { name: 'Whiteboard', wire: dark => (dark ? '#E9ECF1' : '#2B3038') },
  blueprint: { name: 'Blueprint', wire: () => '#F2F8FF' },
  notebook: { name: 'Notebook', wire: dark => (dark ? '#A9BCFF' : '#1F3B8C') },
  // 0.7
  circuit: { name: 'Circuit board', wire: () => '#E0B252' },        // copper traces
  city: { name: 'City map', wire: () => null, lines: true },        // transit lines, one colour each
  neon: { name: 'Neon', wire: () => null, lines: true },            // glowing tubes, one colour each
  minimal: { name: 'Minimal', wire: dark => (dark ? '#8E8E96' : '#A1A1AA') },
  hacker: { name: 'Hacker', wire: () => '#33FF66' },
  chalkboard: { name: 'Chalkboard', wire: () => '#F4F1E6' },
  space: { name: 'Space', wire: () => '#C9D8FF' },                  // constellations
};
// (tidyMove, 0.7.9: when Tidy finds a card strung only to things outside its section, 'ask' suggests
// moving it, 'move' just does it)
export const DEFAULTS = { theme: 'notepad', mode: 'auto', accent: null, string: null, font: 'system', size: 'normal', look: 'corkboard', tidyMove: 'ask', morning: '' };   // (0.9.0) morning: the morning summary's time, or '' for none

export const PREF_ID = 'pref-appearance';
const darkQuery = matchMedia('(prefers-color-scheme: dark)');

export function current(store) {
  const rec = store.get(PREF_ID);
  const saved = rec && !rec.deleted ? rec.data.appearance : null;
  const p = { ...DEFAULTS, ...saved };
  // Before 0.4 the board had a style and a background; pick the look closest to what was set.
  if (saved && !saved.look) p.look = saved.board === 'grid' ? 'blueprint' : saved.boardStyle === 'whiteboard' ? 'whiteboard' : saved.board === 'dots' ? 'notebook' : 'corkboard';
  if (!(p.look in LOOKS)) p.look = 'corkboard';
  return p;
}

// The colour of the strings and lines on the board right now.
export function wireColour(p, dark) {
  const theme = THEMES.find(t => t.id === p.theme) || THEMES[0];
  return p.string || LOOKS[p.look]?.wire(dark) || (dark ? theme.dark : theme.light).string;
}

export function apply(prefs) {
  const p = { ...DEFAULTS, ...prefs };
  const theme = THEMES.find(t => t.id === p.theme) || THEMES[0];
  const dark = p.mode === 'dark' || (p.mode === 'auto' && darkQuery.matches);
  const c = { ...(dark ? theme.dark : theme.light) };
  if (p.accent) { c.accent = p.accent; c.on = readableOn(p.accent); }
  const look = p.look in LOOKS ? p.look : 'corkboard';
  const vars = {
    '--bg': c.bg, '--side': c.side, '--card': c.card, '--ink': c.ink, '--soft': c.soft,
    '--accent': c.accent, '--on-accent': c.on, '--string': c.string, '--proj': c.proj, '--ok': c.ok,
    '--wire': wireColour({ ...p, look }, dark),
    '--font': (FONTS[p.font] || FONTS.system).stack,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.fontSize = (SIZES[p.size] || 16) + 'px';
  root.style.colorScheme = dark ? 'dark' : 'light';
  root.dataset.mode = dark ? 'dark' : 'light';
  root.dataset.look = look;
  root.dataset.theme = theme.id;
  root.toggleAttribute('data-flat', !!theme.flat);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = c.bg;
  try { localStorage.setItem('bt-look', JSON.stringify({ vars, size: SIZES[p.size] || 16, dark, look, theme: theme.id, flat: !!theme.flat })); } catch (e) {}
}

// Follow the phone's light/dark switch while in "auto".
export function watch(getPrefs) {
  darkQuery.addEventListener?.('change', () => apply(getPrefs()));
}

export async function save(store, prefs) {
  const next = { ...DEFAULTS, ...prefs };
  delete next.board; delete next.boardStyle;   // replaced by "look" in 0.4
  apply(next);
  if (store.get(PREF_ID) && !store.get(PREF_ID).deleted) await store.update(PREF_ID, { appearance: next });
  else await store.createWithId(PREF_ID, { type: 'pref', appearance: next });
}

// Black or white text, whichever reads better on a colour.
function readableOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#FFFFFF';
}
