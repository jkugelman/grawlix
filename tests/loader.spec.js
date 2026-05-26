const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

async function slowDownAnagrams(page, ms) {
  await page.evaluate((delayMs) => {
    TOOLS.anagrams.prepare = async (params) => {
      await new Promise(r => setTimeout(r, delayMs));
      return params.entry
        ? params.entry.toLowerCase().split('').sort().join('')
        : null;
    };
  }, ms);
}

test('adding a slow tool dims the entries panel via .pipeline-running', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Loader',
    entries: ['CAT', 'ACT', 'DOG'],
    scores: [50, 50, 50],
  }));

  await slowDownAnagrams(page, 250);

  await page.locator('.gallery-card[data-tool="anagrams"]').click();
  await page.locator('.tool-row input[data-key="entry"]').fill('CAT');

  await expect(page.locator('#entries-table-panel')).toHaveClass(/pipeline-running/, { timeout: 500 });

  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#entries-table-panel')).not.toHaveClass(/pipeline-running/);
});

test('a slow run shows a spinner over the entries table in addition to the dim', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'Loader',
    entries: ['CAT', 'ACT', 'DOG'],
    scores: [50, 50, 50],
  }));

  await slowDownAnagrams(page, 300);

  await page.locator('.gallery-card[data-tool="anagrams"]').click();
  await page.locator('.tool-row input[data-key="entry"]').fill('CAT');

  await expect(page.locator('#entries-table-panel .pipeline-spinner')).toBeVisible({ timeout: 500 });

  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('#entries-table-panel .pipeline-spinner')).toBeHidden();
});
