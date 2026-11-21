// The example project: a small, real project (made of ordinary items) that shows off everything
// Brain Tree does. Add it from Settings → Getting started (or the empty project list); delete it
// like any project when you're done.
//
// KEEP THIS UP TO DATE: whenever Brain Tree gains something new (a kind of item, something on the
// board, a setting worth showing), add an example of it here and a line about it in the project's
// notes below. (The user asked for this in 0.7.1.)
//
// What's in it now:
//   project notes   a checklist tour of what to try
//   to-dos          dates, steps inside one, a repeating one, a done one, a pinned one
//   notes           rich text and a sticky colour, a YouTube clip, a checklist, a drawing, a photo,
//                   a spreadsheet with a formula, a file (a PDF made here), a link to a web page
//   sections        Research, Shoot, Edit (headings in the list, labelled frames on the board)
//   sub-projects    Thumbnail (its own board), Surprise ending (locked, password "tree")
//   board           strings with labels, a branch off one (a T junction), a card made Large,
//                   a drawing made on the board itself (star, highlighter, curved arrow: 0.7.2)
//   notes checklist also points to Settings → Claude (0.7.3: Claude chats can block out projects)

import { clipDivHTML } from './media.js';
import { drawDivHTML, drawingBox } from './draw.js';
import { sheetDivHTML } from './sheet.js';
import { docDivHTML, linkDivHTML } from './attach.js';
import { listPDF } from './export.js';

const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const EXAMPLE_TITLE = 'Example: Make a short video';
export const EXAMPLE_PASSWORD = 'tree';

