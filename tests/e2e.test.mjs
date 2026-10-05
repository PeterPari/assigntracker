// End-to-end tests in real Chromium. The shared database is mocked (see harness.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaywright, openPage } from './harness.mjs';

const { chromium } = loadPlaywright();
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser.close(); });

const H = (h, m = 0) => h * 60 + m;
const doc = (rows, o = {}) => ({ 'tracker/list': { v: 1, times: false, chain: true, rows, ...o } });
const R = (id, name, mins, o = {}) => ({ id, name, mins, status: 0, start: null, ...o });

async function withPage(opts, fn) {
  const { ctx, page, errors } = await openPage(browser, opts);
  try { await fn(page); assert.deepEqual(errors, [], 'no console or page errors'); } finally { await ctx.close(); }
}
const rowsText = (page, sel) => page.$$eval('.row', (els, s) => els.map((e) => e.querySelector(s).textContent.trim()), sel);
const names = (page) => page.$$eval('.row .nmi', (els) => els.map((e) => e.value));
const saved = (page) => page.evaluate(() => window.__db.store['tracker/list']);
const settle = (page) => page.waitForTimeout(650); // debounce + write
const pct = (page) => page.textContent('#pct');

async function addRow(page, name, h, m) {
  await page.click('#add');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  if (h) await page.keyboard.type(String(h));
  await page.keyboard.press('Tab');
  if (m) await page.keyboard.type(String(m));
  await page.keyboard.press('Enter');
}

test('opens empty: 0% bar, add button, no rows', async () => {
  await withPage({}, async (page) => {
    assert.equal(await pct(page), '0%');
    assert.equal(await page.locator('.row').count(), 0);
    assert.equal(await page.locator('#add').isVisible(), true);
    assert.equal(await page.locator('#times').isVisible(), true);
    assert.equal(await page.locator('#chain').isVisible(), false, 'chaining toggle only matters while times are shown');
  });
});

test('+ adds a row at the bottom; Enter moves name -> duration; row shows formatted duration', async () => {
  await withPage({ initial: doc([R('a', 'First', 30)]) }, async (page) => {
    await page.click('#add');
    assert.equal(await page.locator('.row').count(), 2);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmi');
    assert.equal(await page.getAttribute('.row:last-child .nmi', 'placeholder'), 'Assignment');
    await page.keyboard.type('Second');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'dh', 'focus moves to hours');
    await page.keyboard.type('2');
    await page.keyboard.press('Tab');
    await page.keyboard.type('30');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.dv'), ['30 min', '2 hrs 30 min']);
    assert.deepEqual(await names(page), ['First', 'Second']);
    await settle(page);
    const s = await saved(page);
    assert.deepEqual(s.rows.map((r) => [r.name, r.mins]), [['First', 30], ['Second', 150]]);
  });
});

test('a row needs both name and duration: unfinished rows are not saved or counted', async () => {
  await withPage({ initial: doc([R('a', 'First', 60)]) }, async (page) => {
    await page.click('#add');
    await page.keyboard.type('No duration yet');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape'); // leave hours empty
    await settle(page);
    assert.equal(await page.locator('.row').count(), 2, 'draft row stays so it can be finished');
    assert.deepEqual((await saved(page)).rows.map((r) => r.id), ['a'], 'draft is not stored');
    await page.click('.row:last-child .st');
    await page.click('.row:last-child .st'); // done
    assert.equal(await pct(page), '0%', 'draft is not counted');
    await page.click('#add'); // does not pile up a second draft
    assert.equal(await page.locator('.row').count(), 2);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'dh');
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => [r.name, r.mins, r.status]), [['First', 60, 0], ['No duration yet', 60, 2]]);
  });
});

test('a finished row cannot lose its name or duration', async () => {
  await withPage({ initial: doc([R('a', 'Keep me', 45)]) }, async (page) => {
    await page.click('.row .nm');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Enter');
    assert.deepEqual(await names(page), ['Keep me']);
    await page.click('.row .dv');
    await page.fill('.row .dh', '');
    await page.fill('.row .dm', '');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.dv'), ['45 min']);
  });
});

test('name: click edits inline, Esc cancels, Enter commits', async () => {
  await withPage({ initial: doc([R('a', 'Alpha', 30)]) }, async (page) => {
    await page.click('.row .nm');
    await page.keyboard.press('End');
    await page.keyboard.type(' beta');
    await page.keyboard.press('Escape');
    assert.deepEqual(await names(page), ['Alpha']);
    await page.click('.row .nm');
    await page.keyboard.press('End');
    await page.keyboard.type(' beta');
    await page.keyboard.press('Enter');
    assert.deepEqual(await names(page), ['Alpha beta']);
    await settle(page);
    assert.equal((await saved(page)).rows[0].name, 'Alpha beta');
  });
});

