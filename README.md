# Assignment Tracker

A one-page assignment tracker with a shared list, a progress bar, optional start and end times, and drag to reorder. It is a single self-contained HTML file (`index.html`), published as a Claude Artifact or deployed on Netlify (see [Deploy on Netlify](#deploy-on-netlify)). Dark theme, system sans-serif, desktop only.

The page shows no words. Everything is an icon except placeholders, units (`hr`, `hrs`, `min`), clock text (`AM`, `PM`), the percentage in the progress bar, tooltips, the one message in the all-done popup, and the picture that popup shares. Tooltips appear after a long hover (800 ms).

## What it does

| Feature | Behavior |
| --- | --- |
| Row | Status icon, assignment name, duration. |
| Status | Click cycles ○ not started, ◐ in progress, ● done. Gray, yellow, green. A done row is dimmed with a slight green tint, has no strikethrough, and stays in place. |
| Name | Shows the placeholder when empty. Click to edit inline. Enter commits, Esc cancels. |
| Duration | Click to edit inline. Hours and minutes fields both show while editing. After commit the empty unit disappears: `30 min`, `1 hr`, `2 hrs`, `2 hrs 30 min`. Stored as total minutes. |
| Add | `+` under the list adds a row at the bottom. A row needs both a name and a duration. |
| Delete | `×` appears when you hover a row. |
| Reorder | Drag any row, including from its name or status icon. |
| Clear | Trash icon, bottom-right. First click arms it (red), second click clears the list for every viewer. |
| Progress | Thick bar at the top with the percentage inside: `½ (done rows ÷ rows + done minutes ÷ total minutes)`. In-progress rows count as 0. |
| Times | Clock toggle at the top, off by default. Off: no start or end time is visible anywhere. On: each row shows a 12-hour start and an end (start + duration). An end past midnight is plain clock time (`1:15 AM`). Entered starts persist through off and on. |
| Chaining | Link toggle, on by default, shown while times are on. On: only the first row's start is entered, every lower start is the previous end, and with no first start every start and end is blank. Editing the start of a row that follows the row above asks first, with two choices and a cancel: scissors ("Cut and continue") keeps chaining on, gives that row the new start and lets the rows after it continue from it; the broken-link icon ("Disable chaining") turns chaining off. Esc or a click elsewhere cancels. Off: every row uses only its own entered start, and a row with no start has a blank end. Turning chaining on again discards every lower row's own start, including cuts. |
| Start time on in progress | Marking a row in progress while times are shown fills its start with the current time, and the start stays editable. Chained, that start cuts the chain before the row (the row above keeps its own end) and the rows after it continue from its end; chaining stays on. Unchained, it is simply the row's own start. |
| End time on done | Marking a row done while times are shown fills its end with the current time: the duration becomes start-to-now, so chained rows below, progress and the saved list follow. |
| End correction | Once a row is done, click its end time to correct it (hour, minute, AM/PM). The new end sets the real duration (end minus start, wrapping past midnight), so chained rows below, progress, and the saved list all follow. Not editable before the row is done, or when the row has no start. |
| All done | Checking off the last open row pops up a centered message over the page: `Peter finished all of his assignments in 2 hours and 30 minutes`. The time is the total of every row's duration, worded in full (`45 minutes`, `1 hour`, `1 hour and 1 minute`). Close it with the × button, Esc, or a click outside it. |
| Share | A small share icon in the popup, left of the ×. It draws a picture (1200 × 630, saved at 2x) in the app's own colors: the all-done sentence, the total time, how many assignments and the date, and a full progress bar. It never shows assignment names, so it is safe to post. The picture goes out the best way the page can: the system share sheet, else a copy to the clipboard (the picture, plus the sentence as text for pasting into a plain text box), else a PNG save through the `downloads` capability, which asks the viewer to confirm. The result shows as a tooltip on the button, which turns into a check for about two seconds. |
| Recalculation | Reordering, deleting, or editing a duration recalculates chained times. The first start stays in the first slot. |

### Choices where the brief was silent

- Inline edits commit on blur as well as on Enter. Esc always cancels.
- A finished row can't lose its name or duration; an empty commit restores the old value.
- An unfinished row stays on screen so it can be completed, is never saved, and isn't counted in progress. Pressing `+` while one exists focuses it instead of adding another.
- Start times are typed as hour, minute and an AM/PM button. `:` or two digits move to minutes; `a` and `p` set AM/PM; 13–23 read as 24-hour.
- Marking in progress replaces any start already there with the current time, only while times are shown. Un-marking keeps the recorded times.
- Chained, a row with its own start (a cut) is edited directly with no popup; clearing it rejoins the chain. A row that still follows the row above shows the two-choice popup. The cut choice is focused first, and is disabled when the entered start is empty.
- Chained reordering and deleting: an unstarted first row's start is a plan and stays in the first slot; a started row keeps its own start wherever it goes.
- Marking done fills the end only when times are shown and the row has a start. If the start is more than 12 hours ahead of the current time (finished early), the planned duration is kept. Un-marking a row keeps the recorded duration; finishing it again records the new time.
- Editing a done row's end changes its duration, never its start. An end equal to the start, or an empty one, is ignored.
- Turning chaining off keeps only starts that were entered. Computed starts are not copied into the rows.
- The armed trash disarms after 4 seconds, on any other click, or on Esc.
- The `Times` and `Chaining` toggles are saved with the list, so every viewer sees the same setup.
- The all-done total is the sum of the rows' durations. With times shown, a row marked done records start-to-now, so the total is the time really spent; with times hidden it is the planned total.
- The all-done sentence is fixed: `Peter finished all of his assignments in …`, in the popup, on the picture and in the shared text. One person uses this tracker, so nothing asks for a name.
- The all-done popup opens only when a status click finishes the list. It stays quiet when a finished list loads, when deleting the last open row leaves only done rows, and when an edit changes a done row. Un-marking a row and finishing it again shows it again, with the current total. An unfinished draft row is ignored, as it is in progress.
- While the popup is open, keyboard focus stays on its close button, and returns to the status button on close. The click that dismisses it does nothing else.
- The picture is drawn when the popup opens, so a click can send it at once (some browsers only allow sharing straight from a click). It uses flat colors only: a gradient is dithered by the browser and made the PNG about nine times larger.
- Inside the artifact frame the browser's share sheet is refused, so there the button copies to the clipboard first and saves as a PNG if the clipboard refuses. Where the page runs outside the frame and the share sheet is allowed, it goes there first.
- Closing the share sheet or declining the save confirmation is not an error and shows nothing. A busy confirmation says `Try again in a moment`; a dead end says `Could not share`, and the button works again afterwards.
- Keyboard focus starts on the × (not the share button), so the Enter that finished the last row cannot share anything. Tab cycles between the two buttons.
- A small warning icon appears in the header only when the list could not be saved or loaded (no database, view-only access, or a failed write).

## Data

One document, `tracker/list`, in the artifact database (as an Artifact) or in the `docs` table of Netlify Database (on Netlify):

```json
{
  "v": 1,
  "times": false,
  "chain": true,
  "rows": [
    { "id": "lq3k9x2a1b", "name": "Essay draft", "mins": 150, "status": 1, "start": 540 }
  ]
}
```

- `mins` is total minutes. `status` is `0` not started, `1` in progress, `2` done.
- `start` is minutes since midnight, or `null`. When `chain` is true a row without a start follows the end of the row above; a row with one cuts the chain there.
- The list is read once when the page opens. There is no live sync: the latest write wins, and a viewer sees other people's changes after reopening the page.
- Writes are debounced, sent one at a time, and skipped when nothing changed. If the list could not be read, the page never writes over it. Edits made before the list arrives are merged in.

## Drag and drop

Vanilla Pointer Events, no library. The list is small and uniform, so about 60 lines cover it: no download, nothing blocked by the artifact CSP, and full control over the click-versus-drag line so inline editing keeps working. Rows slide aside while you drag, the page scrolls near the window edge, and the drop animates with FLIP.

## Files

```
index.html                  the page (artifact source: <title>, <style>, markup, <script>)
netlify.toml                Netlify build, publish directory, security headers
scripts/build.mjs           makes dist/index.html: index.html as a full page plus the shim below
scripts/netlify-db-shim.js  gives the page `claude.use('db')` and `claude.use('downloads')` on a normal website
netlify/functions/db.mjs    Netlify Function for /api/db/*
netlify/lib/docs-api.mjs    the handler behind it (GET/PUT one JSON document), shared with the tests
netlify/database/migrations/  SQL migrations for Netlify Database
tests/logic.test.mjs        unit tests for the pure logic block (formatting, schedule, progress, all-done, reorder, storage)
tests/e2e.test.mjs          Chromium tests for every feature, with the database mocked
tests/harness.mjs           wraps index.html like the publisher does and provides the mock database and `downloads` capability
tests/api.test.mjs          the /api/db handler against a real embedded Postgres, with the real migrations
tests/netlify.test.mjs      Chromium tests of the built page + handler + Postgres, under the CSP from netlify.toml
tests/netlify-harness.mjs   embedded Postgres and a small server for the two files above
```

The script keeps all pure logic between `/* <logic> */` and `/* </logic> */`, which is what the unit tests load.

## Run the tests

```
npm install        # playwright, @netlify/database, @netlify/database-dev
npm test
```

Chromium is expected at the Playwright default location (`PLAYWRIGHT_BROWSERS_PATH`). Set `PLAYWRIGHT_PATH` if Playwright is installed somewhere unusual. `api.test.mjs` and `netlify.test.mjs` start their own in-memory Postgres (PGlite), so they need no Netlify account or network.

## Deploy on Netlify

`index.html` is an Artifact fragment (no `<html>`, no `<head>`) and its list lives in the Artifact runtime's database. For Netlify, `index.html` stays as it is and the build adds what is missing:

1. `npm run build` (`scripts/build.mjs`) writes `dist/index.html`: a full HTML page with the title and styles in `<head>`, plus `scripts/netlify-db-shim.js`, which provides the same `claude.use('db')` and `claude.use('downloads')` the page already calls. The shim stores the list through `GET`/`PUT /api/db/tracker/list`; "download" is an ordinary browser download.
2. `netlify/functions/db.mjs` answers `/api/db/*` and keeps the document in the `docs` table of [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/) (managed Postgres). Only the `tracker/list` document is accepted, up to 256 KB.
3. `netlify/database/migrations/` creates the table. Netlify applies migrations automatically before every production deploy and deploy preview. Each deploy preview gets its own database branch seeded from production, so previews never touch the live list.

To deploy: import the repository in Netlify (build command, publish directory and Node version come from `netlify.toml`). The `@netlify/database` dependency is what makes Netlify provision the database on the first deploy. Netlify Database is available on credit-based plans only.

Run it locally with `npm run dev` (builds, then `netlify dev`, which serves the page and function and starts a local Postgres). Locally the migrations are not applied for you: with `npm run dev` running, run `npm run db:migrate` in a second terminal, once and again whenever a migration is added. Edit `index.html`, then restart `npm run dev` to rebuild.

Things to know:

- There is no sign-in. Anyone with the site URL can read, edit and clear the list, just as a shared Artifact lets everyone write. Put the site behind Netlify's password protection or another gate if that is not what you want.
- Sync works as before: the list is read once when the page opens and the latest write wins. A save that fails shows the warning icon, and a list that could not be read is never overwritten.
- On Netlify the share button tries the share sheet, then the clipboard, then saves a PNG; the save is a plain download with no confirmation step.

## Publish as a Claude Artifact

Publish `index.html` as a Claude Artifact with the `db` and `downloads` capabilities (`capabilities: { db: {}, downloads: true }`). `downloads` is how the share button saves a picture when the clipboard refuses. Anyone who can write shared data (Contributor and up) can edit the list; view-only viewers see the list and the warning icon if they try.
