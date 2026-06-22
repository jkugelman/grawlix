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

const myEditsForNorm = (page, norm) => page.evaluate(n =>
  window.__grawlixTest.getWordlist('My Edits').entries
    .filter(e => e.entry === n).map(e => e.display).sort(),
  norm);

const importIntoEdits = (page, text) =>
  page.evaluate(t => applyWordlistText(getEditsWordlist(), t, { source: 'mine.txt', silent: true }), text);

const adoptLink = page => page.locator('#atom-popover .atom-pop-adopt-btn');

// ─── Header ──────────────────────────────────────────────────────────────────

test('header and Save button track View / Edit / Rename as fields diverge', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPopoverOnEntry(page, 'ocean');
  const title = page.locator('#atom-popover .atom-pop-title');
  const save = page.locator('#atom-popover .atom-pop-save');
  await expect(title).toHaveText('View entry');
  await expect(save).toHaveText('Save');
  await page.locator('#atom-pop-score').fill('60');
  await expect(title).toHaveText('Edit entry');
  await page.locator('#atom-pop-score').fill('50');
  await expect(title).toHaveText('View entry');
  await page.locator('#atom-pop-entry').fill('oceans');
  await expect(title).toHaveText('Rename entry');
  await expect(save).toHaveText('Rename');
  await page.locator('#atom-pop-entry').fill('ocean');
  await expect(title).toHaveText('View entry');
  await expect(save).toHaveText('Save');
});

test('reopening on a different entry reads View entry, not Rename', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'ocean');
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('View entry');
  await page.keyboard.press('Escape');
  await openPopoverOnEntry(page, 'river');
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('View entry');
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

test('creating an entry that already exists in My Edits is hard-blocked', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('ocean', 50));
  await page.locator('#add-fab').click();
  await page.locator('#atom-pop-entry').fill('ocean');
  await page.locator('#atom-pop-score').fill('50');
  await expect(page.locator('#atom-popover .atom-pop-note--block')).toBeVisible();
  await expect(page.locator('#atom-popover .atom-pop-save')).toBeDisabled();
});

test('staging the existing row for deletion relabels the create popover as Delete', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('ocean', 50));
  await page.locator('#add-fab').click();
  await page.locator('#atom-pop-entry').fill('ocean');
  await page.locator('#atom-pop-score').fill('50');

  await page.locator('.atom-pop-prov-row', { hasText: 'My Edits' }).locator('.atom-pop-prov-trash').click();
  await expect(page.locator('#atom-popover .atom-pop-title')).toHaveText('Delete entry');
  const save = page.locator('#atom-popover .atom-pop-save');
  await expect(save).toHaveText('Delete');
  await expect(save).toBeEnabled();

  await save.click();
  await expect.poll(() => myEditsForNorm(page, 'ocean')).toEqual([]);
});

test('creating an entry that exists only on another wordlist is allowed', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await page.locator('#add-fab').click();
  await page.locator('#atom-pop-entry').fill('ocean');
  await page.locator('#atom-pop-score').fill('70');
  await expect(page.locator('#atom-popover .atom-pop-note--block')).toHaveCount(0);
  await expect(page.locator('#atom-popover .atom-pop-save')).toBeEnabled();
  await page.locator('#atom-popover .atom-pop-save').click();
  // Typed lowercase stores bare (round-trip-stable): the file can't tell it from
  // a bare import, so we reflect that immediately rather than keep a literal.
  await expect.poll(() => myEditsForNorm(page, 'ocean')).toEqual([null]);
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

test('creating a bare entry over a foreign rich keeps the rich visible', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['the IRS'], scores: [40] });
  await page.evaluate(() => window.__grawlixTest.createMyEntry('theirs', 90));
  await expect.poll(() => displaysForNorm(page, 'theirs')).toEqual(['the IRS', 'theirs']);
});

test('the keep-rich copy previews as a second added My Edits row, not a note', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['the IRS'], scores: [40] });
  await page.locator('#add-fab').click();
  await page.locator('#atom-pop-entry').fill('theirs');
  await page.locator('#atom-pop-score').fill('90');

  const added = page.locator('#atom-popover .atom-pop-prov-row--added');
  await expect(added).toHaveCount(2);
  await expect(added.locator('.atom-pop-prov-entry', { hasText: /^the IRS$/ })).toHaveCount(1);
  await expect(added.locator('.atom-pop-prov-entry', { hasText: /^theirs$/ })).toHaveCount(1);
  await expect(page.locator('#atom-popover .atom-pop-note')).toHaveCount(0);
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