test('duration: both fields while editing, the empty one disappears after commit, Esc cancels', async () => {
  await withPage({ initial: doc([R('a', 'Alpha', 150)]) }, async (page) => {
    await page.click('.row .dv');
    assert.equal(await page.locator('.row .dh').isVisible(), true);
    assert.equal(await page.locator('.row .dm').isVisible(), true);
    assert.equal(await page.inputValue('.row .dh'), '2');
    assert.equal(await page.inputValue('.row .dm'), '30');
    assert.equal(await page.locator('.row .dv').isVisible(), false);
    await page.fill('.row .dh', '9');
    await page.keyboard.press('Escape');
    assert.deepEqual(await rowsText(page, '.dv'), ['2 hrs 30 min']);
    const cases = [['1', '0', '1 hr'], ['2', '', '2 hrs'], ['', '30', '30 min'], ['', '45', '45 min'], ['', '90', '1 hr 30 min'], ['0', '120', '2 hrs']];
    for (const [h, m, want] of cases) {
      await page.click('.row .dv');
      await page.fill('.row .dh', h);
      await page.fill('.row .dm', m);
      await page.keyboard.press('Enter');
      assert.deepEqual(await rowsText(page, '.dv'), [want], `${h}/${m}`);
      assert.equal(await page.locator('.row .dh').isVisible(), false, 'editor closed');
    }
    await settle(page);
    assert.equal((await saved(page)).rows[0].mins, 120);
  });
});

test('duration commits when focus leaves both fields, not when moving between them', async () => {
  await withPage({ initial: doc([R('a', 'Alpha', 30)]) }, async (page) => {
    await page.click('.row .dv');
    await page.fill('.row .dh', '1');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.row .dm').isVisible(), true, 'still editing');
    await page.mouse.click(600, 500);
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr 30 min']);
  });
});

test('status: click cycles not started -> in progress -> done -> not started with colors', async () => {
  await withPage({ initial: doc([R('a', 'Alpha', 30)]) }, async (page) => {
    const color = () => page.$eval('.row .st', (e) => getComputedStyle(e).color);
    const tip = () => page.getAttribute('.row .st', 'data-tip');
    assert.equal(await tip(), 'Not started');
    assert.equal(await color(), 'rgb(138, 146, 160)');
    await page.click('.row .st');
    assert.equal(await tip(), 'In progress');
    assert.equal(await color(), 'rgb(242, 201, 76)');
    await page.click('.row .st');
    assert.equal(await tip(), 'Done');
    assert.equal(await color(), 'rgb(76, 195, 138)');
    await page.click('.row .st');
    assert.equal(await tip(), 'Not started');
    await settle(page);
    assert.equal((await saved(page)).rows[0].status, 0);
  });
});

test('done rows are dimmed with a green tint, no strikethrough, and stay in place', async () => {
  await withPage({ initial: doc([R('a', 'One', 30), R('b', 'Two', 30, { status: 2 }), R('c', 'Three', 30)]) }, async (page) => {
    const info = await page.$eval('.row:nth-child(2)', (e) => {
      const cs = getComputedStyle(e), nm = getComputedStyle(e.querySelector('.nmi'));
      return { bg: cs.backgroundColor, deco: nm.textDecorationLine, color: nm.color };
    });
    assert.match(info.bg, /rgba\(76, 195, 138, 0\.07/);
    assert.equal(info.deco, 'none');
    assert.notEqual(info.color, await page.$eval('.row:nth-child(1) .nmi', (e) => getComputedStyle(e).color), 'text is dimmed');
    assert.deepEqual(await names(page), ['One', 'Two', 'Three']);
    await page.click('.row:nth-child(1) .st');
    await page.click('.row:nth-child(1) .st');
    assert.deepEqual(await names(page), ['One', 'Two', 'Three'], 'order unchanged after marking done');
  });
});

test('delete: x only shows on hover and removes the row', async () => {
  await withPage({ initial: doc([R('a', 'One', 30), R('b', 'Two', 30)]) }, async (page) => {
    const op = () => page.$eval('.row:nth-child(1) .rm', (e) => getComputedStyle(e).opacity);
    await page.mouse.move(600, 400);
    assert.equal(await op(), '0');
    await page.hover('.row:nth-child(1)');
    assert.equal(await op(), '1');
    await page.click('.row:nth-child(1) .rm');
    assert.deepEqual(await names(page), ['Two']);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => r.id), ['b']);
  });
});

