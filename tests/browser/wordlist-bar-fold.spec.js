// Wordlist-bar measure-and-overflow. Pixel-geometry by nature, so an authorized
// layout-test exception (cf. testing.md's delete-geometry-tests default) — it
// resizes the viewport to prove the action cluster folds into the kebab.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function settledDownloadInline(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const inlineDownload = page.locator('#wordlist-bar #download-btn');
  let last = null, stable = 0;
  await expect.poll(async () => {
    const cur = (await inlineDownload.count()) > 0;
    if (cur === last) stable++; else { stable = 0; last = cur; }
    return stable;
  }).toBeGreaterThanOrEqual(2);
  return last;
}

test('Download folds into the kebab as the bar narrows, and unfolds on widening', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'A Very Long Wordlist Name', entries: ['cat'], scores: [50] }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('A Very Long Wordlist Name', [{ query: 'score: 50', output: '80' }]));
  await scopeTo(page, 'A Very Long Wordlist Name');

  // Fold widths are font-metric-dependent — they shift between rendering
  // environments. Assert the fold, never a specific width; pinning one
  // reintroduces a flake that only surfaces under a different font.
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await settledDownloadInline(page)).toBe(true);
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await settledDownloadInline(page)).toBe(false);

  const kebabItems = page.locator('#wordlist-bar .wls-kebab .split-btn-menu button');
  await expect(kebabItems.filter({ hasText: 'Download rescored' })).toHaveCount(1);
  await expect(kebabItems.filter({ hasText: 'Download original' })).toHaveCount(1);

  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await settledDownloadInline(page)).toBe(true);
  await expect(kebabItems.filter({ hasText: 'Download rescored' })).toHaveCount(0);
});
