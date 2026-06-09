const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries whose letters are in non-decreasing order, with or without repeats', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'AlphabeticalTool',
    entries: ['abbey', 'billowy', 'beef', 'hello', 'book'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'alphabetical' }]));

  await expectVisible(page, ['abbey', 'beef', 'billowy']);
});
