const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries whose first and second halves are identical', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Repeater',
    entries: ['TARTAR', 'HOTSHOTS', 'BONBON', 'COCOA', 'HELLO'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'repeaters' }]));

  expect((await visible(page)).sort()).toEqual(['bonbon', 'hotshots', 'tartar']);
});

test('odd-length entries are excluded — a repeater requires even length', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OddLen',
    entries: ['ABCABC', 'ABABA'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'repeaters' }]));

  expect(await visible(page)).toEqual(['abcabc']);
});

test('an even-length non-repeater (halves differ) is dropped', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NonRepeater',
    entries: ['MURDER', 'TARTAR'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'repeaters' }]));

  expect(await visible(page)).toEqual(['tartar']);
});
