const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Stage-1 oracle for the worker-data-tier rearchitecture: the worker's
// independent corpus build (load+parse+rescore+merge from IndexedDB) must
// deep-equal the main thread's build of the same scope. dumpWorkerCorpus and
// dumpMainCorpus emit the same [norm, display, score, rawScore, comment,
// sourceId] tuples, so toEqual is the equivalence proof.
//
// Sequencing footgun: the worker's config is stale until re-synced. After ANY
// change to sources/enabled/rescoreRules — or to My Edits entries in IDB —
// re-run syncWorkerConfig() before dumping, or the worker answers against the
// previous config and the comparison diverges spuriously.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const dumpWorker = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpWorkerCorpus(s), scope);
const dumpMain = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpMainCorpus(s), scope);

async function expectWorkerMatchesMain(page, scope) {
  const worker = await dumpWorker(page, scope);
  expect(worker.error).toBeFalsy();
  const main = await dumpMain(page, scope);
  expect(worker.entries).toEqual(main);
}

test('multi-source priority merge agrees across threads (merged + each scope)', async ({ page }) => {
  await gotoApp(page);

  // addCustomWordlist appends, so priority is Alpha > Bravo > Charlie. Alpha and
  // Bravo share CRANE; all three share EAGLE — priority decides each winner.
  const alpha = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ABLE', 'CRANE', 'EAGLE'], scores: [90, 80, 70],
  }));
  const bravo = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['BIRD', 'CRANE', 'EAGLE'], scores: [60, 50, 40],
    comments: ['', 'corvid', ''],
  }));
  const charlie = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Charlie', entries: ['DELTA', 'EAGLE', 'FROND'], scores: [30, 20, 10],
  }));

  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  await expectWorkerMatchesMain(page, '__merged__');
  await expectWorkerMatchesMain(page, alpha);
  await expectWorkerMatchesMain(page, bravo);
  await expectWorkerMatchesMain(page, charlie);
});

test('rescore rules feed the merge identically once the worker is re-synced', async ({ page }) => {
  await gotoApp(page);

  // 350 → 80 (rawScore preserves 350 both sides); 40 passes through untouched
  // (rawScore undefined). Shore shares OCEAN at lower priority, so the rescored
  // winner is exercised through the merge, not only the scoped build.
  const tides = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Tides', entries: ['OCEAN', 'TIDE', 'WAVE'], scores: [350, 40, 350],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Shore', entries: ['OCEAN', 'SAND'], scores: [55, 45],
  }));

  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Tides', [
    { input: '350', length: '', output: '80', note: '' },
  ]));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  await expectWorkerMatchesMain(page, '__merged__');
  await expectWorkerMatchesMain(page, tides);
});

test('My Edits participates in the merge identically across threads', async ({ page }) => {
  await gotoApp(page);

  const birds = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Birds', entries: ['GULL', 'HAWK'], scores: [50, 60],
  }));

  // flushEditsToIdb awaits the write saveEdit only fires-and-forgets, so the
  // worker reads the seeded entries rather than racing a pending write.
  await page.evaluate(() => {
    window.__grawlixTest.saveMyEdit('GULL', 'GULL', 95, 'seabird');
    window.__grawlixTest.saveMyEdit('IBIS', 'IBIS', 85, '');
  });
  const editsKey = await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());

  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  await expectWorkerMatchesMain(page, '__merged__');
  await expectWorkerMatchesMain(page, birds);
  await expectWorkerMatchesMain(page, editsKey);
});

test('a single scoped dump deep-equals a frozen golden', async ({ page }) => {
  await gotoApp(page);

  // All-uppercase short list: detectCase falls back to 'lower' below its
  // 1000-entry threshold, so entries read as off-convention and keep verbatim
  // uppercase display (NOT null) while norm lowercases. The 50 → 75 rule leaves
  // DELTA/EAGLE with rawScore 50; CRANE (90, unmatched) keeps rawScore undefined.
  const key = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Golden', entries: ['CRANE', 'DELTA', 'EAGLE'], scores: [90, 50, 50],
    comments: ['corvid', '', 'raptor'],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Golden', [
    { input: '50', length: '', output: '75', note: '' },
  ]));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  const worker = await dumpWorker(page, key);
  expect(worker.error).toBeFalsy();
  expect(worker.entries).toEqual([
    ['crane', 'CRANE', 90, undefined, 'corvid', key],
    ['delta', 'DELTA', 75, 50,        '',       key],
    ['eagle', 'EAGLE', 75, 50,        'raptor', key],
  ]);

  await expectWorkerMatchesMain(page, key);
});
