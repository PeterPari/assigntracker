// Netlify Edge Function for every path: the whole site, including /api/db/*, needs the shared password,
// except the manifest and icons that let a browser install the site as an app (PUBLIC_PATHS in ../lib/auth.mjs).
// Edge functions run before static files and Netlify Functions. All logic lives in ../lib/auth.mjs.
import { checkAuth, isPublicPath } from '../lib/auth.mjs';

export default async (req, context) => (isPublicPath(new URL(req.url).pathname)
  ? null
  : await checkAuth(req, Netlify.env.get('SITE_PASSWORD'))) ?? context.next();

export const config = { path: '/*' };
