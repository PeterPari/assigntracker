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
const setNow = (page, h, m) => page.evaluate(([a, b]) => window.__setNow(a, b), [h, m]);
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
    await page.keyboard.press('Escape'); // the only row is done: close the all-done popup
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

const editLowerStart = async (page, n, text, ap) => {
  await page.click(`.row:nth-child(${n}) .sc`);
  await page.keyboard.type(text);
  if (ap) await page.keyboard.press(ap);
  await page.keyboard.press('Enter');
};

test('chained: editing a following row start opens a popup with two choices and a cancel', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    const popVisible = () => page.locator('.row:nth-child(2) .pop').isVisible();
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'true');
    await editLowerStart(page, 2, '2:00', 'p');
    assert.equal(await popVisible(), true);
    assert.deepEqual(await page.$$eval('.row:nth-child(2) .pop button', (b) => b.map((x) => x.dataset.tip)), ['Cut and continue', 'Disable chaining', 'Cancel']);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'pc', 'the choice that keeps chaining is focused first');
    assert.equal(await page.getAttribute('.row:nth-child(2) .pop', 'role'), 'alertdialog');
    // cancel
    await page.click('.row:nth-child(2) .px');
    assert.equal(await popVisible(), false);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:30 AM', '10:30 AM']);
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'true');
  });
});

test('popup choice 1, cut and continue: the new start cuts the chain, chaining stays on, the rest follow', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30), R('d', 'd', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await editLowerStart(page, 2, '2:00', 'p');
    await page.click('.row:nth-child(2) .pc');
    assert.equal(await page.locator('.pop:visible').count(), 0);
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'true', 'chaining stays on');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '2:00 PM', '3:00 PM', '3:30 PM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['9:30 AM', '3:00 PM', '3:30 PM', '4:00 PM']);
    await settle(page);
    const s = await saved(page);
    assert.equal(s.chain, true);
    assert.deepEqual(s.rows.map((r) => r.start), [H(9), H(14), null, null]);
  });
});

test('popup choice 2, disable chaining: chaining turns off and only entered starts remain', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await editLowerStart(page, 2, '2:00', 'p');
    await page.click('.row:nth-child(2) .pd');
    assert.equal(await page.locator('.pop:visible').count(), 0);
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '2:00 PM', '']);
    assert.deepEqual(await rowsText(page, '.ev'), ['9:30 AM', '3:00 PM', '']);
    await settle(page);
    const s = await saved(page);
    assert.equal(s.chain, false);
    assert.deepEqual(s.rows.map((r) => r.start), [H(9), H(14), null]);
  });
});

test('popup by keyboard: Enter picks the focused choice, Tab reaches the others, Esc cancels', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await editLowerStart(page, 2, '2:00', 'p');
    await page.waitForTimeout(30);
    await page.keyboard.press('Enter'); // the focused choice is cut and continue
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '2:00 PM', '3:00 PM']);
    await editLowerStart(page, 3, '5:00', 'p');
    await page.waitForTimeout(30);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'pd');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#chain').getAttribute('aria-pressed'), 'false');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '2:00 PM', '5:00 PM']);
  });
});

test('popup with an emptied start: cutting is unavailable, disabling chaining is not', async () => {
  const rows = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await page.click('.row:nth-child(2) .sc');
    await page.fill('.row:nth-child(2) .sh', '');
    await page.fill('.row:nth-child(2) .sn', '');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.row:nth-child(2) .pop').isVisible(), true);
    assert.equal(await page.$eval('.row:nth-child(2) .pc', (b) => b.disabled), true);
    assert.equal(await page.$eval('.row:nth-child(2) .pd', (b) => b.disabled), false);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'pd' );
    await page.click('.row:nth-child(2) .px');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:30 AM', '10:30 AM']);
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
    await page.keyboard.press('Escape'); // all-done popup
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

test('done: the end time fills in with the current time and stays editable', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 30), R('c', 'c', 45)];
  await withPage({ initial: doc(rows, { times: true }), now: [9, 0] }, async (page) => {
    await page.click('.row:nth-child(1) .st'); // in progress at 9:00 AM: nothing else changes
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM', '10:30 AM', '11:15 AM']);
    await setNow(page, 9, 40);
    await page.click('.row:nth-child(1) .st'); // done at 9:40 AM
    assert.deepEqual(await rowsText(page, '.ev'), ['9:40 AM', '10:10 AM', '10:55 AM']);
    assert.deepEqual(await rowsText(page, '.dv'), ['40 min', '30 min', '45 min']);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:40 AM', '10:10 AM'], 'chained rows follow');
    assert.equal(await pct(page), `${Math.round(((1 / 3 + 40 / 115) / 2) * 100)}%`);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => [r.mins, r.status]), [[40, 2], [30, 0], [45, 0]]);
    // still editable afterwards
    await page.click('.row:nth-child(1) .ev');
    await page.keyboard.type('9:55');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.ev'), ['9:55 AM', '10:25 AM', '11:10 AM']);
    assert.deepEqual(await rowsText(page, '.dv'), ['55 min', '30 min', '45 min']);
  });
});

