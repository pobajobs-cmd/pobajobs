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
| App (published) | `builds/braintree/`: `index.html`, `app.js` (screens), `store.js` (offline data and sync), `editor.js` (note editor), `board.js` (boards), `theme.js` (looks), `media.js` (YouTube clips), `draw.js` (drawings), `sheet.js` (spreadsheets), `attach.js` (files and links), `export.js` (PDF, print, CSV), `example.js` (example project), `gestures.js` (swipe, hold, drag in the lists), `styles.css`, `sw.js` (offline files) |
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

**Example project** (0.5.1, `example.js`): Settings → Getting started → *Add an example project* (also offered when there are no projects). It makes "Example: Make a short video" out of ordinary items: dated to-dos, a to-do with steps, a checklist note, three sections, a sub-project, labelled strings, a YouTube clip and a drawing. Delete it like any project. (Rebuilt in 0.7.1 to show everything, and kept up to date with each new feature: see 0.7.1 below.)

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

**Pinned** (0.7): a pinned to-do or note stays at the top of its own list; a pinned project stays at the top of the sidebar (among the projects beside it), with a small pin. `data.pinned` is the time it was pinned (older items may have `true`). Pin from the hold menu, the pin in an open item's bar, or a swipe on notes and projects. (0.6.1 tried a separate Pinned list in the sidebar; it was taken back out.) **Rename** is in the hold menu.

**Clips on a board** (0.6.1) play in a player laid over the board (not zoomed with it), at least 400 px wide or 90% of the screen, centred on the card and following it as the board moves. Before, it was the size of the card's picture after zooming out, often under 100 px, too small for YouTube's controls.

`liststyles.html` here is the page of list-style mockups (published as an artifact). The user picked **B, Compact**, which is what the lists use from 0.7.

## 0.7

**Lists (style B, Compact).** One line per row: tick or icon, the title with grey extras after it (steps done `1/3`, a project's progress, a checklist's ticks, `· where it lives`), one small icon (repeat, conflict, or what a note holds: photo, clip, drawing, spreadsheet, file, link), and the date in a column on the right (red when late, the main colour when today). Headings are slim tinted bands; a section's band is in its colour. A project's loose to-dos, sub-projects and notes have no headings. Done things fold into "3 done · Show". A project's list starts with one slim line: progress bar, end date, and the way into its notes. Rows are 36 px (42 px on touch screens).

