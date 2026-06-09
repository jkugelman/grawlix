const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries whose halves are anagrams of each other', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Neckout',
    entries: ['stuckonesneckout', 'intestines', 'hello', 'cards'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  await expectVisible(page, ['intestines', 'stuckonesneckout']);
});

test('a repeater (halves identical) is excluded — that is a different tool', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NoRepeaters',
    entries: ['tartar', 'intestines'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  await expectVisible(page, ['intestines'], { ordered: true });
});

test('odd-length entries are excluded — a neckout requires even length', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OddLen',
    entries: ['hello', 'intestines'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  await expectVisible(page, ['intestines'], { ordered: true });
});

test('halves with different letter multisets are dropped', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NotAnagram',
    entries: ['murder', 'intestines'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  await expectVisible(page, ['intestines'], { ordered: true });
});