test('done: a chained lower row records its finish from its start', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }), now: [10, 0] }, async (page) => {
    await page.click('.row:nth-child(2) .st'); // in progress at 10:00 AM
    await setNow(page, 10, 25);
    await page.click('.row:nth-child(2) .st'); // done at 10:25 AM
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '25 min', '30 min']);
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM', '10:25 AM', '10:55 AM']);
    assert.equal(await page.getAttribute('#chain', 'aria-pressed'), 'true');
  });
});

test('done: unchained rows use their own start; past midnight works', async () => {
  const rows = [R('a', 'a', 60, { start: H(23, 30) }), R('b', 'b', 30)];
  await withPage({ initial: doc(rows, { times: true, chain: false }), now: [23, 30] }, async (page) => {
    await page.click('.row:nth-child(1) .st'); // in progress 11:30 PM
    await setNow(page, 0, 10);
    await page.click('.row:nth-child(1) .st'); // done 12:10 AM
    assert.deepEqual(await rowsText(page, '.dv'), ['40 min', '30 min']);
    assert.deepEqual(await rowsText(page, '.ev'), ['12:10 AM', '']);
    // row b has no start until it is started; finishing it records from that start
    await page.click('.row:nth-child(2) .st'); // in progress 12:10 AM
    assert.deepEqual(await rowsText(page, '.sv'), ['11:30 PM', '12:10 AM']);
    await setNow(page, 0, 25);
    await page.click('.row:nth-child(2) .st'); // done 12:25 AM
    assert.deepEqual(await rowsText(page, '.dv'), ['40 min', '15 min']);
    assert.deepEqual(await rowsText(page, '.ev'), ['12:10 AM', '12:25 AM']);
  });
});

test('done: times hidden, finished early, or finished in the same minute leave the duration alone', async () => {
  await withPage({ initial: doc([R('a', 'a', 60, { start: H(9) })], { times: false }), now: [9, 40] }, async (page) => {
    await page.click('.row .st');
    await page.click('.row .st');
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr'], 'times off: nothing hidden is rewritten');
    await page.keyboard.press('Escape'); // all-done popup
    await page.click('#times');
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM']);
  });
  await withPage({ initial: doc([R('a', 'a', 60)], { times: true }), now: [13, 0] }, async (page) => {
    await page.click('.row .st'); // in progress 1:00 PM
    await page.click('.row .sc'); // then the start is moved to later today
    await page.keyboard.type('3:00');
    await page.keyboard.press('p');
    await page.keyboard.press('Enter');
    await page.click('.row .st'); // done at 1:00 PM, before that start
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr'], 'start is later today: keep the plan');
    assert.deepEqual(await rowsText(page, '.ev'), ['4:00 PM']);
  });
  await withPage({ initial: doc([R('a', 'a', 60, { start: H(9, 40) })], { times: true }), now: [9, 40] }, async (page) => {
    await page.click('.row .st');
    await page.click('.row .st'); // same minute as the start
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr']);
  });
});

test('done: cycling back and finishing again records the new time', async () => {
  await withPage({ initial: doc([R('a', 'a', 60, { start: H(9) })], { times: true }), now: [9, 0] }, async (page) => {
    await page.click('.row .st');
    await setNow(page, 9, 30);
    await page.click('.row .st');
    assert.deepEqual(await rowsText(page, '.ev'), ['9:30 AM']);
    await page.keyboard.press('Escape'); // all-done popup
    await page.click('.row .st'); // back to not started: the recorded times stay
    assert.deepEqual(await rowsText(page, '.dv'), ['30 min']);
    assert.equal(await page.$eval('.row .ev', (b) => b.disabled), true);
    await setNow(page, 10, 0);
    await page.click('.row .st'); // in progress again: new start
    assert.deepEqual(await rowsText(page, '.sv'), ['10:00 AM']);
    await setNow(page, 10, 20);
    await page.click('.row .st'); // done again: new end
    assert.deepEqual(await rowsText(page, '.dv'), ['20 min']);
    assert.deepEqual(await rowsText(page, '.ev'), ['10:20 AM']);
    assert.equal(await page.$eval('.row .ev', (b) => b.disabled), false);
  });
});

