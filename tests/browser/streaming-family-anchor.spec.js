import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

// The one streaming spec that drops an anchor mid-stream. The others seed families
// that are never re-anchored, so the pull-back-and-re-merge path they appear to
// cover is dead in them — delete this and it goes untested with all of them green.

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const STREAM_MS = 1;
const SHIPPED_MS = 30;

// Load-bearing corpus, not a sample: `the apple` anchors the family at `apple` yet
// scans last of it, under T, past all the filler, because the anchor drops a leading
// article and the scan does not. `applea` is the witness: it sorts after the family
// only once the anchor has dropped from `apples`. Lose the article and the anchor is
// only ever seeded — the spec still passes while testing nothing.
const FAMILY = ['apples', 'the apple'];
const WITNESS = 'applea';
const FILLER = 14000;

async function seedCorpus(page) {
  await page.evaluate(({ family, witness, filler }) => {
    const entries = [...family, witness], scores = entries.map(() => 50);
    for (let i = 0; i < filler; i++) { entries.push('B' + String(i).padStart(6, '0')); scores.push(10 + (i % 60)); }
    return window.__grawlixTest.addCustomWordlist({ name: 'Apple', entries, scores });
  }, { family: FAMILY, witness: WITNESS, filler: FILLER });
  await page.evaluate(() => window.__grawlixTest.setScope('Apple'));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

async function streamRotation(page) {
  return page.evaluate(async ({ STREAM_MS, SHIPPED_MS }) => {
    const T = window.__grawlixTest;
    T.setWorkerYieldIntervalForTest(STREAM_MS);
    const capture = T.captureWorkerChainPartialsForTest();
    await T.setStack([{ tool: 'regex', params: { pattern: '(.)(.+)', replace: '$2$1', unlisted: true } }]);
    await T.pipelineIdle();
    const partials = capture.stop();
    T.setWorkerYieldIntervalForTest(SHIPPED_MS);
    const last = partials[partials.length - 1];
    return { count: partials.length, total: last ? last.total : 0, seeds: last ? last.entries.map(a => a[0]) : [] };
  }, { STREAM_MS, SHIPPED_MS });
}

test('a streamed transform collates a family at a member it meets late in the scan', async ({ page }) => {
  await gotoApp(page);
  await seedCorpus(page);
  await page.evaluate(() => window.__grawlixTest.applySort('entry', 'asc'));

  const { count, total, seeds } = await streamRotation(page);

  expect(count).toBeGreaterThanOrEqual(1);
  expect(total).toBe(FAMILY.length + 1 + FILLER);
  expect(seeds.slice(0, FAMILY.length + 1)).toEqual([...FAMILY, WITNESS]);
});
