// Draws the app icons into public/: the green check-in-circle from the favicon, on the page's dark background.
//   npm run icons
// The PNGs are committed, because the Netlify build does not download a browser to draw them.
// Chromium (through the Playwright that the tests already use) rasterises the SVG, so the pixels match what a browser draws.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const BG_TOP = '#1b1e26';
const BG_BOTTOM = '#101217';
const GREEN = '#4cc38a';

/**
 * The mark in the favicon's proportions (32 unit box: ring r 9 / stroke 2.5, check stroke 2.8), scaled by `k`
 * and centred on the 1024 box.
 */
function mark(k) {
  const p = ([x, y]) => `${(512 + (x - 16) * k).toFixed(1)} ${(512 + (y - 16) * k).toFixed(1)}`;
  return `<circle cx="512" cy="512" r="${(9 * k).toFixed(1)}" fill="none" stroke="${GREEN}" stroke-width="${(2.5 * k).toFixed(1)}"/>`
    + `<path d="M${p([11.5, 16.5])} L${p([14.7, 19.7])} L${p([20.7, 12.7])}" fill="none" stroke="${GREEN}" stroke-width="${(2.8 * k).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const defs = `<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/></linearGradient>
<radialGradient id="glow" cx="512" cy="512" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${GREEN}" stop-opacity=".16"/><stop offset="1" stop-color="${GREEN}" stop-opacity="0"/></radialGradient>
</defs>`;

/** macOS style: a rounded tile with the usual margin around it and transparent corners (Apple's grid: 824 of 1024, radius about 185). */
const TILE = 824;
const tile = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}`
  + `<rect x="100" y="100" width="${TILE}" height="${TILE}" rx="185" fill="url(#bg)"/>`
  + `<rect x="100" y="100" width="${TILE}" height="${TILE}" rx="185" fill="url(#glow)"/>`
  + mark(TILE / 32) + '</svg>';

/** Full bleed and opaque: for the maskable icon (the OS cuts its own shape) and for the Apple touch icon (Safari rounds it itself). */
const bleed = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}`
  + '<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>'
  + mark(1024 / 32 * 0.9) + '</svg>'; // 0.9: the ring stays inside the maskable safe zone (a circle of 80% of the width) with room to spare

export const ICONS = [
  { file: 'icons/icon-192.png', size: 192, svg: tile },
  { file: 'icons/icon-512.png', size: 512, svg: tile },
  { file: 'icons/icon-maskable-512.png', size: 512, svg: bleed },
  { file: 'apple-touch-icon.png', size: 512, svg: bleed },
];

function loadPlaywright() {
  for (const p of ['playwright', process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules/playwright']) {
    if (!p) continue;
    try { return require(p); } catch { /* try next */ }
  }
  throw new Error('playwright not found: npm i -D playwright, or set PLAYWRIGHT_PATH');
}

export async function makeIcons(outDir = join(root, 'public')) {
  const browser = await loadPlaywright().chromium.launch();
  try {
    for (const { file, size, svg } of ICONS) {
      const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
      await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg(size)}`);
      const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
      await page.close();
      const path = join(outDir, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, png);
      console.log(`wrote ${path} (${size}x${size}, ${png.length} bytes)`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await makeIcons();
