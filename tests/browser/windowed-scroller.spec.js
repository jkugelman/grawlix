const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// Stage-2.1b: the flat-tier scroller's windowed render mode (flag-gated, default
// OFF). It serves the visible window from a cache populated by the worker's
// fetchRows, showing skeleton placeholders on a miss until the fetch lands. This
// is a feel-measurement prototype — main still holds the full corpus and
// deliberately round-trips to exercise the async scroll feel. See
// docs/worker-protocol.md § fetchRows + design.md.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// 300 entries named ENTRY000..ENTRY299, all distinct and already sorted by name —
// so the worker's empty-search result is in ENTRY000, ENTRY001, … order and a
// window at position p holds ENTRYp.
const COUNT = 300;

async function seedWindowedFlat(page) {
  await page.evaluate((count) => {
    const entries = [], scores = [];
    for (let i = 0; i < count; i++) {
      entries.push('ENTRY' + String(i).padStart(3, '0'));
      scores.push(10 + (i % 50));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Seq', entries, scores });
  }, COUNT);

  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: '' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

function visibleEntries(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

function skeletonCount(page) {
  return page.evaluate(() => document.querySelectorAll('#vs-host .entry-row.skeleton').length);
}

async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__grawlixTest.windowIdle());
  // The fetch reply re-renders; let that paint land before reading the DOM.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}


test('windowed mode fills the top window with real entries (no skeleton left)', async ({ page }) => {
  await gotoApp(page);
  await seedWindowedFlat(page);

  await settle(page);

  expect(await skeletonCount(page)).toBe(0);
  const rows = await visibleEntries(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]).toBe('ENTRY000');
  const expected = rows.map((_, i) => 'ENTRY' + String(i).padStart(3, '0'));
  expect(rows).toEqual(expected);
});

test('scrolling deep past the buffer fills the correct slice with no skeleton', async ({ page }) => {
  await gotoApp(page);
  await seedWindowedFlat(page);
  await settle(page);

  // Past VS_BUFFER (60) so the window misses the initial cache and re-fetches.
  await page.evaluate(() => window.scrollTo(0, 160 * 24));
  await settle(page);

  expect(await skeletonCount(page)).toBe(0);
  const rows = await visibleEntries(page);
  expect(rows.length).toBeGreaterThan(0);
  // rows[0] is the buffered start (VS_BUFFER above the first on-screen row), so it
  // trails the ~160-row scroll offset — still well clear of the top window.
  const first = parseInt(rows[0].slice('ENTRY'.length), 10);
  expect(first).toBeGreaterThan(40);
  const expected = rows.map((_, i) => 'ENTRY' + String(first + i).padStart(3, '0'));
  expect(rows).toEqual(expected);
});

test('a fast double-scroll settles on the final offset, not the abandoned one', async ({ page }) => {
  await gotoApp(page);
  await seedWindowedFlat(page);
  await settle(page);

  // Jump to A then immediately to B (both past the buffer, far apart). The fetch
  // for A is superseded by B's; the cache must end holding B's window, so the
  // final paint shows B's rows — never A's stale slice.
  await page.evaluate(() => {
    window.scrollTo(0, 80 * 24);
    window.dispatchEvent(new Event('scroll'));
    window.scrollTo(0, 220 * 24);
    window.dispatchEvent(new Event('scroll'));
  });
  await settle(page);

  expect(await skeletonCount(page)).toBe(0);
  const rows = await visibleEntries(page);
  const first = parseInt(rows[0].slice('ENTRY'.length), 10);
  // B's buffered window starts ~row 140; A's would be ~row 20. The gap is wide
  // enough that a stale A reply would unmistakably fail this.
  expect(first).toBeGreaterThan(100);
  const expected = rows.map((_, i) => 'ENTRY' + String(first + i).padStart(3, '0'));
  expect(rows).toEqual(expected);
});
