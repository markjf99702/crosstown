// Lays out every puzzle in tools/themes.mjs and writes js/puzzles.js:  node tools/make-puzzles.mjs [id ...]
//
// For each theme it picks a set of words that fills the 48 stops exactly, packs them into the grid as lines that
// never share a stop or cut across each other, and keeps the tidiest layout it finds. It then lists every other
// dictionary word that can be traced on that board (the "detours" that earn fare). The same seed gives the same
// boards, so running it again changes nothing unless a theme changed. Pass ids to print those boards.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { W, H, N, row, col, NEIGHBORS, diagonalSquare, spell, traces } from '../js/board.js';
import { THEMES } from './themes.mjs';
import { isRude } from './rude-words.mjs';

const require = createRequire(import.meta.url);
const MIN = 4;                    // shortest word that counts, theme or detour
const LAYOUTS = 1500;             // layouts to compare per word set
const SETS = 6;                   // word sets to try per theme

// ---- the dictionary -------------------------------------------------------------------------------------------
// SCOWL (via wordlist-english), every dialect, minus the words nobody wants to be told they found (tools/rude-words.mjs).
const lists = require('wordlist-english');
const DICT = new Set();
for (const key of ['english', 'english/american', 'english/british', 'english/canadian', 'english/australian']) {
  for (const w of lists[key]) if (/^[a-z]{4,14}$/.test(w) && !isRude(w)) DICT.add(w.toUpperCase());
}
const trie = { kids: new Map(), end: false };
for (const w of DICT) {
  let node = trie;
  for (const ch of w) { if (!node.kids.has(ch)) node.kids.set(ch, { kids: new Map(), end: false }); node = node.kids.get(ch); }
  node.end = true;
}

// ---- helpers ------------------------------------------------------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const shuffle = (a, rnd) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// The word sets that fill the grid, best first: six to eight words, favouring the ones listed earliest.
function wordSets(theme) {
  const all = theme.words.split(' ');
  const need = N - theme.cross.length;
  const out = [];
  const pick = (i, left, chosen, cost) => {
    if (left === 0) { if (chosen.length >= 6 && chosen.length <= 8) out.push({ words: chosen.slice(), cost: cost + 4 * Math.abs(chosen.length - 7) }); return; }
    if (i === all.length || left < MIN || chosen.length === 8) return;
    chosen.push(all[i]); pick(i + 1, left - all[i].length, chosen, cost + i); chosen.pop();
    pick(i + 1, left, chosen, cost);
  };
  pick(0, need, [], 0);
  return out.sort((a, b) => a.cost - b.cost).slice(0, SETS * 4);
}

