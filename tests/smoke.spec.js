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

test('welcome popup persists until dismissed and reopens from ?', async ({ page }) => {
  // Direct goto, not gotoApp (which seeds welcomeSeen): exercise the real first boot.
  await page.goto('/');

  const dialog = page.locator('#welcome-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#welcome-title')).toContainText('Welcome to Grawlix');

  await page.reload();
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Get started' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('grawlix_welcomeSeen'))).toBe('1');

  await page.reload();
  await expect.poll(() => page.evaluate(() => _db !== null), { timeout: 10000 }).toBe(true);
  await expect(page.locator('#workshop-view')).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.locator('#btn-help').click();
  await expect(dialog).toBeVisible();
});

test('welcome All count updates live while the dialog is open', async ({ page }) => {
  await page.goto('/');
  const meta = page.locator('#welcome-dialog .welcome-merge-count');
  await expect(meta).toBeVisible();
  await expect(meta).toHaveText('0 entries');

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Live', scores: [50, 60, 40] }));
  await expect(meta).toHaveText('3 entries');
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
    'deleteMyEdit',
    'dumpMergedCache',
    'exportFilename',
    'exportText',
    'getMergedEntry',
    'getVisibleEntries',
    'getVisibleGroups',
    'getWordlist',
    'markMergedCache',
    'mergedCacheTag',
    'moveBefore',
    'pipelineIdle',
    'rebuildMergedCache',
    'saveMyEdit',
    'setRescoreRules',
    'setStack',
    'setUnigramCorpus',
    'setUpdateAvailable',
    'sync',
    'whenReady',
  ]);
});
