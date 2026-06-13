const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('page loads into the unified screen', async ({ page }) => {
  await gotoApp(page);

  // Brand bar shows the wordmark.
  await expect(page.locator('header h1')).toContainText('Grawlix');

  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#wordlist-bar')).toBeVisible();
  await expect(page.locator('#wordlist-bar .wls-trigger-label')).toHaveText('All Wordlists');
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
  await page.evaluate(() => window.__grawlixTest.whenReady());
  await expect(page.locator('#app')).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.locator('#btn-help').click();
  await expect(dialog).toBeVisible();
});

test('welcome All Wordlists count updates live while the dialog is open', async ({ page }) => {
  await page.goto('/');
  const meta = page.locator('#welcome-dialog .welcome-merge-count');
  await expect(meta).toBeVisible();
  await expect(meta).toHaveText('0 entries');

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Live', scores: [50, 60, 40] }));
  await expect(meta).toHaveText('3 entries');
});

test('test API is exposed on window', async ({ page }) => {
  await gotoApp(page);
  const present = await page.evaluate(() => {
    const api = window.__grawlixTest || {};
    return ['addCustomWordlist', 'setStack', 'setScope', 'getMergedEntry', 'getWordlist']
      .filter(k => typeof api[k] === 'function');
  });
  expect(present).toEqual(['addCustomWordlist', 'setStack', 'setScope', 'getMergedEntry', 'getWordlist']);
});
