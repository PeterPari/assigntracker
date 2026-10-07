// Test helpers: wraps index.html the way the Artifact publisher does, and mocks the `db` capability.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
export const INDEX = join(here, '..', 'index.html');

export function loadPlaywright() {
  for (const p of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright']) {
    if (!p) continue;
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error('playwright not found: npm i -D playwright, or set PLAYWRIGHT_PATH');
}

/** Same shape the Artifact tool publishes: skeleton + page content. */
export function wrappedPage() {
  const content = readFileSync(INDEX, 'utf8');
  return `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;background:#fafafa;color:#111}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${content}</body></html>`;
}

/**
 * Injected before the page script. A tiny in-memory stand-in for `claude.use('db')`.
 * Control it from tests through window.__db: { store, writes, failWith, failGet, failQuery, delay, queries }.
 * collection(path) answers where/orderBy/limit/get over the store keys under `path/`, like the real runtime; each get() is
 * counted in `queries`, and `failQuery` is an error code it rejects with.
 * It also stands in for the `downloads` capability: saves are recorded in window.__db.downloads as { filename, data },
 * `noDownloads` makes use('downloads') resolve null, and `downloadFail` is an error code save() rejects with.
 */
export function mockDbScript(initial) {
  return `(() => {
    const __db = { store: ${JSON.stringify(initial ?? {})}, writes: [], failWith: null, failGet: null, failQuery: null, queries: 0, delay: 0, downloads: [], noDownloads: false, downloadFail: null };
    window.__db = __db;
    const wait = () => new Promise(r => setTimeout(r, __db.delay));
    window.claude = {
      use: async (name) => {
        if (name === 'downloads') {
          if (__db.noDownloads) return null;
          return { save: async ({ filename, data }) => {
            if (__db.downloadFail) throw { code: __db.downloadFail, message: 'refused' };
            __db.downloads.push({ filename, data });
            return { status: 'saved' };
          } };
        }
        if (name !== 'db') return null;
        if (__db.missing) return null;
        const OPS = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
        const query = (path, q) => ({
          where: (f, op, v) => query(path, { ...q, where: [...q.where, [f, op, v]] }),
          orderBy: (f, dir = 'asc') => query(path, { ...q, order: [f, dir] }),
          limit: (n) => query(path, { ...q, limit: n }),
          get: async () => {
            await wait();
            __db.queries++;
            if (__db.failQuery) throw { code: __db.failQuery };
            let docs = Object.keys(__db.store).filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).sort()
              .map((k) => ({ id: k.slice(path.length + 1), body: __db.store[k] }));
            for (const [f, op, v] of q.where) docs = docs.filter((d) => d.body[f] !== undefined && OPS[op](d.body[f], v));
            if (q.order) {
              const [f, dir] = q.order, s = dir === 'desc' ? -1 : 1;
              docs.sort((a, b) => (a.body[f] === undefined) - (b.body[f] === undefined) || (a.body[f] < b.body[f] ? -s : a.body[f] > b.body[f] ? s : 0));
            }
            if (q.limit) docs = docs.slice(0, q.limit);
            const out = docs.map((d) => ({ id: d.id, exists: true, data: () => JSON.parse(JSON.stringify(d.body)) }));
            return { docs: out, size: out.length, empty: !out.length };
          },
        });
        return {
          collection: (path) => ({ path, ...query(path, { where: [], order: null, limit: 0 }) }),
          doc: (path) => ({
            path,
            get: async () => {
              await wait();
              if (__db.failGet) throw { code: __db.failGet };
              const d = __db.store[path];
              return { exists: d !== undefined, data: () => d === undefined ? undefined : JSON.parse(JSON.stringify(d)) };
            },
            set: async (data) => {
              await wait();
              if (__db.failWith) throw { code: __db.failWith };
              __db.writes.push(JSON.parse(JSON.stringify(data)));
              __db.store[path] = JSON.parse(JSON.stringify(data));
            },
          }),
        };
      },
    };
  })();`;
}

export async function openPage(browser, { initial, missing, now, init } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(mockDbScript(initial));
  if (now) { // now: [hour, minute] local time, frozen; window.__setNow(h, m) moves it
    await page.addInitScript(`(() => { const R = Date; let T = new R(2026, 9, 5, ${now[0]}, ${now[1]}, 20).getTime();
      window.__setNow = (h, m) => { T = new R(2026, 9, 5, h, m, 20).getTime(); };
      window.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }; })();`);
  }
  if (missing) await page.addInitScript('window.__db.missing = true;');
  if (init) await page.addInitScript(init); // extra script run before the page, after the mocks
  // addInitScript only runs on real navigations, so serve the page from a routed URL.
  await page.route('https://tracker.test/', (route) => route.fulfill({ contentType: 'text/html', body: wrappedPage() }));
  await page.goto('https://tracker.test/');
  await page.waitForTimeout(80); // let load() finish
  return { ctx, page, errors };
}
