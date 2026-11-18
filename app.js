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
    if (f.poster === undefined) lookupPoster(f).then(p => {
      f.poster = p;
      if (p === null) renderTiles(); // the "no poster" count changes, and the film may now be hidden
      scheduleRender();
    });
  }
}

const images = new Map();
function image(path, size) {
  const key = size + path;
  if (!images.has(key)) {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // keeps the canvas exportable
    img.onload = img.onerror = scheduleRender;
    img.src = IMG + size + path;
    images.set(key, img);
  }
  return images.get(key);
}

// TMDB poster widths; never below w342 so small tiles reuse what's already cached.
const IMG_SIZES = [['w342', 342], ['w500', 500], ['w780', 780]];
const ready = img => img && img.complete && img.naturalWidth;
// The smallest TMDB size that's sharp at this tile width (in output pixels); until it arrives,
// fall back to any size already loaded so big posters never flash to text tiles.
function posterImage(path, px) {
  const [want] = IMG_SIZES.find(([, w]) => w >= px) || IMG_SIZES.at(-1);
  const img = image(path, want);
  if (ready(img)) return img;
  for (const [s] of IMG_SIZES) if (ready(images.get(s + path))) return images.get(s + path);
  return img;
}

// ---------- Rendering ----------
// The gap scales with the poster width so any number of columns fits the fixed poster width.
const W = 1500, PAD = 70, GAP_RATIO = 0.08;
let frame = 0;
function scheduleRender() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); }

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => hex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
function contrast(hex) {
  const [r, g, b] = rgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#151515' : '#f2f2f2';
}

// Fonts already on people's devices (nothing to download, and the canvas can use them straight away).
const FONTS = {
  sans: ['Sans', 'system-ui, sans-serif'],
  serif: ['Serif', 'Georgia, "Times New Roman", serif'],
  rounded: ['Rounded', 'ui-rounded, "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif'],
  condensed: ['Condensed', '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif-condensed, sans-serif'],
  display: ['Display', 'Impact, Haettenschweiler, "Arial Black", sans-serif'],
  mono: ['Mono', 'ui-monospace, Menlo, Consolas, monospace'],
};
const font = key => (FONTS[key] || FONTS.sans)[1];

// One-click looks; every value can be tweaked afterwards. Keys match the Style control ids.
const PRESETS = {
  Letterboxd: { 'bg-style': 'solid', bg: '#14181c', bg2: '#2c3440', 'fg-auto': true, 'title-font': 'sans', 'title-size': 76, 'cap-font': 'sans', 'cap-size': 1, border: 'none' },
  Paper: { 'bg-style': 'solid', bg: '#f4efe6', bg2: '#e6dccb', 'fg-auto': false, fg: '#2b2620', 'title-font': 'serif', 'title-size': 84, 'cap-font': 'serif', 'cap-size': 1, border: 'double' },
  Cinema: { 'bg-style': 'gradient', bg: '#120607', bg2: '#4a0f14', 'fg-auto': false, fg: '#f3e6c8', 'title-font': 'condensed', 'title-size': 100, 'cap-font': 'condensed', 'cap-size': 1.05, border: 'film' },
  Midnight: { 'bg-style': 'spotlight', bg: '#070b1c', bg2: '#2a3a78', 'fg-auto': false, fg: '#e8ecff', 'title-font': 'sans', 'title-size': 80, 'cap-font': 'sans', 'cap-size': 1, border: 'corners' },
  Garden: { 'bg-style': 'dots', bg: '#fdf3f2', bg2: '#f2b8c6', 'fg-auto': false, fg: '#6b2e3f', 'title-font': 'rounded', 'title-size': 84, 'cap-font': 'rounded', 'cap-size': 1, border: 'flowers' },
  Mono: { 'bg-style': 'grid', bg: '#ffffff', bg2: '#e4e4e4', 'fg-auto': false, fg: '#111111', 'title-font': 'mono', 'title-size': 70, 'cap-font': 'mono', 'cap-size': 0.95, border: 'line' },
};

function drawBackground(c, s, H, w = W) {
  if (s.bgStyle === 'gradient' || s.bgStyle === 'spotlight') {
    const g = s.bgStyle === 'gradient' ? c.createLinearGradient(0, 0, 0, H)
      : c.createRadialGradient(w / 2, H * 0.4, 0, w / 2, H * 0.4, Math.hypot(w, H) * 0.6);
    g.addColorStop(0, s.bgStyle === 'gradient' ? s.bg : s.bg2);
    g.addColorStop(1, s.bgStyle === 'gradient' ? s.bg2 : s.bg);
    c.fillStyle = g;
  } else c.fillStyle = s.bg;
  c.fillRect(0, 0, w, H);
  if (!['dots', 'stripes', 'grid'].includes(s.bgStyle)) return;
  c.save();
  c.fillStyle = c.strokeStyle = s.bg2;
  c.beginPath();
  if (s.bgStyle === 'dots') {
    for (let y = 15; y < H; y += 30) for (let x = 15 + (y / 30 % 2) * 15; x < w; x += 30) { c.moveTo(x + 3, y); c.arc(x, y, 3, 0, 2 * Math.PI); }
    c.fill();
  } else if (s.bgStyle === 'stripes') {
    c.lineWidth = 9;
    for (let x = -H; x < w; x += 34) { c.moveTo(x, H); c.lineTo(x + H, 0); }
    c.stroke();
  } else {
    c.lineWidth = 1.5;
    for (let x = 0; x <= w; x += 40) { c.moveTo(x, 0); c.lineTo(x, H); }
    for (let y = 0; y <= H; y += 40) { c.moveTo(0, y); c.lineTo(w, y); }
    c.stroke();
  }
  c.restore();
}

