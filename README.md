# Assignment Tracker

A one-page assignment tracker with a shared list, a progress bar, optional start and end times, optional subject, due date and assignment type columns, and drag to reorder. It is a single self-contained HTML file (`index.html`), published as a Claude Artifact or deployed on Netlify (see [Deploy on Netlify](#deploy-on-netlify)). Dark theme, system sans-serif, desktop only.

The page shows no words. Everything is an icon (the menu included) except placeholders, units (`hr`, `hrs`, `min`), clock text (`AM`, `PM`), the percentage in the progress bar, tooltips, the one message in the all-done popup, and the picture that popup shares. Tooltips appear after a long hover (800 ms).

## What it does

| Feature | Behavior |
| --- | --- |
| Row | Status icon, assignment name, duration. Subject, due date, assignment type and times can be added from the menu. |
| Status | Click cycles ○ not started, ◐ in progress, ● done. Gray, yellow, green. A done row is dimmed with a slight green tint, has no strikethrough, and stays in place. |
| Name | Shows the placeholder when empty. Click to edit inline. Enter commits, Esc cancels. |
| Duration | Click to edit inline. Hours and minutes fields both show while editing. After commit the empty unit disappears: `30 min`, `1 hr`, `2 hrs`, `2 hrs 30 min`. Stored as total minutes. |
| Add | `+` under the list adds a row at the bottom. A row needs both a name and a duration. |
| Delete | `×` appears when you hover a row. |
| Reorder | Drag any row, including from its name or status icon. |
| Menu | Hamburger icon in the header. Opens a small drop-down under it with icon toggles (each has a tooltip): subject (book), due date (calendar), assignment type (tag), then times (clock) and chaining (link). The drop-down stays open while you change several toggles, and closes on a second click on the hamburger, an outside click, Esc (focus returns to the hamburger) or tabbing out. |
| Subject, Assignment type | Optional columns, off by default, shown right after the name (subject first, type after the due date). Free text, up to 100 characters. While empty they show the grey placeholders `Subject` and `Assignment type`, as the name shows `Assignment`. Click to edit inline; Enter commits, Esc cancels; empty is fine. A row can be dragged by these cells. |
| Due date | Optional column, off by default, between subject and type. A date input; clearing it removes the date. Stored as `YYYY-MM-DD`. |
| Reload | Circular-arrow icon at the right end of the header. Reloads the page, which reads the shared list again, so changes made on another device show up. A save still waiting is sent first. |
| Clear | Trash icon, bottom-right. First click arms it (red), second click clears the list for every viewer. |
| Progress | Thick bar at the top with the percentage inside: `½ (done rows ÷ rows + done minutes ÷ total minutes)`. In-progress rows count as 0. |
| Times | Clock toggle in the menu, off by default. Off: no start or end time is visible anywhere. On: each row shows a 12-hour start and an end (start + duration). An end past midnight is plain clock time (`1:15 AM`). Entered starts persist through off and on. |
| Chaining | Link toggle in the menu, on by default, shown while times are on. On: only the first row's start is entered, every lower start is the previous end, and with no first start every start and end is blank. Editing the start of a row that follows the row above asks first, with two choices and a cancel: scissors ("Cut and continue") keeps chaining on, gives that row the new start and lets the rows after it continue from it; the broken-link icon ("Disable chaining") turns chaining off. Esc or a click elsewhere cancels. Off: every row uses only its own entered start, and a row with no start has a blank end. Turning chaining on again discards every lower row's own start, including cuts. |
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
- The three column toggles, `Times` and `Chaining` are saved with the list, so every viewer sees the same setup.
- Subject, due date and type never decide whether a row is finished (that is still a name and a duration), so an unfinished row, with or without them, is not saved or counted.
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
  "cols": { "subject": true, "due": true, "type": false },
  "rows": [
    { "id": "lq3k9x2a1b", "name": "Essay draft", "mins": 150, "status": 1, "start": 540, "subject": "English", "due": "2026-10-14", "type": "" }
  ]
}
```

- `mins` is total minutes. `status` is `0` not started, `1` in progress, `2` done.
- `cols` says which optional columns show. `subject` and `type` are text (up to 100 characters); `due` is `YYYY-MM-DD` or `null`. Documents saved before these existed have no `cols` and no row fields, and load with every column hidden and empty.
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
scripts/make-icons.mjs      draws the app icons into public/ (`npm run icons`)
public/                     copied into dist/ as is: manifest.webmanifest, apple-touch-icon.png, icons/*.png
netlify/functions/db.mjs    Netlify Function for /api/db/*
netlify/lib/docs-api.mjs    the handler behind it (GET/PUT one JSON document), shared with the tests
netlify/edge-functions/auth.mjs  Netlify Edge Function in front of every path: the site password
netlify/lib/auth.mjs        the Basic Auth check behind it, shared with the tests
netlify/database/migrations/  SQL migrations for Netlify Database
tests/logic.test.mjs        unit tests for the pure logic block (formatting, schedule, progress, all-done, reorder, storage)
tests/e2e.test.mjs          Chromium tests for every feature, with the database mocked
tests/harness.mjs           wraps index.html like the publisher does and provides the mock database and `downloads` capability
tests/api.test.mjs          the /api/db handler against a real embedded Postgres, with the real migrations
tests/netlify.test.mjs      Chromium tests of the built page + handler + Postgres, under the CSP from netlify.toml
tests/netlify-harness.mjs   embedded Postgres and a small server for the two files above
tests/auth.test.mjs         the site password: the Basic Auth check and the edge function that applies it
tests/pwa.test.mjs          the manifest and icons, and that the files a browser fetches to install the app are served without the password
```

The script keeps all pure logic between `/* <logic> */` and `/* </logic> */`, which is what the unit tests load.

## Run the tests

```
npm install        # playwright, @netlify/database, @netlify/database-dev
npm test
```

Chromium is expected at the Playwright default location (`PLAYWRIGHT_BROWSERS_PATH`). Set `PLAYWRIGHT_PATH` if Playwright is installed somewhere unusual. `api.test.mjs` and `netlify.test.mjs` start their own in-memory Postgres (PGlite), so they need no Netlify account or network.

## Install as an app (Mac)

The Netlify site can be installed, so it gets its own icon (the green check in a circle) and its own window, without browser tabs or an address bar.

- **Safari** (macOS Sonoma or later): open the site, then File, Add to Dock. Safari takes the icon from `/apple-touch-icon.png`.
- **Chrome or Edge**: open the site, then use the install button at the right of the address bar, or the browser menu's install entry. The icon comes from the manifest.

Things to know:

- If you added the site to the Dock before the icons existed, the browser kept the icon it found then (a generic one, or Netlify's). Remove that Dock app (right-click, Options, Remove from Dock, and delete the app from your Applications folder), deploy this change, then add it again. The icon is fixed at install time and does not update by itself.
- `public/manifest.webmanifest` and the PNGs in `public/` are copied to `dist/` by the build. They are the only files served without the password (`PUBLIC_PATHS` in `netlify/lib/auth.mjs`; `tests/pwa.test.mjs` fails if `public/` and that list drift apart). Browsers fetch them on their own, without the page's login, so behind the password they got a 401 and the install fell back to a generic icon. They hold only the app's name and picture. The page and `/api/db/*` still need the password.
- Installing does not remove the password: the installed app asks for it like the browser did, and it needs a connection, since the list lives on the server. There is no service worker, because Chrome and Edge do not need one to install and a cached copy of the page would only go stale after a deploy. A Safari Dock app does not share its login with Safari, so expect to be asked for the password when you first open it.
- To change the picture, edit `scripts/make-icons.mjs`, run `npm run icons` (it needs Playwright's Chromium, like the tests) and commit the PNGs: the Netlify build does not download a browser, so it cannot draw them. `*.png` is git-ignored except under `public/`.

## Deploy on Netlify

`index.html` is an Artifact fragment (no `<html>`, no `<head>`) and its list lives in the Artifact runtime's database. For Netlify, `index.html` stays as it is and the build adds what is missing:

1. `npm run build` (`scripts/build.mjs`) writes `dist/index.html`: a full HTML page with the title and styles in `<head>`, plus `scripts/netlify-db-shim.js`, which provides the same `claude.use('db')` and `claude.use('downloads')` the page already calls. The shim stores the list through `GET`/`PUT /api/db/tracker/list`; "download" is an ordinary browser download.
2. `netlify/functions/db.mjs` answers `/api/db/*` and keeps the document in the `docs` table of [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/) (managed Postgres). Only the `tracker/list` document is accepted, up to 256 KB.
3. `netlify/database/migrations/` creates the table. Netlify applies migrations automatically before every production deploy and deploy preview. Each deploy preview gets its own database branch seeded from production, so previews never touch the live list.
4. `netlify/edge-functions/auth.mjs` puts the site behind one shared password, so Netlify's own site password (a Pro plan feature) is not needed. It runs before everything else, so it guards the page and `/api/db/*` alike (only the manifest and the app icons are left open, see [Install as an app](#install-as-an-app-mac)). The browser asks for the password once with its own login box (HTTP Basic Auth); the username is ignored, so anything works. The password is the `SITE_PASSWORD` environment variable, never part of the repository.

To deploy: import the repository in Netlify (build command, publish directory and Node version come from `netlify.toml`). The `@netlify/database` dependency is what makes Netlify provision the database on the first deploy. Netlify Database is available on credit-based plans only.

Then set the password: in Netlify, Site configuration, Environment variables, add `SITE_PASSWORD` (leave all deploy contexts ticked so deploy previews are protected too) and redeploy. Until it is set, the whole site answers `503` ("The site password is not set") instead of being served open. Pick a long passphrase: the edge function does not limit guesses, and the browser's login box has no log out.

Run it locally with `npm run dev` (builds, then `netlify dev`, which serves the page, the function and the edge function, and starts a local Postgres). Locally the migrations are not applied for you: with `npm run dev` running, run `npm run db:migrate` in a second terminal, once and again whenever a migration is added. Edit `index.html`, then restart `npm run dev` to rebuild. Give it a password with `SITE_PASSWORD=something npm run dev`, or a `.env` file containing `SITE_PASSWORD=something` (`.env` is git-ignored).

Things to know:

- There are no accounts, only the one shared password. Anyone who has it can read, edit and clear the list, just as a shared Artifact lets everyone write. The Claude Artifact copy is not on Netlify, so the password does not apply to it.
- Sync works as before: the list is read once when the page opens and the latest write wins. A save that fails shows the warning icon, and a list that could not be read is never overwritten.
- On Netlify the share button tries the share sheet, then the clipboard, then saves a PNG; the save is a plain download with no confirmation step.

## Publish as a Claude Artifact

Publish `index.html` as a Claude Artifact with the `db` and `downloads` capabilities (`capabilities: { db: {}, downloads: true }`). `downloads` is how the share button saves a picture when the clipboard refuses. Anyone who can write shared data (Contributor and up) can edit the list; view-only viewers see the list and the warning icon if they try.
