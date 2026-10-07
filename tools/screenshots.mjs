// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Progress is seeded into storage, so the same pictures come out every time. They show the first puzzle,
// which gives away some of its words; the others stay unspoiled.
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { playwright, serve, root, drag } from './play.mjs';
import { PUZZLES } from '../js/puzzles.js';

const { server, base } = serve();
const browser = await playwright.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

const game = more => ({ found: [], detours: [], fare: 0, tokens: 0, spent: 0, hint: null, ms: 0, done: false, crossAt: -1, night: false, ...more });
const all = p => p.lines.map((_, k) => k);

async function open({ viewport, scale, scheme = 'light', games = {}, options = {} }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(state => localStorage.setItem('crosstown.v1', JSON.stringify(state)),
    { options: { clock: true, night: false, ...options }, games, best: Object.fromEntries(Object.entries(games).filter(([, g]) => g.done).map(([id, g]) => [id, g.ms])) });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const midway = { [PUZZLES[0].id]: game({ found: [2, 0, 4], crossAt: 1, detours: ['east', 'beach', 'awake'], fare: 1, tokens: 1, spent: 1, hint: { line: 1, level: 1 }, ms: 148000 }) };
const phone = { width: 390, height: 844 };

// The list, a few puzzles in.
{
  const page = await open({ viewport: phone, scale: 2, games: {
    [PUZZLES[0].id]: game({ found: [0, ...all(PUZZLES[0]).slice(1)], crossAt: 0, done: true, ms: 252000 }),
    [PUZZLES[1].id]: game({ found: [...all(PUZZLES[1]).slice(1), 0], crossAt: 6, done: true, spent: 1, ms: 431000 }),
    [PUZZLES[2].id]: game({ found: [1, 0, ...all(PUZZLES[2]).slice(2)], crossAt: 1, done: true, ms: 318000 }),
    [PUZZLES[3].id]: game({ found: [3, 1, 5], ms: 96000 }),
  } });
  await page.screenshot({ path: join(root, 'docs/phone-list.png') });
  await page.context().close();
}

// Midway through a puzzle, with a token spent on a hint and a word half traced.
{
  const page = await open({ viewport: phone, scale: 2, games: midway });
  await page.click('#route li:first-child .row');
  const p = PUZZLES[0], line = p.lines[5], box = await page.locator('#board').boundingBox();
  const at = i => [box.x + (i % 6 + 0.5) * box.width / 6, box.y + (Math.floor(i / 6) + 0.5) * box.height / 8];
  await page.mouse.move(...at(line[0])); await page.mouse.down();
  for (const i of line.slice(1, 4)) await page.mouse.move(...at(i), { steps: 3 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(root, 'docs/phone-play.png') });
  await page.mouse.up();
  await page.context().close();
}

// The finished map.
{
  const page = await open({ viewport: phone, scale: 2, scheme: 'dark', games: midway });
  await page.click('#route li:first-child .row');
  for (const k of all(PUZZLES[0]).filter(k => ![2, 0, 4].includes(k))) await drag(page, PUZZLES[0].lines[k]);
  await page.waitForSelector('#sheet-done:not([hidden])');
  await page.click('#sheet-done .panel [data-close]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(root, 'docs/phone-map.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, a real board from the game on the right.
{
  const game5 = { [PUZZLES[0].id]: game({ found: [0, 2, 4, 1, 6], crossAt: 0 }) };
  const page = await open({ viewport: { width: 420, height: 900 }, scale: 3, scheme: 'dark', games: game5, options: { clock: false } });
  await page.click('#route li:first-child .row');
  await page.waitForTimeout(300);
  const shot = await page.locator('#board').screenshot();
  const font = (await readFile(join(root, 'fonts/overpass.woff2'))).toString('base64');
  await page.context().close();
  const card = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })).newPage();
  await card.setContent(`<style>
    @font-face { font-family: Overpass; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 400 900; }
    html, body { margin: 0; }
    body { width: 1200px; height: 630px; background: #0f141b; color: #eef2f6; font-family: Overpass, sans-serif; display: grid; grid-template-columns: 1fr 470px; align-items: center; overflow: hidden; }
    .words { padding: 0 0 10px 76px; }
    svg { width: 300px; display: block; margin-bottom: 26px; }
    h1 { margin: 0; font-size: 124px; line-height: .95; font-weight: 850; letter-spacing: -.025em; }
    p { margin: 26px 0 0; font-size: 36px; line-height: 1.28; font-weight: 500; color: #9aa6b5; max-width: 15em; }
    img { height: 598px; display: block; margin-right: 40px; justify-self: end; }
  </style>
  <div class="words">
    <svg viewBox="0 0 120 34" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 28h28l14-14h30" stroke="#f2645a" stroke-width="5"/><path d="M22 6l10 10h34l12 12h38" stroke="#56a4f2" stroke-width="5"/>
      <path d="M4 17h112" stroke="#f4f6f8" stroke-width="8"/><path d="M4 17h112" stroke="#0f141b" stroke-width="1.6"/>
      <g fill="#0f141b" stroke="#f4f6f8" stroke-width="2.6"><circle cx="4" cy="17" r="4"/><circle cx="46" cy="17" r="4"/><circle cx="82" cy="17" r="4"/><circle cx="116" cy="17" r="4"/></g>
    </svg>
    <h1>Crosstown</h1>
    <p>A word hunt drawn as a transit map. Every letter is a stop on some line.</p>
  </div>
  <img src="data:image/png;base64,${shot.toString('base64')}" alt="">`);
  await card.evaluate(() => document.fonts.ready);
  await card.screenshot({ path: join(root, 'og.png') });
  await card.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');
