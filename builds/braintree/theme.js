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
};
export const DEFAULTS = { theme: 'notepad', mode: 'auto', accent: null, string: null, font: 'system', size: 'normal', look: 'corkboard' };

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
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = c.bg;
  try { localStorage.setItem('bt-look', JSON.stringify({ vars, size: SIZES[p.size] || 16, dark, look })); } catch (e) {}
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
