const { test } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('keeps entries whose letters all belong to the input alphabet', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Alphabet',
    entries: ['pop', 'top', 'stoop', 'pear', 'cat'],
    scores:  [50, 50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'restricted_alphabet', params: { letters: 'SPOT' } }]));
  await expectVisible(page, ['pop', 'stoop', 'top']);
});

test('input duplicates are ignored — the alphabet is a set', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SetSemantics',
    entries: ['pop', 'poppy'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'restricted_alphabet', params: { letters: 'OP' } }]));
  await expectVisible(page, ['pop']);
});

test('empty letters is inert — the full merged view passes through', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'EmptyAlphabet',
    entries: ['cat', 'dog'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'restricted_alphabet', params: { letters: '' } }]));
  await expectVisible(page, ['cat', 'dog']);
});
