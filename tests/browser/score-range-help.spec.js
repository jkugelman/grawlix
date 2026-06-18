import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeViaSelector, openRescoreEditor } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('focusing the score-range filter shows the range cheat sheet', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#score-range-input').focus();
  await expect(page.locator('.popup-help.open', { hasText: 'minimum score' })).toBeVisible();
  await expect(page.locator('.popup-help.open')).toContainText('exact score');
});

test('the score-range title carries only the Alt-C shortcut, not the syntax', async ({ page }) => {
  await gotoApp(page);
  const title = await page.locator('.score-range-label').getAttribute('title');
  expect(title).toBe('Filter by score (Alt-C)');
});

test('the rescore editor fields each show their own cheat sheet', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['ocean'], scores: [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Src', [
    { input: '50', length: '', output: '60', note: '' },
  ]));
  await scopeViaSelector(page, 'Src');
  await openRescoreEditor(page);

  await page.locator('#rescore-rules .rule-in').first().focus();
  await expect(page.locator('.popup-help.open')).toContainText('score range');

  await page.locator('#rescore-rules .rule-len').first().focus();
  await expect(page.locator('.popup-help.open')).toContainText('any length');
  await expect(page.locator('.popup-help.open .help-grid > span').first()).toContainText('blank');
  await expect(page.locator('.popup-help.open .help-ghost')).toHaveText('blank');
  await expect(page.locator('.popup-help.open kbd', { hasText: 'blank' })).toHaveCount(0);

  await page.locator('#rescore-rules .rule-out').first().focus();
  await expect(page.locator('.popup-help.open')).toContainText('unchanged');
  await expect(page.locator('.popup-help.open .help-grid > span').first()).toContainText('blank');
});
