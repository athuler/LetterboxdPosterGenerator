import { TMDB_PROXY_URL } from './config.js';
import { parseExport } from './parse.js';

// Optional, gitignored config.local.js: lets a local clone call TMDB directly with its own key, no Worker.
// Only tried on localhost so the deployed site doesn't request a file that never exists there.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const { TMDB_API_KEY = '' } = LOCAL ? await import('./config.local.js').catch(() => ({})) : {};

const $ = id => document.getElementById(id);
const canvas = $('poster'), ctx = canvas.getContext('2d');
const IMG = 'https://image.tmdb.org/t/p/';
// Browsers refuse canvases past these sizes (Safari: ~16.7M pixels; Chrome: 32767px per side),
// so very long lists render at a lower resolution instead of failing.
const MAX_AREA = 16e6, MAX_SIDE = 32000;

let sources = [];   // [{ title, films }] from the dropped zip
let films = [];     // the working list the poster is drawn from

const status = msg => { $('status').textContent = msg; };

// ---------- TMDB: via the Worker proxy (holds the key), or directly with a local key ----------
async function tmdb(params) {
  const url = new URL(TMDB_API_KEY ? 'https://api.themoviedb.org/3/search/movie' : TMDB_PROXY_URL + '/search');
  for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
  const init = {};
  if (TMDB_API_KEY) {
    // v4 read-access tokens are long JWTs sent as a header; short v3 keys go in the query.
    if (TMDB_API_KEY.length > 40) init.headers = { Authorization: 'Bearer ' + TMDB_API_KEY };
    else url.searchParams.set('api_key', TMDB_API_KEY);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error('TMDB ' + res.status);
  return res.json();
}

// At most 6 TMDB requests in flight.
let active = 0;
const queue = [];
function limited(fn) {
  return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
}
function pump() {
  while (active < 6 && queue.length) {
    const { fn, resolve, reject } = queue.shift();
    active++;
    fn().then(resolve, reject).finally(() => { active--; pump(); });
  }
}

// Poster lookups: in-flight dedupe + permanent localStorage cache (includes "no match" as null).
const inflight = new Map();
const keyOf = f => f.uri || `${f.name}|${f.year}`;
function stored(k) {
  try { const v = localStorage.getItem('poster:' + k); return v === null ? undefined : JSON.parse(v); }
  catch { return undefined; }
}
function store(k, v) { try { localStorage.setItem('poster:' + k, JSON.stringify(v)); } catch {} }

function lookupPoster(f) {
  const k = keyOf(f);
  const hit = stored(k);
  if (hit !== undefined) return Promise.resolve(hit);
  if (!inflight.has(k)) {
    inflight.set(k, limited(async () => {
      let d = await tmdb({ query: f.name, year: f.year });
      // Letterboxd and TMDB sometimes disagree on the release year by one.
      if (!d.results.length && f.year) d = await tmdb({ query: f.name });
      return d.results[0]?.poster_path ?? null;
    }).then(p => { store(k, p); return p; })
      .catch(() => { inflight.delete(k); return null; })); // errors aren't cached, so a later try retries
  }
  return inflight.get(k);
}

function resolvePosters() {
  for (const f of films) {
    if (f.poster !== undefined) continue;
    f.poster = stored(keyOf(f));
    if (f.poster === undefined) lookupPoster(f).then(p => { f.poster = p; scheduleRender(); });
  }
}

const images = new Map();
function image(path) {
  if (!images.has(path)) {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // keeps the canvas exportable
    img.onload = img.onerror = scheduleRender;
    img.src = IMG + 'w342' + path;
    images.set(path, img);
  }
  return images.get(path);
}

// ---------- Rendering ----------
// The gap scales with the poster width so any number of columns fits the fixed poster width.
const W = 1500, PAD = 70, GAP_RATIO = 0.08;
let frame = 0;
function scheduleRender() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); }

function contrast(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#151515' : '#f2f2f2';
}
function fit(text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  while (text && ctx.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}
const stars = r => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');

function textTile(f, x, y, w, h, fg) {
  ctx.save();
  ctx.globalAlpha = 0.12; ctx.fillStyle = fg; ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const size = Math.max(12, w / 9);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const lines = [];
  for (const word of f.name.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && ctx.measureText(lines[last] + ' ' + word).width < w * 0.85) lines[last] += ' ' + word;
    else lines.push(word);
  }
  const shown = lines.slice(0, 6);
  shown.forEach((l, i) => ctx.fillText(fit(l, w * 0.9), x + w / 2, y + h / 2 + (i - (shown.length - 1) / 2) * size * 1.2));
  ctx.restore();
}

