const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries that read the same forwards and backwards', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PalindromeTool',
    entries: ['racecar', 'kayak', 'noon', 'hello', 'test'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'palindromes' }]));

  await expectVisible(page, ['kayak', 'noon', 'racecar']);
});

test('even-length and odd-length palindromes both match', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PalindromeLen',
    entries: ['abba', 'civic'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'palindromes' }]));
  await expectVisible(page, ['abba', 'civic']);
});
