// The site password: the Basic Auth check (netlify/lib/auth.mjs) and the edge function that applies it to every request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkAuth, hasSession, login, LOGIN_PATH, SESSION_COOKIE, sessionCookie } from '../netlify/lib/auth.mjs';
import edge, { config } from '../netlify/edge-functions/auth.mjs';

const PASSWORD = 'correct horse battery staple';
const basic = (user, password) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
const req = (authorization, url = 'https://site.test/', init = {}) =>
  new Request(url, { ...init, headers: authorization === undefined ? {} : { authorization } });

async function assertChallenge(res) {
  assert.ok(res, 'expected a 401, but the request was let through');
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /^Basic realm="[^"]+", charset="UTF-8"$/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.doesNotMatch(await res.text(), /horse/);
}

test('the right password lets the request through, whatever the username', async () => {
  for (const user of ['peter', 'anyone', '', 'a b', 'é✓']) {
    assert.equal(await checkAuth(req(basic(user, PASSWORD)), PASSWORD), null, `username ${JSON.stringify(user)}`);
  }
});

test('the scheme name is not case sensitive', async () => {
  assert.equal(await checkAuth(req('basic ' + Buffer.from(`u:${PASSWORD}`).toString('base64')), PASSWORD), null);
});

test('no credentials get a 401 that asks the browser for a login', async () => {
  await assertChallenge(await checkAuth(req(), PASSWORD));
});

test('a wrong password gets a 401', async () => {
  for (const wrong of ['', 'wrong', PASSWORD.toUpperCase(), PASSWORD + ' ', PASSWORD.slice(0, -1), ` ${PASSWORD}`]) {
    await assertChallenge(await checkAuth(req(basic('peter', wrong)), PASSWORD));
  }
});

test('only the password counts: the right username with a wrong password, and the password as the username, are refused', async () => {
  await assertChallenge(await checkAuth(req(basic(PASSWORD, 'nope')), PASSWORD));
  await assertChallenge(await checkAuth(req(basic(PASSWORD, '')), PASSWORD));
});

test('malformed Authorization headers get a 401, not an error', async () => {
  const headers = [
    'Bearer ' + PASSWORD,
    'Basic',
    'Basic ',
    'Basic !!!not-base64!!!',
    'Basic ' + Buffer.from(PASSWORD).toString('base64'),            // no "user:" part
    'Basic ' + Buffer.from([0xff, 0xfe, 0x3a, 0xc3, 0x28]).toString('base64'), // not valid UTF-8
    PASSWORD,
  ];
  for (const h of headers) await assertChallenge(await checkAuth(req(h), PASSWORD));
});

test('a password with colons, spaces and non-ASCII characters works', async () => {
  for (const pw of ['a:b:c', ':leading', 'trailing:', 'with space', 'pässwörd ✓ 日本語', 'x'.repeat(5000)]) {
    assert.equal(await checkAuth(req(basic('u', pw)), pw), null, pw.slice(0, 20));
    await assertChallenge(await checkAuth(req(basic('u', pw + 'x')), pw));
  }
});

test('with no password configured the site is closed, not open', async () => {
  for (const pw of [undefined, null, '']) {
    for (const auth of [undefined, basic('u', ''), basic('u', 'anything')]) {
      const res = await checkAuth(req(auth), pw);
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.match(await res.text(), /SITE_PASSWORD/);
    }
  }
});

// The edge function reads the password from the Netlify.env global that exists on Netlify Edge.
let envPassword;
const ran = [];
const context = { next: async () => { ran.push('next'); return new Response('the page'); } };
const realNetlify = globalThis.Netlify;
before(() => { globalThis.Netlify = { env: { get: (name) => (name === 'SITE_PASSWORD' ? envPassword : undefined) } }; });
after(() => { if (realNetlify === undefined) delete globalThis.Netlify; else globalThis.Netlify = realNetlify; });

test('the edge function covers every path', () => {
  assert.equal(config.path, '/*');
});

