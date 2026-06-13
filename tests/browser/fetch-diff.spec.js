const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Fetch content-diff oracle: a re-fetch/re-import of an already-populated source
// posts the in-place `applyFetched` command instead of a full resyncWorkerConfig.
// The worker diffs the new text against its resident copy and either splices only
// the changed norms or rebuilds wholesale once the ADD/DELETE count crosses the
// absolute cap (rescores never count — they splice in place). Either way the merged
// corpus must be byte-identical to main's independent build; `syncConfigsSent`
// proves main never fell back to a resync, and `lastFetchMode` pins which path ran.

const MERGED = '__merged__';

const dumpWorker = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpWorkerCorpus(s), scope);
const dumpMain = (page, scope) =>
  page.evaluate(s => window.__grawlixTest.dumpMainCorpus(s), scope);
const syncsSent = page => page.evaluate(() => window.__grawlixTest.syncConfigsSent());
const fetchMode = page => page.evaluate(() => window.__grawlixTest.lastFetchMode());
const settle = page => page.evaluate(() => window.__grawlixTest.pipelineIdle());

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Alpha (10 entries) > Bravo (3); CRANE is in both → Alpha wins it.
async function seed(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha',
    entries: ['ABLE', 'BIRD', 'CRANE', 'DRAKE', 'EAGLE', 'FINCH', 'GULL', 'HERON', 'IBIS', 'JAY'],
    scores: [90, 85, 80, 75, 70, 65, 60, 55, 50, 45],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo', entries: ['CRANE', 'KITE', 'LARK'], scores: [40, 35, 30],
  }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await settle(page);
}

test('a small content-diff splices in place — no resync, corpus matches the rebuild', async ({ page }) => {
  await gotoApp(page);
  await seed(page);

  const pre = (await dumpWorker(page, MERGED)).entries;
  const before = await syncsSent(page);

  // EAGLE 70→20 (rescore — 0 structural), JAY removed, MARTIN added → 2 structural,
  // well under the cap, so the worker takes the per-norm splice path.
  await page.evaluate(() => window.__grawlixTest.reimport('Alpha',
    'ABLE;90\nBIRD;85\nCRANE;80\nDRAKE;75\nEAGLE;20\nFINCH;65\nGULL;60\nHERON;55\nIBIS;50\nMARTIN;42'));
  await settle(page);

  expect(await fetchMode(page)).toBe('splice');
  expect(await syncsSent(page)).toBe(before);                 // main used applyFetched, not a resync

  const workerPost = (await dumpWorker(page, MERGED)).entries;
  expect(workerPost).toEqual(await dumpMain(page, MERGED));   // splice == independent rebuild
  expect(workerPost).not.toEqual(pre);                        // non-vacuous

  expect(workerPost.find(e => e[0] === 'eagle')[2]).toBe(20); // rescored
  expect(workerPost.some(e => e[0] === 'jay')).toBe(false);   // removed
  expect(workerPost.find(e => e[0] === 'martin')[2]).toBe(42);// added
});

test('a rescore-heavy update stays on the splice path — rescores do not count toward the cap', async ({ page }) => {
  await gotoApp(page);
  await seed(page);

  const before = await syncsSent(page);

  // Every one of Alpha's ten scores changes but no entry is added or removed — zero
  // structural changes, so it splices in place no matter how many rescore.
  await page.evaluate(() => window.__grawlixTest.reimport('Alpha',
    'ABLE;1\nBIRD;2\nCRANE;3\nDRAKE;4\nEAGLE;5\nFINCH;6\nGULL;7\nHERON;8\nIBIS;9\nJAY;10'));
  await settle(page);

  expect(await fetchMode(page)).toBe('splice');
  expect(await syncsSent(page)).toBe(before);
  expect((await dumpWorker(page, MERGED)).entries).toEqual(await dumpMain(page, MERGED));
  // CRANE is Alpha's 3, not Bravo's 40 — the merge picks by priority, not score.
  expect((await dumpWorker(page, MERGED)).entries.find(e => e[0] === 'crane')[2]).toBe(3);
});

test('a structural change past the cap rebuilds wholesale — still applyFetched, still correct', async ({ page }) => {
  await gotoApp(page);
  // A >256-entry source so a full-replacement diff crosses the absolute add/delete cap.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Big',
    entries: Array.from({ length: 300 }, (_, i) => `OLD${i}`),
    scores: Array.from({ length: 300 }, () => 50),
  }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await settle(page);

  const before = await syncsSent(page);

  // Replace all 300 entries → 300 deletes + 300 adds, over the cap, so the worker
  // rebuilds wholesale rather than running a per-norm splice batch.
  await page.evaluate(() => window.__grawlixTest.reimport('Big',
    Array.from({ length: 300 }, (_, i) => `NEW${i};50`).join('\n')));
  await settle(page);

  expect(await fetchMode(page)).toBe('rebuild');
  expect(await syncsSent(page)).toBe(before);                 // main still used applyFetched
  const worker = (await dumpWorker(page, MERGED)).entries;
  expect(worker).toEqual(await dumpMain(page, MERGED));        // rebuild == independent build
  expect(worker.some(e => e[0] === 'new0')).toBe(true);
  expect(worker.some(e => e[0] === 'old0')).toBe(false);
});

test('after a content-diff an immediate run serves FRESH rich rows (no resync needed)', async ({ page }) => {
  await gotoApp(page);
  await seed(page);

  await page.evaluate(() => window.__grawlixTest.reimport('Alpha',
    'ABLE;90\nBIRD;85\nCRANE;80\nDRAKE;75\nEAGLE;20\nFINCH;65\nGULL;60\nHERON;55\nIBIS;50\nMARTIN;42'));
  await settle(page);

  // A flat search right after the splice must serve rich rows reflecting the diff —
  // proving applyFetched left ownedCorpusFresh true rather than needing a resync.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'EAGLE' } }]));
  await settle(page);

  const win = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 50));
  const eagle = (win?.rows ?? []).find(r => r.norm === 'eagle');
  expect(eagle).toBeTruthy();
  expect(eagle.score).toBe(20);
  expect('i' in eagle).toBe(false);          // rich row, not an index-only fallback
  expect(eagle).toHaveProperty('sourceId');
});
