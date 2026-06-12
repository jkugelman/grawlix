const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Stage-1 de-risking smoke for the worker-data-tier rearchitecture: the worker
// loads+parses+rescores+merges its own corpus from IndexedDB (a "self-build"),
// driven by the test-only syncConfig/dumpCorpus messages. A later chunk turns
// this into the full frozen-fixture oracle (worker self-build == main's build).

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('worker self-builds a merged corpus from one seeded wordlist', async ({ page }) => {
  await gotoApp(page);

  const dbKey = await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Birds', scores: [50, 30, 80], entries: ['ABLE', 'BIRD', 'CRANE'],
  }));

  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  const dump = await page.evaluate(() => window.__grawlixTest.dumpWorkerCorpus('__merged__'));

  expect(dump.error).toBeFalsy();

  // Tuple shape [norm, display, score, rawScore, comment, sourceId] is the
  // oracle contract a later main-side dump must match exactly. rawScore stays
  // undefined (not null): no rescore fired (blank-output auto-seed passes
  // through), so the entry carries no rawScore field, and structuredClone over
  // postMessage preserves undefined array slots as undefined.
  const seeded = dump.entries.filter(([, , , , , id]) => id === dbKey);
  expect(seeded).toEqual([
    ['able',  'ABLE',  50, undefined, '', dbKey],
    ['bird',  'BIRD',  30, undefined, '', dbKey],
    ['crane', 'CRANE', 80, undefined, '', dbKey],
  ]);
});
