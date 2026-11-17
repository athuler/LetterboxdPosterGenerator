# LetterboxdPosterGenerator

Turn your Letterboxd lists into a poster: a grid of film posters with an optional title and captions, previewed live and downloadable as a PNG.

## Use it

1. Export your data at <https://letterboxd.com/data/export/>.
2. Drop the `.zip` on the page. It is read entirely in your browser, nothing is uploaded.
3. Pick a source (any of your lists, Watchlist, Watched or Ratings), or start empty.
4. Add films by searching TMDB (only TMDB results can be added), drag or use ↑ ↓ ✕ to reorder and remove, tweak the title, columns, captions and background.
5. Click **Download PNG**.

Posters are capped at 100 films.

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

## Caching

- Per browser: poster lookups are cached in `localStorage` (including "no match") and deduplicated in memory, so each film is searched once; poster images are cached by the browser's HTTP cache.
- Shared: the Worker caches TMDB answers at Cloudflare's edge for a week. This only takes effect on a custom domain, not on `*.workers.dev`.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Not affiliated with Letterboxd.
