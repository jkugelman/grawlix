// My Edits seam — the popover edit/upsert path and the Add-entry/delete
// surface, both of which route through `applyEditsChange` (see
// site/index.html § My Edits: add entry & delete and § Merge & Download).
//
// These tests pin the contract that ALL user edits — whether the underlying
// row was sourced from another wordlist or from My Edits itself — land in
// My Edits, and that the in-place merged-cache patch for ADD/UPDATE/DELETE
// keeps the merged view consistent. The patch (`patchMergedForNorms`) replaces
// a former full-rebuild-on-every-edit and is invisible behaviorally — only
// faster — so two tests guard it directly: one proves the cache is patched in
// place (not discarded), the other proves the patched result equals a full
// rebuild. The reload-then-delete test pins the display-is-null match that a
// reparse produces.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

test('editing a row sourced from another wordlist routes the edit into My Edits', async ({ page }) => {
  await gotoApp(page);

  // Seed a custom wordlist with one entry. My Edits is empty to start.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
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
  ).toEqual([{ entry: 'bagel', display: 'bagel', score: 75, comment: '' }]);

  const source = await page.evaluate(() => window.__grawlixTest.getWordlist('Source'));
  expect(source.entries).toEqual([{ entry: 'bagel', display: null, score: 50, comment: '' }]);

  const merged = await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'));
  expect(merged).toMatchObject({ entry: 'bagel', score: 75, comment: '', wordlist: 'My Edits' });
});

test('popover edits only commit when the user clicks Save', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  const scoreInput = page.locator('#atom-pop-score');
  await expect(scoreInput).toBeVisible();
  await scoreInput.fill('75');

  await scoreInput.press('Tab');
  await expect(page.locator('#atom-pop-comment')).toBeFocused();
  await expect(page.locator('#atom-popover')).toBeVisible();
  // The pending edit previews as an added My Edits row above Source, but nothing
  // is committed until Save — My Edits stays empty.
  await expect(page.locator('.atom-pop-prov tbody .atom-pop-prov-source')).toContainText(['My Edits', 'Source']);
  await expect(page.locator('.atom-pop-prov-row--added')).toBeVisible();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)).toEqual([]);

  await page.locator('#atom-pop-comment').fill('tasty');
  await page.locator('.atom-pop-save').click();
  await expect(page.locator('#atom-popover')).toBeHidden();

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagel', display: 'bagel', score: 75, comment: 'tasty' }]);
});

test('Cancel closes the popover without committing edits', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-score').fill('99');
  await page.locator('.atom-pop-cancel').click();
  await expect(page.locator('#atom-popover')).toBeHidden();

  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)).toEqual([]);
});

test('the provenance table tracks the typed entry and flags the My Edits contributor', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel', 'carrot'], scores: [50, 50],
  }));

  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-score').fill('75');
  await page.locator('.atom-pop-save').click();
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.length)
  ).toBe(1);

  // CARROT is Source-only: one row, no trash (My Edits has nothing to delete here).
  await page.locator('.entry-row[data-entry="carrot"] .atom-score').click();
  await expect(page.locator('.atom-pop-prov tbody .atom-pop-prov-source')).toHaveCount(1);
  await expect(page.locator('.atom-pop-prov tbody .atom-pop-prov-source')).toContainText('Source');
  await expect(page.locator('.atom-pop-prov-trash')).toHaveCount(0);

  // Retyping to bagel lists both contributors; the carrot→bagel rename also
  // previews a bare downscore row for the Source carrot leftover, grouped right
  // under the My Edits bagel row — hence two My Edits rows then Source.
  await page.locator('#atom-pop-entry').fill('bagel');
  await expect(page.locator('.atom-pop-prov tbody .atom-pop-prov-source')).toContainText(['My Edits', 'My Edits', 'Source']);
  await expect(
    page.locator('.atom-pop-prov-row', { hasText: 'My Edits' }).first().locator('.atom-pop-prov-trash')
  ).toBeVisible();

  // A brand-new word has no saved contributor, but the pending edit previews as
  // an added My Edits row — with no trash, since there's nothing saved to delete.
  await page.locator('#atom-pop-entry').fill('NEWWORD');
  await expect(page.locator('.atom-pop-prov-row--added', { hasText: 'NEWWORD' })).toBeVisible();
  await expect(page.locator('.atom-pop-prov-trash')).toHaveCount(0);
});

test('editing the entry text renames the My Edits record', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-score').fill('75');
  await page.locator('.atom-pop-save').click();
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagel', display: 'bagel', score: 75, comment: '' }]);

  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-entry').fill('Bagels');
  await page.locator('.atom-pop-save').click();

  // Renaming a My Edits entry just deletes the original — no second record, and the
  // foreign Source 'bagel' is left untouched (only a foreign rename junks a leftover).
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagels', display: 'Bagels', score: 75, comment: '' }]);
});

