// Merge seam — see docs/wordlists.md § Rich wordlists and engine/corpus.js (buildCorpus/resolveCorpus).
//
// These tests pin the central contract of the app: when multiple enabled
// wordlists share an entry, which one wins, and what does the merged All Wordlists
// view show. Most cross-feature regressions in Grawlix land somewhere
// downstream of this seam (cache invalidation, panel sourcing, the
// entries table, downloads).

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp, openManagePanel, expectVisible } from './helpers.js';

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

async function setMergeMode(page, label) {
  await openManagePanel(page);
  await page.locator('#manage-dialog .manage-merge-choice').click();
  await page.locator('.choice-menu button', { hasText: label }).click();
  await expect(page.locator('#manage-dialog .manage-merge-note')).toBeVisible({ visible: label !== 'First wins' });
  await page.locator('#manage-dialog .manage-apply-btn').click();
  await expect(page.locator('#manage-dialog')).toBeHidden();
}

const mergedScore = (page, entry) =>
  page.evaluate(e => window.__grawlixTest.getMergedEntry(e), entry).then(r => r && [r.score, r.wordlist]);

test('the score modes in Manage pick the winner by score, whatever the order', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'First', entries: ['BAGEL'], scores: [50] }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Second', entries: ['BAGEL'], scores: [90] }));
  expect(await mergedScore(page, 'BAGEL')).toEqual([50, 'First']);

  await setMergeMode(page, 'Highest score wins');
  await expect.poll(() => mergedScore(page, 'BAGEL')).toEqual([90, 'Second']);

  await setMergeMode(page, 'Lowest score wins');
  await expect.poll(() => mergedScore(page, 'BAGEL')).toEqual([50, 'First']);
  await page.evaluate(() => window.__grawlixTest.moveBefore('Second', 'First'));
  await expect.poll(() => mergedScore(page, 'BAGEL')).toEqual([50, 'First']);

  await setMergeMode(page, 'First wins');
  await expect.poll(() => mergedScore(page, 'BAGEL')).toEqual([90, 'Second']);
});

test('under Highest score wins an edit can still lower a score', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Lister', entries: ['CASSIAN'], scores: [50] }));
  await setMergeMode(page, 'Highest score wins');
  await page.evaluate(() => window.__grawlixTest.createMyEntry('CASSIAN', 30));
  await expect.poll(() => mergedScore(page, 'CASSIAN')).toEqual([30, 'My Edits']);
});

test('My Edits is pinned in Manage, and a demoted or disabled one is restored at load', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Lister', entries: ['BAGEL'], scores: [50] }));
  await openManagePanel(page);
  const editsCard = page.locator('#manage-dialog .wordlist-card').first();
  await expect(editsCard).toContainText('My Edits');
  await expect(editsCard.locator('.drag-handle:not([aria-hidden])')).toHaveCount(0);
  await expect(editsCard.locator('.toggle')).toHaveCount(0);
  await page.locator('#manage-dialog .dialog-close-btn').click();

  // Only an older version could store this order; the test API reaches past the UI.
  await page.evaluate(() => window.__grawlixTest.moveBefore('Lister', 'My Edits'));
  await page.evaluate(() => window.__grawlixTest.setEnabled('My Edits', false));
  await reloadApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('BAGEL', 30));
  await expect.poll(() => mergedScore(page, 'BAGEL')).toEqual([30, 'My Edits']);
  await openManagePanel(page);
  await expect(page.locator('#manage-dialog .wordlist-card').first()).toContainText('My Edits');
});

// A search keystroke changes only the filter, not the sources, so it must reuse
// the merged corpus, not rebuild it. The old bug routed the bar's input through
// cacheVersion$, whose cache branch nulled and rebuilt the merge on every
// keystroke — a ~1s freeze on a 750K-entry merge. The stamped cache surviving
// the keystroke is the proof it wasn't rebuilt.
test('a search keystroke filters the merged view to the matching entry', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bakery', entries: ['BAGEL', 'CAKE', 'DONUT'], scores: [50, 60, 70],
  }));
  await expectVisible(page, ['BAGEL', 'CAKE', 'DONUT']);

  // The worker owns the corpus, so a keystroke is just a `run` against the resident
  // owned corpus — no main-side rebuild to guard against. The filter is the assertion.
  await page.locator('input[data-key="pattern"]').fill('BAG');
  await expectVisible(page, ['BAGEL']);
});
