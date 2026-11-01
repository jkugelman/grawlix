// Config-build supersession — see docs/worker-protocol.md § Cancellation /
// supersession; the code is engine/worker.js buildLatestConfig. Edits, deletes,
// fetches and disk merges bump the sync token so an in-flight build that read
// pre-change IDB text can't commit. That build must retry, not vanish: the edit
// handler otherwise rebuilds from the previous config, and the corpus silently
// keeps the old enabled flags and rules until some later resync.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

const mergedNorms = page => page.evaluate(() =>
  window.__grawlixTest.dumpMergedCache().then(d => d.entries.map(e => e[0]).sort()));

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('a delete that lands mid-build makes the config build retry, not drop', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(async () => {
    await window.__grawlixTest.addCustomWordlist({ name: 'Src', entries: ['bagel', 'lox'], scores: [50, 60] });
    await window.__grawlixTest.addCustomWordlist({ name: 'Other', entries: ['zebra'], scores: [70] });
  });
  expect(await mergedNorms(page)).toEqual(['bagel', 'lox', 'zebra']);

  // Disabling Src posts a syncConfig whose build the stall holds; the delete then
  // supersedes it before it reads any text.
  await page.evaluate(() => {
    window.__grawlixTest.stallNextWorkerBuildForTest();
    void window.__grawlixTest.setEnabled('Src', false);
  });
  await page.evaluate(() => window.__grawlixTest.sendWorkerDeleteEntry({ norm: 'nosuchentry', display: null }));
  await page.evaluate(() => window.__grawlixTest.releaseWorkerBuildForTest());

  await expect.poll(() => mergedNorms(page)).toEqual(['zebra']);
});
