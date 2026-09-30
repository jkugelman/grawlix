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

test('the match mode anchors the sounds, and * frees an end', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PhoneTest',
    entries: ['zarbiter', 'arty', 'tee'],
    scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'phone_search', params: { entry: 'are*' } }]));
  await expectVisible(page, ['zarbiter', 'arty']);
  await page.locator('.tool-row .tool-row-match input[type="checkbox"]').check();
  await expectVisible(page, ['arty']);
});