test('in progress: the start fills in with the current time and stays editable', async () => {
  const rows = [R('a', 'a', 60, { start: H(8) }), R('b', 'b', 30), R('c', 'c', 45)];
  await withPage({ initial: doc(rows, { times: true }), now: [9, 10] }, async (page) => {
    await page.click('.row:nth-child(1) .st'); // in progress at 9:10 AM
    assert.deepEqual(await rowsText(page, '.sv'), ['9:10 AM', '10:10 AM', '10:40 AM'], 'chained rows follow');
    assert.deepEqual(await rowsText(page, '.ev'), ['10:10 AM', '10:40 AM', '11:25 AM']);
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '30 min', '45 min'], 'durations untouched');
    await settle(page);
    assert.equal((await saved(page)).rows[0].start, H(9, 10));
    assert.equal((await saved(page)).rows[0].status, 1);
    // still editable afterwards, with no chaining popup for the first row
    await page.click('.row:nth-child(1) .sc');
    await page.keyboard.type('9:00');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:00 AM', '10:30 AM']);
    assert.equal(await page.locator('.pop:visible').count(), 0);
  });
});

test('in progress: a blank first start gets filled and the whole chain appears', async () => {
  await withPage({ initial: doc([R('a', 'a', 30), R('b', 'b', 30)], { times: true }), now: [14, 5] }, async (page) => {
    assert.deepEqual(await rowsText(page, '.ev'), ['', '']);
    await page.click('.row:nth-child(1) .st');
    assert.deepEqual(await rowsText(page, '.sv'), ['2:05 PM', '2:35 PM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['2:35 PM', '3:05 PM']);
  });
});

test('in progress with chaining: the row cuts the chain before it and the rows after continue from it', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30), R('d', 'd', 30)];
  await withPage({ initial: doc(rows, { times: true }), now: [10, 35] }, async (page) => {
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:00 AM', '11:00 AM', '11:30 AM']);
    await page.click('.row:nth-child(2) .st'); // in progress at 10:35 AM
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:35 AM', '11:35 AM', '12:05 PM'], 'rows after follow the new start');
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM', '11:35 AM', '12:05 PM', '12:35 PM'], 'the row before keeps its own end');
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '1 hr', '30 min', '30 min']);
    assert.equal(await page.getAttribute('#chain', 'aria-pressed'), 'true', 'chaining stays on');
    assert.equal(await page.locator('.pop:visible').count(), 0, 'no warning popup');
    // the stamped start reads as an entered value, the rest as followed values
    const muted = await page.$$eval('.row .sv', (b) => b.map((x) => getComputedStyle(x).color));
    assert.equal(muted[1], muted[0]);
    assert.notEqual(muted[2], muted[1]);
    await settle(page);
    const s = await saved(page);
    assert.equal(s.chain, true);
    assert.deepEqual(s.rows.map((r) => r.start), [H(9), H(10, 35), null, null]);
  });
});

test('in progress with chaining: finishing it then records the real time and the chain keeps going', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }), now: [10, 35] }, async (page) => {
    await page.click('.row:nth-child(2) .st');
    await setNow(page, 11, 5);
    await page.click('.row:nth-child(2) .st'); // done at 11:05 AM
    assert.deepEqual(await rowsText(page, '.dv'), ['1 hr', '30 min', '30 min']);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:35 AM', '11:05 AM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM', '11:05 AM', '11:35 AM']);
  });
});

test('in progress with chaining: works with no first start, and the first row can be cut too', async () => {
  await withPage({ initial: doc([R('a', 'a', 30), R('b', 'b', 30), R('c', 'c', 30)], { times: true }), now: [14, 0] }, async (page) => {
    await page.click('.row:nth-child(2) .st');
    assert.deepEqual(await rowsText(page, '.sv'), ['', '2:00 PM', '2:30 PM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['', '2:30 PM', '3:00 PM']);
    await setNow(page, 14, 40);
    await page.click('.row:nth-child(3) .st');
    assert.deepEqual(await rowsText(page, '.sv'), ['', '2:00 PM', '2:40 PM']);
  });
});

test('a stamped start can be edited directly while chained (no popup); clearing it rejoins the chain', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }), now: [10, 35] }, async (page) => {
    await page.click('.row:nth-child(2) .st');
    await page.click('.row:nth-child(2) .sc');
    await page.keyboard.type('10:30');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.pop:visible').count(), 0);
    assert.equal(await page.getAttribute('#chain', 'aria-pressed'), 'true');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:30 AM', '11:30 AM']);
    await page.click('.row:nth-child(2) .sc');
    await page.fill('.row:nth-child(2) .sh', '');
    await page.fill('.row:nth-child(2) .sn', '');
    await page.keyboard.press('Enter');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:00 AM', '11:00 AM'], 'no own start: follows the row above again');
    // a row that follows still asks before it is edited
    await page.click('.row:nth-child(3) .sc');
    await page.keyboard.type('5:00');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.row:nth-child(3) .pop').isVisible(), true);
  });
});

test('cuts survive a reload, and turning chaining off and on again discards them', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 60), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }), now: [10, 35] }, async (page) => {
    await page.click('.row:nth-child(2) .st');
    await settle(page);
    const stored = await saved(page);
    const { ctx, page: other } = await openPage(browser, { initial: { 'tracker/list': stored } });
    try {
      assert.deepEqual(await rowsText(other, '.sv'), ['9:00 AM', '10:35 AM', '11:35 AM']);
    } finally { await ctx.close(); }
    await page.click('#chain'); // off: every row has only its own start
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:35 AM', '']);
    await page.click('#chain'); // on: lower starts discarded, recomputed from the first row
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:00 AM', '11:00 AM']);
  });
});

