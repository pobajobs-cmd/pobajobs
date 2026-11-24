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
| App (published) | `builds/braintree/`: `index.html`, `app.js` (screens), `store.js` (offline data and sync), `editor.js` (note editor), `board.js` (boards), `theme.js` (looks), `media.js` (YouTube clips), `draw.js` (drawings), `sheet.js` (spreadsheets), `attach.js` (files and links), `preview.js` (files as pictures on boards, 0.7.9), `record.js` (Record mode: a board as a video, 0.8.0), `search.js` (search, 0.8.1), `plan.js` (waiting on, tags, costs, 0.9.0), `timeline.js` (timeline, 0.9.0), `remind.js` (reminders, 0.9.0), `share.html` + `share.js` (a read-only link's page, 0.9.0), `export.js` (PDF, print, CSV), `example.js` (example project), `gestures.js` (swipe, hold, drag in the lists), `styles.css`, `sw.js` (offline files) |
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
- **Server text for Claude** (`MCP_INSTRUCTIONS`): how to block out a plan (sections for phases, to-dos with steps, notes, strings), not to invent dates, read before changing. Strings are pushed hard (the user found the first projects had few): tie anything that feeds into, needs, comes before or is based on another, about one string per two or three things, short labels. If a blocked-out project still comes back with fewer than one string per four things, the result says so and tells Claude to tie more with `add_items` (only a `strings` list, by title).

## 0.7.4 Tidier busy boards

From a 70-card board Claude blocked out, which came out messy on a phone:

- **Tidy fits the screen it's on** (`smartLayout`): it lays out to the shape of the board area (`A` = width ÷ height), scoring how wide the board must be shown to fit (`max(W, H × A)`) plus string distances, so a phone gets a tall layout, mostly two columns, and a computer a wide one. On a tall screen, sections and blocks pack at most 2 cards across. Gaps between sections are 96 px, room for strings to pass. (Until something is moved, each device lays the board out for its own screen.)
- **Strings go round sections they aren't in** (`findRoute`): crossing a card costs 5000, going through a section that has neither end in it costs 700, so it goes round unless that's much longer; section edges are among the ways past.
- **Labels sit on a clear stretch** (`labelSpot`): halfway along unless that's over a card, then the nearest clear spot along the string (branches start there too).
- **Faint string dots on touch screens** (opacity 0.28; full on the picked card and in String mode), so a zoomed-out board isn't covered in rings.

## 0.7.5 Tidy that thinks

The user asked for Tidy to weigh strings and crossings, with sections first and the cards inside them second, and for separate kinds of tidy. Tidy now has two options (the menu over the Tidy button), and strings tidy themselves:

- **Tidy everything** (`tidyAll`): blocks are each section with its cards (a grid in reading order, 2 or 3 across), loose cards strung into a section (one by one), loose cards strung only to each other (a group), and the rest (one block, last). Blocks start in **flow order** (`flowOrder`: each after what feeds into it, next to what it was just strung to, otherwise list order) and are laid in **reading rows** as wide as suits the screen. Then it tries swapping blocks, swapping cards within blocks, narrower/wider sections and narrower/wider rows, keeping every change that lowers **`untidiness`**: string length + 800 per string running backwards (up, or left on the same row) + 700 per pair of crossing strings + 900 per string over a card that isn't its own + how wide the board must be shown to fit the screen. About 70 ms for 60 cards; capped at 300 ms.
- **Tidy inside sections** (`tidyInside`): sections keep their spot (and at least their width); the cards in each are reordered the same way, each section's height fits its cards.
- **Both save the result** (every card's and section's spot, sizes kept; Undo puts it all back), so the board looks the same on every device. A board nothing has been placed on yet is laid out with `tidyAll` too, worked out once (`autoTidy`, cached until something on it changes).
- **Strings route together** (`routeAll`): when nothing's being dragged, every string is routed with the others in mind (shortest first, then all again with all the others): crossing another string costs 160, running along on top of one costs 3 per pixel shared, and routes can run just beside other strings. A look's own curve or straight line is kept unless going round is clearly tidier. Cached until something moves; while dragging, each string routes on its own (quicker). Labels also avoid each other.
- A separate "tidy strings only" button wasn't needed: strings re-route by themselves after every change.

## 0.7.6 Autorouter and strings you can shape

The user wanted string routing to work like a circuit-board autorouter (taking extra turns rather than crossing things), and more control over strings: drag the path, add turns.

- **The autorouter** (`routingGrid`, `autoroute`, `computeRoutes`; replaces 0.7.5's `routeAll`): the board becomes a grid of 16 px squares. Each card (6 px bigger than drawn) blocks its squares. A string is an A* search over (square, direction): each square costs 1, each turn 3, a square inside a section it isn't in 1.5 more, crossing another string 20, running on top of one 4. It leaves and arrives on any side (15–85% along, a little dearer away from the point facing the other card), so it takes extra turns to get round things rather than cross them, and strings keep a square apart, like tracks. The search covers the two cards ±480 px, or the whole grid if that finds nothing. Strings route shortest first, then each again with all the others in place. A look's own curve or line is kept if it gets through cleanly (`pathPenalty` < 8). About 10 ms for the 21-string CNC test board; no string crosses a card, 1–2 crossings.
- **Worked out just after a redraw** (`setTimeout` 40 ms, cached by a signature of the looks, boxes and shapes), so dragging stays smooth: while dragging, each string finds its own way (`dodge`/`findRoute`, as before). Export routes first and leaves out the dots.
- **Shaping a string by hand**: tap a string and it glows, with a big dot at each turn and a small dot along each stretch. Drag a big dot to move that turn, drag a small dot to add a turn there, double-tap a big dot to take that turn out. Or just pull the string: on Blueprint, Hacker, Circuit and City a straight stretch between two turns moves as one, elsewhere a turn goes in where you grabbed. Dots snap to 8 px and line up with the turn either side (within 10 px). The string's menu now wraps (label, then Save, Branch, Auto, Remove, then a hint) and sits wherever it covers least of the string and its dots. **Auto** hands a string back to the autorouter. The first shaping of a string, a removed turn and Auto each toast with Undo.
- **Stored per board**: `data.links[].via = { [boardId]: [[x, y], …] }` in board pixels (a card can be on more than one board). The ends still follow the cards, leaving from the side facing the first turn. Blueprint and Hacker turn right angles between turns (`orthoThrough`), Circuit and City 45° (`octoThrough`), the inked looks, Minimal and Neon round the corners, and Corkboard wool hangs between grey pins at the turns (`woolThrough`). The autorouter routes the others round shaped strings.
- **Shapes keep up**: dragging a section moves the shapes of strings with both ends inside it. Tidy moves a shape along if both its ends moved the same way, otherwise hands it back to the autorouter (Undo restores it). Sync merges shapes board by board (`mergeLinks`: mine where I changed it, theirs where I didn't). Duplicating a project copies them onto the copy's boards.
- Example project: notes checklist lines for the autorouter and shaping (no shaped string in the data, since card spots are only worked out when the board opens).

## 0.7.7 Room for labels, and strings that point

The user found short strings with labels obscured (labels covering cards and each other), and asked for directions on strings.

- **Labels are placed after all the strings** (`placeLabels`, `labelSpot`), shortest strings first, on every look. A label goes on a clear stretch of its string (not over a card, a section's name, another label or an arrowhead, and over as few other strings as possible); if the string has no room, it sits just beside it in the nearest clear space (beside the string, then further round, up to about 220 px), with a dotted line and dot back to the string (`.leader`, `.ldot`). Branches start from the label wherever it sits. A knot (branches, no label) stays on its string.
- **The autorouter keeps strings from under labels**: after the first pass the labels are placed and marked on the grid (`G.lab`), and the second pass charges 14 a square for running under another string's label (`ROUTE_LABEL`).
- **Tidy leaves room for labels** (`measureLabelRoom`, `gridOf`): between two cards side by side tied by a labelled string, that column gap is the label's width + 30 (+26 if it points, +48 both ways; at most 200); one above the other, that row gap is 50 (72 if it points). On the CNC test board, after Tidy every label fits on its own string.
- **Strings can point**: `data.links[].dir` = `to` (arrowhead at the card it was tied to), `from`, `both` or `none`; unset is the look's own (an arrow at the far end on Blueprint, Hacker, Minimal, Whiteboard, Notebook and Chalkboard, none on the rest). The string's menu has an arrow line ("→ Points to “…”", "← Points to “…”", "↔ Points both ways", "— No arrows"); each tap moves to the next. Arrowheads are drawn the look's way (`arrowHead`: a vee in marker, pen, chalk or neon tube; a filled head on City, Circuit, Corkboard, Space; the usual arrow on Blueprint, Hacker, Minimal), clear of the end's dot, pad, station, star or pin. Branches follow their string. The item screen's Strings list shows → / ← / ↔.
- Sync merges `dir` like a label (`mergeLinks`).
- **Claude**: strings in `block_out_project` and `add_items`, and `tie_string`, take `arrow` (`to`, `from`, `both`, `none`; `tie_string` flips it if the string is stored the other way round). `get_project` lists which way each string points. The instructions ask for `arrow: "to"` where a link has a direction.
- Example project: "feeds into" and "pays for" point to their far end; notes lines for arrows and label placement.

## 0.7.8 Tidy that routes, and routed branches

The user asked where the "autoroute tidy" was, and pointed at a crossing on the example board (on a phone, Circuit look): the "read from" branch to "Film the intro" crossed "Shot plan" → "Write the script". They asked why Tidy didn't just move "Film the intro" below that string.

- **Why it crossed**: Tidy's score (`untidiness`) drew each string as a straight line between card middles and skipped pairs of strings sharing a card, so it couldn't see the crossing (both strings touch "Write the script"). Branches were scored as separate strings from the first card, not from the junction.
- **Scored as drawn**: strings now run from the side of each card facing the other (`facing`, as the looks draw them), a branch from halfway along its string (where its label or knot goes) to its card (`stringsAmong` gives each string with its branches), and any two different strings that cross count, even if they share a card.
- **A wider search**: swapping one thing at a time could get stuck, so `tidyAll` goes four ways and keeps the best. First the old rough score (middle to middle, smoother) finished with the drawn score, then the drawn score from scratch at row widths ×1, ×0.75 and ×1.4. `tidyInside` uses the rough-then-drawn way, or drawn from scratch, whichever scores better.
- **Then with the strings really routed** (`routedUntidiness`, on looks that route: not Corkboard or Space): for a moment the cards go where a layout has them, `computeRoutes` routes every string and branch, and the result is measured (route length, turns × 12, crossings × 700, strings running backwards × 800, plus how well it fits the screen). Each distinct layout from the search is nudged that way (cards swapped, section columns ±1, sections swapped) within a share of a time budget (400 ms for Tidy, 250 ms for a board nothing's placed on), and the best one is kept. This is how a phone-shaped layout loses its crossings instead of a wide layout winning just because it has none.
- **Results** (routed crossings counted from the drawn paths): example board 1 → 0 on desktop and 2 → 0 on a phone (strings less than half as long); CNC board 0 crossings, total string length 5306 → about 4500. Tidy takes about 0.3–0.5 s on a desktop.
- **Branches are routed** (`computeRoutes`, last): from where the label is drawn (`labelsAsDrawn`, shared with `drawLines`, so the spot matches) to each card, keeping the look's own shape if it gets through cleanly, otherwise by the autorouter, so they go round cards and across as few strings and labels as they can. A branch is drawn from the router only if its label is where it was routed from; otherwise the quick way (`branchWire`), as while dragging.
- **"Tidy strings only (cards stay put)"** in the Tidy menu: every string on the board is routed again, and hand-shaped ones are handed back to the autorouter (Undo restores them). Strings nobody has shaped are routed like this all the time anyway.
- Example project: notes lines for routed branches, the routed Tidy and "Tidy strings only".

## 0.7.9 Tighter Tidy, a suggestion for stranded cards, files as pictures

The user's LowRider CNC board (phone, Circuit): "Set up and calibrate" sat in "Prep and decisions" with its only string ("needed before") climbing the whole section to "Print the LR4 parts". They wanted it outside the section, with the board more concise. Asked how Tidy should handle that: "Have a suggestion but it shouldn't by default". They also asked for PDFs and other files to show as what they are on the board ("first page only if needed or options for a snippet… like a true cork board").

- **Tight packing** (`place`, `gridOf`): sections can tuck up under shorter ones, like a skyline, instead of every row starting under the tallest section of the row before; cards in a section stack by column, so a short card leaves no gap under it. `tidyAll` tries every start both tight and in neat rows (8 starts), routes them all as they are, and nudges the best 3 (so each gets enough of the time budget). `tidyInside` keeps tight unless rows route tidier. On the CNC test board: phone 1265×2038 → 1265×1754 with strings 5933 → 5257, 0 crossings; desktop picks a squarer flowing layout (0 crossings, a little more string, fewer strings running backwards). Tidy takes about 0.5–0.6 s on a desktop.
- **Stranded cards** (`strandedCards`): a card whose strings all go to cards outside its section, when the rest of its section is strung together (so a section that's really a category, like "Buy the rest", is never picked). Tidy never moves a card out of its section by itself (sections are list headings). A moment after "Tidy everything" it tries each one (up to 3) in the section its strings go to, and out of its section (`tidyAll(todo, budget, par)` lays out as if moved; `tidyScore` is how tidy that came out), one at a time so the board stays usable. If the board comes out at least 5% tidier, a tip shows over the board: "Move into …" / "Take it out", "Keep it there" (remembered on this device in `bt-tidy-kept`, so it isn't suggested again), × for not now. Taking it changes the card's section and lays the board out as tried, with Undo.
- **Settings → Boards → "Card only strung outside its section"**: "Tidy suggests moving it" (the default, pref `tidyMove: 'ask'`) or "Tidy moves it" (`'move'`: Tidy makes the tidiest moves itself and says so in its toast, with Undo; slower, about 2 s on a desktop).
- **Files as pictures** (new `preview.js`): a PDF's page (Mozilla's pdf.js 4.10.38 legacy build, loaded from jsDelivr the first time and kept by the service worker in its own cache, `bt-lib-pdfjs-4.10.38`), photos and picture files (HEIC on an iPhone), a video's frame, an audio file's waveform, text/Markdown/code/G-code as a page, CSV and Excel as a table, Word as a page of its text, PowerPoint as its saved thumbnail or first slide's text, OpenDocument and Pages/Numbers/Keynote as the picture they keep inside, zips as a list. Office files are read with a small zip reader (`DecompressionStream('deflate-raw')`). Nothing about a file leaves the device.
  - Made when a file is added (in a note or "+ Add → File" on a board, `addDocWithPreview`) and kept like a photo, so it syncs and other devices just show it: `data-pv` (its photo id, or `off` for just the tile), `data-pva` (its shape), `data-page`, `data-crop` ("x,y,w,h" fractions) on the file's div (sanitized in `editor.js`).
  - Files added before 0.7.9: the board makes their picture on this device (`docPreviewUrl`, one at a time, fetching the file if it isn't here and is under 15 MB) and keeps it in IndexedDB (`pv~` ids in the files store, never uploaded).
  - On a card: a sheet of paper (or photo, frame…) in its known shape, with its kind and name on a label underneath; it drags the card like a photo does and a tap opens the file. More photos and files in the same note are pinned up small along the bottom (up to 4; the rest counted).
  - In a note, tap a file → "How it shows on the board…": its page (arrows for other pages), drag across it for just that part (drag the part to move it, tap to clear), "Pin it up", or "Just its tile". The note's tile shows a little copy of its picture.
- Tested headless (Edge): every kind renders in 20–150 ms; a fresh example gets its PDF and text file pictures when added; the snippet picker; a 0.7.8 example's PDF gets its picture made on the device; the tip's move, Undo and "Keep it there"; "Tidy moves it". Not tested: a real iPhone (HEIC, video frames, pdf.js on Safari), real Word/Excel/PowerPoint files (only hand-built ones), files over a few MB.
- Known, not new: Tidy leaves drawings made on the board where they were drawn, so on a board tidied more than once a card or section can end up under one.
- Example project: "Write the script" has the draft PDF's first page and "Hook lines.txt" pinned up small; new strings "then" (Rough cut → Add music) and "shots for" (Shot plan → Film the intro) keep every section strung together, so the example gets no tip; notes lines for tight packing, the tip and file pictures.

## 0.8.0 Record mode: a board as a video

The user's idea: a "record" mode for making videos from a board (think true crime: the red-string wall), with keyframes and transitions, strings tracked, zooms, highlighted text, ticked to-dos; plus, they added, other ways to pick out a card like circling it or racking focus. Built in one go, with video export.

- **Record** on the board bar: the bar becomes a panel (recording name and menu, 9:16 / 16:9, look, voiceover, Play, Make video, Done) with a strip of shots, and a frame over the board shows what the camera sees (outside it dimmed). Tap a card, section or string (or its label) to add a shot of it after the one picked; "+ Shot" adds "this view" or the whole board. Tap a shot to go to it and change it (`recSheet`): how long it stays, how the camera gets there (glide with a slight arc, cut, whip with motion blur, zoom out and in, fade through black), effects as chips, a caption (typewriter or lower third with a second line), "Use this view" (frames it as it is in the frame now), move earlier or later, play from here, delete (with Undo).
- **Effects**: spotlight (the rest darkened; the hole slides to the next thing if that shot has one too), circle it (a hand-drawn red ring), rack focus (the rest soft, also sliding between shots), highlight text and underline (the card's title, line by line), trace strings (a string's own, or every string to or from a card or section: off the board until then, then drawn end to end, its label popping on), tick it (a to-do, on camera only), drop it in (the card off the board until then, then dropped and pinned with a polaroid flash), slow push in (towards its picture if it has one), shake, flash. Looks over everything: Plain, True crime (colour drained, warm, grain, vignette) and Noir.
- **How it's drawn** (`record.js`, `makeRenderer`): a canvas, so the preview is exactly the video. `recordScene` (board.js) makes the board as a picture with `exportSVG` (now with `hideLinks`, `hideCards` and `collect`, measured while the board is flat at 100%), leaving out the strings it traces and the cards it drops in; those come as their own small SVG pictures (`inlineNode`; each string and its label are now wrapped in `g[data-sw]` / `g[data-sl]` in `drawLines`). Rendering: the whole board at up to 2600 px, plus a sharper piece for the shots either side of now (made when needed, a few kept); traced strings revealed along their path (`destination-in` with a dashed thick stroke of the string's path); soft focus by shrinking in steps and growing again. Shots are stored on the project as `data.recs` (see the top of record.js), framed relative to what they're of, so they follow a card that's moved.
- **Play** opens a full-screen player (play/pause, scrub, close). **Voiceover**: an audio file kept like any file; "Time the shots to it" plays it, and each tap of Next shot ends the shot that's on (durations are worked back from the taps, less each transition). **Make video** records the player as it plays (`MediaRecorder` on `canvas.captureStream(30)`, the voiceover mixed in through an `AudioContext`): MP4 where the browser can (Chrome, Edge, Safari), WebM otherwise, 1080×1920 or 1920×1080, 10 Mbit/s; then shared (phone) or downloaded, like an export.
- Tested headless (Edge): the editor on desktop and phone shapes; a tap on a card adds a shot; the scene ready in about 0.1 s; frames across a 7-shot recording on the CNC board (Circuit) and the example's (Corkboard) show every effect; Make video gave an 8.6 s MP4 (5.3 MB); tap-along timing set the durations as expected. Not tested: a real iPhone (share sheet after recording, audio in the video, smoothness), a real voiceover, long recordings.
- Example project: "How it comes together", 9:16, True crime, nine shots using most effects and every transition; a notes line about Record.

## 0.8.1 Search everywhere, in a project, and on a board

The user couldn't find the example recording (theirs was an example project from before 0.8.0, which never got one) and asked for search across the whole app and in each project.

- **Search** (new `search.js`): the words typed, in any order, anywhere in a thing: title, text, checklists, spreadsheet cells (as they show, formulas worked out), file names, clip and link titles, a link's site, and string labels. Capitals and accents don't matter; "quotes" keep words together. Results best first (title hits above text hits, a word's start above its middle), with the words marked and a line of the text round them when they were found there.
- **Everywhere** (the side panel's box): projects that match first, then results under their top project, with where each is inside it (section › sub-project), then things in no project. On a phone the side panel is out of sight once results show (that hid the box as you typed), so there its box is read-only and opens a search page with its own box (`findAll`, `#listFind` in `all` mode).
- **In a project**: a magnifier in the list's top bar (`#findBtn`, or `/`) opens a box under it (`#listFind` in `project` mode); results grouped by what's loose in the project, then each section or sub-project; "Search everywhere for …" moves the words to the everywhere search. On a phone the Board button is just its icon now, so the project's name has room.
- **Find on a board** (the magnifier in the board's header, or `/`): matching cards and sections stay bright, the rest fade (strings too), ‹ › or Enter / Shift+Enter go through them in reading order, and the board glides to each (close enough to read, or all of a big section). Kept through redraws; closed by Record and by changing boards.
- **The example's recording** is now `exampleRecording()` in example.js; an example project with no `recs` gets it (cards found by their titles, `EXAMPLE_REC_CARDS`), once per device and only after this device has synced, so deleting it keeps it gone.
- Tested headless (Edge), desktop and phone shapes: words only in a spreadsheet, a file name and a string label; capitals; quotes; nothing found; a project's search and moving it to everywhere; the phone search page keeping its box focused; board Find (1 of 3, Enter to the next, the view gliding there, still marked after a redraw); the recording added to an older example and staying gone once deleted. No errors.

## 0.9.0 Waiting on, templates, tags, costs, timeline, weekly review, links, reminders, Siri

The user asked for every idea from a list of "things that would complement the app": all of them in one go.

- **Waiting on** (new `plan.js`, `waitMap`): a string whose arrow goes from an unfinished to-do or project into a to-do (`dir: 'to'` from the owner, or `'from'` back to it; branches count with `'to'`) means that to-do waits. It's faded with "waiting on …" in lists, has an hourglass chip on the board and a banner in its page, drops out of Today (into a "Waiting on something" band) and out of the Today counts and sidebar badges. Ticking the thing it waits on says "Now free: …". "+ Waits for…" under Strings ties one. A to-do can't wait on something it's inside (or that's inside it). Claude's `tie_string` description now says arrows mean this.
- **Templates**: `data.template` on a project. It and what's in it leave Today, Upcoming, Inbox, All to-dos, Notes, the timeline, reminders and the sidebar tree (`I.work` is everything live minus templates); they're under "Templates" in the sidebar. "Start a project from it" (template bar, item menu, + New) copies everything with `duplicate(id, { title, shift, fresh })`: every date moves by the days between the template's end (its due, else its last date) and the day you pick. Recordings now follow copied cards in any duplicate.
- **Tags**: `#word` in a title or a note's text (`tagsOf`, using search.js's `textFor`). The sidebar lists the 15 most used; `#/tag:<name>` lists what has it by project; quick add there adds the tag. Rows and board cards show tags as accent text.
- **Costs**: `data.cost` on to-dos (a £ chip beside the dates, or "£12.50" typed in a quick add: `quickCost`), `data.budget` on projects (the same chip). The project line says "£x spent · £y of £budget" (ticked to-dos count as spent), sections show their total, rows and board cards show prices.
- **Timeline** (new `timeline.js`, `#/timeline`, its own full-width view like a board): projects with their dated to-dos as bars; Weeks or Months zoom; drag a bar to move it, an end to change start or due (with Undo); tap to open (drawer like the board); on touch, hold first. Waiting bars are striped, late ones red.
- **Weekly review** (`#/review`): done in the last 7 days, then Late (Today / Next week / No date / Done buttons), Waiting, Gone quiet (no change in 14 days: Still going / Finished / Make it a template), Coming up in 7 days. "Done for this week" stores `bt-reviewed`; the sidebar shows a dot after 7 days.
- **Read-only links**: "Share a read-only link" on a project sends a snapshot (its list as plain text, and a JPEG of its board made like the board export) to `POST /api/braintree/share`, kept in D1 `bt_shares` in 1.5 MB pieces under a random token; `share.html#<token>` (new, with `share.js`) shows it to anyone. Update sends it again under the same token; Stop deletes it. Settings lists them. Locked projects can't be shared. The service worker leaves share.html alone.
- **Quick add with Siri**: Settings makes a key (`bt_keys` 'capture') and a URL, `POST /api/braintree/capture/<key>`, for an iPhone Shortcut (Dictate Text → Get Contents of URL with JSON `{text}` → Show Result). It saves a to-do in the Inbox with `parse: true` (long text becomes a note); the app reads a date and price out of it (`parseCaptured`, dates counted from the day it was said) and drops the flag.
- **Reminders** (new `remind.js`, web push): `data.remind` ("HH:MM", on its due date) on to-dos, and a morning summary time (`morning` in the appearance pref, synced). The app works out the next 14 days of notifications (`planFor`) and sends the list (`POST /push/plan`, replacing what's queued) whenever things change. `wrangler.jsonc` now has a cron trigger every minute; `worker.js`'s `scheduled` runs `braintreeCron`, which sends what has come due to every subscribed device (`bt_push_subs`) and drops dead ones (404/410). Encryption is RFC 8291 aes128gcm, signing is VAPID (RFC 8292) with a key pair the server makes once (`bt_push_meta`). The service worker shows them and opens the right page when tapped. On an iPhone only the home-screen app can get them (iOS 16.4+). Settings: Switch on, Send a test, Switch off, morning time.
- Tested in the Browser pane (dev server), desktop and phone shapes: waiting rows, chips, banner, the "Now free" toast and Undo; "+ Waits for…"; tags and the tag page; costs from quick add, the chips and totals; timeline drawing, dragging a bar and an end, Undo, opening a bar; the weekly review's blocks and buttons; making a template and starting a project from it (dates moved 47 days); a read-only link made, its board picture and list shown on share.html; quick add (date and price read out; a wrong key gets 401); the reminders plan (morning summaries and a to-do's own time queued) and the cron (sent, a failing device counted). The push encryption decrypts the RFC 8291 appendix example with the same steps, our own messages decrypt, and the VAPID signature verifies. Not tested: a real notification on a phone (needs the live site and the user's iPhone).

## Free tier

Each item is a small JSON row. Photos are shrunk to at most 2000 px JPEG (usually 150–500 KB) and stored in D1. The free D1 database holds 500 MB, so roughly a thousand or more photos. Settings in the app shows how much is stored. If photos ever outgrow that, they can move to R2 (Cloudflare file storage, 10 GB free).

## Testing locally

```
python devserver.py
```

Then open http://127.0.0.1:8791/builds/braintree/ and use the password `dev-password`. The real `worker-braintree.js` runs inside the page, with SQLite (sql.js) standing in for D1. Add `?sw=1` to the address to test with the offline service worker on.
