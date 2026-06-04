// Behead tool's own transform contract — drop the first letter to reach
// another wordlist entry, marking the dropped letter on the originator atom.
// Pipeline mechanics that merely use behead (chain sort stability, directional
// divergence after semordnilap, atom truncation) live in ../tools.spec.js —
// keep this file to the tool, not the pipeline.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('../helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeheadTool',
    entries: ['sling', 'ling', 'bread', 'read', 'dog'],
    scores:  [   50,    40,      60,     55,    40],
  }));
}

test('chains an entry with its first-letter-dropped form, dropping entries with no beheaded match', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  await expectVisible(page, [
    ['bread', 'read'],
    ['sling', 'ling'],
  ], { ordered: true });
});

test('marks the dropped first letter on the originator atom only', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  const row = page.locator('.entry-row', { hasText: 'sling' });
  await expect(row.locator('.atom').nth(0).locator('.hl-removed')).toHaveText('s');
  await expect(row.locator('.atom').nth(1).locator('.hl-removed')).toHaveCount(0);
});

test('Count param defaults to 1, pre-filled in the tool row', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  await expect(page.locator('.tool-row-num[data-key="count"]')).toHaveValue('1');
});

test('Count drops that many leading letters and marks them', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'BeheadCount',
    entries: ['chair', 'air', 'stable', 'able'],
    scores:  [   70,    50,      60,     50],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead', params: { count: '2' } }]));

  await expectVisible(page, [
    ['chair', 'air'],
    ['stable', 'able'],
  ], { ordered: true });

  const row = page.locator('.entry-row', { hasText: 'chair' });
  await expect(row.locator('.atom').nth(0).locator('.hl-removed')).toHaveText('ch');
});
