import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The deferred-run queue's no-hang guarantee: post-flip a run whose owned corpus
// isn't yet fresh for its scope DEFERS (no snapshot to fall back on) and drains
// when the worker's selfReady lands. Every deferred promise MUST settle, or
// pipelineIdle wedges and the whole suite hangs. These specs pin the two paths a
// black-box test can drive: the normal boot drain, and the build-failure errored
// settle (the hang trap — built:false leaves the run undispatchable).

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('boot first-paint settles against the owned corpus, no hang', async ({ page }) => {
  // gotoApp awaits whenReady → Promise.all([firstPaint, syncWorkerConfig]).
  // syncConfig now posts before the boot parse, so the boot run either defers until
  // the worker's first selfReady and drains, or — if selfReady landed first —
  // dispatches immediately; both settle firstPaint. Reaching here proves it settled;
  // a hung deferred run would have timed out gotoApp.
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel', 'cake'], scores: [50, 60],
  }));

  // pipelineIdle resolves promptly (not wedged) and the flat tier ran against the
  // owned corpus — proof the deferred run dispatched, not stuck.
  await expect.poll(
    () => page.evaluate(async () => { await window.__grawlixTest.pipelineIdle(); return true; }),
    { timeout: 5000 }
  ).toBe(true);
  const dbg = await page.evaluate(() => window.__grawlixTest.windowedFlatDebug());
  expect(dbg.ranAgainstOwned).toBe(true);
});

test('the run queue self-heals after a forced build failure (errored settle, no hang)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel', 'cake'], scores: [50, 60],
  }));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  // Force the NEXT syncConfig build to fail, then drive a config change (a stack
  // run + re-sync). The re-sync clears the freshness mirror so the run defers; the
  // failing build's selfReady carries built:false → the client settles the deferred
  // run errored (settle path 4) rather than waiting forever. pipelineIdle resolving
  // within the bound is the no-hang assertion — a hung run would time out the poll.
  await page.evaluate(() => window.__grawlixTest.failNextWorkerBuildForTest());
  await page.evaluate(() => {
    window.__grawlixTest.syncWorkerConfig();
    window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'bag' } }]);
  });
  await expect.poll(
    () => page.evaluate(async () => { await window.__grawlixTest.pipelineIdle(); return true; }),
    { timeout: 5000 }
  ).toBe(true);

  // A fresh sync + run after the failure produces a live flat result again,
  // proving the errored settle didn't latch the queue.
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await expect.poll(
    () => page.evaluate(async () => { await window.__grawlixTest.pipelineIdle(); return true; }),
    { timeout: 5000 }
  ).toBe(true);
  const after = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(after).toContain('bagel');
});
