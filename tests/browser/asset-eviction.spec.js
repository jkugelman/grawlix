import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Without eviction the CMU dict (Rhymes' asset, ~100 MB+) stays resident for the
// session, which on iOS's shared jetsam budget can trigger a reload.

const DICT = ['cat K AE1 T', 'bat B AE1 T', 'mat M AE1 T', ''].join('\n');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const assetState = page => page.evaluate(() => window.__grawlixTest.workerAssetState());
const setStack = (page, stack) => page.evaluate(s => window.__grawlixTest.setStack(s), stack);

test('the CMU dict loads with Rhymes and is evicted when it leaves the stack', async ({ page }) => {
  let dictGets = 0;
  await page.route(/cmudict\.dict/, route => {
    if (route.request().method() === 'GET') dictGets++;
    return route.fulfill({
      status: 200, contentType: 'text/plain',
      headers: { 'content-length': String(DICT.length) }, body: DICT,
    });
  });

  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AssetTest', entries: ['cat', 'bat'], scores: [50, 50],
  }));

  expect((await assetState(page)).cmudict).toBe(false);

  await setStack(page, [{ tool: 'rhymes', params: { entry: 'mat' } }]);
  await expect.poll(() => assetState(page).then(s => s.cmudict)).toBe(true);
  expect(dictGets).toBe(1);

  await setStack(page, []);
  await expect.poll(() => assetState(page).then(s => s.cmudict)).toBe(false);

  await setStack(page, [{ tool: 'rhymes', params: { entry: 'mat' } }]);
  await expect.poll(() => assetState(page).then(s => s.cmudict)).toBe(true);
  expect(dictGets).toBe(1);   // reloaded from the IDB cache, not re-fetched
});

test('a still-needed asset survives an unrelated stack change', async ({ page }) => {
  await page.route(/cmudict\.dict/, route => route.fulfill({
    status: 200, contentType: 'text/plain',
    headers: { 'content-length': String(DICT.length) }, body: DICT,
  }));

  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AssetTest', entries: ['cat', 'bat'], scores: [50, 50],
  }));

  await setStack(page, [{ tool: 'rhymes', params: { entry: 'mat' } }]);
  await expect.poll(() => assetState(page).then(s => s.cmudict)).toBe(true);

  await setStack(page, [{ tool: 'rhymes', params: { entry: 'cat' } }]);
  expect((await assetState(page)).cmudict).toBe(true);
});
