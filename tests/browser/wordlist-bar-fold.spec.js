// Wordlist-bar measure-and-overflow. Pixel-geometry by nature, so an authorized
// layout-test exception (cf. testing.md's delete-geometry-tests default) — it
// resizes the viewport to prove the action cluster folds into the kebab.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function settledFoldState(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const inlineDownload = page.locator('#wordlist-bar #download-btn');
  const inlineRescore  = page.locator('#wordlist-bar .wls-rescore-slot .rescore-toggle');
  let last = null, stable = 0;
  await expect.poll(async () => {
    const cur = JSON.stringify({
      download: (await inlineDownload.count()) > 0,
      rescore: (await inlineRescore.count()) > 0,
    });
    if (cur === last) stable++; else { stable = 0; last = cur; }
    return stable;
  }).toBeGreaterThanOrEqual(2);
  return JSON.parse(last);
}

test('the action cluster folds Download before Rescore as the bar narrows, and unfolds on widening', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'A Very Long Wordlist Name', entries: ['cat'], scores: [50] }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('A Very Long Wordlist Name', [{ input: '50', length: '', output: '80' }]));
  await scopeTo(page, 'A Very Long Wordlist Name');

  // Fold widths are font-metric-dependent — they shift between rendering
  // environments. Assert the fold order, never a specific width; pinning one
  // reintroduces a flake that only surfaces under a different font.
  const widths = [1280, 1080, 940, 820, 720, 640, 560, 500, 440, 400, 360, 320];
  const samples = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    samples.push({ width, ...(await settledFoldState(page)) });
  }

  expect(samples.at(0)).toMatchObject({ download: true, rescore: true });
  expect(samples.at(-1)).toMatchObject({ download: false, rescore: false });

  for (const s of samples) {
    if (s.download) expect(s.rescore).toBe(true);
  }

  const foldedBelow = (key) => Math.max(...samples.filter((s) => !s[key]).map((s) => s.width));
  expect(foldedBelow('download')).toBeGreaterThan(foldedBelow('rescore'));

  const kebabItems = page.locator('#wordlist-bar .wls-kebab .split-btn-menu button');
  await expect(kebabItems.filter({ hasText: 'Download rescored' })).toHaveCount(1);
  await expect(kebabItems.filter({ hasText: 'Download original' })).toHaveCount(1);
  await expect(kebabItems.filter({ hasText: /^Rescoring$/ })).toHaveCount(1);

  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await settledFoldState(page)).toMatchObject({ download: true, rescore: true });
  await expect(kebabItems.filter({ hasText: 'Download rescored' })).toHaveCount(0);
});

test('All Wordlists never grows a kebab, even when narrow', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Mine', entries: ['ocean'], scores: [70] }));
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
  await expect(page.locator('#wordlist-bar .wls-kebab')).toHaveCount(0);
  await expect(page.locator('#wordlist-bar .wls-rescore-slot .rescore-toggle')).toHaveCount(1);
});
