const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo } = require('./helpers');

// Regression: deleting a My Edits entry while scoped to All Wordlists crashed the
// flat scroller — the merged corpus shrinks in place, and the repaint then read
// this.entries' now-stale indices past it. The tiny, all-visible corpus is
// load-bearing: it forces the out-of-bounds tail index into the render window, so
// the throw is deterministic without the fix. Post-flip the worker owns the
// corpus; the test asserts the worker's survivor norms against the frozen set.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('deleting a My Edits entry while on All Wordlists does not crash the scroller', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', scores: [90, 80, 70], entries: ['CAT', 'DOG', 'BIRD'],
  }));
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('GRAPEFRUIT', 'GRAPEFRUIT', 30));
  await scopeTo(page, 'All Wordlists');

  await page.evaluate(() => window.__grawlixTest.deleteMyEdit('GRAPEFRUIT'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const { workerNorms } = await page.evaluate(() =>
    window.__grawlixTest.workerMirrorsMain([{ tool: 'search', params: { pattern: '' } }]));
  expect([...workerNorms].sort()).toEqual(['bird', 'cat', 'dog']);
});
