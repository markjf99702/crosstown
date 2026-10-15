// Crosstown: the list of puzzles, the map you trace on, and what's saved between visits.
import { PUZZLES } from './puzzles.js';
import { W, H, N, row, col, adjacent, spell } from './board.js';
import { MIN_LENGTH, FARE_PER_TOKEN, fareFor, starsFor, clock } from './rules.js';

const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const k in attrs) el.setAttribute(k, attrs[k]); return el; };
const SITE = 'https://crosstown.junkdrawer.works/';
const single = 'single' in document.documentElement.dataset;   // the one-file copy, shown inside another page
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1-4.5-4.3 6.1-.8z"/></svg>';

// ---- what's saved -----------------------------------------------------------------------------------------------
const KEY = 'crosstown.v1';
const fresh = () => ({ found: [], detours: [], fare: 0, tokens: 0, spent: 0, hint: null, ms: 0, done: false, crossAt: -1, night: false });
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
let saved = { options: { clock: false, night: false }, games: {}, best: {} };
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (raw && typeof raw === 'object') saved = { options: { ...saved.options, ...raw.options }, games: isObject(raw.games) ? raw.games : {}, best: isObject(raw.best) ? raw.best : {} };
} catch { /* no storage here: play still works, it just isn't kept */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* same */ } };

// A saved game, read against its puzzle, so a damaged save or one from an older layout of the board can't stop
// the page: line numbers the board doesn't have are dropped, and anything else that can't be read starts fresh.
const byId = new Map(PUZZLES.map(p => [p.id, p]));
function gameFor(id) {
  const g = saved.games[id], p = byId.get(id);
  if (!isObject(g) || !p) return null;
  const n = p.lines.length;
  const count = v => (Number.isInteger(v) && v >= 0 ? v : 0);
  const found = Array.isArray(g.found) ? [...new Set(g.found.filter(k => Number.isInteger(k) && k >= 0 && k < n))] : [];
  const h = g.hint;
  const hint = isObject(h) && Number.isInteger(h.line) && h.line >= 0 && h.line < n && !found.includes(h.line) ? { line: h.line, level: h.level > 1 ? 2 : 1 } : null;
  return {
    ...fresh(), ...g, found, hint,
    detours: Array.isArray(g.detours) ? g.detours.filter(d => typeof d === 'string') : [],
    fare: count(g.fare), tokens: count(g.tokens), spent: count(g.spent),
    ms: Number.isFinite(g.ms) && g.ms > 0 ? g.ms : 0,
    done: found.length === n, crossAt: Number.isInteger(g.crossAt) ? g.crossAt : -1, night: g.night === true,
  };
}
const started = g => !!g && (g.done || g.found.length > 0 || g.detours.length > 0);

// ---- the list ---------------------------------------------------------------------------------------------------
function nextUp(from = -1) {
  for (let k = 1; k <= PUZZLES.length; k++) { const i = (from + k) % PUZZLES.length; if (!gameFor(PUZZLES[i].id)?.done) return i; }
  return -1;
}

