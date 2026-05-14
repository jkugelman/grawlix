const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('page loads and lands on Workshop', async ({ page }) => {
  await gotoApp(page);

  // Brand bar shows the wordmark.
  await expect(page.locator('header h1')).toContainText('Grawlix');

  // Workshop is the default landing view; Library is hidden.
  await expect(page.locator('#workshop-view')).toBeVisible();
  await expect(page.locator('#library-view')).toBeHidden();
  await expect(page.locator('.header-nav-item[data-view="workshop"]')).toHaveClass(/active/);
});

test('Library nav switches views', async ({ page }) => {
  await gotoApp(page);
  await openLibrary(page);

  await expect(page.locator('#workshop-view')).toBeHidden();
  await expect(page.locator('#library-view')).toBeVisible();
  await expect(page.locator('.header-nav-item[data-view="library"]')).toHaveClass(/active/);
});

test('test API is exposed on window', async ({ page }) => {
  await gotoApp(page);
  // Sanity check that __grawlixTest exists and is callable. Tests in the
  // rest of the suite depend on it heavily; if this fails, fix it here
  // before chasing test-specific failures.
  const apiShape = await page.evaluate(() => Object.keys(window.__grawlixTest).sort());
  expect(apiShape).toEqual([
    '_lookup',
    'addCustomWordlist',
    'getMergedEntry',
    'getVisibleEntries',
    'getWordlist',
    'moveBefore',
    'pipelineIdle',
    'setRescoreRules',
    'setStack',
    'setUpdateAvailable',
  ]);
});
