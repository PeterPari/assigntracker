// Builds the Netlify site: dist/index.html = index.html (a Claude Artifact fragment) made into a full page,
// plus the shim that replaces the Artifact runtime. index.html itself is not touched.
//   node scripts/build.mjs [outDir]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Same green check as the all-done popup, so the tab has an icon and the browser does not ask for /favicon.ico.
const ICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#13151a"/>'
  + '<circle cx="16" cy="16" r="9" fill="none" stroke="#4cc38a" stroke-width="2.5"/>'
  + '<path d="M11.5 16.5l3.2 3.2 6-7" fill="none" stroke="#4cc38a" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>');

export function buildPage(source, shim) {
  const title = source.match(/<title>[\s\S]*?<\/title>/);
  const style = source.match(/<style>[\s\S]*?<\/style>/);
  const firstTag = source.search(/<(div|script)\b/);
  if (!title || !style || firstTag < 0 || title.index > firstTag || style.index > firstTag) {
    throw new Error('index.html no longer starts with <title> and <style> before the markup; update scripts/build.mjs');
  }
  if (shim.includes('</script')) throw new Error('the shim must not contain "</script"');
  const body = source.replace(title[0], '').replace(style[0], '').trim();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#13151a">
<link rel="icon" href="${ICON}">
${title[0]}
${style[0]}
<script>
${shim.trim()}
</script>
</head>
<body>
${body}
</body>
</html>
`;
}

export function build(outDir = join(root, 'dist')) {
  const page = buildPage(
    readFileSync(join(root, 'index.html'), 'utf8'),
    readFileSync(join(root, 'scripts', 'netlify-db-shim.js'), 'utf8'),
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), page);
  return page;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const page = build(out);
  console.log(`built ${out ?? join(root, 'dist')}/index.html (${page.length} bytes)`);
}
