const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries with every letter unique', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'IsogramTool',
    entries: ['dialogue', 'cyberpunk', 'hello', 'eccentric'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'isograms' }]));

  expect((await visible(page)).sort()).toEqual(['cyberpunk', 'dialogue']);
});

test('non-letter characters in an entry are skipped, not counted as repeats', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NonLetters',
    entries: ['jack-o', 'oo-la'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'isograms' }]));

  expect(await visible(page)).toEqual(['jack-o']);
});
