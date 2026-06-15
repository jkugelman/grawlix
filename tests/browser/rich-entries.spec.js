const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, scopeTo, expectVisible } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addRich(page, name, entries, scores) {
  await page.evaluate(([n, es, ss]) => window.__grawlixTest.addCustomWordlist({
    name: n, entries: es, scores: ss,
  }), [name, entries, scores]);
}

test.describe('norm + display', () => {
  test('distinct rich variants of one norm produce distinct merged rows', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Variants', ['Theirs', 'the IRS'], [50, 60]);
    await expectVisible(page, ['Theirs', 'the IRS']);
  });

  test('a bare entry from a plain list collapses into a richer same-norm variant from another list', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Plain', ['helenoftroy'], [50]);
    await addRich(page, 'Rich', ['Helen of Troy'], [60]);
    await scopeTo(page, 'All Wordlists');
    await expectVisible(page, ['Helen of Troy']);
  });

  test('a bare entry beside a richer same-source variant stays its own row', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'OneList', ['helenoftroy', 'Helen of Troy'], [50, 60]);
    await expectVisible(page, ['helenoftroy', 'Helen of Troy']);
  });

  test('length column counts norm letters, not display chars', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Lengths', ['the IRS'], [50]);
    await expect.poll(async () => page.evaluate(() =>
      [...document.querySelectorAll('#vs-host .atom-len')].map(el => el.textContent))
    ).toEqual(['6']);
  });
});

test.describe('UI-typed entries preserve case', () => {
  test('the add FAB seeds the search query verbatim, preserving case', async ({ page }) => {
    await gotoApp(page);
    await page.locator('.search-bar input[data-key="pattern"]').fill('Helen of Troy');
    await page.evaluate(() => window.__grawlixTest.pipelineIdle());
    await page.locator('#add-fab').click();
    await expect(page.locator('#atom-pop-entry')).toHaveValue('Helen of Troy');
    await page.locator('#atom-pop-score').fill('70');
    await page.locator('#atom-pop-score').press('Enter');
    await expect.poll(async () =>
      page.evaluate(() => window.__grawlixTest.getWordlist('My Edits').entries)
    ).toEqual([{ entry: 'helenoftroy', display: 'Helen of Troy', score: 70, comment: '' }]);
  });

  test('Search-replace preserves the replacement string case', async ({ page }) => {
    await gotoApp(page);
    await addRich(page, 'Replace', ['Bob of Troy', 'Helen of Troy'], [50, 50]);
    await page.evaluate(() => window.__grawlixTest.setStack([
      { tool: 'search', params: { pattern: 'Helen', replace: 'Bob' } },
    ]));
    await expectVisible(page, [['Helen of Troy', 'Bob of Troy']]);
  });
});
