// Netlify Function for /api/db/*. All logic lives in ../lib/docs-api.mjs.
import { getDatabase } from '@netlify/database';
import { createHandler } from '../lib/docs-api.mjs';

let db;
export default createHandler(() => (db ??= getDatabase()));

export const config = { path: '/api/db/*' };