function drawList() {
  const route = $('route');
  route.textContent = '';
  let finished = 0, stars = 0, prevDone = false;
  PUZZLES.forEach((p, i) => {
    const g = gameFor(p.id);
    const state = g?.done ? 'done' : started(g) ? 'going' : 'todo';
    const li = document.createElement('li');
    li.className = state + (prevDone ? ' after-done' : '');
    prevDone = state === 'done';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'row';
    const sub = document.createElement('span'); sub.className = 'row-sub';
    if (state === 'done') {
      const n = starsFor(g); finished++; stars += n;
      const st = document.createElement('span'); st.className = 'st'; st.textContent = '★'.repeat(n) + '☆'.repeat(3 - n);
      st.setAttribute('aria-label', `${n} of 3 stars`);
      sub.append(p.name, ' ', st);
      if (saved.options.clock && saved.best[p.id]) sub.append(` ${clock(saved.best[p.id])}`);
    } else if (state === 'going') {
      sub.textContent = `${g.found.length} of ${p.lines.length} lines found`;
    } else {
      sub.textContent = `${p.lines.length} lines`;
    }
    // Night service keeps the clue off the list too, the same as on the sign, until a line is found.
    const dark = saved.options.night && !g?.done && !g?.found.length;
    const clue = document.createElement('span'); clue.className = 'row-clue' + (dark ? ' dark-hours' : ''); clue.textContent = dark ? 'Night service' : p.clue;
    const main = document.createElement('span'); main.className = 'row-main'; main.append(clue, sub);
    const num = document.createElement('span'); num.className = 'roundel'; num.textContent = i + 1;
    const go = document.createElement('span'); go.className = 'row-go'; go.setAttribute('aria-hidden', 'true');
    go.textContent = state === 'going' ? 'Resume' : state === 'done' ? 'Map' : '';
    btn.append(num, main, go);
    btn.addEventListener('click', () => openPuzzle(i));
    li.append(btn); route.append(li);
  });
  const up = nextUp();
  $('b-continue').textContent = up < 0 ? 'All finished' : `${started(gameFor(PUZZLES[up].id)) ? 'Resume' : 'Play'} No. ${up + 1}`;
  $('b-continue').disabled = up < 0;
  $('tally').textContent = finished ? `${finished} of ${PUZZLES.length} finished, ${stars} of ${PUZZLES.length * 3} stars` : `${PUZZLES.length} puzzles`;
}

// ---- one puzzle -------------------------------------------------------------------------------------------------
let cur = null;      // the puzzle on screen: { i, p, words, extra, lineOf, game }
let sel = [];        // stops in the word being traced
let cursor = -1;     // keyboard position
let drag = null;     // { changed, tapLast }
let ticking = 0, since = 0;
const board = $('board');
const layers = {};
const stops = [];

const cx = i => col(i) * 10 + 5, cy = i => row(i) * 10 + 5;
const points = path => path.map(i => `${cx(i)},${cy(i)}`).join(' ');

function buildBoard() {
  board.textContent = '';
  for (const name of ['lines', 'guide', 'trace', 'stops']) { layers[name] = svg('g'); board.append(layers[name]); }
  stops.length = 0;
  for (let i = 0; i < N; i++) {
    const g = svg('g', { class: 'stop' });
    g.append(svg('circle', { class: 'dot', cx: cx(i), cy: cy(i), r: 3.75 }), svg('circle', { class: 'ring', cx: cx(i), cy: cy(i), r: 4.45 }));
    const t = svg('text', { x: cx(i), y: cy(i) + 1.75 }); t.textContent = cur.p.grid[i];
    g.append(t); layers.stops.append(g); stops.push(g);
  }
}

function drawLine(k, isNew) {
  const line = svg('polyline', { class: `line c${k}${isNew ? ' fresh' : ''}`, points: points(cur.p.lines[k]), pathLength: 1 });
  layers.lines.append(line);
  if (k === 0) layers.lines.append(svg('polyline', { class: `stripe${isNew ? ' fresh' : ''}`, points: points(cur.p.lines[0]), pathLength: 1 }));
}

