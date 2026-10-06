// The Netlify build in real Chromium: dist/index.html + shim + the real /api/db handler + real Postgres,
// served with the headers (CSP included) from netlify.toml. Complements e2e.test.mjs, which covers the page itself.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlaywright } from './harness.mjs';
import { startSite, startTestDb } from './netlify-harness.mjs';

const { chromium } = loadPlaywright();
let browser, db, site, outDir;
before(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'assigntracker-dist-'));
  db = await startTestDb();
  site = await startSite(db, outDir);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await site?.close();
  await db?.stop();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});
beforeEach(async () => { await db.clear(); site.calls.length = 0; site.intercept = null; });

const stored = async () => (await db.sql`SELECT data FROM docs WHERE path = 'tracker/list'`)[0]?.data;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = (page) => page.waitForTimeout(700); // debounce (400 ms) + write
const warnShown = (page) => page.$eval('#warn', (e) => !e.hidden);
const names = (page) => page.$$eval('.row .nmi', (els) => els.map((e) => e.value));
const R = (id, name, mins, o = {}) => ({ id, name, mins, status: 0, start: null, ...o });
const seed = async (rows, o = {}) => {
  const res = await fetch(`${site.url}api/db/tracker/list`, { method: 'PUT', body: JSON.stringify({ v: 1, times: false, chain: true, rows, ...o }) });
  assert.equal(res.status, 200);
  site.calls.length = 0; // only what the page does is counted
};

async function openSite({ init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); // CSP violations show up here too
  if (init) await page.addInitScript(init);
  await page.goto(site.url);
  await page.waitForTimeout(250); // let load() finish
  return { ctx, page, errors };
}
async function withSite(opts, fn) {
  const { ctx, page, errors } = await openSite(opts);
  try { await fn(page, errors); } finally { await ctx.close(); }
}
async function addRow(page, name, h, m) {
  await page.click('#add');
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  if (h) await page.keyboard.type(String(h));
  await page.keyboard.press('Tab');
  if (m) await page.keyboard.type(String(m));
  await page.keyboard.press('Enter');
}

