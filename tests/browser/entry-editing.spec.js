import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function openPopoverOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
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

test('reopening on a different entry reads Edit entry, not Rename', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'ocean');
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Edit entry');
  await page.keyboard.press('Escape');
  await openPopoverOnEntry(page, 'river');
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Edit entry');
  await expect(page.locator('#atom-popover .atom-pop-save')).toHaveText('Save');
});

test('header and Save button read Add entry / Add from the + button', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#add-fab').click();
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Add entry');
  await expect(page.locator('#atom-popover .atom-pop-save')).toHaveText('Add');
});

test('Save is disabled until an edit diverges from the entry, and re-disables on revert', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPopoverOnEntry(page, 'ocean');
  const save = page.locator('#atom-popover .atom-pop-save');
  await expect(save).toBeDisabled();
  await page.locator('#atom-pop-score').fill('60');
  await expect(save).toBeEnabled();
  await page.locator('#atom-pop-score').fill('50');
  await expect(save).toBeDisabled();
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

test('renaming a My Edits entry to a new norm shows a struck delete, not a downscore', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['aaateam'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('AAA team', 'AAA team', 50));
  await openPopoverOnEntry(page, 'AAA team');
  await page.locator('#atom-pop-entry').fill('AAAx team');
  const deleted = page.locator('#atom-popover .atom-pop-prov-row--deleted', {
    has: page.locator('.atom-pop-prov-entry', { hasText: /^AAA team$/ }),
  });
  await expect(deleted).toBeVisible();
  await expect(deleted.locator('.atom-pop-prov-trash')).toHaveCount(0);
  await expect(page.locator('#atom-popover .atom-pop-prov-row--added', {
    has: page.locator('.atom-pop-prov-entry', { hasText: /^AAAx team$/ }),
  })).toBeVisible();
  await expect(page.locator('#atom-popover .atom-pop-prov-row--added', {
    has: page.locator('.atom-pop-prov-entry', { hasText: /^AAA team$/ }),
  })).toHaveCount(0);
});

test('renaming shows an undo toast that restores the original', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ocean', 'ocean', 50));
  await openPopoverOnEntry(page, 'ocean');
  await page.locator('#atom-pop-entry').fill('Ocean');
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => displaysForNorm(page, 'ocean')).toEqual(['Ocean']);
  const undo = page.locator('.toast .toast-action');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => displaysForNorm(page, 'ocean')).toEqual(['ocean']);
});

test('the junk score setting drives the downscore amount', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['oceam'], scores: [40] });
  await page.locator('#btn-settings').click();
  await page.locator('#junk-score-input').fill('7');
  await page.locator('#junk-score-input').blur();
  await page.locator('#settings-dialog .dialog-close-btn').click();
  await openPopoverOnEntry(page, 'oceam');
  await page.locator('#atom-pop-entry').fill('ocean');
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('oceam').then(e => e?.score))).toBe(7);
});
