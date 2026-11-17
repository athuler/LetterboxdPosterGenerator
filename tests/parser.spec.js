// parse.js: the CSV formats inside a Letterboxd export, run in the browser with the same PapaParse as the app.
import { test, expect } from './helpers.js';

const parse = (page, text, fallback = '') => page.evaluate(async ([text, fallback]) => {
  const { parseExport } = await import('/parse.js');
  return parseExport(text, Papa, fallback);
}, [text, fallback]);

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.Papa);
});

test('list exports: title from the metadata block, quoted names, no ratings or dates', async ({ page }) => {
  const list = `Letterboxd list export v7
Date,Name,Tags,URL,Description
2024-01-02,"Best of, the decade",,https://boxd.it/abc,"Some, description"

Position,Name,Year,URL,Description
1,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/1,
2,"The ""Quoted"" Film",1999,https://boxd.it/2,"note"
`;
  expect(await parse(page, list, 'fallback')).toEqual({
    title: 'Best of, the decade',
    films: [
      { name: 'Crouching Tiger, Hidden Dragon', year: '2000', uri: 'https://boxd.it/1', rating: 0, date: '' },
      { name: 'The "Quoted" Film', year: '1999', uri: 'https://boxd.it/2', rating: 0, date: '' },
    ],
  });
});

test('ratings: fallback title, numeric half-star ratings and dates', async ({ page }) => {
  const ratings = 'Date,Name,Year,Letterboxd URI,Rating\n2024-03-01,Heat,1995,https://boxd.it/h,4.5\n';
  expect(await parse(page, ratings, 'Ratings')).toEqual({
    title: 'Ratings',
    films: [{ name: 'Heat', year: '1995', uri: 'https://boxd.it/h', rating: 4.5, date: '2024-03-01' }],
  });
});

test('missing years and blank rows are tolerated; files without films give none', async ({ page }) => {
  const watched = 'Date,Name,Year,Letterboxd URI\n2024-01-01,Untitled,,https://boxd.it/u\n,,,\n';
  expect((await parse(page, watched, 'Watched')).films).toEqual([
    { name: 'Untitled', year: '', uri: 'https://boxd.it/u', rating: 0, date: '2024-01-01' },
  ]);
  expect((await parse(page, 'garbage', 'x')).films).toEqual([]);
  expect((await parse(page, 'Date Joined,Username\n2020-01-01,me\n', 'x')).films).toEqual([]);
});

test('the standalone self-check page still passes', async ({ page }) => {
  await page.goto('/tests.html');
  await expect(page.locator('#out')).toHaveText('PASS');
});
