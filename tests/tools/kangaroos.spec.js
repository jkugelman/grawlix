const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries that contain the input as a subsequence with gaps', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Kangaroo',
    entries: ['milkandsugar', 'kangaroo', 'hello', 'bangalore'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'KANGA' } }]));

  await expectVisible(page, ['kangaroo', 'milkandsugar']);
});

test('subsequence order matters — same letters in a different order are not a kangaroo', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OrderMatters',
    entries: ['abcdef', 'fedcba'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'ACE' } }]));

  await expectVisible(page, ['abcdef'], { ordered: true });
});

test('the input itself is excluded — a kangaroo must be longer than its joey', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'StrictLonger',
    entries: ['kanga', 'kangas'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'KANGA' } }]));

  await expectVisible(page, ['kangas'], { ordered: true });
});

test('an empty param is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Empty',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: '' } }]));

  await expectVisible(page, ['cat', 'dog']);
});

test('the param is matched case-insensitively', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Case',
    entries: ['kangaroo'],
    scores:  [50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'kangaroos', params: { entry: 'kAnGa' } }]));

  await expectVisible(page, ['kangaroo'], { ordered: true });
});