// Borders live in the page margin (PAD), so they never cover a poster.
function drawBorder(c, s, H, w = W) {
  if (s.border === 'none') return;
  c.save();
  c.strokeStyle = c.fillStyle = s.fg;
  c.globalAlpha = 0.85;
  const m = 28;
  if (s.border === 'line') { c.lineWidth = 3; c.strokeRect(m, m, w - 2 * m, H - 2 * m); }
  else if (s.border === 'double') {
    c.lineWidth = 3; c.strokeRect(m - 6, m - 6, w - 2 * m + 12, H - 2 * m + 12);
    c.lineWidth = 1.5; c.strokeRect(m + 4, m + 4, w - 2 * m - 8, H - 2 * m - 8);
  } else if (s.border === 'corners') {
    const L = Math.min(110, w / 6, H / 6);
    c.lineWidth = 4;
    c.beginPath();
    for (const [x, y, dx, dy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, H - m, 1, -1], [w - m, H - m, -1, -1]]) {
      c.moveTo(x + dx * L, y); c.lineTo(x, y); c.lineTo(x, y + dy * L);
      c.moveTo(x + dx * (L * 0.55), y + dy * 12); c.lineTo(x + dx * 12, y + dy * 12); c.lineTo(x + dx * 12, y + dy * (L * 0.55));
    }
    c.stroke();
  } else if (s.border === 'film') {
    // Sprocket holes down both sides, like a strip of 35 mm film.
    c.beginPath();
    for (let y = 22; y + 16 < H - 10; y += 38) for (const x of [16, w - 16 - 24]) c.roundRect(x, y, 24, 16, 3);
    c.fill();
    c.globalAlpha = 0.35; c.lineWidth = 2;
    c.beginPath(); c.moveTo(52, 0); c.lineTo(52, H); c.moveTo(w - 52, 0); c.lineTo(w - 52, H); c.stroke();
  } else if (s.border === 'flowers') {
    // Small five-petal flowers spaced evenly around the frame.
    const flower = (x, y) => {
      c.globalAlpha = 0.8; c.fillStyle = s.fg;
      for (let k = 0; k < 5; k++) {
        const a = k * 2 * Math.PI / 5 - Math.PI / 2;
        c.beginPath(); c.arc(x + Math.cos(a) * 8, y + Math.sin(a) * 8, 6.5, 0, 2 * Math.PI); c.fill();
      }
      c.globalAlpha = 1; c.fillStyle = s.bg2;
      c.beginPath(); c.arc(x, y, 4.5, 0, 2 * Math.PI); c.fill();
    };
    const m2 = 34, step = 64;
    const along = (len, f) => { const n = Math.max(1, Math.round(len / step)); for (let i = 0; i <= n; i++) f(i * len / n); };
    along(w - 2 * m2, d => { flower(m2 + d, m2); flower(m2 + d, H - m2); });
    along(H - 2 * m2, d => { if (d > 0 && d < H - 2 * m2) { flower(m2, m2 + d); flower(w - m2, m2 + d); } });
  }
  c.restore();
}
function fit(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  while (text && c.measureText(text + '…').width > maxW) text = text.slice(0, -1);
  return text + '…';
}
const stars = r => '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '');

function textTile(c, f, x, y, w, h, fg, family) {
  c.save();
  c.globalAlpha = 0.12; c.fillStyle = fg; c.fillRect(x, y, w, h);
  c.globalAlpha = 1; c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle';
  const size = Math.max(12, w / 9);
  c.font = `600 ${size}px ${family}`;
  const lines = [];
  for (const word of f.name.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && c.measureText(lines[last] + ' ' + word).width < w * 0.85) lines[last] += ' ' + word;
    else lines.push(word);
  }
  const shown = lines.slice(0, 6);
  shown.forEach((l, i) => c.fillText(fit(c, l, w * 0.9), x + w / 2, y + h / 2 + (i - (shown.length - 1) / 2) * size * 1.2));
  c.restore();
}

// The films that actually go on the poster: "no poster" means TMDB had no match (null), not still loading.
const shown = () => $('hide-missing').checked ? films.filter(f => f.poster !== null) : films;

