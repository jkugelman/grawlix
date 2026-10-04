// Bookends' Split column: a flat tool column with its own sort axis, whose runs
// the gutter bracket marks, and whose ambiguous splits wear a second color.

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible, addTool } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function setup(page) {
  await gotoApp(page);
  await page.evaluate(async () => {
    const T = window.__grawlixTest;
    await T.addCustomWordlist({
      name: 'Bookends',
      entries: ['plot a course', 'purple prose', 'pure bred horse', 'purses galore', 'pursuit of justice', 'banana'],
      scores:  [10, 40, 30, 50, 20, 60],
    });
    await T.setStack([{ tool: 'bookends', params: { entry: 'purse' } }]);
  });
}

const splitCells = page => page.locator('#vs-host .entry-row .atom-tool');

test('the Split column shows each row\'s split, longest start piece for an ambiguous one', async ({ page }) => {
  await setup(page);
  await expectVisible(page, ['plot a course', 'pure bred horse', 'purple prose', 'purses galore', 'pursuit of justice'], { ordered: true });
  await expect(page.locator('.entry-headers .col-tool')).toHaveText('Split');
  await expect(splitCells(page)).toHaveText(['p…urse', 'pur…se', 'pur…se', 'purs…e', 'purs…e']);
  const ambiguous = page.locator('#vs-host .entry-row', { hasText: 'pure bred horse' }).locator('.hl-ambiguous');
  await expect(ambiguous).toHaveText(['r', 'r']);
});

test('sorting by Split orders by split, brackets each run, and lands in the URL', async ({ page }) => {
  await setup(page);
  await page.locator('.col-tool .col-sort').click();
  await expect(page).toHaveURL(/sort=split/);
  await expectVisible(page, ['plot a course', 'purple prose', 'pure bred horse', 'purses galore', 'pursuit of justice'], { ordered: true });
  const brackets = await page.locator('#vs-host .entry-row').evaluateAll(rows => rows
    .sort((a, b) => a.offsetTop - b.offsetTop)
    .map(r => ['run-start', 'run-member', 'run-end'].filter(c => r.classList.contains(c)).join(' ')));
  expect(brackets).toEqual(['', 'run-start run-member', 'run-member run-end', 'run-start run-member', 'run-member run-end']);
});

test('typing the word letter by letter brings in the Split header', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bookends', entries: ['plot a course', 'pursuit of justice'], scores: [10, 20],
  }));
  await addTool(page, 'bookends');
  await page.locator('.tool-row input[data-key="entry"]').pressSequentially('purse', { delay: 30 });
  await expectVisible(page, ['plot a course', 'pursuit of justice']);
  await expect(page.locator('.entry-headers > span')).toHaveText(['', /Entry/, 'Length', 'Score', 'Split', 'Comment', 'Sources']);
});

async function sortedBySplit(page) {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bookends',
    entries: ['take home', 'tea for home', 'the long way home', 'took home'],
    scores:  [50, 50, 60, 50],
  }));
  await addTool(page, 'bookends');
  const input = page.locator('.tool-row input[data-key="entry"]');
  await input.pressSequentially('tome', { delay: 30 });
  await page.locator('.col-tool .col-sort').click();
  await expectVisible(page, BY_SPLIT, { ordered: true });
  return input;
}
const BY_SPLIT = ['the long way home', 'take home', 'tea for home', 'took home'];

test('clearing the word falls back to Entry, and retyping it restores the Split sort', async ({ page }) => {
  const input = await sortedBySplit(page);
  await page.locator('.tool-row .clear-btn').first().click();
  await expect(page.locator('.col-entry .col-sort')).toContainText('↑');
  await expect(page).not.toHaveURL(/sort=/);
  await input.pressSequentially('tome', { delay: 30 });
  await expectVisible(page, BY_SPLIT, { ordered: true });
  await expect(page.locator('.col-tool .col-sort')).toContainText('↑');
  await expect(page).toHaveURL(/sort=split/);
});

test('clearing and retyping before the cleared run lands keeps the header in step with the sort', async ({ page }) => {
  const input = await sortedBySplit(page);
  // One tick: the cleared run is superseded before any result of its lands.
  await input.evaluate(el => {
    for (const v of ['', 'tome']) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await expectVisible(page, BY_SPLIT, { ordered: true });
  await expect(page.locator('.col-tool .col-sort')).toContainText('↑');
  await expect(page.locator('.col-entry .col-sort')).not.toContainText('↑');
});

test('the header stays on one line between typing the word and its results landing', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Bookends', entries: ['take home', 'took home'], scores: [50, 50],
  }));
  await addTool(page, 'bookends');
  const input = page.locator('.tool-row input[data-key="entry"]');
  const wrapsOn = el => {
    const height = () => document.querySelector('.entry-headers').getBoundingClientRect().height;
    const oneLine = height();
    for (const v of ['tome', '']) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (height() > oneLine) return v;
    }
    return null;
  };
  expect(await input.evaluate(wrapsOn)).toBeNull();
});

test('removing Bookends drops the column and its sort', async ({ page }) => {
  await setup(page);
  await page.locator('.col-tool .col-sort').click();
  await page.evaluate(() => window.__grawlixTest.setStack([]));
  await expect(page.locator('.entry-headers .col-tool')).toHaveCount(0);
  await expect(splitCells(page)).toHaveCount(0);
  expect(await page.evaluate(() => AppView.sortKey)).toBe('entry');
});
