// Merge / override seam — see docs/design.md and site/index.html §
// buildOverrideMap / buildMergedWordlist.
//
// These tests pin the central contract of the app: when multiple enabled
// wordlists share an entry, which one wins, and what does the merged All
// view show. Most cross-feature regressions in Grawlix land somewhere
// downstream of this seam (cache invalidation, popover sourcing, the
// Workshop entries table, downloads).

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('higher-positioned wordlist wins the override for a shared entry', async ({ page }) => {
  await gotoApp(page);

  // Two custom wordlists, both containing BAGEL with different scores.
  // addCustomWordlist pushes to the end of state.sources, so the first-added
  // ('High') lands at a lower index — higher priority for the merge.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'High', entries: ['BAGEL', 'CAKE'], scores: [90, 80],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Low', entries: ['BAGEL', 'DONUT'], scores: [50, 40],
  }));

  // High wins.
  const before = await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'));
  expect(before).toEqual({ entry: 'bagel', score: 90, comment: '', wordlist: 'High' });

  // Reorder Low above High → Low wins. Routes through reorderSources, the
  // same code path drag reordering uses.
  await page.evaluate(() => window.__grawlixTest.moveBefore('Low', 'High'));
  const after = await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'));
  expect(after).toEqual({ entry: 'bagel', score: 50, comment: '', wordlist: 'Low' });
});

test('disabling a wordlist excludes its entries from All; re-enabling restores them', async ({ page }) => {
  await gotoApp(page);

  // Two wordlists with disjoint entries — three entries each, six in All.
  // Names chosen so neither substring-collides with a publisher card on the
  // page (publishers are present-but-empty after the fetch stub).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TestFruits', entries: ['APPLE', 'BANANA', 'CHERRY'], scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TestBerries', entries: ['BLUEBERRY', 'RASPBERRY', 'STRAWBERRY'], scores: [50, 50, 50],
  }));

  // Sanity: both contribute, BLUEBERRY is in All.
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).not.toBeNull();

  // Disable TestBerries via the Library toggle — same path the user takes.
  // The native checkbox is hidden behind a custom toggle slider, so target
  // the label by its aria-label.
  await page.locator('.header-nav-item[data-view="library"]').click();
  const berriesToggle = page.getByLabel('Toggle TestBerries');
  await berriesToggle.uncheck();

  // BLUEBERRY gone, APPLE still present. The merged-cache invalidation
  // seam is what this is really testing — if `_overrideMap` or
  // `_mergedWordlistCache` didn't get invalidated on toggle, BLUEBERRY
  // would stick around.
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).toBeNull();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('APPLE'))).not.toBeNull();

  // Re-enable → BLUEBERRY returns.
  await berriesToggle.check();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).not.toBeNull();
});

test('rescore rule with output "ignore" drops the entry from All', async ({ page }) => {
  await gotoApp(page);

  // Three entries, one with score 70 — we'll ignore that one.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Pruned', entries: ['KEEP1', 'DROPME', 'KEEP2'], scores: [50, 70, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Pruned', [
    { input: '70', length: '', output: 'ignore', note: '' },
    { input: '50', length: '', output: '',       note: '' },
  ]));

  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('KEEP1'))).not.toBeNull();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('DROPME'))).toBeNull();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('KEEP2'))).not.toBeNull();
});
