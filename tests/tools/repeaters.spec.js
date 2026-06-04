const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries whose first and second halves are identical', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Repeater',
    entries: ['tartar', 'hotshots', 'bonbon', 'cocoa', 'hello'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'repeaters' }]));

  await expectVisible(page, ['bonbon', 'hotshots', 'tartar']);
});

test('odd-length entries are excluded — a repeater requires even length', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OddLen',
    entries: ['abcabc', 'ababa'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'repeaters' }]));

  await expectVisible(page, ['abcabc'], { ordered: true });
});

test('an even-length non-repeater (halves differ) is dropped', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NonRepeater',
    entries: ['murder', 'tartar'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'repeaters' }]));

  await expectVisible(page, ['tartar'], { ordered: true });
});
