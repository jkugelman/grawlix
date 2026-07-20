// Entry-panel walk in the transform tier. Regression: the walk keyed off
// atoms[0] only, so opening on a tool's output atom (never atoms[0]) could not
// locate its own row, and no cursor is set in this tier — Prev/Next dead-ended.
// See site/src/ui/entries-table.js EntryPanel + stepPanelCursor.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const BASES = ['cast', 'haul', 'lap', 'sight', 'time'];
const ENTRIES = [...BASES, ...BASES.map(b => 'over' + b)];

const panel = page => page.locator('#entry-panel');
const entryInput = page => page.locator('#entry-panel-entry');
const prev = page => page.locator('.entry-panel-prev');
const next = page => page.locator('.entry-panel-next');

async function setup(page) {
  await gotoApp(page);
  await page.evaluate(e => window.__grawlixTest.addCustomWordlist({
    name: 'Src', entries: e, scores: e.map(() => 50),
  }), ENTRIES);
  await page.evaluate(() => window.__grawlixTest.setStack(
    [{ tool: 'add_prefix', params: { prefix: 'over' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
}

// DOM order of the chain rows, as [input, output] pairs.
function rowPairs(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('the transform tier renders input→output chain rows', async ({ page }) => {
  await setup(page);
  const pairs = await rowPairs(page);
  expect(pairs.length).toBe(BASES.length);
  for (const pair of pairs) {
    expect(Array.isArray(pair)).toBe(true);
    expect(pair[1]).toBe('over' + pair[0]);
  }
});

test('Next/Prev walk the OUTPUT column of adjacent rows', async ({ page }) => {
  await setup(page);
  const pairs = await rowPairs(page);
  const startOut = pairs[1][1];
  const nextOut = pairs[2][1];

  // Open on the output atom (atom index 1) of the second row.
  await page.locator(`.entry-row[data-entry="${startOut}"] .atom[data-atom="1"] .atom-entry`).click();
  await expect(panel(page)).toBeVisible();
  await expect(entryInput(page)).toHaveValue(startOut);

  await next(page).click();
  await expect(entryInput(page)).toHaveValue(nextOut);
  await expect(page.locator('.entry-row.active')).toHaveAttribute('data-entry', nextOut);

  await prev(page).click();
  await expect(entryInput(page)).toHaveValue(startOut);
  await expect(page.locator('.entry-row.active')).toHaveAttribute('data-entry', startOut);
});

test('Alt+Down / Alt+Up walk the output column', async ({ page }) => {
  await setup(page);
  const pairs = await rowPairs(page);
  const startOut = pairs[1][1];
  const nextOut = pairs[2][1];

  await page.locator(`.entry-row[data-entry="${startOut}"] .atom[data-atom="1"] .atom-entry`).click();
  await expect(entryInput(page)).toHaveValue(startOut);

  await page.keyboard.press('Alt+ArrowDown');
  await expect(entryInput(page)).toHaveValue(nextOut);
  await page.keyboard.press('Alt+ArrowUp');
  await expect(entryInput(page)).toHaveValue(startOut);
});

test('opening on the INPUT column walks the input column', async ({ page }) => {
  await setup(page);
  const pairs = await rowPairs(page);
  const startIn = pairs[1][0];
  const nextIn = pairs[2][0];

  await page.locator(`.entry-row[data-entry="${pairs[1][1]}"] .atom[data-atom="0"] .atom-entry`).click();
  await expect(entryInput(page)).toHaveValue(startIn);

  await next(page).click();
  await expect(entryInput(page)).toHaveValue(nextIn);
});

test('editing an output atom then walking commits the edit and still shifts', async ({ page }) => {
  await setup(page);
  const pairs = await rowPairs(page);
  const startOut = pairs[1][1];
  const nextOut = pairs[2][1];

  await page.locator(`.entry-row[data-entry="${startOut}"] .atom[data-atom="1"] .atom-entry`).click();
  await expect(entryInput(page)).toHaveValue(startOut);
  await page.locator('#entry-panel-comment').fill('walked-note');

  await page.keyboard.press('Alt+ArrowDown');
  await expect(entryInput(page)).toHaveValue(nextOut);
  await expect.poll(() => page.evaluate(o => window.__grawlixTest.getWordlist('My Edits').entries
    .filter(e => e.entry === o).map(e => e.comment), startOut)).toEqual(['walked-note']);
});

test('the transform walk stops at the ends', async ({ page }) => {
  await setup(page);
  const pairs = await rowPairs(page);
  const firstOut = pairs[0][1];
  const lastOut = pairs[pairs.length - 1][1];

  await page.locator(`.entry-row[data-entry="${firstOut}"] .atom[data-atom="1"] .atom-entry`).click();
  await expect(prev(page)).toBeDisabled();
  await expect(next(page)).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  await page.locator(`.entry-row[data-entry="${lastOut}"] .atom[data-atom="1"] .atom-entry`).click();
  await expect(next(page)).toBeDisabled();
  await expect(prev(page)).toBeEnabled();
});
