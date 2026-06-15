import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Worker-side `fetchRows` windowing mechanics: the worker retains the sorted flat
// result and serves a window of rich rows on demand (the row SHAPE — always rich,
// never index-only — is frozen by worker-rich-golden.spec.js; this pins the
// windowing: count, contiguity, clamp, and stale-runId drop). See
// docs/worker-protocol.md § fetchRows.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const ENTRIES = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE'];
const SCORES  = [50, 30, 80, 20, 60, 40, 70, 10];

async function seedAndRunFlat(page) {
  await page.evaluate(({ entries, scores }) => window.__grawlixTest.addCustomWordlist({
    name: 'Birds', scores, entries,
  }), { entries: ENTRIES, scores: SCORES });
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  // An empty search bar is the flat (filter-only) tier — the only tier the worker
  // retains for fetchRows; a transform/group would null lastFlatResult.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: '' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

test('fetchRows returns the whole flat result as rich rows in sorted order', async ({ page }) => {
  await gotoApp(page);
  await seedAndRunFlat(page);

  const wholeWindow = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 1000));
  expect(wholeWindow).not.toBeNull();
  expect(wholeWindow.rows.length).toBe(ENTRIES.length);
  expect(wholeWindow.start).toBe(0);
  for (const row of wholeWindow.rows) {
    expect('i' in row).toBe(false);          // never index-only post-flip
    expect(typeof row.norm).toBe('string');
    expect(Array.isArray(row.atoms)).toBe(true);
  }

  // norm-sorted: the entries arrive in localeCompare order.
  const norms = wholeWindow.rows.map(r => r.norm);
  expect(norms).toEqual([...norms].sort());
});

test('a sub-window is a contiguous slice of the full result', async ({ page }) => {
  await gotoApp(page);
  await seedAndRunFlat(page);

  const [prefix, full] = await page.evaluate(async () => {
    const a = await window.__grawlixTest.fetchWorkerRows(0, 5);
    const b = await window.__grawlixTest.fetchWorkerRows(0, 1000);
    return [a, b];
  });

  expect(prefix.rows.length).toBe(5);
  expect(prefix.rows.map(r => r.norm)).toEqual(full.rows.slice(0, 5).map(r => r.norm));

  const mid = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(3, 6));
  expect(mid.start).toBe(3);
  expect(mid.rows.map(r => r.norm)).toEqual(full.rows.slice(3, 6).map(r => r.norm));
});

test('a fetch past the end clamps to the result length', async ({ page }) => {
  await gotoApp(page);
  await seedAndRunFlat(page);

  const clamped = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 1e9));
  expect(clamped.rows.length).toBe(ENTRIES.length);

  const empty = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(1000, 2000));
  expect(empty.rows).toEqual([]);
});

test('a fetch for a stale runId is dropped (no reply)', async ({ page }) => {
  await gotoApp(page);
  await seedAndRunFlat(page);

  const stale = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 10, -999, 800));
  expect(stale).toBeNull();
});
