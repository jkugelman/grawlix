import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function openPanelOnEntry(page, entryText) {
  const row = page.locator('#vs-host .entry-row', {
    has: page.locator('.atom-entry', { hasText: new RegExp(`^${entryText}$`) }),
  }).first();
  await row.locator('.atom-entry').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
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

const adoptLink = page => page.locator('#entry-panel .entry-panel-adopt-btn');

// ─── Header ──────────────────────────────────────────────────────────────────

test('header and Save button track View / Edit / Rename as fields diverge', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPanelOnEntry(page, 'ocean');
  const title = page.locator('#entry-panel .entry-panel-title');
  const save = page.locator('#entry-panel .entry-panel-save');
  await expect(title).toHaveText('View entry');
  await expect(save).toHaveText('Save');
  await page.locator('#entry-panel-score').fill('60');
  await expect(title).toHaveText('Edit entry');
  await page.locator('#entry-panel-score').fill('50');
  await expect(title).toHaveText('View entry');
  await page.locator('#entry-panel-entry').fill('oceans');
  await expect(title).toHaveText('Rename entry');
  await expect(save).toHaveText('Rename');
  await page.locator('#entry-panel-entry').fill('ocean');
  await expect(title).toHaveText('View entry');
  await expect(save).toHaveText('Save');
});

test('reopening on a different entry reads View entry, not Rename', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean', 'river'], scores: [50, 50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'ocean');
  await expect(page.locator('#entry-panel .entry-panel-title')).toHaveText('View entry');
  await page.keyboard.press('Escape');
  await openPanelOnEntry(page, 'river');
  await expect(page.locator('#entry-panel .entry-panel-title')).toHaveText('View entry');
  await expect(page.locator('#entry-panel .entry-panel-save')).toHaveText('Save');
});

test('header and Save button read Add entry / Add from the + button', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#add-fab').click();
  await expect(page.locator('#entry-panel .entry-panel-title')).toHaveText('Add entry');
  await expect(page.locator('#entry-panel .entry-panel-save')).toHaveText('Add');
});

test('Save is disabled until an edit diverges from the entry, and re-disables on revert', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPanelOnEntry(page, 'ocean');
  const save = page.locator('#entry-panel .entry-panel-save');
  await expect(save).toBeDisabled();
  await page.locator('#entry-panel-score').fill('60');
  await expect(save).toBeEnabled();
  await page.locator('#entry-panel-score').fill('50');
  await expect(save).toBeDisabled();
});

// ─── Lookup ──────────────────────────────────────────────────────────────────

test('the lookup search links regenerate as the entry text changes', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPanelOnEntry(page, 'ocean');
  const googleLink = page.locator('#entry-panel .lookup-link', { hasText: 'Google' });
  await expect(googleLink).toHaveAttribute('href', /q=ocean$/);
  await page.locator('#entry-panel-entry').fill('oceanic');
  await expect(googleLink).toHaveAttribute('href', /q=oceanic$/);
});

// ─── Create ────────────────────────────────────────────────────────────────

test('creating an entry that already exists in My Edits is hard-blocked', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('ocean', 50));
  await page.locator('#add-fab').click();
  await page.locator('#entry-panel-entry').fill('ocean');
  await page.locator('#entry-panel-score').fill('50');
  await expect(page.locator('#entry-panel .entry-panel-note--block')).toBeVisible();
  await expect(page.locator('#entry-panel .entry-panel-save')).toBeDisabled();
});

test('staging the existing row for deletion relabels the create panel as Delete', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('ocean', 50));
  await page.locator('#add-fab').click();
  await page.locator('#entry-panel-entry').fill('ocean');
  await page.locator('#entry-panel-score').fill('50');

  await page.locator('.entry-panel-prov-row', { hasText: 'My Edits' }).locator('.entry-panel-prov-trash').click();
  await expect(page.locator('#entry-panel .entry-panel-title')).toHaveText('Delete entry');
  const save = page.locator('#entry-panel .entry-panel-save');
  await expect(save).toHaveText('Delete');
  await expect(save).toBeEnabled();

  await save.click();
  await expect.poll(() => myEditsForNorm(page, 'ocean')).toEqual([]);
});

test('creating an entry that exists only on another wordlist is allowed', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await page.locator('#add-fab').click();
  await page.locator('#entry-panel-entry').fill('ocean');
  await page.locator('#entry-panel-score').fill('70');
  await expect(page.locator('#entry-panel .entry-panel-note--block')).toHaveCount(0);
  await expect(page.locator('#entry-panel .entry-panel-save')).toBeEnabled();
  await page.locator('#entry-panel .entry-panel-save').click();
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

test('adding a rich entry does not copy a foreign bare already hidden by a foreign rich spelling', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'Nediger', entries: ['second stomach'], scores: [60] });
  await addList(page, { name: 'Broda', entries: ['secondstomach'], scores: [20] });
  await page.evaluate(() => window.__grawlixTest.createMyEntry('second stomach', 60));
  await expect.poll(() => myEditsForNorm(page, 'secondstomach')).toEqual(['second stomach']);
});