test('progress: half of done-rows share plus half of done-minutes share, inside the bar', async () => {
  const rows = [R('a', 'a', 90, { status: 2 }), R('b', 'b', 150, { status: 1 }), R('c', 'c', 45), R('d', 'd', 30)];
  await withPage({ initial: doc(rows) }, async (page) => {
    assert.equal(await pct(page), '27%');
    const w = await page.$eval('#fill', (e) => e.style.width);
    assert.equal(w, '27%');
    const inside = await page.evaluate(() => {
      const b = document.querySelector('#bar').getBoundingClientRect(), p = document.querySelector('#pct').getBoundingClientRect();
      return p.top >= b.top && p.bottom <= b.bottom && p.left >= b.left && p.right <= b.right && b.height >= 20;
    });
    assert.equal(inside, true);
    await page.click('.row:nth-child(2) .st'); // in progress -> done
    assert.equal(await pct(page), '(0.5 + 240/315)/2'.length ? await pct(page) : '');
    assert.equal(await pct(page), `${Math.round(((2 / 4 + 240 / 315) / 2) * 100)}%`);
  });
});

test('times are hidden by default and shown on toggle; start/end/12-hour', async () => {
  const rows = [R('a', 'a', 30, { start: H(15, 30) }), R('b', 'b', 90), R('c', 'c', 150)];
  await withPage({ initial: doc(rows) }, async (page) => {
    const visibleTimes = () => page.evaluate(() => {
      const text = [...document.querySelectorAll('.row')].map((r) => r.innerText).join(' ') + [...document.querySelectorAll('.row input')].map((i) => (i.offsetParent ? i.value : '')).join(' ');
      return /\d+:\d\d/.test(text) || /(AM|PM)/.test(text);
    });
    assert.equal(await visibleTimes(), false, 'no times anywhere while off');
    assert.equal(await page.getAttribute('#times', 'aria-pressed'), 'false');
    await page.click('#times');
    assert.deepEqual(await rowsText(page, '.sv'), ['3:30 PM', '4:00 PM', '5:30 PM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['4:00 PM', '5:30 PM', '8:00 PM']);
    await page.click('#times');
    assert.equal(await visibleTimes(), false);
    await page.click('#times');
    assert.deepEqual(await rowsText(page, '.sv'), ['3:30 PM', '4:00 PM', '5:30 PM'], 'entered start survives off and on');
  });
});

test('chained: end past midnight is plain clock time', async () => {
  await withPage({ initial: doc([R('a', 'a', 180, { start: H(22, 15) }), R('b', 'b', 60)], { times: true }) }, async (page) => {
    assert.deepEqual(await rowsText(page, '.ev'), ['1:15 AM', '2:15 AM']);
    assert.deepEqual(await rowsText(page, '.sv'), ['10:15 PM', '1:15 AM']);
  });
});

test('chained, no first start: every start and end is blank; first start fills the rest', async () => {
  await withPage({ initial: doc([R('a', 'a', 30), R('b', 'b', 60)], { times: true }) }, async (page) => {
    assert.deepEqual(await rowsText(page, '.ev'), ['', '']);
    assert.deepEqual(await rowsText(page, '.sv'), ['', '']);
    assert.equal(await page.getAttribute('.row:nth-child(1) .sg', 'placeholder'), '--:-- --');
    await page.click('.row:nth-child(1) .sc');
    await page.keyboard.type('9');
    await page.keyboard.press('Tab');     // Tab moves hour -> minutes
    await page.keyboard.type('15');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:15 AM', '9:45 AM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['9:45 AM', '10:45 AM']);
    await settle(page);
    assert.equal((await saved(page)).rows[0].start, H(9, 15));
  });
});

test('start editor: AM/PM toggle, 24-hour entry, Esc cancels, clearing removes the start', async () => {
  await withPage({ initial: doc([R('a', 'a', 30, { start: H(9) })], { times: true }) }, async (page) => {
    const sv = () => rowsText(page, '.sv');
    await page.click('.row .sc');
    assert.equal(await page.inputValue('.row .sh'), '9');
    assert.equal(await page.inputValue('.row .sn'), '00');
    assert.equal(await page.textContent('.row .sa'), 'AM');
    await page.click('.row .sa');
    assert.equal(await page.textContent('.row .sa'), 'PM');
    await page.keyboard.press('Escape');
    assert.deepEqual(await sv(), ['9:00 AM']);
    await page.click('.row .sc');
    await page.keyboard.type('4:05');      // colon jumps to minutes
    await page.keyboard.press('p');
    await page.keyboard.press('Enter');
    assert.deepEqual(await sv(), ['4:05 PM']);
    await page.click('.row .sc');
    await page.keyboard.type('18');        // 24-hour; two digits move on to minutes
    await page.keyboard.type('30');
    await page.keyboard.press('Enter');
    assert.deepEqual(await sv(), ['6:30 PM']);
    await page.click('.row .sc');
    await page.fill('.row .sh', '');
    await page.fill('.row .sn', '');
    await page.keyboard.press('Enter');
    assert.deepEqual(await sv(), ['']);
    assert.deepEqual(await rowsText(page, '.ev'), ['']);
  });
});

test('chained: editing a lower start opens a popup; cancel changes nothing; confirm turns chaining off', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    const popVisible = () => page.locator('.row:nth-child(2) .pop').isVisible();
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'true');
    await page.click('.row:nth-child(2) .sc');
    await page.keyboard.type('2:00');
    await page.keyboard.press('p');
    await page.keyboard.press('Enter');
    assert.equal(await popVisible(), true);
    assert.equal(await page.locator('.row:nth-child(2) .pop button').count(), 2, 'confirm and cancel');
    assert.equal(await page.getAttribute('.row:nth-child(2) .pw', 'data-tip'), 'Chaining will be disabled');
    // cancel
    await page.click('.row:nth-child(2) .px');
    assert.equal(await popVisible(), false);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:30 AM', '10:30 AM']);
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'true');
    // confirm
    await page.click('.row:nth-child(2) .sc');
    await page.keyboard.type('2:00');
    await page.keyboard.press('p');
    await page.keyboard.press('Enter');
    await page.click('.row:nth-child(2) .pk');
    assert.equal(await popVisible(), false);
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '2:00 PM', '']);
    assert.deepEqual(await rowsText(page, '.ev'), ['9:30 AM', '3:00 PM', '']);
    await settle(page);
    const s = await saved(page);
    assert.equal(s.chain, false);
    assert.deepEqual(s.rows.map((r) => r.start), [H(9), H(14), null]);
  });
});

