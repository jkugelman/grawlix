const { test, expect } = require('@playwright/test');
const { stubPublisherFetches, gotoApp, expectVisible } = require('./helpers');

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// The pipeline runs in the worker, which has its own TOOLS realm a page-side
// TOOLS.x.run = … can't reach — break the worker's copy instead.
async function breakAnagrams(page) {
  await page.evaluate(() =>
    window.__grawlixTest.patchWorkerToolForTest('anagrams', 'run', 'deliberate test failure'));
}

async function addLoaderFixture(page) {
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'ToolErr',
    entries: ['CAT', 'ACT', 'DOG'],
    scores: [50, 50, 50],
  }));
}

test('a throwing tool marks its row with a ⚠ icon and clears stale results', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);
  await breakAnagrams(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'CAT' } }]));

  const row = page.locator('.tool-row').first();
  await expect(row.locator('.tool-row-error-btn')).toBeVisible();

  await expectVisible(page, []);
});

test('a hover-capable device carries the error in the button title and does not open the popover on click', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);
  await breakAnagrams(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'CAT' } }]));

  await expect(page.locator('.tool-row-error-btn')).toHaveAttribute('title', 'deliberate test failure');

  await page.locator('.tool-row-error-btn').click();
  await expect(page.locator('.tool-row-error-popover')).toHaveCount(0);
});

test('on a touch device, clicking the ⚠ icon reveals the error popover', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      if (q === '(hover: hover)') return { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
      return orig(q);
    };
  });
  await gotoApp(page);
  await addLoaderFixture(page);
  await breakAnagrams(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'CAT' } }]));

  await page.locator('.tool-row-error-btn').click();
  await expect(page.locator('.tool-row-error-popover')).toBeVisible();
  await expect(page.locator('.tool-row-error-popover')).toContainText('deliberate test failure');
});

test('only the failing row carries the ⚠ icon', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);
  await breakAnagrams(page);

  await page.evaluate(() => window.__grawlixTest.setStack([
    { tool: 'search', params: { pattern: 'cat' } },
    { tool: 'anagrams', params: { entry: 'CAT' } },
  ]));

  const rows = page.locator('.tool-row');
  await expect(rows.nth(0).locator('.tool-row-error-btn')).toBeHidden();
  await expect(rows.nth(1).locator('.tool-row-error-btn')).toBeVisible();
});

test('fixing the broken tool clears the ⚠ icon on the next successful run', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);
  await breakAnagrams(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'CAT' } }]));
  await expect(page.locator('.tool-row-error-btn')).toBeVisible();

  await page.evaluate(() => window.__grawlixTest.patchWorkerToolForTest('anagrams', 'run', null));
  await page.locator('.tool-row input[data-key="entry"]').fill('CATX');

  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('.tool-row-error-btn')).toBeHidden();
});

test('a throwing tool prepare surfaces the error without hanging the splash', async ({ page }) => {
  await stubPublisherFetches(page);
  await page.goto('/?anagrams=CAT');

  await expect(page.locator('#splash-screen')).toHaveCount(0, { timeout: 10000 });

  await page.evaluate(() => window.__grawlixTest.whenReady());
  await page.evaluate(() => window.__grawlixTest.patchWorkerToolForTest('anagrams', 'prepare', 'boot-time failure'));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'CATX' } }]));

  await expect(page.locator('#splash-screen')).toHaveCount(0);
  await expect(page.locator('.tool-row-error-btn')).toBeVisible();
});
