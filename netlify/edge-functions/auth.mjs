// Netlify Edge Function for every path: the whole site, including /api/db/*, needs the shared password,
// except the manifest and icons that let a browser install the site as an app (PUBLIC_PATHS in ../lib/auth.mjs).
// The password comes in through the browser's login box (Basic Auth) or the session cookie that LOGIN_PATH hands out
// (what a home-screen web app on an iPad uses). Edge functions run before static files and Netlify Functions.
// All logic lives in ../lib/auth.mjs.
import { checkAuth, hasSession, isPublicPath, login, LOGIN_PATH, sessionCookie, withCookie } from '../lib/auth.mjs';

export default async (req, context) => {
  const { pathname } = new URL(req.url);
  if (isPublicPath(pathname)) return context.next();
  const password = Netlify.env.get('SITE_PASSWORD');
  if (pathname === LOGIN_PATH) return login(req, password);
  const denied = await checkAuth(req, password);
  if (denied) return denied;
  if (await hasSession(req, password)) return context.next();
  // In through the login box: keep a cookie too, so an app that forgets that login stays signed in.
  return withCookie(await context.next(), await sessionCookie(password));
};

export const config = { path: '/*' };
