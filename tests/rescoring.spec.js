// Two pieces of the rescoring/scoring surface that no other test covers:
//
//  - The tier-scale uncovered warning bubble on All (the scoring-rule
//    counterpart to the per-wordlist rescore-rule bubble). Same render
//    seam, but driven by `state._scoringUncovered` instead of
//    `wordlist._uncovered` — easy to break independently when the All-card
//    severity logic gets refactored.
//
//  - The length-filter axis on a rescore rule. The input-score axis is
//    well-trodden; the length axis is a separate branch in
//    `rescoreEntry` that catches refactors that drop it.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, openLibrary } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('a merged score not covered by any tier label shows a warning bubble on All and the Library nav', async ({ page }) => {
  await gotoApp(page);

  // Score 55 isn't covered by any default tier rule (defaults are exact
  // values 0, 10, 20, …, 60). Auto-seed creates an inert rescore rule for
  // 55, so it passes through to the merged view — and lands as an
  // uncovered tier score.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OddScore', entries: ['MIDDLING'], scores: [55],
  }));

  // Library nav bubble propagates from `state._scoringUncovered` via
  // `allSeverity()` — verifies the propagation runs without needing to
  // open Library first.
  await expect(
    page.locator('.header-nav-item[data-view="library"] .severity-bubble[data-severity="warning"]')
  ).toBeVisible();

  // Open Library; the All card itself carries the bubble.
  await openLibrary(page);
  const allCard = page.locator('.wordlist-card[data-merged]');
  await expect(allCard.locator('.severity-bubble[data-severity="warning"]')).toBeVisible();
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
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toEqual({
    entry: 'bagel', score: 25, comment: '', wordlist: 'LenTest',
  });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('CARROTS'))).toEqual({
    entry: 'carrots', score: 50, comment: '', wordlist: 'LenTest',
  });
});
