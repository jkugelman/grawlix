import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Crash recovery: a crashed worker has no main-thread corpus to fall back onto, so
// the client respawns the worker, has it rebuild its owned corpus from IDB, and
// re-dispatches the in-flight run. After MAX_CRASHES it latches workerUnavailable
// and resolves every run with a graceful errored/empty result — never a hang.
//
// The oracle dynamically imports the live client singleton, which exists only in
// the unbundled tree → site/ only.
test.skip(!!process.env.GRAWLIX_SITE_DIR && process.env.GRAWLIX_SITE_DIR !== 'site',
  'imports unbundled /src modules; runs against site/ only');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function seedTwoWordlists(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', scores: [90, 80, 70, 65, 55], entries: ['CHAIR', 'HAIR', 'STAR', 'TAR', 'BANANA'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta', scores: [60, 50], entries: ['ARIA', 'PLUM'],
  }));
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// Runs a stack on the worker and returns its survivor norms — the only corpus
// source post-flip (no main-thread executePipeline to diff against).
async function workerNorms(page, stack) {
  return page.evaluate(async (s) => {
    const { makeToolRow } = await import('/src/engine/tools.js');
    const { runOnWorker } = await import('/src/ui/pipeline-worker.js');
    const { fetchWorkerAllRows, fetchWorkerAllTransformRows, lastCompletedRunId } = await import('/src/ui/pipeline-worker.js');
    const rows = s.map(r => makeToolRow(r.tool, r.params || {}, false));
    const result = await runOnWorker(rows);
    if (result.aborted || result.errored) return { aborted: !!result.aborted, errored: !!result.errored, norms: [] };
    let norms;
    if (result.flat) {
      const reply = await fetchWorkerAllRows(lastCompletedRunId());
      norms = reply ? reply.rows.map(r => r.norm) : [];
    } else if (result.transform) {
      const reply = await fetchWorkerAllTransformRows(lastCompletedRunId());
      norms = reply ? reply.rows.map(c => c.atoms[0].wlEntry.norm) : [];
    } else {
      norms = result.rows.map(r => r.atoms[0].wlEntry.norm);
    }
    return { aborted: false, errored: false, norms: norms.sort() };
  }, stack);
}

test('a single mid-flight crash respawns and re-dispatches, recovering the run', async ({ page }) => {
  await gotoApp(page);
  await seedTwoWordlists(page);

  // Reference: the same stack run cleanly, before any crash.
  const ref = await workerNorms(page, [{ tool: 'search', params: { pattern: '*A*' } }]);
  expect(ref.norms.length).toBeGreaterThan(0);

  // Crash mid-flight: the run must settle via respawn + re-dispatch, not hang.
  const outcome = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    const { makeToolRow } = await import('/src/engine/tools.js');
    const { runOnWorker, fetchWorkerAllRows, lastCompletedRunId } = await import('/src/ui/pipeline-worker.js');
    const rows = [makeToolRow('search', { pattern: '*A*' }, false)];
    const runPromise = runOnWorker(rows);
    T.forceWorkerCrashForTest();   // crash before the worker replies
    const result = await runPromise;   // must settle via respawn, not hang
    await T.pipelineIdle();
    let norms = [];
    if (!result.aborted && !result.errored) {
      if (result.flat) {
        const reply = await fetchWorkerAllRows(lastCompletedRunId());
        norms = reply ? reply.rows.map(r => r.norm) : [];
      } else {
        norms = result.rows.map(r => r.atoms[0].wlEntry.norm);
      }
    }
    return { aborted: !!result.aborted, errored: !!result.errored, norms: norms.sort(), state: T.pipelineWorkerState() };
  });

  expect(outcome.aborted).toBe(false);
  expect(outcome.errored).toBe(false);
  expect(outcome.norms).toEqual(ref.norms);
  // Recovered, not latched: crashCount advanced but no unavailability.
  expect(outcome.state.crashCount).toBe(1);
  expect(outcome.state.workerUnavailable).toBe(false);
});

test('a subsequent run on the respawned worker produces the correct result', async ({ page }) => {
  await gotoApp(page);
  await seedTwoWordlists(page);

  // Reference for the post-recovery stack, captured cleanly first.
  const ref = await workerNorms(page, [{ tool: 'head_off', params: { pattern: '?' } }]);
  expect(ref.norms.length).toBeGreaterThan(0);

  // Crash mid-flight to force one respawn.
  await page.evaluate(async () => {
    const { makeToolRow } = await import('/src/engine/tools.js');
    const { runOnWorker } = await import('/src/ui/pipeline-worker.js');
    const p = runOnWorker([makeToolRow('search', { pattern: '*A*' }, false)]);
    window.__grawlixTest.forceWorkerCrashForTest();
    await p;
    await window.__grawlixTest.pipelineIdle();
  });

  // A brand-new run against the respawned worker matches the clean reference.
  const got = await workerNorms(page, [{ tool: 'head_off', params: { pattern: '?' } }]);
  expect(got.aborted).toBe(false);
  expect(got.errored).toBe(false);
  expect(got.norms).toEqual(ref.norms);
  expect(await page.evaluate(() => window.__grawlixTest.pipelineWorkerState().workerUnavailable)).toBe(false);
});

test('MAX_CRASHES latches workerUnavailable and runs resolve gracefully errored', async ({ page }) => {
  await gotoApp(page);
  await seedTwoWordlists(page);

  // Below the threshold the latch stays clear.
  await page.evaluate(() => window.__grawlixTest.forceWorkerCrashForTest());
  expect(await page.evaluate(() => window.__grawlixTest.pipelineWorkerState()))
    .toMatchObject({ crashCount: 1, workerUnavailable: false });

  // The MAX_CRASHES-th crash latches unavailable — post-flip there is no main
  // corpus to run on, so it never reroutes; it settles errored.
  await page.evaluate(() => window.__grawlixTest.forceWorkerCrashForTest());
  expect(await page.evaluate(() => window.__grawlixTest.pipelineWorkerState()))
    .toMatchObject({ crashCount: 2, workerUnavailable: true });

  // A run after the latch resolves errored/empty — settles, does not hang.
  const result = await page.evaluate(async () => {
    const { makeToolRow } = await import('/src/engine/tools.js');
    const { runOnWorker } = await import('/src/ui/pipeline-worker.js');
    return await runOnWorker([makeToolRow('search', { pattern: '*A*' }, false)]);
  });
  expect(result.aborted).toBe(false);
  expect(result.errored).toBe(true);
  expect(result.rows).toEqual([]);

  // The full UI render path also settles (pipelineIdle resolves) and shows an
  // empty scroller rather than freezing.
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: '*A*' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const rowCount = await page.evaluate(() => document.querySelectorAll('#vs-host .entry-row:not(.skeleton)').length);
  expect(rowCount).toBe(0);
});