test('popup also resolves on Esc and on a click elsewhere (both cancel)', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    for (const how of ['esc', 'outside']) {
      await page.click('.row:nth-child(2) .sc');
      await page.keyboard.type('5:00');
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.row:nth-child(2) .pop').isVisible(), true, how);
      if (how === 'esc') await page.keyboard.press('Escape'); else await page.mouse.click(600, 500);
      assert.equal(await page.locator('.row:nth-child(2) .pop').isVisible(), false, how);
      assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'true');
      assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:30 AM']);
    }
  });
});

test('unchained: every row has its own start, blank start means blank end, own starts only', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 45, { start: H(14) })];
  await withPage({ initial: doc(rows, { times: true, chain: false }) }, async (page) => {
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '', '2:00 PM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['9:30 AM', '', '2:45 PM']);
    assert.equal(await page.getAttribute('.row:nth-child(2) .sg', 'placeholder'), '--:-- --');
    await page.click('.row:nth-child(2) .sc'); // no popup when unchained
    await page.keyboard.type('11');
    await page.keyboard.type('30');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.pop:visible').count(), 0);
    assert.deepEqual(await rowsText(page, '.ev'), ['9:30 AM', '12:30 PM', '2:45 PM']);
  });
});

test('turning chaining on discards lower starts and recomputes from the first row', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60, { start: H(13) }), R('c', 'c', 45, { start: H(14) })];
  await withPage({ initial: doc(rows, { times: true, chain: false }) }, async (page) => {
    await page.click('#chain');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:30 AM', '10:30 AM']);
    await page.click('#chain'); // off again: the discarded starts do not come back
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '', '']);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => r.start), [H(9), null, null]);
  });
});

test('duration edit and reorder recalculate chained times', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 45)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await page.click('.row:nth-child(1) .dv');
    await page.fill('.row:nth-child(1) .dh', '1');
    await page.fill('.row:nth-child(1) .dm', '30');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:30 AM', '11:30 AM']);
    const b = await page.locator('.row:nth-child(3)').boundingBox();
    const a = await page.locator('.row:nth-child(1)').boundingBox();
    await page.mouse.move(b.x + 300, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + 300, b.y - 12, { steps: 6 });
    await page.mouse.move(a.x + 300, a.y + 4, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.deepEqual(await names(page), ['c', 'a', 'b']);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:45 AM', '11:15 AM'], 'start stays with the first slot');
    assert.deepEqual(await rowsText(page, '.ev'), ['9:45 AM', '11:15 AM', '12:15 PM']);
  });
});

