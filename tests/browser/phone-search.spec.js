import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

// zarbiter is fictional — absent from the real CMU dict, so it matches only if this
// stub served the worker. Swap in a real word and the test silently passes against
// the live dict instead.
const DICT = [
  'are AA1 R', 'zarbiter Z AA1 R B IH0 T ER0', 'arty AA1 R T IY0', 'tee T IY1', '',
].join('\n');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await page.route(/cmudict\.dict/, route => route.fulfill({
    status: 200,
    contentType: 'text/plain',
    headers: { 'content-length': String(DICT.length) },
    body: DICT,
  }));
});

test('finds entries containing the input’s sounds and marks the letters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PhoneTest',
    entries: ['zarbiter', 'arty', 'tee'],
    scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'phone_search', params: { entry: 'are' } }]));
  await expectVisible(page, ['zarbiter', 'arty']);
  const row = page.locator('.entry-row', { hasText: 'zarbiter' });
  await expect(row.locator('mark')).toHaveText('ar');
});

test('the panel shows the sounds a query searches for, and they search the same way', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PhoneTest',
    entries: ['zarbiter', 'arty', 'tee'],
    scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'phone_search', params: { entry: 'tee' } }]));
  const input = page.locator('.tool-row[data-tool="phone_search"] input[data-key="entry"]');
  await input.click();
  const panel = page.locator('.assist-panel');
  await expect(panel.locator('.assist-lines code')).toHaveText(['T IY']);
  await page.evaluate(() => { navigator.clipboard.writeText = async text => { window.__copied = text; }; });
  await panel.locator('.assist-lines-copy').click();
  await expect(page.locator('.toast', { hasText: 'Sounds copied' })).toBeVisible();
  expect(await page.evaluate(() => window.__copied)).toBe('T IY');
  await expect(input).toBeFocused();
  await input.fill('T IY');
  await expectVisible(page, ['arty', 'tee']);
  await input.fill('');
  await panel.locator('.assist-cheat-row', { hasText: 'tea' }).click();
  await panel.locator('.assist-cheat-row', { hasText: 'eat' }).first().click();
  await expect(input).toHaveValue('T IY');
});

test('the match mode anchors the sounds', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PhoneTest',
    entries: ['zarbiter', 'arty', 'tee'],
    scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'phone_search', params: { entry: 'are' } }]));
  await expectVisible(page, ['zarbiter', 'arty']);
  await page.locator('.tool-row .choice-arrow').click();
  await page.locator('.split-btn-menu button[data-value="start"]').click();
  await expectVisible(page, ['arty']);
});
