// Score quick-pick listbox. In the All Wordlists and My Edits scopes a score-cell
// click opens a tier dropdown (one click to retier, routed into My Edits); in a
// single-source scope it still opens the full EntryPanel. See the ScorePicker
// component in site/src/ui/entries-table.js.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const TIERS = [
  { input: '90', note: 'Great' },
  { input: '50', note: 'Okay' },
  { input: '10', note: 'Weak' },
];

async function setup(page, { score = 50 } = {}) {
  await gotoApp(page);
  await page.evaluate(t => window.__grawlixTest.setScoring(t), TIERS);
  await page.evaluate(s => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['bagel'], scores: [s],
  }), score);
}

const picker = page => page.locator('#score-picker');
const toast = page => page.locator('#toast-container .toast');

async function openPicker(page) {
  const cell = page.locator('.entry-row[data-entry="bagel"] .atom-score');
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(picker(page)).toBeVisible();
}

const myEdits = page => page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries);
const mergedBagel = page => page.evaluate(() => window.__grawlixTest.getMergedEntry('BAGEL'));

test('a score click in All Wordlists opens the tier picker, not the panel', async ({ page }) => {
  await setup(page);
  await openPicker(page);
  await expect(page.locator('#entry-panel')).toBeHidden();
});

test('the picker lists every tier high-to-low as score badges, starting on the current one', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPicker(page);

  await expect(page.locator('#score-picker .score-picker-badge')).toHaveText(['90', '50', '10']);
  await expect(page.locator('#score-picker .score-picker-label')).toHaveText(['Great', 'Okay', 'Weak']);

  await expect(page.locator('#score-picker .score-picker-opt', { hasText: 'Okay' }))
    .toHaveAttribute('aria-selected', 'true');
});

test('picking a tier sets the score, routes it into My Edits, and leaves the source untouched', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPicker(page);
  await page.locator('#score-picker .score-picker-opt', { hasText: 'Great' }).click();
  await expect(picker(page)).toBeHidden();
  await expect(toast(page)).toContainText(/Rescored .* to 90/);

  await expect.poll(() => myEdits(page))
    .toEqual([{ entry: 'bagel', display: null, score: 90, comment: '' }]);
  await expect.poll(() => mergedBagel(page)).toMatchObject({ score: 90, wordlist: 'My Edits' });

  const srcEntries = await page.evaluate(() => window.__grawlixTest.dumpSourceEntries('Src'));
  expect(srcEntries).toEqual([{ entry: 'bagel', display: null, score: 50, comment: '' }]);
});

test('the rescore toast undoes the change', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPicker(page);
  await page.locator('#score-picker .score-picker-opt', { hasText: 'Great' }).click();
  await expect.poll(() => mergedBagel(page)).toMatchObject({ score: 90, wordlist: 'My Edits' });

  // bagel came from Src, so undo must delete the created My Edits entry, not write Src's score back.
  await page.locator('#toast-container .toast-action', { hasText: 'Undo' }).click();
  await expect.poll(() => myEdits(page)).toEqual([]);
  await expect.poll(() => mergedBagel(page)).toMatchObject({ score: 50, wordlist: 'Src' });
});

test('arrow keys move the selection and Enter commits it', async ({ page }) => {
  await setup(page, { score: 50 });   // opens with Okay active
  await openPicker(page);
  await page.keyboard.press('ArrowUp');   // → Great
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeHidden();
  await expect.poll(() => mergedBagel(page)).toMatchObject({ score: 90, wordlist: 'My Edits' });
});

test('Escape closes the picker without writing anything', async ({ page }) => {
  await setup(page);
  await openPicker(page);
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
  expect(await myEdits(page)).toEqual([]);
});

test('a between-tiers score starts on the next-lowest tier', async ({ page }) => {
  await setup(page, { score: 22 });   // tiers 90/50/10 → falls between, nearest below is 10
  await openPicker(page);
  await expect(page.locator('#score-picker .score-picker-opt', { hasText: 'Weak' }))
    .toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Enter');
  await expect.poll(() => mergedBagel(page)).toMatchObject({ score: 10, wordlist: 'My Edits' });
});

// Tiers 90/50/10 → hints count up from the bottom: 10→Alt-0, 50→Alt-1, 90→Alt-2.
test('Alt+digit commits the matching tier while the picker is open', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPicker(page);
  await page.keyboard.press('Alt+Digit2');   // top tier, 90
  await expect(picker(page)).toBeHidden();
  await expect(toast(page)).toContainText(/Rescored .* to 90/);
  await expect.poll(() => mergedBagel(page)).toMatchObject({ score: 90, wordlist: 'My Edits' });
});