function paint() {
  const { p, game } = cur;
  const found = new Set(game.found);
  stops.forEach((g, i) => {
    const k = cur.lineOf[i];
    const on = found.has(k);
    const hinted = !on && game.hint && game.hint.line === k;
    g.setAttribute('class', 'stop' + (on ? ` on c${k}` : '') + (sel.includes(i) ? ' sel' : '') + (hinted ? ' hint' : '')
      + (hinted && game.hint.level > 1 && p.lines[k][0] === i ? ' first' : '') + (i === cursor ? ' cursor' : ''));
  });
  layers.trace.textContent = '';
  if (sel.length > 1) layers.trace.append(svg('polyline', { class: 'trace', points: points(sel) }));
  layers.guide.textContent = '';
  if (game.hint && game.hint.level > 1 && !found.has(game.hint.line)) layers.guide.append(svg('polyline', { class: 'guide', points: points(p.lines[game.hint.line]) }));

  const left = p.lines.length - game.found.length;
  $('count').textContent = game.done ? 'All found' : `${game.found.length} of ${p.lines.length} lines`;
  const hidden = saved.options.night && !game.found.length && !game.done;
  $('clue').textContent = hidden ? 'Night service. The clue shows up with your first line.' : p.clue;
  $('clue').classList.toggle('dark-hours', hidden);

  const pips = $('pips'); pips.textContent = '';
  for (let n = 0; n < FARE_PER_TOKEN; n++) { const pip = document.createElement('i'); if (n < game.fare) pip.className = 'full'; pips.append(pip); }
  $('meter').setAttribute('aria-label', `Fare: ${game.fare} of ${FARE_PER_TOKEN}`);
  const tok = $('b-token');
  tok.disabled = !game.tokens || !left || (game.hint?.level !== 1 && nextHint(game, p) === undefined);
  tok.classList.toggle('ready', !tok.disabled);
  $('token-label').textContent = game.tokens ? `Use a token (${game.tokens})` : 'No tokens';
  $('fare').hidden = game.done; $('after').hidden = !game.done;
  $('b-next').hidden = nextUp(cur.i) < 0;
}

function say(text, kind = '', chip = null) {
  const out = $('readout');
  out.className = 'readout' + (kind ? ` ${kind}` : '');
  out.textContent = '';
  if (chip !== null) { const dot = document.createElement('span'); dot.className = 'chip'; dot.style.background = chip ? `var(--l${chip})` : 'var(--cross)'; out.append(dot); }
  out.append(text);
  if (kind.includes('nope')) { out.style.animation = 'none'; void out.offsetWidth; out.style.animation = ''; }
}
const showTrace = () => say(sel.length ? spell(cur.p.grid, sel) : '');

function openPuzzle(i) {
  const p = PUZZLES[i];
  const lineOf = new Int8Array(N);
  p.lines.forEach((line, k) => line.forEach(stop => { lineOf[stop] = k; }));
  const game = gameFor(p.id) || fresh();
  cur = { i, p, words: p.lines.map(l => spell(p.grid, l)), extra: new Set(p.detours.split(' ')), lineOf, game };
  sel = []; cursor = -1;
  $('where').textContent = `No. ${i + 1}`;
  buildBoard();
  for (const k of game.found) drawLine(k, false);
  $('s-list').hidden = true; $('s-play').hidden = false;
  say(game.done ? p.name : '', game.done ? 'note' : '');
  paint();
  startClock();
}

function keep() { saved.games[cur.p.id] = cur.game; save(); }

function leave() {
  stopClock();
  if (cur && (cur.game.found.length || cur.game.detours.length || cur.game.ms > 5000)) keep();
  cur = null;
  $('s-play').hidden = true; $('s-list').hidden = false;
  drawList();
}

// The clock only runs while the puzzle is on screen and unfinished.
function startClock() {
  stopClock();
  $('clock').hidden = !saved.options.clock;
  $('clock').textContent = clock(cur.game.ms);
  if (cur.game.done || document.hidden) return;
  since = performance.now();
  ticking = setInterval(() => {
    const now = performance.now(); cur.game.ms += now - since; since = now;
    $('clock').textContent = clock(cur.game.ms);
  }, 500);
}
function stopClock() {
  if (!ticking) return;
  clearInterval(ticking); ticking = 0;
  if (cur) cur.game.ms += performance.now() - since;
}
document.addEventListener('visibilitychange', () => { if (!cur) return; if (document.hidden) { stopClock(); keep(); } else if (!anySheet()) startClock(); });

