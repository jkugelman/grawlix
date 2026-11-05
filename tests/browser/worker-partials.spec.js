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

async function seedCorpus(page, extra = [], prefix = 'W') {
  await page.evaluate(({ count, extra, prefix }) => {
    const entries = [], scores = [];
    for (const e of extra) { entries.push(e); scores.push(50); }
    for (let i = 0; i < count; i++) {
      entries.push(prefix + String(i).padStart(5, '0'));
      scores.push(10 + (i % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
  }, { count: COUNT, extra, prefix });
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

// `AM band` reduces to the family key `be band`, a spelling no row has. The `B` filler
// is what discriminates: it spans b00000..b19999, so collating on the key puts this
// family AFTER all of it while collating on the family's own first member puts it
// first. Any other prefix and both orders agree, and this stops testing anything.
test('a family collates at its own member, not at a family key no row spells', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page, ['AM band', 'AM bands'], 'B');

  const { finalRows } = await runFlat(page, '*');

  const at = norm => finalRows.findIndex(r => r.norm === norm);
  expect(at('amband')).toBeLessThan(at('b00000'));
  expect(at('ambands')).toBeLessThan(at('b00000'));
});

// Typing into the search box fires a run per keystroke, each one a NEW run whose
// first batch lands while lastFlatResult still holds the PREVIOUS run's rows. Order
// matters: `keeping` must be scanned before `keep` so the anchor drops on that first
// batch, which is what reaches for the retained result. Both patterns match all four
// and differ from each other, so neither run is served from the finished cache.
const FAMILY = ['keeping it in-house', 'keep it in-house', 'keeps it in-house', 'kept it in-house'];

test('a new run does not inherit rows from the run it supersedes', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page, FAMILY);

  await runFlat(page, '*tinhouse', { stream: true });
  const second = await runFlat(page, '*itinhouse', { stream: true });

  const norms = second.finalRows.map(r => r.norm);
  expect([...new Set(norms)].sort()).toEqual([...norms].sort());
  expect(norms.length).toBe(FAMILY.length);

  // The streamed snapshot is the authoritative one, so assert there too: a terminal
  // rebuild would mask duplicates that the user actually saw on screen.
  const last = second.partials[second.partials.length - 1];
  const shown = last.firstRows.map(r => r.norm);
  expect([...new Set(shown)]).toEqual(shown);
});

async function runTransform(page, tool, { stream, params = { pattern: '?' } } = {}) {
  return page.evaluate(async ({ tool, stream, params, STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    if (stream) T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerChainPartialsForTest();
    await T.setStack([{ tool, params }]);
    await T.pipelineIdle();
    const partials = capture.stop();
    if (stream) T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const reply = await T.fetchWorkerAllTransformRows(T.lastCompletedRunId());
    const heads = rows => rows.map(c => c.atoms[0].wlEntry.display ?? c.atoms[0].wlEntry.norm);
    return { partials, settled: reply ? heads(reply.rows) : [] };
  }, { tool, stream, params, STREAM_MS, SHIPPED_MS });
}

// `late_twin` (engine/fixture-tools.js) emits `apple` from its `zzapple` seed, after
// the W filler, so the apple family anchors at `apples` and drops to `apple` only on
// the last batch. `applea` is the witness: it falls between the two anchors, so
// `apples` left placed under the stale one stays behind it. The W filler must sort
// between `apples` and `zzapple`, or the drop never spans batches.
const LATE_ANCHOR = ['apple', 'apples', 'applea', 'zzapple'];

test('a transform family whose anchor drops mid-stream is re-placed', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.installFixtureTools());
  await seedCorpus(page, LATE_ANCHOR);

  const { partials, settled } = await runTransform(page, 'late_twin', { stream: true, params: {} });
  const heads = p => p.entries.map(atoms => atoms[0]);

  // Without a snapshot holding `apples` before `apple`, no drop fired and the rest passes vacuously.
  expect(partials.some(p => heads(p).includes('apples') && !heads(p).includes('apple'))).toBe(true);

  // Assert on the last STREAMED snapshot: a post-completion read can be served by a
  // wholesale rebuild that masks a torn stream.
  expect(heads(partials.at(-1)).slice(0, 3)).toEqual(['apple', 'apples', 'applea']);
  expect(settled.slice(0, 3)).toEqual(['apple', 'apples', 'applea']);
});

// The transform tier's half of the same ownership rule, with `pair_map`
// (engine/fixture-tools.js) listing each run's chains. The poison run's one chain
// BAKE → AKE anchors the bake family at "bake"; the run under test yields BAKED and
// BAKEA, correctly anchored at "baked" and "bakea", so BAKEA leads. Inheriting the
// poison run's lower "bake" keeps BAKED ahead instead, and no drop fires to repair it.
const AFFIX_FAMILY = ['BAKE', 'AKE', 'BAKED', 'BAKEA'];
const UNDER_TEST = { pairs: 'baked>bake bakea>bake' };

test('a new transform run does not inherit the anchors of the run it supersedes', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.installFixtureTools());
  await seedCorpus(page, AFFIX_FAMILY);

  const lower = names => names.map(n => n.toLowerCase());
  const baseline = await runTransform(page, 'pair_map', { params: UNDER_TEST });
  expect(lower(baseline.settled)).toEqual(['bakea', 'baked']);

  await runTransform(page, 'pair_map', { params: { pairs: 'bake>ake' } });
  const streamed = await runTransform(page, 'pair_map', { stream: true, params: UNDER_TEST });

  expect(streamed.partials.length).toBeGreaterThan(0);
  const last = streamed.partials[streamed.partials.length - 1];
  expect(lower(last.entries.map(atoms => atoms[0]))).toEqual(lower(baseline.settled));
});
