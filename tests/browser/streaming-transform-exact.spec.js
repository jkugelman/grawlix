import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The transform stream must be EXACT-FINAL: the last streamed snapshot equals the
// settled result, so completion adopts the stream instead of recomputing. Three
// modes because a fold is direction-sensitive (a mirror pair collapses to one row
// keeping the lexicographically-smaller norm-join direction) and score sort moves
// that surviving direction's first atom to the primary axis — so entry sort, score
// sort, and a filtered run each exercise a distinct way the two could diverge.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const STREAM_MS = 1;
const SHIPPED_MS = 30;

// Big filler (no reverse present, so none fold) forces a multi-yield stream so the
// run actually emits snapshots; without it the run settles in one batch and never
// streams. The few real pairs keep the settled result small.
async function seedCorpus(page) {
  await page.evaluate(() => {
    const entries = [], scores = [];
    const pairs = [
      ['ABCDE', 90], ['EDCBA', 20],
      ['FGHIJ', 30], ['JIHGF', 80],
      ['KLMNO', 50], ['ONMLK', 60],
      ['PQRST', 70], ['TSRQP', 40],
    ];
    for (const [w, s] of pairs) { entries.push(w); scores.push(s); }
    for (let i = 0; i < 14000; i++) { entries.push('W' + String(i).padStart(6, '0')); scores.push(10 + (i % 60)); }
    return window.__grawlixTest.addCustomWordlist({ name: 'Mirror', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.setScope('Mirror'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Each row maps to its atom display sequence, order-sensitive — so the comparison
// catches both the surviving fold direction and the row's sort position.
async function streamThenSettle(page) {
  return page.evaluate(async ({ STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerChainPartialsForTest();
    await T.setStack([{ tool: 'semordnilap', params: {} }]);
    await T.pipelineIdle();
    const partials = capture.stop();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);

    const last = partials[partials.length - 1];
    const reply = await T.fetchWorkerAllTransformRows(T.lastCompletedRunId());
    const settled = reply ? reply.rows.map(c => c.atoms.map(a => a.wlEntry.display ?? a.wlEntry.norm)) : [];

    return { streamedCount: partials.length, streamed: last ? last.entries : [], lastTotal: last ? last.total : 0, settled };
  }, { STREAM_MS, SHIPPED_MS });
}

// A snapshot's `entries` is the viewport WINDOW, not the whole result — under load a
// transient narrow viewport report ships fewer rows than `total`. So the exact-final
// invariant is: the window is settled's sorted PREFIX, and the window-independent
// `total` equals the full settled count. Comparing the raw window to all of settled
// false-fails whenever the window is short (the flake this replaced).
function expectStreamConverged({ streamedCount, streamed, lastTotal, settled }) {
  expect(streamedCount).toBeGreaterThanOrEqual(1);
  expect(settled.length).toBeGreaterThan(0);
  expect(lastTotal).toBe(settled.length);
  expect(streamed).toEqual(settled.slice(0, streamed.length));
}

test('entry sort: the last streamed snapshot equals the settled result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.applySort('entry', 'asc'));

  expectStreamConverged(await streamThenSettle(page));
});

test('score sort: the last streamed snapshot equals the settled result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.applySort('score', 'desc'));

  expectStreamConverged(await streamThenSettle(page));
});

test('filtered (score range): the last streamed snapshot equals the settled result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => {
    const input = document.querySelector('#score-range-input');
    input.value = '50-100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  expectStreamConverged(await streamThenSettle(page));
});