test('staging a delete via the row trash strikes it through and is reversible; Save commits it', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  // Create a My Edits override by editing BAGEL's score.
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-score').fill('75');
  await page.locator('#atom-pop-score').press('Enter');
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.length)
  ).toBe(1);

  // Re-open the popover; the provenance table lists both My Edits and Source.
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await expect(page.locator('.atom-pop-prov tbody .atom-pop-prov-source')).toContainText(['My Edits', 'Source']);

  const editsTrash = page.locator('.atom-pop-prov-row', { hasText: 'My Edits' }).locator('.atom-pop-prov-trash');

  // Stage: the My Edits row strikes through, the trash gains its slash, the
  // inputs disable, and the popover stays open (nothing committed yet).
  await editsTrash.click();
  await expect(page.locator('.atom-pop-prov-row--deleted')).toBeVisible();
  await expect(editsTrash).toHaveClass(/staged/);
  await expect(page.locator('#atom-pop-score')).toBeDisabled();
  await expect(page.locator('#atom-popover')).toBeVisible();
  expect(await page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.length)).toBe(1);

  // Clicking again reverses the pending deletion.
  await editsTrash.click();
  await expect(page.locator('.atom-pop-prov-row--deleted')).toHaveCount(0);
  await expect(page.locator('#atom-pop-score')).toBeEnabled();

  // Stage again and Save commits it: My Edits empties, the popover closes, and
  // merged BAGEL falls back to Source's score.
  await editsTrash.click();
  await page.locator('.atom-pop-save').click();
  await expect(page.locator('#atom-popover')).toBeHidden();
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toMatchObject({
    entry: 'bagel', score: 50, comment: '', wordlist: 'Source',
  });
});

test('searching for an unknown entry surfaces an Add-it affordance that lands the entry in My Edits', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Other', entries: ['existing'], scores: [50],
  }));

  await page.locator('.search-bar input[data-key="pattern"]').fill('NEWWORD');
  await expect(page.locator('.entries-empty-add')).toBeVisible();
  await expect(page.locator('.entries-empty-term')).toHaveText(/newword/i);

  await page.locator('.entries-empty-add').click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  await expect(page.locator('#atom-pop-entry')).toHaveValue('NEWWORD');
  await page.locator('#atom-pop-score').fill('60');
  await page.locator('#atom-pop-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'newword', display: 'NEWWORD', score: 60, comment: '' }]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('NEWWORD'))).toMatchObject({
    entry: 'newword', score: 60, comment: '', wordlist: 'My Edits',
  });
});

test('the no-match affordance switches on merge membership: link when the word is in the merge, button when it is not', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Has', entries: ['phantom'], scores: [50],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Other', entries: ['existing'], scores: [50],
  }));
  await scopeTo(page, 'Other');

  const search = page.locator('.search-bar input[data-key="pattern"]');

  await search.fill('phantom');
  await expect(page.locator('.entries-empty-add')).toHaveCount(0);
  await expect(page.locator('.entries-empty-link').first()).toHaveText(/phantom/i);

  await search.fill('ghost');
  await expect(page.locator('.entries-empty-link')).toHaveCount(0);
  await expect(page.locator('.entries-empty-add')).toBeVisible();

  await search.fill('phantom');
  await page.locator('.entries-empty-link').first().click();
  await expect(page.locator('#atom-popover')).toBeVisible();
  await expect(page.locator('#atom-pop-entry')).toHaveValue('phantom');
});

test('the floating + button opens a blank create popover that lands the entry in My Edits', async ({ page }) => {
  await gotoApp(page);

  const fab = page.locator('#add-fab');
  await expect(fab).toBeVisible();
  await fab.click();

  const entryInput = page.locator('#atom-pop-entry');
  await expect(entryInput).toBeFocused();
  await expect(entryInput).toHaveValue('');

  await entryInput.fill('FRESH');
  await page.locator('#atom-pop-score').fill('55');
  await page.locator('#atom-pop-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'fresh', display: 'FRESH', score: 55, comment: '' }]);
});

test('the floating + button seeds the search term only for a literal word that is missing', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));

  const fab = page.locator('#add-fab');
  const search = page.locator('.search-bar input[data-key="pattern"]');
  const entryInput = page.locator('#atom-pop-entry');

  await search.fill('ZYMURGY');
  await fab.click();
  await expect(entryInput).toHaveValue('ZYMURGY');
  await expect(page.locator('#atom-pop-score')).toBeFocused();
  await page.keyboard.press('Escape');

  await search.fill('BAGEL');
  await fab.click();
  await expect(entryInput).toHaveValue('');
  await page.keyboard.press('Escape');

  await search.fill('ZY*GY');
  await fab.click();
  await expect(entryInput).toHaveValue('');
});

