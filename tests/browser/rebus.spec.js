// Rebus tool — repeatable string→symbol pairs emitting synthetic entries, the
// symbol suggestions popup, and the string box's Search cheat sheet. See
// docs/tools.md and docs/design.md § URL state (repeatable params).

import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, addTool, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addRebusFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'RebusTest',
    entries: ['barstool', 'costar', 'cat', 'dog'],
    scores: [70, 60, 40, 40],
  }));
}

const rebusRow = page => page.locator('.tool-row', { has: page.locator('.rebus-pairs') });

test('adding Rebus from the gallery shows one empty pair', async ({ page }) => {
  await gotoApp(page);
  await addRebusFixture(page);
  await addTool(page, 'rebus');
  const row = rebusRow(page);
  await expect(row.locator('.rebus-pair')).toHaveCount(1);
  await expect(row.locator('input[data-key="string"]')).toHaveValue('');
  await expect(row.locator('input[data-key="symbol"]')).toHaveValue('');
});

test('typing a pair produces a synthetic entry absent from the corpus', async ({ page }) => {
  await gotoApp(page);
  await addRebusFixture(page);
  await addTool(page, 'rebus');
  const row = rebusRow(page);
  await row.locator('input[data-key="string"]').fill('tool');
  await row.locator('input[data-key="symbol"]').fill('Ⓣ');
  await expectVisible(page, ['barsⓉ']);
});

test('add/remove pairs — + rides the last pair, × every pair once there are two', async ({ page }) => {
  await gotoApp(page);
  await addRebusFixture(page);
  await addTool(page, 'rebus');
  const row = rebusRow(page);
  const pairs = row.locator('.rebus-pair');
  await expect(row.locator('.rebus-pair-remove')).toHaveCount(0);
  await expect(pairs.first().locator('.rebus-pair-add')).toHaveCount(1);
  await row.locator('.rebus-pair-add').click();
  await expect(pairs).toHaveCount(2);
  await expect(row.locator('.rebus-pair-remove')).toHaveCount(2);
  await expect(row.locator('.rebus-pair-add')).toHaveCount(1);
  await expect(pairs.last().locator('.rebus-pair-add')).toHaveCount(1);
  await pairs.last().locator('.rebus-pair-remove').click();
  await expect(pairs).toHaveCount(1);
  await expect(row.locator('.rebus-pair-remove')).toHaveCount(0);
  await expect(pairs.first().locator('.rebus-pair-add')).toHaveCount(1);
});

test('removing the first pair keeps the second', async ({ page }) => {
  await gotoApp(page);
  await addRebusFixture(page);
  await addTool(page, 'rebus');
  const row = rebusRow(page);
  const pairs = row.locator('.rebus-pair');
  await pairs.first().locator('input[data-key="string"]').fill('tool');
  await pairs.first().locator('input[data-key="symbol"]').fill('Ⓣ');
  await row.locator('.rebus-pair-add').click();
  await pairs.last().locator('input[data-key="string"]').fill('star');
  await pairs.last().locator('input[data-key="symbol"]').fill('★');
  await expectVisible(page, ['barsⓉ', 'co★']);
  await pairs.first().locator('.rebus-pair-remove').click();
  await expect(pairs).toHaveCount(1);
  await expect(pairs.first().locator('input[data-key="string"]')).toHaveValue('star');
  await expect(pairs.first().locator('input[data-key="symbol"]')).toHaveValue('★');
  await expectVisible(page, ['co★']);
});

test('the string box offers no cheat sheet — the find is a literal', async ({ page }) => {
  await gotoApp(page);
  await addRebusFixture(page);
  await addTool(page, 'rebus');
  await rebusRow(page).locator('input[data-key="string"]').focus();
  await expect(page.locator('.popup-help.open')).toHaveCount(0);
});

test('focusing the symbol box opens the suggestions popup; clicking inserts', async ({ page }) => {
  await gotoApp(page);
  await addRebusFixture(page);
  await addTool(page, 'rebus');
  const symbol = rebusRow(page).locator('input[data-key="symbol"]');
  await symbol.focus();
  await expect(page.locator('.symbol-suggest.open')).toBeVisible();
  await page.locator('.symbol-suggest .symbol-cell[data-symbol="Ⓣ"]').click();
  await expect(symbol).toHaveValue('Ⓣ');
});

test('two pairs round-trip through the URL and apply simultaneously', async ({ page }) => {
  await gotoApp(page);
  await addRebusFixture(page);
  await page.evaluate(() => {
    history.replaceState(null, '', '?rebus=tool&symbol=Ⓣ&string=star&symbol=★');
    Router.applyURL();
    renderMergedDetail();
  });

  const params = await page.evaluate(() => ToolStack.getUserStack()[0].params);
  expect(params.string).toEqual(['tool', 'star']);
  expect(params.symbol).toEqual(['Ⓣ', '★']);

  await expectVisible(page, ['barsⓉ', 'co★']);

  const search = await page.evaluate(() => { Router.navigate(); return location.search; });
  expect(search).toBe('?rebus=tool&symbol=' + encodeURIComponent('Ⓣ') + '&string=star&symbol=' + encodeURIComponent('★'));
});
