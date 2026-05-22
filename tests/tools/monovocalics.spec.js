const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries whose vowels are all the same letter', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'MonovocalicsTool',
    entries: ['TOOCOOLFORSCHOOL', 'STRENGTHS', 'BANANA', 'HELLO'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'monovocalics' }]));

  expect((await visible(page)).sort()).toEqual(['banana', 'strengths', 'toocoolforschool']);
});

test('an entry with no AEIOU vowel is dropped — Y is not counted', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NoVowels',
    entries: ['RHYTHM', 'SHHH'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'monovocalics' }]));
  expect(await visible(page)).toEqual([]);
});
