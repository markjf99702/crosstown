// The house rules that are plain arithmetic, kept apart so the tests can check them.

export const MIN_LENGTH = 4;        // shortest word that counts
export const FARE_PER_TOKEN = 4;    // fare a token costs

// A detour pays by its length: four letters earn 1, five 2, six 3, seven or more 4.
export const fareFor = word => Math.max(0, Math.min(4, word.length - 3));

// One star for finishing, one for spending no tokens, one for finding the Crosstown before any other line.
export function starsFor(game) {
  if (!game.done) return 0;
  return 1 + (game.spent === 0 ? 1 : 0) + (game.crossAt === 0 ? 1 : 0);
}

export function clock(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