test('the keep-rich copy previews as a second added My Edits row, not a note', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['the IRS'], scores: [40] });
  await page.locator('#add-fab').click();
  await page.locator('#entry-panel-entry').fill('theirs');
  await page.locator('#entry-panel-score').fill('90');

  const added = page.locator('#entry-panel .entry-panel-prov-row--added');
  await expect(added).toHaveCount(2);
  await expect(added.locator('.entry-panel-prov-entry', { hasText: /^the IRS$/ })).toHaveCount(1);
  await expect(added.locator('.entry-panel-prov-entry', { hasText: /^theirs$/ })).toHaveCount(1);
  await expect(page.locator('#entry-panel .entry-panel-note')).toHaveCount(0);
});

// ─── Rename ────────────────────────────────────────────────────────────────

test('renaming an entry replaces it — no second row', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('aaateams', 'aaateams', 50));
  await openPanelOnEntry(page, 'aaateams');
  await page.locator('#entry-panel-entry').fill('AAA teams');
  await page.locator('#entry-panel .entry-panel-save').click();
  await expect.poll(() => displaysForNorm(page, 'aaateams')).toEqual(['AAA teams']);
});

test('the replaced row previews struck through with no trash icon', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ocean', 'ocean', 50));
  await openPanelOnEntry(page, 'ocean');
  await page.locator('#entry-panel-entry').fill('Ocean');
  const deletedRow = page.locator('#entry-panel .entry-panel-prov-row--deleted');
  await expect(deletedRow).toBeVisible();
  await expect(deletedRow.locator('.entry-panel-prov-trash')).toHaveCount(0);
});

test('renaming over a foreign leftover downscores the original to the trash score', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['oceam'], scores: [40] });
  await openPanelOnEntry(page, 'oceam');
  await page.locator('#entry-panel-entry').fill('ocean');
  await expect(page.locator('#entry-panel .entry-panel-prov-row--added', {
    has: page.locator('.entry-panel-prov-entry', { hasText: /^oceam$/ }),
  })).toBeVisible();
  await page.locator('#entry-panel .entry-panel-save').click();
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('oceam').then(e => e?.score))).toBe(0);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('ocean'))).not.toBeNull();
});

test('respelling a My Edits entry junks the foreign spelling it was covering — no duplicate', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA team'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('aaateam', 'aaateam', 60));
  await openPanelOnEntry(page, 'AAA team');
  await page.locator('#entry-panel-entry').fill('AAA. team');
  await page.locator('#entry-panel .entry-panel-save').click();
  await expect.poll(() => displaysForNorm(page, 'aaateam')).toEqual(['AAA team', 'AAA. team']);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('AAA. team', 'AAA. team'))).toMatchObject({ score: 60 });
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('AAA team', 'AAA team'))).toMatchObject({ score: 0, wordlist: 'My Edits' });
});

test('renaming a My Edits entry to a new norm junks the foreign norm-mate it leaves behind', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['aaateam'], scores: [50] });
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('AAA team', 'AAA team', 50));
  await openPanelOnEntry(page, 'AAA team');
  await page.locator('#entry-panel-entry').fill('AAAx team');
  const deleted = page.locator('#entry-panel .entry-panel-prov-row--deleted', {
    has: page.locator('.entry-panel-prov-entry', { hasText: /^AAA team$/ }),
  });
  await expect(deleted).toBeVisible();
  await expect(deleted.locator('.entry-panel-prov-trash')).toHaveCount(0);
  await expect(page.locator('#entry-panel .entry-panel-prov-row--added', {
    has: page.locator('.entry-panel-prov-entry', { hasText: /^AAAx team$/ }),
  })).toBeVisible();
  await page.locator('#entry-panel .entry-panel-save').click();
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('aaateam').then(e => e?.score))).toBe(0);
  expect(await page.evaluate(() => window.__grawlixTest.getMergedEntry('AAAx team'))).not.toBeNull();
});

test('renaming shows an undo toast that restores the original', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('ocean', 'ocean', 50));
  await openPanelOnEntry(page, 'ocean');
  await page.locator('#entry-panel-entry').fill('Ocean');
  await page.locator('#entry-panel .entry-panel-save').click();
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
  await openPanelOnEntry(page, 'AAA battery');
  await expect(adoptLink(page)).toHaveText('Add to My Edits');
  await expect(page.locator('#entry-panel .entry-panel-save')).toBeDisabled();
  await adoptLink(page).click();
  await expect(adoptLink(page)).toHaveCount(0);   // link hides once staged
  await expect(page.locator('#entry-panel .entry-panel-save')).toBeEnabled();
  await expect(page.locator('#entry-panel .entry-panel-prov-row--added', {
    has: page.locator('.entry-panel-prov-entry', { hasText: /^AAA battery$/ }),
  })).toBeVisible();
  await page.locator('#entry-panel .entry-panel-save').click();
  await expect.poll(() => myEditsForNorm(page, 'aaabattery')).toEqual(['AAA battery']);
});

