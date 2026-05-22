const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries whose letters are in non-decreasing order, with or without repeats', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AlphabeticalTool',
    entries: ['ABBEY', 'BILLOWY', 'BEEF', 'HELLO', 'BOOK'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'alphabetical' }]));

  expect((await visible(page)).sort()).toEqual(['abbey', 'beef', 'billowy']);
});
