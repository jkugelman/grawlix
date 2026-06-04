const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries spelled from any subset of the input tiles', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Scrabble',
    entries: ['plane', 'rent', 'pear', 'tiger'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'scrabble', params: { tiles: 'PARENTAL' } }]));

  await expectVisible(page, ['pear', 'plane', 'rent']);
});

test('a tile is consumed at the frequency it appears in the input', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Frequency',
    entries: ['pool', 'pop', 'pol'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'scrabble', params: { tiles: 'POL' } }]));
  await expectVisible(page, ['pol'], { ordered: true });
});

test('empty tiles param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'EmptyParam',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'scrabble', params: { tiles: '' } }]));
  await expectVisible(page, ['cat', 'dog']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'CaseInsensitive',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'scrabble', params: { tiles: 'aCt' } }]));
  await expectVisible(page, ['cat'], { ordered: true });
});
