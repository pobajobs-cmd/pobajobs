# Brain Tree

Projects, to-dos and notes in one tree, at **pobajobs.co.uk/builds/braintree/**.
This folder (`_dev`) isn't published; it holds the notes and the local test server.

## One-time setup (before the first publish)

1. Cloudflare dashboard → **Workers & Pages** → **pobajobs** → **Settings** → **Variables and secrets** → **Add**.
2. Type: **Secret**. Name: `BRAINTREE_PASSWORD`. Value: a long password only you know.
3. Publish the site as usual (push to GitHub).

Changing that password later signs every device out. Wrong passwords are limited to 10 an hour per connection.

## Putting it on the iPhone

Open `https://pobajobs.co.uk/builds/braintree/` in **Safari**, tap **Share**, then **Add to Home Screen**.
Open it from the home screen and sign in there. The home-screen app keeps its own sign-in, separate from Safari's.

## Where things live

| What | Where |
|---|---|
| App (published) | `builds/braintree/`: `index.html`, `app.js` (screens), `store.js` (offline data and sync), `editor.js` (note editor), `board.js` (boards), `theme.js` (looks), `media.js` (YouTube clips), `draw.js` (drawings), `example.js` (example project), `gestures.js` (swipe, hold, drag in the lists), `styles.css`, `sw.js` (offline files) |
| Server code | `worker-braintree.js` (imported by `worker.js`; kept off the site by `.assetsignore`) |
| Data online | D1 database `pobajobs`, tables `bt_items`, `bt_files` (photos), `bt_meta`, `bt_logins` |
| Data on each device | The browser's IndexedDB (`braintree`), so the app works offline |

**After changing any file in `builds/braintree/`, bump `VERSION` in `sw.js`.** That's how devices know to fetch the new copy. They then show "Brain Tree has been updated. Reload".

## Boards (0.4)

`board.js` draws the boards. Every project has one (there's no overall board). The project's name is the banner across the top. Everything on a board is a real item, so the lists match:

| On the board | Stored as | In the lists |
|---|---|---|
| Where a card sits | `data.cork[projectId] = {x, y}` | — |
| Where the banner sits (once you've moved it) | the project's `data.cork.banner = {x, y}` | — |
| A section (labelled frame) | an item with `type: 'section'` inside the project, `data.cork[projectId] = {x, y, w, h}` | a heading in the project's list, with its items under it |
| Dropping a card into or out of a section, or moving a section over cards | `data.parent` | it moves under or out of that heading |
| Things inside a to-do or note | `data.parent` | listed on that card, not as cards of their own |
| A sub-project | a card with "Open its board" | a sub-project (and its own board) |
| "Put … inside …" from a connection | `data.parent` | it's inside that item |
| Strings / arrows | `data.links = [{to, label}]` | the item's "Strings" list |
| Sticky colour | `data.color` | a colour bar on the row |

Notes show their text and checklists on the card, and the checklist boxes can be ticked right there.

**YouTube clips** (0.5): paste a YouTube link into a note (its `?t=` becomes the start), or use the clip button in the note toolbar or **+ Add → YouTube clip** on a board. Pick a start and end time. Saved in the note as `<div data-yt="ID" data-start data-end data-title>` (`media.js`); the video only loads when you press play, from youtube-nocookie.com. On a board it plays small on its card (a player laid over the card, so redraws don't restart it), with a button to watch it bigger. The title comes from `GET /api/braintree/video?id=` in the Worker (YouTube's oEmbed). Embeds don't play from the local test server's 127.0.0.1 address (YouTube refuses it); they do on the real site.

**Drawings** (0.5, `draw.js`): boxes, circles, diamonds, text, arrows that stay joined to shapes, and a pen, in a full-screen editor with undo, colours and pinch-zoom. Add one from the note toolbar or **+ Add → Drawing** on a board. Saved in the note as `<div data-draw='{"v":1,"s":[…]}'>` and shown as SVG on light paper, on the note and on its card.

**Example project** (0.5.1, `example.js`): Settings → Getting started → *Add an example project* (also offered when there are no projects). It makes "Example: Make a short video" out of ordinary items: dated to-dos, a to-do with steps, a checklist note, three sections, a sub-project, labelled strings, a YouTube clip and a drawing. Delete it like any project.

Tying strings: drag a card's pin (or edge dot) onto another card, or tap **String** in the toolbar, then tap one card and then the other (it stays on for more; tap the empty board to stop). Pins grow when you zoom out so they stay finger-sized.

Board looks (Settings → Boards), each with its own string: **Corkboard** (push pins, red wool that sags), **Whiteboard** (sticky notes, wobbly marker arrows), **Blueprint** (outlined boxes, straight ruled lines with right-angle turns), **Notebook** (taped paper slips, fine pen arrows).

Before 0.4, sections were sub-projects drawn as frames; the app turns those into sections the first time it opens.

Appearance (`theme.js`) is saved in the hidden synced item `pref-appearance`. `looks.html` is the logo and theme options page.

## Lists: swipe, hold, drag (0.6)

`gestures.js` does the finger work; `app.js` says what each row offers (`rowActions`, `itemMenu`) and what a drop means (`dropSlots`, `dropRow`). It works on list rows, rows inside an open item, section headings and the sidebar's projects.

| Gesture | What it does |
|---|---|
| Swipe left | Delete (to Recently deleted, with Undo). A long swipe deletes straight away. |
| Swipe right | To-do: Done, Date, More. Project: Board, More. Note: Pin, More. A long swipe does the first one. |
| Hold (right-click with a mouse) | The item's menu: dates, open, done, board, add a to-do, pin, move to the top, move to another project, duplicate, stop repeating, colour, delete. |
| Hold and drag (just drag with a mouse) | Put it in order. Projects among their neighbours in the sidebar; in a project's list (Everything tab), to-dos, notes and sub-projects among their own kind, loose or in any section (dropping in a section moves it there, with Undo); section headings among sections. |

Order is `data.order` (new items get the time they were made, so they go to the bottom). Inside a project, lists now keep that order instead of sorting by due date; the project's **Today** and **Upcoming** tabs (saved per project in `localStorage` `bt-projtab`) are the date views. A drop sets `order` halfway between the neighbours, or renumbers the run if two share a number. Redraws wait until a gesture ends (`gest.busy()`), and a row swiped open stays open across a redraw (`gest.restore()`).

**Duplicate** copies the item and everything inside it, to-dos unticked, board spots kept on the copy's own boards, strings kept when both ends were copied (so a finished project works as a template).

**Repeating to-dos**: `data.repeat` = `day | weekday | week | fortnight | month | year`. Ticking one doesn't finish it: `due` (and `start`, by the same amount) moves to the next date after today, its steps are unticked, and `data.lastDone` is stamped. Undo puts it all back. Setting a repeat on a to-do with no due date gives it today.

**Typed dates** in quick-add (`quickDate`): a date at the end of the text is taken off and becomes the due date, with a "Not a date" button on the toast to undo it. Understood: today, tonight, tomorrow, (this) weekend, next week, in N days/weeks/months, weekday names (mon … friday; "sat"/"sun" only after on/by/next/this), 3 Dec, Dec 3rd, 1/12, 1/12/27.

The sidebar shows how many to-dos in each project are due today (red if any are late). Keyboard: N adds a to-do, / searches.

## Free tier

Each item is a small JSON row. Photos are shrunk to at most 2000 px JPEG (usually 150–500 KB) and stored in D1. The free D1 database holds 500 MB, so roughly a thousand or more photos. Settings in the app shows how much is stored. If photos ever outgrow that, they can move to R2 (Cloudflare file storage, 10 GB free).

## Testing locally

```
python devserver.py
```

Then open http://127.0.0.1:8791/builds/braintree/ and use the password `dev-password`. The real `worker-braintree.js` runs inside the page, with SQLite (sql.js) standing in for D1. Add `?sw=1` to the address to test with the offline service worker on.