// Where everything goes, in poster units (the poster is always W wide; H depends on the size setting).
// colsArg overrides the Columns field (used to try counts for Auto).
function layout(colsArg) {
  const list = shown(), n = list.length;
  const style = styleOf();
  const title = $('title-on').checked ? $('title').value.trim() : '';
  const cap = { title: $('cap-title').checked, year: $('cap-year').checked, rating: $('cap-rating').checked };
  const line2 = cap.year || cap.rating; // year and rating share the second caption line
  const lines = cap.title + line2;
  const ratio = Number($('size').value) || 0; // page height / width; 0 = grow to fit the films
  const headH = title ? style.titleSize + 74 : 0; // 150 at the default title size
  const capSizeFor = tw => Math.max(11, Math.min(26, tw / 10)) * style.capScale;
  const capFor = tw => lines ? capSizeFor(tw) * (0.4 + 1.2 * lines) : 0;

  function grid(cols) {
    const rows = Math.max(1, Math.ceil(n / cols));
    const gridH = tw => rows * (tw * 1.5 + capFor(tw)) + (rows - 1) * tw * GAP_RATIO;
    // Tiles fill the width; on a fixed-size page they shrink until the grid also fits the height.
    // (Captions have a minimum size, so one proportional step can undershoot: repeat a few times.)
    let tileW = (W - 2 * PAD) / (cols + (cols - 1) * GAP_RATIO);
    const H = ratio ? W * ratio : 2 * PAD + headH + gridH(tileW);
    const availH = H - 2 * PAD - headH;
    for (let k = 0; k < 5 && gridH(tileW) > availH; k++) tileW *= availH / gridH(tileW);
    return { cols, tileW, H, availH, gridH: gridH(tileW) };
  }

  const g = grid(colsArg ?? Math.max(1, Math.floor(Number($('cols').value)) || 5));
  const { cols, tileW, H, availH } = g;

  const gap = tileW * GAP_RATIO, tileH = tileW * 1.5;
  const capSize = capSizeFor(tileW);
  const capH = capFor(tileW);
  // Centre the grid in whatever space is left over.
  const x0 = (W - (cols * tileW + (cols - 1) * gap)) / 2;
  const y0 = PAD + headH + Math.max(0, availH - g.gridH) / 2;
  const at = i => [x0 + (i % cols) * (tileW + gap), y0 + Math.floor(i / cols) * (tileH + capH + gap)];
  // The smallest text on the poster, in poster units (0 = none): drives the download recommendations.
  const minText = !n ? 0 : line2 ? capSize * 0.9 : cap.title ? capSize : 0;
  return { list, cols, title, cap, line2, style, fg: style.fg, ratio, headH, H, availH, tileW, tileH, capSize, minText, at };
}

// Auto text colour reads against the background's average tone.
const autoFg = (bgStyle, bg, bg2) => contrast(['gradient', 'spotlight'].includes(bgStyle) ? mix(bg, bg2, 0.5) : bg);

function styleOf() {
  const bgStyle = $('bg-style').value, bg = $('bg').value, bg2 = $('bg2').value;
  return {
    bgStyle, bg, bg2,
    fg: $('fg-auto').checked ? autoFg(bgStyle, bg, bg2) : $('fg').value,
    titleFont: font($('title-font').value), titleSize: Number($('title-size').value) || 76,
    capFont: font($('cap-font').value), capScale: Number($('cap-size').value) || 1,
    border: $('border').value,
  };
}

// ---------- Visual pickers: buttons standing in for a hidden <select>; render() keeps them in sync ----------
// A mini poster: a smaller virtual page (TW wide) so borders and patterns stay visible at thumbnail size.
const TW = 500, TH = TW * Math.SQRT2;
function thumb(s, cvs = document.createElement('canvas')) {
  const css = 46, dpr = 2;
  cvs.width = css * dpr; cvs.height = Math.round(css * Math.SQRT2 * dpr);
  cvs.style.width = css + 'px';
  const c = cvs.getContext('2d');
  c.setTransform(cvs.width / TW, 0, 0, cvs.width / TW, 0, 0);
  drawBackground(c, s, TH, TW);
  drawBorder(c, s, TH, TW);
  c.fillStyle = s.fg;
  c.globalAlpha = 0.9; c.fillRect(TW * 0.3, 60, TW * 0.4, 22); // the title
  c.globalAlpha = 0.35;
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) c.fillRect(85 + k * 115, 120 + r * 170, 100, 150); // posters
  return cvs;
}
const pickers = [];
function picker(id, paint) {
  const sel = $(id), box = document.querySelector(`.picker[data-for="${id}"]`);
  box.replaceChildren(...[...sel.options].map(o => {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.value = o.value; b.title = o.text;
    b.setAttribute('aria-label', o.text);
    b.onclick = () => { sel.value = o.value; for (const t of ['input', 'change']) sel.dispatchEvent(new Event(t)); };
    return b;
  }));
  pickers.push({ sel, box, paint });
}
function syncPickers(s) {
  const style = $('style'); // thumbnails in "Customise" follow the current colours, repainted only while it's open
  for (const { sel, box, paint } of pickers) for (const b of box.children) {
    b.setAttribute('aria-pressed', String(b.dataset.value === sel.value));
    if (!b.firstChild || (style.open && style.contains(box))) paint(b, b.dataset.value, s);
  }
}
const caption = text => { const t = document.createElement('span'); t.textContent = text; return t; };
const SIZE_SHORT = { '': 'Fit', 1.4142: 'A', 0.7071: 'A ↔', 1.2941: 'Letter', 0.7727: 'Letter ↔', 1.5: '2:3', 1.3333: '3:4',
  1.25: '4:5', 1.5455: '11×17', 1: 'Square', 0.5625: 'Desktop', 2.1667: 'Phone' };
