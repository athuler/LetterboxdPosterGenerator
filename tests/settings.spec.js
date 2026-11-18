// Poster size, columns (−/+, Auto), captions, background and title.
import { test, expect, dropZip, tiles, canvasSize, nextFrame } from './helpers.js';

const pickList = async page => {
  await page.goto('/');
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await expect(tiles(page)).toHaveCount(5);
};
const pixel = (page, x, y) => page.evaluate(([x, y]) =>
  [...document.getElementById('poster').getContext('2d').getImageData(x, y, 1, 1).data].slice(0, 3), [x, y]);

test('each fixed poster size gives the preview that shape', async ({ page }) => {
  await pickList(page);
  const ratios = { '1.4142': 1.4142, '0.7071': 0.7071, '1.2941': 1.2941, '1.5': 1.5, '1': 1, '0.5625': 0.5625, '2.1667': 2.1667 };
  for (const [value, ratio] of Object.entries(ratios)) {
    await page.locator('#size').selectOption(value);
    const [w, h] = await canvasSize(page);
    expect(h / w, `size ${value}`).toBeCloseTo(ratio, 2);
  }
});

test('"Fit to films" grows the poster with more rows', async ({ page }) => {
  await pickList(page);
  await page.locator('#size').selectOption('');
  await page.locator('#cols').fill('5');
  const [, oneRow] = await canvasSize(page);
  await page.locator('#cols').fill('1');
  const [, fiveRows] = await canvasSize(page);
  expect(fiveRows).toBeGreaterThan(oneRow * 3);
});

test('−/+ change the columns and never go below 1', async ({ page }) => {
  await page.goto('/');
  const cols = page.locator('#cols');
  await cols.fill('2');
  await page.locator('#cols-dec').click();
  await expect(cols).toHaveValue('1');
  await page.locator('#cols-dec').click();
  await expect(cols).toHaveValue('1');
  await page.locator('#cols-inc').click();
  await expect(cols).toHaveValue('2');
});

test('columns lay the posters out in that many columns', async ({ page }) => {
  await pickList(page);
  await page.locator('#cols').fill('2');
  await nextFrame(page);
  const tops = await tiles(page).evaluateAll(els => els.map(e => e.style.top));
  expect(tops[0]).toBe(tops[1]);
  expect(tops[2]).not.toBe(tops[1]);
  expect(tops[2]).toBe(tops[3]);
});

test('Auto picks the column count, and changing the poster size runs it', async ({ page }) => {
  await pickList(page);
  const cols = page.locator('#cols');
  // Fixed page: Auto gives the biggest posters, so any other count gives smaller (or equal) tiles.
  await page.locator('#size').selectOption('1.4142');
  const auto = Number(await cols.inputValue());
  const width = async () => { await nextFrame(page); return tiles(page).first().evaluate(e => parseFloat(e.style.width)); };
  const best = await width();
  for (const c of [1, 2, 3, 4, 5].filter(c => c !== auto)) {
    await cols.fill(String(c));
    expect(await width(), `${c} columns`).toBeLessThanOrEqual(best + 1e-6);
  }
  // The button sets it back.
  await page.locator('#cols-auto').click();
  await expect(cols).toHaveValue(String(auto));
  // A wide page wants more columns than a tall one.
  await page.locator('#size').selectOption('0.5625');
  expect(Number(await cols.inputValue())).toBeGreaterThan(auto);
  // Typing a number afterwards sticks.
  await cols.fill('4');
  await nextFrame(page);
  await expect(cols).toHaveValue('4');
});

test('switching lists runs Auto columns', async ({ page }) => {
  await pickList(page);
  const cols = page.locator('#cols');
  await cols.fill('9'); // more than any list here has films
  await page.locator('#source').selectOption({ label: 'Watched (4)' });
  await expect(tiles(page)).toHaveCount(4);
  const picked = await cols.inputValue();
  expect(Number(picked)).toBeLessThanOrEqual(4);
  await page.locator('#cols-auto').click();
  await expect(cols).toHaveValue(picked);
});

test('caption parts can be turned off separately, and the rows close up', async ({ page }) => {
  await pickList(page);
  await page.locator('#size').selectOption('');
  await page.locator('#cols').fill('5');
  const [, both] = await canvasSize(page);
  await page.locator('#cap-title').uncheck();
  const [, yearOnly] = await canvasSize(page);
  await page.locator('#cap-year').uncheck();
  await page.locator('#cap-rating').uncheck();
  const [, none] = await canvasSize(page);
  expect(yearOnly).toBeLessThan(both);
  expect(none).toBeLessThan(yearOnly);
  await page.locator('#cap-year').check(); // year alone brings the second line back
  const [, again] = await canvasSize(page);
  expect(again).toBe(yearOnly);
});

test('the background colour fills the poster', async ({ page }) => {
  await page.goto('/');
  await page.locator('#bg').fill('#ffffff');
  await nextFrame(page);
  expect(await pixel(page, 2, 2)).toEqual([255, 255, 255]);
  await page.locator('#bg').fill('#123456');
  await nextFrame(page);
  expect(await pixel(page, 2, 2)).toEqual([0x12, 0x34, 0x56]);
});

test('a title adds a header band', async ({ page }) => {
  await pickList(page);
  await page.locator('#size').selectOption('');
  await page.locator('#title').fill('');
  const [, without] = await canvasSize(page);
  await page.locator('#title').fill('Hello');
  const [, withTitle] = await canvasSize(page);
  expect(Math.abs(withTitle - without - 150)).toBeLessThanOrEqual(1); // 150 units, give or take rounding
});
