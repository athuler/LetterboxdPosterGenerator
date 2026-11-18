// The download dialog: formats, sizes, recommendations, and that the files are real PNGs / PDFs.
import { readFile } from 'node:fs/promises';
import { test, expect, pick, customise, dropZip, tiles, canvasSize, ART } from './helpers.js';

const pickList = async page => {
  await page.goto('/');
  await dropZip(page);
  await page.locator('#source').selectOption({ label: 'Favourites, ranked (5)' });
  await expect(tiles(page)).toHaveCount(5);
};
const rows = page => page.locator('#dl-sizes label');
// Open the dialog and wait until the file-size measurement has rebuilt the rows (or given up).
const openDownload = async page => {
  await page.locator('#download').click();
  await expect(page.locator('#dl-sizes[data-ready]')).toHaveCount(1);
};

// Sizes before "Recommended" warn about small captions; it and everything after don't.
async function expectRecommendation(page) {
  const texts = await rows(page).allInnerTexts();
  const rec = texts.findIndex(t => t.includes('Recommended'));
  expect(rec, texts.join(' / ')).toBeGreaterThanOrEqual(0);
  expect(texts.filter(t => t.includes('Recommended'))).toHaveLength(1);
  texts.forEach((t, i) => expect(t.includes('Captions very small'), t).toBe(i < rec));
  await expect(rows(page).nth(rec).locator('input')).toBeChecked();
  return { texts, rec };
}

async function download(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dl-go').click()]);
  await expect(page.locator('#dl')).not.toBeVisible();
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

test('opens with PNG sizes, a single recommendation and file size estimates', async ({ page }) => {
  await pickList(page);
  await pick(page, 'size', '1.4142');
  await page.locator('#cols').fill('5');
  await openDownload(page);
  await expect(page.locator('#dl')).toBeVisible();
  await expect(page.locator('#dl-png')).toBeChecked();
  await expect(rows(page).first()).toContainText('1,500 × 2,121 px');
  await expectRecommendation(page);
  await expect(rows(page).first()).toContainText(/~[\d.]+ (KB|MB)/); // estimates arrive just after opening
  await page.locator('#dl-cancel').click();
  await expect(page.locator('#dl')).not.toBeVisible();
});

test('PDF offers paper sizes for the poster shape, smallest readable one recommended', async ({ page }) => {
  await pickList(page);
  await pick(page, 'size', '1.4142');
  await page.locator('#cols').fill('5');
  await openDownload(page);
  await page.locator('#dl-pdf').check({ force: true });
  await expect(rows(page)).toHaveCount(5);
  await expect(rows(page).nth(0)).toContainText('A5');
  await expect(rows(page).nth(4)).toContainText('A1');
  await expect(rows(page).first()).toContainText('dpi');
  await expectRecommendation(page);
});

test('smaller captions push the recommendation to a bigger size', async ({ page }) => {
  await pickList(page);
  await pick(page, 'size', '1.4142');
  await page.locator('#cols').fill('3');
  await openDownload(page);
  const few = (await expectRecommendation(page)).rec;
  await page.locator('#dl-cancel').click();
  await page.locator('#cols').fill('30');
  await openDownload(page);
  const many = (await expectRecommendation(page)).rec;
  expect(many).toBeGreaterThan(few);
});

test('wallpapers offer screen resolutions and no PDF', async ({ page }) => {
  await pickList(page);
  await pick(page, 'size', '0.5625');
  await openDownload(page);
  await expect(page.locator('#dl-pdf')).toBeDisabled();
  await expect(rows(page)).toHaveText([/1080p · 1,920 × 1,080 px/, /1440p/, /4K · 3,840 × 2,160 px/]);
  await expect(page.locator('#dl-note')).toHaveText('Wallpapers download as PNG.');
});

test('downloads a PNG of the chosen size with the poster art in it', async ({ page }) => {
  await pickList(page);
  await page.locator('#title').fill('My "Poster"');
  await pick(page, 'size', '');
  const [, previewH] = await canvasSize(page);
  await openDownload(page);
  await rows(page).nth(1).locator('input').check(); // 2x: 3000 px wide
  const { name, bytes } = await download(page);
  expect(name).toBe('My-Poster-.png');
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  const [w, h] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  expect(w).toBe(3000);
  expect(Math.abs(h - previewH * 2)).toBeLessThanOrEqual(2);

  // Decode it in the page and check a poster's centre is the art colour, not a text tile.
  const colour = await page.evaluate(async b64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const t = document.querySelector('#tiles .tile');
    const px = (parseFloat(t.style.left) + parseFloat(t.style.width) / 2) / 100 * c.width;
    const py = (parseFloat(t.style.top) + parseFloat(t.style.height) / 2) / 100 * c.height;
    return [...x.getImageData(Math.floor(px), Math.floor(py), 1, 1).data].slice(0, 3);
  }, bytes.toString('base64'));
  expect(colour).toEqual(ART);
});

test('downloads a PDF with the chosen paper size', async ({ page }) => {
  await pickList(page);
  await pick(page, 'size', '1.4142');
  await openDownload(page);
  await page.locator('#dl-pdf').check({ force: true });
  await rows(page).filter({ hasText: 'A4' }).locator('input').check();
  const { name, bytes } = await download(page);
  expect(name).toBe('Favourites-ranked.pdf');
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF')).toBe(true);
  // A4 is 595 × 842 pt.
  const [, w, h] = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  expect(Number(w)).toBeCloseTo(595.4, 0);
  expect(Number(h)).toBeCloseTo(841.7, 0);
  expect(text).toContain('/DCTDecode'); // the poster is embedded as a JPEG
});
