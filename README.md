# Letterboxd Film Poster Generator

[![Letterboxd Poster Generator: turn your Letterboxd lists into a poster to print or share. A wall of film posters behind the title and the site address, postergenerator.andreithuler.com](docs/banner.jpg)](https://postergenerator.andreithuler.com)

<p align="center">
  <a href="https://ko-fi.com/andreithuler"><img src="https://img.shields.io/badge/Support_on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white&style=for-the-badge" alt="Support on Ko-fi"></a>
  <a href="https://github.com/sponsors/athuler"><img src="https://img.shields.io/badge/Sponsor_on-GitHub-EA4AAA?logo=githubsponsors&logoColor=white&style=for-the-badge" alt="Sponsor on GitHub"></a>
</p>

[Turn your Letterboxd lists into a poster](https://postergenerator.andreithuler.com): a grid of film posters with a title and captions, ready to print, set as a wallpaper or share.

[![The Letterboxd Poster Generator in a browser: controls for the list, title, poster size, columns and style presets on the left, and a preview on the right of the Letterboxd Top 250 as an A-size poster of 250 film posters in 18 columns, each captioned with its title and year](docs/app.jpg)](https://postergenerator.andreithuler.com)

## Features

- **Any list:** your Letterboxd lists, Watchlist, Watched or Ratings, straight from Letterboxd's data export. You can also start empty and add films by searching TMDB.
- **Edit on the poster:** drag to reorder, ✕ to remove (or Tab, the arrow keys and Delete). Sort by list order, title, year, rating or date logged, or shuffle.
- **Sizes for print and screens:** fit to the films, A and Letter paper, 2:3, 3:4, 4:5, 11×17, square, desktop and phone wallpapers. **Auto** picks the column count that makes the posters biggest.
- **Styles:** six presets, plus backgrounds, colours, fonts, borders, caption parts (title, year, rating), text wrapping and a footer line.
- **Zoom:** look closely at any part of the poster to check small captions, with a map showing where you are.
- **Download:** PNG at several sizes, or a print-ready PDF up to A0 at 300 dpi. Each size shows its file size and flags captions too small to read; the best one is recommended.
- **Share:** send the poster to your phone's share menu, or copy it and post it to X, Bluesky, Threads, Facebook or Reddit.
- **Remembered:** your settings, list and edits come back when you return, and your last 3 exports can be reopened in one click.

The same list in four of the style presets (Letterboxd, Cinema, Paper, Midnight):

<p>
  <a href="https://postergenerator.andreithuler.com"><img src="docs/style-letterboxd.jpg" width="49%" alt="The Letterboxd Top 250 in the Letterboxd style: dark grey background, white sans-serif title and captions"></a>
  <a href="https://postergenerator.andreithuler.com"><img src="docs/style-cinema.jpg" width="49%" alt="The Letterboxd Top 250 in the Cinema style: dark red gradient background, film-strip border, cream condensed title"></a>
</p>
<p>
  <a href="https://postergenerator.andreithuler.com"><img src="docs/style-paper.jpg" width="49%" alt="The Letterboxd Top 250 in the Paper style: cream background, double-line border, dark serif title"></a>
  <a href="https://postergenerator.andreithuler.com"><img src="docs/style-midnight.jpg" width="49%" alt="The Letterboxd Top 250 in the Midnight style: navy spotlight background, corner border, pale blue title"></a>
</p>

Zoomed in to 4×, with the map of the whole poster in the corner:

[![The preview zoomed in to 4x, showing six film posters per row large enough to read their captions, with a small map of the whole poster in the top-right corner marking the part in view](docs/zoom.jpg)](https://postergenerator.andreithuler.com)

## How to use it

1. Export your data at <https://letterboxd.com/data/export/>. Letterboxd emails you a `.zip`.
2. Open the site and drop the `.zip` on it (or click to choose it).
3. Pick a list. Its films appear as a poster, with its name as the title.
4. Choose a poster size under **Layout**, and a look under **Style presets**. Open **Customise** to fine-tune it.
5. Click **Download…** to save it, or **Share…** to post it.

<p>
  <a href="https://postergenerator.andreithuler.com"><img src="docs/download.png" width="49%" alt="The Download dialog: PNG or PDF (print), five sizes from 1,500 × 2,121 px to 6,727 × 9,513 px with their file sizes, the 3,000 × 4,243 px size marked Recommended and the smallest flagged Captions very small, and Cancel, Share and Download buttons"></a>
  <a href="https://postergenerator.andreithuler.com"><img src="docs/share.png" width="49%" alt="The Share your poster dialog: Poster image copied, an instruction to paste the image into the new post, and buttons for X, Bluesky, Threads, Facebook and Reddit"></a>
</p>

Films TMDB has no poster for are drawn as their name; **Hide no-poster** leaves them out. Fonts come from your device, so they can look a little different from one computer to another.

## Privacy

Your export is read in your browser and never uploaded. Settings, edits and recent exports are stored in this browser only (localStorage and IndexedDB). Film searches go to TMDB through a small proxy (see below), and poster images load from TMDB. The public site uses Google Analytics for visit counts.

## Support and feedback

Found a bug or have an idea? [Open an issue](https://github.com/athuler/LetterboxdPosterGenerator/issues).

If you enjoy it, you can support it on [Ko-fi](https://ko-fi.com/andreithuler) or [GitHub Sponsors](https://github.com/sponsors/athuler):

<p align="center">
  <a href="https://ko-fi.com/andreithuler"><img src="https://img.shields.io/badge/Support_on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white&style=for-the-badge" alt="Support on Ko-fi"></a>
  <a href="https://github.com/sponsors/athuler"><img src="https://img.shields.io/badge/Sponsor_on-GitHub-EA4AAA?logo=githubsponsors&logoColor=white&style=for-the-badge" alt="Sponsor on GitHub"></a>
</p>

---

## Development

Plain HTML, CSS and JavaScript modules: no build step. The app is [index.html](index.html), [app.js](app.js) (everything interactive) and [parse.js](parse.js) (reads Letterboxd's CSV files).

### Run it locally

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

Browser tests in [tests/](tests/) use [Playwright](https://playwright.dev). They cover importing an export, restoring after a reload, editing, search, poster sizes and styles, zoom, downloads (real PNG and PDF files), sharing and the CSV parser. TMDB and the poster images are faked, so no API key or network is needed.

Needs Node 18+ and Python 3 (for the static server the tests start on port 4173):

```bash
npm ci
npx playwright install chromium
npm test
```

GitHub Actions runs them on every pull request and branch push. On `main` they run before deploying, and a failure stops the deploy.

### How the TMDB key stays secret

The site never sees the TMDB key. It calls a small Cloudflare Worker ([worker/worker.js](worker/worker.js)) that holds the key as a secret, forwards `/search?query=…&year=…` to TMDB, and only answers requests from the allowed origins. [config.js](config.js) holds just the Worker's public URL. Poster images load straight from `image.tmdb.org`, which needs no key.

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

### Deploy

**Worker (once, then on every change under `worker/`):**

1. In Cloudflare, create an API token from the **Edit Cloudflare Workers** template and note your account ID.
2. Add repository secrets (**Settings → Secrets and variables → Actions**): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `TMDB_API_KEY`.
3. Run the **Deploy TMDB proxy Worker** workflow. It uploads `TMDB_API_KEY` as a Worker secret.
4. Put the Worker's `https://letterboxd-poster-tmdb.<subdomain>.workers.dev` URL into `config.js`.
5. Set `ALLOWED_ORIGINS` in [worker/wrangler.toml](worker/wrangler.toml) to the site's origin (currently `postergenerator.andreithuler.com`).

**Site:** set **Settings → Pages → Source: GitHub Actions**, then push to `main`.

**Analytics (optional):** add a repository variable (**Settings → Secrets and variables → Actions → Variables**) named `GA_MEASUREMENT_ID` with your Google Analytics ID (`G-…`). The deploy workflow then adds the Google tag to the published `index.html`; the repo copy and local runs stay untracked. Without the variable, nothing is added.

### Caching

- Per browser: poster lookups are cached in `localStorage` (including "no match") and deduplicated in memory, so each film is searched once; poster images are cached by the browser's HTTP cache.
- Shared: the Worker caches TMDB answers at Cloudflare's edge for a week. This only takes effect on a custom domain, not on `*.workers.dev`.

## Credits

Made by [Andrei Thüler](https://andreithuler.com). Posters and film data from the [TMDB](https://www.themoviedb.org/) API. Not affiliated with, endorsed by, or certified by TMDB or Letterboxd. Social icons from [Simple Icons](https://simpleicons.org) (CC0). Screenshots show the top 250 of [Letterboxd's Top 500 Films](https://letterboxd.com/official/list/letterboxds-top-500-films/).
