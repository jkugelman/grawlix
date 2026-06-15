const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// For a fresh flat run the worker ships a per-result existence boolean — does the
// run's literal query already exist in the active scope? The add-entry FAB seed
// reads it: open blank when the query exists, pre-fill it when it doesn't. The
// worker uses the same toNorm + byNorm the corpus build produces.
//
// Non-vacuity hinges on the shipped boolean being real (not null): without it a
// regression that silently stopped shipping the field would still pass.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const sync = page => page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
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

async function fabSeed(page) {
  await page.locator('#add-fab').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  const seed = await page.locator('#atom-pop-entry').inputValue();
  await page.keyboard.press('Escape');
  await expect(page.locator('#atom-popover')).toBeHidden();
  return seed;
}

test('worker-shipped existsInScope drives the add-FAB seed', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);

  // The space is load-bearing: 'CRANE FLY' norms to the entry 'cranefly' (EXISTS)
  // yet the literal-space search matches no row, hitting the empty view. A spaceless
  // 'CRANEFLY' would match the row and never test existence — green but vacuous.
  await runSearch(page, 'CRANE FLY');
  expect(await shippedExistsInScope(page)).toBe(true);   // non-vacuous: the worker answered
  expect(await fabSeed(page)).toBe('');                   // exists → FAB opens blank

  await runSearch(page, 'ZZZ QQQ');                       // norms to a non-entry → does NOT exist
  expect(await shippedExistsInScope(page)).toBe(false);
  expect(await fabSeed(page)).toBe('ZZZ QQQ');            // absent → FAB seeds the query
});
