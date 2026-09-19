import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible, expectGroups } from './helpers.js';

// The marks are re-derived at render time, off the worker's retained result rather
// than the run that produced it, so only a real-worker render proves they survive.

const FREQS = { helen: -5, of: -2, troy: -5, time: -3, is: -2, short: -4, hot: -4, tis: -6 };
const LIST = {
  name: 'Phrases',
  entries: ['helenoftroy', 'Helen of Troy', 'helen of time', 'helen', 'of', 'troy',
            'HOT', 'TIS', 'timeisshort', 'the irate senator', 'time', 'is', 'short'],
  scores: [50, 50, 50, 50, 50, 50, 60, 60, 50, 50, 50, 50, 50],
};

const marksFor = (rows, text) => rows.find(r => r.text === text)?.marks;

// Per member, not per row: a group row holds every member, so its marks are the
// cluster's and say nothing about which member carries them.
function captureMembers(page) {
  return page.evaluate(() => [
    ...document.querySelectorAll('#vs-host .entry-row:not(.skeleton) .atom-entry, #vs-host .group-chain .atom-entry'),
  ].map(el => ({
    text: (el.textContent || '').trim(),
    marks: [...el.querySelectorAll('mark')].map(m => m.textContent),
  })));
}

// Seed the corpus AFTER the wordlist settles: that run has no tool declaring the
// unigram asset, so it evicts whatever was injected before it.
async function seed(page) {
  await gotoApp(page);
  await page.evaluate(w => window.__grawlixTest.addCustomWordlist(w), LIST);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(c => window.__grawlixTest.setWorkerUnigramCorpus(c), FREQS);
}

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('the filter marks a run-together match and leaves a spaced one bare', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'initialisms', params: { word: 'hot' } }]));
  await expectVisible(page, ['helenoftroy', 'Helen of Troy', 'helen of time']);

  const rows = await captureMembers(page);
  expect(marksFor(rows, 'helenoftroy')).toEqual(['h', 'o', 't']);
  expect(marksFor(rows, 'Helen of Troy')).toEqual([]);
  expect(marksFor(rows, 'helen of time')).toEqual([]);
});

test('all-mode marks a run-together member and leaves a spaced one bare', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'initialisms', grouped: true }]));
  await expectGroups(page, gs => gs.flatMap(g => g.chains.map(c => c[0])).sort(),
    ['Helen of Troy', 'helen of time', 'helenoftroy', 'the irate senator', 'timeisshort']);

  const rows = await captureMembers(page);
  expect(marksFor(rows, 'timeisshort')).toEqual(['t', 'i', 's']);
  expect(marksFor(rows, 'helenoftroy')).toEqual(['h', 'o', 't']);
  // Spaced, and its run-together form reads the same initials — so a mark here
  // would mean the tool marked what the spacing already shows.
  expect(marksFor(rows, 'Helen of Troy')).toEqual([]);
  expect(marksFor(rows, 'helen of time')).toEqual([]);
});