// ---- tracing ----------------------------------------------------------------------------------------------------
function stopAt(e, reach) {
  const box = board.getBoundingClientRect();
  const x = (e.clientX - box.left) / box.width * W, y = (e.clientY - box.top) / box.height * H;
  const c = Math.floor(x), r = Math.floor(y);
  if (c < 0 || c >= W || r < 0 || r >= H) return -1;
  return Math.hypot(x - c - 0.5, y - r - 0.5) <= reach ? r * W + c : -1;
}
const taken = i => cur.game.found.includes(cur.lineOf[i]);
// A stop on a finished line just tells you which line it is, whether you tap it or press Enter on it.
const nameLine = i => { const k = cur.lineOf[i]; say(k ? cur.words[k] : `Crosstown: ${cur.p.name}`, k ? '' : 'note', k); };

board.addEventListener('pointerdown', e => {
  if (!cur || e.button > 0) return;
  const i = stopAt(e, 0.5);
  if (i < 0) return;
  e.preventDefault();
  cursor = -1;
  if (taken(i)) { sel = []; nameLine(i); paint(); return; }
  if (cur.game.done) return;
  board.setPointerCapture?.(e.pointerId);
  drag = { changed: false, tapLast: false };
  const at = sel.indexOf(i);
  if (at >= 0 && at === sel.length - 1) drag.tapLast = true;
  else if (at >= 0) sel = sel.slice(0, at + 1);
  else if (sel.length && adjacent(sel[sel.length - 1], i)) sel.push(i);
  else sel = [i];
  showTrace(); paint();
});
board.addEventListener('pointermove', e => {
  if (!drag || !cur) return;
  const i = stopAt(e, 0.4);
  if (i < 0 || i === sel[sel.length - 1]) return;
  if (sel.length > 1 && i === sel[sel.length - 2]) sel.pop();
  else if (!sel.includes(i) && !taken(i) && adjacent(sel[sel.length - 1], i)) sel.push(i);
  else return;
  drag.changed = true;
  showTrace(); paint();
});
const lift = () => {
  if (!drag) return;
  const { changed, tapLast } = drag; drag = null;
  if (changed || tapLast) submit();
};
board.addEventListener('pointerup', lift);
board.addEventListener('pointercancel', () => { drag = null; });

// On a finished map every stop is on a found line, so the arrows and Enter only name lines there, as a tap does.
board.addEventListener('keydown', e => {
  if (!cur) return;
  const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
  if (step) {
    if (cursor < 0) cursor = sel.length ? sel[sel.length - 1] : 0;
    else { const r = row(cursor) + step[0], c = col(cursor) + step[1]; if (r >= 0 && r < H && c >= 0 && c < W) cursor = r * W + c; }
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (cursor < 0) return;
    const at = sel.indexOf(cursor);
    if (taken(cursor)) nameLine(cursor);
    else if (at >= 0 && at === sel.length - 1) { e.preventDefault(); submit(); return; }
    else if (at >= 0) sel = sel.slice(0, at + 1);
    else if (sel.length && adjacent(sel[sel.length - 1], cursor)) sel.push(cursor);
    else sel = [cursor];
    if (!taken(cursor)) showTrace();
  } else if ((e.key === 'Escape' || e.key === 'Backspace') && !cur.game.done) {
    if (e.key === 'Backspace') sel.pop(); else sel = [];
    showTrace();
  } else return;
  e.preventDefault(); paint();
});
board.addEventListener('blur', () => { if (cursor >= 0) { cursor = -1; if (cur) paint(); } });