test('the edge function serves the page and the database API only to the right password', async () => {
  envPassword = PASSWORD;
  const targets = [
    ['/', {}],
    ['/index.html', {}],
    ['/api/db/tracker/list', {}],
    ['/api/db/tracker/list', { method: 'PUT', body: '{"v":1}' }],
    ['/anything/else', { method: 'DELETE' }],
  ];
  for (const [path, init] of targets) {
    const url = 'https://site.test' + path;

    ran.length = 0;
    await assertChallenge(await edge(req(undefined, url, init), context));
    await assertChallenge(await edge(req(basic('peter', 'wrong'), url, init), context));
    assert.deepEqual(ran, [], `${init.method ?? 'GET'} ${path} reached the site without the password`);

    const res = await edge(req(basic('peter', PASSWORD), url, init), context);
    assert.equal(await res.text(), 'the page');
    assert.deepEqual(ran, ['next'], `${init.method ?? 'GET'} ${path} with the password`);
  }
});

test('the edge function does not let anything through when SITE_PASSWORD is not set', async () => {
  envPassword = undefined;
  ran.length = 0;
  const res = await edge(req(basic('peter', ''), 'https://site.test/api/db/tracker/list', { method: 'PUT', body: '{}' }), context);
  assert.equal(res.status, 503);
  assert.deepEqual(ran, []);
});

// Browsers fetch the manifest and the app icons without the page's credentials when they install the site as an
// app, so these exact paths are served without the password. Nothing else is.
const PUBLIC = ['/manifest.webmanifest', '/apple-touch-icon.png', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];

test('the manifest and the app icons are served without the password, with a wrong one, and with the right one', async () => {
  envPassword = PASSWORD;
  for (const path of PUBLIC) {
    for (const auth of [undefined, basic('peter', 'wrong'), basic('peter', PASSWORD)]) {
      ran.length = 0;
      const res = await edge(req(auth, 'https://site.test' + path), context);
      assert.equal(await res.text(), 'the page', path);
      assert.deepEqual(ran, ['next'], path);
    }
  }
});

test('only those exact paths are open: look-alikes, other files and the API still need the password', async () => {
  envPassword = PASSWORD;
  const closed = [
    '/', '/index.html', '/api/db/tracker/list', '/icons/', '/icons/other.png', '/icons/icon-192.png/', '/icons/icon-192.png/x',
    '/manifest.webmanifest/x', '/manifest.webmanifest.map', '/Manifest.webmanifest', '/icons/../index.html', '/icons/%2e%2e/index.html',
    '/apple-touch-icon-precomposed.png', '/favicon.ico', '/icons/icon-192.png%00.html',
  ];
  for (const path of closed) {
    ran.length = 0;
    await assertChallenge(await edge(req(undefined, 'https://site.test' + path), context));
    assert.deepEqual(ran, [], `${path} reached the site without the password`);
  }
  // a query string does not change the path, so it opens nothing more either way
  ran.length = 0;
  assert.equal(await (await edge(req(undefined, 'https://site.test/manifest.webmanifest?v=2'), context)).text(), 'the page');
  ran.length = 0;
  await assertChallenge(await edge(req(undefined, 'https://site.test/?/manifest.webmanifest'), context));
  assert.deepEqual(ran, []);
});

test('the open paths are served even when SITE_PASSWORD is not set, and everything else stays closed with a 503', async () => {
  envPassword = undefined;
  ran.length = 0;
  assert.equal(await (await edge(req(undefined, 'https://site.test/apple-touch-icon.png'), context)).text(), 'the page');
  assert.deepEqual(ran, ['next']);
  ran.length = 0;
  const res = await edge(req(undefined, 'https://site.test/'), context);
  assert.equal(res.status, 503);
  assert.deepEqual(ran, []);
});

// The session cookie, for a home-screen web app on an iPad, which does not keep (and may not show) the browser's login box.
const cookieOf = (res) => res.headers.get('set-cookie')?.split(';')[0];
const loginReq = (body, init = {}) => new Request('https://site.test' + LOGIN_PATH, { method: 'POST', body, ...init });

