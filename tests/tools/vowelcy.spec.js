const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('matches entries sharing the same vowel sequence in order', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Vowelcy',
    entries: ['POEM', 'NODE', 'HOLE', 'ZONE', 'PEEL', 'CODE'],
    scores:  [50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: 'POEM' } }]));

  expect((await visible(page)).sort()).toEqual(['code', 'hole', 'node', 'poem', 'zone']);
});

test('vowel order matters — same vowels in a different order do not match', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Order',
    entries: ['TAILS', 'TIALS', 'PAINS'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: 'TAILS' } }]));

  expect((await visible(page)).sort()).toEqual(['pains', 'tails']);
});

test('Y does not count as a vowel', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Y',
    entries: ['CRY', 'TRY'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: 'CRY' } }]));

  expect((await visible(page)).sort()).toEqual(['cry', 'try']);
});

test('empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['CAT', 'DOG'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: '' } }]));

  expect((await visible(page)).sort()).toEqual(['cat', 'dog']);
});

test('grouped: clusters entries by vowel sequence', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'VowGrouped',
    entries: ['POEM', 'NODE', 'HOLE', 'CAT', 'BAR'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const clusters = groups.map(g => g.lines[0].words.slice().sort()).sort();
  expect(clusters).toEqual([['bar', 'cat'], ['hole', 'node', 'poem']]);
});
