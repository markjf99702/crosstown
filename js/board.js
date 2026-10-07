// The map's geometry: a grid of stops, numbered across then down, where a line may step to any of the
// eight stops around it. Used by the game, by the tool that lays puzzles out, and by the tests.

export const W = 6;
export const H = 8;
export const N = W * H;

export const row = i => Math.floor(i / W);
export const col = i => i % W;

export function adjacent(a, b) {
  return a !== b && Math.abs(row(a) - row(b)) <= 1 && Math.abs(col(a) - col(b)) <= 1;
}

export const NEIGHBORS = Array.from({ length: N }, (_, i) => {
  const out = [];
  for (let j = 0; j < N; j++) if (adjacent(i, j)) out.push(j);
  return out;
});

// A diagonal step cuts across one little square of four stops. Two lines can't both cut across the same one.
// Returns that square's number, or -1 for a step along a row or column.
export function diagonalSquare(a, b) {
  if (row(a) === row(b) || col(a) === col(b)) return -1;
  return Math.min(row(a), row(b)) * W + Math.min(col(a), col(b));
}

export const spell = (grid, path) => path.map(i => grid[i]).join('');

// Does the path touch two opposite edges of the map?
export function spans(path) {
  const rows = path.map(row), cols = path.map(col);
  return (rows.includes(0) && rows.includes(H - 1)) || (cols.includes(0) && cols.includes(W - 1));
}

// Every way to spell `word` by stepping from stop to stop without reusing one. Stops at `limit` finds.
export function traces(grid, word, limit = 50) {
  const found = [];
  const used = new Uint8Array(N);
  const path = [];
  const walk = (i, k) => {
    if (found.length >= limit || grid[i] !== word[k]) return;
    used[i] = 1; path.push(i);
    if (k === word.length - 1) found.push(path.slice());
    else for (const j of NEIGHBORS[i]) if (!used[j]) walk(j, k + 1);
    used[i] = 0; path.pop();
  };
  for (let i = 0; i < N; i++) walk(i, 0);
  return found;
}