function submit() {
  const { p, game, words } = cur;
  const word = spell(p.grid, sel);
  sel = [];
  if (word.length < MIN_LENGTH) {
    say(word.length > 1 ? 'Too short' : '', 'note nope');
  } else {
    const k = words.findIndex((w, n) => w === word && !game.found.includes(n));
    const lower = word.toLowerCase();
    if (k >= 0) return found(k);
    if (game.detours.includes(lower)) say(`${word} already counted`, 'note nope');
    else if (cur.extra.has(lower)) {
      const fare = fareFor(lower);
      game.detours.push(lower); game.fare += fare;
      let won = 0; while (game.fare >= FARE_PER_TOKEN) { game.fare -= FARE_PER_TOKEN; game.tokens++; won++; }
      say(`Detour: ${word.toLowerCase()}, +${fare} fare${won ? '. Token earned' : ''}`, 'note');
      keep();
    } else say('Not a word on this map', 'note nope');
  }
  paint();
}

function found(k) {
  const { p, game } = cur;
  if (!game.found.length) game.night = saved.options.night;
  if (k === 0) game.crossAt = game.found.length;
  game.found.push(k);
  if (game.hint?.line === k) game.hint = null;
  drawLine(k, true);
  say(k === 0 ? `Crosstown: ${p.name}` : cur.words[k], k === 0 ? 'note' : '', k);
  if (game.found.length === p.lines.length) {
    stopClock();
    game.done = true; game.hint = null;
    if (!saved.best[p.id] || game.ms < saved.best[p.id]) saved.best[p.id] = Math.round(game.ms);
    keep(); paint();
    setTimeout(() => { if (cur?.p === p) showDone(); }, 900);
    return;
  }
  keep(); paint();
}

// The line a new token would ring: any ordinary line first, the Crosstown only once it's the last one left.
// None when the only line left is the one whose route is already drawn.
function nextHint(game, p) {
  const open = p.lines.map((_, k) => k).filter(k => !game.found.includes(k) && k !== game.hint?.line);
  return open.find(k => k !== 0) ?? open[0];
}

$('b-token').addEventListener('click', () => {
  const { p, game } = cur;
  if (!game.tokens || game.done) return;
  if (game.hint && game.hint.level === 1) { game.hint.level = 2; say('The dashed route starts at the solid ring', 'note'); }
  else {
    const pick = nextHint(game, p);
    if (pick === undefined) return;
    game.hint = { line: pick, level: 1 };
    say(`${p.lines[pick].length} ringed stops make a line`, 'note');
  }
  game.tokens--; game.spent++;
  sel = [];
  keep(); paint();
});

// ---- sheets -----------------------------------------------------------------------------------------------------
const anySheet = () => [...document.querySelectorAll('.sheet')].some(s => !s.hidden);
let opener = null;
function openSheet(id) {
  opener = document.activeElement;
  // The clock stops while a sheet is open, so the letters go too: no studying the map off the clock.
  if (cur) { stopClock(); board.classList.toggle('paused', !cur.game.done); }
  $('app').inert = true;   // the page behind stays out of reach of Tab and screen readers until the sheet closes
  $(id).hidden = false;
  $(id).querySelector('.panel').focus?.();
  // The main button if it's showing (Next puzzle, Done, Got it), otherwise the first one that is.
  ($(id).querySelector('.btn.primary:not([hidden])') || $(id).querySelector('.btn:not([hidden])'))?.focus({ preventScroll: true });
}
function closeSheets() {
  for (const s of document.querySelectorAll('.sheet')) s.hidden = true;
  $('app').inert = false;
  board.classList.remove('paused');
  $('share-text').hidden = true;
  armed = null; $('m-restart').textContent = 'Start this puzzle over'; $('m-erase').textContent = 'Erase all progress';
  if (cur) startClock();
  opener?.focus?.({ preventScroll: true });
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheets(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && anySheet()) closeSheets(); });

