// The /api/db/* handler against a real Postgres (PGlite via @netlify/database-dev) with the real migrations.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, MAX_BYTES } from '../netlify/lib/docs-api.mjs';
import { startTestDb } from './netlify-harness.mjs';

let db, handle;
before(async () => { db = await startTestDb(); handle = createHandler(() => db.conn); });
after(async () => { await db.stop(); });
beforeEach(async () => { await db.clear(); });

const URL_ = 'https://site.test/api/db/tracker/list';
const get = (url = URL_) => handle(new Request(url));
const put = (body, url = URL_, init = {}) => handle(new Request(url, { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), ...init }));
const LIST = { v: 1, times: true, chain: false, rows: [{ id: 'a1', name: 'Essay "draft" é ✓', mins: 150, status: 1, start: 540 }] };

test('the migration creates the docs table', async () => {
  const cols = await db.sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'docs' ORDER BY column_name`;
  assert.deepEqual(cols.map((c) => c.column_name), ['data', 'path', 'updated_at']);
});

test('GET before the first write is 200 with null data, so the page starts with an empty list and no console error', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { data: null });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('PUT then GET round-trips the document exactly', async () => {
  const res = await put(LIST);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const back = await get();
  assert.equal(back.status, 200);
  assert.equal(back.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(back.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await back.json()).data, LIST);
});

test('a second PUT replaces the document, and there is still one row in the table', async () => {
  await put(LIST);
  await put({ ...LIST, rows: [], times: false });
  assert.deepEqual((await (await get()).json()).data, { ...LIST, rows: [], times: false });
  const [{ n }] = await db.sql`SELECT count(*)::int AS n FROM docs`;
  assert.equal(n, 1);
});

test('only tracker/list exists: other paths are 404 and nothing is stored', async () => {
  for (const p of ['other/doc', 'tracker', 'tracker/list/extra', 'tracker/List', '../tracker/list', '']) {
    const url = `https://site.test/api/db/${p}`;
    assert.equal((await get(url)).status, 404, `GET ${p}`);
    assert.equal((await put(LIST, url)).status, 404, `PUT ${p}`);
  }
  assert.equal((await handle(new Request('https://site.test/elsewhere'))).status, 404);
  const [{ n }] = await db.sql`SELECT count(*)::int AS n FROM docs`;
  assert.equal(n, 0);
});

test('other methods are 405 and name the allowed ones', async () => {
  for (const method of ['POST', 'DELETE', 'PATCH']) {
    const res = await handle(new Request(URL_, { method, body: method === 'DELETE' ? undefined : '{}' }));
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, PUT');
  }
});

test('bad bodies are 400 and never overwrite the stored list', async () => {
  await put(LIST);
  for (const body of ['', 'not json', '[1,2]', '"text"', '42', 'null', '{"name":"a\\u0000b"}']) {
    assert.equal((await put(body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await (await get()).json()).data, LIST);
});

test('a body over the limit is 413, by header or by actual size', async () => {
  await put(LIST);
  const big = JSON.stringify({ pad: 'x'.repeat(MAX_BYTES) });
  assert.equal((await put(big)).status, 413);
  assert.equal((await put('{}', URL_, { headers: { 'content-length': String(MAX_BYTES + 1) } })).status, 413);
  assert.deepEqual((await (await get()).json()).data, LIST);
  const edge = JSON.stringify({ pad: 'x'.repeat(MAX_BYTES - 20) });
  assert.equal((await put(edge)).status, 200, 'just under the limit is fine');
});

test('data is stored as given: quotes, emoji, escapes and nested values survive', async () => {
  const odd = { v: 1, rows: [{ id: "o'1", name: 'a\\b "q" 😀 </script> $1 ${x}', mins: 5, status: 0, start: null }] };
  assert.equal((await put(odd)).status, 200);
  assert.deepEqual((await (await get()).json()).data, odd);
});

test('a database failure is a 500 with no details, and no write is claimed', async () => {
  const broken = createHandler(() => ({ sql: async () => { throw new Error('connection refused to db.internal:5432'); } }));
  const log = console.error;
  console.error = () => {};
  try {
    for (const res of [await broken(new Request(URL_)), await broken(new Request(URL_, { method: 'PUT', body: '{}' }))]) {
      assert.equal(res.status, 500);
      const text = await res.text();
      assert.deepEqual(JSON.parse(text), { error: 'unavailable' });
      assert.ok(!text.includes('db.internal'), 'no internals in the response');
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
  } finally { console.error = log; }
});
