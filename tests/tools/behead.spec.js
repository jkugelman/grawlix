// Behead tool's own transform contract — drop the first letter to reach
// another wordlist entry, marking the dropped letter on the originator atom.
// Pipeline mechanics that merely use behead (chain sort stability, directional
// divergence after semordnilap, atom truncation) live in ../tools.spec.js —
// keep this file to the tool, not the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeheadTool',
    entries: ['SLING', 'LING', 'BREAD', 'READ', 'DOG'],
    scores:  [   50,    40,      60,     55,    40],
  }));
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('chains an entry with its first-letter-dropped form, dropping entries with no beheaded match', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  expect(await visible(page)).toEqual([
    ['bread', 'read'],
    ['sling', 'ling'],
  ]);
});

test('marks the dropped first letter on the originator atom only', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  const row = page.locator('.entry-row', { hasText: 'sling' });
  await expect(row.locator('.atom').nth(0).locator('.hl-removed')).toHaveText('s');
  await expect(row.locator('.atom').nth(1).locator('.hl-removed')).toHaveCount(0);
});
