import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Filters and transforms stream as one pipeline. See docs/pipeline.md § Streaming results.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const STREAM_MS = 1;
const SHIPPED_MS = 30;

async function seedCorpus(page, entries) {
  await page.evaluate(entries => window.__grawlixTest.addCustomWordlist({
    name: 'Big', entries, scores: entries.map((_, i) => 10 + (i % 60)),
  }), entries);
  await page.evaluate(() => window.__grawlixTest.setScope('Big'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const numbered = Array.from({ length: 20000 }, (_, i) => 'W' + String(i).padStart(5, '0'));

const quints = (() => {
  const A = 'abcdefg', out = [];
  for (const a of A) for (const b of A) for (const c of A) for (const d of A) for (const e of A) out.push(a + b + c + d + e);
  return out;
})();

// The second run must be a finished-cache hit, which derives the result without
// streaming; a run that streams again would compare the stream with itself.
async function streamedAndBuffered(page, stack, { chains }) {
  return page.evaluate(async ({ stack, chains, STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    const rowsOf = async () => {
      if (!chains) return (await T.fetchWorkerRows(0, 1e9)).rows.map(r => r.norm);
      const reply = await T.fetchWorkerAllTransformRows(T.lastCompletedRunId());
      return reply.rows.map(c => c.atoms.map(a => (a.glyph || '') + a.wlEntry.norm).join(' '));
    };
    T.configureResultCacheForTest({ minMs: 0 });
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = chains ? T.captureWorkerChainPartialsForTest() : T.captureWorkerPartialsForTest();
    await T.setStack(stack);
    await T.pipelineIdle();
    const partials = capture.stop();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const streamed = await rowsOf();
    await T.setStack([]);
    await T.pipelineIdle();
    const again = chains ? T.captureWorkerChainPartialsForTest() : T.captureWorkerPartialsForTest();
    await T.setStack(stack);
    await T.pipelineIdle();
    const bufferedPartials = again.stop();
    return { totals: partials.map(p => p.total), bufferedPartials: bufferedPartials.length, streamed, buffered: await rowsOf() };
  }, { stack, chains, STREAM_MS, SHIPPED_MS });
}

test('a filter after a filter streams, matching the buffered result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page, numbered);

  const r = await streamedAndBuffered(page, [
    { tool: 'search', params: { pattern: 'W*' } },
    { tool: 'search', params: { pattern: 'W*1*' } },
  ], { chains: false });

  expect(new Set(r.totals).size).toBeGreaterThan(1);   // climbed through several snapshots
  expect(r.bufferedPartials).toBe(0);                  // the second run really was buffered
  expect(r.streamed.length).toBeGreaterThan(0);
  expect(r.streamed.length).toBeLessThan(numbered.length);
  expect(r.buffered).toEqual(r.streamed);
});

test('a filter after a transform streams, matching the buffered result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page, quints);

  const r = await streamedAndBuffered(page, [
    { tool: 'semordnilap', params: {} },
    { tool: 'search', params: { pattern: 'A*' } },
  ], { chains: true });

  expect(r.totals.length).toBeGreaterThanOrEqual(1);
  expect(r.bufferedPartials).toBe(0);
  expect(r.streamed.length).toBeGreaterThan(0);
  expect(r.buffered).toEqual(r.streamed);
});
