const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addLetterSetFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'LetterSetTest',
    entries: ['OPT', 'POT', 'TOP', 'ACT', 'CAT', 'DOG'],
    scores: [50, 40, 30, 60, 20, 70],
  }));
}

test('clusters merged entries that share a distinct-letter set', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const clusters = groups.map(g => g.lines[0].words.slice().sort()).sort();
  expect(clusters).toEqual([['act', 'cat'], ['opt', 'pot', 'top']]);
  expect(groups.map(g => g.lines[0].count).sort()).toEqual([2, 3]);
});

test('a singleton entry drops — a group needs at least two members', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const allWords = groups.flatMap(g => g.lines[0].words);
  expect(allWords).not.toContain('dog');
});

test('within a group, members sort by score desc then entry asc', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '3' } }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const optGroup = groups.find(g => g.lines[0].words.includes('opt'));
  expect(optGroup.lines[0].words).toEqual(['opt', 'pot', 'top']);
});

test('no size is inert — the row is transparent', async ({ page }) => {
  await gotoApp(page);
  await addLetterSetFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: {} }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  expect(groups).toEqual([]);
  const entries = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  expect(entries.sort()).toEqual(['act', 'cat', 'dog', 'opt', 'pot', 'top']);
});

test('size param constrains clusters to that many distinct letters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SizeTest',
    entries: ['OPT', 'POT', 'AB', 'BA'],
    scores: [50, 40, 30, 20],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_clusters', params: { size: '2' } }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  expect(groups.map(g => g.lines[0].words.slice().sort())).toEqual([['ab', 'ba']]);
});
