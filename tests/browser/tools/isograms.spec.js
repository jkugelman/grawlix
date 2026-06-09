const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries with every letter unique', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'IsogramTool',
    entries: ['dialogue', 'cyberpunk', 'hello', 'eccentric'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'isograms' }]));

  await expectVisible(page, ['cyberpunk', 'dialogue']);
});

test('non-letter characters in an entry are skipped, not counted as repeats', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NonLetters',
    entries: ['jack-o', 'oo-la'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'isograms' }]));

  await expectVisible(page, ['jack-o'], { ordered: true });
});
