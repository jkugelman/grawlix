// Per-column header sorting: a single-axis column sorts on a direct click (and
// flips on re-click); a multi-axis column opens a menu of its axes on click, so
// every axis a tier has is reachable from some column header.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

const sortState = page => page.evaluate(() => ({ key: AppView.sortKey, dir: AppView.sortDir }));

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'SortFixture',
    entries: ['delta', 'alpha', 'charlie', 'bravo'],
    scores:  [10, 40, 20, 30],
  }));
}

const openColMenu = (page, cellSel) => page.locator(`${cellSel} .col-sort`).click();

test('filter-only: a single-axis header sorts on click and flips direction', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  expect(await sortState(page)).toEqual({ key: 'entry', dir: 'asc' });
  await expect(page.locator('.col-entry .col-sort')).toHaveAttribute('aria-label', 'Sort by Entry, ascending');
  await expect(page.locator('.col-score .col-sort')).not.toHaveAttribute('aria-haspopup', 'listbox');

  await page.locator('.col-score .col-sort').click();
  expect(await sortState(page)).toEqual({ key: 'score', dir: 'asc' });
  await expect(page.locator('.col-score .col-sort')).toHaveAttribute('aria-label', 'Sort by Score, ascending');
  await expect(page.locator('.col-score .col-sort')).toContainText('↑');
  await expectVisible(page, ['delta', 'charlie', 'bravo', 'alpha'], { ordered: true });

  await page.locator('.col-score .col-sort').click();
  expect(await sortState(page)).toEqual({ key: 'score', dir: 'desc' });
  await expect(page.locator('.col-score .col-sort')).toContainText('↓');
  await expectVisible(page, ['alpha', 'bravo', 'charlie', 'delta'], { ordered: true });

  await page.locator('.col-len .col-sort').click();
  expect(await sortState(page)).toEqual({ key: 'length', dir: 'asc' });
});

test('transform tier: clicking Score opens a menu reaching Min and Max score', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  await openColMenu(page, '.col-score');
  await expect(page.locator('#sort-menu')).toBeVisible();
  await expect(page.locator('#sort-menu .sort-menu-label')).toHaveText(['Min score', 'Max score']);

  await page.locator('#sort-menu .sort-menu-opt[data-key="max-score"]').click();
  expect(await sortState(page)).toEqual({ key: 'max-score', dir: 'asc' });
  await expect(page.locator('#sort-menu')).toBeHidden();
  await expect(page.locator('.col-score .col-sort')).toContainText('↑');

  await openColMenu(page, '.col-score');
  await expect(page.locator('#sort-menu .sort-menu-opt[aria-selected="true"] .sort-menu-label')).toHaveText('Max score');
  await page.locator('#sort-menu .sort-menu-opt[data-key="max-score"]').click();
  expect(await sortState(page)).toEqual({ key: 'max-score', dir: 'desc' });
});

test('group tier: Min/Max score live on the Entries menu; Count sorts on click', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'GroupSort',
    entries: ['opt', 'pot', 'top', 'act', 'cat', 'dog'],
    scores:  [50, 40, 30, 60, 20, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  await expect(page.locator('.group-headers')).toBeVisible();
  await expect(page.locator('.group-headers .col-score')).toHaveCount(0);

  await page.locator('.group-headers .group-count .col-sort').click();
  expect((await sortState(page)).key).toBe('count');

  // A grouped pipeline has no score column, so Min/Max score live on the Entries
  // menu — guards that the menus cover every axis the tier has.
  await openColMenu(page, '.group-entries-label');
  await expect(page.locator('#sort-menu .sort-menu-label')).toHaveText(['Entry', 'Min score', 'Max score']);
  await page.locator('#sort-menu .sort-menu-opt[data-key="min-score"]').click();
  expect((await sortState(page)).key).toBe('min-score');
});

test('keyboard: Enter sorts a single-axis header and opens the menu on a multi-axis one', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-score .col-sort').focus();
  await page.keyboard.press('Enter');
  expect((await sortState(page)).key).toBe('score');

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));
  await page.locator('.col-score .col-sort').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#sort-menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  expect((await sortState(page)).key).toBe('max-score');
});

test('the sort menu dismisses on Escape and on an outside click', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  await openColMenu(page, '.col-score');
  await expect(page.locator('#sort-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#sort-menu')).toBeHidden();

  await openColMenu(page, '.col-score');
  await expect(page.locator('#sort-menu')).toBeVisible();
  await page.locator('.entry-headers .col-comment').click();
  await expect(page.locator('#sort-menu')).toBeHidden();
});

test('a header click is reflected in the URL', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-score .col-sort').click();
  await expect(page).toHaveURL(/sort=score/);
});
