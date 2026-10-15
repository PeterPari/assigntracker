// The page on an iPad: Chromium with Playwright's iPad profiles (touch, no hover, coarse pointer, iPad screen sizes).
// Taps go through the touch screen; long presses and drags are raw touch events over CDP, as a finger sends them.
// The shared database is mocked, as in e2e.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ipad, loadPlaywright, openPage } from './harness.mjs';

const { chromium } = loadPlaywright();
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

const LANDSCAPE = ipad('iPad Pro 11 landscape');
const PORTRAITS = ['iPad Pro 11', 'iPad Mini', 'iPad (gen 7)'];
const H = (h, m = 0) => h * 60 + m;
const doc = (rows, o = {}) => ({ 'tracker/list': { v: 1, times: false, chain: true, rows, ...o } });
const R = (id, name, mins, o = {}) => ({ id, name, mins, status: 0, start: null, ...o });
const S = (id, name, status = 0) => ({ id, name, status });
const ALL = { times: true, cols: { subject: true, due: true, type: true } };
const FULL_ROWS = [
  R('a', 'Essay draft for English', 150, { status: 1, start: H(12, 45), subject: 'English 11', due: '2026-10-14', type: 'Essay', subs: [S('s1', 'Outline', 2), S('s2', 'Draft')] }),
  R('b', 'Problem set', 45, { status: 2, subject: 'Calculus' }),
  R('c', 'Reading', 30),
];

async function withIpad(opts, fn) {
  const { ctx, page, errors } = await openPage(browser, { device: LANDSCAPE, ...opts });
  const cdp = await ctx.newCDPSession(page);
  try { await fn(page, fingers(page, cdp)); assert.deepEqual(errors, [], 'no console or page errors'); } finally { await ctx.close(); }
}

/** Touch input. tap() works on things that are on screen but invisible (opacity 0), as a finger would. */
function fingers(page, cdp) {
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  async function at(sel) {
    const b = await page.locator(sel).first().boundingBox();
    assert.ok(b, `${sel} has a box on screen`);
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  return {
    at,
    async tap(sel) { const { x, y } = await at(sel); await page.touchscreen.tap(x, y); await page.waitForTimeout(40); },
    /** Finger down on sel, held still for `hold` ms, then moved by dy in steps, then lifted. */
    async press(sel, { dy = 0, hold = 450, steps = 10 } = {}) {
      const { x, y } = await at(sel);
      await send('touchStart', [{ x, y }]);
      await page.waitForTimeout(hold);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ x, y: y + (dy * i) / steps }]);
        await page.waitForTimeout(16);
      }
      await send('touchEnd', []);
      await page.waitForTimeout(80);
    },
  };
}

const names = (page) => page.$$eval('.row .nmi', (els) => els.map((e) => e.value));
const subNames = (page, i) => page.$$eval(`.row:nth-child(${i}) .sni`, (els) => els.map((e) => e.value));
const statuses = (page) => page.$$eval('.row', (els) => els.map((e) => [0, 1, 2].find((k) => e.classList.contains('s' + k))));
const saved = (page) => page.evaluate(() => window.__db.store['tracker/list']);
const settle = (page) => page.waitForTimeout(650);
const opacity = (page, sel) => page.$eval(sel, (e) => getComputedStyle(e).opacity);
const shown = (page, sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity !== '0');

test('the iPad profile is what the page sees: touch, no hover, a coarse pointer', async () => {
  await withIpad({}, async (page) => {
    assert.deepEqual(await page.evaluate(() => ({
      hover: matchMedia('(hover: none)').matches, coarse: matchMedia('(pointer: coarse)').matches, touch: navigator.maxTouchPoints > 0,
    })), { hover: true, coarse: true, touch: true });
  });
});

test('every control is big enough for a finger, and every field is 16px so Safari does not zoom in on it', async () => {
  await withIpad({ initial: doc(FULL_ROWS, ALL) }, async (page, f) => {
    await f.tap('.row:nth-child(2) .nm'); // shows that row's x and caret
    await page.evaluate(() => document.activeElement.blur());
    for (const sel of ['#menu', '#reload', '#add', '#save', '#clear', '.row .st', '.row:nth-child(2) .rm', '.row:nth-child(2) .ex', '.row .sst', '.row .nm', '.row .dv', '.row .sv']) {
      const b = await page.locator(sel).first().boundingBox();
      assert.ok(b && b.height >= 36 && b.width >= 36, `${sel} is ${b && Math.round(b.width)}x${b && Math.round(b.height)}`);
    }
    const small = await page.$$eval('input', (els) => els.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.className));
    assert.deepEqual(small, [], 'fields under 16px make iOS zoom the page when they get the cursor');
    assert.equal(await page.$eval('html', (e) => getComputedStyle(e).touchAction), 'manipulation', 'no double-tap zoom');
    await f.tap('#menu');
    const b = await page.locator('#colSubject').boundingBox();
    assert.ok(b.width >= 40 && b.height >= 40);
  });
});