test('renaming over a foreign leftover downscores the original to the trash score', async ({ page }) => {
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
  await expect.poll(() => displaysForNorm(page, 'ocean')).toEqual([null]);
});

// ─── Adopt (claim into My Edits) ─────────────────────────────────────────────

test('adopt link adds an unowned entry to My Edits without any edit', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA battery'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'AAA battery');
  await expect(adoptLink(page)).toHaveText('Add to My Edits');
  await expect(page.locator('#atom-popover .atom-pop-save')).toBeDisabled();
  await adoptLink(page).click();
  await expect(adoptLink(page)).toHaveCount(0);   // link hides once staged
  await expect(page.locator('#atom-popover .atom-pop-save')).toBeEnabled();
  await expect(page.locator('#atom-popover .atom-pop-prov-row--added', {
    has: page.locator('.atom-pop-prov-entry', { hasText: /^AAA battery$/ }),
  })).toBeVisible();
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => myEditsForNorm(page, 'aaabattery')).toEqual(['AAA battery']);
});

test('the staged adopt row carries a trash that un-stages it, restoring the link', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA battery'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'AAA battery');
  await adoptLink(page).click();
  const added = page.locator('#atom-popover .atom-pop-prov-row--added', {
    has: page.locator('.atom-pop-prov-entry', { hasText: /^AAA battery$/ }),
  });
  await added.locator('.atom-pop-prov-untrash').click();
  await expect(added).toHaveCount(0);
  await expect(adoptLink(page)).toHaveText('Add to My Edits');
  await expect(page.locator('#atom-popover .atom-pop-save')).toBeDisabled();
});

test('adopt upgrades a bare My Edits entry to the displayed spelling — no sibling left behind', async ({ page }) => {
  await gotoApp(page);
  await importIntoEdits(page, 'aaabond;50\n');
  await addList(page, { name: 'W', entries: ['AAA bond'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'AAA bond');
  await expect(adoptLink(page)).toHaveText('Update My Edits');
  await adoptLink(page).click();
  await expect(page.locator('#atom-popover .atom-pop-prov-row--deleted', {
    has: page.locator('.atom-pop-prov-entry', { hasText: /^aaabond$/ }),
  })).toBeVisible();
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => myEditsForNorm(page, 'aaabond')).toEqual(['AAA bond']);
});

// Regression: the same bare-rename the adopt link does must also happen on a plain
// score edit that bypasses the link, or it appends a concrete same-norm sibling and
// silently leaves the bare (pdfs) behind as a second My Edits entry.
test('a direct score edit on a bare My Edits entry renames it, not duplicates', async ({ page }) => {
  await gotoApp(page);
  await importIntoEdits(page, 'pdfs;40\n');
  await addList(page, { name: 'W', entries: ['PDFs'], scores: [20] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'PDFs');
  await expect(page.locator('#atom-pop-score')).toHaveValue('40');   // My Edits' bare raw, not W's 20
  await page.locator('#atom-pop-score').fill('30');
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => myEditsForNorm(page, 'pdfs')).toEqual(['PDFs']);
});

test('no adopt link when My Edits already owns the displayed entry', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('AAA team', 50));
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'AAA team');
  await expect(adoptLink(page)).toHaveCount(0);
});

test('editing a field replaces the adopt link with a normal enabled Save', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA battery'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'AAA battery');
  await expect(adoptLink(page)).toBeVisible();
  await page.locator('#atom-pop-score').fill('60');
  await expect(adoptLink(page)).toHaveCount(0);
  await expect(page.locator('#atom-popover .atom-pop-save')).toBeEnabled();
});

test('adopt shows an undo toast that restores the prior My Edits state', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA battery'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPopoverOnEntry(page, 'AAA battery');
  await adoptLink(page).click();
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => myEditsForNorm(page, 'aaabattery')).toEqual(['AAA battery']);
  const undo = page.locator('.toast .toast-action');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => myEditsForNorm(page, 'aaabattery')).toEqual([]);
});

test('the trash score setting drives the downscore amount', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['oceam'], scores: [40] });
  await page.locator('#btn-settings').click();
  await page.locator('#trash-score-input').fill('7');
  await page.locator('#trash-score-input').blur();
  await page.locator('#settings-dialog .dialog-close-btn').click();
  await openPopoverOnEntry(page, 'oceam');
  await page.locator('#atom-pop-entry').fill('ocean');
  await page.locator('#atom-popover .atom-pop-save').click();
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('oceam').then(e => e?.score))).toBe(7);
});
