// Entry-panel walk: Prev/Next (buttons, Alt+↑/↓, PageUp/Down) step through a set
// without closing, auto-committing the current member as you move. A multi-select
// bounds the walk to those members; a lone open walks the table in order.
// See site/src/ui/entries-table.js EntryPanel.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const ENTRIES = ['alpha', 'bravo', 'charlie', 'delta', 'echo'];

async function setup(page, entries = ENTRIES) {
  await gotoApp(page);
  await page.evaluate(e => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: e, scores: e.map(() => 50),
  }), entries);
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

const row = (page, entry) => page.locator(`.entry-row[data-entry="${entry}"]`);
const panel = page => page.locator('#entry-panel');
const entryInput = page => page.locator('#entry-panel-entry');
const walkpos = page => page.locator('.entry-panel-walkpos');
const prev = page => page.locator('.entry-panel-prev');
const next = page => page.locator('.entry-panel-next');
const myEdits = page => page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries);
const selection = page => page.evaluate(() => window.__grawlixTest.scrollerSelection());

async function openOn(page, entry) {
  await row(page, entry).locator('.atom-entry').click();
  await expect(panel(page)).toBeVisible();
  await expect(entryInput(page)).toHaveValue(entry);
}

test('no-selection open walks the table in order via the Next/Prev buttons', async ({ page }) => {
  await setup(page);
  await openOn(page, 'bravo');

  await next(page).click();
  await expect(entryInput(page)).toHaveValue('charlie');
  await next(page).click();
  await expect(entryInput(page)).toHaveValue('delta');
  await prev(page).click();
  await expect(entryInput(page)).toHaveValue('charlie');
});

test('Alt+Down / Alt+Up step the walk from the keyboard', async ({ page }) => {
  await setup(page);
  await openOn(page, 'bravo');

  await page.keyboard.press('Alt+ArrowDown');
  await expect(entryInput(page)).toHaveValue('charlie');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(entryInput(page)).toHaveValue('bravo');
  await page.keyboard.press('PageDown');
  await expect(entryInput(page)).toHaveValue('charlie');
});

test('the table walk stops at the ends: Prev disabled on the first row, Next on the last', async ({ page }) => {
  await setup(page);
  await openOn(page, 'alpha');
  await expect(prev(page)).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  await openOn(page, 'echo');
  await expect(next(page)).toBeDisabled();
});

test('a multi-select bounds the walk to just those members, with a position', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await row(page, 'charlie').locator('.atom-entry').click({ modifiers: ['Control'] });
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeVisible();

  // Bounded to the two picks, not delta/echo: opened on the cursor (charlie, the
  // last-clicked) is 2 of 2, and Prev reaches alpha then stops at the front.
  await expect(walkpos(page)).toHaveText('2 / 2');
  await expect(next(page)).toBeDisabled();
  await expect(prev(page)).toBeEnabled();

  await prev(page).click();
  await expect(entryInput(page)).toHaveValue('alpha');
  await expect(walkpos(page)).toHaveText('1 / 2');
  await expect(prev(page)).toBeDisabled();
});

test('a multi-select walk moves the cursor but keeps the whole selection highlighted', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await row(page, 'charlie').locator('.atom-entry').click({ modifiers: ['Control'] });
  await page.keyboard.press('Enter');
  await expect(walkpos(page)).toHaveText('2 / 2');   // opened on charlie

  await prev(page).click();                          // step the cursor to alpha
  await expect(entryInput(page)).toHaveValue('alpha');
  // The pick stays selected — a step moves only the cursor, unlike a lone-open walk
  // (below) where the selection tracks the current row.
  await expect.poll(() => selection(page).then(s => [...s].sort())).toEqual(['alpha', 'charlie']);
});

test('walking selects the current entry in the table, so Esc then Enter reopens it', async ({ page }) => {
  await setup(page);
  await openOn(page, 'bravo');
  await next(page).click();
  await expect(entryInput(page)).toHaveValue('charlie');
  await expect.poll(() => selection(page)).toEqual(['charlie']);   // the table tracks the walk

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(entryInput(page)).toHaveValue('charlie');           // reopened the same entry
});

test('moving to another member auto-commits the current edit into My Edits', async ({ page }) => {
  await setup(page);
  await row(page, 'alpha').locator('.atom-len').click();
  await row(page, 'charlie').locator('.atom-entry').click({ modifiers: ['Control'] });
  await page.keyboard.press('Enter');
  await expect(walkpos(page)).toHaveText('2 / 2');   // on charlie

  await page.locator('#entry-panel-comment').fill('c-note');
  await page.keyboard.press('Alt+ArrowUp');          // commit charlie, move to alpha

  await expect(entryInput(page)).toHaveValue('alpha');
  await expect.poll(() => myEdits(page).then(es =>
    es.filter(e => e.entry === 'charlie').map(e => e.comment)
  )).toEqual(['c-note']);
  await expect(page.locator('#entry-panel-comment')).toBeFocused();
  // Lands as a caret, not a selection, so typing appends rather than replacing.
  expect(await page.locator('#entry-panel-comment').evaluate(el => el.selectionStart === el.selectionEnd)).toBe(true);
});
