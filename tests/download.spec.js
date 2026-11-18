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
  await expect(page.locator('#dl-sizes[data-ready]')).toHaveCount(1, { timeout: 15000 });
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
  await expect(rows(page)).toHaveCount(6);
  await expect(rows(page).nth(0)).toContainText('A5');
  await expect(rows(page).nth(4)).toContainText('A1');
  await expect(rows(page).nth(5)).toContainText('A0');
  await expect(rows(page).nth(5)).toContainText('300 dpi'); // drawn in strips: no canvas size limit
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

test('a PDF bigger than one canvas is drawn in strips and stays whole', async ({ page }) => {
  test.setTimeout(60000);
  await pickList(page);
  await pick(page, 'size', '1.4142');
  await openDownload(page);
  await page.locator('#dl-pdf').check({ force: true });
  await rows(page).filter({ hasText: 'A2' }).locator('input').check(); // 4,961 × 7,016 px: 3 strips of 16 MP
  const { bytes } = await download(page);
  const text = bytes.toString('latin1');
  const [, w, h] = text.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  expect(Number(w)).toBeCloseTo(1190.9, 0); // A2: 16.54 × 23.39 in
  expect(Number(h)).toBeCloseTo(1684.1, 0);
  expect(text.match(/\/Subtype \/Image/g)).toHaveLength(3);
});

test('Share copies the poster image and offers posting links, where there is no share sheet', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await pickList(page);
  await page.locator('#share').click();
  await expect(page.locator('#share-dlg')).toBeVisible();
  await expect(page.locator('#share-status')).toHaveText('Poster image copied ✓');
  await expect(page.locator('#share-how')).toContainText('paste the image');
  await expect(page.locator('#share-native')).toBeHidden();
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap(i => i.types));
  expect(types).toContain('image/png');
  for (const a of await page.locator('#share-dlg a').all()) {
    expect(await a.getAttribute('href')).toContain('postergenerator.andreithuler.com');
  }
  await page.locator('#share-close').click();
  await expect(page.locator('#share-dlg')).toBeHidden();
});

test('Share opens the device share sheet with the poster image, where there is one', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = d => !!d.files?.length;
    navigator.share = async d => { window.shared = { name: d.files[0].name, type: d.files[0].type, size: d.files[0].size, text: d.text }; };
  });
  await pickList(page);
  await page.locator('#share').click();
  await expect.poll(() => page.evaluate(() => window.shared)).toBeTruthy();
  const shared = await page.evaluate(() => window.shared);
  expect(shared).toMatchObject({ name: 'Favourites-ranked.png', type: 'image/png' });
  expect(shared.size).toBeGreaterThan(1000);
  expect(shared.text).toContain('postergenerator.andreithuler.com');
  await expect(page.locator('#share-dlg')).toBeHidden(); // shared straight away: nothing else to show
});

test('"Working…" is up before the image to share is made, and gone after', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await pickList(page);
  // Note whether "Working…" was showing when the export started drawing (it blocks the page from then on).
  await page.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...a) {
      if (this.width >= 1000) window.workingAtExport = !document.getElementById('working').hidden;
      return toBlob.apply(this, a);
    };
  });
  await page.locator('#share').click();
  await expect(page.locator('#share-dlg')).toBeVisible();
  expect(await page.evaluate(() => window.workingAtExport)).toBe(true);
  await expect(page.locator('#working')).toBeHidden();
});

test('the Download dialog can share the chosen format and size', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = d => !!d.files?.length;
    navigator.share = async d => { window.shared = { name: d.files[0].name, type: d.files[0].type, head: await d.files[0].slice(0, 4).text() }; };
  });
  await pickList(page);
  await pick(page, 'size', '1.4142');
  await openDownload(page);
  await page.locator('#dl-pdf').check({ force: true });
  await rows(page).filter({ hasText: 'A4' }).locator('input').check();
  await page.locator('#dl-share').click();
  await expect.poll(() => page.evaluate(() => window.shared)).toBeTruthy();
  expect(await page.evaluate(() => window.shared)).toEqual({ name: 'Favourites-ranked.pdf', type: 'application/pdf', head: '%PDF' });
});

test('sharing a PDF without a share sheet saves it to attach instead', async ({ page }) => {
  await pickList(page);
  await openDownload(page);
  await page.locator('#dl-pdf').check({ force: true });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#dl-share').click()]);
  expect(dl.suggestedFilename()).toBe('Favourites-ranked.pdf');
  await expect(page.locator('#share-status')).toHaveText('Saved Favourites-ranked.pdf ✓');
  await expect(page.locator('#share-how')).toContainText('attach the saved file');
});
