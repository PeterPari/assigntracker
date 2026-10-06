/* Stand-in for the Claude Artifact runtime on a normal website. The page only ever calls
 *   claude.use('db').doc(path).get() / .set(data)       -> shared list, kept in Netlify Database
 *   claude.use('downloads').save({ filename, data })    -> save a picture as a file
 * so this provides exactly that, over /api/db/* (netlify/functions/db.mjs). Inside a Claude Artifact the real
 * runtime is already there and this does nothing. Errors carry the same `code`s the page already handles. */
(() => {
  if (window.claude && window.claude.use) return;

  const API = '/api/db/';
  const fail = (code, status) => Object.assign(new Error(code), { code, status });

  async function call(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        cache: 'no-store',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body,
        // lets the save the page fires while it is being closed finish (browsers cap keepalive bodies at 64 KB)
        keepalive: body !== undefined && new TextEncoder().encode(body).length < 60000,
      });
    } catch (_) { throw fail('unavailable'); }
    if (res.status >= 500) throw fail('unavailable', res.status);
    return res;
  }

  const db = {
    doc: (path) => ({
      path,
      async get() {
        const res = await call('GET', path);
        if (!res.ok) throw fail('failed', res.status);
        let body;
        try { body = await res.json(); } catch (_) { throw fail('failed', res.status); } // e.g. an HTML page where the function should be
        if (!body || body.data === undefined || typeof body.data !== 'object') throw fail('failed', res.status);
        if (body.data === null) return { exists: false, data: () => undefined }; // never written yet
        return { exists: true, data: () => JSON.parse(JSON.stringify(body.data)) };
      },
      async set(data) {
        const res = await call('PUT', path, JSON.stringify(data));
        if (!res.ok) throw fail(res.status === 413 || res.status === 400 ? 'invalid' : 'failed', res.status);
      },
    }),
  };

  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.hidden = true;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { status: 'saved' };
    },
  };

  window.claude = { use: async (name) => (name === 'db' ? db : name === 'downloads' ? downloads : null) };
})();