function render() {
  const cols = Math.max(2, Math.floor(Number($('cols').value)) || 5);
  const title = $('title').value.trim();
  const captions = $('captions').checked;
  const bg = $('bg').value, fg = contrast(bg);
  const tileW = (W - 2 * PAD) / (cols + (cols - 1) * GAP_RATIO), gap = tileW * GAP_RATIO, tileH = tileW * 1.5;
  const capSize = Math.max(11, Math.min(26, tileW / 10));
  const capH = captions ? capSize * 2.8 : 0;
  const headH = title ? 150 : 0;
  const rows = Math.max(1, Math.ceil(films.length / cols));

  const H = 2 * PAD + headH + rows * (tileH + capH) + (rows - 1) * gap;
  const scale = Math.min(1, Math.sqrt(MAX_AREA / (W * H)), MAX_SIDE / H);
  canvas.width = Math.floor(W * scale);
  canvas.height = Math.floor(H * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0); // draw in poster units; the canvas size above already applied the scale
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'top';

  if (title) {
    ctx.font = 'bold 76px system-ui, sans-serif';
    ctx.fillText(fit(title, W - 2 * PAD), W / 2, PAD);
  }
  if (!films.length) {
    ctx.font = '36px system-ui, sans-serif'; ctx.globalAlpha = 0.6;
    ctx.fillText('Drop your Letterboxd export or add films', W / 2, PAD + headH + tileH / 2);
    ctx.globalAlpha = 1;
  }

  films.forEach((f, i) => {
    const x = PAD + (i % cols) * (tileW + gap);
    const y = PAD + headH + Math.floor(i / cols) * (tileH + capH + gap);
    const img = f.poster && image(f.poster);
    if (img && img.complete && img.naturalWidth) ctx.drawImage(img, x, y, tileW, tileH);
    else textTile(f, x, y, tileW, tileH, fg);
    if (captions) {
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = `600 ${capSize}px system-ui, sans-serif`;
      ctx.fillText(fit(f.name, tileW), x + tileW / 2, y + tileH + capSize * 0.4);
      ctx.font = `${capSize * 0.9}px system-ui, sans-serif`;
      ctx.globalAlpha = 0.7;
      ctx.fillText(fit([f.year, f.rating ? stars(f.rating) : ''].filter(Boolean).join('  '), tileW),
        x + tileW / 2, y + tileH + capSize * 1.6);
      ctx.globalAlpha = 1;
    }
  });

  // Line the editing overlay up with the drawn posters, in % so it follows the canvas's CSS size.
  const pct = (v, total) => (v / total * 100) + '%';
  [...$('tiles').children].forEach((el, i) => {
    el.style.left = pct(PAD + (i % cols) * (tileW + gap), W);
    el.style.top = pct(PAD + headH + Math.floor(i / cols) * (tileH + capH + gap), H);
    el.style.width = pct(tileW, W);
    el.style.height = pct(tileH, H);
  });
}

// ---------- Sorting (only uses data already in the export: no extra requests) ----------
// Each film carries `order` (position in the source list / when added) and `custom` (hand-arranged rank),
// so "List order" and "Custom" can always be restored after trying other sorts.
let seq = 0; // next order/custom value for films added by search

// Missing values (no year, unrated, no date) always sort last.
const missingLast = (get, dir) => (a, b) => {
  const x = get(a), y = get(b);
  return isNaN(x) - isNaN(y) || dir * (x - y) || 0;
};
const SORTS = {
  list: (a, b) => a.order - b.order,
  custom: (a, b) => a.custom - b.custom,
  title: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  'year-asc': missingLast(f => parseInt(f.year), 1),
  'year-desc': missingLast(f => parseInt(f.year), -1),
  rating: missingLast(f => f.rating || NaN, -1),
  'date-desc': missingLast(f => Date.parse(f.date), -1),
  'date-asc': missingLast(f => Date.parse(f.date), 1),
  shuffle: (a, b) => a.rand - b.rand,
};

function applySort() {
  const sel = $('sort');
  // Offer rating/date sorts only when the current films have that data.
  const has = { rating: films.some(f => f.rating), 'date-desc': films.some(f => f.date), 'date-asc': films.some(f => f.date) };
  for (const [v, ok] of Object.entries(has)) sel.querySelector(`[value="${v}"]`).disabled = !ok;
  if (sel.selectedOptions[0]?.disabled) sel.value = 'list';
  for (const f of films) f.rand ??= Math.random();
  const cmp = SORTS[sel.value];
  films.sort((a, b) => cmp(a, b) || a.order - b.order);
}

// ---------- Editing on the preview: drag to reorder, ✕ / Delete to remove, arrow keys to move ----------
function move(from, to) {
  if (to < 0 || to >= films.length || from === to) return false;
  films.splice(to, 0, films.splice(from, 1)[0]);
  films.forEach((f, i) => { f.custom = i; }); // a hand move makes the current order the custom one
  $('sort').value = 'custom';
  update();
  return true;
}
function remove(i) { films.splice(i, 1); update(); }

