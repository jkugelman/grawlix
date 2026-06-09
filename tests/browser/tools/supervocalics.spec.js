const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries where each of A E I O U appears exactly once', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SupervocalicTool',
    entries: ['sequoia', 'education', 'hello', 'banana'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'supervocalics' }]));

  await expectVisible(page, ['education', 'sequoia']);
});

test('a doubled vowel disqualifies an entry — each vowel must appear exactly once', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'DoubledVowels',
    entries: ['aeronautic'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'supervocalics' }]));
  await expectVisible(page, [], { ordered: true });
});

test('Y is not counted as a vowel', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'YNotVowel',
    entries: ['layout'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'supervocalics' }]));
  await expectVisible(page, [], { ordered: true });
});
