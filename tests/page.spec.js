// The FAQ dialog and the structured data that mirrors it for search engines.
import { test, expect } from './helpers.js';

test('the FAQ opens from the header and the footer, and closes', async ({ page }) => {
  await page.goto('/');
  const faq = page.locator('#faq');
  await expect(faq).toBeHidden();
  await page.locator('header a[href="#faq"]').click();
  await expect(faq).toBeVisible();
  await page.locator('#faq-close').click();
  await expect(faq).toBeHidden();
  await page.locator('footer a[href="#faq"]').click();
  await expect(faq).toBeVisible();
});

test('/#faq opens the FAQ straight away', async ({ page }) => {
  await page.goto('/#faq');
  await expect(page.locator('#faq')).toBeVisible();
});

test('structured data describes the app and carries the FAQ from the dialog', async ({ page }) => {
  await page.goto('/');
  const ld = await page.locator('script[type="application/ld+json"]').evaluateAll(ss => ss.map(s => JSON.parse(s.textContent)));
  expect(ld.find(n => n['@type'] === 'WebApplication').url).toBe('https://postergenerator.andreithuler.com/');
  const faq = ld.find(n => n['@type'] === 'FAQPage').mainEntity.map(q => [q.name, q.acceptedAnswer.text]);
  const shown = await page.locator('#faq h3').evaluateAll(hs => hs.map(h => [h.textContent, h.nextElementSibling.textContent]));
  expect(faq).toEqual(shown);
  expect(faq.length).toBeGreaterThan(5);
});

test('the FAQ still works when the app script fails to load', async ({ page }) => {
  await page.route('**/app.js', r => r.abort());
  await page.goto('/#faq');
  await expect(page.locator('#faq')).toBeVisible();
  await page.locator('#faq-close').click();
  await page.locator('footer a[href="#faq"]').click();
  await expect(page.locator('#faq')).toBeVisible();
});
