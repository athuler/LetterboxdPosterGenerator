// Public URL of the TMDB search proxy (the Cloudflare Worker in worker/). No secrets here.
// After the first Worker deploy, replace YOUR-SUBDOMAIN with your workers.dev subdomain.
export const TMDB_PROXY_URL = location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : 'https://letterboxd-poster-tmdb.YOUR-SUBDOMAIN.workers.dev';