function openMenu() {
  $('o-clock').checked = saved.options.clock; $('o-night').checked = saved.options.night;
  $('m-restart').hidden = !cur; $('m-erase').hidden = !!cur;
  openSheet('sheet-menu');
}
$('b-menu').addEventListener('click', openMenu);
$('b-list-menu').addEventListener('click', openMenu);
$('b-how').addEventListener('click', () => openSheet('sheet-how'));
$('m-how').addEventListener('click', () => { closeSheets(); openSheet('sheet-how'); });
$('o-clock').addEventListener('change', e => { saved.options.clock = e.target.checked; save(); if (cur) $('clock').hidden = !e.target.checked; else drawList(); });
$('o-night').addEventListener('change', e => { saved.options.night = e.target.checked; save(); if (cur) paint(); else drawList(); });

// The page can't show a confirm box everywhere it runs, so the button asks for a second tap instead.
let armed = null;
function twice(btn, ask, act) {
  btn.addEventListener('click', () => {
    if (armed !== btn) { armed = btn; btn.textContent = ask; return; }
    armed = null; act();
  });
}
twice($('m-restart'), 'Tap again to clear this puzzle', () => {
  cur.game = fresh(); delete saved.games[cur.p.id]; save();
  const i = cur.i; closeSheets(); openPuzzle(i);
});
twice($('m-erase'), 'Tap again to erase everything', () => {
  saved.games = {}; saved.best = {}; save(); closeSheets(); drawList(); toast('Progress erased');
});

function shareText() {
  const { p, game, i } = cur;
  const n = starsFor(game);
  const bits = [`${p.lines.length} lines`, game.spent ? `${game.spent} token${game.spent > 1 ? 's' : ''}` : 'no tokens'];
  if (saved.options.clock) bits.push(clock(game.ms));
  if (game.night) bits.push('night service');
  return `Crosstown No. ${i + 1} ${'★'.repeat(n)}${'☆'.repeat(3 - n)}\n${bits.join(', ')}\n${SITE}`;
}

function showDone() {
  const { p, game, words } = cur;
  $('done-title').textContent = p.name;
  const rows = [['Every stop on a line', true], ['No tokens spent', game.spent === 0], ['Crosstown found first', game.crossAt === 0]];
  $('done-stars').innerHTML = rows.map(([label, got]) => `<li class="${got ? 'got' : ''}">${STAR}<span>${label}</span></li>`).join('');
  const stats = [`${game.detours.length} detour${game.detours.length === 1 ? '' : 's'}`];
  if (game.spent) stats.unshift(`${game.spent} token${game.spent > 1 ? 's' : ''} spent`);
  if (saved.options.clock) stats.unshift(clock(game.ms));
  if (game.night) stats.push('night service');
  $('done-stats').textContent = stats.join(', ');
  const key = $('done-key'); key.textContent = '';
  words.forEach((w, k) => {
    const li = document.createElement('li'); if (k === 0) li.className = 'xt';
    const sw = document.createElement('i'); sw.className = `c${k}`;
    li.append(sw, k === 0 ? `${w} (the Crosstown)` : w); key.append(li);
  });
  const more = nextUp(cur.i) >= 0;
  $('b-done-next').hidden = !more;
  openSheet('sheet-done');
}
$('b-results').addEventListener('click', showDone);
const goNext = () => { const n = nextUp(cur.i); closeSheets(); if (n >= 0) { stopClock(); keep(); openPuzzle(n); } };
$('b-next').addEventListener('click', goNext);
$('b-done-next').addEventListener('click', goNext);

$('b-share').addEventListener('click', async () => {
  const text = shareText();
  if (!single && navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ text }); return; } catch (err) { if (err?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Result copied'); }
  catch {
    const box = $('share-text'); box.value = text; box.hidden = false; box.focus(); box.select();
    toast('Select the text and copy it');
  }
});

let toastTimer = 0;
function toast(text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---- start ------------------------------------------------------------------------------------------------------
$('b-back').addEventListener('click', leave);
$('b-continue').addEventListener('click', () => { const n = nextUp(); if (n >= 0) openPuzzle(n); });
window.addEventListener('pagehide', () => { if (cur) { stopClock(); keep(); } });
drawList();

if (!single && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
