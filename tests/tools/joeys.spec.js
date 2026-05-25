const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries that appear as a subsequence of the input', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Joey',
    entries: ['JOEY', 'JOKE', 'KEY', 'MAJOR', 'ZEBRA'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'MAJORKEY' } }]));

  expect((await visible(page)).sort()).toEqual(['joey', 'joke', 'key', 'major']);
});

test('subsequence order matters — same letters in a different order are not a joey', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OrderMatters',
    entries: ['ACE', 'ECA'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'ABCDEF' } }]));

  expect(await visible(page)).toEqual(['ace']);
});

test('the input itself is excluded — a joey must be shorter than its kangaroo', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'StrictShorter',
    entries: ['MAJORKEY', 'MAJOR'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'MAJORKEY' } }]));

  expect(await visible(page)).toEqual(['major']);
});

test('an empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['CAT', 'DOG'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: '' } }]));

  expect((await visible(page)).sort()).toEqual(['cat', 'dog']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Case',
    entries: ['JOEY'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'mAjOrKeY' } }]));

  expect(await visible(page)).toEqual(['joey']);
});
