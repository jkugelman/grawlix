import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The windowed flat scroller (flag-gated, default OFF) caches position→corpus-index
// rows fetched from the worker. Without eviction that cache grows unbounded as you
// scroll a large result — a main-thread leak that partly defeats windowing. This
// spec scrolls a LARGE result end to end and asserts the cache stays bounded while
// every visible window still renders correctly. See entries-table.js _evictWinCache.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// 3000 entries ENTRY0000..ENTRY2999, distinct and pre-sorted by name, so the
// worker's empty-search result is in order and position p holds ENTRYp.
const COUNT = 3000;

async function seedWindowedFlat(page) {
  await page.evaluate((count) => {
    const entries = [], scores = [];
    for (let i = 0; i < count; i++) {
      entries.push('ENTRY' + String(i).padStart(4, '0'));
      scores.push(10 + (i % 50));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
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

function winCacheSize(page) {
  return page.evaluate(() => window.__grawlixTest.windowedFlatDebug().winCacheSize);
}

async function settle(page) {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => window.__grawlixTest.windowIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function scrollTo(page, rowPos) {
  await page.evaluate((y) => {
    window.scrollTo(0, y);
    window.dispatchEvent(new Event('scroll'));
  }, rowPos * 24);
}

// At a settled window: no skeleton lingers, rows are non-empty, and the visible
// slice is the contiguous ENTRY run starting at whatever its first row is.
async function expectCorrectWindow(page) {
  expect(await skeletonCount(page)).toBe(0);
  const rows = await visibleEntries(page);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(typeof r).toBe('string');
  // Read the prefix and digit count off the first rendered row: at 3000 all-caps
  // entries the display heuristic lowercases the corpus, so the rendered prefix is
  // 'entry', not 'ENTRY'. Numeric suffix is what we assert ordering on.
  const m = rows[0].match(/^([a-z]+)(\d+)$/i);
  expect(m).not.toBeNull();
  const [, prefix, digits] = m;
  const first = parseInt(digits, 10);
  const expected = rows.map((_, i) => prefix + String(first + i).padStart(digits.length, '0'));
  expect(rows).toEqual(expected);
  return first;
}

test('scrolling a 3000-row result keeps the row cache bounded with correct windows', async ({ page }) => {
  await gotoApp(page);
  await seedWindowedFlat(page);
  await settle(page);
  await expectCorrectWindow(page);

  // Step from the top to near the bottom in row-position chunks, settling at each.
  // The cache must stay far below the total result count throughout — eviction
  // prunes positions left far behind by the moving viewport.
  let maxObserved = 0;
  for (let pos = 0; pos <= COUNT - 60; pos += 400) {
    await scrollTo(page, pos);
    await settle(page);
    const first = await expectCorrectWindow(page);
    // The visible run tracks the scroll position (minus the prefetch buffer).
    expect(first).toBeGreaterThanOrEqual(Math.max(0, pos - 80));

    const size = await winCacheSize(page);
    maxObserved = Math.max(maxObserved, size);
    // The cache is capped by the eviction early-out (viewport + 3*360 ≈ a bit over
    // a thousand); once it crosses that, eviction prunes back to viewport + 2*360.
    // Either way it stays roughly half the result and never trends toward COUNT.
    expect(size).toBeLessThan(1600);
  }

  // Scroll back to the very top: the early window was pruned long ago, but the
  // re-fetch must repopulate it and render the correct rows again.
  await scrollTo(page, 0);
  await settle(page);
  const firstAtTop = await expectCorrectWindow(page);
  expect(firstAtTop).toBe(0);

  expect(await winCacheSize(page)).toBeLessThan(1600);
  expect(maxObserved).toBeLessThan(1600);
});