test('the staged adopt row carries a trash that un-stages it, restoring the link', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA battery'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'AAA battery');
  await adoptLink(page).click();
  const added = page.locator('#entry-panel .entry-panel-prov-row--added', {
    has: page.locator('.entry-panel-prov-entry', { hasText: /^AAA battery$/ }),
  });
  await added.locator('.entry-panel-prov-untrash').click();
  await expect(added).toHaveCount(0);
  await expect(adoptLink(page)).toHaveText('Add to My Edits');
  await expect(page.locator('#entry-panel .entry-panel-save')).toBeDisabled();
});

test('adopt upgrades a bare My Edits entry to the displayed spelling — no sibling left behind', async ({ page }) => {
  await gotoApp(page);
  await importIntoEdits(page, 'aaabond;50\n');
  await addList(page, { name: 'W', entries: ['AAA bond'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'AAA bond');
  await expect(adoptLink(page)).toHaveText('Update My Edits');
  await adoptLink(page).click();
  await expect(page.locator('#entry-panel .entry-panel-prov-row--deleted', {
    has: page.locator('.entry-panel-prov-entry', { hasText: /^aaabond$/ }),
  })).toBeVisible();
  await page.locator('#entry-panel .entry-panel-save').click();
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
  await openPanelOnEntry(page, 'PDFs');
  await expect(page.locator('#entry-panel-score')).toHaveValue('40');   // My Edits' bare raw, not W's 20
  await page.locator('#entry-panel-score').fill('30');
  await page.locator('#entry-panel .entry-panel-save').click();
  await expect.poll(() => myEditsForNorm(page, 'pdfs')).toEqual(['PDFs']);
});

test('no adopt link when My Edits already owns the displayed entry', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.createMyEntry('AAA team', 50));
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'AAA team');
  await expect(adoptLink(page)).toHaveCount(0);
});

test('editing a field replaces the adopt link with a normal enabled Save', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA battery'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'AAA battery');
  await expect(adoptLink(page)).toBeVisible();
  await page.locator('#entry-panel-score').fill('60');
  await expect(adoptLink(page)).toHaveCount(0);
  await expect(page.locator('#entry-panel .entry-panel-save')).toBeEnabled();
});

test('adopt shows an undo toast that restores the prior My Edits state', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['AAA battery'], scores: [50] });
  await scopeTo(page, 'All Wordlists');
  await openPanelOnEntry(page, 'AAA battery');
  await adoptLink(page).click();
  await page.locator('#entry-panel .entry-panel-save').click();
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
  await openPanelOnEntry(page, 'oceam');
  await page.locator('#entry-panel-entry').fill('ocean');
  await page.locator('#entry-panel .entry-panel-save').click();
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('oceam').then(e => e?.score))).toBe(7);
});

// ─── Dismissal & the misclick guard ─────────────────────────────────────────────

// The asymmetry below is deliberate, not an oversight to unify: every explicit cancel
// (Escape, the X, Cancel, and browser Back — last in entry-panel-shell.spec.js)
// discards outright; only an outside click, a possible misclick, is refused on a
// dirty panel (it nudges the footer instead of closing).
const explicitCancels = {
  Escape:    page => page.keyboard.press('Escape'),
  'the X':   page => page.locator('#entry-panel .dialog-close-btn').click(),
  Cancel:    page => page.locator('#entry-panel .entry-panel-cancel').click(),
};

for (const [name, dismiss] of Object.entries(explicitCancels)) {
  test(`dismissing a dirty entry panel via ${name} discards outright`, async ({ page }) => {
    await gotoApp(page);
    await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
    await openPanelOnEntry(page, 'ocean');
    await page.locator('#entry-panel-score').fill('60');
    // The score field's tier combo auto-opens on focus and eats the first Escape;
    // blur it so the dismissal reaches the panel (the combo's own Escape is covered
    // in entry-score-combo.spec.js).
    await page.locator('#entry-panel-score').blur();

    await dismiss(page);
    await expect(page.locator('#entry-panel')).toBeHidden();
    await expect.poll(() => myEditsForNorm(page, 'ocean')).toEqual([]);
  });
}

test('an outside click on a dirty entry panel is refused, keeping the edit intact', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPanelOnEntry(page, 'ocean');
  await page.locator('#entry-panel-score').fill('60');
  await page.locator('#entry-panel-score').blur();   // close the auto-opened tier combo (see above)

  await page.locator('#entry-panel-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page.locator('#entry-panel-score')).toHaveValue('60');
  await expect(page.locator('.entry-panel-foot')).toHaveClass(/nudge/);   // pulses toward Save/Cancel
  await expect.poll(() => myEditsForNorm(page, 'ocean')).toEqual([]);
});

test('an outside click on an unedited entry panel closes it immediately', async ({ page }) => {
  await gotoApp(page);
  await addList(page, { name: 'W', entries: ['ocean'], scores: [50] });
  await openPanelOnEntry(page, 'ocean');

  await page.locator('#entry-panel-backdrop').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#entry-panel')).toBeHidden();
});

test('an untouched Add entry panel closes without nagging', async ({ page }) => {
  await gotoApp(page);
  await page.locator('#add-fab').click();
  await expect(page.locator('#entry-panel')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#entry-panel')).toBeHidden();
});