function paintThumb(b, s, text) {
  if (!b.firstChild) b.append(document.createElement('canvas'), caption(text));
  thumb(s, b.firstChild);
}

// The best column count: on a fixed page, the one that makes the posters biggest;
// on "Fit to films", the one closest to an A-series portrait shape.
function bestCols() {
  const off = L => Math.abs(L.H / W - Math.SQRT2);
  let best;
  for (let c = 1; c <= Math.max(1, Math.min(shown().length, 60)); c++) {
    const L = layout(c);
    if (!best || (L.ratio ? L.tileW > best.tileW * 1.0001 : off(L) < off(best))) best = L;
  }
  return best.cols;
}
function autoCols() {
  $('cols').value = bestCols();
  $('cols').dispatchEvent(new Event('input')); // re-render + save
}

// Draw the poster onto context c at `scale` output pixels per poster unit.
function draw(c, L, scale) {
  c.setTransform(scale, 0, 0, scale, 0, 0); // draw in poster units
  const s = L.style;
  drawBackground(c, s, L.H);
  drawBorder(c, s, L.H);
  c.fillStyle = L.fg; c.textAlign = 'center'; c.textBaseline = 'top';
  if (L.title) {
    c.font = `bold ${s.titleSize}px ${s.titleFont}`;
    c.fillText(fit(c, L.title, W - 2 * PAD), W / 2, PAD);
  }
  if (!L.list.length) {
    c.font = `36px ${s.capFont}`; c.globalAlpha = 0.6;
    c.fillText(films.length ? 'No films with posters' : 'Drop your Letterboxd export or add films',
      W / 2, PAD + L.headH + L.availH / 2 - 18);
    c.globalAlpha = 1;
  }
  const { tileW, tileH, capSize, cap } = L;
  L.list.forEach((f, i) => {
    const [x, y] = L.at(i);
    const img = f.poster && posterImage(f.poster, tileW * scale);
    if (ready(img)) c.drawImage(img, x, y, tileW, tileH);
    else textTile(c, f, x, y, tileW, tileH, L.fg, s.capFont);
    c.fillStyle = L.fg; c.textAlign = 'center'; c.textBaseline = 'top';
    let ty = y + tileH + capSize * 0.4;
    if (cap.title) {
      c.font = `600 ${capSize}px ${s.capFont}`;
      c.fillText(fit(c, f.name, tileW), x + tileW / 2, ty);
      ty += capSize * 1.2;
    }
    if (L.line2) {
      c.font = `${capSize * 0.9}px ${s.capFont}`;
      c.globalAlpha = 0.7;
      c.fillText(fit(c, [cap.year && f.year, cap.rating && f.rating ? stars(f.rating) : ''].filter(Boolean).join('  '), tileW),
        x + tileW / 2, ty);
      c.globalAlpha = 1;
    }
  });
}

// The on-screen preview: at most 1x (the download dialog renders bigger), within browser canvas limits.
function render() {
  const L = layout();
  const scale = Math.min(1, Math.sqrt(MAX_AREA / (W * L.H)), MAX_SIDE / L.H);
  canvas.width = Math.floor(W * scale);
  canvas.height = Math.floor(L.H * scale);
  draw(ctx, L, scale);

  // Keep the Style controls honest: show the automatic text colour, and the second colour only when used.
  if ($('fg-auto').checked) $('fg').value = L.fg;
  $('bg2').disabled = L.style.bgStyle === 'solid' && L.style.border !== 'flowers';
  for (const id of ['title-font', 'title-size']) $(id).disabled = !$('title-on').checked;
  syncPickers(L.style);

  // Line the editing overlay up with the drawn posters, in % so it follows the canvas's CSS size.
  const pct = (v, total) => (v / total * 100) + '%';
  [...$('tiles').children].forEach((el, i) => {
    const [x, y] = L.at(i);
    el.style.left = pct(x, W);
    el.style.top = pct(y, L.H);
    el.style.width = pct(L.tileW, W);
    el.style.height = pct(L.tileH, L.H);
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
// Tiles only cover the shown films, so moves and removals go by film, not by tile position.
function move(f, target) {
  if (!target || f === target) return false;
  const to = films.indexOf(target);
  films.splice(to, 0, films.splice(films.indexOf(f), 1)[0]);
  films.forEach((f, i) => { f.custom = i; }); // a hand move makes the current order the custom one
  $('sort').value = 'custom';
  update();
  return true;
}
function remove(f) { films.splice(films.indexOf(f), 1); update(); }

function renderTiles() {
  const list = shown();
  const missing = films.filter(f => f.poster === null).length;
  $('missing-count').textContent = missing ? ` (${missing})` : '';
  $('tiles').replaceChildren(...list.map((f, i) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.tabIndex = 0;
    tile.draggable = true;
    tile.title = `${f.name}${f.year ? ` (${f.year})` : ''}`;
    tile.setAttribute('aria-label', `${i + 1}. ${tile.title}. Arrow keys move it, Delete removes it.`);
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', `Remove ${f.name}`);
    x.onclick = () => remove(f);
    tile.append(x);
    tile.onkeydown = e => {
      const to = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1 }[e.key];
      if (to !== undefined) { e.preventDefault(); if (move(f, list[to])) $('tiles').children[to].focus(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); remove(f);
        const kids = $('tiles').children;
        kids[Math.min(i, kids.length - 1)]?.focus();
      }
    };
    tile.ondragstart = e => { e.dataTransfer.setData('text/x-film', String(i)); tile.classList.add('dragging'); };
    tile.ondragend = () => tile.classList.remove('dragging');
    tile.ondragover = e => { if (e.dataTransfer.types.includes('text/x-film')) e.preventDefault(); };
    tile.ondrop = e => {
      const from = e.dataTransfer.getData('text/x-film');
      if (from === '') return;
      e.preventDefault(); e.stopPropagation();
      move(list[Number(from)], f);
    };
    return tile;
  }));
}

function update() { applySort(); renderTiles(); resolvePosters(); scheduleRender(); saveState(); }

// ---------- Persistence: settings + film list in localStorage, recent zips in IndexedDB ----------
// Everything stays in this browser. Storage can be blocked (private windows), so every access is guarded.
const STYLE = ['bg-style', 'bg', 'bg2', 'fg', 'title-font', 'title-size', 'cap-font', 'cap-size', 'border'];
const SETTINGS = ['title', 'size', 'cols', 'sort', ...STYLE];
const CHECKS = ['cap-title', 'cap-year', 'cap-rating', 'hide-missing', 'fg-auto', 'title-on'];
const MAX_RECENT = 3;
let currentZipId = null;
let saveTimer;
// The saved source while its zip is still being re-read after a reload (the menu is empty until then).
let restoringSource;

function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const state = { zipId: currentZipId, source: restoringSource ?? $('source').value, films };
    for (const id of SETTINGS) state[id] = $(id).value;
    state.checks = Object.fromEntries(CHECKS.map(id => [id, $(id).checked]));
    try { localStorage.setItem('state', JSON.stringify(state)); } catch {}
  }, 300);
}

