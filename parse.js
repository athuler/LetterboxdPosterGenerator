// Turn one Letterboxd export CSV into { title, films }. Papa is passed in so tests can use the same code.
// Handles plain exports (watched/watchlist/ratings: Date,Name,Year,Letterboxd URI[,Rating]) and list
// exports, which start with a "Letterboxd list export" metadata block before Position,Name,Year,URL.
export function parseExport(text, Papa, fallbackTitle = '') {
  const rows = Papa.parse(text.trim(), { skipEmptyLines: false }).data;
  let title = fallbackTitle;
  if (/^Letterboxd list export/.test(rows[0]?.[0] ?? '')) title = rows[2]?.[1] || title;

  const h = rows.findIndex(r => r.includes('Name') && r.includes('Year'));
  if (h < 0) return { title, films: [] };
  const col = name => rows[h].indexOf(name);
  const n = col('Name'), y = col('Year'), r = col('Rating');
  const u = Math.max(col('Letterboxd URI'), col('URL'));

  const films = rows.slice(h + 1).filter(row => row[n]).map(row => ({
    name: row[n],
    year: row[y] || '',
    uri: u >= 0 ? row[u] || '' : '',
    rating: r >= 0 ? Number(row[r]) || 0 : 0,
  }));
  return { title, films };
}
