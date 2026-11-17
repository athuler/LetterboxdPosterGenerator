// Cloudflare Worker: proxies TMDB movie search so the API key never reaches the browser.
// GET /search?query=<title>[&year=<yyyy>] -> { results: [{ id, title, release_date, poster_path }] }
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    // shortcut: the Origin check stops other websites from using this proxy, but scripts can fake it.
    // Add Cloudflare rate limiting if the quota ever gets abused.
    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };

    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/search') {
      return new Response('Not found', { status: 404, headers: cors });
    }
    const query = (url.searchParams.get('query') || '').trim().slice(0, 200);
    const year = url.searchParams.get('year') || '';
    if (!query) return json({ results: [] }, cors);

    const tmdb = new URL('https://api.themoviedb.org/3/search/movie');
    tmdb.searchParams.set('query', query);
    tmdb.searchParams.set('include_adult', 'false');
    if (/^\d{4}$/.test(year)) tmdb.searchParams.set('year', year);

    // Shared edge cache for all visitors, keyed without the API key.
    // (No-op on *.workers.dev; it starts working once the Worker is on a custom domain.)
    const cacheKey = new Request('https://tmdb-cache.internal/search?' + tmdb.searchParams);
    let cached = await caches.default.match(cacheKey);
    if (!cached) {
      tmdb.searchParams.set('api_key', env.TMDB_API_KEY);
      const res = await fetch(tmdb);
      if (!res.ok) return json({ error: `TMDB ${res.status}` }, cors, 502);
      const { results = [] } = await res.json();
      const slim = results.slice(0, 10).map(({ id, title, release_date, poster_path }) =>
        ({ id, title, release_date, poster_path }));
      cached = new Response(JSON.stringify({ results: slim }), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' },
      });
      ctx.waitUntil(caches.default.put(cacheKey, cached.clone()));
    }
    const out = new Response(cached.body, cached);
    for (const [k, v] of Object.entries(cors)) out.headers.set(k, v);
    return out;
  },
};

function json(body, headers, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}
