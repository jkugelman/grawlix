// Column cache — see docs/worker-protocol.md § Column cache; the code is
// engine/worker.js loadColumns. A warm boot must serve the same rows from the
// cols_ record a fresh parse would, and a changed text or rule set must never be
// served from a record or the previous build's columns.
//
// The record needs the bundle's parse build id, so these run against dist only.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp } from './helpers.js';

const colsState = page => page.evaluate(() => window.__grawlixTest.colsCacheState());
const merged = page => page.evaluate(() => window.__grawlixTest.dumpMergedCache().then(d => d.entries));

// The record write is idle-deferred; wait until nothing is queued.
async function flushWrites(page) {
  await expect.poll(async () => (await colsState(page)).pendingWrites, { timeout: 15000 }).toBe(0);
}

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
  await gotoApp(page);
  test.skip(!(await colsState(page)).enabled, 'unbundled site/ has no parse build id');
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Cached', entries: ['aardvark', 'bagel', 'carrot'], scores: [10, 50, 90],
  }));
  await flushWrites(page);
});

test('a warm reload serves the source from its record, identically', async ({ page }) => {
  const before = await merged(page);
  await reloadApp(page);
  const s = await colsState(page);
  expect(s.recordHits).toBeGreaterThan(0);
  expect(s.parsed).toBe(0);
  expect(await merged(page)).toEqual(before);
});

test('a rules-only change re-scores the cached columns', async ({ page }) => {
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Cached', [
    { query: 'score: 50', output: '40' },
  ]));
  await expect.poll(async () => (await merged(page)).find(e => e[0] === 'bagel')?.[2]).toBe(40);
  expect((await colsState(page)).rescored).toBeGreaterThan(0);
  await flushWrites(page);

  await reloadApp(page);
  expect((await merged(page)).find(e => e[0] === 'bagel')?.[2]).toBe(40);
  expect((await colsState(page)).parsed).toBe(0);
});

// reimport on an unchanged config takes applyFetched, which swaps the columns in
// place; the swap must re-hash and re-persist them, or every later boot re-parses.
test('a fetched update is served on reload from its new record, never the stale one', async ({ page }) => {
  await page.evaluate(() => window.__grawlixTest.reimport('Cached', 'aardvark;10\nzebra;70\n'));
  expect(await page.evaluate(() => window.__grawlixTest.lastFetchMode())).not.toBeNull();
  await flushWrites(page);
  await reloadApp(page);
  expect((await merged(page)).map(e => e[0]).sort()).toEqual(['aardvark', 'zebra']);
  const s = await colsState(page);
  expect(s.recordHits).toBeGreaterThan(0);
  expect(s.parsed).toBe(0);
});