function renderTiles() {
  $('tiles').replaceChildren(...films.map((f, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.tabIndex = 0;
    tile.draggable = true;
    tile.title = `${f.name}${f.year ? ` (${f.year})` : ''}`;
    tile.setAttribute('aria-label', `${i + 1}. ${tile.title}. Arrow keys move it, Delete removes it.`);
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', `Remove ${f.name}`);
    x.onclick = () => remove(i);
    tile.append(x);
    tile.onkeydown = e => {
      const to = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); if (move(i, to)) $('tiles').children[to].focus(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); remove(i);
        $('tiles').children[Math.min(i, films.length - 1)]?.focus();
      }
    };
    tile.ondragstart = e => { e.dataTransfer.setData('text/x-film', String(i)); tile.classList.add('dragging'); };
    tile.ondragend = () => tile.classList.remove('dragging');
    tile.ondragover = e => { if (e.dataTransfer.types.includes('text/x-film')) e.preventDefault(); };
    tile.ondrop = e => {
      const from = e.dataTransfer.getData('text/x-film');
      if (from === '') return;
      e.preventDefault(); e.stopPropagation();
      move(Number(from), i);
    };
    return tile;
  }));
  $('count').textContent = String(films.length);
}

function update() { applySort(); renderTiles(); resolvePosters(); scheduleRender(); }

// ---------- Zip import ----------
const LABELS = { watchlist: 'Watchlist', watched: 'Watched', ratings: 'Ratings' };

async function loadZip(file) {
  status(`Reading ${file.name}…`);
  try {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.values(zip.files).filter(e => !e.dir && !/(^|\/)deleted\//.test(e.name));
    const found = [];
    for (const e of entries) {
      const base = e.name.split('/').pop().replace(/\.csv$/, '');
      const isList = /(^|\/)lists\/[^/]+\.csv$/.test(e.name);
      if (!isList && !(LABELS[base] && e.name.endsWith('.csv'))) continue;
      const parsed = parseExport(await e.async('string'), Papa, LABELS[base] || base.replace(/-/g, ' '));
      if (parsed.films.length) found.push({ ...parsed, order: isList ? 1 : 0 });
    }
    if (!found.length) return status('No Letterboxd lists found in that zip.');
    sources = found.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    $('source').replaceChildren(new Option('Start empty', ''),
      ...sources.map((s, i) => new Option(`${s.title} (${s.films.length})`, String(i))));
    $('source').value = '0';
    pickSource();
    status(`Loaded ${sources.length} lists.`);
  } catch (err) {
    status(`Couldn't read that file: ${err.message}`);
  }
}

function pickSource() {
  const s = sources[$('source').value];
  films = (s ? s.films : []).map((f, i) => ({ ...f, order: i, custom: i }));
  seq = films.length;
  $('title').value = s ? s.title : '';
  update();
}

// ---------- Search / add ----------
const searchCache = new Map();
let searchTimer;
async function search(q) {
  const box = $('results');
  if (!q) return box.replaceChildren();
  if (!searchCache.has(q)) {
    searchCache.set(q, limited(() => tmdb({ query: q }))
      .then(d => d.results.slice(0, 8))
      .catch(err => { searchCache.delete(q); throw err; }));
  }
  let results;
  try { results = await searchCache.get(q); } catch { box.textContent = 'Search failed.'; return; }
  if ($('search').value.trim() !== q) return; // a newer query is on its way
  box.replaceChildren(...results.map(m => {
    const b = document.createElement('button');
    b.type = 'button';
    const year = (m.release_date || '').slice(0, 4);
    const img = document.createElement('img');
    img.alt = '';
    if (m.poster_path) img.src = IMG + 'w92' + m.poster_path;
    b.append(img, `${m.title}${year ? ` (${year})` : ''}`);
    b.onclick = () => {
      films.push({ name: m.title, year, uri: 'tmdb:' + m.id, rating: 0, date: '',
        poster: m.poster_path ?? null, order: seq, custom: seq++ });
      $('search').value = ''; box.replaceChildren();
      update();
    };
    return b;
  }));
  if (!results.length) box.textContent = 'No matches.';
}

// ---------- Wiring ----------
$('file').onchange = e => e.target.files[0] && loadZip(e.target.files[0]);
document.addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); document.body.classList.add('over'); }
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('over'); });
document.addEventListener('drop', e => {
  document.body.classList.remove('over');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  loadZip(e.dataTransfer.files[0]);
});
$('source').onchange = pickSource;
for (const id of ['title', 'cols', 'captions', 'bg']) $(id).oninput = scheduleRender;
$('clear').onclick = () => { films = []; update(); };
$('sort').onchange = () => {
  if ($('sort').value === 'shuffle') for (const f of films) f.rand = Math.random(); // re-pick to reshuffle
  update();
};
$('search').oninput = e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => search(q), 300);
};
$('download').onclick = () => {
  try {
    canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = ($('title').value.trim() || 'poster').replace(/[^\w-]+/g, '-') + '.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  } catch (err) {
    status(`Export blocked by the browser: ${err.message}`);
  }
};

if (LOCAL && !TMDB_API_KEY) status('Local dev: add your TMDB key in config.local.js (see README), or run the Worker on :8787.');
update();
