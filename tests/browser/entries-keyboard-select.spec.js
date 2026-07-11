// Phase-1 entries-table editing: keyboard navigation, multi-select, and batch
// rescore/delete over the flat tier. Selection is keyed on the atom's
// (norm, display) identity and re-applied every render (see the selection engine
// in site/src/ui/entries-table.js); batch actions merge into one write-set + one
// undo toast (batchRescore / batchDelete in site/src/app/actions.js).

import { test, expect, devices } from '@playwright/test';
import { stubPublisherFetches, gotoApp, scopeTo } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// Three tiers so the Alt+# hint mapping is predictable: 10→Alt-0, 50→Alt-1, 90→Alt-2.
const TIERS = [
  { input: '90', note: 'Great' },
  { input: '50', note: 'Okay' },
  { input: '10', note: 'Weak' },
];

const ENTRIES = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

async function setup(page, { entries = ENTRIES, scope = 'All Wordlists' } = {}) {
  await gotoApp(page);
  await page.evaluate(t => window.__grawlixTest.setScoring(t), TIERS);
  await page.evaluate(e => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: e, scores: e.map(() => 50),
  }), entries);
  if (scope !== 'All Wordlists') await scopeTo(page, scope);
}

const listbox = page => page.locator('.entries-table-rows');
const row = (page, entry) => page.locator(`.entry-row[data-entry="${entry}"]`);
const selection = page => page.evaluate(() => window.__grawlixTest.scrollerSelection());
const myEdits = page => page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries);
const toast = page => page.locator('#toast-container .toast');

test('clicking a non-edit cell selects the row and focuses the listbox', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await expect(row(page, 'alpha')).toHaveClass(/selected/);
  await expect(listbox(page)).toBeFocused();
  expect(await selection(page)).toEqual(['alpha']);
});

test('clicking the comment cell selects the row instead of opening the panel', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(t => window.__grawlixTest.setScoring(t), TIERS);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: ['alpha', 'bravo'], scores: [50, 50], comments: ['a note', 'b note'],
  }));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());

  await row(page, 'alpha').locator('.atom-comment').click();
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(row(page, 'alpha')).toHaveClass(/selected/);
  expect(await selection(page)).toEqual(['alpha']);
});

test('single-click selects the row; double-click opens the panel', async ({ page }) => {
  await setup(page);
  const entryCell = row(page, 'alpha').locator('.atom-entry');

  await entryCell.click();
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(row(page, 'alpha')).toHaveClass(/selected/);

  await entryCell.dblclick();
  await expect(page.locator('#entry-panel')).toBeVisible();
  // Opens with the entry field focused as a caret (no selection), ready to edit.
  await expect(page.locator('#entry-panel-entry')).toBeFocused();
  expect(await page.locator('#entry-panel-entry')
    .evaluate(el => el.selectionStart === el.selectionEnd)).toBe(true);
});

test('the listbox exposes the virtualized-listbox ARIA', async ({ page }) => {
  await setup(page);
  await expect(listbox(page)).toHaveAttribute('role', 'listbox');
  await expect(listbox(page)).toHaveAttribute('aria-multiselectable', 'true');
  await row(page, 'alpha').locator('.atom-len').click();
  const cursorId = await row(page, 'alpha').getAttribute('id');
  await expect(listbox(page)).toHaveAttribute('aria-activedescendant', cursorId);
  await expect(row(page, 'alpha')).toHaveAttribute('role', 'option');
  await expect(row(page, 'alpha')).toHaveAttribute('aria-selected', 'true');
  // posinset/setsize reflect the true result count, not the mounted-row count.
  await expect(row(page, 'alpha')).toHaveAttribute('aria-setsize', String(ENTRIES.length));
});

test('arrow keys move the cursor and reset the selection to it', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await page.keyboard.press('ArrowDown');
  expect(await selection(page)).toHaveLength(1);
  expect(await selection(page)).not.toContain('alpha');
  expect(await page.evaluate(() => window.__grawlixTest.scrollerCursorIndex())).toBe(1);
});

test('Shift+ArrowDown extends a contiguous range', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => selection(page).then(s => s.length)).toBe(3);
  expect(await selection(page)).toContain('alpha');
});

test('Ctrl+click toggles non-contiguous rows in and out', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await row(page, 'charlie').locator('.atom-entry').click({ modifiers: ['Control'] });
  await row(page, 'echo').locator('.atom-entry').click({ modifiers: ['Control'] });
  expect((await selection(page)).sort()).toEqual(['alpha', 'charlie', 'echo']);
  await row(page, 'charlie').locator('.atom-entry').click({ modifiers: ['Control'] });
  expect((await selection(page)).sort()).toEqual(['alpha', 'echo']);
});

test('dragging across rows selects the range, not text', async ({ page }) => {
  await setup(page);
  const order = await page.evaluate(() => window.__grawlixTest.getVisibleEntries());
  const boxA = await row(page, order[0]).boundingBox();
  const boxC = await row(page, order[2]).boundingBox();
  await page.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxC.x + boxC.width / 2, boxC.y + boxC.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => selection(page).then(s => [...s].sort()))
    .toEqual([order[0], order[1], order[2]].sort());
  await expect(page.locator('#entry-panel')).toBeHidden();
  expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
});