const db = new Promise((resolve, reject) => {
  try {
    const req = indexedDB.open('poster-generator', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('zips', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  } catch (err) { reject(err); }
});
db.catch(() => {}); // no IndexedDB: recent exports are simply unavailable

async function zips(mode, fn) {
  const tx = (await db).transaction('zips', mode);
  const req = fn(tx.objectStore('zips'));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function rememberZip(file) {
  const entry = { id: `${file.name}|${file.size}|${file.lastModified}`, name: file.name, size: file.size,
    addedAt: Date.now(), file };
  currentZipId = entry.id;
  try {
    await zips('readwrite', s => s.put(entry));
    const all = (await zips('readonly', s => s.getAll())).sort((a, b) => b.addedAt - a.addedAt);
    for (const old of all.slice(MAX_RECENT)) await zips('readwrite', s => s.delete(old.id));
  } catch {}
  renderRecent();
}

async function renderRecent() {
  let all = [];
  try { all = (await zips('readonly', s => s.getAll())).sort((a, b) => b.addedAt - a.addedAt); } catch {}
  $('recent').hidden = !all.length;
  $('recent-list').replaceChildren(...all.map(z => {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent-open';
    const size = z.size >= 1e6 ? `${(z.size / 1e6).toFixed(1)} MB` : `${Math.ceil(z.size / 1e3)} KB`;
    open.textContent = `${z.name} · ${size} · ${new Date(z.addedAt).toLocaleDateString()}`;
    open.onclick = () => openZip(z.file);
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.textContent = '✕';
    forget.setAttribute('aria-label', `Forget ${z.name}`);
    forget.onclick = async () => {
      try { await zips('readwrite', s => s.delete(z.id)); } catch {}
      if (currentZipId === z.id) { currentZipId = null; saveState(); }
      renderRecent();
    };
    li.append(open, forget);
    return li;
  }));
}

// A newly chosen file: keep it in the recent list, then load it.
// A newly chosen file: load it, and only keep it in the recent list if it was a readable export.
async function openZip(file) {
  if (!(await loadZip(file))) return;
  await rememberZip(file);
  saveState();
}

// While an export is loaded, its name + ✕ replace the drop zone and recent uploads.
function showLoaded(name) {
  $('picker').hidden = !!name;
  $('loaded').hidden = !name;
  $('loaded-name').textContent = name || '';
  $('lists-label').textContent = name ? `Lists (${sources.length})` : 'Lists';
}

function unloadZip() {
  sources = [];
  currentZipId = null;
  restoringSource = undefined;
  $('source').replaceChildren(new Option('Pick a list, or add films yourself', ''));
  $('file').value = ''; // so choosing the same file again still fires "change"
  showLoaded(null);
  renderRecent();
  saveState();
}

async function restore() {
  let state = null;
  try { state = JSON.parse(localStorage.getItem('state')); } catch {}
  if (state) {
    for (const id of SETTINGS) if (state[id] != null) $(id).value = state[id];
    if (state.checks) {
      for (const id of CHECKS) if (typeof state.checks[id] === 'boolean') $(id).checked = state.checks[id];
    } else { // saved before these options existed: keep caption on/off
      if (state.captions === false) for (const id of ['cap-title', 'cap-year', 'cap-rating']) $(id).checked = false;
    }
    films = Array.isArray(state.films) ? state.films : [];
    seq = films.reduce((m, f) => Math.max(m, f.order + 1, f.custom + 1), 0);
    currentZipId = state.zipId ?? null; // set before update() so its save keeps the link
    if (currentZipId) restoringSource = state.source;
  }
  update();
  renderRecent();
  if (!currentZipId) return;
  let entry;
  try { entry = await zips('readonly', s => s.get(currentZipId)); } catch {}
  if (!entry) { restoringSource = undefined; currentZipId = null; saveState(); return; } // zip was forgotten or storage cleared
  await loadZip(entry.file, state.source); // refills the Source menu without touching the restored films
  restoringSource = undefined;
}

// ---------- Zip import ----------
const LABELS = { watchlist: 'Watchlist', watched: 'Watched', ratings: 'Ratings' };

// restoreSource: when restoring after a reload, select this source but keep the saved film list.
// Returns true when the file was a readable Letterboxd export.
async function loadZip(file, restoreSource) {
  if (restoreSource === undefined) status(`Reading ${file.name}…`);
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
    if (!found.length) { status('No Letterboxd lists found in that zip.'); return false; }
    sources = found.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    $('source').replaceChildren(new Option('Pick a list, or add films yourself', ''),
      ...sources.map((s, i) => new Option(`${s.title} (${s.films.length})`, String(i))));
    status('');
    showLoaded(file.name);
    if (restoreSource !== undefined) {
      $('source').value = restoreSource; // keep the restored films
    } else {
      $('source').value = '0';
      pickSource();
    }
    return true;
  } catch (err) {
    status(`Couldn't read ${file.name}. Is it the .zip from Letterboxd's data export?`);
    return false;
  }
}

function pickSource() {
  const s = sources[$('source').value];
  films = (s ? s.films : []).map((f, i) => ({ ...f, order: i, custom: i }));
  seq = films.length;
  $('title').value = s ? s.title : '';
  update();
  autoCols(); // a new list gets the best column count
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
$('file').onchange = e => e.target.files[0] && openZip(e.target.files[0]);
document.addEventListener('dragover', e => {
  if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); document.body.classList.add('over'); }
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('over'); });
document.addEventListener('drop', e => {
  document.body.classList.remove('over');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  openZip(e.dataTransfer.files[0]);
});
$('source').onchange = pickSource;
for (const id of ['title', 'size', 'cols', 'cap-title', 'cap-year', 'cap-rating', 'title-on', 'fg-auto', ...STYLE]) {
  $(id).addEventListener('input', () => { scheduleRender(); saveState(); });
}
$('fg').addEventListener('input', () => { $('fg-auto').checked = false; }); // picking a colour turns Auto off

// Style: font menus and preset buttons.
for (const id of ['title-font', 'cap-font']) {
  $(id).replaceChildren(...Object.entries(FONTS).map(([k, [name, stack]]) => {
    const o = new Option(name, k);
    o.style.fontFamily = stack;
    return o;
  }));
}
$('presets').replaceChildren(...Object.entries(PRESETS).map(([name, p]) => {
  const b = document.createElement('button');
  b.type = 'button';
  const fg = p['fg-auto'] ? autoFg(p['bg-style'], p.bg, p.bg2) : p.fg;
  b.append(thumb({ bgStyle: p['bg-style'], bg: p.bg, bg2: p.bg2, fg, border: p.border }), caption(name));
  b.setAttribute('aria-label', `${name} style`);
  b.onclick = () => {
    for (const [id, v] of Object.entries(p)) {
      if (typeof v === 'boolean') $(id).checked = v; else $(id).value = v;
    }
    scheduleRender(); saveState();
  };
  return b;
}));
picker('size', (b, v) => {
  const shape = document.createElement('span');
  shape.className = 'shape' + (v ? '' : ' fit');
  const r = Number(v) || Math.SQRT2, h = Math.min(30, 34 * r); // fit within 34×30
  shape.style.width = h / r + 'px'; shape.style.height = h + 'px';
  b.append(shape, caption(SIZE_SHORT[v] ?? v));
});
picker('bg-style', (b, v, s) => paintThumb(b, { ...s, bgStyle: v, border: 'none' }, b.title));
picker('border', (b, v, s) => paintThumb(b, { ...s, border: v }, b.title.replace(' line', '').replace(' strip', '')));
$('style').addEventListener('toggle', scheduleRender);
$('size').addEventListener('change', autoCols); // a new page shape gets the best column count
$('cols-auto').onclick = autoCols;
$('hide-missing').onchange = update;
$('clear').onclick = () => { films = []; update(); };
$('unload').onclick = unloadZip;
const stepCols = d => {
  $('cols').value = Math.max(1, (Math.floor(Number($('cols').value)) || 5) + d);
  $('cols').dispatchEvent(new Event('input')); // same path as typing: re-render + save
};
$('cols-dec').onclick = () => stepCols(-1);
$('cols-inc').onclick = () => stepCols(1);
$('sort').onchange = () => {
  if ($('sort').value === 'shuffle') for (const f of films) f.rand = Math.random(); // re-pick to reshuffle
  update();
};
$('search').oninput = e => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => search(q), 300);
};
// ---------- Download ----------
// PNG sizes are output widths; PDF sizes are paper widths in inches (height follows the poster's ratio).
// Keyed by the Poster size value. Wallpapers have no PDF.
const WALLPAPERS = {
  '0.5625': [['1080p', 1920], ['1440p', 2560], ['4K', 3840]],
  '2.1667': [['', 1080], ['', 1170], ['', 1290]],
};
const PAPERS = {
  '': [['A4 width', 8.27], ['Letter width', 8.5], ['A3 width', 11.69], ['A2 width', 16.54]],
  '1.4142': [['A5', 5.83], ['A4', 8.27], ['A3', 11.69], ['A2', 16.54], ['A1', 23.39]],
  '0.7071': [['A5', 8.27], ['A4', 11.69], ['A3', 16.54], ['A2', 23.39], ['A1', 33.11]],
  '1.2941': [['Letter', 8.5]],
  '0.7727': [['Letter', 11]],
  '1.5': [['4×6 in', 4], ['8×12 in', 8], ['12×18 in', 12], ['24×36 in', 24]],
  '1.3333': [['6×8 in', 6], ['9×12 in', 9], ['18×24 in', 18]],
  '1.25': [['8×10 in', 8], ['16×20 in', 16]],
  '1.5455': [['11×17 in', 11]],
  '1': [['8×8 in', 8], ['12×12 in', 12], ['24×24 in', 24]],
};
// Readability thresholds for the smallest text (the caption's year / rating line).
const MIN_PX = 12, MIN_PT = 6, PRINT_DPI = 300, ART_PX = 780; // ART_PX: TMDB's largest poster size we use