// ---- packing ------------------------------------------------------------------------------------------------
// Fills the grid with one line per length in `lengths` (the Crosstown's first). Returns the lines, or null.
function pack(lengths, rnd) {
  const taken = new Uint8Array(N);
  const cut = new Uint8Array(N);            // little squares a diagonal already crosses
  const lines = [];
  let budget = 4000;

  const freeAround = i => { let n = 0; for (const j of NEIGHBORS[i]) if (!taken[j]) n++; return n; };
  const canStep = (a, b) => { if (taken[b]) return false; const d = diagonalSquare(a, b); return d < 0 || !cut[d]; };
  const lay = path => { for (let k = 0; k < path.length; k++) { taken[path[k]] = 1; if (k) { const d = diagonalSquare(path[k - 1], path[k]); if (d >= 0) cut[d] = 1; } } };
  const lift = path => { for (let k = 0; k < path.length; k++) { taken[path[k]] = 0; if (k) { const d = diagonalSquare(path[k - 1], path[k]); if (d >= 0) cut[d] = 0; } } };

  // Each pocket of empty stops must be a size some of the remaining lines could add up to.
  const fits = rest => {
    const sums = new Uint8Array(N + 1); sums[0] = 1;
    for (const len of rest) for (let s = N; s >= len; s--) if (sums[s - len]) sums[s] = 1;
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (taken[i] || seen[i]) continue;
      let size = 0; const stack = [i]; seen[i] = 1;
      while (stack.length) { const a = stack.pop(); size++; for (const b of NEIGHBORS[a]) if (!taken[b] && !seen[b]) { seen[b] = 1; stack.push(b); } }
      if (!sums[size]) return false;
    }
    return true;
  };

  // The Crosstown: from one edge to the opposite one.
  const across = lengths[0] < H ? true : rnd() < 0.5;
  const along = across ? col : row, far = across ? W - 1 : H - 1;
  const starts = shuffle(Array.from({ length: N }, (_, i) => i).filter(i => along(i) === 0), rnd);
  const cross = [];
  const walkCross = i => {
    if (--budget < 0) return false;
    cross.push(i); taken[i] = 1;
    const left = lengths[0] - cross.length;
    if (left === 0) { if (along(i) === far) return true; }
    else if (far - along(i) <= left) {
      for (const j of shuffle(NEIGHBORS[i].slice(), rnd)) {
        if (!canStep(i, j)) continue;
        if (left > 1 && along(j) === far && rnd() < 0.7) continue;  // don't hug the far edge early
        const d = diagonalSquare(i, j); if (d >= 0) cut[d] = 1;
        if (walkCross(j)) return true;
        if (d >= 0) cut[d] = 0;
      }
    }
    cross.pop(); taken[i] = 0;
    return false;
  };
  let placed = false;
  for (const s of starts) { if (walkCross(s)) { placed = true; break; } if (budget < 0) return null; }
  if (!placed || !fits(lengths.slice(1))) return null;
  lines.push(cross.slice());

  // Then the rest, always starting from the most hemmed-in empty stop.
  const fill = rest => {
    if (!rest.length) return true;
    let best = -1, least = 99;
    for (let i = 0; i < N; i++) if (!taken[i]) { const f = freeAround(i) + rnd() * 0.5; if (f < least) { least = f; best = i; } }
    for (const len of shuffle([...new Set(rest)], rnd)) {
      const after = rest.slice(); after.splice(after.indexOf(len), 1);
      let tries = 0;
      const path = [];
      const grow = i => {
        if (--budget < 0 || tries > 10) return false;
        path.push(i); taken[i] = 1;
        if (path.length === len) {
          tries++;
          if (fits(after)) { lines.push(path.slice()); if (fill(after)) return true; lines.pop(); }
        } else {
          const before = path.length > 1 ? path[path.length - 2] : -1;
          const straight = j => before >= 0 && j - i === i - before && col(j) - col(i) === col(i) - col(before);
          const next = NEIGHBORS[i].filter(j => canStep(i, j)).map(j => [freeAround(j) + rnd() * 3 + (straight(j) ? 1.5 : 0), j]).sort((a, b) => a[0] - b[0]);
          for (const [, j] of next) {
            const d = diagonalSquare(i, j); if (d >= 0) cut[d] = 1;
            if (grow(j)) return true;
            if (d >= 0) cut[d] = 0;
          }
        }
        path.pop(); taken[i] = 0;
        return false;
      };
      if (grow(best)) return true;
      if (budget < 0) return false;
    }
    return false;
  };
  return fill(lengths.slice(1)) ? lines : null;
}

// ---- judging a layout ---------------------------------------------------------------------------------------
function turns(path) {
  let n = 0, run = 1, longest = 1;
  for (let k = 2; k < path.length; k++) {
    const same = path[k] - path[k - 1] === path[k - 1] - path[k - 2] && col(path[k]) - col(path[k - 1]) === col(path[k - 1]) - col(path[k - 2]);
    if (same) { run++; longest = Math.max(longest, run + 1); } else { n++; run = 1; }
  }
  return { n, longest: Math.max(longest, 2) };
}

// Lower is better. A word that can also be spelled through some other line's stops is the thing to avoid.
function judge(grid, words, lines) {
  let stray = 0, dull = 0;
  words.forEach((word, k) => {
    const own = new Set(lines[k]);
    for (const t of traces(grid, word, 12)) if (t.some(i => !own.has(i))) stray++;
    const { n, longest } = turns(lines[k]);
    if (n === 0) dull += 3;
    dull += Math.max(0, longest - 4);
  });
  return stray * 100 + dull;
}

