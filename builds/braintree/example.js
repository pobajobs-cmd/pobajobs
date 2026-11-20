// The example project: a small, real project (made of ordinary items) that shows off what Brain
// Tree does: dates, to-dos with steps, a repeating to-do, checklists, sections, a sub-project, a board
// with labelled strings, a YouTube clip and a drawing. Add it from Settings (or the empty project list);
// delete it like any project when you're done.

import { clipDivHTML } from './media.js';
import { drawDivHTML } from './draw.js';

const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

export const EXAMPLE_TITLE = 'Example: Make a short video';

export async function addExample(store) {
  // Made a minute "ago", so opening one doesn't jump into renaming it like a brand-new item does.
  const created = new Date(Date.now() - 60_000).toISOString();
  let order = Date.now();
  const make = data => store.create({ created, order: order++, body: '', ...data });

  const project = await make({
    type: 'project', title: EXAMPLE_TITLE, start: day(0), due: day(21),
    body: `<p>This is an example project, to show what Brain Tree can do. Have a look around, tick things off, change anything, then delete it with the bin at the top when you're done.</p>
<ul class="checklist"><li data-checked="true">A project holds to-dos, notes, sections and smaller projects</li><li>Open its board (the board button at the top) to see everything pinned up, with strings between related cards</li><li>Tap a card on the board to open it, drag it into a section to file it there</li><li>Try + Add on the board for a YouTube clip or a drawing</li><li>In the list, swipe a to-do left or right, or hold it for more (hold and drag to move it)</li></ul>`,
  });
  const P = { parent: project };

  // Loose to-dos and notes.
  await make({ ...P, type: 'task', title: 'Pick a topic', done: true, doneAt: new Date().toISOString() });
  const script = await make({ ...P, type: 'task', title: 'Write the script', due: day(0), body: '<p>Keep it under 60 seconds. Steps are inside this to-do.</p>' });
  await make({ parent: script, type: 'task', title: 'A hook for the first 10 seconds', done: true, doneAt: new Date().toISOString() });
  await make({ parent: script, type: 'task', title: 'Three main points' });
  await make({ parent: script, type: 'task', title: 'Ending and call to action' });
  await make({ ...P, type: 'task', title: 'Check comments on the last video', due: day(1), repeat: 'week',
    body: '<p>A repeating to-do: tick it and it moves on to next week. Set how often under Repeat.</p>' });
  await make({ ...P, type: 'note', title: 'Ideas', color: 'yellow',
    body: '<p>Anything goes in a note: text, <b>bold</b>, lists, links, photos, clips and drawings.</p><ul><li>Behind the scenes</li><li>A quick how-to</li><li>Top 5 facts</li></ul>' });

  // Sections: groups inside the project (headings in the list, labelled frames on the board).
  const research = await make({ ...P, type: 'section', title: 'Research', color: 'blue' });
  const shoot = await make({ ...P, type: 'section', title: 'Shoot', color: 'green' });
  const edit = await make({ ...P, type: 'section', title: 'Edit', color: 'pink' });

  const pacing = await make({ parent: research, type: 'note', title: 'Pacing reference',
    body: '<p>Just the bit worth watching: notice how quickly the shots change.</p>'
      + clipDivHTML({ id: 'aqz-KE-bpKQ', start: 30, end: 75, title: 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film' }) });
  const facts = await make({ parent: research, type: 'note', title: 'Facts to check',
    body: '<ul class="checklist"><li data-checked="true">Find two good sources</li><li>Check the dates</li><li>Note where each fact came from</li></ul>' });

  const shotPlan = await make({ parent: shoot, type: 'note', title: 'Shot plan',
    body: '<p>Drawn in Brain Tree: tap the drawing to change it.</p>' + drawDivHTML({ v: 1, s: [
      { id: 'hook', k: 'box', x: 0, y: 0, w: 150, h: 64, t: 'Hook (first 10 s)', f: 'yellow', c: 'ink' },
      { id: 'points', k: 'box', x: 220, y: 0, w: 150, h: 64, t: 'Three facts', f: 'blue', c: 'ink' },
      { id: 'end', k: 'ellipse', x: 440, y: -4, w: 150, h: 72, t: 'Ending', f: 'green', c: 'ink' },
      { id: 'check', k: 'diamond', x: 210, y: 120, w: 170, h: 96, t: 'Under 60 s?', f: 'pink', c: 'ink' },
      { id: 'l1', k: 'line', a: 'hook', b: 'points', t: '', c: 'ink', e: 'arrow', d: 0 },
      { id: 'l2', k: 'line', a: 'points', b: 'end', t: '', c: 'ink', e: 'arrow', d: 0 },
      { id: 'l3', k: 'line', a: 'points', b: 'check', t: 'time it', c: 'red', e: 'arrow', d: 1 },
      { id: 'note', k: 'text', x: 420, y: 128, w: 170, h: 52, t: 'Cut anything that drags', f: '', c: 'red' },
    ] }) });
  await make({ parent: shoot, type: 'task', title: 'Film the intro', due: day(3) });
  const voice = await make({ parent: shoot, type: 'task', title: 'Record the voiceover', due: day(5) });

  const rough = await make({ parent: edit, type: 'task', title: 'Rough cut', due: day(7) });
  await make({ parent: edit, type: 'task', title: 'Add music and captions', due: day(10) });

  // A smaller project inside this one (it has its own board).
  const thumb = await make({ ...P, type: 'project', title: 'Thumbnail', due: day(9), body: '<p>A project inside a project. It has its own board too.</p>' });
  await make({ parent: thumb, type: 'task', title: 'Try three designs' });
  await make({ parent: thumb, type: 'task', title: 'Pick the clearest one' });

  // Strings between related things (they show on the board, and under "Strings" in each item).
  const tie = (from, to, label) => store.update(from, { links: [...(store.get(from).data.links || []), { to, ...(label ? { label } : {}) }] });
  await tie(pacing, rough, 'match this pace');
  await tie(script, voice, 'read from');
  await tie(facts, script, 'feeds into');
  await tie(shotPlan, script);

  return project;
}
