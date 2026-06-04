const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible, expectGroups } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('matches entries sharing the same vowel sequence in order', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Vowelcy',
    entries: ['poem', 'node', 'hole', 'zone', 'peel', 'code'],
    scores:  [50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: 'POEM' } }]));

  await expectVisible(page, ['code', 'hole', 'node', 'poem', 'zone']);
});

test('vowel order matters — same vowels in a different order do not match', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Order',
    entries: ['tails', 'tials', 'pains'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: 'TAILS' } }]));

  await expectVisible(page, ['pains', 'tails']);
});

test('Y does not count as a vowel', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Y',
    entries: ['cry', 'try'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: 'CRY' } }]));

  await expectVisible(page, ['cry', 'try']);
});

test('empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', params: { entry: '' } }]));

  await expectVisible(page, ['cat', 'dog']);
});

test('grouped: clusters entries by vowel sequence', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'VowGrouped',
    entries: ['poem', 'node', 'hole', 'cat', 'bar'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'vowelcy', grouped: true }]));

  await expectGroups(page,
    gs => gs.map(g => g.chains.map(c => c[0]).sort()).sort(),
    [['bar', 'cat'], ['hole', 'node', 'poem']]);
});
