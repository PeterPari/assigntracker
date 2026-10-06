// HTTP Basic Auth check behind netlify/edge-functions/auth.mjs: one shared password for the whole site.
// Plain Request in, Response (or null) out, using only Web APIs, so Netlify Edge (Deno) and the tests (Node) share it.

const REALM = 'Assignment tracker';

const reply = (status, text, headers) => new Response(text, {
  status,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

const unauthorized = () => reply(401, 'Password required', { 'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"` });

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

/**
 * @param {Request} req
 * @param {string | undefined} password  the shared site password (the SITE_PASSWORD environment variable)
 * @returns {Promise<Response | null>}  null when the request may go on; otherwise the 401 or 503 to send back
 */
export async function checkAuth(req, password) {
  // Fail closed: a site with no password configured must not quietly be served to everyone.
  if (!password) return reply(503, 'The site password is not set. Set the SITE_PASSWORD environment variable in Netlify.');
  const given = passwordFrom(req.headers.get('authorization'));
  if (given === null || !(await sameSecret(given, password))) return unauthorized();
  return null;
}
