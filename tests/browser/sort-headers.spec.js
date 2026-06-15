// Click-to-sort column headers drive the same Sort-by control as the dropdown.
// A column owns an ordered set of axes (canonical first); a click flips when
// already on one of them, else jumps to the canonical axis ascending.

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

test('filter-only: clicking a header drives the Sort-by control and flips direction', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await expect(page.locator('.sort-axis-select')).toHaveValue('entry');
  await expect(page.locator('.col-entry')).toHaveAttribute('aria-label', 'Sort by Entry, ascending');

  await page.locator('.col-score').click();
  await expect(page.locator('.sort-axis-select')).toHaveValue('score');
  await expect(page.locator('.col-score')).toHaveAttribute('aria-label', 'Sort by Score, ascending');
  await expect(page.locator('.col-score')).toContainText('↑');
  await expectVisible(page, ['delta', 'charlie', 'bravo', 'alpha'], { ordered: true });

  await page.locator('.col-score').click();
  await expect(page.locator('.col-score')).toHaveAttribute('aria-label', 'Sort by Score, descending');
  await expect(page.locator('.col-score')).toContainText('↓');
  await expectVisible(page, ['alpha', 'bravo', 'charlie', 'delta'], { ordered: true });

  await page.locator('.col-len').click();
  expect(await sortState(page)).toEqual({ key: 'length', dir: 'asc' });
});

test('transform tier: Score jumps to Min score; Max score then flips in place (no snap-back)', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'behead' }]));

  await page.locator('.col-score').click();
  expect(await sortState(page)).toEqual({ key: 'min-score', dir: 'asc' });

  await page.locator('.sort-axis-select').selectOption('max-score');
  expect(await sortState(page)).toEqual({ key: 'max-score', dir: 'asc' });
  await expect(page.locator('.col-score')).toHaveAttribute('aria-label', 'Sort by Score, ascending');

  await page.locator('.col-score').click();
  expect(await sortState(page)).toEqual({ key: 'max-score', dir: 'desc' });
});

test('group tier: Count and group columns sort; no Score column exists', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'GroupSort',
    entries: ['opt', 'pot', 'top', 'act', 'cat', 'dog'],
    scores:  [50, 40, 30, 60, 20, 70],
  }));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'letter_bank', grouped: true }]));

  await expect(page.locator('.group-headers')).toBeVisible();
  await expect(page.locator('.group-headers .col-score')).toHaveCount(0);

  await page.locator('.group-headers .group-count').click();
  expect((await sortState(page)).key).toBe('count');

  await page.locator('.group-headers .group-col[data-col="letters"]').click();
  expect((await sortState(page)).key).toBe('letters');

  await expect(page.locator('.sort-axis-select option[value="min-score"]')).toHaveCount(1);
});

test('keyboard: focusing a header and pressing Enter sorts', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-score').focus();
  await page.keyboard.press('Enter');
  expect((await sortState(page)).key).toBe('score');
});

test('a header click is reflected in the URL', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-score').click();
  await expect(page).toHaveURL(/sort=score/);
});