test('reordering keeps a started row\'s start; an unstarted plan stays in the first slot', async () => {
  const dragTo = async (page, from, to) => {
    const a = await page.locator(`.row:nth-child(${from})`).boundingBox();
    const b = await page.locator(`.row:nth-child(${to})`).boundingBox();
    await page.mouse.move(a.x + 300, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 300, a.y + (to < from ? -14 : 14), { steps: 4 });
    await page.mouse.move(a.x + 300, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const started = [R('a', 'a', 30, { start: H(9, 10), status: 1 }), R('b', 'b', 30), R('c', 'c', 30)];
  await withPage({ initial: doc(started, { times: true }) }, async (page) => {
    await dragTo(page, 3, 1);
    assert.deepEqual(await names(page), ['c', 'a', 'b']);
    assert.deepEqual(await rowsText(page, '.sv'), ['', '9:10 AM', '9:40 AM'], 'the started row keeps 9:10; the new top row has none');
  });
  const plan = [R('a', 'a', 30, { start: H(9) }), R('b', 'b', 30), R('c', 'c', 30)];
  await withPage({ initial: doc(plan, { times: true }) }, async (page) => {
    await dragTo(page, 3, 1);
    assert.deepEqual(await names(page), ['c', 'a', 'b']);
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '9:30 AM', '10:00 AM'], 'the plan stays in the first slot');
  });
});

test('deleting a cut row lets the rows after it follow the row before', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 60, { start: H(10, 35), status: 1 }), R('c', 'c', 30)];
  await withPage({ initial: doc(rows, { times: true }) }, async (page) => {
    await page.hover('.row:nth-child(2)');
    await page.click('.row:nth-child(2) .rm');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '10:00 AM']);
  });
});

