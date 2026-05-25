const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('keeps entries whose halves are anagrams of each other', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Neckout',
    entries: ['STUCKONESNECKOUT', 'INTESTINES', 'HELLO', 'CARDS'],
    scores:  [50, 50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  expect((await visible(page)).sort()).toEqual(['intestines', 'stuckonesneckout']);
});

test('a repeater (halves identical) is excluded — that is a different tool', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NoRepeaters',
    entries: ['TARTAR', 'INTESTINES'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  expect(await visible(page)).toEqual(['intestines']);
});

test('odd-length entries are excluded — a neckout requires even length', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'OddLen',
    entries: ['HELLO', 'INTESTINES'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  expect(await visible(page)).toEqual(['intestines']);
});

test('halves with different letter multisets are dropped', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'NotAnagram',
    entries: ['MURDER', 'INTESTINES'],
    scores:  [50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'neckouts' }]));

  expect(await visible(page)).toEqual(['intestines']);
});