test('with everything on, the page never scrolls sideways, upright or sideways, on any iPad size', async () => {
  for (const device of ['iPad Pro 11 landscape', ...PORTRAITS]) {
    const { ctx, page, errors } = await openPage(browser, { device: ipad(device), initial: doc(FULL_ROWS, ALL) });
    try {
      const m = await page.evaluate(() => ({
        w: innerWidth, doc: document.documentElement.scrollWidth,
        lines: [...document.querySelectorAll('.ln')].map((l) => l.scrollWidth - l.clientWidth),
      }));
      assert.equal(m.doc, m.w, `${device}: the page is ${m.doc}px wide in a ${m.w}px window`);
      assert.ok(m.lines.every((x) => x <= 0), `${device}: a row line overflows: ${m.lines}`);
      assert.ok(await page.locator('.row .ev').first().isVisible(), `${device}: the times are on screen`);
      assert.deepEqual(errors, []);
    } finally { await ctx.close(); }
  }
});

test('tap: status cycles with quick taps, the name takes the cursor, Enter moves on, and the + adds a row', async () => {
  await withIpad({ initial: doc([R('a', 'Alpha', 30)]) }, async (page, f) => {
    await f.tap('.row .st');
    await f.tap('.row .st');
    assert.deepEqual(await statuses(page), [2], 'two quick taps are two clicks, not a zoom');
    await f.tap('.row .st');
    await f.tap('.row .nm');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmi');
    await page.keyboard.press('End');
    await page.keyboard.type(' beta');
    await page.keyboard.press('Enter');
    await f.tap('#add');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmi', 'the new row has the cursor (and the keyboard)');
    await page.keyboard.type('Gamma');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'dh');
    await page.keyboard.type('1');
    await f.tap('.row:nth-child(2) .dm'); // no Tab on the on-screen keyboard: tap minutes
    await page.keyboard.type('15');
    await page.keyboard.press('Enter');
    assert.deepEqual(await names(page), ['Alpha beta', 'Gamma']);
    assert.equal(await page.textContent('.row:nth-child(2) .dv'), '1 hr 15 min');
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => [r.name, r.mins]), [['Alpha beta', 30], ['Gamma', 75]]);
  });
});

test('the x and caret show on the row last touched; a tap where they are hidden only shows them', async () => {
  await withIpad({ initial: doc([R('a', 'Alpha', 30), R('b', 'Beta', 30)]) }, async (page, f) => {
    assert.equal(await opacity(page, '.row:nth-child(1) .rm'), '0');
    assert.equal(await opacity(page, '.row:nth-child(1) .ex'), '0');
    await f.tap('.row:nth-child(1) .rm'); // aimed at nothing visible
    assert.deepEqual(await names(page), ['Alpha', 'Beta'], 'not deleted');
    assert.equal(await opacity(page, '.row:nth-child(1) .rm'), '1', 'now it shows');
    assert.equal(await opacity(page, '.row:nth-child(1) .ex'), '1');
    await f.tap('.row:nth-child(2) .ex');
    assert.equal(await page.$eval('.row:nth-child(2)', (e) => e.classList.contains('open')), false, 'hidden caret: no toggle');
    assert.equal(await opacity(page, '.row:nth-child(1) .rm'), '0', 'touching another row moves them there');
    await f.tap('.row:nth-child(2) .rm');
    assert.deepEqual(await names(page), ['Alpha']);
    await f.tap('.row .st');
    await f.tap('#add');
    assert.equal(await opacity(page, '.row:nth-child(1) .rm'), '0', 'touching outside the rows hides them');
  });
});