test('in progress: unchained rows each get their own start', async () => {
  const rows = [R('a', 'a', 60, { start: H(9) }), R('b', 'b', 30), R('c', 'c', 30, { start: H(15) })];
  await withPage({ initial: doc(rows, { times: true, chain: false }), now: [11, 45] }, async (page) => {
    await page.click('.row:nth-child(2) .st');
    assert.deepEqual(await rowsText(page, '.sv'), ['9:00 AM', '11:45 AM', '3:00 PM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['10:00 AM', '12:15 PM', '3:30 PM']);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => r.start), [H(9), H(11, 45), H(15)]);
    assert.equal((await saved(page)).chain, false);
  });
});

test('in progress: nothing is recorded while times are hidden', async () => {
  await withPage({ initial: doc([R('a', 'a', 60, { start: H(8) })], { times: false }), now: [9, 10] }, async (page) => {
    await page.click('.row .st');
    await page.click('#times');
    assert.deepEqual(await rowsText(page, '.sv'), ['8:00 AM']);
  });
});

test('start then finish: start stamps on in progress, end stamps on done, duration is the real time spent', async () => {
  await withPage({ initial: doc([R('a', 'a', 60), R('b', 'b', 30)], { times: true }), now: [9, 10] }, async (page) => {
    await page.click('.row:nth-child(1) .st');             // in progress, 9:10 AM
    await setNow(page, 9, 55);
    await page.click('.row:nth-child(1) .st');             // done, 9:55 AM
    assert.deepEqual(await rowsText(page, '.sv'), ['9:10 AM', '9:55 AM']);
    assert.deepEqual(await rowsText(page, '.ev'), ['9:55 AM', '10:25 AM']);
    assert.deepEqual(await rowsText(page, '.dv'), ['45 min', '30 min']);
    await page.click('.row:nth-child(1) .st');             // back to not started: times stay
    assert.deepEqual(await rowsText(page, '.sv'), ['9:10 AM', '9:55 AM']);
    await setNow(page, 11, 0);
    await page.click('.row:nth-child(1) .st');             // in progress again: new start
    assert.deepEqual(await rowsText(page, '.sv'), ['11:00 AM', '11:45 AM']);
    await settle(page);
    assert.deepEqual((await saved(page)).rows.map((r) => [r.status, r.start, r.mins]), [[1, H(11), 45], [0, null, 30]]);
  });
});

/* ---------- all-done popup ---------- */
const popup = (page) => page.evaluate(() => {
  const o = document.querySelector('#done');
  return o.hidden ? null : o.querySelector('#doneMsg').textContent.trim();
});
const doneAll = async (page, n) => { for (let i = 1; i <= n; i++) { await page.click(`.row:nth-child(${i}) .st`); await page.click(`.row:nth-child(${i}) .st`); } };

test('all done: checking off the last row shows how long it all took', async () => {
  const rows = [R('a', 'a', 90), R('b', 'b', 60)];
  await withPage({ initial: doc(rows) }, async (page) => {
    assert.equal(await popup(page), null, 'nothing on open');
    await page.click('.row:nth-child(1) .st');
    await page.click('.row:nth-child(1) .st'); // first row done, second still open
    assert.equal(await popup(page), null, 'not while a row is left');
    await page.click('.row:nth-child(2) .st');
    assert.equal(await popup(page), null, 'in progress is not done');
    await page.click('.row:nth-child(2) .st');
    assert.equal(await popup(page), 'You finished all of your assignments in 2 hours and 30 minutes');
    assert.equal(await pct(page), '100%');
    assert.equal(await page.locator('#done').isVisible(), true);
  });
});

test('all done: the time is worded as minutes only, hours only, or both, with singular units', async () => {
  const cases = [[[45], '45 minutes'], [[1], '1 minute'], [[60], '1 hour'], [[120, 60], '3 hours'], [[60, 1], '1 hour and 1 minute'], [[30, 30, 45], '1 hour and 45 minutes']];
  for (const [mins, want] of cases) {
    await withPage({ initial: doc(mins.map((m, i) => R('r' + i, 'r' + i, m))) }, async (page) => {
      await doneAll(page, mins.length);
      assert.equal(await popup(page), `You finished all of your assignments in ${want}`, mins.join('+'));
    });
  }
});

test('all done: only a click that finishes the list opens it; loading, deleting and edits do not', async () => {
  await withPage({ initial: doc([R('a', 'a', 30, { status: 2 }), R('b', 'b', 30, { status: 2 })]) }, async (page) => {
    assert.equal(await popup(page), null, 'a finished list does not announce itself on open');
  });
  const rows = [R('a', 'a', 30, { status: 2 }), R('b', 'b', 30, { status: 1 })];
  await withPage({ initial: doc(rows) }, async (page) => {
    await page.hover('.row:nth-child(2)');
    await page.click('.row:nth-child(2) .rm'); // the only open row goes away: everything left is done, nobody checked it off
    assert.equal(await pct(page), '100%');
    assert.equal(await popup(page), null, 'deleting is not checking off');
    await page.click('.row .dv');
    await page.fill('.row .dh', '1');
    await page.keyboard.press('Enter');
    assert.equal(await popup(page), null, 'editing is not checking off');
  });
});

test('all done: it comes back each time the last row is finished again, and counts the new duration', async () => {
  await withPage({ initial: doc([R('a', 'a', 30), R('b', 'b', 30)]) }, async (page) => {
    await doneAll(page, 2);
    assert.equal(await popup(page), 'You finished all of your assignments in 1 hour');
    await page.keyboard.press('Escape');
    await page.click('.row:nth-child(2) .st'); // back to not started
    assert.equal(await popup(page), null);
    await page.click('.row .dv');
    await page.fill('.row .dm', '45'); // first row edited to 45 min
    await page.keyboard.press('Enter');
    await page.click('.row:nth-child(2) .st');
    await page.click('.row:nth-child(2) .st');
    assert.equal(await popup(page), 'You finished all of your assignments in 1 hour and 15 minutes');
  });
});

test('all done: an unfinished draft row does not hold the popup back or add time', async () => {
  await withPage({ initial: doc([R('a', 'a', 25)]) }, async (page) => {
    await page.click('#add');
    await page.keyboard.type('Draft');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape'); // draft stays, with no duration
    await page.click('.row:nth-child(1) .st');
    await page.click('.row:nth-child(1) .st');
    assert.equal(await popup(page), 'You finished all of your assignments in 25 minutes');
  });
});

test('all done: with times on, the total is the time really spent', async () => {
  await withPage({ initial: doc([R('a', 'a', 60), R('b', 'b', 60)], { times: true }), now: [9, 0] }, async (page) => {
    await page.click('.row:nth-child(1) .st');   // in progress at 9:00
    await setNow(page, 9, 40);
    await page.click('.row:nth-child(1) .st');   // done at 9:40: 40 min, planned 60
    await page.click('.row:nth-child(2) .st');   // in progress at 9:40
    await setNow(page, 10, 25);
    await page.click('.row:nth-child(2) .st');   // done at 10:25: 45 min
    assert.equal(await popup(page), 'You finished all of your assignments in 1 hour and 25 minutes');
  });
});

test('all done: closes with the X, Esc, or a click outside, but not a click on the message', async () => {
  const finish = async (page) => { await doneAll(page, 1); assert.notEqual(await popup(page), null); };
  const one = { initial: doc([R('a', 'a', 30)]) };
  await withPage(one, async (page) => {
    await finish(page);
    await page.click('#doneClose');
    assert.equal(await popup(page), null, 'X');
    assert.equal(await page.locator('#done').isVisible(), false);
  });
  await withPage(one, async (page) => {
    await finish(page);
    await page.keyboard.press('Escape');
    assert.equal(await popup(page), null, 'Esc');
  });
  await withPage(one, async (page) => {
    await finish(page);
    await page.click('#doneMsg');
    assert.notEqual(await popup(page), null, 'a click on the message keeps it open');
    await page.mouse.click(40, 400);
    assert.equal(await popup(page), null, 'a click outside');
    assert.equal(await page.$eval('.row .st', (e) => e.dataset.tip), 'Done', 'the closing click did not change the row');
  });
});

test('all done: keyboard focus starts on the close button, cycles between the two buttons, and returns to the row on close', async () => {
  await withPage({ initial: doc([R('a', 'a', 30)]) }, async (page) => {
    const active = () => page.evaluate(() => document.activeElement.id);
    await page.click('.row .st');
    await page.focus('.row .st');
    await page.keyboard.press('Enter'); // done, via the keyboard
    assert.notEqual(await popup(page), null);
    assert.equal(await active(), 'doneClose', 'the safe button first: Enter must not share anything');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'doneShare');
    await page.keyboard.press('Tab');
    assert.equal(await active(), 'doneClose', 'wraps around, never leaves the popup');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'doneShare');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await active(), 'doneClose');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.className.includes('st')), true, 'focus is back on the status button');
  });
});

