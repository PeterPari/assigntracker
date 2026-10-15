/* Stand-in for the Claude Artifact runtime on a normal website. The page only ever calls
 *   claude.use('db').doc(path).get() / .set(data)       -> shared list and each save, kept in Netlify Database
 *   claude.use('db').collection(path)                   -> every save, read back with where / orderBy / limit / get
 *   claude.use('downloads').save({ filename, data })    -> save a picture or the saves CSV as a file
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

  // A collection query. The function returns the whole collection, and the filters, order and limit apply here.
  const OPS = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
  const query = (path, q) => ({
    where: (field, op, value) => {
      if (!OPS[op]) throw new TypeError('unsupported operator ' + op);
      return query(path, { ...q, where: [...q.where, [field, op, value]] });
    },
    orderBy: (field, dir = 'asc') => query(path, { ...q, order: [field, dir === 'desc' ? -1 : 1] }),
    limit: (n) => query(path, { ...q, limit: n }),
    async get() {
      const res = await call('GET', path);
      if (!res.ok) throw fail('failed', res.status);
      let body;
      try { body = await res.json(); } catch (_) { throw fail('failed', res.status); }
      if (!body || !Array.isArray(body.docs)) throw fail('failed', res.status);
      let docs = body.docs.filter((d) => d && typeof d.id === 'string' && d.data && typeof d.data === 'object');
      for (const [f, op, v] of q.where) docs = docs.filter((d) => d.data[f] !== undefined && OPS[op](d.data[f], v));
      if (q.order) {
        const [f, s] = q.order;
        docs.sort((a, b) => (a.data[f] === undefined) - (b.data[f] === undefined) || (a.data[f] < b.data[f] ? -s : a.data[f] > b.data[f] ? s : 0));
      }
      if (q.limit) docs = docs.slice(0, q.limit);
      const out = docs.map((d) => ({ id: d.id, exists: true, data: () => JSON.parse(JSON.stringify(d.data)) }));
      return { docs: out, size: out.length, empty: !out.length };
    },
  });

  const db = {
    collection: (path) => ({ path, ...query(path, { where: [], order: null, limit: 0 }) }),
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

  // On a touch screen with no mouse (iPad), a file goes to the share sheet, whose "Save to Files" is where downloads belong
  // there; a home-screen app has no downloads bar at all. Elsewhere, or when the sheet is refused, it is a plain download.
  const touchOnly = () => !!window.matchMedia && matchMedia('(hover: none) and (pointer: coarse)').matches;
  async function shareFile(filename, blob) {
    if (!touchOnly() || !navigator.share || !navigator.canShare || typeof File !== 'function') return false;
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (!navigator.canShare({ files: [file] })) return false;
    try { await navigator.share({ files: [file] }); return true; } catch (err) {
      if (err && err.name === 'AbortError') throw fail('declined'); // the sheet was closed: nothing to report
      return false; // e.g. NotAllowedError when the tap is too long ago: download it instead
    }
  }

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      if (await shareFile(filename, blob)) return { status: 'saved' };
      const url = URL.createObjectURL(blob);
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
