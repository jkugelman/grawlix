const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries whose letters are in non-increasing order, with or without repeats', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'ReverseAlphabeticalTool',
    entries: ['spoofed', 'yuppie', 'wolfed', 'hello', 'cat'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'reverse_alphabetical' }]));

  await expectVisible(page, ['spoofed', 'wolfed', 'yuppie']);
});