test('all done: the popup sits over the page and its text is readable', async () => {
  await withPage({ initial: doc([R('a', 'a', 30)]) }, async (page) => {
    await doneAll(page, 1);
    await page.waitForTimeout(350); // let the pop-in animation finish before measuring
    const info = await page.evaluate(() => {
      const top = document.elementFromPoint(window.innerWidth / 2, 20);
      const dlg = document.querySelector('.dlg').getBoundingClientRect();
      const m = document.querySelector('#doneMsg');
      return { overlay: top.id === 'done', centered: Math.abs(dlg.left + dlg.width / 2 - window.innerWidth / 2) < 2 && Math.abs(dlg.top + dlg.height / 2 - window.innerHeight / 2) < 2, color: getComputedStyle(m).color, role: document.querySelector('#done').getAttribute('role') };
    });
    assert.equal(info.overlay, true, 'covers the page, including the progress bar');
    assert.equal(info.centered, true);
    assert.equal(info.role, 'dialog');
    assert.equal(info.color, 'rgb(231, 233, 238)');
    await settle(page);
    assert.equal((await saved(page)).rows[0].status, 2, 'the list is still saved');
  });
});

/* ---------- sharing the result as a picture ---------- */
// Init scripts that stand in for the browser's share sheet and clipboard, and record what the card draws.
const SPY = `(() => {
  window.__s = { texts: [], shares: [], clips: [], clipFail: false, shareFail: null, shareDelay: 0 };
  const ft = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, ...a) { window.__s.texts.push(String(t)); return ft.call(this, t, ...a); };
  for (const k of ['canShare', 'share', 'clipboard']) Object.defineProperty(navigator, k, { value: undefined, configurable: true });
})();`;
const WITH_SHARE = `(() => {
  Object.defineProperty(navigator, 'canShare', { value: (d) => !!(d && d.files && d.files.length), configurable: true });
  Object.defineProperty(navigator, 'share', { value: async (d) => {
    await new Promise((r) => setTimeout(r, window.__s.shareDelay));
    if (window.__s.shareFail) throw new DOMException('refused', window.__s.shareFail);
    window.__s.shares.push({ files: d.files, text: d.text });
  }, configurable: true });
})();`;
const WITH_CLIPBOARD = `(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { write: async (items) => {
    const f = window.__s.clipFail;
    if (f === true || (f === 'multi' && items[0].types.length > 1)) throw new DOMException('refused', 'NotAllowedError');
    window.__s.clips.push(items);
  } }, configurable: true });
})();`;
const two = [R('a', 'Chemistry lab report', 50), R('b', 'Secret essay', 40)];
const finishTwo = async (page) => { await doneAll(page, 2); await page.waitForTimeout(150); }; // the card is drawn as the popup opens
const clickShare = async (page) => { await page.click('#doneShare'); await page.waitForTimeout(200); };
const shareTip = (page) => page.evaluate(() => { const t = document.querySelector('#tip'); return t.classList.contains('show') ? t.textContent : null; });
const shareState = (page) => page.$eval('#doneShare', (b) => ({ tip: b.dataset.tip, label: b.getAttribute('aria-label'), ok: b.classList.contains('ok'), bad: b.classList.contains('bad') }));
const counts = (page) => page.evaluate(() => ({ shares: window.__s.shares.length, clips: window.__s.clips.length, downloads: window.__db.downloads.length }));
// Decode the picture that went out by one route, in the page, and report what it is.
const picture = (page, via) => page.evaluate(async (v) => {
  const s = window.__s;
  const blob = v === 'share' ? s.shares[0].files[0] : v === 'clip' ? await s.clips[0][0].getType('image/png') : window.__db.downloads[0].data;
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d');
  x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let green = 0;
  for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 1] > 150 && d[i] < 120 && d[i + 1] > d[i] + 50) green++;
  return { w: bmp.width, h: bmp.height, type: blob.type, size: blob.size, corner: Array.from(x.getImageData(4, 4, 1, 1).data), green, name: blob.name };
}, via);