// Many browsers allow canvases well past 16 MP; check once by drawing into a big one and reading back.
let maxArea;
function canvasMaxArea() {
  if (maxArea) return maxArea;
  for (const a of [64e6, 36e6]) {
    const s = Math.floor(Math.sqrt(a)), c = document.createElement('canvas');
    try {
      c.width = c.height = s;
      const x = c.getContext('2d');
      x.fillRect(s - 1, s - 1, 1, 1);
      if (x.getImageData(s - 1, s - 1, 1, 1).data[3] === 255) maxArea = a;
    } catch { /* too big */ }
    c.width = c.height = 0; // free the memory now
    if (maxArea) return maxArea;
  }
  return (maxArea = MAX_AREA);
}

function sizeOptions(fmt) {
  const L = layout(), key = $('size').value;
  const maxW = Math.floor(Math.min(Math.sqrt(canvasMaxArea() * W / L.H), MAX_SIDE, MAX_SIDE * W / L.H));
  const text = L.minText; // smallest text, in poster units
  let opts, rec;
  if (fmt === 'png') {
    const presets = WALLPAPERS[key] || [1, 2, 3, 4, 6].map(k => ['', k * W]);
    opts = presets.filter(([, w]) => w <= maxW).map(([name, w]) => ({ name, w }));
    if (!WALLPAPERS[key] && (!opts.length || opts.at(-1).w < maxW * 0.9)) opts.push({ name: 'Largest', w: maxW });
    for (const o of opts) {
      const s = o.w / W, px = text * s, tile = L.tileW * s;
      o.px = o.w;
      o.head = `${o.name ? o.name + ' · ' : ''}${o.w.toLocaleString()} × ${Math.round(L.H * s).toLocaleString()} px`;
      o.detail = '';
      o.warn = text && px < MIN_PX ? 'Captions very small' : '';
      o.ok = text ? px >= MIN_PX : tile >= 500;
    }
    rec = opts.findIndex(o => o.ok);
    if (rec < 0) rec = opts.length - 1; // nothing reaches the target: the biggest gets closest
  } else {
    opts = (PAPERS[key] || []).filter(([, win]) => win * L.H / W <= 200).map(([name, win]) => { // jsPDF's max page is 200 in
      const hin = win * L.H / W, px = Math.min(Math.round(win * PRINT_DPI), maxW);
      const pt = text * win * 72 / W, dpi = px / win, artDpi = ART_PX / (L.tileW / W * win);
      return {
        name, win, hin, px, pt, artDpi,
        head: name.endsWith(' in') ? name : `${name} · ${+win.toFixed(1)} × ${+hin.toFixed(1)} in`,
        detail: `${Math.round(dpi)} dpi`,
        warn: text && pt < MIN_PT ? 'Captions very small' : dpi < 150 ? 'Low resolution'
          : artDpi < 100 ? 'Poster art may look soft' : '',
      };
    });
    // With captions: the smallest paper where they're readable. Without: the largest where the art stays sharp.
    rec = text ? opts.findIndex(o => o.pt >= MIN_PT) : opts.findLastIndex(o => o.artDpi >= 150);
    if (rec < 0) rec = text ? opts.length - 1 : 0;
  }
  for (const o of opts) o.pixels = o.px * Math.round(o.px * L.H / W);
  return { opts, rec, text };
}

