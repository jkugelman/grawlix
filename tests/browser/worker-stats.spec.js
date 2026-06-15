import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Stage-3 (ch6β) oracle: for a fresh merged flat run the worker ships per-result
// `stats` (Min/Max) and `histogramCounts`; main's stats bar consumes them instead
// of recomputing from the resident _flatScores. Filter correctness: a score-range
// filter shrinks the Min/Max readout (the worker filters the merged result itself
// and ships filtered stats) while the histogram stays unfiltered.
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

function captureStatsBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('#stats .stats-bar');
    const readout = label => [...bar.querySelectorAll('.stat-far')]
      .find(el => el.querySelector('.stat-label')?.textContent === label)
      ?.querySelector('.stat-value')?.textContent ?? null;
    const bars = [...bar.querySelectorAll('.histogram-bar')].map(b => ({
      lo: b.dataset.lo, hi: b.dataset.hi, height: b.style.height,
    }));
    return { min: readout('Min'), max: readout('Max'), bars };
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

test('worker-shipped stats + histogram render into the stats bar', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);
  await runSearch(page, '');
  const shippedDbg = await summaries(page);
  expect(shippedDbg.hasWorkerStats).toBe(true);            // non-vacuous: the worker path ran
  expect(shippedDbg.hasWorkerHistogramCounts).toBe(true);

  const shipped = await captureStatsBar(page);
  expect(shipped.bars.length).toBeGreaterThan(0);
  expect(shipped.min).not.toBe('—');
  expect(shipped.max).not.toBe('—');

  expect(shippedDbg.workerHistogramCounts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
});

test('a score-range filter shrinks Min/Max via worker-filtered stats; the histogram stays unfiltered', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await sync(page);
  await runSearch(page, '');

  const unfiltered = await captureStatsBar(page);
  const dbg = await summaries(page);
  expect(dbg.hasWorkerStats).toBe(true);
  const fullMin = Number(unfiltered.min.replace(/,/g, ''));
  const fullMax = Number(unfiltered.max.replace(/,/g, ''));
  expect(dbg.workerStats.min).toBe(fullMin);
  expect(dbg.workerStats.max).toBe(fullMax);

  // Sub-band strictly inside the full range: Min/Max must follow the FILTERED set.
  // The worker now filters the merged result itself and ships filtered stats.
  await setScoreRange(page, '60-80');
  const filtered = await captureStatsBar(page);
  expect(Number(filtered.min.replace(/,/g, ''))).toBeGreaterThanOrEqual(60);
  expect(Number(filtered.max.replace(/,/g, ''))).toBeLessThanOrEqual(80);
  expect(Number(filtered.min.replace(/,/g, ''))).toBeGreaterThan(fullMin);
  expect(Number(filtered.max.replace(/,/g, ''))).toBeLessThan(fullMax);

  // Non-vacuous proof the WORKER filtered (not main recomputing): its shipped
  // stats now reflect the filtered set, so workerStats.min sits in [60, 80].
  const filteredDbg = await summaries(page);
  expect(filteredDbg.hasWorkerStats).toBe(true);
  expect(filteredDbg.workerStats.min).toBeGreaterThanOrEqual(60);
  expect(filteredDbg.workerStats.max).toBeLessThanOrEqual(80);

  expect(filtered.bars).toEqual(unfiltered.bars);

  await setScoreRange(page, '');
  const cleared = await captureStatsBar(page);
  expect(cleared).toEqual(unfiltered);
});
