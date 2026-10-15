// Plays the game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import assert from 'node:assert/strict';
import { playwright, serve, drag, tapOut } from '../tools/play.mjs';
import { PUZZLES } from '../js/puzzles.js';
import { traces, spell, adjacent } from '../js/board.js';
import { fareFor, FARE_PER_TOKEN } from '../js/rules.js';

const { server, base } = serve();
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

const text = sel => page.textContent(sel);
const p = PUZZLES[0];
const words = p.lines.map(l => spell(p.grid, l));
// A detour that avoids the given lines, of at least `min` letters, with the stops to trace it.
function detour(avoid, min, skip = new Set()) {
  const off = new Set(avoid.flatMap(k => p.lines[k]));
  for (const d of p.detours.split(' ')) {
    if (d.length < min || skip.has(d)) continue;
    const t = traces(p.grid, d.toUpperCase(), 20).find(t => t.every(i => !off.has(i)));
    if (t) return { word: d, path: t };
  }
  throw new Error('no detour found');
}

await page.goto(base);
await page.evaluate(() => document.fonts.ready);

// The list: every puzzle, none started.
assert.equal(await page.locator('#route li').count(), PUZZLES.length);
assert.equal(await text('#b-continue'), 'Play No. 1');
assert.equal(await text('#tally'), `${PUZZLES.length} puzzles`);

// Open the first one. Nothing found yet, no tokens.
await page.click('#b-continue');
assert.equal(await text('#clue'), p.clue);
assert.equal(await text('#count'), `0 of ${p.lines.length} lines`);
assert.equal(await page.locator('#board .stop').count(), 48);
assert.equal(await page.isDisabled('#b-token'), true);

// Drag out one line, tap out another.
await drag(page, p.lines[2]);
assert.equal(await text('#count'), `1 of ${p.lines.length} lines`);
assert.equal(await text('#readout'), words[2]);
assert.equal(await page.locator('#board .stop.on.c2').count(), p.lines[2].length);
await tapOut(page, p.lines[4]);
assert.equal(await text('#count'), `2 of ${p.lines.length} lines`);

// The same word spelled backwards is not the line.
await drag(page, p.lines[1].slice().reverse());
assert.equal(await text('#count'), `2 of ${p.lines.length} lines`);

// Too short, and not a word.
await drag(page, p.lines[1].slice(0, 3));
assert.equal(await text('#readout'), 'Too short');
const junk = (() => {   // four neighbouring unfound stops that spell nothing
  const off = new Set([...p.lines[2], ...p.lines[4]]);
  const all = new Set(p.detours.split(' '));
  for (let a = 0; a < 48; a++) for (let b = 0; b < 48; b++) for (let c = 0; c < 48; c++) for (let d = 0; d < 48; d++) {
    const path = [a, b, c, d];
    if (new Set(path).size < 4 || path.some(i => off.has(i)) || !adjacent(a, b) || !adjacent(b, c) || !adjacent(c, d)) continue;
    const w = spell(p.grid, path);
    if (!all.has(w.toLowerCase()) && !words.includes(w)) return path;
  }
})();
await drag(page, junk);
assert.equal(await text('#readout'), 'Not a word on this map');

// A detour earns fare by its length, once.
const first = detour([2, 4], 5);
await drag(page, first.path);
assert.match(await text('#readout'), new RegExp(`^Detour: ${first.word}, \\+${fareFor(first.word)} fare`));
let fare = fareFor(first.word);
assert.equal(await page.locator('#pips .full').count(), fare % FARE_PER_TOKEN);
await drag(page, first.path);
assert.match(await text('#readout'), /already counted$/);

// Enough detours for two tokens.
const used = new Set([first.word]);
while (fare < FARE_PER_TOKEN * 2) { const d = detour([2, 4], 6, used); used.add(d.word); await drag(page, d.path); fare += fareFor(d.word); }
assert.equal(await text('#token-label'), `Use a token (${Math.floor(fare / FARE_PER_TOKEN)})`);

// The first token rings a line's stops; the second draws its route.
await page.click('#b-token');
const ringed = await page.locator('#board .stop.hint').count();
assert.ok(p.lines.some((l, k) => k && l.length === ringed), 'the ringed stops should be one whole line');
assert.equal(await page.locator('#board .guide').count(), 0);
await page.click('#b-token');
assert.equal(await page.locator('#board .guide').count(), 1);
assert.equal(await page.locator('#board .stop.first').count(), 1);

// Leaving and coming back keeps everything.
await page.reload();
assert.equal(await text('#b-continue'), 'Resume No. 1');
assert.match(await text('#route li:first-child .row-sub'), /^2 of \d lines found$/);
await page.click('#route li:first-child .row');
assert.equal(await text('#count'), `2 of ${p.lines.length} lines`);
assert.equal(await page.locator('#board .line').count(), 2);
assert.equal(await page.locator('#board .guide').count(), 1);

