// Shared by the tests and the screenshot tool: a tiny static server, and hands that play the game the way a
// person would, by pressing on the map and dragging from letter to letter.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { W, H, col, row } from '../js/board.js';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
export const playwright = pw;
export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// Set server.down = true to drop every connection, the way a phone with no signal sees it. Playwright's own
// offline switch doesn't stop the service worker's fetches, so it can't prove the offline copy works.
export function serve(dir = root) {
  const server = createServer(async (req, res) => {
    if (server.down) { req.socket.destroy(); return; }
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let body;
    try { body = await readFile(join(dir, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
    res.end(body);
  }).listen(0);
  return { server, base: `http://localhost:${server.address().port}/` };
}

// Where a stop is on the page.
async function spot(page, i) {
  const box = await page.locator('#board').boundingBox();
  return { x: box.x + (col(i) + 0.5) * box.width / W, y: box.y + (row(i) + 0.5) * box.height / H };
}

// Drag through the stops in order and let go.
export async function drag(page, path) {
  const first = await spot(page, path[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const i of path.slice(1)) { const p = await spot(page, i); await page.mouse.move(p.x, p.y, { steps: 3 }); }
  await page.mouse.up();
}

// Tap one stop.
export async function tap(page, i) {
  const p = await spot(page, i);
  await page.mouse.click(p.x, p.y);
}

// Tap the stops one at a time, then the last one again.
export async function tapOut(page, path) {
  for (const i of [...path, path.at(-1)]) await tap(page, i);
}
