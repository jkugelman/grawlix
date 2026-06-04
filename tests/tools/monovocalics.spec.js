const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries whose vowels are all the same letter', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'MonovocalicTool',
    entries: ['toocoolforschool', 'strengths', 'banana', 'hello'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'monovocalics' }]));

  await expectVisible(page, ['banana', 'strengths', 'toocoolforschool']);
});

test('Y at the start of a word is a consonant — YOLK is O-monovocalic', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'YAtStart',
    entries: ['yolk', 'yelp', 'yacht', 'year'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'monovocalics' }]));
  await expectVisible(page, ['yacht', 'yelp', 'yolk']);
});

test('Y anywhere else is a vowel — it counts as a second vowel in an AEIOU word', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'YAsVowel',
    entries: ['boytoy', 'baby', 'kayak', 'syrup', 'larynx'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'monovocalics' }]));
  await expectVisible(page, [], { ordered: true });
});

test('a Y-only entry matches as Y-monovocalic; a vowel-less entry drops', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'YOnly',
    entries: ['rhythm', 'gypsy', 'why', 'shhh'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'monovocalics' }]));
  await expectVisible(page, ['gypsy', 'rhythm', 'why']);
});
