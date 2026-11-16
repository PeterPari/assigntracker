// The page on an iPhone 17 (base model), held upright: Chromium with an iPhone profile at the iPhone 17's 402 x 874 screen.
// Taps go through the touch screen; long presses and drags are raw touch events over CDP, as in ipad.test.mjs.
// The shared database is mocked, as in e2e.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fingers, iphone17, ipad, loadPlaywright, openPage } from './harness.mjs';

const { chromium } = loadPlaywright();
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

const PHONE = iphone17();
const PHONE_QUERY = '(pointer: coarse) and (max-width: 500px)';
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
const MANY = (n) => Array.from({ length: n }, (_, i) => R('r' + i, 'Row ' + i, 30));

async function withPhone(opts, fn) {
  const { ctx, page, errors } = await openPage(browser, { device: PHONE, ...opts });
  const cdp = await ctx.newCDPSession(page);
  try { await fn(page, fingers(page, cdp), cdp); assert.deepEqual(errors, [], 'no console or page errors'); } finally { await ctx.close(); }
}

const names = (page) => page.$$eval('.row .nmi', (els) => els.map((e) => e.value));
const subNames = (page, i) => page.$$eval(`.row:nth-child(${i}) .sni`, (els) => els.map((e) => e.value));
const statuses = (page) => page.$$eval('.row', (els) => els.map((e) => [0, 1, 2].find((k) => e.classList.contains('s' + k))));
const saved = (page) => page.evaluate(() => window.__db.store['tracker/list']);
const settle = (page) => page.waitForTimeout(650);
const opacity = (page, sel) => page.$eval(sel, (e) => getComputedStyle(e).opacity);
const shown = (page, sel) => page.$eval(sel, (e) => getComputedStyle(e).display !== 'none' && getComputedStyle(e).opacity !== '0');
const box = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); assert.ok(b, `${sel} has a box`); return b; };
const layout = (page) => page.evaluate(() => ({ ln: getComputedStyle(document.querySelector('.ln')).display, mt: getComputedStyle(document.querySelector('.mt')).display }));

test('the iPhone 17 gets the phone layout, and the desktop and the iPad keep theirs', async () => {
  await withPhone({ initial: doc([R('a', 'A', 30)]) }, async (page) => {
    assert.equal(await page.evaluate((q) => matchMedia(q).matches, PHONE_QUERY), true);
    assert.equal(await page.evaluate(() => innerWidth), 402);
    assert.deepEqual(await layout(page), { ln: 'grid', mt: 'flex' });
  });
  for (const device of [undefined, ipad('iPad Mini'), ipad('iPad Pro 11 landscape')]) {
    const { ctx, page } = await openPage(browser, { device, initial: doc([R('a', 'A', 30)]) });
    try {
      assert.equal(await page.evaluate((q) => matchMedia(q).matches, PHONE_QUERY), false);
      assert.deepEqual(await layout(page), { ln: 'flex', mt: 'contents' });
    } finally { await ctx.close(); }
  }
});

test('each task is a card: the name has the first line, the chips wrap under it, and nothing runs off the screen', async () => {
  await withPhone({ initial: doc(FULL_ROWS, ALL) }, async (page) => {
    const m = await page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
      const vis = (e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
      return {
        w: innerWidth, doc: document.documentElement.scrollWidth,
        rows: [...document.querySelectorAll('.row')].map((row) => ({
          card: r(row), nm: r(row.querySelector('.nm')), mt: r(row.querySelector('.mt')),
          du: r(row.querySelector('.du')), tm: r(row.querySelector('.tm')),
          chips: [...row.querySelectorAll('.mt > *')].filter(vis).map(r),
        })),
      };
    });
    assert.equal(m.doc, m.w, 'no sideways scroll');
    for (const [i, x] of m.rows.entries()) {
      assert.ok(Math.abs(x.card.l - 16) < 1 && Math.abs(x.card.r - 386) < 1, `card ${i} spans the screen less its margins`);
      assert.ok(x.mt.t >= x.nm.b - 1, `card ${i}: the chips are under the name`);
      for (const c of x.chips) {
        assert.ok(c.l >= x.nm.l - 1 && c.r <= x.card.r - 3, `card ${i}: a chip runs outside its card`);
        assert.ok(c.t >= x.du.t - 1, `card ${i}: the duration is the first chip`);
      }
      assert.ok(Math.abs(x.du.l - x.nm.l) < 1, `card ${i}: the duration starts under the name`);
      assert.ok(x.tm.t >= x.du.b, `card ${i}: the times have a line of their own`);
      assert.ok(Math.abs(x.tm.l - x.du.l) < 1, `card ${i}: the times line up with the duration`);
    }
    assert.ok(m.rows[1].nm.w >= 200, `the name is ${m.rows[1].nm.w}px wide`);
  });
});

