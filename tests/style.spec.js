// Style: presets, backgrounds, text colour, title and caption fonts/sizes, borders, and that they're saved.
import { test, expect, pick, customise, dropZip, tiles, canvasSize, nextFrame, waitForSave } from './helpers.js';

const pickList = async page => {
  await page.goto('/');
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await expect(tiles(page)).toHaveCount(5);
  await customise(page);
  await pick(page, 'size', ''); // Fit to films: the preview is drawn at 1 px per poster unit
};
const pixel = async (page, x, y) => {
  await nextFrame(page);
  return page.evaluate(([x, y]) => {
    const c = document.getElementById('poster');
    const [px, py] = [x < 0 ? c.width + x : x, y < 0 ? c.height + y : y];
    return [...c.getContext('2d').getImageData(px, py, 1, 1).data].slice(0, 3);
  }, [x, y]);
};
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const snapshot = async page => { await nextFrame(page); return page.evaluate(() => document.getElementById('poster').toDataURL()); };

test('presets set every style control in one click', async ({ page }) => {
  await pickList(page);
  await expect(page.locator('#presets button')).toHaveCount(6);
  await page.getByRole('button', { name: 'Paper style' }).click();
  await expect(page.locator('#bg')).toHaveValue('#f4efe6');
  await expect(page.locator('#fg-auto')).not.toBeChecked();
  await expect(page.locator('#fg')).toHaveValue('#2b2620');
  await expect(page.locator('#title-font')).toHaveValue('serif');
  await expect(page.locator('#border')).toHaveValue('double');
  expect(near(await pixel(page, 5, 5), hexRgb('#f4efe6'))).toBe(true);

  await page.getByRole('button', { name: 'Cinema style' }).click();
  await expect(page.locator('#bg-style')).toHaveValue('gradient');
  await expect(page.locator('#border')).toHaveValue('film');

  await page.getByRole('button', { name: 'Letterboxd style' }).click();
  await expect(page.locator('#bg')).toHaveValue('#14181c');
  await expect(page.locator('#fg-auto')).toBeChecked();
  expect(near(await pixel(page, 5, 5), hexRgb('#14181c'))).toBe(true);
});

test('a gradient runs from the background colour at the top to the second colour at the bottom', async ({ page }) => {
  await pickList(page);
  await page.locator('#bg').fill('#000000');
  await expect(page.locator('#bg2')).toBeDisabled(); // solid: no second colour
  await pick(page, 'bg-style', 'gradient');
  await expect(page.locator('#bg2')).toBeEnabled();
  await page.locator('#bg2').fill('#ffffff');
  expect(near(await pixel(page, 5, 1), [0, 0, 0], 10)).toBe(true);
  expect(near(await pixel(page, 5, -2), [255, 255, 255], 10)).toBe(true);
});

test('patterns draw the second colour over the background', async ({ page }) => {
  await pickList(page);
  await page.locator('#bg').fill('#000000');
  for (const style of ['dots', 'stripes', 'grid']) {
    await pick(page, 'bg-style', style);
    await page.locator('#bg2').fill('#ff0000');
    await nextFrame(page);
    // Somewhere in the top margin is now red.
    const reds = await page.evaluate(() => {
      const d = document.getElementById('poster').getContext('2d').getImageData(0, 0, 200, 60).data;
      let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60) n++;
      return n;
    });
    expect(reds, style).toBeGreaterThan(20);
  }
});

test('each border draws in the margin and never over a poster', async ({ page }) => {
  await pickList(page);
  await page.locator('#bg').fill('#000000');
  await page.locator('#fg-auto').uncheck();
  await page.locator('#fg').fill('#ffffff');
  const [w, h] = await canvasSize(page);
  const marginInk = () => page.evaluate(([w, h]) => {
    const c = document.getElementById('poster').getContext('2d');
    let n = 0;
    for (const [x, y, ww, hh] of [[0, 0, 70, h], [w - 70, 0, 70, h]]) {
      const d = c.getImageData(x, y, ww, hh).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 100) n++;
    }
    return n;
  }, [w, h]);
  const before = await snapshot(page);
  expect(await marginInk()).toBe(0);
  for (const b of ['line', 'double', 'corners', 'film', 'flowers']) {
    await pick(page, 'border', b);
    await nextFrame(page);
    expect(await marginInk(), b).toBeGreaterThan(50);
  }
  // Posters stay where they were: the border only changes the margin.
  await pick(page, 'border', 'none');
  expect(await snapshot(page)).toBe(before);
});

test('title size and on/off change the header; the title text is kept', async ({ page }) => {
  await pickList(page);
  const [, base] = await canvasSize(page);
  await page.locator('#title-size').fill('120');
  const [, bigger] = await canvasSize(page);
  expect(Math.abs(bigger - base - 44)).toBeLessThanOrEqual(1);
  await page.locator('#title-on').uncheck();
  const [, none] = await canvasSize(page);
  expect(none).toBeLessThan(base - 100);
  await expect(page.locator('#title-font')).toBeDisabled();
  await expect(page.locator('#title')).toHaveValue('Favourites, ranked');
  await page.locator('#title-on').check();
  expect((await canvasSize(page))[1]).toBe(bigger);
});

