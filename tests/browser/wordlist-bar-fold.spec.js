// Wordlist-bar measure-and-overflow. Pixel-geometry by nature, so an authorized
// layout-test exception (cf. testing.md's delete-geometry-tests default) — it
// resizes the viewport to prove the action cluster folds into the kebab.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('the action cluster folds Download then Rescore into the kebab as the bar narrows', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'A Very Long Wordlist Name', entries: ['cat'], scores: [50] }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('A Very Long Wordlist Name', [{ input: '50', length: '', output: '80' }]));
  await scopeTo(page, 'A Very Long Wordlist Name');

  const inlineDownload = page.locator('#wordlist-bar #download-btn');
  const inlineRescore  = page.locator('#wordlist-bar .wls-rescore-slot .rescore-toggle');
  const kebabItems     = page.locator('#wordlist-bar .wls-kebab .split-btn-menu button');

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(inlineDownload).toBeVisible();
  await expect(inlineRescore).toHaveCount(1);
  await expect(kebabItems.filter({ hasText: 'Download rescored' })).toHaveCount(0);

  await page.setViewportSize({ width: 620, height: 800 });
  await expect(inlineDownload).toHaveCount(0);
  await expect(inlineRescore).toHaveCount(1);
  await expect(kebabItems.filter({ hasText: 'Download rescored' })).toHaveCount(1);
  await expect(kebabItems.filter({ hasText: 'Download original' })).toHaveCount(1);

  await page.setViewportSize({ width: 440, height: 800 });
  await expect(inlineRescore).toHaveCount(0);
  await expect(kebabItems.filter({ hasText: /^Rescoring$/ })).toHaveCount(1);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(inlineDownload).toBeVisible();
  await expect(inlineRescore).toHaveCount(1);
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
