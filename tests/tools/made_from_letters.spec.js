const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries spelled from any subset of the input letters', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'MadeFromLetters',
    entries: ['PLANE', 'RENT', 'PEAR', 'TIGER'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'made_from_letters', params: { letters: 'PARENTAL' } }]));

  expect((await visible(page)).sort()).toEqual(['pear', 'plane', 'rent']);
});

test('a letter is consumed at the frequency it appears in the input', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Frequency',
    entries: ['POOL', 'POP', 'POL'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'made_from_letters', params: { letters: 'POL' } }]));
  expect(await visible(page)).toEqual(['pol']);
});

test('empty letters param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'EmptyParam',
    entries: ['CAT', 'DOG'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'made_from_letters', params: { letters: '' } }]));
  expect((await visible(page)).sort()).toEqual(['cat', 'dog']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'CaseInsensitive',
    entries: ['CAT', 'DOG'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'made_from_letters', params: { letters: 'aCt' } }]));
  expect(await visible(page)).toEqual(['cat']);
});
