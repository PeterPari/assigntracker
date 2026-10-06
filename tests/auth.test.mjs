// The site password: the Basic Auth check (netlify/lib/auth.mjs) and the edge function that applies it to every request.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkAuth } from '../netlify/lib/auth.mjs';
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
