# LetterboxdPosterGenerator

Turn your Letterboxd lists into a poster: a grid of film posters with an optional title and captions, previewed live and downloadable as a PNG.

## Use it

1. Export your data at <https://letterboxd.com/data/export/>.
2. Drop the `.zip` on the page. It is read entirely in your browser, nothing is uploaded.
3. Pick a source (any of your lists, Watchlist, Watched or Ratings), or start empty.
4. Add films by searching TMDB (only TMDB results can be added), drag posters on the preview to reorder them, use ✕ (or Tab + arrow keys / Delete) to move and remove them, tweak the title, columns and captions. Under **Style**, click a preset thumbnail (Letterboxd, Paper, Cinema, Midnight, Garden, Mono), and open **Customise** to adjust anything after: background (solid, gradient, spotlight, dots, stripes, grid, with a second colour), text colour (automatic for contrast, or your own), title on/off, font and size, caption font and size (each with **Wrap**, so long titles go onto more lines instead of being cut off), a text size for films without a poster, and a border (line, double line, corners, film strip, flowers). Fonts are ones already on your device, so they can look a little different from one computer to another. **Auto** sets the column count that makes the posters biggest on a fixed page size, or gives a roughly A-series shape on "Fit to films"; it also runs whenever you change the poster size or pick another list. Captions can show the film's title, year and rating, each on or off. **Hide films without posters** leaves out films TMDB has no poster for (the count is shown next to it).
5. Pick a **poster size** from the shapes under Layout: "Fit" grows the image to fit, or choose a print ratio (A4, A3, A2, …, Letter, 2:3, 3:4, 4:5, 11×17, square) or a wallpaper size. Fixed sizes centre the grid on the page.
6. Sort by list order, title, year, rating or date logged (the last two only when the source has them), or shuffle. Dragging a poster switches to **Custom**, which keeps your hand-made order while you try other sorts.
7. Click **Download…**, choose **PNG** or **PDF (print)** and a size. PNG sizes are pixel dimensions (screen resolutions for wallpapers); PDF sizes are paper sizes matching the poster's shape, rendered at up to 300 dpi. Sizes where the captions would be too small to read easily (under 12 px, or 6 pt in print) are flagged, and the smallest size without that problem is marked **Recommended**. Each size also shows an estimated file size. Without captions, the recommendation is based on how sharp the poster art is. Exports use larger poster art when the size needs it, up to the biggest canvas your browser supports.

Your work is saved in this browser: settings, the chosen list and your film edits come back on reload. The last 3 exports you opened are listed under **Recent uploads**, so you can reopen one with a click; ✕ removes one. Despite the name, your exports and edits are never uploaded: all of this stays in your browser (localStorage and IndexedDB). The public site uses Google Analytics for visit statistics.

There's no film limit. Very long lists are exported at a lower resolution, so the image stays within browser canvas limits.

## How the TMDB key stays secret

The site never sees the TMDB key. It calls a small Cloudflare Worker ([worker/worker.js](worker/worker.js)) that holds the key as a secret, forwards `/search?query=…&year=…` to TMDB, and only answers requests from the allowed origins. [config.js](config.js) holds just the Worker's public URL. Poster images load straight from `image.tmdb.org`, which needs no key.

## Local development

No build step, no Node needed.

1. Get a free TMDB API key at <https://www.themoviedb.org/settings/api>.
2. Create `config.local.js` in the repo root (gitignored, never deployed):

   ```js
   export const TMDB_API_KEY = "your-tmdb-v3-key-or-v4-token";
   ```

3. Serve the folder and open <http://localhost:8765>:

   ```bash
   python3 -m http.server 8765
   ```

On `localhost`, a key in `config.local.js` makes the app call TMDB directly, skipping the Worker. Parser self-check: <http://localhost:8765/tests.html> should show `PASS`.

### Tests

Browser tests ([tests/](tests/), [Playwright](https://playwright.dev)) cover importing an export, recent uploads and restoring after a reload, sorting, reordering and removing, search, hiding films without posters, poster sizes, columns, captions, style options and presets, the download dialog (including real PNG and PDF files) and the CSV parser. They fake TMDB and the poster images, so they need no API key or network for TMDB.

Needs Node 18+ and Python 3 (for the static server the tests start on port 4173):

```bash
npm ci
npx playwright install chromium
npm test
```

GitHub Actions runs them on every pull request and branch push. On `main` they run before deploying, and a failure stops the deploy.

### Testing the Worker locally (optional)

Only needed when changing `worker/`. Remove `config.local.js` (or leave its key empty), then run the Worker and the site in two terminals:

1. Worker: create `worker/.dev.vars` (gitignored):

   ```
   TMDB_API_KEY=your-tmdb-v3-key
   ALLOWED_ORIGINS=http://localhost:8765
   ```

   then from `worker/`:

   ```bash
   npx wrangler dev --port 8787
   ```

2. Site, from the repo root:

   ```bash
   python3 -m http.server 8765
   ```

Without a local key, `config.js` points `localhost` at the local Worker on port 8787.

## Deploy

**Worker (once, then on every change under `worker/`):**

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers** template and note your account ID.
2. Add repository secrets (**Settings → Secrets and variables → Actions**): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TMDB_API_KEY`.
3. Run the **Deploy TMDB proxy Worker** workflow. It uploads `TMDB_API_KEY` as a Worker secret.
4. Put the Worker's `https://letterboxd-poster-tmdb.<subdomain>.workers.dev` URL into `config.js`.
5. Set `ALLOWED_ORIGINS` in [worker/wrangler.toml](worker/wrangler.toml) to the site's origin (currently `postergenerator.andreithuler.com`).

**Site:** set **Settings → Pages → Source: GitHub Actions**, then push to `main`.

**Analytics (optional):** add a repository variable (**Settings → Secrets and variables → Actions → Variables**) named `GA_MEASUREMENT_ID` with your Google Analytics ID (`G-…`). The deploy workflow then adds the Google tag to the published `index.html`; the repo copy and local runs stay untracked. Without the variable, nothing is added.

## Caching

- Per browser: poster lookups are cached in `localStorage` (including "no match") and deduplicated in memory, so each film is searched once; poster images are cached by the browser's HTTP cache.
- Shared: the Worker caches TMDB answers at Cloudflare's edge for a week. This only takes effect on a custom domain, not on `*.workers.dev`.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Not affiliated with Letterboxd.