test('caption size scales the captions and the space for them', async ({ page }) => {
  await pickList(page);
  const [, base] = await canvasSize(page);
  await page.locator('#cap-size').fill('1.6');
  const [, big] = await canvasSize(page);
  await page.locator('#cap-size').fill('0.6');
  const [, small] = await canvasSize(page);
  expect(big).toBeGreaterThan(base);
  expect(small).toBeLessThan(base);
});

test('fonts change how the title and captions are drawn', async ({ page }) => {
  await pickList(page);
  await expect(page.locator('#title-font option')).toHaveCount(6);
  const a = await snapshot(page);
  await page.locator('#title-font').selectOption('mono');
  const b = await snapshot(page);
  await page.locator('#cap-font').selectOption('mono');
  const c = await snapshot(page);
  expect(b).not.toBe(a);
  expect(c).not.toBe(b);
});

test('text colour is automatic until a colour is picked', async ({ page }) => {
  await pickList(page);
  await page.locator('#bg').fill('#ffffff');
  await nextFrame(page);
  await expect(page.locator('#fg')).toHaveValue('#151515'); // dark text on a light background
  await page.locator('#bg').fill('#000000');
  await nextFrame(page);
  await expect(page.locator('#fg')).toHaveValue('#f2f2f2');
  await page.locator('#fg').fill('#ff8800');
  await expect(page.locator('#fg-auto')).not.toBeChecked();
  await page.locator('#bg').fill('#ffffff');
  await nextFrame(page);
  await expect(page.locator('#fg')).toHaveValue('#ff8800');
});

test('style settings are saved and restored', async ({ page }) => {
  await pickList(page);
  await page.getByRole('button', { name: 'Garden style' }).click();
  await page.locator('#cap-size').fill('1.3');
  await page.locator('#title-on').uncheck();
  await waitForSave(page, s => s.border === 'flowers' && s['cap-size'] === '1.3' && s.checks['title-on'] === false);
  const before = await snapshot(page);
  await page.reload();
  await expect(tiles(page)).toHaveCount(5);
  await expect(page.locator('#bg-style')).toHaveValue('dots');
  await expect(page.locator('#cap-font')).toHaveValue('rounded');
  await expect(page.locator('#cap-size')).toHaveValue('1.3');
  await expect(page.locator('#title-on')).not.toBeChecked();
  await expect(page.locator('#fg-auto')).not.toBeChecked();
  await expect.poll(() => snapshot(page)).toBe(before);
});

test('pickers set the value, show it as pressed, and follow presets and reloads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#style')).toHaveJSProperty('open', false); // Customise starts closed
  const pressed = id => page.locator(`.picker[data-for="${id}"] [aria-pressed="true"]`);
  await pick(page, 'size', '0.5625');
  await expect(page.locator('#size')).toHaveValue('0.5625');
  await expect(pressed('size')).toHaveAttribute('data-value', '0.5625');
  await pick(page, 'border', 'film');
  await expect(page.locator('#border')).toHaveValue('film');
  await expect(pressed('border')).toHaveAttribute('data-value', 'film');
  await page.getByRole('button', { name: 'Garden style' }).click();
  await expect(pressed('bg-style')).toHaveAttribute('data-value', 'dots');
  await expect(pressed('border')).toHaveAttribute('data-value', 'flowers');
  await waitForSave(page, s => s.border === 'flowers' && s.size === '0.5625');
  await page.reload();
  await expect(pressed('size')).toHaveAttribute('data-value', '0.5625');
  await expect(pressed('border')).toHaveAttribute('data-value', 'flowers');
});

test('the "Films without a poster" slider resizes their names and is saved', async ({ page }) => {
  await pickList(page);
  await page.locator('#hide-missing').uncheck();
  const before = await snapshot(page);
  await page.locator('#np-size').fill('1.6');
  expect(await snapshot(page)).not.toBe(before);
  await waitForSave(page, s => s['np-size'] === '1.6');
  await page.reload();
  await expect(page.locator('#np-size')).toHaveValue('1.6');
});

test('the poster title and the captions each have their own Wrap toggle', async ({ page }) => {
  await pickList(page);
  await page.locator('#title').fill('A very long poster title that cannot possibly fit on one line of this poster');
  const [, cut] = await canvasSize(page);
  // A wrapped title adds at least one title line (76 units at the default size) to the fit-to-films poster.
  await page.locator('#title-wrap').check();
  const [, titleWrapped] = await canvasSize(page);
  expect(titleWrapped).toBeGreaterThan(cut + 76);
  // Wrapped captions add room for a second name line under every row, on top of that.
  await page.locator('#cap-wrap').check();
  const [, both] = await canvasSize(page);
  expect(both).toBeGreaterThan(titleWrapped);
  await page.locator('#title-wrap').uncheck();
  const [, capsOnly] = await canvasSize(page);
  expect(capsOnly).toBeGreaterThan(cut);
  expect(capsOnly).toBeLessThan(both);
  // Both are saved separately.
  await page.locator('#title-wrap').check();
  await waitForSave(page, s => s.checks['title-wrap'] === true && s.checks['cap-wrap'] === true);
  await page.reload();
  await expect(page.locator('#title-wrap')).toBeChecked();
  await expect(page.locator('#cap-wrap')).toBeChecked();
  await customise(page);
  for (const id of ['title-wrap', 'cap-wrap']) await page.locator(`#${id}`).uncheck();
  expect((await canvasSize(page))[1]).toBe(cut);
});
