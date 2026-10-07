// Bundles the game into one self-contained HTML file, dist/crosstown.html, for sharing as a single page.
// Also writes dist/artifact.html, the same page without the document wrapper, for hosts that supply their own
// <html>, <head> and <body>. The repo itself runs without this step.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

const result = await build({
  entryPoints: [new URL('js/app.js', root).pathname],
  bundle: true, format: 'iife', minify: true, target: 'es2020', write: false,
});
// data-single tells the page it's the one-file copy: no service worker, and no system share sheet.
const js = `document.documentElement.dataset.single = '';\n${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}`;

// A single file can't point at other files, so the font and the icon go in as data: URIs, and the links
// that only make sense for the hosted site (manifest, home-screen icon, preload, link preview) come out.
const dataUri = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;
let css = await read('css/app.css');
for (const [, file] of css.matchAll(/url\(\.\.\/(fonts\/[^)]+\.woff2)\)/g)) css = css.replace(`url(../${file})`, `url(${await dataUri(file, 'font/woff2')})`);
const icon = await dataUri('icon.svg', 'image/svg+xml');
const html = (await read('index.html'))
  .replace(/ *<link rel="(manifest|apple-touch-icon|preload)"[^>]*>\n/g, '')
  .replace(/ *<meta (property="og:|name="twitter:|name="theme-color")[^>]*>\n/g, '')
  .replaceAll('"icon.svg"', () => `"${icon}"`)
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}</style>`)
  .replace(/ *<script type="module" src="js\/app.js"><\/script>\n/, '')
  .replace('</body>', () => `<script>\n${js}</script>\n</body>`);

// The host that wraps the fragment pads the page clear of a phone's notch and home bar itself,
// so the page's own allowance for them goes to zero there.
const swaps = [
  ['--safe-top: env(safe-area-inset-top, 0px);', '--safe-top: 0px;'],
  ['--safe-bottom: env(safe-area-inset-bottom, 0px);', '--safe-bottom: 0px;'],
];
let fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body[^>]*>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="(viewport|description)"[^>]*>\s*/gi, '')
  .replace(/ *<link rel="icon"[^>]*>\n/, '');
for (const [from, to] of swaps) {
  if (!fragment.includes(from)) throw new Error(`build: expected to find ${JSON.stringify(from)} in the page`);
  fragment = fragment.replace(from, to);
}

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/crosstown.html', root), html);
await writeFile(new URL('dist/artifact.html', root), fragment);
console.log(`dist/crosstown.html  ${(html.length / 1024).toFixed(1)} KB`);
console.log(`dist/artifact.html   ${(fragment.length / 1024).toFixed(1)} KB`);