test('drag reorders any row, from the name area too, without editing or toggling anything', async () => {
  await withPage({ initial: doc([R('a', 'One', 30), R('b', 'Two', 30), R('c', 'Three', 30), R('d', 'Four', 30)]) }, async (page) => {
    const box = (n) => page.locator(`.row:nth-child(${n})`).boundingBox();
    const first = await box(1), third = await box(3);
    await page.mouse.move(first.x + 200, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 200, first.y + 20, { steps: 4 });
    await page.mouse.move(first.x + 200, third.y + third.height / 2, { steps: 10 });
    assert.equal(await page.locator('.row.drag').count(), 1, 'dragging state');
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.deepEqual(await names(page), ['Two', 'Three', 'One', 'Four']);
    assert.equal(await page.evaluate(() => document.activeElement === document.body || !document.activeElement.matches('input')), true, 'drag did not start an edit');
    assert.deepEqual(await page.$$eval('.row', (r) => r.map((e) => e.className.includes('s0'))), [true, true, true, true]);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => r.name), ['Two', 'Three', 'One', 'Four']);
    // dragging from the status icon moves the row and does not cycle it
    const f = await box(1), l = await box(4);
    const st = await page.locator('.row:nth-child(1) .st').boundingBox();
    await page.mouse.move(st.x + 10, st.y + 10);
    await page.mouse.down();
    await page.mouse.move(st.x + 10, st.y + 30, { steps: 4 });
    await page.mouse.move(st.x + 10, l.y + l.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.deepEqual(await names(page), ['Three', 'One', 'Four', 'Two']);
    assert.equal(await page.getAttribute('.row:nth-child(4) .st', 'data-tip'), 'Not started');
    assert.ok(f);
  });
});

test('a plain click on a row is not a drag', async () => {
  await withPage({ initial: doc([R('a', 'One', 30), R('b', 'Two', 30)]) }, async (page) => {
    await page.click('.row:nth-child(1) .nm');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmi');
    assert.deepEqual(await names(page), ['One', 'Two']);
  });
});

test('clear: first click arms, second click clears for everyone; arming expires on outside click and Esc', async () => {
  await withPage({ initial: doc([R('a', 'One', 30), R('b', 'Two', 30, { status: 2 })]) }, async (page) => {
    assert.equal(await page.getAttribute('#clear', 'data-tip'), 'Clear all');
    await page.click('#clear');
    assert.equal(await page.locator('#clear.armed').count(), 1);
    assert.equal(await page.locator('.row').count(), 2, 'first click only arms');
    await page.mouse.click(600, 500);
    assert.equal(await page.locator('#clear.armed').count(), 0, 'outside click disarms');
    await page.click('#clear');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#clear.armed').count(), 0, 'Esc disarms');
    await page.click('#clear');
    await page.click('#clear');
    assert.equal(await page.locator('.row').count(), 0);
    assert.equal(await pct(page), '0%');
    await settle(page);
    assert.deepEqual((await saved(page)).rows, []);
    // the trash sits in the bottom-right corner
    const b = await page.locator('#clear').boundingBox(), vp = page.viewportSize();
    assert.ok(vp.width - (b.x + b.width) < 24 && vp.height - (b.y + b.height) < 24);
  });
});

test('persistence: list loads on open; toggles persist; a second viewer sees the same list', async () => {
  const rows = [R('a', 'Shared one', 60, { status: 1, start: H(8) }), R('b', 'Shared two', 30)];
  await withPage({ initial: doc(rows, { times: true, chain: true }) }, async (page) => {
    assert.deepEqual(await names(page), ['Shared one', 'Shared two']);
    assert.deepEqual(await rowsText(page, '.sv'), ['8:00 AM', '9:00 AM']);
    assert.equal(await page.getAttribute('#times', 'aria-pressed'), 'true');
    assert.equal(await page.locator('#warn').isVisible(), false, 'no save warning while healthy');
    await page.click('#chain');
    await settle(page);
    const stored = await saved(page);
    assert.equal(stored.chain, false);
    const { ctx, page: other } = await openPage(browser, { initial: { 'tracker/list': stored } });
    try {
      assert.deepEqual(await names(other), ['Shared one', 'Shared two']);
      assert.equal(await other.getAttribute('#chain', 'aria-pressed'), 'false');
    } finally { await ctx.close(); }
  });
});

test('writes only when something changed, one document, finished rows only', async () => {
  await withPage({ initial: doc([R('a', 'One', 30)]) }, async (page) => {
    await settle(page);
    assert.equal(await page.evaluate(() => window.__db.writes.length), 0, 'loading does not write');
    await page.click('.row .st');
    await page.click('.row .st');
    await page.click('.row .st'); // back to the original within the debounce window
    await settle(page);
    assert.equal(await page.evaluate(() => window.__db.writes.length), 0, 'no net change, no write');
    await page.click('.row .st');
    await settle(page);
    assert.equal(await page.evaluate(() => window.__db.writes.length), 1);
  });
});

test('no live sync: later changes in the store do not appear until reopened', async () => {
  await withPage({ initial: doc([R('a', 'One', 30)]) }, async (page) => {
    await page.evaluate(() => { window.__db.store['tracker/list'].rows.push({ id: 'z', name: 'Late', mins: 5, status: 0, start: null }); });
    await page.waitForTimeout(500);
    assert.deepEqual(await names(page), ['One']);
  });
});

