const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries that contain the input as a subsequence with gaps', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Kangaroo',
    entries: ['MILKANDSUGAR', 'KANGAROO', 'HELLO', 'BANGALORE'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'KANGA' } }]));

  expect((await visible(page)).sort()).toEqual(['kangaroo', 'milkandsugar']);
});

test('subsequence order matters — same letters in a different order are not a kangaroo', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OrderMatters',
    entries: ['ABCDEF', 'FEDCBA'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'ACE' } }]));

  expect(await visible(page)).toEqual(['abcdef']);
});

test('the input itself is excluded — a kangaroo must be longer than its joey', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'StrictLonger',
    entries: ['KANGA', 'KANGAS'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'KANGA' } }]));

  expect(await visible(page)).toEqual(['kangas']);
});

test('an empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['CAT', 'DOG'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: '' } }]));

  expect((await visible(page)).sort()).toEqual(['cat', 'dog']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Case',
    entries: ['KANGAROO'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'kAnGa' } }]));

  expect(await visible(page)).toEqual(['kangaroo']);
});
