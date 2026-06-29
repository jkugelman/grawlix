import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The VISIBLE half of streaming: a flat scan's `partial` snapshots drive a
// climbing, correctly-SORTED scroller that reshuffles as better matches arrive,
// and the terminal `result` settles it seamlessly (the incremental merge over a
// total comparator equals a from-scratch sort, so no end-of-stream reshuffle).
// See docs/worker-protocol.md § partial + design.md.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Big enough that the scan spans several yield intervals (so it streams multiple
// batches); a 1ms interval (not 0) keeps the yield count bounded by scan-ms — 0
// starves setTimeout(0) on firefox/webkit into a timeout.
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

test('the scroller row count climbs during the stream and settles at the final count', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const result = await page.evaluate(async ({ STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    // Drive the run WITHOUT awaiting, then sample the live row count as the stream
    // climbs. pipelineIdle resolves only at the terminal result, so sampling must
    // race the in-flight run.
    const runPromise = (async () => {
      await T.setStack([{ tool: 'search', params: { pattern: 'W*' } }]);
      await T.pipelineIdle();
    })();

    const samples = [];
    for (let i = 0; i < 4000; i++) {
      samples.push(T.scrollerRowCount());
      await new Promise(r => setTimeout(r, 0));
      // Stop sampling once the run has settled, but keep the last few climbing
      // samples — the loop naturally tails off as the count plateaus.
      if (samples.length > 8 && samples.slice(-6).every(v => v === samples[samples.length - 1]) && samples[samples.length - 1] > 0) break;
    }

    await runPromise;
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    return { samples, settled: T.scrollerRowCount() };
  }, { STREAM_MS, SHIPPED_MS });

  // Monotonic non-decreasing climb (the sizer only grows during a stream).
  for (let i = 1; i < result.samples.length; i++) {
    expect(result.samples[i]).toBeGreaterThanOrEqual(result.samples[i - 1]);
  }
  // It actually climbed through intermediate values, not one jump to the end.
  const distinct = new Set(result.samples.filter(v => v > 0));
  expect(distinct.size).toBeGreaterThan(1);
  // Settles at the full survivor set (every W***** matches 'W*').
  expect(result.settled).toBe(COUNT);
  // The peak sample never overshot the final count.
  expect(Math.max(...result.samples)).toBeLessThanOrEqual(COUNT);
});

test('the settled rows equal the worker final sorted survivor set (default sort)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const { displayed, workerFinal } = await page.evaluate(async ({ STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    // A pattern matching a real subset so survivors < corpus, exercising the filter.
    await T.setStack([{ tool: 'search', params: { pattern: 'W*0' } }]);
    await T.pipelineIdle();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);

    // The worker's finalized result for this (now completed) run, in shipped order.
    const reply = await T.fetchWorkerRows(0, 1e9);
    const workerFinal = reply.rows.map(r => r.norm);

    // Scroll to the top so the first visible window is positions 0..k, then read
    // the rendered rows — the seamless completion means they match the worker order.
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await T.windowIdle();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const displayed = await T.getVisibleEntries();
    return { displayed, workerFinal };
  }, { STREAM_MS, SHIPPED_MS });

  expect(displayed.length).toBeGreaterThan(0);
  // The visible top window is a prefix of the worker's final SORTED order — the
  // stream painted that order throughout, so completion adds no reshuffle.
  expect(displayed).toEqual(workerFinal.slice(0, displayed.length));
});

