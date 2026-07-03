import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The prefix-state cache: a run resumes from the longest cached prefix and reruns only
// the suffix, so iterating on a pipeline (add / edit / remove / revert a tool, type in the
// search bar) reuses the untouched expensive work. It drops the moment the corpus changes
// under it. See docs/planned/result-cache-followons.md §2 (shipped) and docs/worker-protocol.md
// § prefixCache. The real recompute floor keeps it inert under these sub-ms queries, so each
// test drops it via configurePrefixCacheForTest({ minMs: 0 }). These tests exercise the real
// worker end-to-end (the executor-level byte-identity + tiling proofs are in the unit tier).

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

const enablePrefixCache = page =>
  page.evaluate(() => window.__grawlixTest.configurePrefixCacheForTest({ minMs: 0 }));

async function runStack(page, stack) {
  await page.evaluate(s => window.__grawlixTest.setStack(s), stack);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const prefixState = page => page.evaluate(() => window.__grawlixTest.prefixCacheState());

async function allRows(page) {
  const w = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 10000));
  return w.rows.map(r => [r.norm, r.score, r.comment || '']);
}

// The rows the app shows for `stack`, computed with the prefix cache off (huge floor →
// nothing seeds), for a byte-identity baseline. The 1e9 floor also clears the cache, so
// the caller re-enables it (which clears again) before running its workflow.
async function coldRows(page, stack) {
  await page.evaluate(() => window.__grawlixTest.configurePrefixCacheForTest({ minMs: 1e9 }));
  await runStack(page, stack);
  return allRows(page);
}

// Two user tools + the trailing search bar; F1b is an edit of F1.
const F0 = { tool: 'search', params: { pattern: '[aeiou]' } };
const F1 = { tool: 'search', params: { pattern: '[bcr]' } };
const FC = { tool: 'search', params: { pattern: '[dnl]' } };
const F1b = { tool: 'search', params: { pattern: '[gp]' } };
const BAR = { tool: 'search', params: { pattern: '[aeiou]' } };
const BAR2 = { tool: 'search', params: { pattern: '[aeiou r]' } };

test('workflow: one slow tool, add one on top — reuses the first (the reported regression)', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  const expected = await coldRows(page, [F0, F1, BAR]);
  await enablePrefixCache(page);

  await runStack(page, [F0, BAR]);           // [F0 | search] — caches [F0]
  await runStack(page, [F0, F1, BAR]);       // add F1 above the search bar
  expect((await prefixState(page)).seedFrom).toBe(1);   // reused [F0], did not rerun it
  expect(await allRows(page)).toEqual(expected);        // ... byte-identical to a cold run
});

test('workflow: build a stack incrementally — each added tool reuses the last', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  const expected = await coldRows(page, [F0, F1, FC, BAR]);
  await enablePrefixCache(page);

  await runStack(page, [F0, BAR]);
  await runStack(page, [F0, F1, BAR]);
  expect((await prefixState(page)).seedFrom).toBe(1);
  await runStack(page, [F0, F1, FC, BAR]);
  expect((await prefixState(page)).seedFrom).toBe(2);   // reused [F0, F1]
  expect(await allRows(page)).toEqual(expected);
});

test('workflow: editing a middle tool reuses the prefix above it', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  const expected = await coldRows(page, [F0, F1b, FC, BAR]);
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, FC, BAR]);   // caches [F0], [F0,F1], [F0,F1,FC]
  await runStack(page, [F0, F1b, FC, BAR]);  // edit the middle tool
  expect((await prefixState(page)).seedFrom).toBe(1);   // reused [F0]
  expect(await allRows(page)).toEqual(expected);
});

test('workflow: removing a tool reuses what remains', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  const expected = await coldRows(page, [F0, BAR]);
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, BAR]);       // caches [F0], [F0,F1]
  await runStack(page, [F0, BAR]);           // remove F1
  expect((await prefixState(page)).seedFrom).toBe(1);   // reused [F0]
  expect(await allRows(page)).toEqual(expected);
});

test('workflow: reverting an edit reuses the whole still-cached user stack', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  const expected = await coldRows(page, [F0, F1, BAR]);
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, BAR]);       // caches [F0], [F0,F1]
  await runStack(page, [F0, F1b, BAR]);      // edit F1 → F1b
  await runStack(page, [F0, F1, BAR]);       // revert — [F0,F1] is still cached
  expect((await prefixState(page)).seedFrom).toBe(2);   // reused the whole [F0, F1]
  expect(await allRows(page)).toEqual(expected);
});

