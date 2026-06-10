const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

// C2: when the pipeline worker crashes, the client falls back to the main-thread
// engine, recovers the in-flight run so the UI never hangs, and after MAX_CRASHES
// degrades to main permanently. The oracle mirrors worker-snapshot.spec.js —
// runOnWorker (main-thread after a crash) vs. an in-page executePipeline.

// The oracle dynamically imports the unbundled /src modules (and the live client
// singleton), which exist only in the unbundled tree → site/ only.
test.skip(!!process.env.GRAWLIX_SITE_DIR && process.env.GRAWLIX_SITE_DIR !== 'site',
  'imports unbundled /src modules; runs against site/ only');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// A flat filter and a transform chain, to prove the fallback across both result
// tiers (index-backed flat vs. rich rows). The seeded corpus includes behead
// pairs (CHAIR→HAIR, STAR→TAR) so the transform yields non-empty results.
const FLAT_STACK = [{ tool: 'search', params: { pattern: '*A*' } }];
const TRANSFORM_STACK = [{ tool: 'behead', params: { count: '1' } }];

function compareRun(page, stack) {
  return page.evaluate(async s => {
    const T = window.__grawlixTest;
    await T.pipelineIdle();
    const { getActiveCorpus } = await import('/src/data/merge.js');
    const { executePipeline } = await import('/src/engine/executor.js');
    const { makeToolRow } = await import('/src/engine/tools.js');
    const { runOnWorker } = await import('/src/ui/pipeline-worker.js');

    const corpus = getActiveCorpus();
    const rows = s.map(r => makeToolRow(r.tool, r.params || {}, !!r.grouped));

    const ref = await executePipeline(corpus, rows, {});
    const refNorms = ref.rows.map(r => r.atoms[0].wlEntry.norm);

    const result = await runOnWorker(corpus, rows);
    const gotNorms = result.flat
      ? [...result.indices].map(i => result.corpus.entries[i].norm)
      : result.rows.map(r => r.atoms[0].wlEntry.norm);

    return { refNorms, gotNorms, state: T.pipelineWorkerState() };
  }, stack);
}

async function seedTwoWordlists(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alpha', scores: [90, 80, 70, 65, 55], entries: ['CHAIR', 'HAIR', 'STAR', 'TAR', 'BANANA'],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Beta', scores: [60, 50], entries: ['ARIA', 'PLUM'],
  }));
}

test('main-thread fallback produces correct results after a real worker crash', async ({ page }) => {
  await gotoApp(page);
  await seedTwoWordlists(page);

  // Real-event path: crashWorkerForTest() makes the worker throw uncaught, which
  // should fire the parent Worker's `error` event → onWorkerCrash. We poll
  // crashCount rather than assume the event timing. This is the one test that
  // proves the real event wiring (not just the forced-invoke fallback); it runs
  // cross-browser — if it ever proves flaky on an engine, switch it to
  // forceWorkerCrashForTest() like the other tests.
  await page.evaluate(() => window.__grawlixTest.crashWorkerForTest());
  await expect.poll(
    () => page.evaluate(() => window.__grawlixTest.pipelineWorkerState().crashCount),
    { timeout: 5000 },
  ).toBeGreaterThan(0);

  const flat = await compareRun(page, FLAT_STACK);
  expect(flat.gotNorms.sort()).toEqual(flat.refNorms.sort());
  expect(flat.refNorms.length).toBeGreaterThan(0);

  const transform = await compareRun(page, TRANSFORM_STACK);
  expect(transform.gotNorms.sort()).toEqual(transform.refNorms.sort());
  expect(transform.refNorms.length).toBeGreaterThan(0);
});

test('an in-flight run still settles when the worker crashes mid-flight', async ({ page }) => {
  await gotoApp(page);
  await seedTwoWordlists(page);

  // Dispatch a run, then crash the worker before it can reply. The rescue must
  // re-run on main and resolve the original promise — so the run settles and
  // pipelineIdle() resolves, i.e. the UI doesn't hang. forceWorkerCrashForTest()
  // is deterministic (no dependence on the browser firing `error` within a
  // window), which is what makes the "settles" assertion non-flaky.
  const outcome = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.pipelineIdle();
    const { getActiveCorpus } = await import('/src/data/merge.js');
    const { executePipeline } = await import('/src/engine/executor.js');
    const { makeToolRow } = await import('/src/engine/tools.js');
    const { runOnWorker } = await import('/src/ui/pipeline-worker.js');

    const corpus = getActiveCorpus();
    const rows = [{ tool: 'search', params: { pattern: '*A*' } }]
      .map(r => makeToolRow(r.tool, r.params || {}, false));

    const ref = await executePipeline(corpus, rows, {});
    const refNorms = ref.rows.map(r => r.atoms[0].wlEntry.norm).sort();

    const runPromise = runOnWorker(corpus, rows);
    T.forceWorkerCrashForTest();   // crash before the worker replies
    const result = await runPromise;   // must settle, not hang

    const gotNorms = (result.flat
      ? [...result.indices].map(i => result.corpus.entries[i].norm)
      : result.rows.map(r => r.atoms[0].wlEntry.norm)).sort();

    return { refNorms, gotNorms, aborted: !!result.aborted };
  });

  expect(outcome.aborted).toBe(false);
  expect(outcome.gotNorms).toEqual(outcome.refNorms);
  expect(outcome.refNorms.length).toBeGreaterThan(0);
});

test('two crashes degrade the client to main-thread permanently', async ({ page }) => {
  await gotoApp(page);
  await seedTwoWordlists(page);

  // forceWorkerCrashForTest() is deterministic, so the MAX_CRASHES boundary is
  // exact: not degraded after one crash, degraded after two.
  await page.evaluate(() => window.__grawlixTest.forceWorkerCrashForTest());
  expect(await page.evaluate(() => window.__grawlixTest.pipelineWorkerState()))
    .toMatchObject({ degraded: false, crashCount: 1 });

  await page.evaluate(() => window.__grawlixTest.forceWorkerCrashForTest());
  expect(await page.evaluate(() => window.__grawlixTest.pipelineWorkerState()))
    .toMatchObject({ degraded: true, crashCount: 2 });

  // Degraded runs go to main and must still be correct.
  const flat = await compareRun(page, FLAT_STACK);
  expect(flat.gotNorms.sort()).toEqual(flat.refNorms.sort());
  expect(flat.refNorms.length).toBeGreaterThan(0);
  expect(flat.state.degraded).toBe(true);
});
