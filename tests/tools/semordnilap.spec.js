// Semordnilap tool's own transform contract — chain an entry with its reverse
// when the reverse is also an entry, excluding palindromes. The bidirectional
// emit, ↔ unification, and directional divergence are pipeline mechanics and
// live in ../tools.spec.js — keep this file to the tool, not the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('chains an entry with its reversed form, dropping entries with no reverse', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SemordnilapTool',
    entries: ['STAR', 'RATS', 'DEVIL', 'LIVED', 'CAT', 'DOG'],
    scores:  [   50,    50,     70,      60,    40,    40],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  expect(await visible(page)).toEqual([
    ['devil', 'lived'],
    ['rats', 'star'],
  ]);
});

test('excludes palindromes — reversing them yields the same word', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'PalindromeOnly',
    entries: ['RACECAR', 'KAYAK', 'LEVEL'],
    scores:  [50, 50, 50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'semordnilap' }]));

  expect(await visible(page)).toEqual([]);
});
