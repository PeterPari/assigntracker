// The password form behind the 401, in Chromium as an iPad home-screen app sees it: no login box, so the form is the
// way in. The real edge function runs in front of a stand-in site, under the headers (CSP included) from netlify.toml.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ipad, loadPlaywright } from './harness.mjs';
import { siteHeaders } from './netlify-harness.mjs';
import edge from '../netlify/edge-functions/auth.mjs';

const PASSWORD = 'correct horse battery staple';
const { chromium } = loadPlaywright();
let browser, server, url;
const realNetlify = globalThis.Netlify;

before(async () => {
  globalThis.Netlify = { env: { get: (name) => (name === 'SITE_PASSWORD' ? PASSWORD : undefined) } };
  const headers = siteHeaders();
  const context = {
    next: async () => new Response('<!doctype html><meta charset="utf-8"><title>App</title><p id="app">signed in</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } }),
  };
  server = createServer(async (nreq, nres) => {
    const chunks = [];
    for await (const c of nreq) chunks.push(c);
    const body = nreq.method === 'GET' || nreq.method === 'HEAD' ? undefined : Buffer.concat(chunks);
    const res = await edge(new Request(new URL(nreq.url, url), { method: nreq.method, headers: nreq.headers, body }), context);
    const out = { ...headers };
    res.headers.forEach((v, k) => { out[k] = v; });
    nres.writeHead(res.status, out);
    nres.end(Buffer.from(await res.arrayBuffer()));
  });
  await new Promise((r) => server.listen(0, 'localhost', r));
  url = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  if (realNetlify === undefined) delete globalThis.Netlify; else globalThis.Netlify = realNetlify;
});

test('the form signs in, says so when the password is wrong, and the cookie keeps the app signed in', async () => {
  const ctx = await browser.newContext(ipad());
  try {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/401|403/.test(m.text())) errors.push(m.text()); }); // CSP violations show up here
    const first = await page.goto(url);
    assert.equal(first.status(), 401);
    assert.equal(await page.locator('#pw').isVisible(), true);
    assert.equal(await page.$eval('#pw', (e) => parseFloat(getComputedStyle(e).fontSize)), 16, 'no zoom on focus');
    await page.tap('#pw');
    await page.keyboard.type('wrong');
    await page.keyboard.press('Enter'); // the keyboard's Go key
    await page.waitForSelector('#m:text("Wrong password")');
    await page.fill('#pw', PASSWORD);
    await Promise.all([page.waitForNavigation(), page.tap('button[type=submit]')]);
    assert.equal(await page.textContent('#app'), 'signed in');
    const cookies = await ctx.cookies();
    assert.equal(cookies.length, 1);
    assert.equal(cookies[0].httpOnly, true);
    assert.ok(cookies[0].expires * 1000 > Date.now() + 300 * 24 * 3600 * 1000, 'kept for months, across launches');

    const again = await ctx.newPage(); // the app opened again later
    const res = await again.goto(url + 'anything');
    assert.equal(res.status(), 200);
    assert.equal(await again.textContent('#app'), 'signed in');
    assert.deepEqual(errors, [], 'no console, page or CSP errors');
  } finally { await ctx.close(); }
});

test('the browser login box still works, and signs the app in for next time', async () => {
  const ctx = await browser.newContext({ ...ipad(), httpCredentials: { username: 'peter', password: PASSWORD } });
  try {
    const page = await ctx.newPage();
    await page.goto(url);
    assert.equal(await page.textContent('#app'), 'signed in');
    assert.equal((await ctx.cookies()).length, 1);
  } finally { await ctx.close(); }
});
