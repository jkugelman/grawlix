// Merge seam — see docs/design.md and site/index.html § buildMergedWordlist.
//
// These tests pin the central contract of the app: when multiple enabled
// wordlists share an entry, which one wins, and what does the merged All Wordlists
// view show. Most cross-feature regressions in Grawlix land somewhere
// downstream of this seam (cache invalidation, popover sourcing, the
// entries table, downloads).

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openManagePanel } = require('./helpers');

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
  expect(before).toMatchObject({ entry: 'bagel', score: 90, comment: '', wordlist: 'High' });

  // Reorder Low above High → Low wins. Routes through reorderSources, the
  // same code path drag reordering uses.
  await page.evaluate(() => window.__grawlixTest.moveBefore('Low', 'High'));
  const after = await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'));
  expect(after).toMatchObject({ entry: 'bagel', score: 50, comment: '', wordlist: 'Low' });
});

test('disabling a wordlist excludes its entries from All Wordlists; re-enabling restores them', async ({ page }) => {
  await gotoApp(page);

  // Two wordlists with disjoint entries — three entries each, six in All Wordlists.
  // Names chosen so neither substring-collides with a publisher card on the
  // page (publishers are present-but-empty after the fetch stub).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TestFruits', entries: ['APPLE', 'BANANA', 'CHERRY'], scores: [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'TestBerries', entries: ['BLUEBERRY', 'RASPBERRY', 'STRAWBERRY'], scores: [50, 50, 50],
  }));

  // Sanity: both contribute, BLUEBERRY is in All Wordlists.
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).not.toBeNull();

  await openManagePanel(page);
  await page.locator('#manage-dialog label.toggle[aria-label="Toggle TestBerries"]').click();
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();

  // BLUEBERRY gone, APPLE still present. The merged-cache invalidation
  // seam is what this is really testing — if `_mergedWordlistCache` didn't
  // get invalidated on Apply, BLUEBERRY would stick around.
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).toBeNull();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('APPLE'))).not.toBeNull();

  await openManagePanel(page);
  await page.locator('#manage-dialog label.toggle[aria-label="Toggle TestBerries"]').click();
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BLUEBERRY'))).not.toBeNull();
});

test('a blank comment on the winner falls through to a lower-priority non-blank comment', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'High', entries: ['BAGEL'], scores: [90], comments: [''],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Low', entries: ['BAGEL'], scores: [50], comments: ['breakfast staple'],
  }));

  const m = await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'));
  expect(m).toMatchObject({ score: 90, comment: 'breakfast staple', wordlist: 'High' });
});

test('a plain ambient winner inherits the rich variant\'s comment', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Plain', entries: ['theirs'], scores: [90], comments: [''],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Rich', entries: ['Theirs', 'the IRS'], scores: [50, 60], comments: ['pronoun', 'tax agency'],
  }));

  const pronoun = await page.evaluate(() => window.__grawlixTest.getMergedEntry('theirs', 'Theirs'));
  const agency  = await page.evaluate(() => window.__grawlixTest.getMergedEntry('theirs', 'the IRS'));
  expect(pronoun).toMatchObject({ score: 90, comment: 'pronoun',    wordlist: 'Plain' });
  expect(agency).toMatchObject({  score: 90, comment: 'tax agency', wordlist: 'Plain' });
});
