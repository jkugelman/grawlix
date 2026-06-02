const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('matches entries sharing the same consonant skeleton in order', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Consonantcy',
    entries: ['bland', 'blend', 'blind', 'blond', 'brand', 'plant'],
    scores:  [50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: 'BLAND' } }]));

  expect((await visible(page)).sort()).toEqual(['bland', 'blend', 'blind', 'blond']);
});

test('consonant order matters — same consonants in a different order do not match', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Order',
    entries: ['star', 'rats', 'tars'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: 'STAR' } }]));

  expect(await visible(page)).toEqual(['star']);
});

test('Y counts as a consonant', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Y',
    entries: ['cry', 'cray'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: 'CRY' } }]));

  expect((await visible(page)).sort()).toEqual(['cray', 'cry']);
});

test('empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: '' } }]));

  expect((await visible(page)).sort()).toEqual(['cat', 'dog']);
});

test('grouped: clusters entries by consonant skeleton', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'ConsGrouped',
    entries: ['bland', 'blend', 'blond', 'brand', 'plant'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', grouped: true }]));

  const groups = await page.evaluate(() => window.__grawlixTest.getVisibleGroups());
  const clusters = groups.map(g => g.chains.map(c => c[0]).sort()).sort();
  expect(clusters).toEqual([['bland', 'blend', 'blond']]);
});