test('a superseded stream ends on the second query, with no first-only row', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  // Derive each pattern's survivor set from the worker rather than hand-guessing
  // glob semantics (an earlier "ends in N" guess was wrong — '*' isn't end-anchored).
  const PAT_FIRST = 'W0000*';   // the slow stream we then supersede
  const PAT_SECOND = 'W1111*';  // a disjoint subset that must win

  const sets = await page.evaluate(async ({ PAT_FIRST, PAT_SECOND, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const survivorsFor = async pat => {
      await T.setStack([{ tool: 'search', params: { pattern: pat } }]);
      await T.pipelineIdle();
      const reply = await T.fetchWorkerRows(0, 1e9);
      return reply.rows.map(r => r.norm);
    };
    return { first: await survivorsFor(PAT_FIRST), second: await survivorsFor(PAT_SECOND) };
  }, { PAT_FIRST, PAT_SECOND, SHIPPED_MS });

  const firstOnly = new Set(sets.first.filter(n => !sets.second.includes(n)));
  const secondSet = new Set(sets.second);
  expect(firstOnly.size).toBeGreaterThan(0);   // the two sets really are distinct

  const { displayed, finalCount } = await page.evaluate(async ({ PAT_FIRST, PAT_SECOND, STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);

    // Start the slow stream, then supersede it mid-flight with the second query.
    // setStack awaits its own run, so fire the first WITHOUT awaiting and let it
    // begin streaming before the second setStack supersedes it.
    const first = T.setStack([{ tool: 'search', params: { pattern: PAT_FIRST } }]);
    await new Promise(r => setTimeout(r, 3));   // let the first stream begin
    await T.setStack([{ tool: 'search', params: { pattern: PAT_SECOND } }]);
    await T.pipelineIdle();
    await first.catch(() => {});
    await T.pipelineIdle();

    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    window.scrollTo(0, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await T.windowIdle();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    return { displayed: await T.getVisibleEntries(), finalCount: T.scrollerRowCount() };
  }, { PAT_FIRST, PAT_SECOND, STREAM_MS, SHIPPED_MS });

  // The view settled on the second query: every visible row is a second-query
  // survivor, and none is a row only the first stream would have produced.
  expect(displayed.length).toBeGreaterThan(0);
  for (const norm of displayed) {
    expect(secondSet.has(norm)).toBe(true);
    expect(firstOnly.has(norm)).toBe(false);
  }
  expect(finalCount).toBe(sets.second.length);
});

// Deterministic snapshot rendering: each `partial` is a SORTED top window, and a
// better-sorting row arriving in a later snapshot reshuffles the rendered order —
// proving the client rebuilds the position-keyed cache per snapshot, not appends.
test('each streamed snapshot renders its sorted top window, reshuffling as better rows arrive', async ({ page }) => {
  await gotoApp(page);

  const result = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Mount the scroller (a default search renders a real corpus into #vs-host).
    await T.addCustomWordlist({ name: 'Mount', entries: ['AAA'], scores: [50] });
    await T.pipelineIdle();

    const mk = d => ({ norm: d, display: d, score: 50, atoms: [{}] });
    const wh = { maxDisplayLen: 2, maxLenDigits: 1, maxScoreDigits: 2, maxRawDigits: 0 };

    T.streamSyntheticBatch({
      runId: 'reshuffle', version: 1, total: 5,
      firstRows: ['AA', 'CC', 'EE', 'GG', 'II'].map(mk), widthHints: wh,
    });
    await frame();
    const snap1 = await T.getVisibleEntries();

    // 'BB' arrives and sorts into position 2; the snapshot reshuffles around it.
    T.streamSyntheticBatch({
      runId: 'reshuffle', version: 2, total: 6,
      firstRows: ['AA', 'BB', 'CC', 'EE', 'GG', 'II'].map(mk), widthHints: wh,
    });
    await frame();
    const snap2 = await T.getVisibleEntries();

    return { snap1, snap2 };
  });

  expect(result.snap1.slice(0, 5)).toEqual(['AA', 'CC', 'EE', 'GG', 'II']);
  expect(result.snap2.slice(0, 6)).toEqual(['AA', 'BB', 'CC', 'EE', 'GG', 'II']);
});

// Family-demarcation brackets render DURING the stream under the Entry sort (each
// streamed row carries its own familyStart flag) and reshuffle as a family gains
// members — the bracket grows, the old end-cap becomes a mid-member.
test('family brackets render mid-stream and grow as members arrive', async ({ page }) => {
  await gotoApp(page);

  const result = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await T.addCustomWordlist({ name: 'Mount', entries: ['AAA'], scores: [50] });
    await T.pipelineIdle();

    const mk = (d, familyStart) => ({ norm: d, display: d, score: 50, familyStart, atoms: [{}] });
    const wh = { maxDisplayLen: 2, maxLenDigits: 1, maxScoreDigits: 2, maxRawDigits: 0 };
    const readFam = () => [...document.querySelectorAll('#vs-host .entry-row')].map(r => ({
      text: (r.querySelector('.atom-entry')?.textContent || '').trim(),
      start: r.classList.contains('fam-start'),
      member: r.classList.contains('fam-member'),
      end: r.classList.contains('fam-end'),
    }));

    // Families [AA,AB] and [CC,CD,CE] plus a singleton ZZ.
    T.streamSyntheticBatch({
      runId: 'fam', version: 1, total: 6,
      firstRows: [mk('AA', true), mk('AB', false), mk('CC', true), mk('CD', false), mk('CE', false), mk('ZZ', true)],
      widthHints: wh,
    });
    await frame();
    const snap1 = readFam();

    // A new member AC joins family 1 — the bracket grows.
    T.streamSyntheticBatch({
      runId: 'fam', version: 2, total: 7,
      firstRows: [mk('AA', true), mk('AB', false), mk('AC', false), mk('CC', true), mk('CD', false), mk('CE', false), mk('ZZ', true)],
      widthHints: wh,
    });
    await frame();
    const snap2 = readFam();

    return { snap1, snap2 };
  });

  const s1 = Object.fromEntries(result.snap1.map(r => [r.text, r]));
  expect(s1.AA).toMatchObject({ start: true, member: true, end: false });
  expect(s1.AB).toMatchObject({ start: false, member: true, end: true });
  expect(s1.CC).toMatchObject({ start: true, member: true, end: false });
  expect(s1.CD).toMatchObject({ start: false, member: true, end: false });
  expect(s1.CE).toMatchObject({ start: false, member: true, end: true });
  expect(s1.ZZ).toMatchObject({ start: false, member: false, end: false });   // singleton: no bracket

  const s2 = Object.fromEntries(result.snap2.map(r => [r.text, r]));
  expect(s2.AA).toMatchObject({ start: true, member: true, end: false });
  expect(s2.AB).toMatchObject({ start: false, member: true, end: false });    // was the end cap, now mid
  expect(s2.AC).toMatchObject({ start: false, member: true, end: true });     // the new end cap
});
