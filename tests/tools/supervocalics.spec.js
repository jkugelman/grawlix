const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries where each of A E I O U appears exactly once', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SupervocalicTool',
    entries: ['SEQUOIA', 'EDUCATION', 'HELLO', 'BANANA'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'supervocalics' }]));

  expect((await visible(page)).sort()).toEqual(['education', 'sequoia']);
});

test('a doubled vowel disqualifies an entry — each vowel must appear exactly once', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'DoubledVowels',
    entries: ['AERONAUTIC'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'supervocalics' }]));
  expect(await visible(page)).toEqual([]);
});

test('Y is not counted as a vowel', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'YNotVowel',
    entries: ['LAYOUT'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'supervocalics' }]));
  expect(await visible(page)).toEqual([]);
});
