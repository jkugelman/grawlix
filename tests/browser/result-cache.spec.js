import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The cross-run result cache: a finished join retained across runs so re-entering an
// identical (stack, scope) against an unchanged corpus serves instantly instead of
// re-joining, and drops the moment the corpus changes under it. See
// docs/design.md § Streaming results and docs/worker-protocol.md § resultCache. The real
// RESULT_CACHE_MIN_MS floor keeps the cache inert under these sub-second queries, so every
// test that wants a hit first drops the floor via configureResultCacheForTest({ minMs: 0 }).

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const ENTRIES = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE'];
const SCORES  = [50, 30, 80, 20, 60, 40, 70, 10];

async function seedBirds(page) {
  await page.evaluate(({ entries, scores }) => window.__grawlixTest.addCustomWordlist({
    name: 'Birds', scores, entries,
  }), { entries: ENTRIES, scores: SCORES });
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

const enableCache = page =>
  page.evaluate(() => window.__grawlixTest.configureResultCacheForTest({ minMs: 0 }));

async function runStack(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const runSearch = (page, pattern) => runStack(page, [{ tool: 'search', params: { pattern } }]);

const cacheState = page => page.evaluate(() => window.__grawlixTest.resultCacheState());

async function allRows(page) {
  const w = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 10000));
  return w.rows.map(r => [r.norm, r.score, r.comment || '']);
}

test('a re-run of an identical stack serves from cache, byte-identical to a fresh run', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  await enableCache(page);

  await runSearch(page, '[aeiou]');
  const fresh = await allRows(page);
  const afterFirst = await cacheState(page);
  expect(afterFirst.size).toBe(1);
  expect(afterFirst.hits).toBe(0);
  expect(afterFirst.misses).toBe(1);

  // A different stack in between, then the original again → the original hits.
  await runSearch(page, '[bcd]');
  await runSearch(page, '[aeiou]');

  const served = await allRows(page);
  const afterHit = await cacheState(page);
  expect(afterHit.hits).toBe(1);
  expect(served).toEqual(fresh);   // a hit equals a fresh run, row-for-row
});

test('the recompute-time floor gates admission: nothing is cached below it', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  // No configure → the real floor stands, so a sub-second run probes (a miss) but
  // is never admitted.
  await runSearch(page, '[aeiou]');
  expect((await cacheState(page)).size).toBe(0);   // floored out

  await enableCache(page);
  await runSearch(page, '[aeiou]');
  const floored = await cacheState(page);
  expect(floored.size).toBe(1);
});

test('a result a prefix tile makes cheap to reproduce is not stored redundantly', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  await page.evaluate(() => {
    window.__grawlixTest.configurePrefixCacheForTest({ minMs: 0 });     // tile every producer boundary
    window.__grawlixTest.configureResultCacheForTest({ minMs: 100 });   // above the finished result's cheap tail
  });

  await runStack(page, [
    { tool: 'search', params: { pattern: '[aeiou]' } },
    { tool: 'search', params: { pattern: '[bcr]' } },
    { tool: 'search', params: { pattern: '' } },
  ]);

  const prefix = await page.evaluate(() => window.__grawlixTest.prefixCacheState());
  expect(prefix.size).toBeGreaterThanOrEqual(1);   // the prefix boundary is kept
  expect((await cacheState(page)).size).toBe(0);   // ... the derivable finished result is not
});

test('a rescore-rule edit invalidates the entry — the re-run misses and serves fresh scores', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  await enableCache(page);

  await runSearch(page, '[aeiou]');   // cache the pre-rescore entry
  const before = await allRows(page);
  expect(before.some(([, score]) => score !== 42)).toBe(true);   // not already all-42

  // Remap every raw score to 42 — a rebuild (syncConfig), so the retained entry must
  // miss and re-derive. The re-run below is exactly where a broken invalidation would
  // serve the stale pre-rescore scores instead.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Birds', [{ input: '0-1000', length: '', output: '42' }]));
  await runSearch(page, '[aeiou]');

  const after = await allRows(page);
  expect(after.every(([, score]) => score === 42)).toBe(true);   // fresh scores, not the stale pre-rescore ones
});

test('a My Edits score edit keeps the entry and recomputes the new score on the next hit', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  // ZEBRA lives only in My Edits, so it is the merge winner and a score edit reshapes
  // no variant set → replaced===false → the entry is KEPT.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ZEBRA', 'ZEBRA', 50));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await enableCache(page);

  await runSearch(page, '[aeiou]');
  const s0 = await cacheState(page);
  expect((await allRows(page)).find(([norm]) => norm === 'zebra')[1]).toBe(50);

  // saveMyEdit re-runs the current stack after the in-place splice; a kept entry makes
  // that re-run a hit, and the hit must recompute ZEBRA's shipped score to 90.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ZEBRA', 'ZEBRA', 90));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const s1 = await cacheState(page);
  expect(s1.hits).toBe(s0.hits + 1);   // kept → the post-edit re-run hit
  expect((await allRows(page)).find(([norm]) => norm === 'zebra')[1]).toBe(90);   // recomputed, not the stored 50
});

test('a My Edits delete purges the entry — the re-run misses and drops the deleted row', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ZEBRA', 'ZEBRA', 50));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await enableCache(page);

  await runSearch(page, '[aeiou]');
  expect((await allRows(page)).some(([norm]) => norm === 'zebra')).toBe(true);
  const s0 = await cacheState(page);

  // A delete swaps row objects (replaced===true), which the identity test can't catch,
  // so the entry is purged explicitly; the re-run must miss and lose ZEBRA.
  await page.evaluate(() => window.__grawlixTest.deleteMyEdit('ZEBRA'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const s1 = await cacheState(page);
  expect(s1.hits).toBe(s0.hits);   // purged, not a stale hit
  expect((await allRows(page)).some(([norm]) => norm === 'zebra')).toBe(false);
});

test('eviction holds the byte budget across many distinct queries', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  // A budget below any single join forces every insert to evict the resident one, so
  // the cache never holds more than the one most-recent entry.
  await page.evaluate(() => window.__grawlixTest.configureResultCacheForTest({ minMs: 0, maxBytes: 1 }));

  for (const pattern of ['[aeiou]', '[bcd]', '[frg]', '[hlt]']) await runSearch(page, pattern);

  const state = await cacheState(page);
  expect(state.size).toBe(1);
  expect(state.bytes).toBeGreaterThan(0);   // sanity: a real join was measured, budget held to one entry
});

test('the per-entry byte ceiling refuses a join too large to hold', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  // A one-byte ceiling is below any real join, so nothing admits however cheap it was.
  await page.evaluate(() => window.__grawlixTest.configureResultCacheForTest({ minMs: 0, maxEntryBytes: 1 }));

  await runSearch(page, '[aeiou]');
  expect((await cacheState(page)).size).toBe(0);
});

test('a merged entry survives a scope detour and back', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  await enableCache(page);

  await runSearch(page, '[aeiou]');
  const s0 = await cacheState(page);

  // Detour to the single-list scope and back. setScope rebuilds only ownedCorpus;
  // ownedMerged is stable, so the merged entry's bound corpus stays identical.
  await page.evaluate(() => window.__grawlixTest.setScope('Birds'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setScope('All Wordlists'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  // Returning to merged re-runs the stack, which must hit the still-resident entry.
  const s1 = await cacheState(page);
  expect(s1.hits).toBeGreaterThan(s0.hits);   // the merged entry survived the detour
});
