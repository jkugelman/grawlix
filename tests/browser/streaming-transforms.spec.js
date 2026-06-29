import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// Worker-side streaming for the TRANSFORM tier (Semordnilap): folds mirror pairs
// online so the painted total never snaps smaller, and the terminal result is
// byte-identical to a buffered run. See docs/worker-protocol.md § partialChains.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const STREAM_MS = 1;
const SHIPPED_MS = 30;

// All 5-letter words over a 7-letter alphabet (16807 words). Every word's reverse is
// present (the product is complete), so Semordnilap pairs every non-palindrome with
// its reverse — a scan heavy enough to cross many forced 1ms yields and fold ~8K
// pairs.
async function seedCorpus(page) {
  await page.evaluate(() => {
    const A = 'abcdefg', entries = [], scores = [];
    for (const a of A) for (const b of A) for (const c of A) for (const d of A) for (const e of A) {
      entries.push(a + b + c + d + e);
      scores.push(10 + (entries.length % 60));
    }
    return window.__grawlixTest.addCustomWordlist({ name: 'Quints', entries, scores });
  });
  await page.evaluate(() => window.__grawlixTest.setScope('Quints'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function runTransform(page, { stream } = {}) {
  return page.evaluate(async ({ stream, STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    if (stream) T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerChainPartialsForTest();
    await T.setStack([{ tool: 'semordnilap', params: {} }]);
    await T.pipelineIdle();
    const partials = capture.stop();
    if (stream) T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const reply = await T.fetchWorkerAllTransformRows(T.lastCompletedRunId());
    const rows = reply ? reply.rows.map(c =>
      c.atoms.map(a => (a.glyph || '') + (a.wlEntry.display ?? a.wlEntry.norm)).join(' ')
    ) : [];
    return { partials, rows };
  }, { stream, STREAM_MS, SHIPPED_MS });
}

test('a transform streams partialChains whose total never snaps smaller', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const { partials, rows } = await runTransform(page, { stream: true });

  expect(partials.length).toBeGreaterThanOrEqual(1);   // streaming occurred
  for (const p of partials) expect(p.laneKind).toBe('single');

  // The painted total climbs monotonically — the online fold promotes a mirror in
  // place rather than appending then collapsing, so the count never drops.
  const totals = partials.map(p => p.total);
  for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);

  // Every final row is a folded ↔ mirror pair (two atoms, the second the reverse of
  // the first), so the unify ran and nothing was left as a directed → duplicate.
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows.slice(0, 100)) {
    expect(r).toMatch(/↔/);
    const [, second] = r.split(' ');
    const first = r.split(' ')[0].replace('↔', '');
    expect(second.replace('↔', '')).toBe([...first].reverse().join(''));
  }
});

test('the streamed transform result is byte-identical to the buffered result', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);

  const streamed = await runTransform(page, { stream: true });   // cold → streams
  const buffered = await runTransform(page);                     // warm cache → buffered

  expect(streamed.partials.length).toBeGreaterThanOrEqual(1);
  expect(streamed.rows.length).toBeGreaterThan(0);
  expect(buffered.rows).toEqual(streamed.rows);   // same survivors, same sorted order
});
