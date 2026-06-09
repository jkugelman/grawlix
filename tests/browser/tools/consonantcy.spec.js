const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible, expectGroups } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('matches entries sharing the same consonant skeleton in order', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Consonantcy',
    entries: ['bland', 'blend', 'blind', 'blond', 'brand', 'plant'],
    scores:  [50, 50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: 'BLAND' } }]));

  await expectVisible(page, ['bland', 'blend', 'blind', 'blond']);
});

test('consonant order matters — same consonants in a different order do not match', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Order',
    entries: ['star', 'rats', 'tars'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: 'STAR' } }]));

  await expectVisible(page, ['star']);
});

test('Y counts as a consonant', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Y',
    entries: ['cry', 'cray'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: 'CRY' } }]));

  await expectVisible(page, ['cray', 'cry']);
});

test('empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', params: { entry: '' } }]));

  await expectVisible(page, ['cat', 'dog']);
});

test('grouped: clusters entries by consonant skeleton', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'ConsGrouped',
    entries: ['bland', 'blend', 'blond', 'brand', 'plant'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'consonantcy', grouped: true }]));

  await expectGroups(page,
    gs => gs.map(g => g.chains.map(c => c[0]).sort()).sort(),
    [['bland', 'blend', 'blond']]);
});
