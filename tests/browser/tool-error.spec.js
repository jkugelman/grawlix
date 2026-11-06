import { test, expect } from '@playwright/test';
import { stubPublisherFetches, gotoApp, expectVisible } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await stubPublisherFetches(page);
});

// `throws` (engine/fixture-tools.js) throws from the stage its `at` param names.
const THROWING = { tool: 'throws', params: { at: 'run' } };

async function addLoaderFixture(page) {
  await page.evaluate(() => window.__grawlixTest.installFixtureTools());
  await page.evaluate(() => window.__grawlixTest.addCustomWordlist({
    name: 'ToolErr',
    entries: ['CAT', 'ACT', 'DOG'],
    scores: [50, 50, 50],
  }));
}

test('a throwing tool marks its row with a ⚠ icon and clears stale results', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);

  await page.evaluate(s => window.__grawlixTest.setStack(s), [THROWING]);

  const row = page.locator('.tool-row').first();
  await expect(row.locator('.tool-row-error-btn')).toBeVisible();

  await expectVisible(page, []);
});

test('a hover-capable device carries the error in the button title and does not open the popover on click', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);
  await page.evaluate(s => window.__grawlixTest.setStack(s), [THROWING]);

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
  await page.evaluate(s => window.__grawlixTest.setStack(s), [THROWING]);

  await page.locator('.tool-row-error-btn').click();
  await expect(page.locator('.tool-row-error-popover')).toBeVisible();
  await expect(page.locator('.tool-row-error-popover')).toContainText('deliberate test failure');
});

test('only the failing row carries the ⚠ icon', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);

  await page.evaluate(s => window.__grawlixTest.setStack(s), [{ tool: 'search', params: { pattern: 'cat' } }, THROWING]);

  const rows = page.locator('.tool-row');
  await expect(rows.nth(0).locator('.tool-row-error-btn')).toBeHidden();
  await expect(rows.nth(1).locator('.tool-row-error-btn')).toBeVisible();
});

test('fixing the broken tool clears the ⚠ icon on the next successful run', async ({ page }) => {
  await gotoApp(page);
  await addLoaderFixture(page);
  await page.evaluate(s => window.__grawlixTest.setStack(s), [THROWING]);
  await expect(page.locator('.tool-row-error-btn')).toBeVisible();

  await page.locator('.tool-row input[data-key="at"]').fill('');

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
  await page.evaluate(() => window.__grawlixTest.installFixtureTools());
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'throws', params: { at: 'prepare' } }]));

  await expect(page.locator('#splash-screen')).toHaveCount(0);
  await expect(page.locator('.tool-row-error-btn')).toBeVisible();
});

test('an invalid Umiaq query is underlined, not marked with a ⚠, and clears on a fix', async ({ page }) => {
  await gotoApp(page);

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { query: 'A;1>' } }]));
  const underline = page.locator('.tool-row .assist-hl .q-err');
  await expect(underline).toHaveText('>');
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('.tool-row-error-btn')).toBeHidden();

  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'umiaq', params: { query: 'AB' } }]));
  await expect(underline).toHaveCount(0);
});

// Read the marks in the same tick the input changes — NOT via a retrying
// expect, which would pass even if the ⚠ flashed on for a run and back off.
test('a parse error never lights the ⚠, even for a moment, and is underlined at once', async ({ page }) => {
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
      return { iconHidden: btn.hidden, underlined: !!input.parentElement.querySelector('.q-err') };
    };
    return { afterBreak: typeAndRead('A;1>'), afterFix: typeAndRead('AB') };
  });
  expect(marks.afterBreak).toEqual({ iconHidden: true, underlined: true });
  expect(marks.afterFix).toEqual({ iconHidden: true, underlined: false });
  await page.evaluate(() => window.__grawlixTest.pipelineIdle());
  await expect(page.locator('.tool-row-error-btn')).toBeHidden();
});

// The reason wording is engine-specific, so assert only that the panel shows a
// reason stripped of the "Invalid regular expression:" prefix V8 and JSC add.
// A duplicate group name is one only the browser catches, so its own words show.
test('an invalid regex explains the reason in the panel without the engine boilerplate', async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => window.__grawlixTest.setStack([{ tool: 'regex', params: { pattern: '(?<a>x)(?<a>y)' } }]));
  const input = page.locator('.tool-row input[data-key="pattern"]');
  await input.click();
  await input.press('ArrowLeft');
  const error = page.locator('.assist-panel .assist-error');
  await expect(error).toBeVisible();
  expect((await error.textContent())?.trim()).toBeTruthy();
  await expect(error).not.toContainText('Invalid regular expression');
  await expect(page.locator('.tool-row-error-btn')).toBeHidden();
});
