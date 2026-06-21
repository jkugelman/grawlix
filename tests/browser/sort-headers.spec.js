// Per-column header sorting: a single-axis column sorts on a direct click (and
// flips on re-click); a multi-axis column opens a menu of its axes on click, so
// every axis a tier has is reachable from some column header.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, reloadApp, expectVisible } from './helpers.js';

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
  // The stats-bar count is an always-present, inert outside target (no sort
  // affordance, no click handler) — unlike the now-sortable header cells.
  await page.locator('.stats-bar-counts').click();
  await expect(page.locator('#sort-menu')).toBeHidden();
});

test('a header click is reflected in the URL', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-score .col-sort').click();
  await expect(page).toHaveURL(/sort=score/);
});

// The len-5 cluster (delta/alpha/bravo) splits on Score ASC — the secondary —
// giving delta<bravo<alpha, the OPPOSITE of a lone Length sort's score-desc
// tiebreak. So the visible order is what proves the secondary axis took effect.
test('a modifier-click adds a secondary sort axis with numbered rank badges', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-len .col-sort').click();
  await page.locator('.col-score .col-sort').click({ modifiers: ['Shift'] });

  expect(await sortState(page)).toEqual({ key: 'length', dir: 'asc' });
  expect(await page.evaluate(() => AppView.sortList))
    .toEqual([{ key: 'length', dir: 'asc' }, { key: 'score', dir: 'asc' }]);

  await expect(page.locator('.col-len .sort-rank')).toHaveText('1');
  await expect(page.locator('.col-score .sort-rank')).toHaveText('2');

  await expectVisible(page, ['delta', 'bravo', 'alpha', 'charlie'], { ordered: true });
});

for (const mod of ['Control', 'Alt', 'Meta']) {
  test(`${mod}-click extends the sort the same as Shift`, async ({ page }) => {
    await gotoApp(page);
    await addFixture(page);

    await page.locator('.col-len .col-sort').click();
    await page.locator('.col-score .col-sort').click({ modifiers: [mod] });

    expect(await page.evaluate(() => AppView.sortList))
      .toEqual([{ key: 'length', dir: 'asc' }, { key: 'score', dir: 'asc' }]);
  });
}

test('re-extending a level flips its direction; a plain click collapses to a single sort', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-len .col-sort').click();
  await page.locator('.col-score .col-sort').click({ modifiers: ['Shift'] });
  await page.locator('.col-score .col-sort').click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => AppView.sortList))
    .toEqual([{ key: 'length', dir: 'asc' }, { key: 'score', dir: 'desc' }]);

  await page.locator('.col-score .col-sort').click();
  expect(await page.evaluate(() => AppView.sortList)).toEqual([{ key: 'score', dir: 'asc' }]);
  await expect(page.locator('.sort-rank')).toHaveCount(0);
});

test('a multi-sort round-trips through the URL', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('.col-score .col-sort').click();
  await page.locator('.col-score .col-sort').click();              // Score desc
  await page.locator('.col-len .col-sort').click({ modifiers: ['Alt'] });   // + Length asc
  await expect(page).toHaveURL(/sort=score/);

  await reloadApp(page);
  expect(await page.evaluate(() => AppView.sortList))
    .toEqual([{ key: 'score', dir: 'desc' }, { key: 'length', dir: 'asc' }]);
});

test('a legacy sort=key&sort-dir=desc link still decodes', async ({ page }) => {
  await gotoApp(page, '/?sort=score&sort-dir=desc');
  await addFixture(page);
  expect(await page.evaluate(() => AppView.sortList)).toEqual([{ key: 'score', dir: 'desc' }]);
});

test('the Comment header sorts on click and flips direction', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Commented',
    entries:  ['alpha', 'bravo', 'charlie', 'delta'],
    scores:   [10, 20, 30, 40],
    comments: ['zebra', 'yak', 'xerus', 'wolf'],
  }));

  await page.locator('.col-comment .col-sort').click();
  expect(await sortState(page)).toEqual({ key: 'comment', dir: 'asc' });
  // comment asc: wolf < xerus < yak < zebra → delta, charlie, bravo, alpha.
  await expectVisible(page, ['delta', 'charlie', 'bravo', 'alpha'], { ordered: true });

  await page.locator('.col-comment .col-sort').click();
  expect(await sortState(page)).toEqual({ key: 'comment', dir: 'desc' });
  await expectVisible(page, ['alpha', 'bravo', 'charlie', 'delta'], { ordered: true });
});

test('the Source header sorts alphabetically by source name in the merged view', async ({ page }) => {
  await gotoApp(page);
  // Two sources with disjoint entries so each row's source is unambiguous; names
  // chosen so alphabetical (Alpha < Zeta) is the OPPOSITE of insertion order.
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Zeta',  entries: ['aaa', 'bbb'], scores: [10, 20] }));
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({ name: 'Alpha', entries: ['ccc', 'ddd'], scores: [30, 40] }));

  await expect(page.locator('.col-source .col-sort')).toBeVisible();
  await page.locator('.col-source .col-sort').click();
  expect(await sortState(page)).toEqual({ key: 'source', dir: 'asc' });
  // Source asc by NAME (not insertion order, not score): Alpha's rows then Zeta's.
  await expectVisible(page, ['ccc', 'ddd', 'aaa', 'bbb'], { ordered: true });
});
