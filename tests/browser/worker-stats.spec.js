import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Stage-3 (ch6β) oracle: for a fresh merged flat run the worker ships per-result
// `stats` (Min/Max) and `histogramCounts`; main consumes them rather than
// recomputing locally. The stats bar no longer displays Min/Max, but the worker
// still computes them (score colors, future readouts), so these assert the
// shipped values via workerSummariesDebug(). Filter correctness: a score-range
// filter shrinks the worker's Min/Max stats (the worker filters the merged
// result itself) while the histogram stays unfiltered.
//
// Non-vacuity hinges on workerSummariesDebug().hasWorkerStats: without it a
// regression that silently dropped the shipped fields would still pass.
//
// Same footgun as worker-axis.spec.js: re-run syncWorkerConfig() after ANY change
// to sources/rules, or the worker answers against stale config.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const sync = page => page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
const summaries = page => page.evaluate(() => window.__grawlixTest.workerSummariesDebug());

async function seedCorpus(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha',
    entries: ['ABLE', 'CRANE', 'EAGLE', 'GRAPE', 'INLET'],
    scores: [90, 80, 70, 60, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bravo',
    entries: ['CRANE', 'BIRD', 'DELTA', 'FROND', 'HOUSE'],
    scores: [85, 55, 45, 35, 25],
  }));
}

async function runSearch(page, pattern) {
  await page.evaluate(p => window.__grawlixTest.setStack(
    p === '' ? [] : [{ tool: 'search', params: { pattern: p } }]), pattern);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

function captureHistogramBars(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#stats .stats-bar');
    return [...bar.querySelectorAll('.histogram-bar')].map(b => ({
      lo: b.dataset.lo, hi: b.dataset.hi, height: b.style.height,
    }));
  });
}

async function setScoreRange(page, range) {
  await page.evaluate(r => {
    const input = document.querySelector('#score-range-input');
    input.value = r;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, range);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test('the worker ships stats + histogram, and the histogram renders into the stats bar', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);
  await runSearch(page, '');
  const shippedDbg = await summaries(page);
  expect(shippedDbg.hasWorkerStats).toBe(true);            // non-vacuous: the worker path ran
  expect(shippedDbg.hasWorkerHistogramCounts).toBe(true);
  expect(shippedDbg.workerStats.min).not.toBeNull();
  expect(shippedDbg.workerStats.max).not.toBeNull();

  const bars = await captureHistogramBars(page);
  expect(bars.length).toBeGreaterThan(0);

  expect(shippedDbg.workerHistogramCounts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
});

test('a score-range filter shrinks the worker Min/Max stats; the histogram stays unfiltered', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);
  await runSearch(page, '');

  const unfilteredBars = await captureHistogramBars(page);
  const dbg = await summaries(page);
  expect(dbg.hasWorkerStats).toBe(true);
  const fullMin = dbg.workerStats.min;
  const fullMax = dbg.workerStats.max;

  // Sub-band strictly inside the full range: the worker filters the merged result
  // itself and ships stats for the FILTERED set.
  await setScoreRange(page, '60-80');
  const filteredDbg = await summaries(page);
  expect(filteredDbg.hasWorkerStats).toBe(true);
  expect(filteredDbg.workerStats.min).toBeGreaterThanOrEqual(60);
  expect(filteredDbg.workerStats.max).toBeLessThanOrEqual(80);
  expect(filteredDbg.workerStats.min).toBeGreaterThan(fullMin);
  expect(filteredDbg.workerStats.max).toBeLessThan(fullMax);

  // The histogram is bucketed over the UNFILTERED output, so its bars don't move.
  expect(await captureHistogramBars(page)).toEqual(unfilteredBars);

  await setScoreRange(page, '');
  expect(await captureHistogramBars(page)).toEqual(unfilteredBars);
});
