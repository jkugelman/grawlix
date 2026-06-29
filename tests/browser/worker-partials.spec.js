import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Worker-side streaming `partial` support: a flat (filter-only) run posts SORTED
// snapshots of its survivors as they're found, while the terminal `result` ships
// the exact same sorted order (the incremental merge over a total comparator
// equals a from-scratch sort). This pins the worker contract: the climbing total,
// the sorted top window per snapshot, the final result identical with/without
// forced streaming, and a correctly-sorted mid-stream fetchRows window. See
// docs/worker-protocol.md § partial.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Big enough that the scan takes several yield intervals of wall-clock, so it
// streams multiple batches; a 1ms interval (not 0) keeps the yield COUNT bounded
// by scan-ms — a 0ms interval yields on every sample and starves setTimeout(0) on
// firefox/webkit into a test timeout.
const COUNT = 20000;
const STREAM_MS = 1;
const SHIPPED_MS = 30;

async function seedCorpus(page) {
  await page.evaluate(count => {
    const entries = [], scores = [];
    for (let i = 0; i < count; i++) {
      entries.push('W' + String(i).padStart(5, '0'));
      scores.push(10 + (i % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
  }, COUNT);
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

async function runFlat(page, pattern, { stream } = {}) {
  return page.evaluate(async ({ pattern, stream, STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    if (stream) T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerPartialsForTest();
    await T.setStack([{ tool: 'search', params: { pattern } }]);
    await T.pipelineIdle();
    const partials = capture.stop();
    if (stream) T.setWorkerYieldIntervalForTest(SHIPPED_MS);   // restore the shipped budget
    const runId = T.lastCompletedRunId();
    const reply = await T.fetchWorkerRows(0, 1e9, runId);
    return {
      runId,
      finalRows: reply ? reply.rows.map(r => ({ norm: r.norm, score: r.score })) : [],
      partials,
    };
  }, { pattern, stream, STREAM_MS, SHIPPED_MS });
}

test('a forced-stream flat search streams many partials', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  const { partials } = await runFlat(page, 'W*', { stream: true });
  expect(partials.length).toBeGreaterThan(1);
});

test('the final result is identical with and without forced streaming', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const plain = await runFlat(page, 'W*');
  const streamed = await runFlat(page, 'W*', { stream: true });

  expect(streamed.finalRows.length).toBe(plain.finalRows.length);
  expect(streamed.finalRows).toEqual(plain.finalRows);   // same norms, scores, sorted order
});

test('partials stream a climbing total and a sorted top window', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // A pattern matching a real subset, so survivors < corpus.
  const PATTERN = 'W*0';
  const { partials, finalRows } = await runFlat(page, PATTERN, { stream: true });

  let prev = 0;
  for (const p of partials) {
    expect(p.total).toBeGreaterThan(prev);
    prev = p.total;
  }
  const last = partials[partials.length - 1];
  expect(last.total).toBe(finalRows.length);

  // The final snapshot's CUMULATIVE stats count every survivor — the partial ships
  // cumulative stats (like the grouped/transform tiers), not a per-batch scores
  // delta, so the last snapshot's stats summarize the whole result.
  expect(last.stats.count).toBe(finalRows.length);

  // The last snapshot's sorted top window matches the final result's top — proof
  // the stream painted a correctly-sorted prefix, not arrival order.
  const topNorms = last.firstRows.map(r => r.norm);
  expect(topNorms.length).toBeGreaterThan(0);
  expect(topNorms).toEqual(finalRows.slice(0, topNorms.length).map(r => r.norm));

  // The final result is sorted ascending by entry (the default sort).
  const norms = finalRows.map(r => r.norm);
  expect([...norms].sort()).toEqual(norms);
});

test('a fetchRows for an already-streamed window returns correct rows mid-stream', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Drive the run and a mid-stream fetchRows in one page evaluate so the fetch
  // lands during the scan (the worker processes it between yields). The captured
  // partial carries the in-flight runId — lastCompletedRunId() only updates at
  // completion, so it's the partial's runId that names the still-streaming result.
  const result = await page.evaluate(async ({ STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerPartialsForTest();
    const runPromise = (async () => {
      await T.setStack([{ tool: 'search', params: { pattern: 'W*' } }]);
      await T.pipelineIdle();
    })();

    let mid = null;
    for (let tries = 0; tries < 2000 && !mid; tries++) {
      const inFlight = capture.peek().find(p => p.total >= 20);
      if (inFlight) {
        const reply = await T.fetchWorkerRows(0, 20, inFlight.runId);
        if (reply && reply.rows.length) mid = reply.rows.map(r => r.norm);
      }
      if (!mid) await new Promise(r => setTimeout(r, 0));
    }

    await runPromise;
    capture.stop();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const full = await T.fetchWorkerRows(0, 1e9);
    return { mid, full: full.rows.map(r => r.norm) };
  }, { STREAM_MS, SHIPPED_MS });

  // Each mid-stream window norm must be a real survivor, proving the window served
  // from the sorted lastFlatResult is correct rather than garbage.
  expect(result.mid).not.toBeNull();
  expect(result.mid.length).toBeGreaterThan(0);
  const finalSet = new Set(result.full);
  for (const norm of result.mid) expect(finalSet.has(norm)).toBe(true);
});