test('Alt+digit rescores the selected row with no picker', async ({ page }) => {
  await setup(page, { score: 50 });
  // The length cell is non-editable, so clicking it selects the row without side
  // effects (a score-cell click would open the picker instead).
  await page.locator('.entry-row[data-entry="bagel"] .atom-len').click();
  await expect(page.locator('.entry-row[data-entry="bagel"]')).toHaveClass(/selected/);
  await page.keyboard.press('Alt+Digit0');   // bottom tier, 10
  await expect(picker(page)).toBeHidden();
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(toast(page)).toContainText(/Rescored .* to 10/);
  await expect.poll(() => mergedBagel(page)).toMatchObject({ score: 10, wordlist: 'My Edits' });
});

test('Alt+digit with no selection does nothing (hover is not a target)', async ({ page }) => {
  await setup(page, { score: 50 });
  await page.locator('.entry-row[data-entry="bagel"] .atom-entry').hover();
  await page.keyboard.press('Alt+Digit0');
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(toast(page)).toHaveCount(0);
  expect(await myEdits(page)).toEqual([]);
});

test('Alt+digit in the edit panel fills the score field without saving', async ({ page }) => {
  await setup(page, { score: 50 });
  // The entry cell opens the editable panel in All Wordlists (a foreign scope's panel
  // is read-only, so the score field there would be disabled and Alt+digit a no-op).
  await page.locator('.entry-row[data-entry="bagel"] .atom-entry').dblclick();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(page.locator('#entry-panel .score-input')).toBeEnabled();

  await page.keyboard.press('Alt+Digit2');   // 90
  await expect(page.locator('#entry-panel .score-input')).toHaveValue('90');
  expect(await myEdits(page)).toEqual([]);   // not committed until Save
});

test('picking the tier the entry is already in is a no-op', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPicker(page);
  await page.locator('#score-picker .score-picker-opt', { hasText: 'Okay' }).click();
  await expect(picker(page)).toBeHidden();
  expect(await myEdits(page)).toEqual([]);
  await expect(toast(page)).toHaveCount(0);
});

test('in a single-source scope the score cell opens the panel, not the picker', async ({ page }) => {
  await setup(page);
  await scopeTo(page, 'Src');
  await page.locator('.entry-row[data-entry="bagel"] .atom-score').click();
  await expect(page.locator('#entry-panel')).toBeVisible();
  await expect(picker(page)).toBeHidden();
});

test('the picker works in the My Edits scope too', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.__grawlixTest.saveMyEdit('bagel', 'bagel', 50));
  await scopeTo(page, 'My Edits');

  await openPicker(page);
  await page.locator('#score-picker .score-picker-opt', { hasText: 'Great' }).click();
  await expect(picker(page)).toBeHidden();
  await expect.poll(() => myEdits(page))
    .toEqual([{ entry: 'bagel', display: null, score: 90, comment: '' }]);
});

// Regression: a bare My Edits entry (parta) unifies via its null-display wildcard
// with a foreign list's richer spelling (Part A) and wins the merge on that
// spelling. A quick rescore must RENAME the bare to the spelling, not append a
// concrete same-norm sibling that silently leaves the bare behind as a second entry.
test('rescoring a bare My Edits entry shown as a foreign spelling renames it, not duplicates', async ({ page }) => {
  await gotoApp(page);
  // Both scores sit on default tiers so the My Edits import stays pass-through; an
  // off-tier score would auto-seed a rescore rule and remap the merged score.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['Part A'], scores: [20],
  }));
  await page.evaluate(() => window.__grawlixTest.reimport('My Edits', 'parta;40\n'));

  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('Part A', 'Part A')))
    .toMatchObject({ display: 'Part A', score: 40, wordlist: 'My Edits' });

  const cell = page.locator('.entry-row[data-entry="parta"] .atom-score');
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press('ArrowDown');   // 40 → next tier down, 30
  await page.keyboard.press('Enter');
  await expect(picker(page)).toBeHidden();

  await expect.poll(() => myEdits(page))
    .toEqual([{ entry: 'parta', display: 'Part A', score: 30, comment: '' }]);
  await expect.poll(() => page.evaluate(() => window.__grawlixTest.getMergedEntry('Part A', 'Part A')))
    .toMatchObject({ display: 'Part A', score: 30, wordlist: 'My Edits' });
});
