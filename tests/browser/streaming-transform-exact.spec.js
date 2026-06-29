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

// Big filler (no reverse present, so none fold) forces a multi-yield stream; the
// few pairs keep the result under one window, so the last snapshot's window IS the
// whole streamed result and is directly comparable to the settled fetch. Shrinking
// the filler or adding pairs past the window silently breaks that comparison.
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
    const streamed = last ? last.entries : [];

    const reply = await T.fetchWorkerAllTransformRows(T.lastCompletedRunId());
    const settled = reply ? reply.rows.map(c => c.atoms.map(a => a.wlEntry.display ?? a.wlEntry.norm)) : [];

    return { streamedCount: partials.length, streamed, settled };
  }, { STREAM_MS, SHIPPED_MS });
}

test('entry sort: the last streamed snapshot equals the settled result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.applySort('entry', 'asc'));

  const { streamedCount, streamed, settled } = await streamThenSettle(page);

  expect(streamedCount).toBeGreaterThanOrEqual(1);
  expect(settled.length).toBeGreaterThan(0);
  expect(streamed).toEqual(settled);
});

test('score sort: the last streamed snapshot equals the settled result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.applySort('score', 'desc'));

  const { streamedCount, streamed, settled } = await streamThenSettle(page);

  expect(streamedCount).toBeGreaterThanOrEqual(1);
  expect(settled.length).toBeGreaterThan(0);
  expect(streamed).toEqual(settled);
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

  const { streamedCount, streamed, settled } = await streamThenSettle(page);

  expect(streamedCount).toBeGreaterThanOrEqual(1);
  expect(settled.length).toBeGreaterThan(0);
  expect(streamed).toEqual(settled);
});