test('subtasks by touch: caret opens with a draft, Enter adds the next, the + bar and the subtask x show on the touched task', async () => {
  await withIpad({ initial: doc([R('a', 'Alpha', 30), R('b', 'Beta', 30)]) }, async (page, f) => {
    await f.tap('.row:nth-child(1) .nm');
    await page.evaluate(() => document.activeElement.blur());
    await f.tap('.row:nth-child(1) .ex');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'sni');
    await page.keyboard.type('One');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Two');
    await page.evaluate(() => document.activeElement.blur()); // the keyboard's hide key
    assert.deepEqual(await subNames(page, 1), ['One', 'Two']);
    assert.equal(await shown(page, '.row:nth-child(1) .sadd'), true, 'the + bar shows on the touched task');
    assert.equal(await shown(page, '.row:nth-child(1) .srm'), true);
    await f.tap('.row:nth-child(1) .sadd');
    await page.keyboard.type('Three');
    await page.keyboard.press('Enter');
    await page.evaluate(() => document.activeElement.blur());
    assert.deepEqual(await subNames(page, 1), ['One', 'Two', 'Three']);
    await f.tap('.row:nth-child(1) .sub:nth-child(2) .srm');
    assert.deepEqual(await subNames(page, 1), ['One', 'Three']);
    await f.tap('.row:nth-child(1) .sub:nth-child(1) .sst');
    await f.tap('.row:nth-child(1) .sub:nth-child(1) .sst');
    assert.deepEqual(await statuses(page), [1, 0], 'a subtask done puts its task in progress');
    await f.tap('.row:nth-child(2) .nm');
    await page.evaluate(() => document.activeElement.blur());
    assert.equal(await shown(page, '.row:nth-child(1) .sadd'), false, 'touching another task hides the + bar');
    assert.equal(await shown(page, '.row:nth-child(1) .srm'), false);
    await settle(page);
    assert.deepEqual((await saved(page)).rows[0].subs.map((s) => [s.name, s.status]), [['One', 2], ['Three', 0]]);
  });
});

test('long press and drag reorders the rows; the page does not scroll under the finger', async () => {
  const rows = ['A', 'B', 'C', 'D'].map((n) => R(n.toLowerCase(), n, 30));
  await withIpad({ initial: doc(rows) }, async (page, f) => {
    const h = (await page.locator('.row').first().boundingBox()).height;
    await f.press('.row:nth-child(1) .nm', { dy: h * 2 + 10 });
    assert.deepEqual(await names(page), ['B', 'C', 'A', 'D']);
    assert.equal(await page.evaluate(() => scrollY), 0);
    await f.press('.row:nth-child(4) .st', { dy: -(h * 3 + 12) }); // from the status button: a drag, never a status change
    assert.deepEqual(await names(page), ['D', 'B', 'C', 'A']);
    assert.deepEqual(await statuses(page), [0, 0, 0, 0]);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.row.drag').length), 0);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => r.name), ['D', 'B', 'C', 'A']);
  });
});

test('a long press without moving does nothing, not even the tap under it', async () => {
  await withIpad({ initial: doc([R('a', 'A', 30), R('b', 'B', 30)]) }, async (page, f) => {
    await f.press('.row:nth-child(1) .st', { hold: 600, steps: 0 });
    assert.deepEqual(await statuses(page), [0, 0]);
    assert.deepEqual(await names(page), ['A', 'B']);
    await f.tap('.row:nth-child(1) .st');
    assert.deepEqual(await statuses(page), [1, 0], 'the next tap works');
  });
});

test('a quick swipe over the rows scrolls the page and reorders nothing', async () => {
  const rows = Array.from({ length: 30 }, (_, i) => R('r' + i, 'Row ' + i, 30));
  await withIpad({ initial: doc(rows) }, async (page, f) => {
    await f.press('.row:nth-child(8) .nm', { dy: -300, hold: 0, steps: 12 });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => scrollY) > 50, 'the page scrolled');
    assert.deepEqual(await names(page), rows.map((r) => r.name));
    assert.equal(await page.evaluate(() => document.querySelectorAll('.row.drag').length), 0);
  });
});

test('long press and drag reorders subtasks inside their task', async () => {
  await withIpad({ initial: doc([R('a', 'A', 30, { subs: [S('x', 'X'), S('y', 'Y'), S('z', 'Z')] })]) }, async (page, f) => {
    const h = (await page.locator('.sub').first().boundingBox()).height;
    await f.press('.sub:nth-child(1) .snm', { dy: h * 2 + 6 });
    assert.deepEqual(await subNames(page, 1), ['Y', 'Z', 'X']);
  });
});

test('AM/PM: a tap keeps the time being edited, even when the field loses the cursor as it does in Safari', async () => {
  await withIpad({ initial: doc([R('a', 'a', 30, { start: H(9) })], { times: true }) }, async (page, f) => {
    await f.tap('.row .sc');
    assert.equal(await page.locator('.row .sh').isVisible(), true);
    await f.tap('.row .sa');
    assert.equal(await page.textContent('.row .sa'), 'PM');
    assert.ok(await page.evaluate(() => document.activeElement.closest('.se') !== null), 'the cursor stays in the time');
    // Safari: the tap blurs the field (no relatedTarget) before the click arrives
    await page.evaluate(() => {
      const sa = document.querySelector('.row .sa');
      sa.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      document.activeElement.blur();
    });
    assert.equal(await page.locator('.row .sh').isVisible(), true, 'still editing after the blur');
    await page.click('.row .sa');
    assert.equal(await page.textContent('.row .sa'), 'AM');
    await f.tap('.row .sa');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'sn', 'the cursor came back to the minutes');
    await page.keyboard.press('Enter');
    assert.equal(await page.textContent('.row .sv'), '9:00 PM');
  });
});

