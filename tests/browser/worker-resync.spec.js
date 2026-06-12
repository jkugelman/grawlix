const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Mutations-collapse oracle (scope-aware-build feature): the worker's owned state
// stays fresh across config mutations WITHOUT any manual re-sync — main re-ships
// the config on every config change (the cacheVersion$ completeness hook; the
// post-IDB-write re-sync for importers / My Edits). syncWorkerConfig() is called
// exactly ONCE at the start; every assertion afterward drives a real mutation and
// proves the worker tracked it on its own.
//
// The import case is the payoff: the worker rebuilds ownedMerged from IDB text, so
// a re-sync that fired before the import's write (the premature cacheVersion$ hook)
// would read stale text. If supersession (latestSyncToken) or the post-write
// re-sync were wrong, the worker dump would still show the PRE-import entries.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const dumpWorker = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpWorkerCorpus(s), scope);
const dumpMain = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpMainCorpus(s), scope);
const axis = page => page.evaluate(() => window.__grawlixTest.allSourcesHistogramLayout());
const sourceCounts = page => page.evaluate(() => window.__grawlixTest.sourceCounts());
const mergedCount = page => page.evaluate(() => window.__grawlixTest.mergedEntryCount());
const settle = page => page.evaluate(() => window.__grawlixTest.pipelineIdle());

// The re-syncs are fire-and-forget, so poll until the worker's held ownedMerged
// matches the freshly-recomputed local merged corpus. Each caller separately
// asserts the mutation actually moved something, so this poll can't pass vacuously.
async function pollWorkerMergedMatchesMain(page) {
  await expect.poll(async () => {
    const worker = await dumpWorker(page, '__merged__');
    if (worker.error) return false;
    const main = await dumpMain(page, '__merged__');
    return JSON.stringify(worker.entries) === JSON.stringify(main);
  }, { timeout: 5000 }).toBe(true);
}

// Alpha > Bravo (addCustomWordlist appends). CRANE is in both → Alpha wins it.
async function seedCorpus(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', entries: ['ABLE', 'CRANE', 'EAGLE'], scores: [90, 80, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['BIRD', 'CRANE', 'DELTA'], scores: [60, 55, 50],
  }));
}

async function syncOnce(page) {
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());   // the ONLY manual sync
  await pollWorkerMergedMatchesMain(page);
}

test('a rescore-rule edit re-syncs the worker without a manual sync', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await syncOnce(page);

  const beforeAxis = await axis(page);
  expect(beforeAxis.max).toBe(90);
  const beforeMerged = await mergedCount(page);

  // Pull Alpha's 90 down to 30 — narrows the all-sources axis. The rule edit bumps
  // cacheVersion$, so the completeness hook must re-sync with no manual call.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Alpha', [
    { input: '90', length: '', output: '30', note: '' },
  ]));
  await settle(page);
  await pollWorkerMergedMatchesMain(page);

  // Non-vacuous: the shipped axis tracked the new config's max.
  await expect.poll(async () => (await axis(page)).max).toBeLessThan(90);
  expect((await axis(page)).max).not.toBe(beforeAxis.max);
  // Rule rescored only (no add/delete) → the merged total is unchanged; freshness
  // is proven by the entry-by-entry worker==main equality in the poll above.
  expect(await mergedCount(page)).toBe(beforeMerged);
});

test('an enable toggle re-syncs the worker without a manual sync', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await syncOnce(page);

  expect(await mergedCount(page)).toBe(5);                  // ABLE CRANE EAGLE BIRD DELTA
  const beforeCounts = await sourceCounts(page);
  expect(beforeCounts.find(s => s.name === 'Bravo').count).toBe(2);   // BIRD, DELTA

  // Disable Bravo through the real setter (bumps cacheVersion$ → the completeness
  // hook). Its two unique winners (BIRD, DELTA) leave the merge → 3.
  await page.evaluate(() => window.__grawlixTest.setEnabled('Bravo', false));
  await settle(page);
  await pollWorkerMergedMatchesMain(page);

  await expect.poll(() => mergedCount(page)).toBe(3);
  expect((await sourceCounts(page)).find(s => s.name === 'Bravo')).toBeUndefined();
});

test('a My Edits add re-syncs the worker merged corpus from fresh IDB', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await syncOnce(page);

  const beforeMerged = await mergedCount(page);
  const workerBefore = await dumpWorker(page, '__merged__');
  expect(workerBefore.entries.some(e => e[0] === 'ibis')).toBe(false);

  // saveMyEdit ships a `patch` (no cacheVersion$ bump) and fires persistEdits
  // un-awaited; persistEdits' post-write re-sync is My Edits' ONLY trigger, and
  // reads the fresh IDB the worker rebuilds from.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('IBIS', 'IBIS', 85, 'seabird'));
  await settle(page);
  await pollWorkerMergedMatchesMain(page);

  // Non-vacuous: the add reached the worker's merged corpus (absent before).
  const ibis = (await dumpWorker(page, '__merged__')).entries.find(e => e[0] === 'ibis');
  expect(ibis).toBeTruthy();
  expect(ibis[2]).toBe(85);                                // the edited score, from fresh IDB
  await expect.poll(() => mergedCount(page)).toBe(beforeMerged + 1);

  // A rich windowed fetch of the merged result also reflects the edit.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'IBIS' } }]));
  await settle(page);
  const win = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 50));
  const ibisRow = (win?.rows ?? []).find(r => r.norm === 'ibis');
  expect(ibisRow).toBeTruthy();
  expect(ibisRow.score).toBe(85);
});

test('an import of new text re-syncs the worker from FRESH IDB, not stale (the payoff)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await syncOnce(page);

  expect((await dumpWorker(page, '__merged__')).entries.some(e => e[0] === 'zebra')).toBe(false);

  // Re-import Alpha: ZEBRA replaces EAGLE. The completeness hook fires a re-sync
  // BEFORE the IDB write (stale text); the post-write re-sync fires after and
  // latestSyncToken supersedes the stale build. A stale-IDB rebuild would keep
  // EAGLE and lack ZEBRA — this is the assertion that catches it.
  await page.evaluate(() => window.__grawlixTest.reimport('Alpha', 'ABLE;90\nCRANE;80\nZEBRA;65'));
  await settle(page);
  await pollWorkerMergedMatchesMain(page);

  const after = (await dumpWorker(page, '__merged__')).entries;
  expect(after.some(e => e[0] === 'zebra')).toBe(true);    // imported text landed
  expect(after.some(e => e[0] === 'eagle')).toBe(false);   // pre-import entry gone
  expect(after.find(e => e[0] === 'zebra')[2]).toBe(65);
});