test('deleting a My Edits entry shows an undo toast that restores it', async ({ page }) => {
  await gotoApp(page);

  // Setup: an underlying wordlist has BAGEL;50. Editing it via the popover
  // creates a My Edits override (the natural way to populate My Edits with
  // an entry that's visible in the merged view).
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel'], scores: [50],
  }));
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-score').fill('75');
  await page.locator('#atom-pop-score').press('Enter');

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.length)
  ).toBe(1);

  // Re-open the popover, stage the My Edits row's deletion, and Save to commit.
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('.atom-pop-prov-row', { hasText: 'My Edits' }).locator('.atom-pop-prov-trash').click();
  await page.locator('.atom-pop-save').click();

  // My Edits is empty; merged BAGEL falls back to Source's score.
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toMatchObject({
    entry: 'bagel', score: 50, comment: '', wordlist: 'Source',
  });

  // Undo toast appears with an Undo link; click it.
  const undoLink = page.locator('.toast .toast-action');
  await expect(undoLink).toBeVisible();
  await undoLink.click();

  // My Edits' BAGEL is back at 75, merged view follows.
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'bagel', display: 'bagel', score: 75, comment: '' }]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))).toMatchObject({
    entry: 'bagel', score: 75, comment: '', wordlist: 'My Edits',
  });
});

test('a My Edits entry deletes via the popover after a reload reparses its display to null', async ({ page }) => {
  await gotoApp(page);

  // Create a My-Edits-only entry through the Add affordance. On reload it
  // rehydrates from IndexedDB text via parseWordlist, where an all-lowercase
  // entry classifies as plain → display:null. The delete must match that null
  // against the norm-coalesced display (displayOf), not the raw display.
  await page.locator('.search-bar input[data-key="pattern"]').fill('words');
  await page.locator('.entries-empty-add').click();
  await page.locator('#atom-pop-score').fill('40');
  await page.locator('#atom-pop-score').press('Enter');
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([{ entry: 'words', display: 'words', score: 40, comment: '' }]);

  await page.reload();
  // Longer than the 5s default: a post-reload poll absorbs full boot + IDB reparse.
  await expect.poll(
    async () => page.evaluate(() => window.__grawlixTest.getWordlist('My Edits')?.entries ?? null),
    { timeout: 10000 }
  ).toEqual([{ entry: 'words', display: null, score: 40, comment: '' }]);

  const scoreCell = page.locator('.entry-row[data-entry="words"] .atom-score');
  await expect(scoreCell).toBeVisible();
  await scoreCell.click();
  await page.locator('.atom-pop-prov-row', { hasText: 'My Edits' }).locator('.atom-pop-prov-trash').click();
  await page.locator('.atom-pop-save').click();

  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
  ).toEqual([]);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('words'))).toBeNull();
});

test('editing My Edits is reflected in the merged view', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Source', entries: ['bagel', 'carrot'], scores: [50, 60],
  }));

  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await page.locator('#atom-pop-score').fill('75');
  await page.locator('#atom-pop-score').press('Enter');
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries.length)
  ).toBe(1);

  // The worker splices its owned corpus in place for the edit; the merged view
  // now sources BAGEL from My Edits (highest priority).
  await expect.poll(async () =>
    page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'))
  ).toMatchObject({ entry: 'bagel', score: 75, wordlist: 'My Edits' });
});

test('the patched merged cache matches a full rebuild across override, add, rename, and delete', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'A', entries: ['bagel', 'carrot', 'donut'], scores: [50, 60, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'B', entries: ['bagel', 'egg'], scores: [55, 80],
  }));

  // Each mutation hits a different patch branch: override an entry two lists
  // share (BAGEL ∈ A, B), rename one (two-norm move donut→donuts), add a
  // brand-new entry, then delete it.
  await page.evaluate(() => {
    window.__grawlixTest.saveMyEdit('BAGEL', 'BAGEL', 99);
    window.__grawlixTest.saveMyEdit('DONUT', 'DONUTS', 70);
    window.__grawlixTest.saveMyEdit('ZEBRA', 'ZEBRA', 42);
    window.__grawlixTest.deleteMyEdit('ZEBRA');
  });

  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL')))
    .toMatchObject({ score: 99, wordlist: 'My Edits' });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('DONUTS')))
    .toMatchObject({ score: 70, wordlist: 'My Edits' });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('ZEBRA'))).toBeNull();

  // The surgically patched cache must be byte-for-byte what a from-scratch
  // build produces — entries, order, and per-source counts.
  const patched = await page.evaluate(() => window.__grawlixTest.dumpMergedCache());
  const fresh = await page.evaluate(() => window.__grawlixTest.rebuildMergedCache());
  expect(patched).toEqual(fresh);
});
