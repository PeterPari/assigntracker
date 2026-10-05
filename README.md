# Assignment Tracker

A one-page assignment tracker with a shared list, a progress bar, optional start and end times, and drag to reorder. It is a single self-contained HTML file (`index.html`), published as a Claude Artifact. Dark theme, system sans-serif, desktop only.

The page shows no words. Everything is an icon except placeholders, units (`hr`, `hrs`, `min`), clock text (`AM`, `PM`), the percentage in the progress bar, and tooltips. Tooltips appear after a long hover (800 ms).

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
| Chaining | Link toggle, on by default, shown while times are on. On: only the first row's start is entered, every lower start is the previous end, and with no first start every start and end is blank. Editing a lower start asks first (warning icon, confirm, cancel); confirm turns chaining off. Off: every row uses only its own entered start, and a row with no start has a blank end. Turning chaining on again discards every lower row's own start. |
| End time on done | Marking a row done while times are shown fills its end with the current time: the duration becomes start-to-now, so chained rows below, progress and the saved list follow. |
| End correction | Once a row is done, click its end time to correct it (hour, minute, AM/PM). The new end sets the real duration (end minus start, wrapping past midnight), so chained rows below, progress, and the saved list all follow. Not editable before the row is done, or when the row has no start. |
| Recalculation | Reordering, deleting, or editing a duration recalculates chained times. The first start stays in the first slot. |

### Choices where the brief was silent

- Inline edits commit on blur as well as on Enter. Esc always cancels.
- A finished row can't lose its name or duration; an empty commit restores the old value.
- An unfinished row stays on screen so it can be completed, is never saved, and isn't counted in progress. Pressing `+` while one exists focuses it instead of adding another.
- Start times are typed as hour, minute and an AM/PM button. `:` or two digits move to minutes; `a` and `p` set AM/PM; 13–23 read as 24-hour.
- Marking done fills the end only when times are shown and the row has a start. If the start is more than 12 hours ahead of the current time (finished early), the planned duration is kept. Un-marking a row keeps the recorded duration; finishing it again records the new time.
- Editing a done row's end changes its duration, never its start. An end equal to the start, or an empty one, is ignored.
- Turning chaining off keeps only starts that were entered. Computed starts are not copied into the rows.
- The armed trash disarms after 4 seconds, on any other click, or on Esc.
- The `Times` and `Chaining` toggles are saved with the list, so every viewer sees the same setup.
- A small warning icon appears in the header only when the list could not be saved or loaded (no database, view-only access, or a failed write).

## Data

One document in the artifact database, `tracker/list`:

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
- `start` is minutes since midnight, or `null`. When `chain` is true only `rows[0].start` is used.
- The list is read once when the page opens. There is no live sync: the latest write wins, and a viewer sees other people's changes after reopening the page.
- Writes are debounced, sent one at a time, and skipped when nothing changed. If the list could not be read, the page never writes over it. Edits made before the list arrives are merged in.

## Drag and drop

Vanilla Pointer Events, no library. The list is small and uniform, so about 60 lines cover it: no download, nothing blocked by the artifact CSP, and full control over the click-versus-drag line so inline editing keeps working. Rows slide aside while you drag, the page scrolls near the window edge, and the drop animates with FLIP.

## Files

```
index.html            the page (artifact source: <title>, <style>, markup, <script>)
tests/logic.test.mjs  unit tests for the pure logic block (formatting, schedule, progress, reorder, storage)
tests/e2e.test.mjs    Chromium tests for every feature, with the database mocked
tests/harness.mjs     wraps index.html like the publisher does and provides the mock database
```

The script keeps all pure logic between `/* <logic> */` and `/* </logic> */`, which is what the unit tests load.

## Run the tests

```
npm install        # playwright; a global install also works
npm test
```

Chromium is expected at the Playwright default location (`PLAYWRIGHT_BROWSERS_PATH`). Set `PLAYWRIGHT_PATH` if Playwright is installed somewhere unusual.

## Publish

Publish `index.html` as a Claude Artifact with the `db` capability (`capabilities: { db: {} }`). Anyone who can write shared data (Contributor and up) can edit the list; view-only viewers see the list and the warning icon if they try.
