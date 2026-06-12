const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// ch7γ oracle: the worker ships per-config `sourceCounts` (each source's
// merged-contribution tally — the "X" in the scope selector's "X of Y entries")
// and `mergedCount` (the merged total) on selfReady; main reads them for its
// displayed counts. Both derive from the same resolveCorpus/buildCorpus over the
// same config.
//
// Non-vacuity hinges on shippedConfigCountsVersion(): without it a regression
// that silently dropped the shipped fields would still pass.
//
// Same footgun as worker-axis.spec.js: re-run syncWorkerConfig() after ANY
// change to sources/rules, or the worker answers against stale config.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const sync = page => page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
const sourceCounts = page => page.evaluate(() => window.__grawlixTest.sourceCounts());
const mergedCount = page => page.evaluate(() => window.__grawlixTest.mergedEntryCount());
const workerMerged = async page => (await page.evaluate(() => window.__grawlixTest.dumpMainCorpus('__merged__'))).length;
const countsVersion = page => page.evaluate(() => window.__grawlixTest.shippedConfigCountsVersion());

// Overlapping sources so contribution counts differ from raw totals AND a
// priority winner is decided: Alpha > Bravo > Charlie. CRANE is in Alpha+Bravo
// (Alpha wins); EAGLE is in all three (Alpha wins). So Alpha wins all 3 of its
// entries, Bravo wins only BIRD+DELTA (2 of 3), Charlie only FROND+GULL (2 of 3).
async function seedCorpus(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ABLE', 'CRANE', 'EAGLE'], scores: [90, 80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['BIRD', 'CRANE', 'DELTA', 'EAGLE'], scores: [60, 55, 50, 45],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Charlie', entries: ['EAGLE', 'FROND', 'GULL'], scores: [30, 20, 10],
  }));
}

test('shipped sourceCounts + mergedCount equal the corpus computation', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);
  expect(await countsVersion(page)).toBeGreaterThan(-1);   // non-vacuous: the shipped path is live

  const shippedCounts = await sourceCounts(page);
  const shippedMerged = await mergedCount(page);
  expect(shippedMerged).toBe(await workerMerged(page));

  const byName = Object.fromEntries(shippedCounts.map(s => [s.name, s.count]));
  expect(byName.Alpha).toBe(3);     // wins all of ABLE/CRANE/EAGLE
  expect(byName.Bravo).toBe(2);     // wins BIRD/DELTA; loses CRANE/EAGLE
  expect(byName.Charlie).toBe(2);   // wins FROND/GULL; loses EAGLE
  expect(shippedMerged).toBe(7);    // 7 unique entries across the three sources
});

test('the displayed "X of Y entries" card text reflects the shipped counts', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const cardMetas = () => page.evaluate(() => {
    // Open the scope dropdown so the source cards render, then read their meta.
    document.querySelector('.wls-trigger').click();
    const out = {};
    for (const card of document.querySelectorAll('.wls-menu .wordlist-card')) {
      const name = card.querySelector('.card-name')?.textContent ?? '';
      out[name] = card.querySelector('.card-meta')?.textContent ?? '';
    }
    document.querySelector('.wls-trigger').click();   // close
    return out;
  });

  await sync(page);
  const text = await cardMetas();
  // "All Wordlists" total + each source's "X of Y used".
  expect(text['All Wordlists']).toBe('7 entries');
  expect(text.Alpha).toBe('3 entries used');     // all win
  expect(text.Bravo).toBe('2 of 4 entries used');
  expect(text.Charlie).toBe('2 of 3 entries used');
});

test('a sync while scoped to one source still ships the MERGED counts (ownedMerged feeds the summaries)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);
  const mergedCounts = await sourceCounts(page);
  const mergedTotal = await mergedCount(page);
  expect(mergedTotal).toBe(7);
  const mergedByName = Object.fromEntries(mergedCounts.map(s => [s.name, s.count]));
  expect(mergedByName.Alpha).toBe(3);
  expect(mergedByName.Bravo).toBe(2);
  expect(mergedByName.Charlie).toBe(2);

  // Scope to Alpha and re-sync: the worker now builds ownedCorpus = Alpha-only,
  // but the summaries must still come from ownedMerged. Non-vacuity hinges on the
  // scope actually moving off merged — otherwise this is a merged-vs-merged pass.
  await page.evaluate(() => window.__grawlixTest.setScope('Alpha'));
  expect(await page.evaluate(() => window.state.selected?.name ?? '__merged__')).toBe('Alpha');

  await sync(page);

  // Were the summaries tracking ownedCorpus, Alpha-alone would ship [{Alpha:3}] /
  // total 3; they must equal the merged baseline instead.
  expect(await mergedCount(page)).toBe(mergedTotal);
  expect(await sourceCounts(page)).toEqual(mergedCounts);
});

test('config-sensitivity: disabling a source updates the shipped counts after re-sync', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);

  const before = await sourceCounts(page);
  const beforeMerged = await mergedCount(page);
  const beforeVersion = await countsVersion(page);
  expect(beforeMerged).toBe(7);
  expect(before.find(s => s.name === 'Charlie').count).toBe(2);

  // Disable Charlie: its two unique winners (FROND, GULL) leave the merge, so the
  // merged total drops to 5. A disabled source contributes nothing to the merge,
  // so it drops out of sourceCounts entirely (both threads build it over the
  // enabled-only list) — Charlie is now absent, not present with count 0.
  await page.evaluate(() => {
    const wl = window.state.sources.find(s => s.name === 'Charlie');
    wl.enabled = false;
  });
  await page.evaluate(() => window.__grawlixTest.rebuildMergedCache());   // invalidate local cache
  await sync(page);

  const after = await sourceCounts(page);
  const afterMerged = await mergedCount(page);
  const afterVersion = await countsVersion(page);

  expect(afterVersion).toBeGreaterThan(beforeVersion);
  expect(afterMerged).toBe(5);
  expect(after.find(s => s.name === 'Charlie')).toBeUndefined();
});
