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

// A lead scans one norm ahead of the rest, so its family's anchor can drop after the
// row is placed (`houses` placed, then `house` arrives). The Entry sort must come out
// as if the corpus had been scanned in order.
test('a leading first stage sorts by Entry as a plain scan does', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.installFixtureTools());
  const words = ['house', 'housed', 'housefly', 'houses', 'housing'];
  await seedCorpus(page, [...numbered.slice(0, 10000).map(w => 'A' + w), ...words, ...numbered.slice(10000)]);

  const run = lead => page.evaluate(async ({ lead, STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerPartialsForTest();
    await T.setStack([{ tool: 'leading', params: { lead } }]);
    await T.pipelineIdle();
    const partials = capture.stop();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const rows = (await T.fetchWorkerRows(0, 1e9)).rows;
    return { partials: partials.length, firstTotal: partials[0]?.total ?? 0, rows: rows.map(r => r.norm), families: rows.map(r => r.family) };
  }, { lead, STREAM_MS, SHIPPED_MS });

  const plain = await run('');
  const led = await run('houses');
  expect(led.partials).toBeGreaterThan(1);
  // `houses` is scanned first and `house` after the 10000 `aw` rows, so a smaller
  // first snapshot places `houses` before its family's anchor drops.
  expect(led.firstTotal).toBeLessThanOrEqual(10000);
  const family = norm => led.families[led.rows.indexOf(norm)];
  expect(family('house')).toBe(family('houses'));
  expect(led.rows).toEqual(plain.rows);
});
