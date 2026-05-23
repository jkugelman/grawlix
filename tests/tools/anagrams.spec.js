// Anagram tool's own matching contract. Pipeline mechanics that merely use
// anagram (URL round-trip, gallery clicks, compose, scroller wiring) live in
// ../tools.spec.js — keep this file to the tool, not the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  // EERIE/EYRIE share four letters but not their multiset — the near-miss
  // that keeps the count-sensitivity test honest. Don't simplify it to a
  // plain pair.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AnagramTool',
    entries: ['LINDSEY', 'SNIDELY', 'CAT', 'ACT', 'EERIE', 'EYRIE', 'DOG'],
    scores:  [       60,        50,    40,    40,      45,      45,    40],
  }));
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps every rearrangement of the param, including the param itself', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'LINDSEY' } }]));

  expect((await visible(page)).sort()).toEqual(['lindsey', 'snidely']);
});

test('a different letter multiset is excluded even when most letters overlap', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'EERIE' } }]));

  expect(await visible(page)).toEqual(['eerie']);
});

test('an empty param is a no-op — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: '' } }]));

  expect((await visible(page)).sort())
    .toEqual(['act', 'cat', 'dog', 'eerie', 'eyrie', 'lindsey', 'snidely']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'aCt' } }]));

  expect((await visible(page)).sort()).toEqual(['act', 'cat']);
});

test('grouped: clusters merged entries that share a letter multiset', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AnagramGrouped',
    entries: ['LIVES', 'ELVIS', 'LEVIS', 'EVILS', 'TIGER'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  expect(groups.length).toBe(1);
  expect(groups[0].lines[0].words.slice().sort()).toEqual(['elvis', 'evils', 'levis', 'lives']);
});

test('grouped: TOPS and POTS share a multiset but not OPT (different length)', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'MultisetMatters',
    entries: ['TOPS', 'POTS', 'OPT', 'POT', 'TOP'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const clusters = groups.map(g => g.lines[0].words.slice().sort()).sort();
  expect(clusters).toEqual([['opt', 'pot', 'top'], ['pots', 'tops']]);
});