// With the keyboard: Tab to the map, which shows it has focus, then walk to a line's first stop and press Enter
// along it.
await page.focus('#b-menu');
await page.keyboard.press('Tab');
assert.deepEqual(await page.evaluate(() => [document.activeElement.id, getComputedStyle(document.activeElement).outlineStyle]), ['board', 'solid'], 'the map should show keyboard focus');
await page.focus('#board');
const walk = async to => {
  let at = await page.evaluate(() => [...document.querySelectorAll('#board .stop')].findIndex(s => s.classList.contains('cursor')));
  if (at < 0) { await page.keyboard.press('ArrowRight'); at = 0; }
  for (; at % 6 < to % 6; at++) await page.keyboard.press('ArrowRight');
  for (; at % 6 > to % 6; at--) await page.keyboard.press('ArrowLeft');
  for (; at < to; at += 6) await page.keyboard.press('ArrowDown');
  for (; at > to; at -= 6) await page.keyboard.press('ArrowUp');
};
for (const stop of p.lines[3]) { await walk(stop); await page.keyboard.press('Enter'); }
await page.keyboard.press('Enter');
assert.equal(await text('#count'), `3 of ${p.lines.length} lines`);

// An open sheet starts on its main button, keeps the keyboard inside it, and hands focus back when it closes.
const focused = () => page.evaluate(() => document.activeElement.id || document.activeElement.textContent.trim());
await page.focus('#b-menu');
await page.keyboard.press('Enter');
assert.equal(await focused(), 'Done');
for (let k = 0; k < 12; k++) {
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.getElementById('app').contains(document.activeElement)), false, 'Tab reached the page behind a sheet');
}
await page.keyboard.press('Escape');
assert.equal(await page.evaluate(() => document.activeElement.id), 'b-menu');

// Finish it. The Crosstown wasn't first and tokens were spent, so one star.
for (const k of [0, 1, 5, 6].filter(k => k < p.lines.length)) await drag(page, p.lines[k]);
for (let k = 7; k < p.lines.length; k++) await drag(page, p.lines[k]);
await page.waitForSelector('#sheet-done:not([hidden])');
assert.equal(await focused(), 'b-done-next', 'the done sheet should start on Next puzzle');
assert.equal(await text('#done-title'), p.name);
assert.equal(await page.locator('#done-stars .got').count(), 1);
assert.equal(await page.locator('#done-key li').count(), p.lines.length);
assert.equal(await page.locator('#board .stop.on').count(), 48);

// Sharing falls back to the clipboard, or to text you can select.
await page.click('#b-share');
await page.waitForSelector('#toast:not([hidden])', { timeout: 5000 });
assert.match(await text('#toast'), /copied|Select the text/);

// On to the next one, with night service on: the clue stays hidden until the first line.
await page.click('#b-done-next');
assert.equal(await text('#where'), 'No. 2');
await page.click('#b-menu');
await page.check('#o-night');
await page.check('#o-clock');
await page.click('#sheet-menu .panel-row [data-close]');
assert.match(await text('#clue'), /^Night service/);
assert.equal(await page.isVisible('#clock'), true);
await drag(page, PUZZLES[1].lines[0]);
assert.equal(await text('#clue'), PUZZLES[1].clue);
assert.equal(await text('#readout'), `Crosstown: ${PUZZLES[1].name}`);

// Back on the list: one finished with a star, one under way.
await page.click('#b-back');
assert.equal(await text('#tally'), `1 of ${PUZZLES.length} finished, 1 of ${PUZZLES.length * 3} stars`);
assert.equal(await page.locator('#route li.done').count(), 1);
assert.equal(await page.locator('#route li.going').count(), 1);

// Night service keeps the clues off the list too, except where a line has been found.
assert.equal(await text('#route li:nth-child(1) .row-clue'), PUZZLES[0].clue);
assert.equal(await text('#route li:nth-child(2) .row-clue'), PUZZLES[1].clue);
assert.equal(await text('#route li:nth-child(3) .row-clue'), 'Night service');
assert.equal(await page.locator('#route .row-clue', { hasText: PUZZLES[2].clue }).count(), 0, 'a hidden clue is on the list');
await page.click('#b-list-menu');
await page.uncheck('#o-night');
assert.equal(await text('#route li:nth-child(3) .row-clue'), PUZZLES[2].clue, 'turning night service off should show the clues');
await page.check('#o-night');
await page.click('#sheet-menu .panel-row [data-close]');
assert.equal(await text('#route li:nth-child(3) .row-clue'), 'Night service');

// Starting a puzzle over takes two taps.
await page.click('#route li:nth-child(2) .row');
await page.click('#b-menu');
await page.click('#m-restart');
assert.equal(await text('#m-restart'), 'Tap again to clear this puzzle');
await page.click('#m-restart');
assert.equal(await text('#count'), `0 of ${PUZZLES[1].lines.length} lines`);
await page.click('#b-back');

