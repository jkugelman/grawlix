// Anagram tool's own matching contract. Pipeline mechanics that merely use
// anagram (URL round-trip, gallery clicks, compose, scroller wiring) live in
// ../tools.spec.js — keep this file to the tool, not the pipeline.

const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible, expectGroups } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  // EERIE/EYRIE share four letters but not their multiset — the near-miss
  // that keeps the count-sensitivity test honest. Don't simplify it to a
  // plain pair.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AnagramTool',
    entries: ['lindsey', 'snidely', 'cat', 'act', 'eerie', 'eyrie', 'dog'],
    scores:  [       60,        50,    40,    40,      45,      45,    40],
  }));
}

test('keeps every rearrangement of the param, including the param itself', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'LINDSEY' } }]));

  await expectVisible(page, ['lindsey', 'snidely']);
});

test('a different letter multiset is excluded even when most letters overlap', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'EERIE' } }]));

  await expectVisible(page, ['eerie']);
});

test('an empty param is a no-op — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: '' } }]));

  await expectVisible(page, ['act', 'cat', 'dog', 'eerie', 'eyrie', 'lindsey', 'snidely']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'aCt' } }]));

  await expectVisible(page, ['act', 'cat']);
});

test('grouped: clusters merged entries that share a letter multiset', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AnagramGrouped',
    entries: ['lives', 'elvis', 'levis', 'evils', 'tiger'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));

  await expectGroups(page,
    gs => gs.map(g => g.chains.map(c => c[0]).sort()),
    [['elvis', 'evils', 'levis', 'lives']]);
});

test('grouped: TOPS and POTS share a multiset but not OPT (different length)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'MultisetMatters',
    entries: ['tops', 'pots', 'opt', 'pot', 'top'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));

  await expectGroups(page,
    gs => gs.map(g => g.chains.map(c => c[0]).sort()).sort(),
    [['opt', 'pot', 'top'], ['pots', 'tops']]);
});
