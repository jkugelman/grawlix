import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// A BACKGROUND structural auto-update that lands WHILE a tuple run is streaming must not
// splice/reindex the corpus under the live run — a mid-stream reindex shifts every
// already-produced tuple's position-encoded lanes (the "close-but-shifted" tear). The worker
// defers the apply until idle, so the run finishes uncorrupted and only then pins + chips.
// See docs/worker-protocol.md § applyFetched (deferral).

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// All 4-letter words over a 7-letter alphabet (2401), scoped so the run reads exactly this
// source. AB;BA pairs every word with its rotation, capping at UMIAQ_MAX_RESULTS — heavy
// enough that the run crosses many 1ms yields, so an update fired after the first partial
// lands while the run is still in flight.
async function seedQuads(page) {
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
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

// 'aa' sorts before every 4-letter word, so adding it shifts every corpus position by one —
// the reindex a live run's lanes would tear against. Every original word keeps its exact
// score (a pure structural ADD, no rescore) so the update stays config-neutral and takes the
// applyFetched path — a rescore-triggered rule re-seed would resync + re-run and mask the bug.
function updatedBody(page) {
  return page.evaluate(() => {
    const A = 'abcdefg', lines = ['aa;40']; let n = 0;
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) { n++; lines.push(`${a}${b}${c}${d};${10 + (n % 60)}`); }
    return lines.join('\n') + '\n';
  });
}

test('a background structural update mid-stream defers — the tuple run finishes uncorrupted', async ({ page }) => {
  test.slow();
  await gotoApp(page);
  await seedQuads(page);
  const newBody = await updatedBody(page);

  const out = await page.evaluate(async newBody => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(1);                          // force streaming (many yields)
    const cap = T.captureWorkerGroupPartialsForTest();
    const started = T.setStack([{ tool: 'umiaq', params: { query: 'AB;BA' } }]);   // dispatch the run

    // Wait until the run is confirmed in flight (a partial landed) before firing the update,
    // so the applyFetched genuinely arrives mid-stream (the deferral's whole reason to exist).
    let streamRunId = null;
    for (let i = 0; i < 400 && streamRunId == null; i++) {
      const p = cap.peek();
      if (p.length) streamRunId = p[0].runId;
      else await new Promise(r => setTimeout(r, 1));
    }
    const streamingAtUpdate = !!document.querySelector('#entries-table-panel.pipeline-streaming');

    await T.backgroundUpdate('Quads', newBody);                 // fires mid-stream, resolves once the deferred op lands
    await started;
    await T.pipelineIdle();
    const partialRunIds = [...new Set(cap.stop().map(p => p.runId))];
    T.setWorkerYieldIntervalForTest(30);

    const runId = T.lastCompletedRunId();
    const reply = await T.fetchWorkerAllGroups(runId);
    const tuples = reply ? reply.groups.map(g => g.key.split(' ')) : null;   // key = the tuple's space-joined lane norms
    return { streamRunId, finalRunId: runId, streamingAtUpdate, partialRunIds, tuples, fetchMode: T.lastFetchMode() };
  }, newBody);

  expect(out.streamRunId).not.toBeNull();
  expect(out.streamingAtUpdate).toBe(true);              // the update really landed mid-stream
  expect(out.fetchMode).toBe('splice');                  // took the applyFetched path, not a config-change re-run
  expect(out.partialRunIds).toEqual([out.streamRunId]);  // only the one run ever streamed
  expect(out.finalRunId).toBe(out.streamRunId);          // deferred, not superseded — the SAME run completed

  // The run's result is still serveable and coherent. Under the bug the mid-stream splice
  // leaves it either un-serveable (a fetch drops it) or shifted — for AB;BA, lane 2 is a
  // cyclic rotation of lane 1, which a reindex breaks (lanes resolve to unrelated words).
  expect(out.tuples).not.toBeNull();
  expect(out.tuples.length).toBeGreaterThan(0);
  for (const [l1, l2] of out.tuples) {
    expect(l1.length).toBe(l2.length);
    expect((l1 + l1).includes(l2)).toBe(true);
  }

  await expect(page.locator('#stats .results-stale-chip')).toBeVisible();   // deferred update landed → pinned + chipped
});
