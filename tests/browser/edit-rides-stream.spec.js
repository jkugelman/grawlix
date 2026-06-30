import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// A key-stable My Edits edit (score/comment, no variant reshape) landing while a
// tuple search (Umiaq) streams must RIDE the in-flight run, not restart it: the
// worker splices the corpus in place, so the live run already reflects the new
// score and tuple completion re-sorts from scratch. The discriminator is the runId
// — a restart supersedes with a fresh one. See refreshAfterEdit + mergedStreamingTuple.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// All 5-letter words over a 7-letter alphabet (16807), enabled into the merge (scope
// stays All Wordlists). The reverse-join ABCDE;EDCBA pairs every word with its
// mirror, so it streams long enough that an edit fired right after the first partial
// lands — and is DECIDED — while the run is still in flight. A shorter join finishes
// during the edit's plan + ack round-trips, taking the (correct) settled re-run path
// instead, which doesn't exercise the ride.
//
// ABCDE is also seeded into My Edits, so rescoring it is a pure score change (a
// key-stable edit) rather than an add that reshapes the merge's variant set.
async function seedHeavyMerge(page) {
  await page.evaluate(() => {
    const A = 'ABCDEFG', entries = [], scores = [];
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) for (const e of A) {
      entries.push(a + b + c + d + e);
      scores.push(10 + (entries.length % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Pents', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.reimport('My Edits', 'ABCDE;50'));
  await page.evaluate(() => window.__grawlixTest.flushEditsToIdb());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

test('a key-stable rescore mid-stream rides the tuple run instead of restarting it', async ({ page }) => {
  await gotoApp(page);
  await seedHeavyMerge(page);

  const out = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(1);
    const cap = T.captureWorkerGroupPartialsForTest();
    const started = T.setStack([{ tool: 'umiaq', params: { patterns: 'ABCDE;EDCBA' } }]);   // dispatches the run; ride it mid-stream

    let streamRunId = null;
    for (let i = 0; i < 400 && streamRunId == null; i++) {
      const p = cap.peek();
      if (p.length) streamRunId = p[0].runId;
      else await new Promise(r => setTimeout(r, 1));
    }

    const streamingAtEdit = !!document.querySelector('#entries-table-panel.pipeline-streaming');
    await T.rescoreFrom({ norm: 'abcde', display: 'ABCDE' }, 7);

    await started;              // setStack resolves on renderMergedDetail, not the run…
    await T.pipelineIdle();     // …so wait here for the run (the ride) to actually settle
    const partialRunIds = [...new Set(cap.stop().map(p => p.runId))];
    T.setWorkerYieldIntervalForTest(30);

    const dump = await T.dumpWorkerCorpus('__merged__');
    const abcde = dump.entries.find(e => e[0] === 'abcde');   // [norm, display, score, ...]
    return { streamRunId, finalRunId: T.lastCompletedRunId(), streamingAtEdit, partialRunIds, abcdeScore: abcde ? abcde[2] : null };
  });

  expect(out.streamRunId).not.toBeNull();
  expect(out.streamingAtEdit).toBe(true);            // the edit really landed mid-stream
  expect(out.partialRunIds).toEqual([out.streamRunId]);   // only the one run ever streamed — no restart
  expect(out.finalRunId).toBe(out.streamRunId);      // SAME run completed — rode, didn't restart
  expect(out.abcdeScore).toBe(7);                    // the in-place splice took (live getters carry it)
});

// Counterpart: the same key-stable edit AFTER the stream settles takes the ordinary
// re-run path (no in-flight run to ride), so the runId advances. Guards that the
// suppression is gated on streaming, not always-on.
test('a key-stable rescore after the stream settles re-runs (advances the runId)', async ({ page }) => {
  await gotoApp(page);
  await seedHeavyMerge(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { patterns: 'ABCDE;EDCBA' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  const before = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  await page.evaluate(() => window.__grawlixTest.rescoreFrom({ norm: 'abcde', display: 'ABCDE' }, 9));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const after = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());

  expect(after).toBeGreaterThan(before);             // settled → ordinary re-run, not a ride
});
