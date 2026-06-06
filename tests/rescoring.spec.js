// The length-filter axis on a rescore rule. The input-score axis is
// well-trodden; the length axis is a separate branch in `rescoreEntry` that
// catches refactors that drop it.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('a length-filtered rescore rule only rewrites entries whose length matches', async ({ page }) => {
  await gotoApp(page);

  // Two entries with the same score (50) but different lengths: BAGEL is
  // 5 chars, CARROTS is 7. The rule targets length=5 only.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'LenTest', entries: ['BAGEL', 'CARROTS'], scores: [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setRescoreRules('LenTest', [
    { input: '50', length: '5', output: '25', note: '' },
  ]));

  // BAGEL matches the length filter → rescored to 25.
  // CARROTS doesn't → passes through at 50 (rescoreEntry's fall-through).
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toMatchObject({
    entry: 'bagel', score: 25, comment: '', wordlist: 'LenTest',
  });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('CARROTS'))).toMatchObject({
    entry: 'carrots', score: 50, comment: '', wordlist: 'LenTest',
  });
});