test('every control is big enough for a thumb, and every field is 16px so Safari does not zoom in on it', async () => {
  await withPhone({ initial: doc(FULL_ROWS, ALL) }, async (page, f) => {
    await f.tap('.row:nth-child(2) .nm');
    await page.evaluate(() => document.activeElement.blur());
    for (const sel of ['#menu', '#reload', '#add', '#save', '#clear', '.row .st', '.row:nth-child(2) .rm', '.row:nth-child(2) .ex']) {
      const b = await box(page, sel);
      assert.ok(b.height >= 40 && b.width >= 40, `${sel} is ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    const sst = await box(page, '.row .sst');
    assert.ok(sst.width >= 36 && sst.height >= 36, 'a subtask status is 36px, as on the iPad');
    for (const sel of ['.row .dv', '.row .sv', '.row .tf', '.row .ddi']) assert.ok((await box(page, sel)).height >= 34, `${sel} is a 34px chip`);
    const small = await page.$$eval('input', (els) => els.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.className));
    assert.deepEqual(small, []);
    assert.equal(await page.$eval('html', (e) => getComputedStyle(e).touchAction), 'manipulation');
  });
});

test('the dock: add, save and trash sit in a row at the bottom, stay put, and the last card scrolls clear of them', async () => {
  await withPhone({ initial: doc(MANY(30)) }, async (page) => {
    const dock = () => Promise.all(['#add', '#save', '#clear'].map((s) => box(page, s)));
    const [a, s, c] = await dock();
    for (const b of [a, s, c]) assert.ok(Math.abs(b.y + b.height - (a.y + a.height)) < 1 && b.height >= 52, 'one row, 52px tall');
    assert.ok(a.y + a.height <= 874 - 10 + 0.5, 'clear of the bottom edge');
    assert.ok(a.x >= 16 - 0.5 && a.x + a.width < s.x && s.x + s.width < c.x, 'add, save, trash in that order');
    assert.ok(Math.abs(c.x + c.width - 386) < 1, 'trash at the right margin');
    assert.ok(a.width > 200, 'add is the wide one');
    await page.evaluate(() => scrollTo(0, 1e6));
    await page.waitForTimeout(50);
    assert.deepEqual(await dock(), [a, s, c], 'fixed while the page scrolls');
    const last = await box(page, '.row:last-child');
    assert.ok(last.y + last.height <= s.y - 8, 'the last card scrolls clear of the dock');
    const under = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y).closest('.row'), { x: a.x + a.width + 4, y: a.y + a.height / 2 });
    assert.equal(under, false, 'a tap between the dock buttons never reaches a card');
  });
});

test('the dock steps aside while a field has the cursor', async () => {
  await withPhone({ initial: doc([R('a', 'A', 30)]) }, async (page, f) => {
    const vis = () => page.$$eval('#add, #save, #clear', (els) => els.map((e) => getComputedStyle(e).visibility));
    assert.deepEqual(await vis(), ['visible', 'visible', 'visible']);
    await f.tap('.row .nm');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmi');
    assert.deepEqual(await vis(), ['hidden', 'hidden', 'hidden']);
    await page.evaluate(() => document.activeElement.blur());
    assert.deepEqual(await vis(), ['visible', 'visible', 'visible']);
  });
});

test('+ in the dock: a new card with the cursor, in view; Enter moves to the duration; the keyboard\'s Done commits', async () => {
  await withPhone({ initial: doc(MANY(12)) }, async (page, f) => {
    await f.tap('#add');
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.row:nth-child(13) .nmi')), true);
    const b = await box(page, '.row:nth-child(13)');
    assert.ok(b.y + b.height <= 874 - 72, 'the new card is above where the dock was');
    assert.equal(await page.getAttribute('.row:nth-child(13) .nmi', 'enterkeyhint'), 'next');
    await page.keyboard.type('Essay');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'dh');
    await page.keyboard.type('1');
    await f.tap('.row:nth-child(13) .dm');
    await page.keyboard.type('30');
    await page.evaluate(() => document.activeElement.blur()); // the keyboard bar's Done
    assert.equal(await page.textContent('.row:nth-child(13) .dv'), '1 hr 30 min');
    await settle(page);
    assert.deepEqual((await saved(page)).rows.at(-1).name, 'Essay');
    assert.deepEqual((await saved(page)).rows.at(-1).mins, 90);
  });
});

test('the x and caret show on the card last touched, at its top right; a tap where they are hidden only shows them', async () => {
  await withPhone({ initial: doc([R('a', 'Alpha', 30), R('b', 'Beta', 30)]) }, async (page, f) => {
    assert.equal(await opacity(page, '.row:nth-child(1) .rm'), '0');
    await f.tap('.row:nth-child(1) .rm');
    assert.deepEqual(await names(page), ['Alpha', 'Beta'], 'not deleted');
    assert.equal(await opacity(page, '.row:nth-child(1) .rm'), '1');
    assert.equal(await opacity(page, '.row:nth-child(1) .ex'), '1');
    const card = await box(page, '.row:nth-child(1)'), rm = await box(page, '.row:nth-child(1) .rm');
    assert.ok(Math.abs(rm.x + rm.width - (card.x + card.width - 4)) < 1 && Math.abs(rm.y - (card.y + 6)) < 1, 'top right of the card');
    await f.tap('.row:nth-child(2) .rm');
    assert.equal(await opacity(page, '.row:nth-child(1) .rm'), '0', 'touching another card moves them there');
    await f.tap('.row:nth-child(2) .rm');
    assert.deepEqual(await names(page), ['Alpha']);
  });
});

test('long press and drag reorders the cards; the page does not scroll under the finger', async () => {
  await withPhone({ initial: doc(['A', 'B', 'C', 'D'].map((n) => R(n.toLowerCase(), n, 30))) }, async (page, f) => {
    const h = (await box(page, '.row')).height + 8;
    await f.press('.row:nth-child(1) .nm', { dy: h * 2 + 10 });
    assert.deepEqual(await names(page), ['B', 'C', 'A', 'D']);
    assert.equal(await page.evaluate(() => scrollY), 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.row.drag').length), 0);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => r.name), ['B', 'C', 'A', 'D']);
  });
});

test('dragging a card down to the dock scrolls the page', async () => {
  await withPhone({ initial: doc(MANY(30)) }, async (page, f, cdp) => {
    const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const { x, y } = await f.at('.row:nth-child(3) .nm');
    const dockTop = (await box(page, '#save')).y;
    await send('touchStart', [{ x, y }]);
    await page.waitForTimeout(450);
    for (let i = 1; i <= 10; i++) { await send('touchMove', [{ x, y: y + ((dockTop - 10 - y) * i) / 10 }]); await page.waitForTimeout(16); }
    await page.waitForTimeout(500);
    assert.ok(await page.evaluate(() => scrollY) > 0, 'the page scrolled under the dragged card');
    await send('touchEnd', []);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.row.drag').length), 0);
  });
});

test('subtasks on a phone: under the name, inside the card; the caret, Enter, the + bar and the x work by touch', async () => {
  await withPhone({ initial: doc([R('a', 'Alpha', 30), R('b', 'Beta', 30)]) }, async (page, f) => {
    await f.tap('.row:nth-child(1) .nm');
    await page.evaluate(() => document.activeElement.blur());
    await f.tap('.row:nth-child(1) .ex');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'sni');
    assert.equal(await page.getAttribute('.row .sni', 'enterkeyhint'), 'next');
    await page.keyboard.type('One');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Two');
    await page.evaluate(() => document.activeElement.blur());
    assert.deepEqual(await subNames(page, 1), ['One', 'Two']);
    const card = await box(page, '.row:nth-child(1)'), st = await box(page, '.row:nth-child(1) .st');
    for (const sel of ['.sub:nth-child(1) .sst', '.sub:nth-child(2) .srm', '.sadd']) {
      const b = await box(page, '.row:nth-child(1) ' + sel);
      assert.ok(b.x >= st.x + st.width - 1 && b.x + b.width <= card.x + card.width && b.y + b.height <= card.y + card.height, `${sel} sits inside the card, under the name`);
    }
    assert.equal(await shown(page, '.row:nth-child(1) .sadd'), true);
    await f.tap('.row:nth-child(1) .sub:nth-child(1) .srm');
    assert.deepEqual(await subNames(page, 1), ['Two']);
    await f.tap('.row:nth-child(1) .sub:nth-child(1) .sst');
    assert.deepEqual(await statuses(page), [1, 0]);
  });
});

test('the chaining question opens under the start time, on screen', async () => {
  await withPhone({ initial: doc([R('a', 'a', 30, { start: H(9) }), R('b', 'b', 30)], { times: true }) }, async (page, f) => {
    await f.tap('.row:nth-child(2) .sc');
    await page.keyboard.type('10:00');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.row:nth-child(2) .pop').isVisible(), true);
    const pop = await box(page, '.row:nth-child(2) .pop'), sc = await box(page, '.row:nth-child(2) .sc');
    assert.ok(pop.x >= 0 && pop.x + pop.width <= 402, 'on screen');
    assert.ok(pop.y >= sc.y + sc.height, 'under the start');
    assert.ok((await box(page, '.row:nth-child(2) .pc')).width >= 40);
    await f.tap('.row:nth-child(2) .pc');
    assert.deepEqual(await page.$$eval('.row .sv', (e) => e.map((x) => x.textContent)), ['9:00 AM', '10:00 AM']);
  });
});

test('the save-again question fits the screen above the dock', async () => {
  const prior = { v: 1, k: '001791504903000-aaaaaa', at: '2026-10-07 22:15:03', rows: [{ id: 'a', name: 'A', status: 2, mins: 30 }] };
  await withPhone({ initial: { ...doc([R('a', 'A', 30, { status: 2 }), R('c', 'C', 30, { status: 2 })]), ['saves/' + prior.k]: prior } }, async (page, f) => {
    await f.tap('#save');
    await page.waitForTimeout(100);
    assert.equal(await page.locator('#again').isVisible(), true);
    const ag = await box(page, '#again'), sav = await box(page, '#save');
    assert.ok(Math.abs(ag.x - 16) < 1 && Math.abs(ag.x + ag.width - 386) < 1, 'the width of the screen less its margins');
    assert.ok(ag.y + ag.height <= sav.y, 'above the save button');
    const yes = await box(page, '#againYes');
    assert.ok(yes.width >= 40 && yes.height >= 40);
    await f.tap('#againNo');
    await page.waitForTimeout(100);
    assert.equal(await page.getAttribute('#save', 'aria-label'), 'Saved');
  });
});

test('an empty due date says Due date; a date replaces it', async () => {
  await withPhone({ initial: doc([R('a', 'a', 30)], { cols: { subject: false, due: true, type: false } }) }, async (page) => {
    const ph = () => page.$eval('.row .cd', (e) => getComputedStyle(e, '::after').content);
    assert.equal(await ph(), '"Due date"');
    await page.fill('.row .ddi', '2026-11-02');
    await page.evaluate(() => document.activeElement.blur());
    assert.equal(await ph(), 'none');
    assert.notEqual(await page.$eval('.row .ddi', (e) => getComputedStyle(e).color), 'rgba(0, 0, 0, 0)');
    await settle(page);
    assert.equal((await saved(page)).rows[0].due, '2026-11-02');
    await page.fill('.row .ddi', '');
    await page.evaluate(() => document.activeElement.blur());
    assert.equal(await ph(), '"Due date"');
    await settle(page);
    assert.equal((await saved(page)).rows[0].due, null);
  });
});

test('the menu, the all-done popup and clear work on the phone and stay on screen', async () => {
  await withPhone({ initial: doc([R('a', 'A', 30, { status: 2 }), R('b', 'B', 30, { status: 1 })]) }, async (page, f) => {
    await f.tap('#menu');
    const mp = await box(page, '#menuPop');
    assert.ok(mp.x >= 0 && mp.x + mp.width <= 402);
    assert.equal(await page.locator('#dlSaves').isVisible(), true);
    await f.tap('#colSubject');
    assert.equal(await page.locator('.row .cs').first().isVisible(), true);
    await f.tap('.row:nth-child(2) .st');
    assert.equal(await page.locator('#done').isVisible(), true);
    const dlg = await box(page, '#done .dlg');
    assert.ok(dlg.x >= 0 && dlg.x + dlg.width <= 402);
    await f.tap('#doneClose');
    assert.equal(await page.locator('#done').isVisible(), false);
    await f.tap('#clear');
    await f.tap('#clear');
    assert.equal(await page.locator('.row').count(), 0);
  });
});