test('renaming a selected entry keeps it selected at its new name', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  expect(await selection(page)).toEqual(['alpha']);

  await row(page, 'alpha').locator('.atom-entry').dblclick();
  const entryInput = page.locator('#entry-panel-entry');
  await expect(entryInput).toBeVisible();
  await entryInput.fill('alphax');
  await entryInput.press('Enter');

  await expect.poll(() => selection(page).then(s => [...s].sort())).toEqual(['alphax']);
  await expect(row(page, 'alphax')).toHaveClass(/selected/);
});

test('Ctrl+A selects every row in the view', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await page.keyboard.press('Control+a');
  await expect.poll(() => selection(page).then(s => s.length)).toBe(ENTRIES.length);
});

test('Escape clears the selection', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await row(page, 'bravo').locator('.atom-entry').click({ modifiers: ['Control'] });
  expect(await selection(page)).toHaveLength(2);
  await page.keyboard.press('Escape');
  expect(await selection(page)).toEqual([]);
  await expect(row(page, 'alpha')).not.toHaveClass(/selected/);
});

test('Enter opens the panel and closing returns focus to the listbox', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#entry-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#entry-panel')).toBeHidden();
  await expect(listbox(page)).toBeFocused();
});

test('Alt+# rescores the whole selection in one write-set and one toast', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await row(page, 'charlie').locator('.atom-entry').click({ modifiers: ['Control'] });
  await row(page, 'echo').locator('.atom-entry').click({ modifiers: ['Control'] });

  await page.keyboard.press('Alt+Digit2');   // top tier, 90

  await expect(toast(page)).toContainText('Rescored 3 entries to 90');
  await expect(toast(page)).toHaveCount(1);
  await expect.poll(() => myEdits(page).then(es => es.map(e => e.entry).sort()))
    .toEqual(['alpha', 'charlie', 'echo']);
  expect((await myEdits(page)).every(e => e.score === 90)).toBe(true);
  const src = await page.evaluate(() => window.__grawlixTest.dumpSourceEntries('Src'));
  expect(src.every(e => e.score === 50)).toBe(true);
});

test('the batch rescore toast undoes all of it at once', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await row(page, 'bravo').locator('.atom-entry').click({ modifiers: ['Control'] });
  await page.keyboard.press('Alt+Digit2');
  await expect.poll(() => myEdits(page).then(es => es.length)).toBe(2);

  await page.locator('#toast-container .toast-action', { hasText: 'Undo' }).click();
  // alpha/bravo came from Src, so undo deletes the created My Edits rows entirely.
  await expect.poll(() => myEdits(page)).toEqual([]);
});

test('Delete removes the selection in the My Edits scope, with undo', async ({ page }) => {
  await setup(page, { scope: 'All Wordlists' });
  await page.evaluate(async () => {
    await window.__grawlixTest.saveMyEdit('one', 'one', 50);
    await window.__grawlixTest.saveMyEdit('two', 'two', 50);
    await window.__grawlixTest.saveMyEdit('three', 'three', 50);
  });
  await scopeTo(page, 'My Edits');

  await row(page, 'one').locator('.atom-len').click();
  await row(page, 'three').locator('.atom-entry').click({ modifiers: ['Control'] });
  await page.keyboard.press('Delete');

  await expect(toast(page)).toContainText('Deleted 2 entries');
  await expect.poll(() => myEdits(page).then(es => es.map(e => e.entry).sort())).toEqual(['two']);

  await page.locator('#toast-container .toast-action', { hasText: 'Undo' }).click();
  await expect.poll(() => myEdits(page).then(es => es.map(e => e.entry).sort()))
    .toEqual(['one', 'three', 'two']);
});

test('Delete does nothing outside the My Edits scope', async ({ page }) => {
  await setup(page);   // All Wordlists scope
  await row(page, 'alpha').locator('.atom-len').click();
  await page.keyboard.press('Delete');
  await expect(toast(page)).toHaveCount(0);
  await expect(row(page, 'alpha')).toHaveClass(/selected/);
});

test('a batch selection survives a search that keeps the rows', async ({ page }) => {
  await setup(page, { entries: ['cat', 'catalog', 'category', 'dog'] });
  await row(page, 'cat').locator('.atom-len').click();
  await row(page, 'catalog').locator('.atom-entry').click({ modifiers: ['Control'] });
  expect((await selection(page)).sort()).toEqual(['cat', 'catalog']);

  // Type into the real search input (the reactive re-run path, which reconciles the
  // selection rather than resetting it like a scope change does). "dog" drops out.
  await page.locator('input[data-key="pattern"]').fill('cat*');
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(row(page, 'dog')).toHaveCount(0);
  expect((await selection(page)).sort()).toEqual(['cat', 'catalog']);
  await expect(row(page, 'cat')).toHaveClass(/selected/);
});

// Touch has no double-click, drag, or modifier keys, so the select-first model is
// unreachable — a lone tap opens the panel instead. Chromium-only: firefox/webkit
// reject the mobile device descriptor.
// defaultBrowserType forces a new worker, which a describe-level use() can't set.
const MOBILE_DEVICE = { ...devices['Pixel 5'] };
delete MOBILE_DEVICE.defaultBrowserType;

test.describe('touch (mobile)', () => {
  test.use(MOBILE_DEVICE);
  test.skip(({ browserName }) => browserName !== 'chromium', 'mobile emulation is chromium-only');

  test('a single tap opens the panel instead of selecting the row', async ({ page }) => {
    await setup(page);
    await row(page, 'alpha').locator('.atom-entry').tap();
    await expect(page.locator('#entry-panel')).toBeVisible();
    await expect(row(page, 'alpha')).not.toHaveClass(/selected/);
  });
});
