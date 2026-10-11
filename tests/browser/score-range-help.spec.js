import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, openRescoreEditor } from './helpers.js';

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

test('a scoring tier\'s score field shows the range cheat sheet', async ({ page }) => {
  await gotoApp(page);
  await openRescoreEditor(page);
  await page.locator('#scoring-rules .rule-in').first().focus();
  await expect(page.locator('.popup-help.open')).toContainText('exact score');
});