// ---- detours --------------------------------------------------------------------------------------------------
function detours(grid, answers) {
  const found = new Set();
  const used = new Uint8Array(N);
  const walk = (i, node, sofar) => {
    const next = node.kids.get(grid[i]);
    if (!next) return;
    used[i] = 1; sofar += grid[i];
    if (next.end) found.add(sofar);
    for (const j of NEIGHBORS[i]) if (!used[j]) walk(j, next, sofar);
    used[i] = 0;
  };
  for (let i = 0; i < N; i++) walk(i, trie, '');
  for (const a of answers) found.delete(a);
  return [...found].sort();
}

// ---- make them ------------------------------------------------------------------------------------------------
const show = new Set(process.argv.slice(2));
const puzzles = [];
for (const theme of THEMES) {
  const sets = wordSets(theme);
  if (!sets.length) throw new Error(`${theme.id}: no set of 6 to 8 words fills ${N - theme.cross.length} stops`);
  let best = null;
  sets.forEach((set, rank) => {
    if (best && best.score <= rank * 2) return;
    if (rank >= SETS && best && best.score < 100) return;   // past the first few sets only to clear up a stray word
    const words = [theme.cross, ...set.words];
    const lengths = words.map(w => w.length);
    let made = 0;
    for (let attempt = 0; made < LAYOUTS && attempt < LAYOUTS * 40; attempt++) {
      const rnd = rng(hash(`${theme.id}/${rank}/${attempt}`));
      const lines = pack(lengths, rnd);
      if (!lines) continue;
      made++;
      // Give each line a word of its length, read from either end. A few goes each, since a different pairing
      // can clear up a word that could otherwise be spelled through its neighbours.
      for (let go = 0; go < 4; go++) {
        const byLength = new Map();
        lines.forEach((line, k) => { if (k) { if (!byLength.has(line.length)) byLength.set(line.length, []); byLength.get(line.length).push(line); } });
        for (const group of byLength.values()) shuffle(group, rnd);
        const laid = words.map((w, k) => {
          const line = k === 0 ? lines[0] : byLength.get(w.length).pop();
          return k === 0 ? (rnd() < 0.25 ? line.slice().reverse() : line) : (rnd() < 0.5 ? line.slice().reverse() : line);
        });
        const grid = Array(N);
        laid.forEach((line, k) => line.forEach((cell, n) => { grid[cell] = words[k][n]; }));
        const score = judge(grid, words, laid) + rank * 2;
        if (!best || score < best.score) best = { score, grid: grid.join(''), lines: laid, words };
      }
      if (best.score <= rank * 2) break;
    }
  });
  if (!best) throw new Error(`${theme.id}: couldn't lay it out`);
  const extra = detours(best.grid, best.words);
  const name = theme.name ?? theme.id[0].toUpperCase() + theme.id.slice(1).replaceAll('-', ' ');
  puzzles.push({ id: theme.id, name, clue: theme.clue, grid: best.grid, lines: best.lines, detours: extra.join(' ').toLowerCase() });
  console.log(`${theme.id.padEnd(15)} score ${String(best.score).padStart(3)}  ${best.words.length - 1} lines + ${theme.cross}  ${extra.length} detours  ${best.words.slice(1).join(' ')}`);
  if (show.has(theme.id)) {
    for (let r = 0; r < H; r++) console.log('   ' + best.grid.slice(r * W, r * W + W).split('').join(' '));
    best.lines.forEach((l, k) => console.log(`   ${spell(best.grid, l)}: ${l.join(',')}`));
  }
}

const body = puzzles.map(p => `  { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, clue: ${JSON.stringify(p.clue)},\n    grid: '${p.grid}',\n    lines: ${JSON.stringify(p.lines)},\n    detours: '${p.detours}' },`).join('\n');
await writeFile(new URL('../js/puzzles.js', import.meta.url),
`// Written by tools/make-puzzles.mjs from tools/themes.mjs. Don't edit by hand: change the theme and run the tool.
// grid: the 48 letters, across then down. lines: the stops of each theme word in order, the Crosstown first.
// detours: every other word that can be traced on the board; finding one earns fare.
export const PUZZLES = [
${body}
];
`);
console.log(`\n${puzzles.length} puzzles written to js/puzzles.js`);
