import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Worker-side streaming for the TUPLE tier: a multi-pattern Umiaq query
// posts SORTED `partialGroups` snapshots of its tuples as the join finds them, and
// the terminal grouped `result` ships the same sorted order (the incremental merge
// over a total comparator equals a from-scratch sortGroups). This pins the worker
// contract: the climbing total, the sorted group prefix per snapshot, and the final
// result identical with/without forced streaming. See docs/worker-protocol.md
// § partialGroups.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const STREAM_MS = 1;
const SHIPPED_MS = 30;

// All 4-letter words over a 7-letter alphabet (2401 words): AB;BA pairs every split
// of every word with its rotation (B+A is always present), so the join is heavy
// enough to cross many 1ms yields and caps at UMIAQ_MAX_RESULTS (2000).
async function seedCorpus(page) {
  await page.evaluate(() => {
    const A = 'abcdefg', entries = [], scores = [];
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) {
      entries.push(a + b + c + d);
      scores.push(10 + (entries.length % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Quads', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.setScope('Quads'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function runStack(page, stack, { stream } = {}) {
  return page.evaluate(async ({ stack, stream, STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    if (stream) T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerGroupPartialsForTest();
    await T.setStack(stack);
    await T.pipelineIdle();
    const partials = capture.stop();
    if (stream) T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const runId = T.lastCompletedRunId();
    const reply = await T.fetchWorkerAllGroups(runId);
    return { runId, groups: reply ? reply.groups.map(g => g.key) : [], partials };
  }, { stack, stream, STREAM_MS, SHIPPED_MS });
}

async function runTuple(page, patterns, opts = {}) {
  return runStack(page, [{ tool: 'umiaq', params: { patterns } }], opts);
}

test('a forced-stream tuple run streams many tuple partials', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  const { partials } = await runTuple(page, 'AB;BA', { stream: true });
  expect(partials.length).toBeGreaterThan(1);
  for (const p of partials) expect(p.laneKind).toBe('record');
});

test('the final tuple result is identical with and without forced streaming', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const plain = await runTuple(page, 'AB;BA');
  const streamed = await runTuple(page, 'AB;BA', { stream: true });

  expect(streamed.groups.length).toBe(plain.groups.length);
  expect(streamed.groups).toEqual(plain.groups);   // same tuples, same sorted order
});

test('a tuple run with a downstream filter streams only the filtered tuples', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Stream the filtered run FIRST, while the pre-search cache is cold. The
  // permanent trailing search bar gives both this stack and a bare `[umiaq]` run
  // the same user stack `[umiaq]`, so a prior run would warm the cache, skip the
  // rerun, and stream nothing (0 partials).
  const streamed = await runStack(page, [
    { tool: 'umiaq', params: { patterns: 'AB;BA' } },
    { tool: 'search', params: { pattern: 'a' } },
  ], { stream: true });
  const unfiltered = await runTuple(page, 'AB;BA');

  expect(streamed.groups.length).toBeGreaterThan(0);
  expect(streamed.groups.length).toBeLessThan(unfiltered.groups.length);   // the filter dropped some

  expect(streamed.partials.length).toBeGreaterThan(1);
  for (const p of streamed.partials) expect(p.laneKind).toBe('record');

  const finalSet = new Set(streamed.groups);
  for (const p of streamed.partials) for (const k of p.groupKeys) {
    expect(finalSet.has(k)).toBe(true);            // no raw tuple ever painted
  }

  const last = streamed.partials[streamed.partials.length - 1];
  expect(last.groupKeys.length).toBeGreaterThan(0);
  expect(last.groupKeys).toEqual(streamed.groups.slice(0, last.groupKeys.length));   // sorted prefix of the final
});

test('a streamed run hands off cleanly to a settled tuple render', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  await page.evaluate(() => window.__grawlixTest.setWorkerYieldIntervalForTest(1));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { patterns: 'AB;BA' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.setWorkerYieldIntervalForTest(30));

  // Completion lands in the tuple tier and clears the streaming state.
  expect(await page.evaluate(() => window.__grawlixTest.windowedFlatDebug().sortTier)).toBe('tuple');
  expect(await page.evaluate(() => !!document.querySelector('#entries-table-panel.pipeline-streaming'))).toBe(false);

  // The painted tuple rows are the sorted prefix of the worker's full result — proof
  // the mid-stream cache reset to the settled order rather than leaving a stale snapshot.
  const visibleKeys = await page.evaluate(async () => {
    const groups = await window.__grawlixTest.getVisibleGroups();
    return groups.map(g => g.chains.map(c => c.join('')).join(' '));
  });
  expect(visibleKeys.length).toBeGreaterThan(0);
  const runId = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  const fullKeys = await page.evaluate(rid =>
    window.__grawlixTest.fetchWorkerAllGroups(rid).then(r => r.groups.map(g => g.key)), runId);
  expect(visibleKeys).toEqual(fullKeys.slice(0, visibleKeys.length));
});

test('tuple partials stream a climbing total and a sorted group prefix', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const { partials, groups } = await runTuple(page, 'AB;BA', { stream: true });

  let prev = 0;
  for (const p of partials) {
    expect(p.total).toBeGreaterThanOrEqual(prev);   // groups only grow across snapshots
    prev = p.total;
  }
  const last = partials[partials.length - 1];
  expect(last.total).toBe(groups.length);

  // The last snapshot's sorted group-key prefix matches the final result's prefix —
  // proof the stream painted a correctly-sorted prefix, not arrival order.
  expect(last.groupKeys.length).toBeGreaterThan(0);
  expect(last.groupKeys).toEqual(groups.slice(0, last.groupKeys.length));
});

// A tuple run's first tuple is ~1s out; without an eager indicator the prior result
// lingers on screen looking current. Dispatch must show empty + dots at once.
test('a tuple-run dispatch shows the streaming state at once, before the first tuple batch', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);   // leaves a flat browse of Quads on screen

  // Read the panel SYNCHRONOUSLY after an un-awaited dispatch: the worker reply is a
  // later task, so beginStreamPending (run in the dispatch's synchronous prefix) is the
  // only thing that has touched the DOM — there is provably no first batch yet.
  const snap = await page.evaluate(() => {
    const T = window.__grawlixTest;
    const before = T.scrollerRowCount();
    const settle = T.setStack([{ tool: 'umiaq', params: { patterns: 'AB;BA' } }]);
    const panel = document.getElementById('entries-table-panel');
    const pending = {
      before,
      streaming: panel.classList.contains('pipeline-streaming'),
      dots: !!document.querySelector('#stats .stream-dots'),
      rowCount: T.scrollerRowCount(),
      footer: document.querySelector('.entries-footer')?.textContent ?? '',
    };
    return settle.then(() => pending);
  });

  expect(snap.before).toBeGreaterThan(0);            // a result WAS on screen
  expect(snap.streaming).toBe(true);                 // replaced at once by the streaming state
  expect(snap.dots).toBe(true);
  expect(snap.rowCount).toBe(0);
  expect(snap.footer).not.toContain('No matches');   // reads as "searching", not "no results"

  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  expect(await page.evaluate(() => !!document.querySelector('#entries-table-panel.pipeline-streaming'))).toBe(false);
  expect(await page.evaluate(() => window.__grawlixTest.scrollerRowCount())).toBeGreaterThan(0);
});
