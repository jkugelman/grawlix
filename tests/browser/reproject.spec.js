import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// A sort or score-range change is a VIEW op: the worker re-derives the view over its
// retained join, never re-running. The discriminator is the runId — a reproject leaves it
// unchanged, a re-run advances it. A fetchRows posted after the change is FIFO-ordered
// behind the reproject, so it reads the re-derived order/set with no explicit wait.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function seedCorpus(page) {
  await page.evaluate(() => {
    const entries = [], scores = [];
    for (let i = 0; i < 3000; i++) { entries.push('W' + String(i).padStart(4, '0')); scores.push(10 + (i % 60)); }
    return window.__grawlixTest.addCustomWordlist({ name: 'Big', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
}

async function runFlat(page) {
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'search', params: { pattern: 'W*' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  return page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
}

test('a settled sort change reprojects (runId unchanged) and re-orders the view', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  const before = await runFlat(page);

  await page.evaluate(() => window.__grawlixTest.applySort('score', 'desc'));
  const after = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  const top = await page.evaluate(runId =>
    window.__grawlixTest.fetchWorkerRows(0, 8, runId).then(r => r.rows.map(x => x.score)), before);

  expect(after).toBe(before);                          // reproject, not a re-run
  expect(top).toEqual([...top].sort((a, b) => b - a)); // score-desc order took
});

test('a settled score-range change reprojects (runId unchanged) and refilters the view', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  const before = await runFlat(page);
  const countBefore = await page.evaluate(runId =>
    window.__grawlixTest.fetchWorkerRows(0, 1e9, runId).then(r => r.rows.length), before);

  await page.evaluate(() => {
    const input = document.querySelector('#score-range-input');
    input.value = '60-80';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  const after = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  const filtered = await page.evaluate(runId =>
    window.__grawlixTest.fetchWorkerRows(0, 1e9, runId).then(r => r.rows.map(x => x.score)), before);

  expect(after).toBe(before);                              // reproject, not a re-run
  expect(filtered.length).toBeLessThan(countBefore);       // the filter dropped rows
  expect(filtered.every(s => s >= 60 && s <= 80)).toBe(true);   // only in-range survive
});

// Length rides the same view op as score, but takes a branch score doesn't: it narrows
// the histogram, so handleReproject has to recompute what sort and score-range leave
// alone. The runId is what pins the cheap path — a re-run would re-bin the histogram
// just as correctly, so the histogram assertion alone proves nothing about the path.
test('a settled length change reprojects (runId unchanged) and re-bins the histogram', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const entries = [], scores = [];
    for (let i = 0; i < 2000; i++) {
      const extra = i % 5;
      entries.push('W' + String(i).padStart(4, '0') + 'X'.repeat(extra));   // norm length 5..9
      scores.push(10 + extra * 15);
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Lens', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());
  const before = await runFlat(page);

  const histBefore = await page.evaluate(() => window.__grawlixTest.resultHistogramCounts());
  const countBefore = await page.evaluate(runId =>
    window.__grawlixTest.fetchWorkerRows(0, 1e9, runId).then(r => r.rows.length), before);

  await page.evaluate(() => {
    const input = document.querySelector('#length-range-input');
    input.value = '5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  // Assert the runId BEFORE fetching against it: a re-run retires the old one, so the
  // fetch below would null-deref and bury the actual finding in a TypeError.
  const after = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  expect(after).toBe(before);                             // reproject, not a re-run

  const lengths = await page.evaluate(runId =>
    window.__grawlixTest.fetchWorkerRows(0, 1e9, runId).then(r => r.rows.map(x => x.norm.length)), before);
  const histAfter = await page.evaluate(() => window.__grawlixTest.resultHistogramCounts());
  const sum = a => a.reduce((s, x) => s + x, 0);

  expect(lengths.length).toBeGreaterThan(0);              // else .every() below is vacuous
  expect(lengths.length).toBeLessThan(countBefore);       // the filter dropped rows
  expect(lengths.every(n => n === 5)).toBe(true);         // only in-length survive
  expect(sum(histAfter)).toBeLessThan(sum(histBefore));   // the bars narrowed with the view
});

// A set-preserving rescore reprojects (no re-join), and the flat histogram must re-bucket
// over the new scores — before the fix it kept the run's histogram and silently lagged.
test('a set-preserving rescore re-buckets the flat histogram (no lag)', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);                                                  // Big: scores 10..69
  await page.evaluate(() => window.__grawlixTest.createMyEntry('WZZZZ', 40));   // a My Edits entry to rescore
  const runId = await runFlat(page);

  const before = await page.evaluate(() => window.__grawlixTest.resultHistogramCounts());
  await page.evaluate(() => window.__grawlixTest.rescoreFrom({ norm: 'WZZZZ', display: 'WZZZZ' }, 12));
  await page.waitForFunction(
    b => { const c = window.__grawlixTest.resultHistogramCounts(); return c && JSON.stringify(c) !== b; },
    JSON.stringify(before), { timeout: 3000 });

  const after = await page.evaluate(() => window.__grawlixTest.resultHistogramCounts());
  const runIdAfter = await page.evaluate(() => window.__grawlixTest.lastCompletedRunId());
  const sum = a => a.reduce((s, x) => s + x, 0);

  expect(runIdAfter).toBe(runId);         // reprojected, not re-run
  expect(sum(after)).toBe(sum(before));   // set-preserving: total unchanged
  expect(after).not.toEqual(before);      // the moved score re-bucketed
});

// The sharpest case: changing the filter WHILE a slow tuple join (Umiaq) streams must not
// restart the join — the reproject re-derives the view mid-stream and the run streams on.
test('a score-range change mid-stream reprojects, not restarts (one run, no new partials)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const A = 'ABCDEFG', entries = [], scores = [];
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) for (const e of A) {
      entries.push(a + b + c + d + e); scores.push(10 + (entries.length % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Pents', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.syncWorkerConfig());

  const out = await page.evaluate(async () => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(1);
    const cap = T.captureWorkerGroupPartialsForTest();
    const started = T.setStack([{ tool: 'umiaq', params: { query: 'ABCDE;EDCBA' } }]);

    let streamRunId = null;
    for (let i = 0; i < 400 && streamRunId == null; i++) {
      const p = cap.peek();
      if (p.length) streamRunId = p[0].runId; else await new Promise(r => setTimeout(r, 1));
    }

    const streamingAtChange = !!document.querySelector('#entries-table-panel.pipeline-streaming');
    const input = document.querySelector('#score-range-input');   // change the filter MID-STREAM
    input.value = '40+';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await started;
    await T.pipelineIdle();
    const partialRunIds = [...new Set(cap.stop().map(p => p.runId))];
    T.setWorkerYieldIntervalForTest(30);
    return { streamRunId, finalRunId: T.lastCompletedRunId(), streamingAtChange, partialRunIds };
  });

  expect(out.streamRunId).not.toBeNull();
  expect(out.streamingAtChange).toBe(true);               // the change really landed mid-stream
  expect(out.partialRunIds).toEqual([out.streamRunId]);   // only the one run streamed — no restart
  expect(out.finalRunId).toBe(out.streamRunId);           // the SAME run completed
});
