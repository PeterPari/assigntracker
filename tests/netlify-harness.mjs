// Test helpers for the Netlify build: a real (embedded) Postgres from @netlify/database-dev with the real
// migrations applied, and a small HTTP server that serves dist/ and routes /api/db/* through the real handler,
// with the headers from netlify.toml. No mocks of our own code.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NetlifyDB } from '@netlify/database-dev';
import { getDatabase } from '@netlify/database';
import { createHandler } from '../netlify/lib/docs-api.mjs';
import { build } from '../scripts/build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS = join(root, 'netlify', 'database', 'migrations');

export async function startTestDb() {
  const ndb = new NetlifyDB({ logger: () => {} });
  const connectionString = await ndb.start();
  await ndb.applyMigrations(MIGRATIONS);
  const conn = getDatabase({ connectionString });
  return {
    conn,
    sql: conn.sql,
    clear: () => conn.sql`DELETE FROM docs`,
    async stop() { await conn.pool.end(); await ndb.stop(); },
  };
}

/** The `[[headers]] for = "/*"` values from netlify.toml, so the tests run under the real CSP. */
export function siteHeaders() {
  const toml = readFileSync(join(root, 'netlify.toml'), 'utf8');
  const values = toml.split('[headers.values]')[1] ?? '';
  return Object.fromEntries([...values.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/gm)].map((m) => [m[1], m[2]]));
}

/**
 * Serves the built page at / and the API at /api/db/*. `server.intercept` (set by a test) may return a Response
 * to stand in for the function, e.g. a 503, and sees every API request: `server.calls` records method + path.
 */
export async function startSite(db, outDir) {
  build(outDir);
  const page = readFileSync(join(outDir, 'index.html'));
  const handler = createHandler(() => db.conn);
  const headers = siteHeaders();
  const site = { calls: [], intercept: null, url: '', close: null };

  const server = createServer(async (nreq, nres) => {
    try {
      const url = new URL(nreq.url, 'http://127.0.0.1');
      let res;
      if (url.pathname.startsWith('/api/db/')) {
        const chunks = [];
        for await (const c of nreq) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const req = new Request(new URL(nreq.url, site.url), { method: nreq.method, headers: nreq.headers, body: nreq.method === 'GET' || nreq.method === 'HEAD' ? undefined : body });
        site.calls.push({ method: nreq.method, path: url.pathname });
        res = (site.intercept && (await site.intercept(req))) || (await handler(req));
      } else if (url.pathname === '/') {
        res = new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      } else {
        res = new Response('not found', { status: 404 });
      }
      const out = { ...headers };
      res.headers.forEach((v, k) => { out[k] = v; });
      nres.writeHead(res.status, out);
      nres.end(Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      nres.writeHead(500).end(String(err));
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  site.url = `http://127.0.0.1:${server.address().port}/`;
  site.close = () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); });
  return site;
}