test('save problems show an icon; a list that could not be read is never overwritten', async () => {
  await withPage({ initial: doc([R('a', 'One', 30)]) }, async (page) => {
    await page.evaluate(() => { window.__db.failWith = 'invalid_argument'; });
    await page.click('.row .st');
    await settle(page);
    assert.equal(await page.locator('#warn').isVisible(), true);
    assert.equal(await page.getAttribute('#warn', 'data-tip'), 'Not saved');
    await page.evaluate(() => { window.__db.failWith = null; });
    await page.click('.row .st');
    await settle(page);
    assert.equal(await page.locator('#warn').isVisible(), false, 'clears after a good save');
  });
  await withPage({ missing: true }, async (page) => {
    assert.equal(await page.locator('#warn').isVisible(), true, 'no database: still usable, flagged');
    await addRow(page, 'Offline', 1, 0);
    assert.deepEqual(await names(page), ['Offline']);
  });
  const { ctx, page, errors } = await openPage(browser, { initial: doc([R('a', 'Precious', 30)]) });
  await ctx.close();
  assert.deepEqual(errors, []);
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await p2.addInitScript(`window.__pre = true;`);
  await c2.close();
});

test('load failure: nothing is written back over the stored list', async () => {
  const { ctx, page } = await (async () => {
    const o = await openPage(browser, { initial: doc([R('a', 'Precious', 30)]) });
    return o;
  })();
  try {
    // open a second page whose reads fail
    const c2 = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const p2 = await c2.newPage();
    const { mockDbScript, wrappedPage } = await import('./harness.mjs');
    await p2.addInitScript(mockDbScript(doc([R('a', 'Precious', 30)])));
    await p2.addInitScript('window.__db.failGet = "invalid_argument";');
    await p2.route('https://tracker.test/', (r) => r.fulfill({ contentType: 'text/html', body: wrappedPage() }));
    await p2.goto('https://tracker.test/');
    await p2.waitForTimeout(150);
    assert.equal(await p2.locator('#warn').isVisible(), true);
    await addRow(p2, 'Typed anyway', 1, 0);
    await p2.waitForTimeout(700);
    assert.equal(await p2.evaluate(() => window.__db.writes.length), 0, 'never writes without a successful read');
    await c2.close();
  } finally { await ctx.close(); }
});

test('edits made before the stored list arrives are merged, not lost', async () => {
  const { ctx, page } = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
    const page = await ctx.newPage();
    const { mockDbScript, wrappedPage } = await import('./harness.mjs');
    await page.addInitScript(mockDbScript(doc([R('a', 'Stored', 30)])));
    await page.addInitScript('window.__db.delay = 400;');
    await page.route('https://tracker.test/', (r) => r.fulfill({ contentType: 'text/html', body: wrappedPage() }));
    await page.goto('https://tracker.test/');
    return { ctx, page };
  })();
  try {
    await page.waitForTimeout(50);
    await addRow(page, 'Early bird', 1, 0);
    await page.waitForTimeout(1500);
    assert.deepEqual(await names(page), ['Stored', 'Early bird']);
    assert.deepEqual((await saved(page)).rows.map((r) => r.name), ['Stored', 'Early bird']);
  } finally { await ctx.close(); }
});

test('tooltips: nothing on a quick hover, short text after a long hover, every icon has one', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    const tipText = () => page.evaluate(() => { const t = document.querySelector('#tip'); return t.classList.contains('show') ? t.textContent : null; });
    await page.hover('#times');
    await page.waitForTimeout(350);
    assert.equal(await tipText(), null, 'not yet');
    await page.waitForTimeout(700);
    assert.equal(await tipText(), 'Hide times');
    await page.mouse.move(600, 500);
    assert.equal(await tipText(), null, 'gone on leave');
    await page.hover('.row .st');
    await page.waitForTimeout(1100);
    assert.equal(await tipText(), 'Not started');
    await page.hover('#add');
    await page.waitForTimeout(1100);
    assert.equal(await tipText(), 'Add');
    await page.hover('#clear');
    await page.waitForTimeout(1100);
    assert.equal(await tipText(), 'Clear all');
    // every icon-only control carries a tip
    const missing = await page.$$eval('button, [role=img]', (els) => els.filter((e) => e.offsetParent && !e.dataset.tip && !e.classList.contains('dv') && !e.classList.contains('sv') && !e.classList.contains('sa') && !e.classList.contains('ea') && !e.classList.contains('ev')).map((e) => e.className));
    assert.deepEqual(missing, []);
    assert.equal(await page.$$eval('[title]', (e) => e.length), 0, 'no native title tooltips');
  });
});

