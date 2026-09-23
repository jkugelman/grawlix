import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

// A bare list carries no spacing, so the word-relative modes have nothing to gate on
// without the segmenter. Only a real-worker run proves the three pieces together: the
// table builds behind the busy state, the render-time marks replay against it, and
// the corpus is resident exactly while a mode needs it.

const FREQS = { data: -3, table: -3, the: -2, irs: -6, theirs: -4, cat: -3, food: -3, copycat: -4 };
const ENTRIES = ['datatable', 'theirs', 'catfood', 'copycat', 'cat', 'food', 'data', 'table', 'the', 'irs'];
const LIST = { name: 'Bare', entries: ENTRIES, scores: ENTRIES.map(() => 50) };

const setStack = (page, stack) => page.evaluate(s => window.__grawlixTest.setStack(s), stack);
const assetState = page => page.evaluate(() => window.__grawlixTest.workerAssetState());
const captureMarks = page => page.evaluate(() => [
  ...document.querySelectorAll('#vs-host .entry-row:not(.skeleton) .atom-entry'),
].map(el => ({
  text: (el.textContent || '').trim(),
  marks: [...el.querySelectorAll('mark')].map(m => m.textContent),
})));

async function seed(page) {
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), LIST);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), FREQS);
}

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('spans words reads a bare entry through the segmenter and marks the crossing', async ({ page }) => {
  await seed(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'at', mode: 'span' } }]);
  await expectVisible(page, ['datatable']);
  const rows = await captureMarks(page);
  expect(rows.find(r => r.text === 'datatable')?.marks).toEqual(['at']);
});

test('whole word reads a bare entry through the segmenter', async ({ page }) => {
  await seed(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'cat', mode: 'word' } }]);
  await expectVisible(page, ['cat', 'catfood']);
});

test('the corpus stays resident while a mode needs it and is freed when the mode goes', async ({ page }) => {
  await seed(page);
  await setStack(page, [{ tool: 'search', params: { pattern: 'at', mode: 'span' } }]);
  await expectVisible(page, ['datatable']);
  expect((await assetState(page)).unigrams).toBe(true);

  await setStack(page, [{ tool: 'search', params: { pattern: 'at' } }]);
  await expectVisible(page, ['datatable', 'catfood', 'copycat', 'cat', 'data']);
  await expect.poll(() => assetState(page).then(s => s.unigrams)).toBe(false);
});
