// The reusable clear (×) button shared by the Search bar, the score-range
// field, and every tool-row text input. Covers the component contract — the ×
// shows only while the field has text, and clicking it empties the field and
// fires `input` so the field's own handler reacts.

const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function addFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'ClearTest',
    entries: ['CAT', 'COT', 'DOG'],
    scores: [50, 50, 50],
  }));
}

async function visible(page) {
  return page.evaluate(() => window.__grawlixTest.getVisibleEntries());
}

test('the × shows only while the field has text', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  const input = page.locator('input[data-key="pattern"]');
  const clearBtn = page.locator('input[data-key="pattern"] ~ .clear-btn');

  await expect(clearBtn).toBeHidden();
  await input.fill('cat');
  await expect(clearBtn).toBeVisible();
  await input.fill('');
  await expect(clearBtn).toBeHidden();
});

test('clicking the × empties the field and its handler reacts', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);

  await page.locator('input[data-key="pattern"]').fill('cat');
  await expect.poll(() => visible(page)).toEqual(['cat']);

  await page.locator('input[data-key="pattern"] ~ .clear-btn').click();

  await expect(page.locator('input[data-key="pattern"]')).toHaveValue('');
  await expect(page.locator('input[data-key="pattern"] ~ .clear-btn')).toBeHidden();
  await expect.poll(async () => (await visible(page)).sort()).toEqual(['cat', 'cot', 'dog']);
});

test('a tool-row text input carries the clear button too', async ({ page }) => {
  await gotoApp(page);
  await addFixture(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagram', params: { entry: 'cat' } }]));

  const input = page.locator('input[data-key="entry"]');
  const clearBtn = page.locator('input[data-key="entry"] ~ .clear-btn');
  await expect(clearBtn).toBeVisible();
  await expect.poll(() => visible(page)).toEqual(['cat']);

  await clearBtn.click();

  await expect(input).toHaveValue('');
  await expect(clearBtn).toBeHidden();
  await expect.poll(async () => (await visible(page)).sort()).toEqual(['cat', 'cot', 'dog']);
});