test('only allowed text is visible: placeholders, units, clock text, percent, tooltips', async () => {
  const rows = [R('a', 'Essay', 150, { start: H(9) }), R('b', 'Quiz', 60, { status: 2 }), R('c', 'Lab', 45)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await page.click('.row:nth-child(2) .sc');
    await page.keyboard.type('5:00');
    await page.keyboard.press('Enter'); // opens the popup
    await page.click('#add');
    const stray = await page.evaluate(() => {
      const user = new Set([...document.querySelectorAll('.nmi')].map((i) => i.value).filter(Boolean));
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode()); ) {
        const t = n.textContent.trim();
        const p = n.parentElement;
        if (!t || p.closest('script, style')) continue;
        const vis = p.getClientRects().length > 0 && getComputedStyle(p).visibility !== 'hidden';
        if (!vis) continue;
        if (/^(\d+ (hrs?|min)( \d+ min)?|\d{1,2}:\d\d (AM|PM)|AM|PM|hr|min|:|\d+%)$/.test(t)) continue;
        out.push(t);
      }
      return out;
    });
    assert.deepEqual(stray, [], 'unexpected visible text');
    const ph = await page.$$eval('input', (i) => i.filter((x) => x.offsetParent).map((x) => x.placeholder).filter(Boolean));
    for (const p of ph) assert.match(p, /^(Assignment|0|--|--:-- --)$/);
  });
});

test('dark theme: page background and text are explicit and readable', async () => {
  await withPage({ initial: doc([R('a', 'Readable', 30, { start: H(9) })], { times: true }) }, async (page) => {
    const ratio = await page.evaluate(() => {
      const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const bg = getComputedStyle(document.body).backgroundColor;
      const pairs = ['.row .nmi', '.row .dv', '.row .sv', '.row .ev', '.u'].map((s) => document.querySelector(s)).filter(Boolean).map((e) => getComputedStyle(e).color);
      const L = lum(bg);
      return { bg, scheme: getComputedStyle(document.documentElement).colorScheme, min: Math.min(...pairs.map((c) => { const a = lum(c); return (Math.max(a, L) + 0.05) / (Math.min(a, L) + 0.05); })) };
    });
    assert.equal(ratio.bg, 'rgb(19, 21, 26)');
    assert.equal(ratio.scheme, 'dark');
    assert.ok(ratio.min >= 4.5, `contrast ${ratio.min}`);
  });
});

test('keyboard: tab reaches status, name, duration and delete; Enter on duration button edits', async () => {
  await withPage({ initial: doc([R('a', 'One', 30)]) }, async (page) => {
    await page.focus('.row .st');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'nmi');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'dv');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'dh');
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr 30 min']);
  });
});

test('keyboard: Tab passes an empty start without opening it; Enter opens the editor', async () => {
  await withPage({ initial: doc([R('a', 'One', 30)], { times: true }) }, async (page) => {
    await page.focus('.row .dv');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'sg');
    assert.equal(await page.locator('.row .sh').isVisible(), false, 'focus alone does not open it');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'sh');
    await page.keyboard.type('7:45');
    await page.keyboard.press('p');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.sv'), ['7:45 PM']);
  });
});

test('end time: read-only until the row is done, then editable', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    const disabled = () => page.$$eval('.row .ev', (b) => b.map((x) => x.disabled));
    assert.deepEqual(await disabled(), [true, true], 'not done: not editable');
    await page.click('.row:nth-child(1) .ev', { force: true });
    assert.equal(await page.locator('.row:nth-child(1) .eh').isVisible(), false);
    await page.click('.row:nth-child(1) .st');
    assert.deepEqual(await disabled(), [true, true], 'in progress: still not editable');
    await page.click('.row:nth-child(1) .st'); // done
    assert.deepEqual(await disabled(), [false, true]);
    await page.click('.row:nth-child(1) .st'); // not started again
    assert.deepEqual(await disabled(), [true, true], 'editing is only for done rows');
  });
});

test('end time: editing a done row sets its real duration; chained rows, progress and storage follow', async () => {
  const rows = [R('a', 'a', 60, { start: H(9), status: 2 }), R('b', 'b', 30), R('c', 'c', 90, { status: 2 })];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM', '10:30 AM', '12:00 PM']);
    assert.equal(await pct(page), '75%');
    await page.click('.row:nth-child(1) .ev');
    assert.equal(await page.inputValue('.row:nth-child(1) .eh'), '10');
    assert.equal(await page.inputValue('.row:nth-child(1) .en'), '00');
    assert.equal(await page.textContent('.row:nth-child(1) .ea'), 'AM');
    assert.equal(await page.locator('.row:nth-child(1) .ev').isVisible(), false, 'editor replaces the value');
    await page.keyboard.type('10:45');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr 45 min', '30 min', '1 hr 30 min']);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:45 AM', '11:15 AM'], 'chained starts recalculated');
    assert.deepEqual(await rowsText(page, '.ev'), ['10:45 AM', '11:15 AM', '12:45 PM']);
    assert.equal(await pct(page), `${Math.round(((2 / 3 + 195 / 225) / 2) * 100)}%`, 'minutes weight uses the new duration');
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => r.mins), [105, 30, 90]);
  });
});