// makeLock(password) comes from the app (it's how a project gets its lock).
export async function addExample(store, { makeLock } = {}) {
  // Made a minute "ago", so opening one doesn't jump into renaming it like a brand-new item does.
  const created = new Date(Date.now() - 60_000).toISOString();
  let order = Date.now();
  const make = data => store.create({ created, order: order++, body: '', ...data });
  const now = new Date().toISOString();

  // A photo and a file, made here so the example needs nothing from outside.
  const photo = await sketchPhoto(store).catch(() => null);
  const draft = await scriptPDF(store).catch(() => null);

  const project = await make({
    type: 'project', title: EXAMPLE_TITLE, start: day(0), due: day(21),
    body: `<p>This is an example project, to show what Brain Tree can do. Have a look around, tick things off, change anything, then delete it with the bin at the top when you're done.</p>
<ul class="checklist"><li data-checked="true">A project holds to-dos, notes, sections and smaller projects</li><li>Open its board (the Board button at the top) to see everything pinned up, with strings between related cards</li><li>On the board, tap String, then two cards, to tie them together. Tap a string to label it</li><li>Drag a string's label onto another card to branch it, like a T junction: “read from” goes to two cards</li><li>Strings find their own way round cards (on Corkboard they're real string, so they cross)</li><li>Tap Draw on the board to draw straight onto it, with pens, a highlighter, shapes and arrows. The star is a drawing like that: tap it to change it</li><li>Tidy lays the board out again in the order the work flows, keeping strings short and uncrossed. “Tidy inside sections” keeps the sections where you put them</li><li>Drag the bottom corner of a card to make it bigger or smaller: the thumbnail sketch is Large</li><li>+ Add on the board adds notes, to-dos, sections, YouTube clips, drawings, spreadsheets, files and links</li><li>“Write the script” is pinned to the top of the list. Hold it to unpin it</li><li>“Surprise ending” is locked. Its password is <b>${EXAMPLE_PASSWORD}</b></li><li>The share button at the top prints the list or the board, or saves it as a PDF, a picture or a spreadsheet</li><li>In the list, swipe a to-do left or right, or hold it for more (hold and drag to move it)</li><li>A project opens as its list or its board, whichever you looked at last</li><li>Settings → Claude connects Claude: then in any Claude chat, say “block this out in Brain Tree” and it makes a project like this one, with a link back to the chat</li><li>Settings (the cog at the top) has colour themes and a look for every board: try Circuit board or Neon</li></ul>`,
  });
  const P = { parent: project };

  // Loose to-dos and notes.
  await make({ ...P, type: 'task', title: 'Pick a topic', done: true, doneAt: now, body: '<p>Octopuses: three hearts, blue blood, and arms that can taste.</p>' });
  const script = await make({ ...P, type: 'task', title: 'Write the script', due: day(0), pinned: now,
    body: '<p>Keep it under 60 seconds. Steps are inside this to-do, and the draft is attached.</p>' + (draft ? docDivHTML(draft) : '') });
  await make({ parent: script, type: 'task', title: 'A hook for the first 10 seconds', done: true, doneAt: now });
  await make({ parent: script, type: 'task', title: 'Three main points' });
  await make({ parent: script, type: 'task', title: 'Ending and call to action' });
  await make({ ...P, type: 'task', title: 'Check comments on the last video', due: day(1), repeat: 'week',
    body: '<p>A repeating to-do: tick it and it moves on to next week. Set how often under Repeat.</p>' });
  await make({ ...P, type: 'note', title: 'Ideas', color: 'yellow',
    body: '<p>Anything goes in a note: text, <b>bold</b>, lists, links, photos, clips, drawings, spreadsheets and files.</p><ul><li>Behind the scenes</li><li>A quick how-to</li><li>Top 5 facts</li></ul>' });
  const sketch = await make({ ...P, type: 'note', title: 'Thumbnail sketch', cork: { [project]: { s: 1.5 } },
    body: (photo ? `<p><img data-file="${photo}" alt="Thumbnail sketch"></p>` : '') + '<p>A photo in a note. On the board this card is Large.</p>' });

  // Sections: groups inside the project (headings in the list, labelled frames on the board).
  const research = await make({ ...P, type: 'section', title: 'Research', color: 'blue' });
  const shoot = await make({ ...P, type: 'section', title: 'Shoot', color: 'green' });
  const edit = await make({ ...P, type: 'section', title: 'Edit', color: 'pink' });

  const pacing = await make({ parent: research, type: 'note', title: 'Pacing reference',
    body: '<p>Just the bit worth watching: notice how quickly the shots change.</p>'
      + clipDivHTML({ id: 'aqz-KE-bpKQ', start: 30, end: 75, title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film' }) });
  const facts = await make({ parent: research, type: 'note', title: 'Facts to check',
    body: '<ul class="checklist"><li data-checked="true">Find two good sources</li><li>Check the three hearts</li><li>Note where each fact came from</li></ul>' });
  await make({ parent: research, type: 'note', title: 'How storyboards work',
    body: '<p>A link to a page or a document somewhere else (Google Docs, OneDrive…) shows as a tile. Tap it to open it.</p>'
      + linkDivHTML({ url: 'https://en.wikipedia.org/wiki/Storyboard', title: 'Storyboard (Wikipedia)' }) });

  const shotPlan = await make({ parent: shoot, type: 'note', title: 'Shot plan',
    body: '<p>Drawn in Brain Tree: tap the drawing to change it.</p>' + drawDivHTML({ v: 1, s: [
      { id: 'hook', k: 'box', x: 0, y: 0, w: 150, h: 64, t: 'Hook (first 10 s)', f: 'yellow', c: 'ink' },
      { id: 'points', k: 'box', x: 220, y: 0, w: 150, h: 64, t: 'Three facts', f: 'blue', c: 'ink' },
      { id: 'end', k: 'ellipse', x: 440, y: -4, w: 150, h: 72, t: 'Ending', f: 'green', c: 'ink' },
      { id: 'check', k: 'diamond', x: 210, y: 120, w: 170, h: 96, t: 'Under 60 s?', f: 'pink', c: 'ink' },
      { id: 'l1', k: 'line', a: 'hook', b: 'points', t: '', c: 'ink', e: 'arrow', d: 0 },
      { id: 'l2', k: 'line', a: 'points', b: 'end', t: '', c: 'ink', e: 'arrow', d: 0 },
      { id: 'l3', k: 'line', a: 'points', b: 'check', t: 'time it', c: 'red', e: 'arrow', d: 1, cv: 1 },
      { id: 'note', k: 'text', x: 420, y: 128, w: 170, h: 52, t: 'Cut anything that drags', f: '', c: 'red' },
      { id: 'best', k: 'star', x: 560, y: -40, w: 44, h: 42, t: '', f: 'yellow', c: 'orange' },
    ] }) });
  // A drawing made on the board itself: no card, just what was drawn (tap it on the board to change it).
  const doodle = { v: 1, s: [
    { id: 'mark', k: 'pen', p: [96, 46, 180, 44, 262, 47], c: 'yellow', w: 16, hl: 1 },
    { id: 'star', k: 'star', x: 0, y: 0, w: 74, h: 70, t: '', f: 'yellow', c: 'orange' },
    { id: 'say', k: 'text', x: 84, y: 10, w: 200, h: 32, t: 'Start with the script!', f: '', c: 'ink' },
    { id: 'go', k: 'line', a: [196, 58], b: [140, 128], t: '', c: 'red', e: 'arrow', d: 0, cv: 1 },
  ] };
  // (a drawing on the board is exactly as big as it was drawn: 1 drawing unit = 1 board pixel)
  await make({ ...P, type: 'note', title: 'Drawing', sketch: true, cork: { [project]: { s: Math.round(drawingBox(doodle, true).w / 220 * 1000) / 1000 } },
    body: drawDivHTML(doodle) });
  const intro = await make({ parent: shoot, type: 'task', title: 'Film the intro', due: day(3) });
  const voice = await make({ parent: shoot, type: 'task', title: 'Record the voiceover', due: day(5) });

  const rough = await make({ parent: edit, type: 'task', title: 'Rough cut', due: day(7) });
  const music = await make({ parent: edit, type: 'task', title: 'Add music and captions', due: day(10) });
  const budget = await make({ parent: edit, type: 'note', title: 'Budget', color: 'green',
    body: '<p>A spreadsheet: tap it to change it. The total is a formula, =SUM(B2:B4).</p>' + sheetDivHTML({ v: 1, h: 1, c: [
      ['Item', 'Cost (£)'],
      ['Stock music', '15'],
      ['Captions app', '4.99'],
      ['Thumbnail font', '0'],
      ['Total', '=SUM(B2:B4)'],
    ] }) });

  // Smaller projects inside this one (each has its own board).
  const thumb = await make({ ...P, type: 'project', title: 'Thumbnail', due: day(9), body: '<p>A project inside a project. It has its own board too.</p>' });
  await make({ parent: thumb, type: 'task', title: 'Try three designs' });
  await make({ parent: thumb, type: 'task', title: 'Pick the clearest one' });

  const secret = await make({ ...P, type: 'project', title: 'Surprise ending',
    body: `<p>A locked project: everything in it stays hidden, on every device, until someone types its password (${EXAMPLE_PASSWORD}). Hold it to change the password or take the lock off.</p>` });
  await make({ parent: secret, type: 'note', title: 'The twist', body: '<p>End on the strangest fact of all: an octopus can taste with its arms.</p>' });
  await make({ parent: secret, type: 'task', title: 'Film the reveal', due: day(6) });
  if (makeLock) await store.update(secret, { lock: await makeLock(EXAMPLE_PASSWORD) });

  // Strings between related things (they show on the board, and under "Strings" in each item).
  const tie = (from, to, label, also) => store.update(from, { links: [...(store.get(from).data.links || []),
    { to, ...(label ? { label } : {}), ...(also ? { also } : {}) }] });
  await tie(pacing, rough, 'match this pace');
  await tie(script, voice, 'read from', [intro]);   // a branch: the intro reads from the script too
  await tie(facts, script, 'feeds into');
  await tie(shotPlan, script);
  await tie(sketch, thumb, 'first try');
  await tie(budget, music, 'pays for');

  return project;
}

// A rough thumbnail drawn on a canvas, kept like any photo. Returns its id. (4:3, the shape a
// card shows a photo at, so nothing gets cropped off.)
async function sketchPhoto(store) {
  const W = 960, H = 720;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#16307A'); bg.addColorStop(1, '#0E9BD8');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // An octopus: eight wavy arms, a round head, two eyes.
  g.strokeStyle = '#F06BAE'; g.lineWidth = 24; g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < 8; i++) {
    const x0 = 630 + i * 26, spread = (i - 3.5) * 14;
    g.beginPath(); g.moveTo(x0, 480);
    for (let t = 1; t <= 7; t++) g.lineTo(x0 + spread * t * 0.5 + Math.sin(t * 1.3 + i) * 14, 480 + t * 28);
    g.stroke();
  }
  g.fillStyle = '#F06BAE';
  g.beginPath(); g.ellipse(720, 410, 120, 110, 0, 0, Math.PI * 2); g.fill();
  for (const ex of [678, 762]) {
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(ex, 415, 25, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1B1030'; g.beginPath(); g.arc(ex + 5, 420, 12, 0, Math.PI * 2); g.fill();
  }
  // The words.
  g.fillStyle = '#FFFFFF'; g.font = '900 112px "Arial Black", Impact, Helvetica, sans-serif';
  g.fillText('3 HEARTS', 64, 170);
  g.fillStyle = '#FFD84A'; g.font = '900 70px "Arial Black", Impact, Helvetica, sans-serif';
  g.fillText('BLUE BLOOD', 68, 270);
  g.fillStyle = '#FFFFFF'; g.font = '700 44px Helvetica, Arial, sans-serif';
  g.fillText('in 60 seconds', 70, 345);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error('no canvas');
  return store.addPhoto(blob);
}

// The script draft as a PDF (made with the same writer as the list export), kept like any file.
async function scriptPDF(store) {
  const say = text => ({ t: 'p', text });
  const blob = listPDF({
    title: 'Script draft: Octopuses in 60 seconds', sub: 'Version 1 · about 55 seconds',
    groups: [
      { name: 'Hook (0–10 s)', items: [{ kind: 'note', title: 'One animal has three hearts, blue blood, and arms that can taste.', lines: [say('Close-up of an octopus arm. Text on screen: 3 HEARTS?')] }] },
      { name: 'Three facts (10–45 s)', items: [
        { kind: 'note', title: 'Three hearts', lines: [say('Two pump blood through the gills, one pumps it round the body.')] },
        { kind: 'note', title: 'Blue blood', lines: [say('Their blood uses copper, not iron, to carry oxygen, which turns it blue.')] },
        { kind: 'note', title: 'Arms that taste', lines: [say('The suckers can taste what they touch, so an arm can explore on its own.')] },
      ] },
      { name: 'Ending (45–55 s)', items: [{ kind: 'note', title: 'Ask which fact surprised them most, then point to the next video.', lines: [] }] },
    ],
  });
  const file = new File([blob], 'Script draft.pdf', { type: 'application/pdf' });
  return store.addDoc(file);
}