**Themes and board looks.** New colour themes: Circuit board, City, Neon, Minimal (no edges: lines nearly gone) and Hacker (brings the Mono text, and puts the usual text back when you leave it). Picking one offers its board look in a toast. New board looks (`theme.LOOKS`, styles under "0.7 board looks", strings in `board.js` `wire()`): Circuit board (copper traces with 45° bends and pads), City map (transit lines with rounded corners, a station at each end, each line its own colour), Neon (glowing tubes, each its own colour), Minimal (thin straight lines), Hacker (terminal windows, dashed pipes), Chalkboard (chalk arrows) and Space (constellations; the stars don't zoom). `<html>` carries `data-theme` and, for Minimal, `data-flat`.

**Card sizes on a board.** `data.cork[projectId].s` (0.5 to 3; missing means 1). Drag the corner handle on a card (shown on hover, on the selected card, and faintly on touch screens), or pick Small / Normal / Large / Huge in the open item when it was opened from the board. Cards grow from their top-left corner (CSS `scale`), and everything that measures cards allows for it. Tidy keeps sizes.

**Locked projects.** Hold a project: "Lock with a password…". `data.lock = {v, salt, iter, hash}`: a PBKDF2-SHA256 hash (210,000 rounds), never the password. While locked, everything inside is left out of the index (`buildIndex` drops it from `byId`; `I.hiddenIn` says which lock hides what), so lists, boards, search, Today, counts, strings and pickers don't show it; its list and board show a password box. Unlocking lasts until "Lock" (top of its list), or 5 minutes away from the app, or closing it. Forgotten: the Brain Tree sign-in password (checked by `POST /login`, nothing kept) takes the lock off. It's a privacy screen, not encryption: the project syncs as normal.

**Spreadsheets** (`sheet.js`): `<div data-sheet='{"v":1,"c":[[…]],"h":1}'>` in a note; from the note toolbar or **+ Add → Spreadsheet** on a board. Full-screen grid; paste cells copied from Excel or Google Sheets; open or save CSV. Formulas: + - * / ^ & %, comparisons, cells and ranges, SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT ROUND ABS SQRT IF AND OR NOT CONCAT LEN UPPER LOWER. Shown as a table on the note and on its card.

**Files and links** (`attach.js`): the paperclip in the note toolbar, or **+ Add → File / Link** on a board. A file is `<div data-doc="id" data-name data-size data-mime data-parts>`: kept whole on the device, uploaded in pieces of 1.8 MB (`<id>-p0`, `-p1`…, as `application/octet-stream`; the Worker serves non-photos as downloads only), up to 25 MB a file. Another device fetches the pieces and joins them (`store.docBlob`). A link is `<div data-weblink="https://…" data-title>`, shown with what it is (Google Doc, OneDrive, Dropbox…). On a card the file or link is a tile; tapping it opens it. Opening a file: a new tab on a computer; the share sheet on a phone.

**Print and export** (`export.js`; the share icon at the top of a list or a board, or "Print or export…" in a project's or section's hold menu). A list: **PDF** (A4, two columns, made here with no library: Helvetica, so emoji are left out), **Print** (`#printout`, two columns), **Excel (CSV)**, **Text** (copied). A board: **PDF** (one A4 page), **PNG**, **SVG**, **Print**. The board picture is copied from the board itself (`board.exportSVG()`: flat for a moment, every box, line of text and picture copied into SVG, strings on top), so every look comes out as it shows; shadows, glow and pseudo-element decorations (tape, title bars) aren't copied. Files go to the share sheet on a phone, a download on a computer.

## 0.7.1

**String button.** It says "String" on every look, with the same prompts (in 0.7 it was renamed Trace, Pipe, Neon, Join… to suit the look, and looked missing). What's said when a string is tied or cut still suits the look. On every look except Corkboard, the round dot on a card's edge is the card's pin: drag it onto another card.

**Branches (T junctions).** A string can carry more cards where its label sits: `data.links[i].also = [id, …]` on the item the string starts from. Make one by dragging a string's label onto a card, by tapping a string and choosing **Branch** then a card (String mode ends again after that one), or in String mode by tapping a card and then a label (either order). A string with branches but no label gets a knot at the junction, which works like a label. Tap a branch to open its card or take it off. In an item's "Strings" list, every card on the same string is listed, branch rows marked "branch"; × on a branch row takes that branch off. Duplicating keeps branches between copied things, editing a label keeps them, and sync merges them (`mergeLinks`: branches either device added, less any either took off; the label from the device that changed it).

**Locked projects on a board** show only their name and "Locked" (0.7.0 showed a locked project's notes on its card). A locked project's row in a list has a lock icon.

**Example project** rebuilt to show everything (see `example.js`; its header lists what's in it). **Keep it up to date: every new feature gets an example there and a line in the project's notes.** It now has a pinned to-do with a PDF attached (made with `listPDF`), a photo note drawn on a canvas and shown Large, a spreadsheet with a formula, a link tile, a branch off "read from", and a locked sub-project (password `tree`). `addExample(store, { makeLock })`.

## 0.7.2

**Settings from anywhere.** A cog at the top right of every list and every board (as well as the sidebar). Settings has a Done button that stays at the top while you scroll; changes are saved as you make them.

**Each project remembers list or board** (`bt-proj-view` in localStorage, per device): opening it from the sidebar goes to whichever you used last. Board button / "Open its board" / an item's board button remember board; List view remembers list.

**Minimal look:** the board is a shade darker than the cards in light mode, the cards a shade lighter than the board in dark.

**Card sizes don't change the handles:** the string dot (or pin) and the size handle are scaled back (`scale: calc(1 / var(--s))`), so a Large card's handles are the usual size.

**Tidy and Fit ask first** (a small menu over the button). Tidy keeps drawings made on the board where they are.

**Strings route round cards** (`board.js` "Strings that go round cards"): on every look but Corkboard (wool crosses things) and Space (constellations are straight). A string leaves its card anywhere along the facing side (`facing()`: level where the two cards overlap, otherwise aimed at the other card, 20–80% along the side). If the look's usual path crosses another card (cards and the banner, 6 px clearance; not drawings on the board), `findRoute()` tries straight runs with up to two turns (then three) from any side, using the gaps beside the cards in the way, scoring length + turns + 5000 per card crossed, and the look draws that route its own way (`alongPts`: cut corners for traces, rounded for city lines and neon, hand-drawn wobble for marker/pen/chalk). About 1 ms to redraw a board's strings, so it runs live while dragging.

**Smarter layout (Tidy, and any board nothing's been placed on yet)** (`smartLayout()`): each section is packed with its cards in an order that puts strung-together ones side by side; loose cards strung into a section are placed on their own next to it; loose cards strung only to each other stay a group; unstrung ones go in one block. Each of those goes, in order of how strung-together they are, into the free spot (beside something already placed) nearest what it's strung to, keeping the whole thing compact and about screen-shaped.

**Drawing straight on the board.** The board's **Draw** button (or + Add → Drawing): the drawing editor opens over the board, see-through, and the board moves with it (`openDrawing({stage})`: `getView`/`setView` map the editor's view to the board's). Done makes a note with `data.sketch`, its drawing in board coordinates, placed so it sits exactly where it was drawn (`drawingBox(d, true)`: the card's spot is the drawing's box, its size `s` = box width / 220). On the board it has no card at all (`.pcard.sketch`), in an ink that suits the board (`--sketch-ink`, light on dark looks). Tap it to change it on the board (`moveDrawing` puts it back in board coordinates first, allowing for moves and resizes); rubbing everything out removes it (Undo). It can be moved, sized and strung like any card; on Corkboard it only gets a pin when strung.

**More drawing tools** (`draw.js`, in notes too): triangle, star, highlighter (see-through pen, `hl`), eraser (drag over things to rub them out), pen and highlighter sizes, text sizes (`z`: 1 small, 2 normal, 3 big), curved arrows (`cv`), and yellow ink. On a phone the tool bar wraps onto two rows.

## 0.7.3 Claude connector

Claude chats can work on Brain Tree, using the user's Claude plan (a **custom connector**, i.e. a remote MCP server, in `worker-braintree.js` under "Claude").

- **Address:** `POST /api/braintree/mcp/<key>` (Streamable HTTP, plain JSON replies; GET gets 405, notifications 202). The key is in the address because Claude's "No sign in" connectors work on every plan, while request-header keys are a limited beta. An `Authorization: Bearer <key>` header works too.
- **The key:** made in the app, Settings → Claude → *Connect Claude…* (`POST /api/braintree/claude`, signed in). It's shown once in a sheet with the steps (claude.ai → Customize → Connectors → + Add → Add custom connector → MCP server URL → No sign in). Only a SHA-256 hash is kept, in the new table `bt_keys` (name 'claude'). *Make a new connector address…* replaces it (the old one stops working); *Switch Claude off* deletes it (`DELETE /claude`). `GET /claude` gives connected / last used (updated at most hourly).
- **Tools:** `list_projects`, `get_project`, `search` (read only); `block_out_project` (a whole project in one call: notes, `chat_url`, sections, to-dos with steps, notes with checklists and colours, smaller projects, strings by key or title; optional dates only if the user gave them); `add_items` (to a project, section, or to-do as steps); `update_item` (title, done, notes kept with their photos/drawings, append_notes, dates, colour, move_to, chat_url); `tie_string`; `remove_item` (Recently deleted; a section's contents move up, as in the app).
- **Rules:** locked projects are off limits (Claude sees only that they exist and are locked); repeating to-dos must be ticked in the app; deleted things are skipped. Writes are ordinary saves (`device` = "Claude"), so devices pick them up on their next sync and the usual conflict handling applies.
- **The chat link:** Claude can't see its own chat's address, so the server instructions tell it to ask the user for it (the browser address on the web, or a share link). It's stored as a link tile at the top of the project's notes ("The Claude chat this was planned in"); `attach.js` labels claude.ai links "Claude chat".
- **Server text for Claude** (`MCP_INSTRUCTIONS`): how to block out a plan (sections for phases, to-dos with steps, notes, strings), not to invent dates, read before changing.

## Free tier

Each item is a small JSON row. Photos are shrunk to at most 2000 px JPEG (usually 150–500 KB) and stored in D1. The free D1 database holds 500 MB, so roughly a thousand or more photos. Settings in the app shows how much is stored. If photos ever outgrow that, they can move to R2 (Cloudflare file storage, 10 GB free).

## Testing locally

```
python devserver.py
```

Then open http://127.0.0.1:8791/builds/braintree/ and use the password `dev-password`. The real `worker-braintree.js` runs inside the page, with SQLite (sql.js) standing in for D1. Add `?sw=1` to the address to test with the offline service worker on.
