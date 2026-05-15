// My Edits seam — the popover edit/upsert path and the Add-entry/delete
// surface, both of which route through `patchCachesForEditsChange` (see
// site/index.html § My Edits: add entry & delete and § Mutation helpers).
//
// These tests pin the contract that ALL user edits — whether the underlying
// row was sourced from another wordlist or from My Edits itself — land in
// My Edits, and that the cache patch for ADD/UPDATE/DELETE keeps the
// merged view consistent. The DELETE branch of `patchCachesForEditsChange`
// is the gnarliest piece of code in that section; the undo test is what
// catches a regression there.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('editing a row sourced from another wordlist routes the edit into My Edits', async ({ page }) => {
  await gotoApp(page);

  // Seed a custom wordlist with one entry. My Edits is empty to start.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['BAGEL'], scores: [50],
  }));
  const editsBefore = await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits'));
  expect(editsBefore.entries).toEqual([]);

  // Click the BAGEL row's score cell to open the popover, edit, Enter.
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  const scoreInput = page.locator('#atom-pop-score');
  await expect(scoreInput).toBeVisible();
  await scoreInput.fill('75');
  await scoreInput.press('Enter');

  // My Edits now has BAGEL with the edited score; the Source wordlist is
  // unchanged. The merged view sources BAGEL from My Edits (My Edits sits
  // at index 0 = highest priority).
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagel', score: 75, comment: '' }]);

  const source = await page.evaluate(() => window.__grawlixTest.getWordlist('Source'));
  expect(source.entries).toEqual([{ entry: 'bagel', score: 50, comment: '' }]);

  const merged = await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'));
  expect(merged).toEqual({ entry: 'bagel', score: 75, comment: '', wordlist: 'My Edits' });
});

test('+ Add entry footer creates a brand-new entry in My Edits', async ({ page }) => {
  await gotoApp(page);

  // Add an existing wordlist so the entries table isn't empty (cosmetic —
  // the add-row footer is always present, but having data exercises the
  // ADD branch where the entry is brand-new to *all* wordlists).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Other', entries: ['EXISTING'], scores: [50],
  }));

  // Click the trigger, fill the bar, press Enter.
  await page.locator('.add-row-trigger').click();
  await page.locator('.add-entry-bar .ae-entry').fill('NEWWORD');
  await page.locator('.add-entry-bar .ae-score').fill('60');
  await page.locator('.add-entry-bar .ae-score').press('Enter');

  // My Edits now contains the new entry; merged view exposes it.
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'newword', score: 60, comment: '' }]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('NEWWORD'))).toEqual({
    entry: 'newword', score: 60, comment: '', wordlist: 'My Edits',
  });
});

test('deleting a My Edits entry shows an undo toast that restores it', async ({ page }) => {
  await gotoApp(page);

  // Setup: an underlying wordlist has BAGEL;50. Editing it via the popover
  // creates a My Edits override (the natural way to populate My Edits with
  // an entry that's visible in the merged view).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['BAGEL'], scores: [50],
  }));
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-score').fill('75');
  await page.locator('#atom-pop-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.length)
  ).toBe(1);

  // Now BAGEL is sourced from My Edits → re-clicking the row gives a
  // popover with a Delete button.
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('.atom-pop-delete').click();

  // My Edits is empty; merged BAGEL falls back to Source's score.
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toEqual({
    entry: 'bagel', score: 50, comment: '', wordlist: 'Source',
  });

  // Undo toast appears with an Undo link; click it.
  const undoLink = page.locator('.toast .undo-link');
  await expect(undoLink).toBeVisible();
  await undoLink.click();

  // My Edits' BAGEL is back at 75, merged view follows.
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagel', score: 75, comment: '' }]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toEqual({
    entry: 'bagel', score: 75, comment: '', wordlist: 'My Edits',
  });
});
