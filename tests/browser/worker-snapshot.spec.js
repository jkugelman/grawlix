const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo } = require('./helpers');

// B4a: the client must reship a `snapshot` whenever getActiveCorpus() changes.
// The oracle runs an identical flat stack on the worker and on main's active
// corpus; equal survivors mean the worker holds main's corpus, and a bumped
// snapshotId proves the reship fired.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Filters to a strict subset, so a stale worker corpus surfaces as a survivor
// mismatch rather than an accidental everything-matches pass.
const STACK = [{ tool: 'search', params: { pattern: '*A*' } }];

function mirror(page, stack = STACK) {
  return page.evaluate(s => window.__grawlixTest.workerMirrorsMain(s), stack);
}

test('worker corpus mirrors main across rebuild, My Edits patch, and scope switch', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', scores: [90, 80, 70], entries: ['CATALOG', 'BANANA', 'XYLEM'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta', scores: [60, 50], entries: ['ARIA', 'PLUM'],
  }));

  let r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.mainNorms.length).toBeGreaterThan(0);
  const afterSeed = r.snapshotId;
  expect(afterSeed).toBeGreaterThan(0);

  // Adding a wordlist returns a new merged object — the identity-change reship.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Gamma', scores: [40], entries: ['MARMALADE'],
  }));
  r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.workerNorms).toContain('marmalade');
  expect(r.snapshotId).toBeGreaterThan(afterSeed);
  const afterRebuild = r.snapshotId;

  // patchMergedForNorms splices the same object, so only the version bump can
  // trip the reship — the case the identity check alone misses.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('GRAPEFRUIT', 'GRAPEFRUIT', 30));
  r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.workerNorms).toContain('grapefruit');
  expect(r.snapshotId).toBeGreaterThan(afterRebuild);
  const afterPatch = r.snapshotId;

  await scopeTo(page, 'Alpha');
  r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.workerNorms.sort()).toEqual(['banana', 'catalog']);
  expect(r.snapshotId).toBeGreaterThan(afterPatch);
});

test('an unchanged corpus does not reship (no snapshot per re-render)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', scores: [90, 80], entries: ['CATALOG', 'BANANA'],
  }));

  const first = (await mirror(page)).snapshotId;
  const second = (await mirror(page)).snapshotId;
  expect(second).toBe(first);
});
