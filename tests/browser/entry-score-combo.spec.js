// The entry panel's Score combo box (ScoreCombo in site/src/ui/entries-table.js):
// the tier list drops in on focus; pick a tier or type any score; nothing commits
// until Save/Enter.

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
  await scopeTo(page, 'All Wordlists');
}

const panel = page => page.locator('#entry-panel');
const scoreInput = page => page.locator('#entry-panel-score');
const list = page => page.locator('#entry-panel-score-list');
const opts = page => page.locator('#entry-panel-score-list .score-picker-opt');
const save = page => page.locator('#entry-panel .entry-panel-save');
const confirm = page => page.locator('#confirm-dialog');
const myEdits = page => page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries);

async function openPanel(page) {
  const cell = page.locator('.entry-row[data-entry="bagel"] .atom-entry');
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(panel(page)).toBeVisible();
  await expect(scoreInput(page)).toBeEnabled();
}

test('focusing the Score field drops the tier list below it, current tier marked', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPanel(page);
  await expect(list(page)).toBeHidden();

  await scoreInput(page).focus();
  await expect(list(page)).toBeVisible();
  await expect(opts(page).locator('.score-picker-badge')).toHaveText(['90', '50', '10']);
  await expect(opts(page).locator('.score-picker-label')).toHaveText(['Great', 'Okay', 'Weak']);
  await expect(page.locator('#entry-panel-score-list .score-picker-opt', { hasText: 'Okay' }))
    .toHaveAttribute('aria-selected', 'true');
});

test('picking a tier fills the score box but does not commit until Save', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPanel(page);
  await scoreInput(page).focus();
  await page.locator('#entry-panel-score-list .score-picker-opt', { hasText: 'Great' }).click();

  await expect(list(page)).toBeHidden();
  await expect(scoreInput(page)).toHaveValue('90');
  await expect(panel(page).locator('.entry-panel-title')).toHaveText('Edit entry');
  expect(await myEdits(page)).toEqual([]);   // filled, not committed

  await save(page).click();
  await expect.poll(() => myEdits(page))
    .toEqual([{ entry: 'bagel', display: null, score: 90, comment: '' }]);
});

test('a freely-typed non-tier score is saved as-is, not snapped to a tier', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPanel(page);
  await scoreInput(page).fill('55');
  await save(page).click();
  await expect.poll(() => myEdits(page))
    .toEqual([{ entry: 'bagel', display: null, score: 55, comment: '' }]);
});

test('Enter keeps a freely-typed value instead of snapping to the highlighted tier', async ({ page }) => {
  await setup(page, { score: 50 });
  await openPanel(page);
  await scoreInput(page).fill('55');   // list open, highlight tracks Okay (≥50), but not navigated-to
  await expect(list(page)).toBeVisible();

  await scoreInput(page).press('Enter');
  await expect(panel(page)).toBeHidden();
  await expect.poll(() => myEdits(page))
    .toEqual([{ entry: 'bagel', display: null, score: 55, comment: '' }]);
});

test('arrowing onto a tier and pressing Enter fills that tier without committing', async ({ page }) => {
  await setup(page, { score: 50 });   // opens on Okay
  await openPanel(page);
  await scoreInput(page).focus();            // list open, Okay highlighted
  await scoreInput(page).press('ArrowUp');   // Okay → Great
  await scoreInput(page).press('Enter');

  await expect(list(page)).toBeHidden();
  await expect(scoreInput(page)).toHaveValue('90');
  await expect(panel(page)).toBeVisible();   // the pick fills, it does not save
  expect(await myEdits(page)).toEqual([]);
});

test('Escape dismisses the open list first, regardless of unsaved changes', async ({ page }) => {
  await setup(page);
  await openPanel(page);
  await scoreInput(page).fill('60');   // dirty edit, list open
  await expect(list(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(list(page)).toBeHidden();
  await expect(confirm(page)).toBeHidden();
  await expect(panel(page)).toBeVisible();
  await expect(scoreInput(page)).toHaveValue('60');   // the edit survives

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();   // an explicit cancel: closes outright, no prompt
  await expect(confirm(page)).toBeHidden();
});
