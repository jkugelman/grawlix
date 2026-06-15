// Discovery banners — the two self-targeting import nudges below the wordlist
// bar. The XWI cases lean on XWI being subscriber-import-only, so it boots
// unpopulated and its banner is eligible from first paint.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const banner = page => page.locator('#discovery-banner');

test('My Edits banner shows only when scoped to My Edits', async ({ page }) => {
  await gotoApp(page);

  await expect(banner(page)).toBeHidden();

  await scopeTo(page, 'My Edits');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('My Edits');

  // Scoping to XWI swaps in the XWI banner, so assert the My Edits one is gone
  // rather than that the slot is empty.
  await scopeTo(page, 'XWord Info');
  await expect(banner(page)).not.toContainText('My Edits');

  await scopeTo(page, 'All Wordlists');
  await expect(banner(page)).toBeHidden();
});

test('My Edits banner dismissal hides it and persists across reload', async ({ page }) => {
  await gotoApp(page);
  await scopeTo(page, 'My Edits');
  await expect(banner(page)).toBeVisible();

  await banner(page).locator('.discovery-banner-close').click();
  await expect(banner(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('grawlix_banner_myedits_dismissed'))).toBe('1');

  await page.reload();
  await page.evaluate(() => window.__grawlixTest.whenReady());
  await scopeTo(page, 'My Edits');
  await expect(banner(page)).toBeHidden();
});

test('XWI banner shows while XWI is unpopulated, not once it has data', async ({ page }) => {
  await gotoApp(page);

  await scopeTo(page, 'XWord Info');
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('XWord Info');

  await page.evaluate(() => {
    const xwi = state.sources.find(w => w.publisherId === 'xwi');
    return applyWordlistText(xwi, 'OCEAN;70\nTIDE;40\n', { source: 'test', silent: true });
  });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(banner(page)).toBeHidden();
});

test('XWI banner dismissal persists across reload', async ({ page }) => {
  await gotoApp(page);
  await scopeTo(page, 'XWord Info');
  await expect(banner(page)).toBeVisible();

  await banner(page).locator('.discovery-banner-close').click();
  await expect(banner(page)).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('grawlix_banner_xwi_dismissed'))).toBe('1');

  await page.reload();
  await page.evaluate(() => window.__grawlixTest.whenReady());
  await scopeTo(page, 'XWord Info');
  await expect(banner(page)).toBeHidden();
});

test('the Import button targets the scoped wordlist', async ({ page }) => {
  await gotoApp(page);
  await scopeTo(page, 'XWord Info');

  await banner(page).locator('.discovery-banner-import').click();
  const dialog = page.locator('#import-guide-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#guide-title')).toHaveText('Import XWord Info');
});
