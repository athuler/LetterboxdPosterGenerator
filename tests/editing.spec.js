// Sorting, reordering, removing, adding from search, hiding films without posters.
import { test, expect, customise, waitForSave, nextFrame, dropZip, tiles, names, order, tileColour, ART, LIST } from './helpers.js';

const pickList = async page => {
  await page.goto('/');
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await expect(tiles(page)).toHaveCount(5);
};
const listNames = LIST.map(([n]) => n);

test('sorts by title and year, and returns to list order', async ({ page }) => {
  await pickList(page);
  const sort = page.locator('#sort');
  await sort.selectOption('title');
  expect(await names(page)).toEqual(['Alien', 'Crouching Tiger, Hidden Dragon', 'Moon', 'Noposter Film', 'Zodiac']);
  await sort.selectOption('year-asc');
  expect(await names(page)).toEqual(['Alien', 'Crouching Tiger, Hidden Dragon', 'Noposter Film', 'Zodiac', 'Moon']);
  await sort.selectOption('year-desc');
  expect(await names(page)).toEqual(['Moon', 'Zodiac', 'Noposter Film', 'Crouching Tiger, Hidden Dragon', 'Alien']);
  await sort.selectOption('shuffle');
  expect((await names(page)).sort()).toEqual([...listNames].sort());
  await sort.selectOption('list');
  expect(await names(page)).toEqual(listNames);
});

test('rating and date sorts are only offered when the films have that data', async ({ page }) => {
  await pickList(page);
  for (const v of ['rating', 'date-desc', 'date-asc']) await expect(page.locator(`#sort option[value="${v}"]`)).toBeDisabled();

  await page.locator('#source').selectOption({ label: 'Ratings (3)' });
  const sort = page.locator('#sort');
  await sort.selectOption('rating');
  expect(await names(page)).toEqual(['Jaws', 'Heat', 'Up']);
  await sort.selectOption('date-desc');
  expect(await names(page)).toEqual(['Heat', 'Jaws', 'Up']);
  await sort.selectOption('date-asc');
  expect(await names(page)).toEqual(['Up', 'Jaws', 'Heat']);
});

test('keyboard: arrow keys move a poster into a custom order, Delete removes it', async ({ page }) => {
  await pickList(page);
  await tiles(page).first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#sort')).toHaveValue('custom');
  expect(await names(page)).toEqual(['Alien', 'Zodiac', 'Noposter Film', 'Moon', 'Crouching Tiger, Hidden Dragon']);
  await expect(tiles(page).nth(1)).toBeFocused(); // focus follows the moved poster

  // The custom order survives trying another sort.
  await page.locator('#sort').selectOption('title');
  await page.locator('#sort').selectOption('custom');
  expect(await names(page)).toEqual(['Alien', 'Zodiac', 'Noposter Film', 'Moon', 'Crouching Tiger, Hidden Dragon']);

  await tiles(page).nth(1).focus();
  await page.keyboard.press('Delete');
  expect(await names(page)).toEqual(['Alien', 'Noposter Film', 'Moon', 'Crouching Tiger, Hidden Dragon']);
  await expect(tiles(page).nth(1)).toBeFocused();
});

test('dragging a poster onto another moves it there', async ({ page }) => {
  await pickList(page);
  await page.locator('#cols').fill('5'); // one row, so both tiles are on screen
  await tiles(page).nth(0).dragTo(tiles(page).nth(3));
  await expect(page.locator('#sort')).toHaveValue('custom');
  expect(await names(page)).toEqual(['Alien', 'Noposter Film', 'Moon', 'Zodiac', 'Crouching Tiger, Hidden Dragon']);
});

test('the ✕ on a poster removes it', async ({ page }) => {
  await pickList(page);
  await tiles(page).nth(1).hover();
  await page.getByRole('button', { name: 'Remove Alien' }).click();
  expect(await names(page)).toEqual(['Zodiac', 'Noposter Film', 'Moon', 'Crouching Tiger, Hidden Dragon']);
});