test('the menu works by touch and has a download button for the saves (no Shift key on an iPad)', async () => {
  const save = { v: 1, k: '001791504903000-aaaaaa', at: '2026-10-07 22:15:03', rows: [{ id: 'a', name: 'Essay', subject: '', type: '', due: null, status: 2, mins: 60, start: null, end: null }] };
  await withIpad({ initial: { ...doc([R('a', 'Essay', 60, { status: 2 })]), ['saves/' + save.k]: save } }, async (page, f) => {
    await f.tap('#menu');
    assert.equal(await page.locator('#menuPop').isVisible(), true);
    await f.tap('#colSubject');
    assert.equal(await page.locator('.row .cs').isVisible(), true, 'the menu stays open and the toggle works');
    assert.equal(await page.locator('#dlSaves').isVisible(), true);
    await f.tap('#dlSaves');
    await page.waitForTimeout(150);
    assert.equal(await page.locator('#menuPop').isVisible(), false, 'the menu closes');
    const dl = await page.evaluate(() => window.__db.downloads.map((d) => d.filename));
    assert.equal(dl.length, 1);
    assert.match(dl[0], /^assignment-saves-\d{4}-\d{2}-\d{2}\.csv$/);
    assert.equal(await page.getAttribute('#save', 'aria-label'), 'Downloaded');
    await f.tap('.row .st'); // tap outside closes nothing left open
  });
});

test('on a desktop the menu has no download button (Shift-click on save does it)', async () => {
  const { ctx, page } = await openPage(browser, {});
  try {
    await page.click('#menu');
    assert.equal(await page.locator('#dlSaves').isVisible(), false);
    assert.equal(await page.locator('#menuPop .msep.tonly').isVisible(), false);
  } finally { await ctx.close(); }
});

test('save, its repeat popup, clear and the all-done popup work by touch', async () => {
  const prior = { v: 1, k: '001791504903000-aaaaaa', at: '2026-10-07 22:15:03', rows: [{ id: 'a', name: 'A', status: 2, mins: 30 }] };
  await withIpad({ initial: { ...doc([R('a', 'A', 30, { status: 2 }), R('b', 'B', 30, { status: 1 })]), ['saves/' + prior.k]: prior } }, async (page, f) => {
    await f.tap('#save');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#again').isVisible(), true, 'asks about the repeat');
    const a = (await page.locator('#againYes').boundingBox());
    assert.ok(a.width >= 40 && a.height >= 40);
    await f.tap('#againNo');
    await page.waitForTimeout(100);
    assert.equal(await page.getAttribute('#save', 'aria-label'), 'Saved');
    await f.tap('.row:nth-child(2) .st');
    assert.equal(await page.locator('#done').isVisible(), true, 'all done');
    await f.tap('#doneClose');
    assert.equal(await page.locator('#done').isVisible(), false);
    await f.tap('#clear');
    assert.equal(await page.$eval('#clear', (e) => e.classList.contains('armed')), true);
    await f.tap('#clear');
    assert.equal(await page.locator('.row').count(), 0);
  });
});

test('the chaining question works by touch', async () => {
  await withIpad({ initial: doc([R('a', 'a', 30, { start: H(9) }), R('b', 'b', 30)], { times: true }) }, async (page, f) => {
    await f.tap('.row:nth-child(2) .sc');
    await page.keyboard.type('10:00');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.row:nth-child(2) .pop').isVisible(), true);
    const b = await page.locator('.row:nth-child(2) .pc').boundingBox();
    assert.ok(b.x >= 0 && b.width >= 40, 'the popup is on screen and big enough');
    await f.tap('.row:nth-child(2) .pc');
    assert.deepEqual(await page.$$eval('.row .sv', (e) => e.map((x) => x.textContent)), ['9:00 AM', '10:00 AM']);
  });
});

test('due date by touch: the date field takes a date and clearing it removes it', async () => {
  await withIpad({ initial: doc([R('a', 'a', 30)], { cols: { subject: false, due: true, type: false } }) }, async (page) => {
    await page.fill('.row .ddi', '2026-11-02');
    await settle(page);
    assert.equal((await saved(page)).rows[0].due, '2026-11-02');
    await page.fill('.row .ddi', '');
    await settle(page);
    assert.equal((await saved(page)).rows[0].due, null);
  });
});
