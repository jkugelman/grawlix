import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

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

test('Help does not auto-open on first boot, and the ? button opens it', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.__grawlixTest.whenReady());
  await expect(page.locator('#app')).toBeVisible();

  const dialog = page.locator('#help-dialog');
  await expect(dialog).toBeHidden();

  await page.locator('#btn-help').click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#help-title')).toContainText('Help');
  await expect(page).toHaveURL(/#help$/);
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