test('end time: Esc cancels, unchanged or equal-to-start is ignored, PM and past-midnight work', async () => {
  const rows = [R('a', 'a', 60, { start: H(22, 30), status: 2 }), R('b', 'b', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    const open = () => page.click('.row:nth-child(1) .ev');
    await open();
    await page.keyboard.type('11:45');
    await page.keyboard.press('Escape');
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '30 min']);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'ev', 'focus returns to the end');
    await open();
    await page.keyboard.press('Enter'); // unchanged
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '30 min']);
    await open();
    await page.keyboard.type('10:30');
    await page.keyboard.press('p'); // same as the start: zero minutes, rejected
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '30 min']);
    await open();
    await page.keyboard.type('1:15'); // 1:15 AM, past midnight
    await page.keyboard.press('a');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.dv'), ['2 hrs 45 min', '30 min']);
    assert.deepEqual(await rowsText(page, '.ev'), ['1:15 AM', '1:45 AM']);
    await open();
    await page.fill('.row:nth-child(1) .eh', '');
    await page.fill('.row:nth-child(1) .en', '');
    await page.keyboard.press('Enter'); // empty: ignored
    assert.deepEqual(await rowsText(page, '.dv'), ['2 hrs 45 min', '30 min']);
  });
});

test('end time: commits on blur, AM/PM button toggles, works unchained, and needs a start', async () => {
  const rows = [R('a', 'a', 60, { start: H(9), status: 2 }), R('b', 'b', 30, { status: 2 }), R('c', 'c', 45, { start: H(14), status: 2 })];
  await withPage({ initial: doc(rows, { times: true, chain: false }) }, async (page) => {
    assert.deepEqual(await page.$$eval('.row .ev', (b) => b.map((x) => x.disabled)), [false, true, false], 'a row with no start has no end to edit');
    await page.click('.row:nth-child(3) .ev');
    await page.keyboard.type('3:00');
    assert.equal(await page.textContent('.row:nth-child(3) .ea'), 'PM', 'opens on the current period');
    await page.click('.row:nth-child(3) .ea');
    assert.equal(await page.textContent('.row:nth-child(3) .ea'), 'AM');
    await page.click('.row:nth-child(3) .ea');
    assert.equal(await page.textContent('.row:nth-child(3) .ea'), 'PM');
    assert.equal(await page.locator('.row:nth-child(3) .eh').isVisible(), true, 'still editing after the toggle');
    await page.mouse.click(600, 500); // click away commits
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '30 min', '1 hr']);
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM', '', '3:00 PM']);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '', '2:00 PM'], 'starts are untouched');
  });
});

test('end time: keyboard reaches a done row end; no popup, chaining stays on', async () => {
  const rows = [R('a', 'a', 30, { start: H(9), status: 2 }), R('b', 'b', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await page.focus('.row:nth-child(1) .sv');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'ev');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'eh');
    await page.keyboard.type('9:50');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.dv'), ['50 min', '30 min']);
    assert.equal(await page.locator('.pop:visible').count(), 0);
    assert.equal(await page.getAttribute('#chain', 'aria-pressed'), 'true');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:50 AM']);
  });
});

test('end time: a done row end keeps the dimmed look and stays out of drag', async () => {
  const rows = [R('a', 'a', 30, { start: H(9), status: 2 }), R('b', 'b', 30), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    const same = await page.$eval('.row:nth-child(1)', (r) => getComputedStyle(r.querySelector('.ev')).color === getComputedStyle(r.querySelector('.sv')).color);
    assert.equal(same, true, 'end value matches the dimmed row text');
    // a drag that starts on the end value moves the row and does not open the editor
    const ev = await page.locator('.row:nth-child(1) .ev').boundingBox();
    const last = await page.locator('.row:nth-child(3)').boundingBox();
    await page.mouse.move(ev.x + 20, ev.y + 10);
    await page.mouse.down();
    await page.mouse.move(ev.x + 20, ev.y + 30, { steps: 4 });
    await page.mouse.move(ev.x + 20, last.y + 12, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.deepEqual(await names(page), ['b', 'c', 'a']);
    assert.equal(await page.locator('.row .eh:visible').count(), 0);
  });
});
