// Shared test setup: fake TMDB, fake poster images, a fake Letterboxd export, and small page helpers.
import { test as base, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';

export { expect };

// Every poster image is this colour, so tests can tell drawn art from text tiles.
export const ART = [200, 30, 60];
// Films whose name starts with this get no TMDB match (no poster).
const NO_MATCH = /^Noposter/i;

// ---------- A tiny PNG encoder (solid colour), so no image files are needed ----------
const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = buf => { let c = ~0; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return ~c >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(w, h, [r, g, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
const POSTER = png(40, 60, ART);

// Fake TMDB search: every query matches one film titled like the query, with a poster, except NO_MATCH.
function searchResults(url) {
  const q = url.searchParams.get('query') || '';
  const year = url.searchParams.get('year') || '2000';
  if (NO_MATCH.test(q)) return { results: [] };
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { results: [{ id: slug.length * 1000 + q.charCodeAt(0), title: q, release_date: `${year}-01-01`, poster_path: `/${slug}.png` }] };
}

async function mockNetwork(page) {
  // Never use a developer's real key: the app imports this on 127.0.0.1.
  await page.route('**/config.local.js', r => r.fulfill({ contentType: 'text/javascript', body: 'export {};' }));
  const tmdb = r => r.fulfill({ json: searchResults(new URL(r.request().url())), headers: { 'Access-Control-Allow-Origin': '*' } });
  await page.route('https://letterboxd-poster-tmdb.andreithuler.workers.dev/**', tmdb);
  await page.route('https://api.themoviedb.org/**', tmdb);
  await page.route('https://image.tmdb.org/**', r => r.fulfill({
    body: POSTER, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' },
  }));
}

// Each test gets a fresh browser context (empty storage), the fake network, and fails on any uncaught page error.
export const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await mockNetwork(page);
    await use(page);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  },
});

// ---------- A fake Letterboxd export ----------
export const LIST = [ // lists/favourites.csv, in list order
  ['Zodiac', '2007'], ['Alien', '1979'], ['Noposter Film', '2001'], ['Moon', '2009'], ['Crouching Tiger, Hidden Dragon', '2000'],
];
const csv = rows => rows.map(r => r.map(v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v).join(',')).join('\n') + '\n';
export const EXPORT = {
  'watched.csv': csv([['Date', 'Name', 'Year', 'Letterboxd URI'],
    ['2024-01-05', 'Heat', '1995', 'https://boxd.it/heat'], ['2024-02-01', 'Up', '2009', 'https://boxd.it/up'],
    ['2024-01-20', 'Jaws', '1975', 'https://boxd.it/jaws'], ['2023-12-01', 'Alien', '1979', 'https://boxd.it/alien']]),
  'ratings.csv': csv([['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating'],
    ['2024-03-01', 'Heat', '1995', 'https://boxd.it/heat', '4.5'], ['2024-01-10', 'Up', '2009', 'https://boxd.it/up', '3'],
    ['2024-02-15', 'Jaws', '1975', 'https://boxd.it/jaws', '5']]),
  'watchlist.csv': csv([['Date', 'Name', 'Year', 'Letterboxd URI'],
    ['2024-04-01', 'Dune', '2021', 'https://boxd.it/dune'], ['2024-04-02', 'Arrival', '2016', 'https://boxd.it/arrival']]),
  'lists/favourites.csv': 'Letterboxd list export v7\n' + csv([['Date', 'Name', 'Tags', 'URL', 'Description'],
    ['2024-01-02', 'Favourites, ranked', '', 'https://boxd.it/list', 'Some, description']]) + '\n' +
    csv([['Position', 'Name', 'Year', 'URL', 'Description'], ...LIST.map(([n, y], i) => [String(i + 1), n, y, `https://boxd.it/f${i}`, ''])]),
  'deleted/lists/old.csv': 'Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2020-01-01,Deleted list,,,\n\nPosition,Name,Year,URL,Description\n1,Gone,1990,https://boxd.it/gone,\n',
  'profile.csv': 'Date Joined,Username\n2020-01-01,someone\n',
};

// Drop a zip built from `files` onto the page, the way a user drags one in.
export async function dropZip(page, name = 'letterboxd-test-export.zip', files = EXPORT) {
  await page.waitForFunction(() => window.JSZip);
  await page.evaluate(async ({ name, files }) => {
    const zip = new JSZip();
    for (const [path, text] of Object.entries(files)) zip.file(path, text);
    const blob = await zip.generateAsync({ type: 'blob' });
    const dt = new DataTransfer();
    dt.items.add(new File([blob], name, { type: 'application/zip', lastModified: 1700000000000 }));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { name, files });
}

// Drop any bytes as a file (for the "not a Letterboxd export" case).
export async function dropFile(page, name, text) {
  await page.evaluate(({ name, text }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], name));
    document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { name, text });
}

export const tiles = page => page.locator('#tiles .tile');
// Poster titles in on-screen order, e.g. "Alien (1979)".
export const order = page => tiles(page).evaluateAll(els => els.map(e => e.title));
export const names = async page => (await order(page)).map(t => t.replace(/ \(\d{4}\)$/, ''));

export async function canvasSize(page) {
  await nextFrame(page);
  return page.evaluate(() => { const c = document.getElementById('poster'); return [c.width, c.height]; });
}
export const nextFrame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

// The preview's colour at the centre of the i-th poster tile.
export async function tileColour(page, i) {
  await nextFrame(page); // rebuilt tiles get their position on the next render
  return page.evaluate(i => {
    const c = document.getElementById('poster'), t = document.querySelectorAll('#tiles .tile')[i];
    const x = (parseFloat(t.style.left) + parseFloat(t.style.width) / 2) / 100 * c.width;
    const y = (parseFloat(t.style.top) + parseFloat(t.style.height) / 2) / 100 * c.height;
    return [...c.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3);
  }, i);
}

// Saving is debounced (300 ms); wait until localStorage has caught up.
export async function waitForSave(page, check = () => true) {
  await page.waitForFunction(fn => {
    try { const s = JSON.parse(localStorage.getItem('state')); return s && new Function('s', `return (${fn})(s)`)(s); }
    catch { return false; }
  }, check.toString());
}