// Fits a phone: nothing scrolls sideways, on the list or in a puzzle.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the list scrolls sideways on a phone');
await page.click('#route li:nth-child(3) .row');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true, 'a puzzle should fit the screen');
const box = await page.locator('#board').boundingBox();
assert.ok(box.width > 300 && box.y + box.height < 844 - 60, 'the map should be big and clear of the buttons');

// A small phone still fits the whole map.
await page.setViewportSize({ width: 320, height: 568 });
const small = await page.locator('#board').boundingBox();
const bar = await page.locator('#fare').boundingBox();
assert.ok(small.width >= 240 && small.y + small.height <= bar.y + 1, 'the map should fit above the fare bar on a small phone');
await page.setViewportSize({ width: 390, height: 844 });

// Another visitor, arriving with `state` already saved, for the checks that need a particular save.
async function visitor(state, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...options });
  await context.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('crosstown.v1', s); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(state));
  const tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', e => errors.push(e.message));
  await tab.goto(base);
  await tab.evaluate(() => document.fonts.ready);
  return { other: context, tab, errors };
}
const finished = q => ({ found: q.lines.map((_, k) => k), detours: [], spent: 0, done: true, crossAt: 0 });

// The last puzzle has no next one, so its done sheet starts on Share instead.
{
  const last = PUZZLES.at(-1);
  const games = Object.fromEntries(PUZZLES.slice(0, -1).map(q => [q.id, finished(q)]));
  games[last.id] = { found: last.lines.map((_, k) => k).slice(1), detours: [] };
  const { other, tab, errors } = await visitor({ options: {}, best: {}, games });
  await tab.click('#b-continue');
  await drag(tab, last.lines[0]);
  await tab.waitForSelector('#sheet-done:not([hidden])');
  assert.equal(await tab.isHidden('#b-done-next'), true);
  assert.equal(await tab.evaluate(() => document.activeElement.id), 'b-share', 'the last done sheet should start on Share');
  assert.deepEqual(errors, []);
  await other.close();
}

// A damaged save, or one from an older layout of a board, can't stop the page: the list still draws, and each
// puzzle still opens and plays, keeping whatever could be read.
{
  const damaged = { options: {}, best: [], games: {
    [PUZZLES[0].id]: { found: [0, 1, 99], detours: 'oops', fare: 'x', hint: { line: 1, level: 2 } },
    [PUZZLES[1].id]: { found: null },
    [PUZZLES[2].id]: { found: '01' },
  } };
  const { other, tab, errors } = await visitor(damaged);
  assert.equal(await tab.locator('#route li').count(), PUZZLES.length, 'a damaged save should still list every puzzle');
  assert.equal(await tab.textContent('#route li:nth-child(1) .row-sub'), `2 of ${PUZZLES[0].lines.length} lines found`);
  await tab.click('#route li:nth-child(1) .row');
  assert.equal(await tab.locator('#board .line').count(), 2, 'the line number the board does not have should be dropped');
  await drag(tab, PUZZLES[0].lines[2]);
  assert.equal(await tab.textContent('#count'), `3 of ${PUZZLES[0].lines.length} lines`);
  await tab.click('#b-back');
  for (const n of [1, 2]) {
    await tab.click(`#route li:nth-child(${n + 1}) .row`);
    await drag(tab, PUZZLES[n].lines[1]);
    assert.equal(await tab.textContent('#count'), `1 of ${PUZZLES[n].lines.length} lines`);
    await tab.click('#b-back');
  }
  await tab.reload();
  assert.equal(await tab.textContent('#route li:nth-child(3) .row-sub'), `1 of ${PUZZLES[2].lines.length} lines found`);
  assert.deepEqual(errors, [], 'errors with a damaged save');
  await other.close();
}

// It can be installed.
const cdp = await ctx.newCDPSession(page);
const manifest = await cdp.send('Page.getAppManifest');
assert.deepEqual(manifest.errors, []);
assert.match(manifest.data, /"name": "Crosstown"/);

// Works offline once it has been opened: with the server dropping every connection, the page, its styles, its
// font and the puzzles still load, from the copy the service worker kept.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 });
server.down = true;
await page.reload().catch(e => assert.fail(`the page did not load offline: ${e.message.split('\n')[0]}`));
assert.equal(await page.locator('#route li').count(), PUZZLES.length, 'the page did not load offline');
await page.click('#b-continue');
assert.equal(await page.locator('#board .stop').count(), 48, 'a puzzle did not open offline');
assert.deepEqual(await page.evaluate(async () => {
  await document.fonts.ready;
  return { styled: getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)', font: [...document.fonts].some(f => f.family.replace(/"/g, '') === 'Overpass' && f.status === 'loaded') };
}), { styled: true, font: true }, 'the styles or the font did not load offline');
server.down = false;

assert.deepEqual(problems.filter(x => !x.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
