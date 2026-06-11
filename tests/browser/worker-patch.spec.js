const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo } = require('./helpers');

// C1: a My Edits add/edit ships the worker a small `patch` (touched norms only)
// rather than re-packing the whole corpus. The oracle proves both that the patch
// lands (survivors still mirror main) AND that it WAS a patch, not a reship
// (patchesSent up, snapshotsSent flat).

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Filters to a strict subset so a stale worker corpus surfaces as a survivor
// mismatch rather than an everything-matches false pass.
const STACK = [{ tool: 'search', params: { pattern: '*A*' } }];

function mirror(page, stack = STACK) {
  return page.evaluate(s => window.__grawlixTest.workerMirrorsMain(s), stack);
}
function counters(page) {
  return page.evaluate(() => {
    const s = window.__grawlixTest.pipelineWorkerState();
    return { snapshotsSent: s.snapshotsSent, patchesSent: s.patchesSent };
  });
}

test('a My Edits add/edit patches the worker corpus without reshipping', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', scores: [90, 80, 70], entries: ['CATALOG', 'BANANA', 'XYLEM'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta', scores: [60, 50], entries: ['ARIA', 'PLUM'],
  }));

  // Seed the worker with the merged corpus so the patches below have a base.
  let r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.mainNorms.length).toBeGreaterThan(0);

  // Add a brand-new norm — exercises the count change (0 → 1) that shifts every
  // later index, so the worker must rebuild its index map, not patch it in place.
  let before = await counters(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('GRAPEFRUIT', 'GRAPEFRUIT', 30));
  r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.workerNorms).toContain('grapefruit');
  let after = await counters(page);
  expect(after.patchesSent).toBe(before.patchesSent + 1);
  expect(after.snapshotsSent).toBe(before.snapshotsSent);

  // Edit an existing entry's score (no count change).
  before = await counters(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('CATALOG', 'CATALOG', 12));
  r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.workerNorms).toContain('catalog');
  after = await counters(page);
  expect(after.patchesSent).toBe(before.patchesSent + 1);
  expect(after.snapshotsSent).toBe(before.snapshotsSent);
});

// When the worker holds a SCOPED corpus (not the merged object the patch
// describes), sendPatch must skip rather than mirror the wrong corpus — and the
// next merged run's ensureSnapshot reships, restoring the mirror. Covers a delete
// (a count-shrinking My Edits change) end-to-end through deleteFromEdits.
test('a My Edits delete while scoped away skips the patch, then reships on return', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', scores: [90, 80], entries: ['CATALOG', 'BANANA'],
  }));

  await page.evaluate(() => window.__grawlixTest.saveMyEdit('GRAPEFRUIT', 'GRAPEFRUIT', 30));
  let r = await mirror(page);
  expect(r.workerNorms).toContain('grapefruit');

  // Scope to My Edits: the next run ships the SCOPED corpus, so the worker no
  // longer holds the merged object.
  await scopeTo(page, 'My Edits');
  await mirror(page);

  const before = await counters(page);
  await page.evaluate(() => window.__grawlixTest.deleteMyEdit('GRAPEFRUIT'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const after = await counters(page);
  // The merged patch is skipped — the worker isn't holding the merged object.
  // (The scoped run may reship its own rebuilt scoped corpus; that's separate.)
  expect(after.patchesSent).toBe(before.patchesSent);

  // Back to merged: ensureSnapshot reships, and the worker mirrors the post-delete
  // corpus (grapefruit gone).
  await scopeTo(page, 'All Wordlists');
  r = await mirror(page);
  expect(r.workerNorms.sort()).toEqual(r.mainNorms.sort());
  expect(r.workerNorms).not.toContain('grapefruit');
});

// Part A: after a patch, main's byNorm for a case-variant norm must equal the row
// a full buildByNorm rebuild picks (code-unit-min), so main's patched byNorm and
// the worker's reindex can't disagree.
test('a patch on a case-variant norm keeps byNorm at the code-unit-min row', async ({ page }) => {
  await gotoApp(page);

  // Two sources contribute norm 'cat' under different-case displays, so its merged
  // bucket holds both 'CAT' and 'Cat' — the case landmine the rule must survive.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Upper', scores: [90], entries: ['CAT'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Title', scores: [80], entries: ['Cat'],
  }));
  await mirror(page);

  await page.evaluate(() => window.__grawlixTest.saveMyEdit('cat', 'cat', 5));

  const agree = await page.evaluate(() => window.__grawlixTest.byNormMatchesRebuild('cat'));
  expect(agree.same).toBe(true);
  expect(agree.patchedDisplay).toBe(agree.rebuiltDisplay);
});
