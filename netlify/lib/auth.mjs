// HTTP Basic Auth check behind netlify/edge-functions/auth.mjs: one shared password for the whole site.
// Plain Request in, Response (or null) out, using only Web APIs, so Netlify Edge (Deno) and the tests (Node) share it.
//
// Besides the browser's own login box there is a session cookie, for a home-screen web app on an iPad: such an app does
// not keep (and may never show) the Basic Auth login, so the 401 page carries a small password form of its own, which
// posts to LOGIN_PATH and gets the cookie back. Signing in through the login box sets the same cookie.

const REALM = 'Assignment tracker';

/**
 * The only paths that are served without the password: the web app manifest and the app icons. Browsers fetch these
 * on their own, without the page's credentials, when they install the site as an app (Safari's "Add to Dock" takes
 * its icon from /apple-touch-icon.png). Behind the password they get a 401 and the Dock shows a generic icon instead.
 * They hold nothing but the app's name and picture. Exact paths only, never a prefix.
 */
export const PUBLIC_PATHS = new Set([
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]);

export const isPublicPath = (pathname) => PUBLIC_PATHS.has(pathname);

const reply = (status, text, headers) => new Response(text, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

export const LOGIN_PATH = '/__login';
export const SESSION_COOKIE = 'tracker_session';
const SESSION_AGE = 400 * 24 * 3600; // the longest a browser keeps a cookie

/** The page behind every 401. Browsers that show their login box show this only when it is cancelled; a home-screen app
 *  that shows none gets it straight away. It posts the password to LOGIN_PATH and reloads once the cookie is set. */
const LOGIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#13151a">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Assignment Tracker</title>
<style>
html{-webkit-text-size-adjust:100%;touch-action:manipulation}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#13151a;color:#e7e9ee;font:16px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
form{display:flex;gap:8px;padding:16px;width:min(360px,100%);box-sizing:border-box}
input,button{font:inherit;height:48px;border-radius:10px;border:1px solid #323844}
input{flex:1;min-width:0;padding:0 14px;background:#232731;color:inherit}
input:focus{outline:none;border-color:#8ab4ff}
button{width:56px;background:#26774a;color:#fff;border:0;cursor:pointer}
p{position:fixed;left:0;right:0;bottom:calc(24px + env(safe-area-inset-bottom,0px));margin:0;text-align:center;color:#f2c94c}
</style></head><body>
<form id="f"><input id="pw" type="password" name="password" placeholder="Password" autocomplete="current-password" aria-label="Password" required autofocus>
<button type="submit" aria-label="Sign in"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button></form>
<p id="m" role="status"></p>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = document.getElementById('m');
  m.textContent = '';
  try {
    const res = await fetch('${LOGIN_PATH}', { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: document.getElementById('pw').value, credentials: 'same-origin', cache: 'no-store' });
    if (res.ok) { location.reload(); return; }
    m.textContent = res.status === 403 ? 'Wrong password' : 'Could not sign in';
  } catch (_) { m.textContent = 'Could not sign in'; }
});
</script></body></html>
`;

const unauthorized = () => new Response(LOGIN_PAGE, {
  status: 401,
  headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"` },
});

/** The password from an `Authorization: Basic base64(user:password)` header: everything after the first colon. */
function passwordFrom(header) {
  const match = /^Basic +([A-Za-z0-9+/_-]+={0,2})$/i.exec(header ?? '');
  if (!match) return null;
  let decoded;
  try {
    const bytes = Uint8Array.from(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; }
  const colon = decoded.indexOf(':');
  return colon < 0 ? null : decoded.slice(colon + 1);
}

/** Compares SHA-256 digests, so the time taken does not depend on how much of the password matched or on its length. */
async function sameSecret(given, expected) {
  const digest = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([digest(given), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The session cookie's value: an HMAC of a fixed text under the password, so changing SITE_PASSWORD signs everyone out. */
async function sessionToken(password) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('assigntracker session v1')));
}

/** The whole Set-Cookie header that signs this browser in. */
export async function sessionCookie(password) {
  return `${SESSION_COOKIE}=${await sessionToken(password)}; Path=/; Max-Age=${SESSION_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

/** Whether the request carries a valid session cookie. */
export async function hasSession(req, password) {
  if (!password) return false;
  const given = (req.headers.get('cookie') ?? '').split(';').map((c) => c.trim())
    .find((c) => c.startsWith(SESSION_COOKIE + '='))?.slice(SESSION_COOKIE.length + 1);
  return !!given && /^[0-9a-f]{64}$/.test(given) && sameSecret(given, await sessionToken(password));
}

/** POST LOGIN_PATH with the password as the body: 204 and the cookie when it is right, 403 when it is not. Never a
 *  WWW-Authenticate header, so a wrong password does not make the browser open its own login box. */
export async function login(req, password) {
  if (!password) return reply(503, 'The site password is not set. Set the SITE_PASSWORD environment variable in Netlify.');
  if (req.method !== 'POST') return reply(405, 'Method not allowed', { allow: 'POST' });
  let given;
  try { given = await req.text(); } catch { given = ''; }
  if (given.length > 10000 || !(await sameSecret(given, password))) return reply(403, 'Wrong password');
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store', 'set-cookie': await sessionCookie(password) } });
}

/** A response with the session cookie added, for a request that signed in through the browser's login box. */
export function withCookie(res, cookie) {
  const out = new Response(res.body, res);
  out.headers.append('set-cookie', cookie);
  return out;
}

/**
 * @param {Request} req
 * @param {string | undefined} password  the shared site password (the SITE_PASSWORD environment variable)
 * @returns {Promise<Response | null>}  null when the request may go on; otherwise the 401 or 503 to send back
 */
export async function checkAuth(req, password) {
  // Fail closed: a site with no password configured must not quietly be served to everyone.
  if (!password) return reply(503, 'The site password is not set. Set the SITE_PASSWORD environment variable in Netlify.');
  if (await hasSession(req, password)) return null;
  const given = passwordFrom(req.headers.get('authorization'));
  if (given === null || !(await sameSecret(given, password))) return unauthorized();
  return null;
}