test('Clear empties the poster', async ({ page }) => {
  await pickList(page);
  await page.locator('#clear').click();
  await expect(tiles(page)).toHaveCount(0);
});

test('searching TMDB and clicking a result adds that film at the end', async ({ page }) => {
  await pickList(page);
  await page.locator('#search').fill('Arrival');
  const result = page.locator('#results button', { hasText: 'Arrival (2000)' });
  await result.click();
  await expect(tiles(page)).toHaveCount(6);
  expect((await order(page)).at(-1)).toBe('Arrival (2000)');
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#results button')).toHaveCount(0);
});

test('searching with no matches says so', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('Noposter whatever');
  await expect(page.locator('#results')).toHaveText('No matches.');
});

test('posters are drawn from TMDB art; films without a match get a text tile', async ({ page }) => {
  await pickList(page);
  await expect.poll(() => tileColour(page, 0)).toEqual(ART);
  expect(await tileColour(page, 2)).not.toEqual(ART); // Noposter Film
});

test('"Hide films without posters" leaves them out, and editing still works on what is shown', async ({ page }) => {
  await pickList(page);
  await expect(page.locator('#missing-count')).toHaveText(/\(1\)/);
  await page.locator('#hide-missing').check();
  await expect(tiles(page)).toHaveCount(4);
  expect(await names(page)).toEqual(['Zodiac', 'Alien', 'Moon', 'Crouching Tiger, Hidden Dragon']);

  // Moving Alien right skips the hidden film and lands after Moon.
  await tiles(page).nth(1).focus();
  await page.keyboard.press('ArrowRight');
  expect(await names(page)).toEqual(['Zodiac', 'Moon', 'Alien', 'Crouching Tiger, Hidden Dragon']);

  await page.locator('#hide-missing').uncheck();
  await expect(tiles(page)).toHaveCount(5);
  expect(await names(page)).toContain('Noposter Film');
});

test('a long name on a small no-poster tile stays inside the tile', async ({ page }) => {
  await pickList(page);
  await waitForSave(page, s => s.films.length === 5);
  // Give the no-poster film a long name, then reload so it is drawn from the saved list.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('state'));
    const f = s.films.find(f => f.name === 'Noposter Film');
    f.name = 'Noposter Film With A Very Long Title That Goes On And On'; f.poster = null;
    localStorage.setItem('state', JSON.stringify(s));
  });
  await page.reload();
  await expect(tiles(page)).toHaveCount(5);
  await customise(page);
  for (const id of ['cap-title', 'cap-year', 'cap-rating']) await page.locator(`#${id}`).uncheck();
  await page.locator('#bg').fill('#000000');
  await page.locator('#fg').fill('#ffffff');
  await page.locator('#cols').fill('40'); // tiny tiles
  await page.locator('#np-size').fill('2'); // and the biggest text: still clipped to the tile
  await nextFrame(page);
  const i = (await names(page)).indexOf('Noposter Film With A Very Long Title That Goes On And On');
  // Count white text pixels in the strips just above and below that tile.
  const spill = await page.evaluate(i => {
    const c = document.getElementById('poster'), t = document.querySelectorAll('#tiles .tile')[i];
    const px = (v, total) => parseFloat(v) / 100 * total;
    const x = Math.floor(px(t.style.left, c.width)), w = Math.ceil(px(t.style.width, c.width));
    const top = Math.floor(px(t.style.top, c.height)), bottom = Math.ceil(top + px(t.style.height, c.height));
    const strip = (y0, y1) => {
      const d = c.getContext('2d').getImageData(x, y0, w, Math.max(1, y1 - y0)).data;
      let n = 0; for (let k = 0; k < d.length; k += 4) if (d[k] > 150) n++;
      return n;
    };
    return strip(Math.max(0, top - 20), top - 1) + strip(bottom + 1, Math.min(c.height, bottom + 20));
  }, i);
  expect(spill).toBe(0);
});