test('the 401 page is a password form for apps that show no login box, and never holds the password', async () => {
  const res = await checkAuth(req(), PASSWORD);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const html = await res.text();
  assert.match(html, /<input[^>]+type="password"/);
  assert.match(html, new RegExp(`fetch\\('${LOGIN_PATH}'`));
  assert.doesNotMatch(html, /horse/);
});

test('logging in with the right password sets a long-lived, HttpOnly, Secure session cookie', async () => {
  const res = await login(loginReq(PASSWORD), PASSWORD);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const set = res.headers.get('set-cookie');
  assert.match(set, new RegExp(`^${SESSION_COOKIE}=[0-9a-f]{64}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
  assert.ok(Number(/Max-Age=(\d+)/.exec(set)[1]) >= 365 * 24 * 3600, 'kept for a year or more');
  assert.doesNotMatch(set, /horse/);
  assert.equal(set, await sessionCookie(PASSWORD));
});

test('a wrong password, a GET, or no password configured: no cookie, and never a login box', async () => {
  for (const wrong of ['', 'wrong', PASSWORD + ' ', 'x'.repeat(20000)]) {
    const res = await login(loginReq(wrong), PASSWORD);
    assert.equal(res.status, 403);
    assert.equal(res.headers.get('set-cookie'), null);
    assert.equal(res.headers.get('www-authenticate'), null, 'a wrong password must not open the browser login box');
  }
  const get = await login(new Request('https://site.test' + LOGIN_PATH), PASSWORD);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('set-cookie'), null);
  for (const pw of [undefined, '']) {
    const res = await login(loginReq(''), pw);
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('set-cookie'), null);
  }
});

test('the session cookie lets requests through; a wrong, old or forged one does not', async () => {
  const good = cookieOf(await login(loginReq(PASSWORD), PASSWORD));
  const withCookie = (c) => new Request('https://site.test/api/db/tracker/list', { headers: { cookie: c } });
  assert.equal(await checkAuth(withCookie(good), PASSWORD), null);
  assert.equal(await checkAuth(withCookie(`other=1; ${good}; more=2`), PASSWORD), null, 'among other cookies');
  assert.equal(await hasSession(withCookie(good), PASSWORD), true);
  const forged = [
    `${SESSION_COOKIE}=${'0'.repeat(64)}`, `${SESSION_COOKIE}=`, `${SESSION_COOKIE}=${PASSWORD}`, `${SESSION_COOKIE}=${good.split('=')[1].toUpperCase()}`,
    `x${good}`, good.slice(0, -1),
  ];
  for (const c of forged) await assertChallenge(await checkAuth(withCookie(c), PASSWORD));
  await assertChallenge(await checkAuth(withCookie(good), 'a new password'), 'changing SITE_PASSWORD signs everyone out');
  assert.equal((await checkAuth(withCookie(good), undefined)).status, 503, 'no password set: closed, cookie or not');
});

test('the edge function: log in at LOGIN_PATH, then the cookie opens the page and the API', async () => {
  envPassword = PASSWORD;
  ran.length = 0;
  const bad = await edge(loginReq('wrong'), context);
  assert.equal(bad.status, 403);
  const res = await edge(loginReq(PASSWORD), context);
  assert.equal(res.status, 204);
  assert.deepEqual(ran, [], 'logging in serves nothing of the site');
  const cookie = cookieOf(res);
  for (const path of ['/', '/api/db/tracker/list']) {
    ran.length = 0;
    const page = await edge(new Request('https://site.test' + path, { headers: { cookie } }), context);
    assert.equal(await page.text(), 'the page');
    assert.equal(page.headers.get('set-cookie'), null, 'already signed in: no new cookie');
    assert.deepEqual(ran, ['next']);
  }
});

test('the edge function: signing in through the login box also hands out the cookie', async () => {
  envPassword = PASSWORD;
  ran.length = 0;
  const res = await edge(req(basic('peter', PASSWORD), 'https://site.test/'), context);
  assert.equal(await res.text(), 'the page');
  assert.equal(res.headers.get('set-cookie'), await sessionCookie(PASSWORD));
  const later = await edge(new Request('https://site.test/', { headers: { cookie: cookieOf(res) } }), context);
  assert.equal(await later.text(), 'the page');
});