test('share: a small icon-only button sits beside the close button, with a tooltip', async () => {
  await withPage({ initial: doc(two), init: SPY }, async (page) => {
    await finishTwo(page);
    const info = await page.evaluate(() => {
      const s = document.querySelector('#doneShare'), c = document.querySelector('#doneClose');
      const a = s.getBoundingClientRect(), b = c.getBoundingClientRect();
      return { w: a.width, h: a.height, left: a.right <= b.left, sameRow: Math.abs(a.top - b.top) < 1, text: s.textContent.trim(), svg: !!s.querySelector('svg'), tip: s.dataset.tip, label: s.getAttribute('aria-label'), closeTip: c.dataset.tip };
    });
    assert.ok(info.w <= 28 && info.h <= 28, `small: ${info.w}x${info.h}`);
    assert.equal(info.left, true, 'left of the close button');
    assert.equal(info.sameRow, true);
    assert.equal(info.text, '', 'an icon, no words');
    assert.equal(info.svg, true);
    assert.deepEqual([info.tip, info.label, info.closeTip], ['Share', 'Share', 'Close']);
    await page.hover('#doneShare');
    await page.waitForTimeout(1100);
    assert.equal(await shareTip(page), 'Share');
  });
});

test('share: where the page may use the share sheet, the picture goes there with the sentence', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_SHARE + WITH_CLIPBOARD }, async (page) => {
    await finishTwo(page);
    await clickShare(page);
    assert.deepEqual(await counts(page), { shares: 1, clips: 0, downloads: 0 }, 'the share sheet only');
    const sent = await page.evaluate(() => ({ text: window.__s.shares[0].text, n: window.__s.shares[0].files.length }));
    assert.equal(sent.n, 1);
    assert.equal(sent.text, 'You finished all of your assignments in 1 hour and 30 minutes');
    const pic = await picture(page, 'share');
    assert.deepEqual([pic.name, pic.type], ['assignments-done.png', 'image/png']);
    assert.deepEqual([pic.w, pic.h], [2400, 1260]);
    assert.equal(await shareTip(page), 'Shared', 'the result shows on the button');
    assert.deepEqual(await shareState(page), { tip: 'Shared', label: 'Shared', ok: true, bad: false });
    assert.equal(await page.$eval('#shareStatus', (e) => e.textContent), 'Shared', 'and is announced');
    await page.waitForTimeout(2400);
    assert.deepEqual(await shareState(page), { tip: 'Share', label: 'Share', ok: false, bad: false }, 'the button goes back');
    assert.equal(await shareTip(page), null);
  });
});

test('share: closing the share sheet changes nothing and falls back to nothing', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_SHARE + WITH_CLIPBOARD }, async (page) => {
    await finishTwo(page);
    await page.evaluate(() => { window.__s.shareFail = 'AbortError'; });
    await clickShare(page);
    assert.deepEqual(await counts(page), { shares: 0, clips: 0, downloads: 0 });
    assert.equal(await shareTip(page), null, 'backing out is not an error');
    assert.equal((await shareState(page)).tip, 'Share');
  });
});

test('share: a share sheet that refuses the page falls through to the clipboard', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_SHARE + WITH_CLIPBOARD }, async (page) => {
    await finishTwo(page);
    await page.evaluate(() => { window.__s.shareFail = 'NotAllowedError'; });
    await clickShare(page);
    assert.deepEqual(await counts(page), { shares: 0, clips: 1, downloads: 0 });
  });
});

test('share: without a share sheet the picture and the sentence are copied to the clipboard', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_CLIPBOARD, now: [14, 5] }, async (page) => {
    await finishTwo(page);
    await clickShare(page);
    assert.deepEqual(await counts(page), { shares: 0, clips: 1, downloads: 0 });
    const types = await page.evaluate(() => Array.from(window.__s.clips[0][0].types).sort());
    assert.deepEqual(types, ['image/png', 'text/plain']);
    const line = await page.evaluate(async () => (await (await window.__s.clips[0][0].getType('text/plain')).text()));
    assert.equal(line, 'You finished all of your assignments in 1 hour and 30 minutes');
    const pic = await picture(page, 'clip');
    assert.deepEqual([pic.type, pic.w, pic.h], ['image/png', 2400, 1260]);
    assert.deepEqual(pic.corner.slice(0, 3), [19, 21, 26], "the app's own background");
    assert.ok(pic.green > 40, `the green badge, time and bar are drawn (${pic.green})`);
    assert.ok(pic.size < 600 * 1024, `light enough to paste (${pic.size} bytes)`);
    assert.equal(await shareTip(page), 'Image copied');
    assert.equal((await shareState(page)).ok, true);
  });
});

