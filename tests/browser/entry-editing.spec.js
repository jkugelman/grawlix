const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function openPopoverOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-score').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
}

const addList = (page, opts) => page.evaluate(o => window.__grawlixTest.addCustomWordlist(o), opts);

const displaysForNorm = (page, norm) => page.evaluate(async n => {
  const { entries } = await window.__grawlixTest.dumpMergedCache();
  return entries.filter(e => e[0] === n).map(e => e[1]).sort();
}, norm);

// ─── Header ──────────────────────────────────────────────────────────────────

test('header and Save button read Edit/Save, flipping to Rename/Rename as the text diverges', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPopoverOnEntry(page, 'ocean');
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Edit entry');
  await expect(page.locator('#atom-popover .atom-pop-save')).toHaveText('Save');
  await page.locator('#atom-pop-entry').fill('oceans');
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Rename entry');
  await expect(page.locator('#atom-popover .atom-pop-save')).toHaveText('Rename');
  await page.locator('#atom-pop-entry').fill('ocean');
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Edit entry');
  await expect(page.locator('#atom-popover .atom-pop-save')).toHaveText('Save');
});

test('header and Save button read Add entry / Add from the + button', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#add-fab').click();
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Add entry');
  await expect(page.locator('#atom-popover .atom-pop-save')).toHaveText('Add');
});

// ─── Create ────────────────────────────────────────────────────────────────

test('creating an entry that already exists is hard-blocked', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await page.locator('#add-fab').click();
  await page.locator('#atom-pop-entry').fill('ocean');
  await page.locator('#atom-pop-score').fill('50');
  await expect(page.locator('#atom-popover .atom-pop-note--block')).toBeVisible();
  await expect(page.locator('#atom-popover .atom-pop-save')).toBeDisabled();
});

test('creating a same-norm sibling coexists with the existing entry', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('AAA teams', 50));
  await page.evaluate(() => window.__grawlixTest.createMyEntry('Aaa Teams', 60));
  await expect.poll(() => displaysForNorm(page, 'aaateams')).toEqual(['AAA teams', 'Aaa Teams']);
});

test('creating a rich entry over a foreign bare keeps the bare visible', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['theirs'], scores: [40] });
  await page.evaluate(() => window.__grawlixTest.createMyEntry('the IRS', 90));
  await expect.poll(() => displaysForNorm(page, 'theirs')).toEqual(['the IRS', 'theirs']);
});

// ─── Rename ────────────────────────────────────────────────────────────────

test('renaming an entry replaces it — no second row', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('aaateams', 'aaateams', 50));
  await openPopoverOnEntry(page, 'aaateams');
  await page.locator('#atom-pop-entry').fill('AAA teams');
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => displaysForNorm(page, 'aaateams')).toEqual(['AAA teams']);
});

test('the replaced row previews struck through with no trash icon', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ocean', 'ocean', 50));
  await openPopoverOnEntry(page, 'ocean');
  await page.locator('#atom-pop-entry').fill('Ocean');
  const deletedRow = page.locator('#atom-popover .atom-pop-prov-row--deleted');
  await expect(deletedRow).toBeVisible();
  await expect(deletedRow.locator('.atom-pop-prov-trash')).toHaveCount(0);
});

test('renaming over a foreign leftover downscores the original to the junk score', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['oceam'], scores: [40] });
  await openPopoverOnEntry(page, 'oceam');
  await page.locator('#atom-pop-entry').fill('ocean');
  await expect(page.locator('#atom-popover .atom-pop-prov-row--added', {
    has: page.locator('.atom-pop-prov-entry', { hasText: /^oceam$/ }),
  })).toBeVisible();
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('oceam').then(e => e?.score))).toBe(0);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('ocean'))).not.toBeNull();
});
