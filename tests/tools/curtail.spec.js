// Curtail tool's own transform contract — drop the last letter to reach
// another wordlist entry, marking the dropped letter on the originator atom.
// Pipeline mechanics that merely use curtail live in ../tools.spec.js — keep
// this file to the tool, not the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  // CATS/CAT and PRESS/PRES are load-bearing: curtail skips a single trailing
  // s (plural → singular) but NOT a double-s ending. CATS must not chain to
  // CAT even though CAT is a real entry; PRESS must still chain to PRES.
  // Don't drop either pair.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'CurtailTool',
    entries: ['PARTY', 'PART', 'PRESS', 'PRES', 'CATS', 'CAT', 'DOG'],
    scores:  [   60,    55,      50,     45,     40,    40,    40],
  }));
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('chains last-letter-dropped forms, skipping a plural s but keeping a double-s', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'curtail' }]));

  expect(await visible(page)).toEqual([
    ['party', 'part'],
    ['press', 'pres'],
  ]);
});

test('marks the dropped last letter on the originator atom only', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'curtail' }]));

  const row = page.locator('.entry-row', { hasText: 'party' });
  await expect(row.locator('.atom').nth(0).locator('.hl-removed')).toHaveText('y');
  await expect(row.locator('.atom').nth(1).locator('.hl-removed')).toHaveCount(0);
});
