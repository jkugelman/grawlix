import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

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
  // Drain the fire-and-forget boot publisher fetches before re-running: one
  // re-rendering after setStack clears the error mark at dispatch and re-surfaces
  // it a run later — a transient hidden window the visibility poll races under load.
  await page.evaluate(() => window.__grawlixTest.loadIdle());
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await page.evaluate(() => window.__grawlixTest.patchWorkerToolForTest('anagrams', 'prepare', 'boot-time failure'));
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'anagrams', params: { entry: 'CATX' } }]));

  await expect(page.locator('#splash-screen')).toHaveCount(0);
  await expect(page.locator('.tool-row-error-btn')).toBeVisible();
});

test('an invalid Umiaq query surfaces its parse error and clears on a fix', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { query: 'A;1>' } }]));
  const errBtn = page.locator('.tool-row-error-btn');
  await expect(errBtn).toBeVisible();
  await expect(errBtn).toHaveAttribute('title', 'unexpected character ">"');

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { query: 'AB' } }]));
  await expect(errBtn).toBeHidden();
});

// Read the mark in the same tick the input changes — NOT via a retrying
// `expect().toBeHidden()`, which would pass even with the bug present, since the
// run settles fast here and clears the mark before the poll gives up. The
// synchronous read is what proves the mark comes from the input, not the settle.
test('the Umiaq parse-error mark tracks the query live, not at run settle', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { query: 'AB' } }]));
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('.tool-row-error-btn')).toBeHidden();

  const marks = await page.evaluate(() => {
    const input = document.querySelector('.tool-row input[data-key="query"]');
    const btn = document.querySelector('.tool-row-error-btn');
    const typeAndRead = (value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return btn.hidden;
    };
    return { afterBreak: typeAndRead('A;1>'), afterFix: typeAndRead('AB') };
  });
  expect(marks.afterBreak).toBe(false);   // ⚠ the instant the query breaks
  expect(marks.afterFix).toBe(true);      // gone the instant it's fixed
});

// The reason wording is engine-specific (V8 "Unterminated group", JSC "missing
// )", SpiderMonkey "unterminated parenthetical"), so assert only that a reason
// shows stripped of the "Invalid regular expression:" prefix V8 and JSC add.
test('an invalid regex surfaces the reason without the engine boilerplate', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'regex', params: { pattern: 'a(b' } }]));
  const errBtn = page.locator('.tool-row-error-btn');
  await expect(errBtn).toBeVisible();
  const title = await errBtn.getAttribute('title');
  expect(title?.trim()).toBeTruthy();
  expect(title).not.toContain('Invalid regular expression');
});
