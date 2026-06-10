const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Run against BOTH site/ and dist/ (GRAWLIX_SITE_DIR): a pass in each is the
// proof the worker-spawn URL resolves under native ESM and under the bundle.
test('pipeline worker spawns and round-trips a ping', async ({ page }) => {
  await gotoApp(page);
  const reply = await page.evaluate(() => window.__grawlixTest.pingWorker());
  expect(reply).toBe('pong');
});