test('workflow: typing in the search bar reuses the whole user stack', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);

  const expected = await coldRows(page, [F0, F1, BAR2]);
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, BAR]);       // caches [F0,F1] (the pre-search state)
  await runStack(page, [F0, F1, BAR2]);      // change only the trailing search row
  expect((await prefixState(page)).seedFrom).toBe(2);   // reran only the search row off [F0, F1]
  expect(await allRows(page)).toEqual(expected);
});

test('the recompute floor gates admission: a below-floor prefix is not cached', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  // No enablePrefixCache → the real ~1s floor stands, and these queries are sub-ms.
  await runStack(page, [F0, F1, BAR]);
  expect((await prefixState(page)).size).toBe(0);       // nothing cleared the floor
  // A later add-on-top therefore reruns from scratch (cold), by design.
  await runStack(page, [F0, F1, FC, BAR]);
  expect((await prefixState(page)).seedFrom).toBe(0);
});

test('a rescore rebuild invalidates prefix tiles — the edit serves fresh scores, never a stale seed', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, BAR]);
  expect((await prefixState(page)).size).toBeGreaterThanOrEqual(1);   // tiles held

  // Remap every raw score to 42 — a syncConfig rebuild that swaps the corpus object. A tile
  // bound to the OLD corpus fails cacheEntryValid's identity test and is dropped, so the run
  // below can only reflect the new corpus: all-42 is the proof a stale tile is never seeded.
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('Birds', [{ input: '0-1000', length: '', output: '42' }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await runStack(page, [F0, F1b, BAR]);
  const rows = await allRows(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every(([, score]) => score === 42)).toBe(true);
});

test('a merged prefix tile survives a scope detour and back', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, BAR]);       // merged tiles [F0], [F0,F1], bound to ownedMerged

  // Detour to a single-list scope (rebuilds ownedCorpus → purgeDiscardedCacheEntries) and
  // back. The merged tiles bind the stable ownedMerged, so the purge must KEEP them.
  await page.evaluate(() => window.__grawlixTest.setScope('Birds'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setScope('All Wordlists'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await runStack(page, [F0, F1, BAR]);       // back in merged — must reuse the surviving tile
  expect((await prefixState(page)).seedFrom).toBe(2);
});

test('a My Edits score edit keeps prefix tiles and reseeds the new score', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  // AERIE lives only in My Edits, so it is the merge winner and a score edit reshapes no
  // variant set → replaced===false → the tiles are KEPT (their chains hold AERIE's entry).
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('AERIE', 'AERIE', 50));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, BAR]);       // caches [F0], [F0,F1]; AERIE@50 lives in them
  expect((await allRows(page)).find(([n]) => n === 'aerie')[1]).toBe(50);

  // The in-place edit mutates AERIE's score under the kept tiles; saveMyEdit re-runs the
  // stack, which seeds the whole user stack and must ship the recomputed 90, not a stale 50.
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('AERIE', 'AERIE', 90));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect((await prefixState(page)).seedFrom).toBe(2);   // kept → the post-edit re-run reused [F0, F1]
  expect((await allRows(page)).find(([n]) => n === 'aerie')[1]).toBe(90);
});

test('a My Edits delete purges prefix tiles and drops the row', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('AERIE', 'AERIE', 50));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await enablePrefixCache(page);

  await runStack(page, [F0, F1, BAR]);
  expect((await allRows(page)).some(([n]) => n === 'aerie')).toBe(true);

  // A delete swaps row objects (replaced===true), which the corpus-object identity test can
  // NOT catch (same object, spliced in place) — so purgeCacheForCorpus drops the tiles. Miss
  // that and the re-run seeds a stale tile still holding AERIE's now-orphaned entry.
  await page.evaluate(() => window.__grawlixTest.deleteMyEdit('AERIE'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect((await prefixState(page)).seedFrom).toBe(0);   // tiles purged → the re-run was cold
  expect((await allRows(page)).some(([n]) => n === 'aerie')).toBe(false);
});

test('eviction holds the byte budget across many distinct prefixes', async ({ page }) => {
  await gotoApp(page);
  await seedBirds(page);
  // A budget below any single tile forces each new prefix to evict the resident one.
  await page.evaluate(() => window.__grawlixTest.configurePrefixCacheForTest({ minMs: 0, maxBytes: 1 }));

  for (const pattern of ['[abc]', '[def]', '[ghi]', '[rst]']) {
    await runStack(page, [{ tool: 'search', params: { pattern } }, F1, BAR]);
  }

  const state = await prefixState(page);
  expect(state.size).toBe(1);
  expect(state.bytes).toBeGreaterThan(0);
});
