// Installing the site as an app (Chrome "Install", Safari "Add to Dock"): the manifest, the icons, the tags in the
// built page, and that every file a browser fetches on its own is served without the password.
// The browser side of this (the manifest loading under the CSP, Chromium's own installability check) is in netlify.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { ICONS } from '../scripts/make-icons.mjs';
import { PUBLIC_PATHS } from '../netlify/lib/auth.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let outDir, page;
before(() => { outDir = mkdtempSync(join(tmpdir(), 'assigntracker-pwa-')); page = build(outDir); });
after(() => { if (outDir) rmSync(outDir, { recursive: true, force: true }); });

const manifest = () => JSON.parse(readFileSync(join(outDir, 'manifest.webmanifest'), 'utf8'));
const files = (dir, base = dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), base) : ['/' + relative(base, join(dir, e.name)).split('\\').join('/')]));

/** Width, height and colour type (6 = with alpha, 2 = without) from the PNG header. */
function png(path) {
  const b = readFileSync(path);
  assert.equal(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${path} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: b[25] === 6 };
}

test('the manifest has what Chrome needs to offer "Install", and the app opens in its own window', () => {
  const m = manifest();
  assert.equal(m.name, 'Assignment Tracker');
  assert.ok(m.short_name && m.short_name.length <= 12, 'a short name that fits under the Dock icon');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/');
  assert.equal(m.scope, '/');
  assert.equal(m.id, '/');
  assert.equal(m.background_color, '#13151a');
  assert.equal(m.theme_color, '#13151a');
  const sizes = (purpose) => m.icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
  assert.ok(sizes('any').includes('192x192') && sizes('any').includes('512x512'));
  assert.ok(sizes('maskable').includes('512x512'));
});

test('every icon in the manifest is in the build, is a PNG of the size it claims, and the maskable one has no transparent corners', () => {
  for (const icon of manifest().icons) {
    assert.equal(icon.type, 'image/png');
    assert.match(icon.src, /^\/[^/]/, 'an absolute path, so it works from any page');
    const { width, height, alpha } = png(join(outDir, icon.src));
    assert.equal(`${width}x${height}`, icon.sizes, icon.src);
    if (icon.purpose === 'maskable') assert.equal(alpha, false, 'the OS draws its own shape, so the picture must fill the square');
    else assert.equal(alpha, true, 'the macOS style icon has transparent corners');
  }
});

test('the Apple touch icon (what Safari puts in the Dock) is a big, opaque PNG', () => {
  const { width, height, alpha } = png(join(outDir, 'apple-touch-icon.png'));
  assert.ok(width >= 180 && width === height, `${width}x${height}`);
  assert.equal(alpha, false, 'Safari rounds the corners itself and fills transparency with black');
});

test('the built page links the manifest and the touch icon, and the favicon is still there', () => {
  assert.match(page, /<link rel="manifest" href="\/manifest\.webmanifest" crossorigin="use-credentials">/);
  assert.match(page, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
  assert.match(page, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.match(page, /<meta name="theme-color" content="#13151a">/);
  assert.equal((page.match(/rel="manifest"/g) ?? []).length, 1);
});

test('everything in public/ is built into dist/, and is exactly the list of files served without the password', () => {
  const shipped = files(join(root, 'public')).sort();
  assert.deepEqual(files(outDir).filter((f) => f !== '/index.html').sort(), shipped, 'the build copies public/ and nothing else');
  assert.deepEqual(shipped, [...PUBLIC_PATHS].sort(), 'a file added to public/ is protected unless it is also added to PUBLIC_PATHS in netlify/lib/auth.mjs');
});

test('every icon a browser fetches on its own is served without the password', () => {
  const needed = ['/manifest.webmanifest', '/apple-touch-icon.png', ...manifest().icons.map((i) => i.src)];
  for (const path of needed) assert.ok(PUBLIC_PATHS.has(path), `${path} would get a 401 from the password check, and the Dock would show a generic icon`);
});

test('the icons in public/ are the ones scripts/make-icons.mjs makes (names and sizes)', () => {
  for (const { file, size } of ICONS) {
    const { width, height } = png(join(root, 'public', file));
    assert.deepEqual([width, height], [size, size], file);
  }
  assert.deepEqual(ICONS.map((i) => '/' + i.file).sort(), [...PUBLIC_PATHS].filter((p) => p.endsWith('.png')).sort());
});
