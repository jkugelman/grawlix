const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries that appear as a subsequence of the input', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Joey',
    entries: ['joey', 'joke', 'key', 'major', 'zebra'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'MAJORKEY' } }]));

  await expectVisible(page, ['joey', 'joke', 'key', 'major']);
});

test('subsequence order matters — same letters in a different order are not a joey', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OrderMatters',
    entries: ['ace', 'eca'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'ABCDEF' } }]));

  await expectVisible(page, ['ace'], { ordered: true });
});

test('the input itself is excluded — a joey must be shorter than its kangaroo', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'StrictShorter',
    entries: ['majorkey', 'major'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'MAJORKEY' } }]));

  await expectVisible(page, ['major'], { ordered: true });
});

test('an empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: '' } }]));

  await expectVisible(page, ['cat', 'dog']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Case',
    entries: ['joey'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'joeys', params: { entry: 'mAjOrKeY' } }]));

  await expectVisible(page, ['joey'], { ordered: true });
});
