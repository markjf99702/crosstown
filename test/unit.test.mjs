// Checks every puzzle the slow, independent way:  node --test test/unit.test.mjs
// Nothing here trusts the tool that made js/puzzles.js. It re-derives each claim from the grid and the lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { W, H, N, row, col, adjacent, diagonalSquare, spell, spans, traces } from '../js/board.js';
import { PUZZLES } from '../js/puzzles.js';
import { THEMES } from '../tools/themes.mjs';
import { isRude } from '../tools/rude-words.mjs';
import { fareFor, FARE_PER_TOKEN, starsFor } from '../js/rules.js';

test('the pack matches the themes, in order, with no repeats', () => {
  assert.deepEqual(PUZZLES.map(p => p.id), THEMES.map(t => t.id));
  assert.equal(new Set(PUZZLES.map(p => p.id)).size, PUZZLES.length);
  assert.ok(PUZZLES.length >= 30);
});

for (const p of PUZZLES) {
  const theme = THEMES.find(t => t.id === p.id);
  const words = p.lines.map(l => spell(p.grid, l));

  test(`${p.id}: every stop is on exactly one line`, () => {
    assert.match(p.grid, new RegExp(`^[A-Z]{${N}}$`));
    const seen = new Array(N).fill(0);
    for (const line of p.lines) for (const i of line) { assert.ok(Number.isInteger(i) && i >= 0 && i < N); seen[i]++; }
    assert.deepEqual(seen, new Array(N).fill(1));
  });

  test(`${p.id}: lines step stop to stop and never cut across each other`, () => {
    const cut = new Set();
    for (const line of p.lines) {
      for (let k = 1; k < line.length; k++) {
        assert.ok(adjacent(line[k - 1], line[k]), `${line[k - 1]} and ${line[k]} aren't neighbours`);
        const d = diagonalSquare(line[k - 1], line[k]);
        if (d >= 0) { assert.ok(!cut.has(d), `two lines cross between stops ${d} and ${d + W + 1}`); cut.add(d); }
      }
    }
  });

  test(`${p.id}: the words are the theme's, and the first runs edge to edge`, () => {
    assert.equal(words[0], theme.cross);
    const first = p.lines[0][0], last = p.lines[0].at(-1);
    const acrossTown = (col(first) === 0 && col(last) === W - 1) || (col(first) === W - 1 && col(last) === 0)
      || (row(first) === 0 && row(last) === H - 1) || (row(first) === H - 1 && row(last) === 0);
    assert.ok(spans(p.lines[0]) && acrossTown, 'the Crosstown should start and end on opposite edges');
    const listed = new Set(theme.words.split(' '));
    for (const w of words.slice(1)) assert.ok(listed.has(w), `${w} isn't in the theme`);
    assert.equal(new Set(words).size, words.length);
    assert.ok(words.length >= 7 && words.length <= 9);
    for (const w of words) assert.ok(w.length >= 4);
    assert.ok(p.clue && !words.some(w => p.clue.toUpperCase().replace(/[^A-Z]/g, '').includes(w)), 'the clue gives a word away');
  });

  test(`${p.id}: no word can be spelled through another line's stops`, () => {
    p.lines.forEach((line, k) => {
      const own = new Set(line);
      for (const t of traces(p.grid, words[k], 40)) assert.ok(t.every(i => own.has(i)), `${words[k]} can be traced another way`);
    });
  });

  test(`${p.id}: detours are real finds, none is an answer, and none is rude`, () => {
    const list = p.detours.split(' ');
    assert.ok(list.length >= 100, 'too few detours to earn a token');
    assert.equal(new Set(list).size, list.length);
    const answers = new Set(words.map(w => w.toLowerCase()));
    for (const d of list) {
      assert.match(d, /^[a-z]{4,}$/);
      assert.ok(!answers.has(d));
      assert.ok(!isRude(d), `${d} shouldn't earn fare`);
      assert.ok(traces(p.grid, d.toUpperCase(), 1).length, `${d} isn't on the board`);
    }
  });
}

test('rude words stay out with -s, -es, -d or -ed on the end, and plain words that only look like them stay in', () => {
  for (const w of ['clits', 'boners', 'nudes', 'orgies', 'arsed', 'asses']) assert.ok(isRude(w), `${w} should stay out`);
  for (const w of ['spices', 'spiced', 'crapes', 'classes', 'passed', 'stories', 'clocks']) assert.ok(!isRude(w), `${w} should count`);
});

test('fare and stars', () => {
  assert.equal(fareFor('tape'), 1);
  assert.equal(fareFor('twine'), 2);
  assert.equal(fareFor('pencil'), 3);
  assert.equal(fareFor('scissors'), 4);
  assert.ok(FARE_PER_TOKEN >= 3);
  assert.equal(starsFor({ done: true, spent: 0, crossAt: 0 }), 3);
  assert.equal(starsFor({ done: true, spent: 0, crossAt: 2 }), 2);
  assert.equal(starsFor({ done: true, spent: 1, crossAt: 0 }), 2);
  assert.equal(starsFor({ done: true, spent: 2, crossAt: 4 }), 1);
  assert.equal(starsFor({ done: false, spent: 0, crossAt: 0 }), 0);
});

test('the offline copy lists every file the page loads', async () => {
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of ['index.html', 'css/app.css', 'js/app.js', 'js/board.js', 'js/rules.js', 'js/puzzles.js', 'fonts/overpass.woff2', 'icon.svg', 'manifest.webmanifest']) {
    assert.ok(sw.includes(`'${f}'`), `sw.js doesn't keep ${f}`);
  }
});
