const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries that read the same forwards and backwards', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PalindromeTool',
    entries: ['RACECAR', 'KAYAK', 'NOON', 'HELLO', 'TEST'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'palindrome' }]));

  expect((await visible(page)).sort()).toEqual(['kayak', 'noon', 'racecar']);
});

test('even-length and odd-length palindromes both match', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PalindromeLen',
    entries: ['ABBA', 'CIVIC'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'palindrome' }]));
  expect((await visible(page)).sort()).toEqual(['abba', 'civic']);
});