test('the built page is a complete document, loads under the site CSP, and reads the list once', async () => {
  await withSite({}, async (page, errors) => {
    const doc = await page.evaluate(() => ({
      doctype: document.doctype && document.doctype.name,
      charset: document.characterSet,
      lang: document.documentElement.lang,
      viewport: document.querySelector('meta[name=viewport]')?.content,
      title: document.head.querySelector('title')?.textContent,
      styleInHead: !!document.head.querySelector('style'),
      icon: !!document.head.querySelector('link[rel=icon]'),
      manifest: document.head.querySelector('link[rel=manifest]')?.getAttribute('href'),
      touchIcon: document.head.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href'),
    }));
    assert.deepEqual(doc, { doctype: 'html', charset: 'UTF-8', lang: 'en', viewport: 'width=device-width, initial-scale=1, viewport-fit=cover', title: 'Assignment Tracker', styleInHead: true, icon: true, manifest: '/manifest.webmanifest', touchIcon: '/apple-touch-icon.png' });
    assert.equal(await page.textContent('#pct'), '0%');
    assert.equal(await warnShown(page), false, 'no warning icon: the database answered');
    assert.deepEqual(errors, [], 'no console, page or CSP errors');
    assert.deepEqual(site.calls, [{ method: 'GET', path: '/api/db/tracker/list' }]);
    const res = await fetch(site.url);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('the manifest and every icon load under the site CSP, with no console errors', async () => {
  await withSite({}, async (page, errors) => {
    const cdp = await page.context().newCDPSession(page);
    const { url, errors: manifestErrors, data } = await cdp.send('Page.getAppManifest');
    assert.equal(url, site.url + 'manifest.webmanifest');
    assert.deepEqual(manifestErrors, []);
    const manifest = JSON.parse(data);
    assert.equal(manifest.name, 'Assignment Tracker');
    assert.equal(manifest.display, 'standalone');
    const icons = await page.evaluate(async () => Promise.all(
      [document.querySelector('link[rel=apple-touch-icon]').href, ...(await (await fetch('/manifest.webmanifest')).json()).icons.map((i) => new URL(i.src, location.href).href)]
        .map(async (href) => {
          const res = await fetch(href);
          const bitmap = await createImageBitmap(await res.blob());
          return [new URL(href).pathname, res.status, res.headers.get('content-type'), bitmap.width, bitmap.height];
        }),
    ));
    assert.deepEqual(icons, [
      ['/apple-touch-icon.png', 200, 'image/png', 512, 512],
      ['/icons/icon-192.png', 200, 'image/png', 192, 192],
      ['/icons/icon-512.png', 200, 'image/png', 512, 512],
      ['/icons/icon-maskable-512.png', 200, 'image/png', 512, 512],
    ]);
    assert.deepEqual(errors, [], 'no console, page or CSP errors');
  });
});

// Chromium's own "can this be installed?" check (the one behind Chrome's Install button) only runs in the full
// browser with a real profile: the headless shell and incognito-style contexts report nothing at all.
test('Chromium says the built site can be installed as an app (and says why not for a page without a manifest)', async () => {
  const profile = mkdtempSync(join(tmpdir(), 'assigntracker-profile-'));
  const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true });
  try {
    const check = async (url) => {
      const page = await ctx.newPage();
      try {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Page.enable');
        await page.goto(url);
        await cdp.send('Page.getAppManifest'); // makes Chromium fetch the manifest before it is judged
        return (await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.map((e) => e.errorId);
      } finally { await page.close(); }
    };
    assert.deepEqual(await check(site.url + 'no-such-page'), ['no-manifest'], 'the check is live: it does flag a page without a manifest');
    assert.deepEqual(await check(site.url), [], 'nothing stops the site from being installed');
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
});

test('a new row is saved in the database and is there after a reload', async () => {
  await withSite({}, async (page, errors) => {
    await addRow(page, 'Essay draft', 2, 30);
    await settle(page);
    const doc = await stored();
    assert.equal(doc.v, 1);
    assert.deepEqual(doc.rows.map((r) => [r.name, r.mins, r.status]), [['Essay draft', 150, 0]]);
    await page.reload();
    await page.waitForTimeout(250);
    assert.deepEqual(await names(page), ['Essay draft']);
    assert.equal(await page.$eval('.row .dv', (e) => e.textContent.trim()), '2 hrs 30 min');
    assert.equal(await warnShown(page), false);
    assert.deepEqual(errors, []);
  });
});

test('status, order, toggles and clear are saved and come back', async () => {
  await seed([R('a', 'One', 30), R('b', 'Two', 45), R('c', 'Three', 60)]);
  await withSite({}, async (page) => {
    assert.deepEqual(await names(page), ['One', 'Two', 'Three']);
    await page.click('.row .st'); await page.click('.row .st'); // first row: done
    await page.click('#times');
    await settle(page);
    const doc = await stored();
    assert.deepEqual(doc.rows.map((r) => r.status), [2, 0, 0]);
    assert.equal(doc.times, true);
    await page.reload();
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#chain').isVisible(), true, 'times came back on');
    assert.equal(await page.locator('.row.done').count(), 1);
    await page.click('#clear'); await page.click('#clear');
    await settle(page);
    assert.deepEqual((await stored()).rows, []);
  });
});

test('another browser sees the same list', async () => {
  await withSite({}, async (one) => {
    await addRow(one, 'Shared task', 1, 0);
    await settle(one);
    await withSite({}, async (two) => {
      assert.deepEqual(await names(two), ['Shared task']);
      await two.click('.row .st');
      await settle(two);
      await one.reload();
      await one.waitForTimeout(250);
      assert.equal(await one.locator('.row.s1').count(), 1, 'the other browser\'s change shows after a reload');
    });
  });
});

test('a load that fails once is retried and the list appears', async () => {
  await seed([R('a', 'Kept', 20)]);
  let gets = 0;
  site.intercept = (req) => (req.method === 'GET' && gets++ === 0 ? new Response('down', { status: 503 }) : null);
  await withSite({}, async (page) => {
    await page.waitForTimeout(900); // the page waits 600 ms before its one retry
    assert.deepEqual(await names(page), ['Kept']);
    assert.equal(await warnShown(page), false);
    assert.equal(gets, 2);
  });
});

test('a list that cannot be read is never overwritten', async () => {
  await seed([R('a', 'Precious', 20)]);
  site.intercept = (req) => (req.method === 'GET' ? new Response('down', { status: 503 }) : null);
  await withSite({}, async (page) => {
    await page.waitForTimeout(900);
    assert.equal(await warnShown(page), true, 'the warning shows');
    await addRow(page, 'Typed anyway', 1, 0);
    await settle(page);
    assert.equal(site.calls.filter((c) => c.method === 'PUT').length, 0, 'no write was attempted');
    assert.deepEqual((await stored()).rows.map((r) => r.name), ['Precious']);
  });
});

test('an HTML page where the function should be counts as unreadable, not as an empty list', async () => {
  await seed([R('a', 'Precious', 20)]);
  site.intercept = (req) => (req.method === 'GET' ? new Response('<!doctype html><title>x</title>', { headers: { 'content-type': 'text/html' } }) : null);
  await withSite({}, async (page) => {
    await page.waitForTimeout(400);
    assert.equal(await warnShown(page), true);
    await addRow(page, 'Typed anyway', 1, 0);
    await settle(page);
    assert.deepEqual((await stored()).rows.map((r) => r.name), ['Precious']);
  });
});

test('a failed save shows the warning, and the next change saves everything', async () => {
  await withSite({}, async (page) => {
    site.intercept = (req) => (req.method === 'PUT' ? new Response('down', { status: 503 }) : null);
    await addRow(page, 'First', 1, 0);
    await page.waitForTimeout(2600); // debounce, the failed write, the one retry
    assert.equal(await warnShown(page), true);
    assert.equal(await stored(), undefined);
    site.intercept = null;
    await addRow(page, 'Second', 0, 30);
    await settle(page);
    assert.equal(await warnShown(page), false, 'the warning clears once a save works');
    assert.deepEqual((await stored()).rows.map((r) => r.name), ['First', 'Second']);
  });
});

test('an edit made while the tab is closing still reaches the database', async () => {
  await withSite({}, async (page) => {
    await addRow(page, 'Last second', 1, 15);
    await page.close(); // before the 400 ms debounce: the page's pagehide handler has to flush it (the shim sends it with keepalive)
    for (let i = 0; i < 30 && !(await stored()); i++) await sleep(100);
    assert.deepEqual((await stored())?.rows.map((r) => r.name), ['Last second']);
  });
});

test('with no share sheet or clipboard, share saves the picture as a PNG download', async () => {
  await seed([R('a', 'Secret essay', 40, { status: 1 })]);
  const NONE = `for (const k of ['canShare', 'share', 'clipboard']) Object.defineProperty(navigator, k, { value: undefined, configurable: true });`;
  await withSite({ init: NONE }, async (page, errors) => {
    await page.click('.row .st'); // in progress -> done: the all-done popup opens
    await page.waitForSelector('#doneShare', { state: 'visible' });
    await page.waitForTimeout(300); // the card is drawn as the popup opens
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#doneShare')]);
    assert.equal(download.suggestedFilename(), 'assignments-done.png');
    const png = readFileSync(await download.path());
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a real PNG');
    assert.ok(png.length > 5000);
    assert.equal(await page.evaluate(() => { const t = document.querySelector('#tip'); return t.classList.contains('show') ? t.textContent : null; }), 'Image saved');
    assert.deepEqual(errors, []);
  });
});
