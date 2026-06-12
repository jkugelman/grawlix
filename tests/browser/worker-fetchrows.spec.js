const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Stage-2 (interim) worker-side `fetchRows`: the worker retains the sorted flat
// result and serves a window of corpus indices on demand. The main-side window
// cache is a later chunk; this exercises the worker half through the
// `fetchWorkerRows` test bridge. See docs/worker-protocol.md § fetchRows.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const ENTRIES = ['ABLE', 'BIRD', 'CRANE', 'DELTA', 'EAGLE', 'FROND', 'GRAPE', 'HOUSE'];
const SCORES  = [50, 30, 80, 20, 60, 40, 70, 10];

async function seedAndRunFlat(page) {
  await page.evaluate(({ entries, scores }) => window.__grawlixTest.addCustomWordlist({
    name: 'Birds', scores, entries,
  }), { entries: ENTRIES, scores: SCORES });

  // An empty search bar is the flat (filter-only) tier — the only tier the worker
  // retains for fetchRows; a transform/group would null lastFlatResult.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: '' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

test('fetchRows returns the flat result window as corpus indices', async ({ page }) => {
  await gotoApp(page);
  await seedAndRunFlat(page);

  const wholeWindow = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 1000));
  expect(wholeWindow).not.toBeNull();
  expect(wholeWindow.rows.length).toBe(ENTRIES.length);
  expect(wholeWindow.start).toBe(0);
  for (const row of wholeWindow.rows) expect(typeof row.i).toBe('number');

  const indices = wholeWindow.rows.map(r => r.i).sort((a, b) => a - b);
  expect(indices).toEqual([...ENTRIES.keys()]);
});

test('a sub-window is a contiguous prefix/slice of the full result', async ({ page }) => {
  await gotoApp(page);
  await seedAndRunFlat(page);

  const [prefix, full] = await page.evaluate(async () => {
    const a = await window.__grawlixTest.fetchWorkerRows(0, 5);
    const b = await window.__grawlixTest.fetchWorkerRows(0, 1000);
    return [a, b];
  });

  expect(prefix.rows.length).toBe(5);
  expect(prefix.rows.map(r => r.i)).toEqual(full.rows.slice(0, 5).map(r => r.i));

  const mid = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(3, 6));
  expect(mid.start).toBe(3);
  expect(mid.rows.map(r => r.i)).toEqual(full.rows.slice(3, 6).map(r => r.i));
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

  // Reach fetchWorkerRows via the bridge (not a /src/ import) with a stale runId:
  // source-path imports pass under site/ but fail the bundled dist matrix.
  const stale = await page.evaluate(() => window.__grawlixTest.fetchWorkerRows(0, 10, -999, 800));
  expect(stale).toBeNull();
});
