// Loading an export, picking lists, remembering recent uploads, restoring after a reload.
import { test, expect, pick, customise, dropZip, dropFile, tiles, names, waitForSave, LIST, EXPORT } from './helpers.js';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('starts empty with the drop zone and no recent uploads', async ({ page }) => {
  await expect(page.locator('#drop')).toBeVisible();
  await expect(page.locator('#recent')).toBeHidden();
  await expect(page.locator('#loaded')).toBeHidden();
  await expect(page.locator('#lists-label')).toHaveText('Lists');
  await expect(tiles(page)).toHaveCount(0);
  await expect(page.locator('#poster')).toHaveJSProperty('width', 1500);
});

test('dropping an export lists its sources and loads the first', async ({ page }) => {
  await dropZip(page);
  await expect(page.locator('#loaded-name')).toHaveText('letterboxd-test-export.zip');
  await expect(page.locator('#picker')).toBeHidden();
  await expect(page.locator('#lists-label')).toHaveText('Lists (4)');
  // Watched/watchlist/ratings first, then lists; deleted lists and other CSVs are ignored.
  await expect(page.locator('#source option')).toHaveText([
    'Pick a list, or add films yourself', 'Ratings (3)', 'Watched (4)', 'Watchlist (2)', 'Favourites, ranked (5)',
  ]);
  await expect(page.locator('#source')).toHaveValue('0');
  await expect(page.locator('#title')).toHaveValue('Ratings');
  expect(await names(page)).toEqual(['Heat', 'Up', 'Jaws']);
});

test('picking a list shows its films in list order with its name as the title', async ({ page }) => {
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await expect(page.locator('#title')).toHaveValue('Favourites, ranked');
  await expect(tiles(page)).toHaveCount(5);
  expect(await names(page)).toEqual(LIST.map(([n]) => n));
  await page.locator('#source').selectOption('');
  await expect(tiles(page)).toHaveCount(0);
  await expect(page.locator('#title')).toHaveValue('');
});

test('a file that is not a Letterboxd export shows an error and is not remembered', async ({ page }) => {
  await dropFile(page, 'notes.zip', 'not a zip at all');
  await expect(page.locator('#status')).toContainText("Couldn't read notes.zip");
  await expect(page.locator('#drop')).toBeVisible();
  await dropZip(page, 'empty.zip', { 'readme.txt': 'hello' });
  await expect(page.locator('#status')).toHaveText('No Letterboxd lists found in that zip.');
  await expect(page.locator('#recent')).toBeHidden();
});

test('settings, the chosen list and edits come back after a reload', async ({ page }) => {
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await page.locator('#title').fill('My poster');
  await pick(page, 'size', '1');
  await page.locator('#cols').fill('3');
  await customise(page);
  await page.locator('#bg').fill('#ffffff');
  await page.locator('#cap-rating').uncheck();
  await page.locator('#sort').selectOption('title');
  await expect(page.locator('#missing-count')).toHaveText(/\(1\)/); // lookups done: the tiles won't be rebuilt mid-click
  await tiles(page).first().locator('button').click({ force: true }); // remove "Alien" (first by title)
  await waitForSave(page, s => s.title === 'My poster' && s.films.length === 4 && s.sort === 'title' && s.cols === '3');

  await page.reload();
  await expect(page.locator('#loaded-name')).toHaveText('letterboxd-test-export.zip');
  await expect(page.locator('#source')).toHaveValue('3'); // Ratings, Watched, Watchlist, then the list
  await expect(page.locator('#title')).toHaveValue('My poster');
  await expect(page.locator('#size')).toHaveValue('1');
  await expect(page.locator('#cols')).toHaveValue('3');
  await expect(page.locator('#bg')).toHaveValue('#ffffff');
  await expect(page.locator('#cap-rating')).not.toBeChecked();
  await expect(page.locator('#cap-title')).toBeChecked();
  await expect(page.locator('#sort')).toHaveValue('title');
  expect(await names(page)).toEqual(['Crouching Tiger, Hidden Dragon', 'Moon', 'Noposter Film', 'Zodiac']);
});

