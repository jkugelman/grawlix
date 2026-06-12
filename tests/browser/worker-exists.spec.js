const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Stage-3 (ch7a) oracle: for a fresh flat run the worker ships per-result
// existence booleans — does the run's literal query already exist? `existsInMerge`
// answers it against the All Wordlists merge (the empty-state "this word exists /
// Add it" message reads it); `existsInScope` answers it against the active scope
// (the add-entry FAB seed reads it). The worker uses the same toNorm + byNorm the
// corpus build produces.
//
// Non-vacuity hinges on the shipped booleans being real (not null): without it a
// regression that silently stopped shipping the field would still pass.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const sync = page => page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
const shippedExistsInMerge = page =>
  page.evaluate(() => window.__grawlixTest.existsInMergeDebug().existsInMerge);
const shippedExistsInScope = page =>
  page.evaluate(() => window.__grawlixTest.existsInScopeDebug().existsInScope);

async function seedCorpus(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha',
    entries: ['CRANEFLY', 'EAGLE', 'GRAPE'],
    scores: [90, 70, 60],
  }));
}

async function runSearch(page, pattern) {
  await page.evaluate(p => window.__grawlixTest.setStack(
    [{ tool: 'search', params: { pattern: p } }]), pattern);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function captureDecision(page) {
  const empty = await page.evaluate(() => ({
    hasAddBtn: !!document.querySelector('.entries-empty-add'),
    hasExistsLink: !!document.querySelector('.entries-empty-link'),
  }));

  await page.locator('#add-fab').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  const fabSeed = await page.locator('#atom-pop-entry').inputValue();
  await page.keyboard.press('Escape');
  await expect(page.locator('#atom-popover')).toBeHidden();

  return { ...empty, fabSeed };
}

test('worker-shipped existsInMerge drives the empty-state; existsInScope drives the FAB seed', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);

  // The space is load-bearing: 'CRANE FLY' norms to the entry 'cranefly' (EXISTS)
  // yet the literal-space search matches no row, hitting the empty state. A spaceless
  // 'CRANEFLY' would match the row and never test existence — green but vacuous.
  await runSearch(page, 'CRANE FLY');
  // The empty-state reads existsInMerge; the FAB seed reads existsInScope. The
  // default scope is All Wordlists, so both answer true here.
  expect(await shippedExistsInMerge(page)).toBe(true);   // non-vacuous: the worker answered
  expect(await shippedExistsInScope(page)).toBe(true);
  const present = await captureDecision(page);
  expect(present.hasExistsLink).toBe(true);
  expect(present.hasAddBtn).toBe(false);
  expect(present.fabSeed).toBe('');

  await runSearch(page, 'ZZZ QQQ');                  // norms to a non-entry → does NOT exist
  expect(await shippedExistsInMerge(page)).toBe(false);
  expect(await shippedExistsInScope(page)).toBe(false);
  const absent = await captureDecision(page);
  expect(absent.hasAddBtn).toBe(true);
  expect(absent.hasExistsLink).toBe(false);
  expect(absent.fabSeed).toBe('ZZZ QQQ');
});
