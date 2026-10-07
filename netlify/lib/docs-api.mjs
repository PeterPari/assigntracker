// HTTP handler behind /api/db/*: the Netlify stand-in for the Claude Artifact `db` capability.
// It reads and writes whole JSON documents in the `docs` table (see netlify/database/migrations):
//   tracker/list   the list                      GET, PUT
//   saves/<id>     one save (the save button)    GET, PUT
//   saves          every save, ordered by id     GET
// Plain Request in, Response out, so the function entry and the tests share it.

const PREFIX = '/api/db/';
// A public endpoint: only the page's own documents, never arbitrary keys.
const DOC = /^(?:tracker\/list|saves\/[A-Za-z0-9_-]{1,64})$/;
const COLLECTIONS = new Set(['saves']);
export const MAX_BYTES = 256 * 1024;

const reply = (status, body, headers) => new Response(body === undefined ? null : JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

/** @param {() => { sql: Function }} getDb  returns the Netlify Database connection (see `getDatabase` in @netlify/database) */
export function createHandler(getDb) {
  return async (req) => {
    const { pathname } = new URL(req.url);
    const path = pathname.startsWith(PREFIX) ? pathname.slice(PREFIX.length) : '';
    if (COLLECTIONS.has(path)) {
      if (req.method !== 'GET') return reply(405, { error: 'method not allowed' }, { allow: 'GET' });
      try {
        const prefix = path + '/'; // a fixed name, so no LIKE wildcards in it
        const rows = await getDb().sql`SELECT path, data FROM docs WHERE path LIKE ${prefix + '%'} ORDER BY path`;
        return reply(200, { docs: rows.map((r) => ({ id: r.path.slice(prefix.length), data: r.data })) });
      } catch (err) {
        console.error('docs-api:', err);
        return reply(500, { error: 'unavailable' });
      }
    }
    if (!DOC.test(path)) return reply(404, { error: 'not found' });
    if (req.method !== 'GET' && req.method !== 'PUT') return reply(405, { error: 'method not allowed' }, { allow: 'GET, PUT' });

    try {
      if (req.method === 'GET') {
        const rows = await getDb().sql`SELECT data FROM docs WHERE path = ${path}`;
        // 200 with `data: null` for a document that was never written: a 404 would put a red error in every first visitor's console
        return reply(200, { data: rows.length ? rows[0].data : null });
      }

      if (Number(req.headers.get('content-length')) > MAX_BYTES) return reply(413, { error: 'too large' });
      const text = await req.text();
      if (new TextEncoder().encode(text).length > MAX_BYTES) return reply(413, { error: 'too large' });
      let data;
      try { data = JSON.parse(text); } catch { return reply(400, { error: 'body must be JSON' }); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return reply(400, { error: 'body must be a JSON object' });
      if (text.includes('\\u0000')) return reply(400, { error: 'body has a NUL character' }); // Postgres jsonb cannot store it
      await getDb().sql`
        INSERT INTO docs (path, data, updated_at) VALUES (${path}, ${text}::jsonb, now())
        ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      return reply(200, { ok: true });
    } catch (err) {
      console.error('docs-api:', err); // details stay in the function log, not in the response
      return reply(500, { error: 'unavailable' });
    }
  };
}