// File size estimates: encode the on-screen preview once and scale its bytes per pixel up.
// Bigger renders compress a bit better (smoother upscaled detail); the ^-0.25 matches measured exports.
let bpp = null;
async function measureBpp() {
  const px = canvas.width * canvas.height;
  const enc = type => new Promise(r => canvas.toBlob(b => r(b ? b.size / px : 0), type, 0.92));
  const [png, pdf] = await Promise.all([enc('image/png'), enc('image/jpeg')]); // PDFs embed a JPEG
  return { png, pdf, s0: canvas.width / W };
}
function estimate(o, fmt) {
  if (!bpp || !bpp[fmt]) return '';
  const mb = bpp[fmt] * o.pixels * ((o.px / W) / bpp.s0) ** -0.25 / 1048576;
  return mb < 1 ? `~${Math.max(1, Math.round(mb * 1024 / 10) * 10)} KB` : `~${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

let dlOpts = [];
function renderSizes(keepChoice) {
  const wallpaper = $('size').value in WALLPAPERS;
  const pdf = $('dl-pdf');
  pdf.disabled = wallpaper;
  if (wallpaper) $('dl-png').checked = true;
  const fmt = pdf.checked ? 'pdf' : 'png';
  const { opts, rec } = sizeOptions(fmt);
  const chosen = keepChoice ? Number(new FormData($('dl-form')).get('dl-size') ?? rec) : rec;
  dlOpts = opts;
  $('dl-sizes').replaceChildren(...opts.map((o, i) => {
    const label = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'dl-size', value: i, checked: i === chosen });
    const head = Object.assign(document.createElement('b'), { textContent: o.head });
    const badge = Object.assign(document.createElement('span'), { className: 'badge', textContent: i === rec ? 'Recommended' : '' });
    const info = [o.detail, estimate(o, fmt)].filter(Boolean).join(' · ');
    const detail = Object.assign(document.createElement('span'), { className: 'size-detail', textContent: info });
    if (o.warn) detail.append(info ? ' · ' : '', Object.assign(document.createElement('span'), { className: 'warn', textContent: o.warn }));
    label.append(input, head, badge);
    if (info || o.warn) label.append(detail);
    return label;
  }));
  $('dl-note').textContent = wallpaper ? 'Wallpapers download as PNG.' : '';
  $('dl-note').hidden = !wallpaper;
  $('dl-go').disabled = !opts.length;
}

const loaded = img => img.complete ? Promise.resolve()
  : new Promise(r => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); });

// Render the poster offscreen at pxW wide, after loading the poster art that resolution needs.
async function exportCanvas(pxW) {
  const L = layout(), s = pxW / W;
  const [want] = IMG_SIZES.find(([, w]) => w >= L.tileW * s) || IMG_SIZES.at(-1);
  await Promise.race([
    Promise.all(L.list.filter(f => f.poster).map(f => loaded(image(f.poster, want)))),
    new Promise(r => setTimeout(r, 20000)), // don't hang on a slow image; it falls back to smaller art
  ]);
  const c = document.createElement('canvas');
  c.width = Math.round(W * s);
  c.height = Math.round(L.H * s);
  draw(c.getContext('2d'), L, s);
  return c;
}

let jspdf;
const loadJsPDF = () => jspdf ||= new Promise((resolve, reject) => {
  const s = Object.assign(document.createElement('script'), { src: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js' });
  s.onload = () => resolve(window.jspdf.jsPDF);
  s.onerror = () => { jspdf = null; s.remove(); reject(new Error("couldn't load the PDF library")); };
  document.head.append(s);
});

function saveBlob(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('download').onclick = () => {
  bpp = null;
  renderSizes();
  $('dl').showModal();
  measureBpp().then(b => { bpp = b; if ($('dl').open) renderSizes(true); }, () => {});
};
$('dl-png').onchange = $('dl-pdf').onchange = () => renderSizes();
$('dl-cancel').onclick = () => $('dl').close();
$('dl-form').onsubmit = async e => {
  e.preventDefault();
  const o = dlOpts[new FormData(e.target).get('dl-size')];
  if (!o) return;
  const go = $('dl-go'), name = ($('title').value.trim() || 'poster').replace(/[^\w-]+/g, '-');
  go.disabled = true; go.textContent = 'Preparing…';
  let c;
  try {
    c = await exportCanvas(o.px);
    if ($('dl-pdf').checked) {
      const jsPDF = await loadJsPDF();
      const doc = new jsPDF({ orientation: o.win > o.hin ? 'landscape' : 'portrait', unit: 'in', format: [o.win, o.hin], compress: true });
      doc.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, o.win, o.hin);
      saveBlob(doc.output('blob'), name + '.pdf');
    } else {
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('the image was too large to encode');
      saveBlob(blob, name + '.png');
    }
    $('dl').close();
  } catch (err) {
    $('dl-note').textContent = `Export failed: ${err.message}. Try a smaller size.`;
    $('dl-note').hidden = false;
  } finally {
    if (c) c.width = c.height = 0;
    go.disabled = false; go.textContent = 'Download';
  }
};

if (LOCAL && !TMDB_API_KEY) status('Local dev: add your TMDB key in config.local.js (see README), or run the Worker on :8787.');
restore();