test('share: a clipboard that takes only the picture still gets it', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_CLIPBOARD }, async (page) => {
    await finishTwo(page);
    await page.evaluate(() => { window.__s.clipFail = 'multi'; });
    await clickShare(page);
    assert.deepEqual(await counts(page), { shares: 0, clips: 1, downloads: 0 });
    assert.deepEqual(await page.evaluate(() => Array.from(window.__s.clips[0][0].types)), ['image/png']);
    assert.equal(await shareTip(page), 'Image copied');
  });
});

test('share: when the clipboard refuses, the picture is offered as a PNG download', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_CLIPBOARD }, async (page) => {
    await finishTwo(page);
    await page.evaluate(() => { window.__s.clipFail = true; });
    await clickShare(page);
    assert.deepEqual(await counts(page), { shares: 0, clips: 0, downloads: 1 });
    assert.equal(await page.evaluate(() => window.__db.downloads[0].filename), 'assignments-done.png');
    const pic = await picture(page, 'download');
    assert.deepEqual([pic.w, pic.h], [2400, 1260]);
    assert.equal(await shareTip(page), 'Image saved');
  });
});

test('share: with no share sheet and no clipboard it saves the picture', async () => {
  await withPage({ initial: doc(two), init: SPY }, async (page) => {
    await finishTwo(page);
    await clickShare(page);
    assert.deepEqual(await counts(page), { shares: 0, clips: 0, downloads: 1 });
  });
});

test('share: a declined save is quiet, a busy one says to retry, and a dead end says so and recovers', async () => {
  await withPage({ initial: doc(two), init: SPY }, async (page) => {
    await finishTwo(page);
    await page.evaluate(() => { window.__db.downloadFail = 'declined'; });
    await clickShare(page);
    assert.equal(await shareTip(page), null, 'declining the confirmation is not an error');
    assert.equal((await shareState(page)).bad, false);
    await page.evaluate(() => { window.__db.downloadFail = 'rate_limited'; });
    await clickShare(page);
    assert.equal(await shareTip(page), 'Try again in a moment');
    await page.waitForTimeout(2400);
    await page.evaluate(() => { window.__db.downloadFail = null; window.__db.noDownloads = true; });
    await clickShare(page);
    assert.equal(await shareTip(page), 'Could not share');
    assert.deepEqual(await shareState(page), { tip: 'Could not share', label: 'Could not share', ok: false, bad: true });
    await page.evaluate(() => { window.__db.noDownloads = false; });
    await page.waitForTimeout(2400);
    await clickShare(page);
    assert.equal(await shareTip(page), 'Image saved', 'the button still works afterwards');
    assert.equal(await page.evaluate(() => window.__db.downloads.length), 1);
  });
});

test('share: a double click sends the picture once', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_SHARE }, async (page) => {
    await finishTwo(page);
    await page.evaluate(() => { window.__s.shareDelay = 400; });
    await page.dblclick('#doneShare');
    await page.waitForTimeout(800);
    assert.equal((await counts(page)).shares, 1);
  });
});

test('share: the picture says how long, how many and when, and never names an assignment', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_CLIPBOARD, now: [14, 5] }, async (page) => {
    await finishTwo(page);
    const texts = await page.evaluate(() => window.__s.texts);
    assert.deepEqual(texts.slice(0, 3), ['You finished all of your assignments in', '1 hour and 30 minutes', texts[2]]);
    assert.match(texts[2], /^2 assignments · .*October.*5.*2026$/);
    assert.equal(texts[3], '100%');
    assert.doesNotMatch(texts.join(' | '), /Chemistry|Secret|lab report|essay/i);
  });
  await withPage({ initial: doc([R('a', 'Only one', 45)]), init: SPY }, async (page) => {
    await doneAll(page, 1);
    await page.waitForTimeout(150);
    const texts = await page.evaluate(() => window.__s.texts);
    assert.equal(texts[1], '45 minutes');
    assert.match(texts[2], /^1 assignment · /, 'singular for one');
  });
});

test('share: the button works from the keyboard', async () => {
  await withPage({ initial: doc(two), init: SPY + WITH_CLIPBOARD }, async (page) => {
    await finishTwo(page);
    await page.keyboard.press('Tab'); // close -> share
    assert.equal(await page.evaluate(() => document.activeElement.id), 'doneShare');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    assert.equal((await counts(page)).clips, 1);
    assert.notEqual(await popup(page), null, 'sharing leaves the popup open');
    await page.keyboard.press('Escape');
    assert.equal(await popup(page), null);
    assert.deepEqual(await shareState(page), { tip: 'Share', label: 'Share', ok: false, bad: false }, 'closing resets the button');
  });
});
