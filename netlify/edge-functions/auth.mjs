// Netlify Edge Function for every path: the whole site, including /api/db/*, needs the shared password.
// Edge functions run before static files and Netlify Functions. All logic lives in ../lib/auth.mjs.
import { checkAuth } from '../lib/auth.mjs';

export default async (req, context) => (await checkAuth(req, Netlify.env.get('SITE_PASSWORD'))) ?? context.next();

export const config = { path: '/*' };