test('recent uploads keep the last 3, reopen with a click and can be forgotten', async ({ page }) => {
  for (const n of ['a', 'b', 'c', 'd']) {
    await dropZip(page, `${n}.zip`);
    await expect(page.locator('#loaded-name')).toHaveText(`${n}.zip`);
    await page.locator('#unload').click();
    await expect(page.locator('#recent-list li')).toHaveCount(Math.min(3, 'abcd'.indexOf(n) + 1));
  }
  const items = page.locator('#recent-list .recent-open');
  await expect(items.nth(0)).toContainText('d.zip');
  await expect(items.nth(1)).toContainText('c.zip');
  await expect(items.nth(2)).toContainText('b.zip');

  await page.getByRole('button', { name: 'Forget c.zip' }).click();
  await expect(page.locator('#recent-list li')).toHaveCount(2);

  await items.filter({ hasText: 'b.zip' }).click();
  await expect(page.locator('#loaded-name')).toHaveText('b.zip');
  await expect(page.locator('#lists-label')).toHaveText('Lists (4)');

  // Still there after a reload.
  await waitForSave(page, s => (s.zipId || '').startsWith('b.zip|'));
  await page.reload();
  await expect(page.locator('#loaded-name')).toHaveText('b.zip');
  await page.locator('#unload').click();
  await expect(page.locator('#recent-list li')).toHaveCount(2);
});

test('unloading keeps the films and brings back the drop zone', async ({ page }) => {
  await dropZip(page);
  await expect(tiles(page)).toHaveCount(3);
  await page.locator('#unload').click();
  await expect(page.locator('#drop')).toBeVisible();
  await expect(page.locator('#loaded')).toBeHidden();
  await expect(page.locator('#lists-label')).toHaveText('Lists');
  await expect(tiles(page)).toHaveCount(3);
});

test('the file picker works as well as dropping', async ({ page }) => {
  const zip = await page.evaluate(async files => {
    const z = new JSZip();
    for (const [p, t] of Object.entries(files)) z.file(p, t);
    return Array.from(await z.generateAsync({ type: 'uint8array' }));
  }, EXPORT);
  await page.locator('#file').setInputFiles({ name: 'picked.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await expect(page.locator('#loaded-name')).toHaveText('picked.zip');
  await expect(tiles(page)).toHaveCount(3);
});

test('a slow re-read of a big export after a reload does not lose the chosen list', async ({ page }) => {
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await waitForSave(page, s => s.source === '3');
  // Make reading the zip take longer than the 300 ms save delay, like a large export does.
  await page.addInitScript(() => {
    let jszip;
    Object.defineProperty(window, 'JSZip', { configurable: true, get: () => jszip, set: v => {
      const load = v.loadAsync.bind(v);
      v.loadAsync = (...a) => new Promise(r => setTimeout(r, 1000)).then(() => load(...a));
      jszip = v;
    } });
  });
  await page.reload();
  await expect(page.locator('#source')).toHaveValue('3');
  await page.waitForTimeout(400); // let any pending save land
  await page.reload();
  await expect(page.locator('#source')).toHaveValue('3');
});

test('after a reload, "Restoring your last session…" shows instead of the drop zone until it is back', async ({ page }) => {
  await expect(page.locator('#restoring')).toBeHidden(); // nothing saved yet
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await waitForSave(page, s => s.source === '3');
  // Re-reading the export takes a second, like a big one does.
  await page.addInitScript(() => {
    let jszip;
    Object.defineProperty(window, 'JSZip', { configurable: true, get: () => jszip, set: v => {
      const load = v.loadAsync.bind(v);
      v.loadAsync = (...a) => new Promise(r => setTimeout(r, 1000)).then(() => load(...a));
      jszip = v;
    } });
  });
  await page.reload();
  await expect(page.locator('#restoring')).toBeVisible();
  await expect(page.locator('#drop')).toBeHidden();
  await expect(page.locator('#source option')).toHaveText(['Loading lists…']);
  await expect(page.locator('#loaded-name')).toHaveText('letterboxd-test-export.zip');
  await expect(page.locator('#restoring')).toBeHidden();
  await expect(page.locator('#source')).toHaveValue('3');
});
