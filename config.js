// Public URL of the TMDB search proxy (the Cloudflare Worker in worker/). No secrets here.
export const TMDB_PROXY_URL = location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : 'https://letterboxd-poster-tmdb.andreithuler.workers.dev';
